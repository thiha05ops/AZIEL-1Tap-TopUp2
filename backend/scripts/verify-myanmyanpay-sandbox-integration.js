"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { inspectMyanMyanPayConfiguration, loadMyanMyanPayConfiguration, CALLBACK_URL } = require("../services/myanmyanpay/myanMyanPayConfiguration");
const { createMyanMyanPayClient } = require("../services/myanmyanpay/myanMyanPayClient");
const { createMyanMyanPayAdapter } = require("../services/commerce/providers/myanMyanPayAdapter");
const { createManualPaymentApplicationService } = require("../services/commerce/manualPaymentApplicationService");
const { isMyanMyanPayMethod, myanMyanPayAccessDecision } = require("../services/myanmyanpay/myanMyanPayPaymentPolicy");
const { validateCallback, eventId } = require("../routes/myanMyanPaySettlementCallback");
const {
    canonicalIdentity,
    findTesterCandidates,
    projectSandboxSettings,
    resolveTesterCustomerIds
} = require("../services/myanmyanpay/myanMyanPayAdminService");
const paymentInfrastructureService = require("../services/paymentInfrastructureService");
const PaymentMethod = require("../models/PaymentMethod");
const paymentMethodsRoute = require("../routes/paymentMethods");

const {
    applyMyanMyanPayCreationDefaults,
    applyPaymentMethodPatch,
    formatAdminMethod,
    normalizePaymentMethodKey
} = paymentMethodsRoute._test;

assert.strictEqual(normalizePaymentMethodKey("myanmyanpay_mmqr"), "myanmyanpay_mmqr");
assert.strictEqual(normalizePaymentMethodKey("myanmyanpaymmqr"), "myanmyanpay_mmqr");
assert.strictEqual(normalizePaymentMethodKey("myanmyanpay-mmqr"), "myanmyanpay_mmqr");
assert.strictEqual(normalizePaymentMethodKey("thunder_promptpay"), "thunder_promptpay", "Thunder canonicalization remains unchanged");
assert.strictEqual(normalizePaymentMethodKey("dinger_ayapay_qr"), "dinger_ayapay_qr", "Dinger AYA Pay canonicalization remains unchanged");
assert.strictEqual(normalizePaymentMethodKey("dinger_wavepay_pin"), "dinger_wavepay_pin", "Dinger WavePay canonicalization remains unchanged");

const createRequest = {
    method: "MyanMyanPay MMQR",
    key: "myanmyanpay_mmqr",
    region: "MM",
    provider: "myanmyanpay_mmqr",
    paymentChannel: "MYANMYANPAY_MMQR",
    paymentType: "auto",
    enabled: false
};
const createdMethod = new PaymentMethod({
    method: createRequest.method,
    key: normalizePaymentMethodKey(createRequest.key),
    region: createRequest.region,
    enabled: createRequest.enabled === true,
    paymentType: createRequest.paymentType,
    provider: createRequest.provider
});
applyPaymentMethodPatch(createdMethod, createRequest);
assert.strictEqual(isMyanMyanPayMethod(createdMethod), true, "canonicalized creation reaches the MyanMyanPay guard");
if (isMyanMyanPayMethod(createdMethod)) applyMyanMyanPayCreationDefaults(createdMethod);
const serializedCreatedMethod = formatAdminMethod(createdMethod);
assert.strictEqual(serializedCreatedMethod.key, "myanmyanpay_mmqr");
assert.strictEqual(serializedCreatedMethod.provider, "myanmyanpay_mmqr");
assert.strictEqual(serializedCreatedMethod.paymentChannel, "MYANMYANPAY_MMQR");
assert.strictEqual(serializedCreatedMethod.enabled, false);
assert.strictEqual(serializedCreatedMethod.myanMyanPayActivationState, "DISABLED");
assert.strictEqual(serializedCreatedMethod.myanMyanPaySandboxTestApproved, false);
assert.strictEqual(serializedCreatedMethod.myanMyanPayAuthorizedTestUserCount, 0);
assert.strictEqual(serializedCreatedMethod.myanMyanPayAuthorizedTestUserIds, undefined, "admin method projection must not expose internal tester ObjectIds");

const env = { MYANMYANPAY_SANDBOX_ENABLED: "true", MYANMYANPAY_SANDBOX_APP_ID: "APP-TEST", MYANMYANPAY_SANDBOX_PUBLISHABLE_KEY: "pk_test_example", MYANMYANPAY_SANDBOX_SECRET_KEY: "sk_test_example", MYANMYANPAY_SANDBOX_API_BASE_URL: "https://sandbox.example.test" };
assert.strictEqual(inspectMyanMyanPayConfiguration({}).configured, false, "missing configuration fails closed");
const configuration = loadMyanMyanPayConfiguration(env);
assert.strictEqual(configuration.environment, "SANDBOX");
assert.strictEqual(configuration.callbackUrl, CALLBACK_URL);
const safeConfiguration = inspectMyanMyanPayConfiguration(env);
assert.strictEqual(safeConfiguration.appIdConfigured, true);
assert.strictEqual(safeConfiguration.publishableKeyConfigured, true);
assert.strictEqual(safeConfiguration.secretKeyConfigured, true);
assert.strictEqual(safeConfiguration.apiBaseUrlConfigured, true);
assert(!JSON.stringify(safeConfiguration).includes(env.MYANMYANPAY_SANDBOX_SECRET_KEY), "safe configuration projection must redact secrets");

const method = { key: "myanmyanpay_mmqr", enabled: true, myanMyanPayActivationState: "TEST_ONLY", myanMyanPaySandboxTestApproved: true, myanMyanPayAuthorizedTestUserIds: ["user-1"] };
assert.strictEqual(myanMyanPayAccessDecision(method, {}).allowed, false, "public users cannot see TEST_ONLY");
assert.strictEqual(myanMyanPayAccessDecision(method, { id: "user-1" }, env).allowed, true, "allowlisted test user can access sandbox method");

(async () => {
    const userOne = { _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"), customerId: "AZU-H7KQ2M9WXP", username: "tester-one", email: "tester-one@gmail.com" };
    const userTwo = { _id: new mongoose.Types.ObjectId("507f191e810c19729de860ea"), customerId: "AZU-7NQK3H8RZT", username: "tester-two", email: "tester-two@gmail.com" };
    const users = [userOne, userTwo];
    const fakeUserModel = {
        find(query) {
            let rows = users;
            if (query.customerId?.$in) rows = users.filter(user => query.customerId.$in.includes(user.customerId));
            if (query.customerId?.$regex) rows = users.filter(user => new RegExp(query.customerId.$regex, query.customerId.$options).test(user.customerId));
            if (query._id?.$in) rows = users.filter(user => query._id.$in.some(id => String(id) === String(user._id)));
            const chain = {
                select() { return chain; }, sort() { return chain; }, limit(limit) { rows = rows.slice(0, limit); return chain; },
                async lean() { return rows.map(user => ({ ...user })); }
            };
            return chain;
        }
    };
    assert.deepStrictEqual(await findTesterCandidates("azu-h7", { UserModel: fakeUserModel }), [{ customerId: userOne.customerId, username: userOne.username, email: userOne.email }]);
    const resolved = await resolveTesterCustomerIds([userOne.customerId, userOne.customerId, userTwo.customerId], { UserModel: fakeUserModel });
    assert.deepStrictEqual(resolved.internalIds, [String(userOne._id), String(userTwo._id)], "customer IDs must resolve to internal ObjectId strings");
    assert(!resolved.internalIds.includes(userOne.customerId), "customer IDs must never be stored in the internal allowlist");
    await assert.rejects(() => resolveTesterCustomerIds(["INVALID"], { UserModel: fakeUserModel }), error => error.code === "MYANMYANPAY_TESTER_CUSTOMER_ID_INVALID");
    await assert.rejects(() => resolveTesterCustomerIds([userOne.customerId, "AZU-AAAAAAAAAA"], { UserModel: fakeUserModel }), error => error.code === "MYANMYANPAY_TESTER_NOT_FOUND" && error.metadata.unresolvedCount === 1);
    const canonicalMethod = { key: "myanmyanpay_mmqr", provider: "myanmyanpay_mmqr", paymentChannel: "MYANMYANPAY_MMQR", region: "MM", paymentType: "auto", myanMyanPayActivationState: "DISABLED", myanMyanPaySandboxTestApproved: false, myanMyanPayAuthorizedTestUserIds: [String(userOne._id)] };
    assert.strictEqual(canonicalIdentity(canonicalMethod).valid, true);
    assert.strictEqual(canonicalIdentity({ ...canonicalMethod, paymentChannel: "" }).valid, false);
    const settings = await projectSandboxSettings(canonicalMethod, { UserModel: fakeUserModel, env });
    assert.strictEqual(settings.environment, "SANDBOX");
    assert.strictEqual(settings.authorizedTesters[0].customerId, userOne.customerId);
    assert.strictEqual(settings.testOnlyReady, false, "sandbox approval remains required");
    assert(!JSON.stringify(settings).includes(String(userOne._id)), "sandbox settings must not expose internal ObjectIds");

    const infraEnvironment = paymentInfrastructureService._test.envStatusFromProcess("MYANMYANPAY", "TEST");
    const infraProvider = paymentInfrastructureService._test.projectProvider({ providerCode: "MYANMYANPAY", displayName: "MyanMyanPay", legalRegions: ["MM"], supportedCurrencies: ["MMK"], supportedRails: ["MYANMYANPAY_MMQR"], adapterName: "myanmyanpay", enabled: true, environments: [infraEnvironment] });
    assert.strictEqual(infraProvider.environments.length, 1);
    assert.strictEqual(infraProvider.environments[0].environment, "SANDBOX");
    assert.strictEqual(infraProvider.environments[0].webhook.endpoint, CALLBACK_URL);
    assert.strictEqual(infraProvider.environments[0].webhook.authenticationImplemented, true);

    const root = path.resolve(__dirname, "../..");
    const paymentRouteSource = fs.readFileSync(path.join(root, "backend/routes/paymentMethods.js"), "utf8");
    const adminPaymentSource = fs.readFileSync(path.join(root, "frontend/js/admin-payments.js"), "utf8");
    const adminUsersSource = fs.readFileSync(path.join(root, "backend/routes/adminUsers.js"), "utf8");
    assert(paymentRouteSource.includes('requireAdminPermission(PERMISSIONS.PAYMENT_METHODS_MANAGE)'), "tester lookup remains payment-management authorized");
    assert(paymentRouteSource.includes('authorizedTesterCustomerIds'), "activation must accept customer-facing tester IDs");
    assert(paymentRouteSource.includes('if (!["DISABLED", "TEST_ONLY"].includes(state))'), "PUBLIC must remain rejected");
    assert(paymentRouteSource.includes('MYANMYANPAY_CANONICAL_IDENTITY_INVALID'), "canonical identity must fail closed");
    assert(adminPaymentSource.includes('myanmyanpay_mmqr: { key: "myanmyanpay_mmqr"'), "Admin provider catalog must include MyanMyanPay");
    assert(adminPaymentSource.includes('Use the MyanMyanPay sandbox activation control'), "generic enable toggle must remain locked");
    assert(adminPaymentSource.includes('PUBLIC — unavailable'), "PUBLIC must be visibly unavailable");
    assert(adminPaymentSource.includes('authorizedTesterCustomerIds'), "Admin activation must submit customer IDs, not ObjectIds");
    assert(adminUsersSource.includes('{ customerId: { $regex:'), "Admin Users must search customerId");

    const calls = [];
    const adapter = createMyanMyanPayAdapter({ configuration, client: { async pay(payload) { calls.push(payload); return { orderId: payload.orderId, amount: payload.amount, currency: "MMK", status: "PENDING", vendorQrRefId: "QR-1", qr: "000201010212MMQR" }; } } });
    const created = await adapter.createPayment({ intent: { orderId: "ORDER-1", amount: 1500, currency: "MMK", paymentMethodId: "myanmyanpay_mmqr", items: [] }, attempt: { attemptId: "PAY-1" } });
    assert.strictEqual(created.status, "PENDING", "creation remains pending");
    assert.strictEqual(calls[0].amount, 1500, "authoritative integer MMK amount sent");
    assert.strictEqual(calls[0].callbackUrl, CALLBACK_URL);
    assert(created.qr.image.startsWith("data:image/png;base64,"), "MMQR rendered as safe image");
    assert(!JSON.stringify(created).includes(configuration.secretKey), "secret never enters normalized result");

    const attempt = { attemptId: "PAY-1", provider: "MYANMYANPAY", providerReference: "PAY-1", providerTransactionId: "PAY-1", paymentMethodId: "myanmyanpay_mmqr", amount: 1500, currency: "MMK", status: "PENDING", safeMetadata: { environment: "SANDBOX", appId: "APP-TEST", vendorQrRefId: "QR-1" } };
    const baseEvent = { provider: "MYANMYANPAY", providerReference: "PAY-1", providerTransactionId: "TX-1", providerEventId: "EVT-1", environment: "SANDBOX", appId: "APP-TEST", vendor: "KBZPay", method: "QR", condition: "PRISTINE", vendorQrRefId: "QR-1", amount: 1500, currency: "MMK" };
    for (const [rawProviderStatus, expected] of [["PENDING", "PENDING"], ["SUCCESS", "PAID"], ["FAILED", "FAILED"], ["CANCELLED", "CANCELLED"], ["EXPIRED", "EXPIRED"], ["REFUNDED", "REFUNDED"]]) {
        const event = await adapter.handleProviderEvent({ providerEvent: { ...baseEvent, rawProviderStatus }, attempt, intent: {}, trustedOperational: true });
        assert.strictEqual(event.status, expected, `${rawProviderStatus} mapping`);
    }
    for (const mutation of [{ amount: 1501 }, { currency: "USD" }, { provider: "DINGER" }, { environment: "PRODUCTION" }, { providerReference: "UNKNOWN" }, { method: "PIN" }]) {
        await assert.rejects(() => adapter.handleProviderEvent({ providerEvent: { ...baseEvent, rawProviderStatus: "SUCCESS", ...mutation }, attempt, intent: {}, trustedOperational: true }));
    }

    const callback = validateCallback({ orderId: "PAY-1", amount: 1500, currency: "MMK", vendor: "KBZPay", method: "QR", status: "SUCCESS", condition: "PRISTINE", transactionRefId: "TX-1", vendorQrRefId: "QR-1" });
    assert.strictEqual(eventId(callback), eventId({ ...callback }), "callback replay identity is deterministic");
    assert.throws(() => validateCallback({ ...callback, status: "UNKNOWN" }));

    class FakeSdk extends EventEmitter {
        _generateSignature(payload, nonce) { return crypto.createHmac("sha256", "sdk-test").update(`${nonce}.${payload}`).digest("hex"); }
        async listen(payload) { this.emit("tx:success", JSON.parse(payload)); return this; }
    }
    const sdk = new FakeSdk();
    const client = createMyanMyanPayClient(configuration, { sdk });
    const payload = JSON.stringify(callback), nonce = "nonce-1", signature = sdk._generateSignature(payload, nonce);
    assert.deepStrictEqual(await client.verifyAndListen(payload, nonce, signature), callback, "valid SDK signature and nonce accepted");
    await assert.rejects(() => client.verifyAndListen(payload, "", signature), /authentication failed/);
    await assert.rejects(() => client.verifyAndListen(payload, nonce, "bad"), /authentication failed/);

    let captured;
    const service = createManualPaymentApplicationService({ paymentOrchestrator: { async handleProviderEvent(input) { captured = input; return { paymentStatus: "paid", metadata: {} }; } } });
    await service.applyMyanMyanPayCallback({ result: callback, environment: "SANDBOX", appId: "APP-TEST", providerEventId: eventId(callback) });
    assert.strictEqual(captured.trustedOperational, true);
    assert.strictEqual(captured.providerEvent.provider, "MYANMYANPAY");
    assert.strictEqual(captured.providerEvent.status, "SUCCESS", "application boundary delegates provider status to adapter/orchestrator");
    assert.strictEqual(captured.verifiedTransactionRef, "TX-1", "transaction reuse protection binding supplied");

    console.log("MyanMyanPay sandbox integration verification passed (configuration, TEST_ONLY access, create, MMQR, SDK auth, bindings, status mapping, replay identity, orchestrator delegation).");
})().catch(error => { console.error(error); process.exitCode = 1; });
