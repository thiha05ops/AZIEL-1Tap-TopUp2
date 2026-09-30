"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const {
    CALLBACK_URL,
    SANDBOX_API_BASE_URL,
    PRODUCTION_API_BASE_URL,
    inspectMyanMyanPayConfiguration,
    inspectMyanMyanPayEnvironments,
    loadMyanMyanPayConfiguration
} = require("../services/myanmyanpay/myanMyanPayConfiguration");
const { createMyanMyanPayClient, _test: clientTest } = require("../services/myanmyanpay/myanMyanPayClient");
const { createMyanMyanPayAdapter } = require("../services/commerce/providers/myanMyanPayAdapter");
const { myanMyanPayAccessDecision } = require("../services/myanmyanpay/myanMyanPayPaymentPolicy");
const { projectMyanMyanPaySettings } = require("../services/myanmyanpay/myanMyanPayAdminService");
const { eventId, resolveAttemptEnvironment } = require("../routes/myanMyanPaySettlementCallback");

const root = path.resolve(__dirname, "../..");
const PROVIDER_ORDER_ID = "0123456789ABCDEF";
const TEST_USER_ID = "507f1f77bcf86cd799439011";
const productionEnv = {
    MYANMYANPAY_ENVIRONMENT: "PRODUCTION",
    MYANMYANPAY_PRODUCTION_APP_ID: "APP-LIVE",
    MYANMYANPAY_PRODUCTION_PUBLISHABLE_KEY: "pk_live_example",
    MYANMYANPAY_PRODUCTION_SECRET_KEY: "sk_live_example",
    MYANMYANPAY_PRODUCTION_API_BASE_URL: PRODUCTION_API_BASE_URL,
    MYANMYANPAY_SANDBOX_APP_ID: "APP-TEST",
    MYANMYANPAY_SANDBOX_PUBLISHABLE_KEY: "pk_test_example",
    MYANMYANPAY_SANDBOX_SECRET_KEY: "sk_test_example",
    MYANMYANPAY_SANDBOX_API_BASE_URL: SANDBOX_API_BASE_URL
};

const productionReadiness = inspectMyanMyanPayConfiguration(productionEnv);
assert.strictEqual(productionReadiness.environment, "PRODUCTION");
assert.strictEqual(productionReadiness.configured, true);
assert.strictEqual(loadMyanMyanPayConfiguration(productionEnv).apiBaseUrl, PRODUCTION_API_BASE_URL);
assert.strictEqual(inspectMyanMyanPayEnvironments(productionEnv).sandbox.configured, true, "Sandbox must remain independently configurable");
assert.strictEqual(inspectMyanMyanPayEnvironments(productionEnv).production.configured, true, "Production must be independently configurable");
assert(!JSON.stringify(productionReadiness).includes(productionEnv.MYANMYANPAY_PRODUCTION_SECRET_KEY), "readiness must not expose Production secrets");

for (const invalid of [
    SANDBOX_API_BASE_URL,
    "http://api.myanmyanpay.com",
    "https://sub.api.myanmyanpay.com",
    "https://api.myanmyanpay.com/",
    "https://api.myanmyanpay.com/payments",
    "https://api.myanmyanpay.com?x=1",
    "https://api.myanmyanpay.com#x",
    "https://user@api.myanmyanpay.com",
    "https://api.myanmyanpay.com:443"
]) assert.strictEqual(inspectMyanMyanPayConfiguration({ ...productionEnv, MYANMYANPAY_PRODUCTION_API_BASE_URL: invalid }).configured, false, `Production origin must reject ${invalid}`);
assert.strictEqual(inspectMyanMyanPayConfiguration({ ...productionEnv, MYANMYANPAY_PRODUCTION_PUBLISHABLE_KEY: "pk_test_wrong" }).configured, false, "Sandbox publishable credentials must not initialize Production");
assert.strictEqual(inspectMyanMyanPayConfiguration({ ...productionEnv, MYANMYANPAY_PRODUCTION_SECRET_KEY: "sk_test_wrong" }).configured, false, "Sandbox secret credentials must not initialize Production");
assert.strictEqual(inspectMyanMyanPayConfiguration({ ...productionEnv, MYANMYANPAY_ENVIRONMENT: "LIVE" }).configured, false, "unknown environment selectors must fail closed");

const method = {
    key: "myanmyanpay_mmqr", provider: "myanmyanpay_mmqr", paymentChannel: "MYANMYANPAY_MMQR", region: "MM", paymentType: "auto",
    enabled: true, myanMyanPayActivationState: "TEST_ONLY", myanMyanPayProductionTestApproved: true,
    myanMyanPaySandboxTestApproved: true, myanMyanPayGoLiveApproved: false, myanMyanPayAuthorizedTestUserIds: [TEST_USER_ID]
};
assert.strictEqual(myanMyanPayAccessDecision(method, {}, productionEnv).allowed, false, "anonymous users must not use restricted Production testing");
assert.strictEqual(myanMyanPayAccessDecision(method, { id: TEST_USER_ID }, productionEnv).allowed, true, "authorized user may use restricted Production testing");
assert.strictEqual(myanMyanPayAccessDecision({ ...method, myanMyanPayActivationState: "PUBLIC" }, {}, productionEnv).allowed, false, "PUBLIC must remain blocked without go-live approval");
assert.strictEqual(myanMyanPayAccessDecision({ ...method, myanMyanPayActivationState: "PUBLIC", myanMyanPayGoLiveApproved: true }, {}, productionEnv).allowed, false, "PUBLIC must remain blocked until controlled Production evidence is verified");
assert.strictEqual(myanMyanPayAccessDecision({ ...method, myanMyanPayActivationState: "PUBLIC", myanMyanPayProductionTestVerified: true, myanMyanPayGoLiveApproved: true }, {}, productionEnv).allowed, true, "PUBLIC policy becomes ready only after all Production gates");

(async () => {
    const configuration = loadMyanMyanPayConfiguration(productionEnv);
    let payCalls = 0;
    const sdkResult = { orderId: PROVIDER_ORDER_ID, amount: 1500, currency: "MMK", status: "PENDING", vendorQrRefId: "QR-1", transactionRefId: "TX-1", qr: "000201010212MMQR" };
    const client = createMyanMyanPayClient(configuration, { sdk: { async pay() { payCalls += 1; return sdkResult; } }, logger: { info() {} } });
    const adapter = createMyanMyanPayAdapter({ configuration, client, providerOrderIdFactory: () => PROVIDER_ORDER_ID });
    const prepared = await adapter.prepareAttempt();
    assert.strictEqual(prepared.providerReference, PROVIDER_ORDER_ID);
    assert.strictEqual(prepared.providerReference.length, 16);
    assert.deepStrictEqual(prepared.safeMetadata.environment, "PRODUCTION");
    const created = await adapter.createPayment({ intent: { orderId: "AZL-1", amount: 1500, currency: "MMK", items: [] }, attempt: { providerReference: prepared.providerReference } });
    assert.strictEqual(payCalls, 1);
    assert.strictEqual(created.status, "PENDING", "initiation must never settle payment");
    assert.strictEqual(created.safeMetadata.environment, "PRODUCTION");

    class CallbackSdk extends EventEmitter {
        constructor(secret) { super(); this.secret = secret; }
        _generateSignature(payload, nonce) { return crypto.createHmac("sha256", this.secret).update(`${nonce}.${payload}`).digest("hex"); }
        async listen(payload) { this.emit("tx:success", JSON.parse(payload)); return this; }
    }
    const callbackPayload = JSON.stringify({ orderId: PROVIDER_ORDER_ID, amount: 1500, currency: "MMK", vendor: "KBZPay", method: "QR", status: "SUCCESS", condition: "PRISTINE", transactionRefId: "TX-1" });
    const nonce = "1790000000000";
    const productionSdk = new CallbackSdk(productionEnv.MYANMYANPAY_PRODUCTION_SECRET_KEY);
    const callbackClient = createMyanMyanPayClient(configuration, { sdk: productionSdk, logger: { info() {} } });
    const signature = productionSdk._generateSignature(callbackPayload, nonce);
    assert.deepStrictEqual(await callbackClient.verifyAndListen(callbackPayload, nonce, signature), JSON.parse(callbackPayload), "Production callback must authenticate with the Production secret");
    const sandboxSignature = new CallbackSdk(productionEnv.MYANMYANPAY_SANDBOX_SECRET_KEY)._generateSignature(callbackPayload, nonce);
    await assert.rejects(() => callbackClient.verifyAndListen(callbackPayload, nonce, sandboxSignature), error => error.code === "MYANMYANPAY_CALLBACK_SIGNATURE_INVALID", "Sandbox callback credentials must not authenticate a Production attempt");

    const productionUrlShape = clientTest.safeUrlShape(configuration, "GET");
    assert.strictEqual(productionUrlShape.sdkSandboxSelected, false);
    assert.strictEqual(productionUrlShape.handshakeEndpointPath, "/payments/handshake");
    assert.strictEqual(productionUrlShape.endpointPath, "/payments/get");
    assert.strictEqual(clientTest.safeUrlShape(configuration, "PAY").endpointPath, "/payments/create");
    assert.strictEqual(clientTest.safeUrlShape(configuration, "CANCEL").endpointPath, "/payments/cancel");

    assert.strictEqual(await resolveAttemptEnvironment(PROVIDER_ORDER_ID, { findAttempt: async () => ({ provider: "MYANMYANPAY", safeMetadata: { environment: "PRODUCTION" } }) }), "PRODUCTION");
    await assert.rejects(() => resolveAttemptEnvironment(PROVIDER_ORDER_ID, { findAttempt: async () => null }), error => error.code === "MYANMYANPAY_CALLBACK_ATTEMPT_NOT_FOUND");
    assert(eventId({ orderId: PROVIDER_ORDER_ID, transactionRefId: "TX-1", vendorQrRefId: "QR-1", status: "SUCCESS" }, "PRODUCTION").startsWith("myanmyanpay:production:"));
    assert.notStrictEqual(eventId({ orderId: PROVIDER_ORDER_ID, transactionRefId: "TX-1", vendorQrRefId: "QR-1", status: "SUCCESS" }, "PRODUCTION"), eventId({ orderId: PROVIDER_ORDER_ID, transactionRefId: "TX-1", vendorQrRefId: "QR-1", status: "SUCCESS" }, "SANDBOX"));

    const settings = await projectMyanMyanPaySettings(method, { env: productionEnv, UserModel: { find() { const chain = { select() { return chain; }, async lean() { return [{ _id: TEST_USER_ID, customerId: "AZU-H7KQ2M9WXP", username: "tester", email: "tester@example.com" }]; } }; return chain; } } });
    assert.strictEqual(settings.environment, "PRODUCTION");
    assert.strictEqual(settings.testOnlyReady, true);
    assert.strictEqual(settings.publicReady, false);
    assert(!JSON.stringify(settings).includes(productionEnv.MYANMYANPAY_PRODUCTION_SECRET_KEY));

    const sdkSource = fs.readFileSync(path.join(root, "node_modules/mmpay-node-sdk/src/index.ts"), "utf8");
    const sdkPlugin = fs.readFileSync(path.join(root, "node_modules/mmpay-node-sdk/plugins/fastifyJS/mmpayPlugin.md"), "utf8");
    assert(sdkSource.includes("this.#isSandbox ? 'sandbox-handshake' : 'handshake'") && sdkSource.includes("this.#isSandbox ? 'sandbox-create' : 'create'"));
    assert(sdkSource.includes("this.#isSandbox ? 'sandbox-get' : 'get'") && sdkSource.includes("this.#isSandbox ? 'sandbox-cancel' : 'cancel'"));
    assert(sdkPlugin.includes("apiBaseUrl: 'https://api.myanmyanpay.com'"), "bundled SDK provider documentation must evidence the Production origin");

    const callbackSource = fs.readFileSync(path.join(root, "backend/routes/myanMyanPaySettlementCallback.js"), "utf8");
    const appSource = fs.readFileSync(path.join(root, "backend/services/commerce/manualPaymentApplicationService.js"), "utf8");
    const shellSource = fs.readFileSync(path.join(root, "frontend/js/payment/mm-payment-shell.js"), "utf8");
    assert(callbackSource.includes("resolveAttemptEnvironment") && callbackSource.includes("loadMyanMyanPayConfiguration(options.env, { environment })"), "callback credentials must be selected by stored attempt environment");
    assert(appSource.includes('settlementAuthority: "AUTHENTICATED_CALLBACK"') && appSource.includes('["SUCCESS", "REFUNDED"].includes(base.providerObservedStatus)'), "reconciliation must remain observation-only for settlement states");
    assert(shellSource.includes('providerAttribution.textContent = "Payment Powered by MyanMyanPay"'), "mandatory attribution must remain exact");
    assert.strictEqual(CALLBACK_URL, "https://azielplay.com/api/webhooks/myanmyanpay/payment");

    console.log("MyanMyanPay Production readiness verification passed (environment isolation, live contract, restricted access, callback binding, callback-only settlement, attribution). ");
})().catch(error => { console.error(error); process.exitCode = 1; });
