"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const mongoose = require("mongoose");
const { inspectMyanMyanPayConfiguration, loadMyanMyanPayConfiguration, CALLBACK_URL } = require("../services/myanmyanpay/myanMyanPayConfiguration");
const { createMyanMyanPayClient, _test: myanMyanPayClientTest } = require("../services/myanmyanpay/myanMyanPayClient");
const { createMyanMyanPayProviderOrderId, isMyanMyanPayProviderOrderId } = require("../services/myanmyanpay/myanMyanPayProviderOrderId");
const { createMyanMyanPayAdapter } = require("../services/commerce/providers/myanMyanPayAdapter");
const { createManualPaymentApplicationService } = require("../services/commerce/manualPaymentApplicationService");
const { isMyanMyanPayMethod, myanMyanPayAccessDecision } = require("../services/myanmyanpay/myanMyanPayPaymentPolicy");
const { validateCallback, eventId, handleMyanMyanPaySettlementCallback } = require("../routes/myanMyanPaySettlementCallback");
const {
    canonicalIdentity,
    findTesterCandidates,
    projectSandboxSettings,
    resolveTesterCustomerIds
} = require("../services/myanmyanpay/myanMyanPayAdminService");
const paymentInfrastructureService = require("../services/paymentInfrastructureService");
const { sessionFrom } = require("../services/commerce/customerManualPaymentCheckoutService");
const PaymentMethod = require("../models/PaymentMethod");
const paymentMethodsRoute = require("../routes/paymentMethods");

const PROVIDER_ORDER_ID = "0123456789ABCDEF";
const SECOND_PROVIDER_ORDER_ID = "FEDCBA9876543210";

async function invokeRawCallback(body, headers, options) {
    let statusCode = 200;
    let responseBody;
    const req = {
        body: Buffer.isBuffer(body) ? body : Buffer.from(body || "", "utf8"),
        get(name) { return headers[String(name).toLowerCase()] || ""; }
    };
    const res = {
        status(value) { statusCode = value; return this; },
        json(value) { responseBody = value; return value; }
    };
    await handleMyanMyanPaySettlementCallback(req, res, options);
    return { status: statusCode, data: responseBody };
}

assert.strictEqual(isMyanMyanPayProviderOrderId(PROVIDER_ORDER_ID), true);
assert.strictEqual(PROVIDER_ORDER_ID.length, 16);
assert.strictEqual(createMyanMyanPayProviderOrderId(() => Buffer.from("00112233445566778899", "hex")).length, 16);
assert.notStrictEqual(
    createMyanMyanPayProviderOrderId(() => Buffer.from("00112233445566778899", "hex")),
    createMyanMyanPayProviderOrderId(() => Buffer.from("99112233445566778800", "hex")),
    "different random input must produce a different provider order ID"
);

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

const env = { MYANMYANPAY_SANDBOX_ENABLED: "true", MYANMYANPAY_SANDBOX_APP_ID: "APP-TEST", MYANMYANPAY_SANDBOX_PUBLISHABLE_KEY: "pk_test_example", MYANMYANPAY_SANDBOX_SECRET_KEY: "sk_test_example", MYANMYANPAY_SANDBOX_API_BASE_URL: "https://ezapi.myanmyanpay.com" };
assert.strictEqual(inspectMyanMyanPayConfiguration({}).configured, false, "missing configuration fails closed");
[
    "https://sandbox.myanmyanpay.com",
    "http://ezapi.myanmyanpay.com",
    "https://other.example.com",
    "https://sub.ezapi.myanmyanpay.com",
    "https://ezapi.myanmyanpay.com/",
    "https://ezapi.myanmyanpay.com/payments",
    "https://ezapi.myanmyanpay.com?test=1",
    "https://ezapi.myanmyanpay.com#test",
    "https://user@ezapi.myanmyanpay.com",
    "https://ezapi.myanmyanpay.com:443",
    "https://ezapi.myanmyanpay.com:8443"
].forEach(apiBaseUrl => {
    assert.strictEqual(inspectMyanMyanPayConfiguration({ ...env, MYANMYANPAY_SANDBOX_API_BASE_URL: apiBaseUrl }).configured, false, `Sandbox API base must reject ${apiBaseUrl}`);
});
assert.strictEqual(inspectMyanMyanPayConfiguration({ ...env, MYANMYANPAY_SANDBOX_PUBLISHABLE_KEY: "pk_live_example" }).configured, false, "non-Sandbox credentials must fail closed");
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

    const createPayload = { orderId: PROVIDER_ORDER_ID, amount: 34740, currency: "MMK", callbackUrl: CALLBACK_URL, customMessage: "AZIEL order", items: [] };
    const validCreateResponse = { orderId: createPayload.orderId, status: "PENDING", vendorQrRefId: "VENDOR-QR", transactionRefId: "TX-1", amount: 34740, currency: "MMK", qr: "000201010212MMQR" };
    const sdkCalls = [];
    const sdkClient = createMyanMyanPayClient(configuration, { sdk: {
        async pay(payload) { sdkCalls.push(["pay", payload]); return validCreateResponse; },
        async get(payload) { sdkCalls.push(["get", payload]); return { orderId: payload.orderId, amount: 34740, status: "PENDING", method: "QR", condition: "PRISTINE" }; },
        async cancel(payload) { sdkCalls.push(["cancel", payload]); return { orderId: payload.orderId, amount: 34740, status: "CANCELLED" }; }
    }, logger: { info() {} } });
    const createdBySdk = await sdkClient.pay(createPayload);
    assert.strictEqual(createdBySdk.status, "PENDING");
    assert.deepStrictEqual(sdkCalls[0], ["pay", { orderId: createPayload.orderId, amount: 34740, currency: "MMK", callbackUrl: CALLBACK_URL, customMessage: "AZIEL order" }], "AZIEL must call SDK pay exactly once with documented fields only");
    assert.strictEqual(sdkCalls.some(([operation]) => operation === "handShake"), false, "AZIEL must not manually invoke SDK handshake");
    await sdkClient.get({ orderId: createPayload.orderId, expectedAmount: 34740, expectedCurrency: "MMK" });
    assert.deepStrictEqual(sdkCalls[1], ["get", { orderId: createPayload.orderId }], "reconciliation must call SDK get with only orderId");
    await sdkClient.cancel({ orderId: createPayload.orderId, expectedAmount: 34740 });
    assert.deepStrictEqual(sdkCalls[2], ["cancel", { orderId: createPayload.orderId }], "cancellation must use SDK cancel contract");
    await assert.rejects(() => sdkClient.pay({ ...createPayload, orderId: "paymentAttempt-1790691957504-f9776f58" }), error => error.code === "MYANMYANPAY_PROVIDER_REQUEST_INVALID", "PaymentAttempt IDs must not be truncated or sent as provider order IDs");
    await assert.rejects(() => sdkClient.get({ orderId: "TOO-LONG-PROVIDER-ID" }), error => error.code === "MYANMYANPAY_PROVIDER_REQUEST_INVALID");
    assert.strictEqual(sdkCalls.length, 3, "invalid provider order IDs must fail before any SDK operation");

    const clientResponseCases = [
        [new Error("resolved SDK error must-not-log"), "MYANMYANPAY_SDK_RETURNED_ERROR"],
        [{ code: "PROVIDER_REJECTED", message: "must-not-log" }, "MYANMYANPAY_PROVIDER_REJECTED"],
        [{ ...validCreateResponse, orderId: "WRONG" }, "MYANMYANPAY_PROVIDER_BINDING_MISMATCH"],
        [{ ...validCreateResponse, amount: 34741 }, "MYANMYANPAY_PROVIDER_BINDING_MISMATCH"],
        [{ ...validCreateResponse, currency: "USD" }, "MYANMYANPAY_PROVIDER_RESPONSE_INVALID"],
        [{ ...validCreateResponse, qr: "" }, "MYANMYANPAY_PROVIDER_RESPONSE_INVALID"],
        [{ ...validCreateResponse, qr: "not-an-emvco-payload" }, "MYANMYANPAY_PROVIDER_RESPONSE_INVALID"],
        [{ ...validCreateResponse, vendorQrRefId: "unsafe reference" }, "MYANMYANPAY_PROVIDER_RESPONSE_INVALID"],
        [{ ...validCreateResponse, status: "SUCCESS" }, "MYANMYANPAY_PROVIDER_RESPONSE_INVALID"],
        [{}, "MYANMYANPAY_PROVIDER_RESPONSE_INVALID"]
    ];
    for (const [providerResult, expectedCode] of clientResponseCases) {
        let payCalls = 0;
        const client = createMyanMyanPayClient(configuration, { sdk: { async pay() { payCalls += 1; return providerResult; } }, logger: { info() {} } });
        await assert.rejects(() => client.pay(createPayload), error => error.code === expectedCode);
        assert.strictEqual(payCalls, 1, "client validation must not retry provider create");
    }
    let thrownPayCalls = 0;
    const thrownPayClient = createMyanMyanPayClient(configuration, { sdk: { async pay() { thrownPayCalls += 1; throw new TypeError("secret SDK failure must-not-log"); } }, logger: { info() {} } });
    await assert.rejects(() => thrownPayClient.pay(createPayload), error => error.code === "MYANMYANPAY_SDK_OPERATION_FAILED" && error.metadata.classification === "THROWN_EXCEPTION");
    assert.strictEqual(thrownPayCalls, 1, "thrown SDK pay must not be retried");

    const diagnosticConfiguration = {
        ...configuration,
        appId: "APP-SECRET-MUST-NOT-LOG",
        publishableKey: "pk_test_publishable-secret-must-not-log",
        secretKey: "sk_test_secret-must-not-log",
        apiBaseUrl: "https://sandbox.example.test/payments?token=must-not-log#secret"
    };
    const sensitiveResponse = {
        status: "FAILED",
        code: "PROVIDER_REJECTED",
        message: "customer@example.test must-not-log",
        error: { secretKey: "response-secret-must-not-log" },
        orderId: "ORDER-MUST-NOT-LOG",
        qr: "000201QR-PAYLOAD-MUST-NOT-LOG",
        amount: 34740,
        currency: "MMK",
        transactionRefId: "TX-MUST-NOT-LOG",
        vendorQrRefId: "VENDOR-MUST-NOT-LOG",
        customer: "CUSTOMER-MUST-NOT-LOG",
        data: { reason: "not-enumerated", credential: "not-enumerated" },
        result: { outcome: "not-enumerated" },
        ["x".repeat(120)]: true
    };
    const diagnostic = myanMyanPayClientTest.responseShapeDiagnostic(sensitiveResponse, diagnosticConfiguration);
    assert.strictEqual(diagnostic.classification, "ERROR_SHAPED_OBJECT");
    assert(diagnostic.topLevelKeys.length <= 24 && diagnostic.topLevelKeys.every(key => key.length <= 80), "diagnostic property-name arrays must be bounded");
    assert.deepStrictEqual(diagnostic.dataKeys, ["reason", "credential"], "nested diagnostics enumerate data property names only");
    assert.deepStrictEqual(diagnostic.resultKeys, ["outcome"], "nested diagnostics enumerate result property names only");
    assert.strictEqual(diagnostic.safeStatus, "FAILED");
    assert.strictEqual(diagnostic.safeCode, "PROVIDER_REJECTED");
    assert.strictEqual(diagnostic.hasMessage, true);
    assert.strictEqual(diagnostic.apiBaseUrlOrigin, "https://sandbox.example.test");
    assert.strictEqual(diagnostic.apiBaseUrlPath, "/payments");
    assert.strictEqual(diagnostic.apiBaseUrlAlreadyContainsPaymentsPath, true);
    assert.deepStrictEqual(diagnostic.sdkSandboxKeyClassification, { publishableKeyLooksSandbox: true, secretKeyLooksSandbox: true, sdkWouldUseSandbox: true });
    const serializedDiagnostic = JSON.stringify(diagnostic);
    for (const forbidden of [diagnosticConfiguration.appId, diagnosticConfiguration.publishableKey, diagnosticConfiguration.secretKey, "must-not-log", "ORDER-MUST-NOT-LOG", "000201QR-PAYLOAD-MUST-NOT-LOG", "34740", "MMK", "TX-MUST-NOT-LOG", "VENDOR-MUST-NOT-LOG", "CUSTOMER-MUST-NOT-LOG", "customer@example.test"]) {
        assert(!serializedDiagnostic.includes(forbidden), `diagnostic must redact sensitive value: ${forbidden}`);
    }
    assert.strictEqual(myanMyanPayClientTest.safePrimitive("https://secret.example/token"), null, "URL-like primitive diagnostics must be redacted");
    assert.strictEqual(myanMyanPayClientTest.safePrimitive("eyJhbGciOiJIUzI1NiJ9.payload.signature"), null, "JWT-like primitive diagnostics must be redacted");
    assert.strictEqual(myanMyanPayClientTest.safePrimitive("A".repeat(90)), null, "long opaque primitive diagnostics must be redacted");
    assert.strictEqual(myanMyanPayClientTest.safePrimitive("safe-status-".repeat(9)).length, 80, "safe diagnostic primitives must be bounded");
    assert.strictEqual(myanMyanPayClientTest.classifyResponseShape(new Error("secret")), "ERROR_INSTANCE");
    assert.strictEqual(myanMyanPayClientTest.classifyResponseShape({ error: true }), "ERROR_SHAPED_OBJECT");
    assert.strictEqual(myanMyanPayClientTest.classifyResponseShape({ status: "PENDING", orderId: "PAY-1", qr: "QR", amount: 1, currency: "MMK" }), "DOCUMENTED_SUCCESS_SHAPE");
    assert.strictEqual(myanMyanPayClientTest.classifyResponseShape({ status: "PENDING", orderId: "PAY-1" }), "SUCCESS_SHAPED_MISSING_FIELDS");
    assert.strictEqual(myanMyanPayClientTest.classifyResponseShape("provider-error"), "NON_OBJECT_RESPONSE");
    assert.strictEqual(myanMyanPayClientTest.configurationShape({ apiBaseUrl: "https://sandbox.example.test/api", publishableKey: "pk_live", secretKey: "sk_test_value" }).apiBaseUrlAlreadyContainsPaymentsPath, false);
    assert.deepStrictEqual(myanMyanPayClientTest.configurationShape({ apiBaseUrl: "https://sandbox.example.test", publishableKey: "pk_live", secretKey: "sk_test_value" }).sdkSandboxKeyClassification, { publishableKeyLooksSandbox: false, secretKeyLooksSandbox: true, sdkWouldUseSandbox: true });

    const capturedLogs = [];
    const diagnosticClient = createMyanMyanPayClient(diagnosticConfiguration, {
        sdk: { async pay() { return sensitiveResponse; } },
        logger: { info(...args) { capturedLogs.push(args); } }
    });
    await assert.rejects(() => diagnosticClient.pay(createPayload), error => error.code === "MYANMYANPAY_PROVIDER_REJECTED", "resolved provider errors must retain a safe structured classification");
    assert.strictEqual(capturedLogs.length, 1, "exactly one response-shape diagnostic must be emitted");
    assert.strictEqual(capturedLogs[0][0], "[MYANMYANPAY_RESPONSE_SHAPE]");
    assert.notStrictEqual(capturedLogs[0][1], sensitiveResponse, "raw provider response must never be logged");
    assert(!JSON.stringify(capturedLogs).includes("must-not-log"), "diagnostic log must contain no raw response or credential values");
    const validResponse = { status: "PENDING", orderId: PROVIDER_ORDER_ID, qr: "000201010212MMQR", amount: 1, currency: "MMK" };
    const loggerFailureClient = createMyanMyanPayClient(configuration, { sdk: { async pay() { return validResponse; } }, logger: { info() { throw new Error("logger unavailable"); } } });
    assert.deepStrictEqual(await loggerFailureClient.pay({ orderId: PROVIDER_ORDER_ID, amount: 1, currency: "MMK", callbackUrl: CALLBACK_URL }), { ...validResponse, vendorQrRefId: "", transactionRefId: "", url: "" }, "diagnostic logging failure must not change successful payment behavior");

    const getConfiguration = { ...configuration, apiBaseUrl: "https://sandbox.example.test/api" };
    const documentedGetResponse = status => ({ orderId: "ORDER-MUST-NOT-LOG", appId: "APP-MUST-NOT-LOG", amount: 34740, status, method: "QR", condition: "PRISTINE" });
    for (const status of ["PENDING", "SUCCESS", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED"]) {
        assert.strictEqual(myanMyanPayClientTest.classifyGetResponseShape(documentedGetResponse(status)), "DOCUMENTED_PAYMENT_SHAPE", `${status} must be recognized as a documented GET payment shape without requiring QR or currency`);
    }
    assert.strictEqual(myanMyanPayClientTest.classifyGetResponseShape(new Error("must-not-log")), "ERROR_INSTANCE");
    assert.strictEqual(myanMyanPayClientTest.classifyGetResponseShape({ code: "AUTH_FAILED", message: "must-not-log" }), "ERROR_SHAPED_OBJECT");
    assert.strictEqual(myanMyanPayClientTest.classifyGetResponseShape({ orderId: "PAY-1", amount: 1, status: "PENDING", message: "must-not-log" }), "ERROR_SHAPED_OBJECT");
    assert.strictEqual(myanMyanPayClientTest.classifyGetResponseShape({ orderId: "PAY-1", status: "PENDING" }), "SUCCESS_SHAPED_MISSING_FIELDS");
    assert.strictEqual(myanMyanPayClientTest.classifyGetResponseShape("must-not-log"), "NON_OBJECT_RESPONSE");
    assert.strictEqual(myanMyanPayClientTest.safeErrorName(new Error("must-not-log")), "ERROR");
    assert.strictEqual(myanMyanPayClientTest.safeErrorName(new TypeError("must-not-log")), "TYPE_ERROR");
    const abortError = new Error("must-not-log"); abortError.name = "AbortError";
    const customError = new Error("must-not-log"); customError.name = "SecretCustomError";
    assert.strictEqual(myanMyanPayClientTest.safeErrorName(abortError), "ABORT_ERROR");
    assert.strictEqual(myanMyanPayClientTest.safeErrorName(customError), "UNKNOWN_ERROR");
    const allowedCauseError = new TypeError("secret transport message must-not-log", { cause: { code: "ECONNRESET", secret: "cause-secret-must-not-log" } });
    const unknownCauseError = new TypeError("secret transport message must-not-log", { cause: { code: "SECRET_OPAQUE_CAUSE", secret: "cause-secret-must-not-log" } });
    assert.strictEqual(myanMyanPayClientTest.safeCauseCode(allowedCauseError), "ECONNRESET");
    assert.strictEqual(myanMyanPayClientTest.safeCauseCode(unknownCauseError), "UNKNOWN", "unknown native-fetch cause codes must be reduced to a fixed enum");
    const createFetchError = new TypeError("secret create message must-not-log");
    createFetchError.stack = "TypeError: secret create message must-not-log\n    at async MMPaySdkClass.pay (/app/node_modules/mmpay-node-sdk/dist/cjs/index.js:160:30)";
    const createBodyError = new TypeError("secret body message must-not-log");
    createBodyError.stack = "TypeError: secret body message must-not-log\n    at async MMPaySdkClass.pay (/app/node_modules/mmpay-node-sdk/dist/cjs/index.js:171:26)";
    assert.strictEqual(myanMyanPayClientTest.safeCreatePhase(createFetchError), "CREATE_FETCH");
    assert.strictEqual(myanMyanPayClientTest.safeCreatePhase(createBodyError), "CREATE_RESPONSE_BODY");
    assert.strictEqual(myanMyanPayClientTest.safeCreatePhase(new TypeError("secret")), "UNKNOWN_CREATE_PHASE");
    assert.strictEqual(myanMyanPayClientTest.safeCodePrimitive("AUTH_FAILED"), "AUTH_FAILED");
    assert.strictEqual(myanMyanPayClientTest.safeCodePrimitive("unsafe code with spaces"), null);
    assert.strictEqual(myanMyanPayClientTest.safeCodePrimitive("A".repeat(81)), null);
    assert.strictEqual(myanMyanPayClientTest.safeCodePrimitive(1234567890123), null);
    assert.strictEqual(myanMyanPayClientTest.safeHttpStatus(401), 401);
    assert.strictEqual(myanMyanPayClientTest.safeHttpStatus("503"), 503);
    assert.strictEqual(myanMyanPayClientTest.safeHttpStatus("FAILED"), null);

    const handshakeLogs = [];
    const handshakeResult = { token: "BTOKEN-MUST-NOT-LOG", message: "handshake-message-must-not-log" };
    let handshakeCalls = 0;
    let handshakeThis = null;
    let wrapperReturnedValue = null;
    const instrumentedSdk = {
        async handShake(...args) {
            handshakeCalls += 1;
            handshakeThis = this;
            assert.deepStrictEqual(args, [{ orderId: "ORDER-MUST-NOT-LOG", nonce: "NONCE-MUST-NOT-LOG" }]);
            return handshakeResult;
        },
        async pay() {
            wrapperReturnedValue = await this.handShake({ orderId: "ORDER-MUST-NOT-LOG", nonce: "NONCE-MUST-NOT-LOG" });
            return validCreateResponse;
        }
    };
    const instrumentedClient = createMyanMyanPayClient(configuration, { sdk: instrumentedSdk, logger: { info(...args) { handshakeLogs.push(args); } } });
    await instrumentedClient.pay(createPayload);
    assert.strictEqual(handshakeCalls, 1, "instrumentation must not invoke handshake separately or retry it");
    assert.strictEqual(handshakeThis, instrumentedSdk, "instrumentation must preserve the SDK method this binding");
    assert.strictEqual(wrapperReturnedValue, handshakeResult, "instrumentation must return the exact original handshake value");
    const handshakeLog = handshakeLogs.find(([tag]) => tag === "[MYANMYANPAY_HANDSHAKE_SHAPE]");
    assert(handshakeLog, "instrumented SDK handshake must emit its bounded diagnostic");
    assert.deepStrictEqual(handshakeLog[1], {
        provider: "MYANMYANPAY", environment: "SANDBOX", classification: "TOKEN_PRESENT", safeErrorName: "",
        tokenPresent: true, sdkSandboxSelected: true, endpointPath: "/payments/sandbox-handshake"
    });
    assert.deepStrictEqual(myanMyanPayClientTest.handshakeShapeDiagnostic({ token: "LIVE-TOKEN-MUST-NOT-LOG" }, { publishableKey: "pk_live_value", secretKey: "sk_live_value" }), {
        provider: "MYANMYANPAY", environment: "PRODUCTION", classification: "TOKEN_PRESENT", safeErrorName: "",
        tokenPresent: true, sdkSandboxSelected: false, endpointPath: "/payments/handshake"
    }, "live credentials must produce only the fixed Production handshake path and environment metadata");
    const serializedHandshakeLogs = JSON.stringify(handshakeLogs);
    for (const forbidden of ["BTOKEN-MUST-NOT-LOG", "handshake-message-must-not-log", "ORDER-MUST-NOT-LOG", "NONCE-MUST-NOT-LOG"]) assert(!serializedHandshakeLogs.includes(forbidden), `handshake diagnostics must redact ${forbidden}`);

    const handshakeErrorLogs = [];
    const returnedHandshakeError = new TypeError("handshake-secret-must-not-log", { cause: { code: "ENOTFOUND", secret: "must-not-log" } });
    const returnedCreateError = new TypeError("create-secret-must-not-log", { cause: { code: "SECRET_CAUSE_MUST_NOT_LOG" } });
    returnedCreateError.stack = "TypeError: create-secret-must-not-log\n    at async MMPaySdkClass.pay (/app/node_modules/mmpay-node-sdk/dist/cjs/index.js:160:30)";
    let errorHandshakeCalls = 0;
    const errorSdk = {
        async handShake() { errorHandshakeCalls += 1; return returnedHandshakeError; },
        async pay() { assert.strictEqual(await this.handShake({}), returnedHandshakeError); return returnedCreateError; }
    };
    const errorDiagnosticClient = createMyanMyanPayClient(configuration, { sdk: errorSdk, logger: { info(...args) { handshakeErrorLogs.push(args); } } });
    await assert.rejects(() => errorDiagnosticClient.pay(createPayload), error => error.code === "MYANMYANPAY_SDK_RETURNED_ERROR");
    assert.strictEqual(errorHandshakeCalls, 1);
    const boundedHandshakeError = handshakeErrorLogs.find(([tag]) => tag === "[MYANMYANPAY_HANDSHAKE_SHAPE]")[1];
    assert.deepStrictEqual(boundedHandshakeError, {
        provider: "MYANMYANPAY", environment: "SANDBOX", classification: "ERROR_INSTANCE", safeErrorName: "TYPE_ERROR",
        safeCauseCode: "ENOTFOUND", tokenPresent: false, sdkSandboxSelected: true, endpointPath: "/payments/sandbox-handshake"
    });
    const boundedCreateError = handshakeErrorLogs.find(([tag]) => tag === "[MYANMYANPAY_RESPONSE_SHAPE]")[1];
    assert.strictEqual(boundedCreateError.safeCauseCode, "UNKNOWN");
    assert.strictEqual(boundedCreateError.createPhase, "CREATE_FETCH");
    for (const forbidden of ["handshake-secret-must-not-log", "create-secret-must-not-log", "SECRET_CAUSE_MUST_NOT_LOG", "must-not-log", "stack", "headers", "body"]) {
        assert(!JSON.stringify(handshakeErrorLogs).toLowerCase().includes(forbidden.toLowerCase()), `error diagnostics must not emit ${forbidden}`);
    }

    let loggerFailureHandshakeCalls = 0;
    const loggerFailureHandshakeResult = { token: "LOGGER-FAILURE-TOKEN-MUST-NOT-LOG" };
    const loggerFailureSdk = {
        async handShake() { loggerFailureHandshakeCalls += 1; return loggerFailureHandshakeResult; },
        async pay() { assert.strictEqual(await this.handShake({}), loggerFailureHandshakeResult); return validCreateResponse; }
    };
    const loggerFailureInstrumentedClient = createMyanMyanPayClient(configuration, { sdk: loggerFailureSdk, logger: { info() { throw new Error("logger unavailable"); } } });
    assert.strictEqual((await loggerFailureInstrumentedClient.pay(createPayload)).status, "PENDING", "handshake diagnostic failure must not change SDK/payment behavior");
    assert.strictEqual(loggerFailureHandshakeCalls, 1);

    const thrownHandshakeError = new TypeError("thrown-handshake-secret-must-not-log", { cause: { code: "ETIMEDOUT" } });
    let thrownHandshakeCalls = 0;
    let observedThrownHandshakeError = null;
    const throwingHandshakeSdk = {
        async handShake() { thrownHandshakeCalls += 1; throw thrownHandshakeError; },
        async pay() {
            try { await this.handShake({}); }
            catch (error) { observedThrownHandshakeError = error; throw error; }
        }
    };
    const thrownHandshakeLogs = [];
    const throwingHandshakeClient = createMyanMyanPayClient(configuration, { sdk: throwingHandshakeSdk, logger: { info(...args) { thrownHandshakeLogs.push(args); } } });
    await assert.rejects(() => throwingHandshakeClient.pay(createPayload), error => error.code === "MYANMYANPAY_SDK_OPERATION_FAILED");
    assert.strictEqual(thrownHandshakeCalls, 1);
    assert.strictEqual(observedThrownHandshakeError, thrownHandshakeError, "instrumentation must rethrow the exact original handshake exception");
    assert.strictEqual(thrownHandshakeLogs.find(([tag]) => tag === "[MYANMYANPAY_HANDSHAKE_SHAPE]")[1].safeCauseCode, "ETIMEDOUT");
    assert(!JSON.stringify(thrownHandshakeLogs).includes("thrown-handshake-secret-must-not-log"));

    const safeGetUrl = myanMyanPayClientTest.safeUrlShape(getConfiguration);
    assert.deepStrictEqual(safeGetUrl, {
        apiBaseUrlOrigin: "https://sandbox.example.test",
        apiBaseUrlPath: "/api",
        apiBaseUrlAlreadyContainsPaymentsPath: false,
        sdkSandboxSelected: true,
        endpointPath: "/api/payments/sandbox-get",
        handshakeEndpointPath: "/api/payments/sandbox-handshake"
    });
    const duplicatePaymentsUrl = myanMyanPayClientTest.safeUrlShape({ ...getConfiguration, apiBaseUrl: "https://sandbox.example.test/api/payments/" });
    assert.strictEqual(duplicatePaymentsUrl.apiBaseUrlAlreadyContainsPaymentsPath, true);
    assert.strictEqual(duplicatePaymentsUrl.endpointPath, "/api/payments/payments/sandbox-get", "diagnostic must reveal the SDK's exact duplicate path construction");
    for (const unsafeUrl of ["https://user:password@sandbox.example.test/api", "https://sandbox.example.test/api?token=must-not-log", "https://sandbox.example.test/api#must-not-log", `https://sandbox.example.test/${"a".repeat(81)}`]) {
        const shape = myanMyanPayClientTest.safeUrlShape({ ...getConfiguration, apiBaseUrl: unsafeUrl });
        assert.strictEqual(shape.endpointPath, "", "unsafe URL components and unbounded paths must not be exposed");
        assert.strictEqual(shape.handshakeEndpointPath, "", "unsafe URL components and unbounded paths must not be exposed");
    }

    const getErrorResponse = {
        code: "AUTH_FAILED",
        statusCode: 401,
        message: "customer@example.test must-not-log",
        error: { token: "must-not-log" },
        orderId: "ORDER-MUST-NOT-LOG",
        amount: 34740,
        currency: "MMK",
        qr: "QR-MUST-NOT-LOG",
        appId: "APP-MUST-NOT-LOG",
        transactionRefId: "TX-MUST-NOT-LOG",
        vendorQrRefId: "VENDOR-QR-MUST-NOT-LOG",
        vendor: "VENDOR-MUST-NOT-LOG",
        customer: "CUSTOMER-MUST-NOT-LOG",
        ["x".repeat(81)]: "must-not-log"
    };
    const getLogs = [];
    let getCalls = 0;
    const getDiagnosticClient = createMyanMyanPayClient(getConfiguration, {
        sdk: { async get(input) { getCalls += 1; assert.deepStrictEqual(input, { orderId: PROVIDER_ORDER_ID }); return getErrorResponse; } },
        logger: { info(...args) { getLogs.push(args); } }
    });
    await assert.rejects(() => getDiagnosticClient.get({ orderId: PROVIDER_ORDER_ID }), error => error.code === "MYANMYANPAY_PROVIDER_REJECTED", "GET wrapper must reject resolved error-shaped values");
    assert.strictEqual(getCalls, 1, "GET wrapper must call sdk.get exactly once");
    assert.strictEqual(getLogs.length, 1, "GET wrapper must emit exactly one diagnostic");
    assert.strictEqual(getLogs[0][0], "[MYANMYANPAY_GET_RESPONSE_SHAPE]");
    const getDiagnostic = getLogs[0][1];
    assert.notStrictEqual(getDiagnostic, getErrorResponse, "GET diagnostic must never log the raw provider response");
    const allowedGetDiagnosticFields = new Set(["provider", "operation", "httpMethod", "stage", "classification", "responseType", "isNull", "isArray", "isErrorInstance", "safeErrorName", "topLevelKeys", "dataKeys", "resultKeys", "statusType", "safeStatus", "safeCode", "httpLikeStatus", "hasOrderId", "hasStatus", "hasQr", "hasAmount", "hasCurrency", "hasCode", "hasError", "hasMessage", "apiBaseUrlOrigin", "apiBaseUrlPath", "apiBaseUrlAlreadyContainsPaymentsPath", "sdkSandboxSelected", "sdkSandboxKeyClassification", "endpointPath", "handshakeEndpointPath"]);
    assert(Object.keys(getDiagnostic).every(key => allowedGetDiagnosticFields.has(key)), "GET diagnostic must contain only approved fields");
    assert.strictEqual(getDiagnostic.classification, "ERROR_SHAPED_OBJECT");
    assert.strictEqual(getDiagnostic.safeCode, "AUTH_FAILED");
    assert.strictEqual(getDiagnostic.httpLikeStatus, 401);
    assert(getDiagnostic.topLevelKeys.length <= 24 && getDiagnostic.topLevelKeys.every(key => key.length <= 80 && /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(key)), "GET property names must be safe and bounded");
    const serializedGetDiagnostic = JSON.stringify(getDiagnostic);
    for (const forbidden of [getConfiguration.appId, getConfiguration.publishableKey, getConfiguration.secretKey, "must-not-log", "ORDER-MUST-NOT-LOG", "34740", "MMK", "QR-MUST-NOT-LOG", "APP-MUST-NOT-LOG", "TX-MUST-NOT-LOG", "VENDOR-QR-MUST-NOT-LOG", "VENDOR-MUST-NOT-LOG", "CUSTOMER-MUST-NOT-LOG", "customer@example.test"]) {
        assert(!serializedGetDiagnostic.includes(forbidden), `GET diagnostic must redact sensitive/raw value: ${forbidden}`);
    }

    const thrownGetError = new TypeError("secret thrown message must-not-log");
    const thrownGetLogs = [];
    let thrownGetCalls = 0;
    const thrownGetClient = createMyanMyanPayClient(getConfiguration, { sdk: { async get() { thrownGetCalls += 1; throw thrownGetError; } }, logger: { info(...args) { thrownGetLogs.push(args); } } });
    await assert.rejects(() => thrownGetClient.get({ orderId: SECOND_PROVIDER_ORDER_ID }), error => error.code === "MYANMYANPAY_SDK_OPERATION_FAILED" && error.metadata.classification === "THROWN_EXCEPTION", "GET wrapper must classify thrown SDK errors");
    assert.strictEqual(thrownGetCalls, 1);
    const thrownGetShapeLogs = thrownGetLogs.filter(entry => entry[0] === "[MYANMYANPAY_GET_RESPONSE_SHAPE]");
    assert.strictEqual(thrownGetShapeLogs.length, 1, "thrown GET must emit exactly one GET response-shape diagnostic");
    assert.strictEqual(thrownGetShapeLogs[0][1].classification, "ERROR_INSTANCE");
    assert.strictEqual(thrownGetShapeLogs[0][1].safeErrorName, "TYPE_ERROR");
    assert(!JSON.stringify(thrownGetLogs).includes("must-not-log"), "thrown GET diagnostic must not expose the error message");
    const getLoggerFailureValue = documentedGetResponse("PENDING");
    let loggerFailureGetCalls = 0;
    const getLoggerFailureClient = createMyanMyanPayClient(getConfiguration, { sdk: { async get() { loggerFailureGetCalls += 1; return { ...getLoggerFailureValue, orderId: PROVIDER_ORDER_ID }; } }, logger: { info() { throw new Error("logger unavailable"); } } });
    assert.strictEqual((await getLoggerFailureClient.get({ orderId: PROVIDER_ORDER_ID })).status, "PENDING", "GET logger failure must not alter returned behavior");
    assert.strictEqual(loggerFailureGetCalls, 1);
    const getLoggerThrowOriginal = new Error("original SDK failure");
    const getLoggerThrowClient = createMyanMyanPayClient(getConfiguration, { sdk: { async get() { throw getLoggerThrowOriginal; } }, logger: { info() { throw new Error("logger unavailable"); } } });
    await assert.rejects(() => getLoggerThrowClient.get({ orderId: PROVIDER_ORDER_ID }), error => error.code === "MYANMYANPAY_SDK_OPERATION_FAILED", "GET logger failure must not suppress SDK error classification");

    function reconciliationHarness(providerResponse) {
        const state = {
            attempt: { attemptId: "PAY-RECON-1", orderId: "AZL-RECON-1", subjectType: "COMMERCE_ORDER", subjectId: "AZL-RECON-1", ownerId: "user-1", owner: { type: "USER", userId: "user-1" }, provider: "MYANMYANPAY", paymentMethod: "myanmyanpay_mmqr", paymentMethodId: "myanmyanpay_mmqr", paymentChannel: "MYANMYANPAY_MMQR", confirmationMode: "provider_webhook", amount: 34740, currency: "MMK", region: "MM", status: "INITIATING", providerReference: PROVIDER_ORDER_ID, providerTransactionId: "", qr: null, safeMetadata: { environment: "SANDBOX", appId: "APP-TEST" } },
            order: { orderId: "AZL-RECON-1", status: "pending_payment", paymentStatus: "unpaid", payment: { provider: "MYANMYANPAY", paymentMethodId: "myanmyanpay_mmqr", paymentChannel: "MYANMYANPAY_MMQR", status: "unpaid" }, commercial: { amount: 34740, totalAmount: 34740, currency: "MMK", region: "MM" } },
            calls: { get: 0, pay: 0, setReference: 0, attemptStatus: 0, orderPayment: 0, orderStatus: 0, createAttempt: 0, createOrder: 0, fulfillment: 0 }
        };
        const paymentAttemptRepository = {
            async findAttemptById() { return { ...state.attempt }; },
            async setProviderReference(input) { state.calls.setReference += 1; Object.assign(state.attempt, { providerReference: input.providerReference, providerTransactionId: input.providerTransactionId, rawProviderStatus: input.rawProviderStatus, qr: input.qr, paymentInstructions: input.paymentInstructions, safeMetadata: input.safeMetadata }); return { ...state.attempt }; },
            async updateStatus(input) { state.calls.attemptStatus += 1; assert(input.fromStatuses.includes(state.attempt.status)); state.attempt.status = input.toStatus; return { ...state.attempt }; },
            async createAttempt() { state.calls.createAttempt += 1; throw new Error("must not create attempt"); }
        };
        const commerceOrderRepository = {
            async findOrderById() { return { ...state.order, payment: { ...state.order.payment } }; },
            async updatePaymentStatus(input) { state.calls.orderPayment += 1; assert(input.fromStatuses.includes(state.order.paymentStatus)); state.order.paymentStatus = input.toStatus; state.order.payment.status = input.toStatus; return { ...state.order, payment: { ...state.order.payment } }; },
            async updateOrderStatus(input) { state.calls.orderStatus += 1; assert(input.fromStatuses.includes(state.order.status)); state.order.status = input.toStatus; return { ...state.order, payment: { ...state.order.payment } }; },
            async createOrderRecord() { state.calls.createOrder += 1; throw new Error("must not create order"); }
        };
        const sdk = {
            async get(input) { state.calls.get += 1; assert.deepStrictEqual(input, { orderId: state.attempt.providerReference }, "reconciliation get must use the persisted provider order ID"); return typeof providerResponse === "function" ? providerResponse(state) : providerResponse; },
            async pay() { state.calls.pay += 1; throw new Error("pay must never be called by reconciliation"); }
        };
        const service = createManualPaymentApplicationService({
            paymentAttemptRepository,
            commerceOrderRepository,
            transactionRunner: callback => callback({}),
            myanMyanPayConfigurationProvider: async () => configuration,
            providerOptions: { myanMyanPayClientOptions: { sdk, logger: { info() {} } } },
            paidFulfillmentHandler: async () => { state.calls.fulfillment += 1; }
        });
        return { state, service };
    }

    for (const response of [() => { throw new Error("handshake failed"); }, new Error("network"), { code: "PROVIDER_ERROR", message: "rejected" }, null, { status: "PENDING" }, { orderId: "WRONG", amount: 34740, currency: "MMK", method: "QR", status: "PENDING" }, { orderId: PROVIDER_ORDER_ID, amount: 34741, currency: "MMK", method: "QR", status: "PENDING" }, { orderId: PROVIDER_ORDER_ID, amount: 34740, currency: "MMK", method: "QR", status: "UNKNOWN" }]) {
        const { state, service } = reconciliationHarness(response);
        const result = await service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1", actor: { id: "admin-1" } });
        assert.strictEqual(result.stateChanged, false, "error, malformed, mismatched and unknown results must not mutate state");
        assert.deepStrictEqual({ setReference: state.calls.setReference, attemptStatus: state.calls.attemptStatus, orderPayment: state.calls.orderPayment, orderStatus: state.calls.orderStatus, pay: state.calls.pay }, { setReference: 0, attemptStatus: 0, orderPayment: 0, orderStatus: 0, pay: 0 });
    }

    const pendingHarness = reconciliationHarness({ orderId: PROVIDER_ORDER_ID, amount: 34740, currency: "MMK", appId: configuration.appId, method: "QR", vendor: "KBZPay", status: "PENDING", transactionRefId: "TX-1", vendorQrRefId: "QR-1", qr: "000201010212MMQR" });
    const pendingResult = await pendingHarness.service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1" });
    assert.strictEqual(pendingResult.resultingAttemptStatus, "PENDING");
    assert.strictEqual(pendingResult.qrRecovered, true);
    assert.strictEqual(pendingResult.providerSuccessObserved, false);
    assert.strictEqual(pendingHarness.state.order.paymentStatus, "pending");
    assert.strictEqual(pendingHarness.state.order.status, "pending_payment", "PENDING reconciliation must not settle the CommerceOrder");
    assert(!JSON.stringify(pendingResult).includes("000201010212MMQR") && !Object.prototype.hasOwnProperty.call(pendingResult, "qr"), "reconciliation response must not expose provider QR or raw response data");
    const repeatedPending = await pendingHarness.service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1" });
    assert.strictEqual(repeatedPending.stateChanged, false, "repeated PENDING reconciliation must be idempotent");
    assert.strictEqual(pendingHarness.state.calls.setReference, 1, "repeated reconciliation must not rewrite recovered provider data");

    const successHarness = reconciliationHarness({ orderId: PROVIDER_ORDER_ID, amount: 34740, currency: "MMK", appId: configuration.appId, method: "QR", status: "SUCCESS", transactionRefId: "TX-SUCCESS" });
    const successResult = await successHarness.service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1" });
    assert.strictEqual(successResult.providerSuccessObserved, true);
    assert.strictEqual(successResult.settlementAuthority, "AUTHENTICATED_CALLBACK");
    assert.strictEqual(successResult.stateChanged, false);
    assert.strictEqual(successHarness.state.attempt.status, "INITIATING");
    assert.strictEqual(successHarness.state.order.paymentStatus, "unpaid");
    assert.strictEqual(successHarness.state.calls.fulfillment, 0, "SUCCESS reconciliation must never trigger fulfillment");

    const refundedHarness = reconciliationHarness({ orderId: PROVIDER_ORDER_ID, amount: 34740, currency: "MMK", appId: configuration.appId, method: "QR", status: "REFUNDED" });
    const refundedResult = await refundedHarness.service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1" });
    assert.strictEqual(refundedResult.reconciliationOutcome, "PROVIDER_REFUNDED_OBSERVED");
    assert.strictEqual(refundedResult.stateChanged, false, "REFUNDED observation must remain non-mutating until refund lifecycle support exists");

    const notFoundHarness = reconciliationHarness({ code: "NOT_FOUND", message: "not found" });
    const notFoundResult = await notFoundHarness.service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1" });
    assert.strictEqual(notFoundResult.reconciliationOutcome, "NOT_FOUND_INCONCLUSIVE");
    assert.strictEqual(notFoundResult.stateChanged, false);
    const thrownNotFound = Object.assign(new Error("not found"), { code: "MYANMYANPAY_PROVIDER_REJECTED", httpStatus: 404, providerCode: "NOT_FOUND" });
    const thrownNotFoundHarness = reconciliationHarness(() => { throw thrownNotFound; });
    const thrownNotFoundResult = await thrownNotFoundHarness.service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1" });
    assert.strictEqual(thrownNotFoundResult.reconciliationOutcome, "NOT_FOUND_INCONCLUSIVE");
    assert.strictEqual(thrownNotFoundResult.stateChanged, false, "transport not-found must remain non-mutating");

    for (const [providerStatus, attemptStatus, orderPayment, orderStatus] of [["FAILED", "FAILED", "failed", "payment_failed"], ["CANCELLED", "CANCELLED", "cancelled", "cancelled"], ["EXPIRED", "EXPIRED", "expired", "expired"]]) {
        const harness = reconciliationHarness({ orderId: PROVIDER_ORDER_ID, amount: 34740, currency: "MMK", appId: configuration.appId, method: "QR", status: providerStatus });
        const result = await harness.service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1" });
        assert.strictEqual(result.resultingAttemptStatus, attemptStatus);
        assert.strictEqual(harness.state.order.paymentStatus, orderPayment);
        assert.strictEqual(harness.state.order.status, orderStatus);
        assert.strictEqual(harness.state.calls.pay, 0);
        assert.strictEqual(harness.state.calls.createAttempt, 0);
        assert.strictEqual(harness.state.calls.createOrder, 0);
        assert.strictEqual(harness.state.calls.fulfillment, 0);
    }

    const root = path.resolve(__dirname, "../..");
    const paymentRouteSource = fs.readFileSync(path.join(root, "backend/routes/paymentMethods.js"), "utf8");
    const adminPaymentSource = fs.readFileSync(path.join(root, "frontend/js/admin-payments.js"), "utf8");
    const adminUsersSource = fs.readFileSync(path.join(root, "backend/routes/adminUsers.js"), "utf8");
    const paymentEngineSource = fs.readFileSync(path.join(root, "frontend/js/payment/payment-engine.js"), "utf8");
    const paymentPageHtmlSource = fs.readFileSync(path.join(root, "frontend/payment.html"), "utf8");
    const mmPaymentShellSource = fs.readFileSync(path.join(root, "frontend/js/payment/mm-payment-shell.js"), "utf8");
    const mmqrLifecycleSource = fs.readFileSync(path.join(root, "frontend/js/payment/myanmyanpay-qr-lifecycle.js"), "utf8");
    const paymentPageRuntimeSource = fs.readFileSync(path.join(root, "frontend/js/payment-page-runtime.js"), "utf8");
    const orderRouteSource = fs.readFileSync(path.join(root, "backend/routes/order.js"), "utf8");
    const customerCheckoutSource = fs.readFileSync(path.join(root, "backend/services/commerce/customerManualPaymentCheckoutService.js"), "utf8");
    const myanMyanPayClientSource = fs.readFileSync(path.join(root, "backend/services/myanmyanpay/myanMyanPayClient.js"), "utf8");
    const paymentOrchestratorSource = fs.readFileSync(path.join(root, "backend/services/commerce/paymentOrchestrator.js"), "utf8");
    const paymentAttemptModelSource = fs.readFileSync(path.join(root, "backend/models/PaymentAttempt.js"), "utf8");
    const sdkTypesSource = fs.readFileSync(path.join(root, "node_modules/mmpay-node-sdk/src/types.ts"), "utf8");
    assert(myanMyanPayClientSource.includes('const { MMPaySDK } = require("mmpay-node-sdk")'), "official SDK must be the protocol implementation");
    assert(myanMyanPayClientSource.includes('await sdk[operation.toLowerCase()](input)'), "provider operations must delegate through the SDK boundary");
    assert(!myanMyanPayClientSource.includes("createMyanMyanPayTransport") && !fs.existsSync(path.join(root, "backend/services/myanmyanpay/myanMyanPayTransport.js")), "superseded custom transport must be removed");
    const prepareAttemptIndex = paymentOrchestratorSource.indexOf("await adapter.prepareAttempt");
    const persistAttemptIndex = paymentOrchestratorSource.indexOf("const initiatingAttempt = await runTransaction", prepareAttemptIndex);
    const providerPayIndex = paymentOrchestratorSource.indexOf("await adapter.createPayment", persistAttemptIndex);
    assert(prepareAttemptIndex >= 0 && persistAttemptIndex > prepareAttemptIndex && providerPayIndex > persistAttemptIndex, "provider order ID must be generated and persisted before provider pay");
    assert(paymentOrchestratorSource.includes("providerReference: normalizeString(preparedAttempt?.providerReference)"), "prepared provider order ID must be persisted on PaymentAttempt");
    const runtimeWindow = {
        addEventListener() {},
        setInterval() { return 1; },
        clearInterval() {},
        setTimeout() { return 1; },
        clearTimeout() {},
        AZIEL_PAYMENT_SESSION_AUTHORITY: null,
        AZIEL_LOCALE: { t(key, fallback) { return fallback; } }
    };
    vm.runInNewContext(paymentPageRuntimeSource, {
        window: runtimeWindow,
        document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
        sessionStorage: { getItem() { return null; }, removeItem() {} },
        localStorage: { getItem() { return null; } },
        URLSearchParams,
        console,
        fetch: async () => { throw new Error("polling must not execute while loading verifier helpers"); }
    });
    const statusSync = runtimeWindow.AZIEL_PAYMENT_PAGE._test;
    const exactStatusStaged = { session: { provider: "MYANMYANPAY", paymentMethod: "myanmyanpay_mmqr", paymentChannel: "MYANMYANPAY_MMQR", confirmationMode: "provider_webhook", commerceOrderId: "AZL-1", attemptId: "PAY-1" } };
    assert.deepStrictEqual({ ...statusSync.myanMyanPayIdentity(exactStatusStaged) }, { orderId: "AZL-1", attemptId: "PAY-1" }, "status polling must require the exact MyanMyanPay MMQR identity");
    for (const mutation of [{ provider: "DINGER" }, { paymentMethod: "thunder_promptpay" }, { paymentChannel: "THUNDER_PROMPTPAY" }, { confirmationMode: "manual_admin" }, { commerceOrderId: "" }, { attemptId: "" }]) {
        assert.strictEqual(statusSync.myanMyanPayIdentity({ session: { ...exactStatusStaged.session, ...mutation } }), null, "non-MyanMyanPay and incomplete identities must not start polling");
    }
    for (const order of [{ paymentStatus: "paid", status: "pending_payment" }, { paymentStatus: "pending", status: "paid" }, { paymentStatus: "pending", status: "processing" }, { paymentStatus: "pending", status: "completed" }]) {
        assert.strictEqual(statusSync.classifyMyanMyanPayServerState(order).kind, "success", "paid/processing/completed server state must render success");
    }
    for (const status of ["failed", "cancelled", "expired"]) assert.deepStrictEqual({ ...statusSync.classifyMyanMyanPayServerState({ paymentStatus: status, status }) }, { kind: "terminal", orderStatus: status });
    for (const status of ["pending_payment", "pending", "unpaid", "initiating"]) assert.strictEqual(statusSync.classifyMyanMyanPayServerState({ paymentStatus: status, status: "pending_payment" }).kind, "pending", "pending server state must preserve the QR");
    assert(paymentPageRuntimeSource.includes("/api/order/status/${encodeURIComponent(identity.orderId)}"), "MyanMyanPay polling must use the authenticated canonical order-status endpoint");
    assert(paymentPageRuntimeSource.includes('{ method: "GET", headers, credentials: "same-origin", cache: "no-store" }'), "status polling must use same-origin session credentials and bypass caches");
    assert(!paymentPageRuntimeSource.includes("if (!headers.Authorization)"), "cookie-authenticated polling must not require a legacy browser Bearer token");
    assert(paymentPageRuntimeSource.includes('returnedOrderId !== identity.orderId') && paymentPageRuntimeSource.includes('returnedProvider !== "MYANMYANPAY"') && paymentPageRuntimeSource.includes('returnedAttemptId !== identity.attemptId'), "polling responses must fail closed on order, provider, and attempt mismatches");
    assert(!paymentPageRuntimeSource.includes("MYANMYANPAY_STATUS_MAX_POLLS") && !paymentPageRuntimeSource.includes("MYANMYANPAY_STATUS_MAX_CONSECUTIVE_READ_FAILURES"), "status observation must not terminate on a fixed poll or transient-failure count");
    assert(paymentPageRuntimeSource.includes("MYANMYANPAY_STATUS_RETRY_DELAYS_MS") && paymentPageRuntimeSource.includes("myanMyanPayStatusRequestInFlight"), "polling retries must be delay-bounded and non-overlapping");
    assert(paymentPageRuntimeSource.includes("paid: true") && paymentPageRuntimeSource.includes("paymentReceived: true") && paymentPageRuntimeSource.includes("showCompletion({"), "authoritative success must use the existing successful completion presentation");
    assert(paymentPageRuntimeSource.includes('updateMyanMyanPayTerminal(result.orderStatus)') && paymentPageRuntimeSource.includes('qrSection.hidden = true'), "failed, cancelled, and expired states must stop using the stale QR without mutating payment state");
    assert(paymentPageRuntimeSource.includes("Waiting for payment") && paymentPageRuntimeSource.includes("We'll confirm your payment automatically."), "pending and observation uncertainty must retain the quiet automatic-confirmation state");
    assert(!paymentPageRuntimeSource.includes("updateMyanMyanPayInconclusive") && !paymentPageRuntimeSource.includes("Check Payment Status") && !paymentPageRuntimeSource.includes("Awaiting confirmation"), "customer payment UX must expose no inconclusive state or manual status control");
    assert(!paymentPageRuntimeSource.includes("checkMyanMyanPayStatusOnce") && !paymentPageRuntimeSource.includes('updateMyanMyanPayTerminal("unknown")'), "observation uncertainty must not become a customer-managed or terminal state");
    assert(paymentPageRuntimeSource.includes('window.addEventListener("online", wakeMyanMyanPayStatusPolling)') && paymentPageRuntimeSource.includes('document.addEventListener("visibilitychange"'), "online and visible pages must resume observation");
    assert(orderRouteSource.includes('res.setHeader("Cache-Control", "no-store, max-age=0")'), "authenticated canonical order status must be non-cacheable");
    assert(!paymentPageRuntimeSource.includes("createCommerceManualPaymentCheckout") && !paymentPageRuntimeSource.includes("resumeOrRetryManualPayment"), "status observation UX must never create or retry a payment");
    assert(!paymentPageRuntimeSource.includes("/api/payment/status/") && !paymentPageRuntimeSource.includes("myanmyanpay-reconcile") && !paymentPageRuntimeSource.includes("MMPay.get"), "browser polling must not use legacy, reconciliation, or provider endpoints");
    assert(!/expiresAt|expiry|ttl|validUntil/i.test(sdkTypesSource), "installed MyanMyanPay SDK response contract must not be treated as supplying an authoritative expiry when it does not");
    assert(paymentAttemptModelSource.includes("createdAt: { type: Date, required: true, immutable: true }"), "MMQR timer authority must be the persisted immutable PaymentAttempt creation timestamp");
    assert(customerCheckoutSource.includes('initiatedAt: payment.initiatedAt || ""'), "customer session must preserve the server-projected PaymentAttempt initiation timestamp");
    assert(paymentPageHtmlSource.includes("payment-page-runtime.js?v=20261001-mmqr-cookie-status-1") && paymentPageHtmlSource.includes("myanmyanpay-qr-lifecycle.js?v=20261001-mmqr-expiry-1") && paymentPageHtmlSource.includes("mm-payment-shell.js?v=20261001-mmqr-expiry-1") && paymentPageHtmlSource.includes("mm-payment-shell.css?v=20261001-mmqr-expiry-1"), "payment page must load the cache-busted status runtime and shared MMQR expiry assets");

    function paymentStatusHarness(responses = [], options = {}) {
        const timers = [];
        const clearedTimers = new Set();
        const listeners = {};
        const documentListeners = {};
        const nodesById = new Map();
        let authAction = null;
        let completionRenders = 0;
        let shellRenders = 0;
        let fetchCalls = 0;
        let lastRequest = null;
        let timerId = 0;
        const classList = () => ({ values: new Set(), add(name) { this.values.add(name); }, remove(name) { this.values.delete(name); }, toggle(name, active) { if (active) this.values.add(name); else this.values.delete(name); } });
        const makeNode = tag => ({
            tag, textContent: "", className: "", id: "", href: "", hidden: false, dataset: {}, children: [], classList: classList(),
            append(...children) { this.children.push(...children); if (children.some(child => child?.dataset?.myanmyanpayAuthAction)) authAction = children.find(child => child?.dataset?.myanmyanpayAuthAction); },
            replaceChildren(...children) { this.children = children; if (this.id === "paymentSessionMount" && children[0]?.className === "checkout-card payment-completion") completionRenders += 1; },
            setAttribute(name, value) { this[name] = String(value); },
            addEventListener() {},
            querySelector(selector) {
                if (selector === "[data-myanmyanpay-auth-action]") return authAction;
                if (selector === "[data-myanmyanpay-terminal-action]") return null;
                return null;
            },
            remove() { if (this === authAction) authAction = null; }
        });
        const mount = makeNode("section"); mount.id = "paymentSessionMount";
        const statusNode = makeNode("p");
        const qrSection = makeNode("section");
        const shell = makeNode("section");
        for (const id of ["paymentStatusSummary", "paymentOrderId", "paymentProduct", "paymentPackage", "paymentAccount", "paymentMethodSummary", "paymentAmount", "paymentPageTitle", "paymentRedirectCountdown", "trackOrderNow", "paymentBackHome"]) {
            const node = makeNode("span"); node.id = id; nodesById.set(id, node);
        }
        nodesById.set("paymentSessionMount", mount);
        const document = {
            visibilityState: "visible",
            addEventListener(name, callback) { documentListeners[name] = callback; },
            createElement: makeNode,
            getElementById(id) { return nodesById.get(id) || null; },
            querySelector(selector) {
                if (selector === ".mm-payment-shell .checkout-feedback[role='status']") return statusNode;
                if (selector === ".mm-payment-shell__qr-section") return qrSection;
                if (selector === ".mm-payment-shell") return shell;
                if (selector === "[data-myanmyanpay-auth-action]") return authAction;
                return null;
            }
        };
        const runtimeWindow = {
            AZIEL_LOCALE: { t(key, fallback) { return fallback; } },
            AZIEL_PAYMENT_SESSION_AUTHORITY: null,
            PaymentUtils: { authHeaders() { return options.auth === false ? {} : { Authorization: "Bearer test-token" }; }, apiUrl(pathname) { return pathname; } },
            AZIEL_MM_PAYMENT_SHELL: { show() { shellRenders += 1; } },
            location: { replace() {} },
            addEventListener(name, callback) { listeners[name] = callback; },
            setTimeout(callback, delay) { const id = ++timerId; timers.push({ id, callback, delay }); return id; },
            clearTimeout(id) { clearedTimers.add(id); },
            setInterval() { return ++timerId; }, clearInterval() {}
        };
        const sessionStorage = { removeItem() {}, getItem() { return null; } };
        const fetch = async (_url, request) => {
            fetchCalls += 1;
            lastRequest = request;
            assert.strictEqual(request.method, "GET");
            assert.strictEqual(request.credentials, "same-origin");
            assert.strictEqual(request.cache, "no-store");
            const next = responses.shift();
            if (next instanceof Error) throw next;
            return next || { ok: true, status: 200, async json() { return { success: true, order: { orderId: "AZL-1", commerceOrderId: "AZL-1", commercePaymentAttemptId: "PAY-1", paymentProvider: "MYANMYANPAY", paymentStatus: "pending", orderStatus: "pending_payment" } }; } };
        };
        vm.runInNewContext(paymentPageRuntimeSource, { window: runtimeWindow, document, sessionStorage, localStorage: { getItem() { return null; } }, URLSearchParams, console, fetch, Date });
        const api = runtimeWindow.AZIEL_PAYMENT_PAGE._test;
        const staged = { session: { provider: "MYANMYANPAY", paymentMethod: "myanmyanpay_mmqr", paymentChannel: "MYANMYANPAY_MMQR", confirmationMode: "provider_webhook", commerceOrderId: "AZL-1", attemptId: "PAY-1", initiatedAt: options.initiatedAt || new Date().toISOString(), amount: 3573, currency: "MMK" }, orderData: {} };
        const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
        const runNextTimer = async () => {
            let timer = timers.shift();
            while (timer && clearedTimers.has(timer.id)) timer = timers.shift();
            assert(timer, "a retry timer must be scheduled");
            timer.callback();
            await flush();
            return timer.delay;
        };
        return { api, staged, listeners, documentListeners, document, qrSection, statusNode, shell, nodesById, flush, runNextTimer, get fetchCalls() { return fetchCalls; }, get completionRenders() { return completionRenders; }, get shellRenders() { return shellRenders; }, get lastRequest() { return lastRequest; }, get authAction() { return authAction; } };
    }

    const pendingResponse = () => ({ ok: true, status: 200, async json() { return { success: true, order: { orderId: "AZL-1", commerceOrderId: "AZL-1", commercePaymentAttemptId: "PAY-1", paymentProvider: "MYANMYANPAY", paymentStatus: "pending", orderStatus: "pending_payment" } }; } });
    const paidResponse = () => ({ ok: true, status: 200, async json() { return { success: true, order: { orderId: "AZL-1", commerceOrderId: "AZL-1", commercePaymentAttemptId: "PAY-1", paymentProvider: "MYANMYANPAY", paymentStatus: "paid", orderStatus: "processing", amount: 3573, currency: "MMK" } }; } });

    const recoveryHarness = paymentStatusHarness([new Error("offline"), paidResponse()]);
    assert.strictEqual(recoveryHarness.api.myanMyanPayRetryDelay(1), 3000);
    assert.strictEqual(recoveryHarness.api.myanMyanPayRetryDelay(999), 30000, "transient retry delay must remain bounded");
    assert.strictEqual(recoveryHarness.api.startMyanMyanPayStatusPolling(recoveryHarness.staged), true);
    await recoveryHarness.flush();
    assert.strictEqual(await recoveryHarness.runNextTimer(), 3000, "first transient retry must use the bounded minimum delay");
    assert.strictEqual(recoveryHarness.fetchCalls, 2, "a transient read failure must recover through another authenticated GET");
    assert.strictEqual(recoveryHarness.completionRenders, 1, "authoritative paid/processing must replace the QR with completion exactly once");
    assert.strictEqual(recoveryHarness.api.wakeMyanMyanPayStatusPolling(), false, "terminal success must leave no observer to duplicate the transition");
    assert.strictEqual(recoveryHarness.completionRenders, 1);

    const visibilityHarness = paymentStatusHarness([pendingResponse(), paidResponse()]);
    visibilityHarness.api.startMyanMyanPayStatusPolling(visibilityHarness.staged);
    await visibilityHarness.flush();
    visibilityHarness.document.visibilityState = "visible";
    visibilityHarness.documentListeners.visibilitychange();
    await visibilityHarness.flush();
    assert.strictEqual(visibilityHarness.fetchCalls, 2, "returning to a visible tab must immediately resume observation");
    assert.strictEqual(visibilityHarness.completionRenders, 1);

    const onlineHarness = paymentStatusHarness([pendingResponse(), paidResponse()]);
    onlineHarness.api.startMyanMyanPayStatusPolling(onlineHarness.staged);
    await onlineHarness.flush();
    onlineHarness.listeners.online();
    await onlineHarness.flush();
    assert.strictEqual(onlineHarness.completionRenders, 1, "online recovery must observe authoritative success");

    for (const mismatch of [
        { commerceOrderId: "OTHER" },
        { paymentProvider: "DINGER" },
        { commercePaymentAttemptId: "OTHER" }
    ]) {
        const mismatchResponse = { ok: true, status: 200, async json() { return { success: true, order: { orderId: "AZL-1", commerceOrderId: "AZL-1", commercePaymentAttemptId: "PAY-1", paymentProvider: "MYANMYANPAY", paymentStatus: "paid", orderStatus: "processing", ...mismatch } }; } };
        const mismatchHarness = paymentStatusHarness([mismatchResponse]);
        mismatchHarness.api.startMyanMyanPayStatusPolling(mismatchHarness.staged);
        await mismatchHarness.flush();
        assert.strictEqual(mismatchHarness.completionRenders, 0, "order, provider, and attempt identity mismatches must never trigger success");
        assert.strictEqual(await mismatchHarness.runNextTimer(), 3000, "identity mismatch must remain fail-closed while observation retries");
    }

    const expiredHarness = paymentStatusHarness([pendingResponse()], { initiatedAt: "2000-01-01T00:00:00.000Z" });
    expiredHarness.api.startMyanMyanPayStatusPolling(expiredHarness.staged);
    await expiredHarness.flush();
    assert.strictEqual(expiredHarness.qrSection.dataset.myanmyanpayQrExpired, "true", "elapsed UI time must mark the existing QR expired");
    assert.strictEqual(expiredHarness.fetchCalls, 1, "expired QR presentation must continue read-only order observation");
    assert.strictEqual(expiredHarness.api.myanMyanPayIdentity(expiredHarness.staged).orderId, "AZL-1", "expiry must not replace the original order identity");

    const cookieSessionHarness = paymentStatusHarness([paidResponse()], { auth: false });
    cookieSessionHarness.api.startMyanMyanPayStatusPolling(cookieSessionHarness.staged);
    await cookieSessionHarness.flush();
    assert.strictEqual(cookieSessionHarness.fetchCalls, 1, "a cookie-authenticated customer without a browser Bearer token must issue the status GET");
    assert.strictEqual(cookieSessionHarness.lastRequest.credentials, "same-origin");
    assert.strictEqual(cookieSessionHarness.completionRenders, 1, "matching paid/processing state must replace the QR with Payment Successful exactly once");
    assert.strictEqual(cookieSessionHarness.nodesById.get("paymentStatusSummary").textContent, "Paid", "authoritative success must update Order Summary to Paid");

    const recoveredHarness = paymentStatusHarness([paidResponse()], { auth: false });
    assert.strictEqual(recoveredHarness.api.showRecovered({ ...recoveredHarness.staged.session, region: "MM", paymentName: "MMQR" }), true);
    await recoveredHarness.flush();
    assert.strictEqual(recoveredHarness.shellRenders, 1, "valid recovered MMQR must render its existing payment presentation");
    assert.strictEqual(recoveredHarness.fetchCalls, 1, "valid recovered MMQR must start read-only status observation");
    assert.strictEqual(recoveredHarness.completionRenders, 1, "recovered MMQR must observe authoritative success without creating another payment");

    for (const status of [401, 403]) {
        const expiredAuthHarness = paymentStatusHarness([{ ok: false, status, async json() { return {}; } }], { auth: false });
        expiredAuthHarness.api.startMyanMyanPayStatusPolling(expiredAuthHarness.staged);
        await expiredAuthHarness.flush();
        assert.strictEqual(expiredAuthHarness.fetchCalls, 1);
        assert(expiredAuthHarness.authAction && expiredAuthHarness.completionRenders === 0, "backend 401/403 must offer recoverable sign-in without implying success");
        assert.strictEqual(await expiredAuthHarness.runNextTimer(), 3000, "authentication-required observation must remain recoverable");
    }
    assert(paymentRouteSource.includes('requireAdminPermission(PERMISSIONS.PAYMENT_METHODS_MANAGE)'), "tester lookup remains payment-management authorized");
    assert(paymentRouteSource.includes('authorizedTesterCustomerIds'), "activation must accept customer-facing tester IDs");
    assert(paymentRouteSource.includes('MYANMYANPAY_PUBLIC_NOT_READY') && paymentRouteSource.includes('decision.publicReady'), "PUBLIC must fail closed behind Production readiness");
    assert(paymentRouteSource.includes('MYANMYANPAY_CANONICAL_IDENTITY_INVALID'), "canonical identity must fail closed");
    assert(adminPaymentSource.includes('myanmyanpay_mmqr: { key: "myanmyanpay_mmqr"'), "Admin provider catalog must include MyanMyanPay");
    assert(adminPaymentSource.includes('Use the MyanMyanPay activation control'), "generic enable toggle must remain locked");
    assert(adminPaymentSource.includes('PUBLIC — locked'), "PUBLIC must remain visibly locked until ready");
    assert(adminPaymentSource.includes('authorizedTesterCustomerIds'), "Admin activation must submit customer IDs, not ObjectIds");
    assert(adminUsersSource.includes('{ customerId: { $regex:'), "Admin Users must search customerId");
    const commerceRoutesSource = fs.readFileSync(path.join(root, "backend/routes/commerceManualPaymentRoutes.js"), "utf8");
    assert(commerceRoutesSource.includes('"/admin/payment-attempts/:attemptId/myanmyanpay-reconcile"'), "Admin reconciliation route must remain registered");
    assert(commerceRoutesSource.includes("requireAdminPermission(PERMISSIONS.ORDERS_MANAGE)"), "Admin reconciliation must require order-management permission");
    assert(mmPaymentShellSource.includes('providerAttribution.textContent = "Payment Powered by MyanMyanPay"'), "mandatory MyanMyanPay attribution must remain exact and unlocalized");
    const myanMyanPayEngineBranch = paymentEngineSource.slice(
        paymentEngineSource.indexOf("if (isMyanMyanPaySelection(selectedPayment, orderData))"),
        paymentEngineSource.indexOf("if (isDingerSelection(selectedPayment, orderData))")
    );
    assert(myanMyanPayEngineBranch.includes("createCommerceManualPaymentCheckout(orderData)"), "MyanMyanPay continuation must use Commerce checkout");
    assert(myanMyanPayEngineBranch.includes('stagePaymentPage(session, attemptOrder, selectedPayment, "auto")'), "MyanMyanPay must stage the canonical payment page");
    assert(!myanMyanPayEngineBranch.includes("createPaymentSession") && !myanMyanPayEngineBranch.includes("createManualAttempt"), "MyanMyanPay must never use legacy payable creation");
    assert(paymentEngineSource.includes('PaymentUtils.apiUrl("/api/commerce/checkout/manual-payment")'), "MyanMyanPay Commerce continuation endpoint must remain canonical");
    assert(paymentEngineSource.includes("body: JSON.stringify(orderData)"), "Commerce continuation must preserve the review request body, including reviewQuoteId and checkoutKey");
    assert(customerCheckoutSource.includes("quoteId = text(input.reviewQuoteId)"), "Commerce checkout must require the server-issued review quote");
    assert(customerCheckoutSource.includes("seed = text(input.checkoutKey || input.orderId)"), "Commerce checkout must preserve the stable checkout identity");
    assert(customerCheckoutSource.includes('idempotencyKey: `checkout:${seed}`'), "CommerceOrder creation must remain checkout-key idempotent");
    assert(customerCheckoutSource.includes('idempotencyKey: `manual:${seed}`'), "PaymentAttempt creation must remain checkout-key idempotent");
    const methodLoadIndex = customerCheckoutSource.indexOf("const method = await loadManualPaymentMethod");
    const checkoutCreateIndex = customerCheckoutSource.indexOf("checkoutResult = await");
    assert(methodLoadIndex >= 0 && checkoutCreateIndex > methodLoadIndex, "TEST_ONLY method authorization must complete before CommerceOrder creation");
    assert(customerCheckoutSource.includes("myanMyanPayAccessDecision(method, user || {}).allowed === true"), "MyanMyanPay TEST_ONLY authorization must remain server-enforced");
    assert(customerCheckoutSource.includes("amount: payment.amount, currency: payment.currency"), "staged amount and currency must come from the server PaymentAttempt");
    assert(mmPaymentShellSource.includes('String(session.provider || payment.provider || "").toUpperCase() === "MYANMYANPAY"'), "payment page must require exact MyanMyanPay provider identity");
    assert(mmPaymentShellSource.includes('String(session.paymentMethod || payment.key || "").toLowerCase() === "myanmyanpay_mmqr"'), "payment page must require canonical MyanMyanPay method");
    assert(mmPaymentShellSource.includes('String(session.paymentChannel || payment.paymentChannel || "").toUpperCase() === "MYANMYANPAY_MMQR"'), "payment page must require canonical MyanMyanPay channel");
    assert(adminPaymentSource.includes('method.logoUrl || getAdminPaymentLogo(method)') && mmPaymentShellSource.includes('const methodLogoUrl = value(payment.logoUrl, payment.logo)') && mmPaymentShellSource.includes('logo.src = methodLogoUrl'), "customer MMQR presentation must reuse the same PaymentMethod logoUrl source preferred by Admin");
    assert(!mmPaymentShellSource.includes("/assets/payment/mmqr-logo.svg") && !mmPaymentShellSource.includes("MMQR_LOGO_ASSET"), "customer MMQR presentation must not retain an invented logo asset path");
    assert(mmPaymentShellSource.includes('"Pay with MMQR"') && mmPaymentShellSource.includes('"Scan the MMQR"'), "MMQR must be the primary customer-facing payment identity");
    assert(!mmPaymentShellSource.includes('"Pay with MyanMyanPay / MMQR"'), "provider implementation name must not be the primary customer-facing heading");
    assert(mmqrLifecycleSource.includes("Scan and complete your payment before the timer ends."), "MMQR presentation must explain the active validity window");
    assert(mmPaymentShellSource.includes("saveDisplayedQr(qrSource") && mmPaymentShellSource.includes("download.href = qrSource") && !mmPaymentShellSource.includes("fetch(qrSource"), "Save QR must download the displayed provider QR without provider or regeneration calls");
    assert(mmPaymentShellSource.includes("!myanMyanPay && deepLink"), "MyanMyanPay presentation must not expose deep-link behavior");
    assert(mmqrLifecycleSource.includes("Your payment will be confirmed automatically."), "MyanMyanPay presentation must remain automatic and callback-authoritative");
    const shellWindow = {
        AZIEL_LOCALE: { t(key, fallback) { return fallback; } },
        AZIEL_I18N: { getLang() { return "en"; } },
        addEventListener() {}, setInterval() { throw new Error("real timer must not run in verifier"); }, clearInterval() {}
    };
    const shellDocument = { documentElement: { lang: "en" } };
    vm.runInNewContext(mmqrLifecycleSource, { window: shellWindow, document: shellDocument, Date, Object });
    vm.runInNewContext(mmPaymentShellSource, { window: shellWindow, document: shellDocument, sessionStorage: { removeItem() {} }, Date, MutationObserver: undefined });
    const timer = shellWindow.AZIEL_MM_PAYMENT_SHELL._test;
    const initiatedAt = "2026-09-30T00:00:00.000Z";
    const initiatedAtMs = new Date(initiatedAt).getTime();
    assert.strictEqual(timer.durationMs, 15 * 60 * 1000);
    assert.deepStrictEqual({ ...timer.countdownState(initiatedAt, initiatedAtMs) }, { valid: true, expired: false, remainingSeconds: 900, deadlineMs: initiatedAtMs + 15 * 60 * 1000 }, "initial display must derive from the authoritative initiation timestamp");
    assert.strictEqual(timer.countdownState(initiatedAt, initiatedAtMs + 5 * 60 * 1000).remainingSeconds, 600, "refresh/re-entry must continue the original absolute window instead of resetting it");
    assert.strictEqual(timer.countdownState(initiatedAt, initiatedAtMs + 14 * 60 * 1000 + 59 * 1000).remainingSeconds, 1);
    assert.deepStrictEqual({ ...timer.countdownState(initiatedAt, initiatedAtMs + 60 * 60 * 1000) }, { valid: true, expired: true, remainingSeconds: 0, deadlineMs: initiatedAtMs + 15 * 60 * 1000 }, "background time jumps must recalculate and clamp at zero");
    assert.strictEqual(timer.formatCountdown(900), "15:00");
    assert.strictEqual(timer.formatCountdown(-1), "00:00");
    let nowMs = initiatedAtMs, scheduledTick = null, scheduledCount = 0, clearedCount = 0;
    const classNames = new Set();
    const timerNode = { isConnected: true, textContent: "", classList: { add(name) { classNames.add(name); }, toggle(name, active) { if (active) classNames.add(name); else classNames.delete(name); } } };
    timer.startMyanMyanPayCountdown(timerNode, initiatedAt, {
        now: () => nowMs,
        setInterval(callback, delay) { assert.strictEqual(delay, 1000); scheduledCount += 1; scheduledTick = callback; return 19; },
        clearInterval(id) { assert.strictEqual(id, 19); clearedCount += 1; }
    });
    assert.strictEqual(timerNode.textContent, "Pay within 15:00");
    assert.strictEqual(scheduledCount, 1, "only one countdown interval may be scheduled");
    timer.startMyanMyanPayCountdown(timerNode, initiatedAt, {
        now: () => nowMs,
        setInterval(callback) { scheduledCount += 1; scheduledTick = callback; return 19; },
        clearInterval(id) { assert.strictEqual(id, 19); clearedCount += 1; }
    });
    assert.strictEqual(scheduledCount, 2);
    assert.strictEqual(clearedCount, 1, "starting a replacement countdown must clear the prior interval");
    nowMs += 10 * 60 * 1000;
    scheduledTick();
    assert.strictEqual(timerNode.textContent, "Pay within 05:00", "timer ticks must derive from absolute time rather than decrementing memory");
    nowMs += 20 * 60 * 1000;
    scheduledTick();
    assert.strictEqual(timerNode.textContent, "00:00");
    assert(classNames.has("is-expired"));
    assert.strictEqual(clearedCount, 2, "elapsed UI timer must clean its interval");
    assert(!/fetch\s*\(|cancel(?:Payment)?\s*\(|paymentStatus\s*=|orderStatus\s*=/.test(mmPaymentShellSource), "MMQR timer shell must contain no network, cancellation, or authoritative-state mutation path");
    assert(mmPaymentShellSource.includes('fresh.href = "/checkout"') && mmPaymentShellSource.includes('sessionStorage.removeItem("azielPaymentPageSession")'), "expired Commerce MMQR must explicitly return to fresh checkout without retrying the old attempt");
    assert(mmPaymentShellSource.includes('section?.classList.add("is-mmqr-expired")') && mmPaymentShellSource.includes("view.expiredOverlay.hidden = false"), "expired Commerce MMQR must activate the anti-scan shell");
    assert(!mmPaymentShellSource.includes("Generate New QR") && !mmPaymentShellSource.includes("resumeOrRetryManualPayment"), "expired Commerce MMQR must not expose in-place QR replacement");
    assert(mmPaymentShellSource.includes("Payment QR is unavailable. Do not send payment"), "missing provider QR must fail visibly");
    const myanMyanPayPresentationBranch = mmPaymentShellSource.slice(mmPaymentShellSource.indexOf("if (isMyanMyanPay(staged)) {", mmPaymentShellSource.indexOf("const deepLink")), mmPaymentShellSource.indexOf("const receiptEnabled"));
    assert(!myanMyanPayPresentationBranch.includes("submitReceipt") && !myanMyanPayPresentationBranch.includes("Submit Payment"), "MyanMyanPay presentation must expose no manual submission action");

    const calls = [];
    const adapter = createMyanMyanPayAdapter({ configuration, providerOrderIdFactory: () => PROVIDER_ORDER_ID, client: { async pay(payload) { calls.push(payload); return { orderId: payload.orderId, amount: payload.amount, currency: "MMK", status: "PENDING", vendorQrRefId: "QR-1", qr: "000201010212MMQR" }; } } });
    const preparedAttempt = await adapter.prepareAttempt({ intent: { orderId: "ORDER-1" }, attempt: { attemptId: "PAY-1" } });
    assert.strictEqual(preparedAttempt.providerReference, PROVIDER_ORDER_ID, "adapter must generate the dedicated provider order ID before attempt creation");
    assert.notStrictEqual(preparedAttempt.providerReference, "PAY-1", "provider order ID must remain distinct from the PaymentAttempt ID");
    const created = await adapter.createPayment({ intent: { orderId: "ORDER-1", amount: 1500, currency: "MMK", paymentMethodId: "myanmyanpay_mmqr", items: [] }, attempt: { attemptId: "PAY-1", providerReference: preparedAttempt.providerReference } });
    assert.strictEqual(created.status, "PENDING", "creation remains pending");
    assert.strictEqual(calls[0].amount, 1500, "authoritative integer MMK amount sent");
    assert.strictEqual(calls[0].orderId, PROVIDER_ORDER_ID, "SDK pay must use the persisted provider order ID");
    assert.strictEqual(calls[0].callbackUrl, CALLBACK_URL);
    assert(created.qr.image.startsWith("data:image/png;base64,"), "MMQR rendered as safe image");
    assert(!JSON.stringify(created).includes(configuration.secretKey), "secret never enters normalized result");
    const timestampProjection = createManualPaymentApplicationService().toSafePaymentView({
        order: { orderId: "AZL-1" },
        attempt: { attemptId: "PAY-1", createdAt: initiatedAt },
        paymentResult: { attemptId: "PAY-1", createdAt: "2099-01-01T00:00:00.000Z" }
    });
    assert.strictEqual(timestampProjection.initiatedAt, initiatedAt, "customer-safe projection must prefer persisted PaymentAttempt.createdAt over transient result timestamps");
    const checkoutSession = sessionFrom({
        checkout: { orderId: "AZL-1", quoteId: "QUOTE-1", region: "MM", productName: "Game", packageName: "Package" },
        payment: { attemptId: "PAY-1", paymentStatus: "pending", provider: "MYANMYANPAY", amount: 34740, currency: "MMK", initiatedAt, qr: created.qr, paymentInstructions: created.paymentInstructions },
        method: { key: "myanmyanpay_mmqr", method: "MyanMyanPay / MMQR", paymentType: "auto", paymentChannel: "MYANMYANPAY_MMQR", confirmationMode: "provider_webhook" }
    });
    assert.deepStrictEqual({
        commerceOrderId: checkoutSession.commerceOrderId,
        attemptId: checkoutSession.attemptId,
        initiatedAt: checkoutSession.initiatedAt,
        provider: checkoutSession.provider,
        paymentChannel: checkoutSession.paymentChannel,
        confirmationMode: checkoutSession.confirmationMode,
        qrImage: checkoutSession.qrImage,
        qrPayload: checkoutSession.qrPayload,
        amount: checkoutSession.amount,
        currency: checkoutSession.currency
    }, {
        commerceOrderId: "AZL-1", attemptId: "PAY-1", initiatedAt, provider: "MYANMYANPAY", paymentChannel: "MYANMYANPAY_MMQR",
        confirmationMode: "provider_webhook", qrImage: created.qr.image, qrPayload: created.qr.payload, amount: 34740, currency: "MMK"
    }, "Commerce session must preserve the provider QR presentation contract");

    const attempt = { attemptId: "PAY-1", provider: "MYANMYANPAY", providerReference: PROVIDER_ORDER_ID, providerTransactionId: PROVIDER_ORDER_ID, paymentMethodId: "myanmyanpay_mmqr", amount: 1500, currency: "MMK", status: "PENDING", safeMetadata: { environment: "SANDBOX", appId: "APP-TEST", vendorQrRefId: "QR-1" } };
    const baseEvent = { provider: "MYANMYANPAY", providerReference: PROVIDER_ORDER_ID, providerTransactionId: "TX-1", providerEventId: "EVT-1", environment: "SANDBOX", appId: "APP-TEST", vendor: "KBZPay", method: "QR", condition: "PRISTINE", vendorQrRefId: "QR-1", amount: 1500, currency: "MMK" };
    for (const [rawProviderStatus, expected] of [["PENDING", "PENDING"], ["SUCCESS", "PAID"], ["FAILED", "FAILED"], ["CANCELLED", "CANCELLED"], ["EXPIRED", "EXPIRED"], ["REFUNDED", "REFUNDED"]]) {
        const event = await adapter.handleProviderEvent({ providerEvent: { ...baseEvent, rawProviderStatus }, attempt, intent: {}, trustedOperational: true });
        assert.strictEqual(event.status, expected, `${rawProviderStatus} mapping`);
    }
    for (const mutation of [{ amount: 1501 }, { currency: "USD" }, { provider: "DINGER" }, { environment: "PRODUCTION" }, { providerReference: "UNKNOWN" }, { method: "PIN" }]) {
        await assert.rejects(() => adapter.handleProviderEvent({ providerEvent: { ...baseEvent, rawProviderStatus: "SUCCESS", ...mutation }, attempt, intent: {}, trustedOperational: true }));
    }

    const callback = validateCallback({ orderId: PROVIDER_ORDER_ID, amount: 1500, currency: "MMK", vendor: "KBZPay", method: "QR", status: "SUCCESS", condition: "PRISTINE", transactionRefId: "TX-1", vendorQrRefId: "QR-1" });
    assert.strictEqual(callback.orderId, PROVIDER_ORDER_ID, "callback lookup input must preserve the dedicated provider order ID");
    assert.strictEqual(eventId(callback), eventId({ ...callback }), "callback replay identity is deterministic");
    assert.throws(() => validateCallback({ ...callback, status: "UNKNOWN" }));
    assert.throws(() => validateCallback({ ...callback, orderId: "paymentAttempt-1790691957504-f9776f58" }), "callback lookup must reject a PaymentAttempt ID in place of the provider order ID");

    let sdkListenCalls = 0;
    class FakeSdk extends EventEmitter {
        _generateSignature(payload, nonce) { return crypto.createHmac("sha256", "sdk-test").update(`${nonce}.${payload}`).digest("hex"); }
        async listen(payload) { sdkListenCalls += 1; this.emit("tx:success", JSON.parse(payload)); return this; }
    }
    const sdk = new FakeSdk();
    const client = createMyanMyanPayClient(configuration, { sdk });
    const payload = JSON.stringify(callback), nonce = "nonce-1", signature = sdk._generateSignature(payload, nonce);
    assert.deepStrictEqual(await client.verifyAndListen(payload, nonce, signature), callback, "valid SDK signature and nonce accepted");
    await assert.rejects(() => client.verifyAndListen(payload, "", signature), /authentication failed/);
    await assert.rejects(() => client.verifyAndListen(payload, "different-nonce", signature), /authentication failed/);
    await assert.rejects(() => client.verifyAndListen(payload, nonce, "bad"), /authentication failed/);
    assert.strictEqual(sdkListenCalls, 1, "signature mismatches must be rejected before SDK listen can reach its unsafe mismatch logger");

    const exactRawPayload = ` {\n  "status" : "SUCCESS",\n  "orderId" : "${PROVIDER_ORDER_ID}", "amount" : 1500,\n  "currency" : "MMK", "vendor" : "KBZPay", "method" : "QR",\n  "condition" : "PRISTINE", "transactionRefId" : "TX-RAW-1", "vendorQrRefId" : "QR-RAW-1"\n } `;
    const reorderedPayload = `{"vendorQrRefId":"QR-RAW-1","transactionRefId":"TX-RAW-1","condition":"PRISTINE","method":"QR","vendor":"KBZPay","currency":"MMK","amount":1500,"orderId":"${PROVIDER_ORDER_ID}","status":"SUCCESS"}`;
    const verifiedRawPayloads = [];
    const settledBodies = [];
    const seenCallbackEvents = new Set();
    let settlementMutations = 0;
    const callbackOptions = {
        configuration,
        client: {
            async verifyAndListen(value, nonceValue, signatureValue) {
                assert.strictEqual(nonceValue, "raw-nonce");
                assert.strictEqual(signatureValue, "raw-signature");
                verifiedRawPayloads.push(value);
                return JSON.parse(value);
            }
        },
        paymentService: {
            async applyMyanMyanPayCallback(input) {
                settlementMutations += 1;
                settledBodies.push(input.result);
                const duplicate = seenCallbackEvents.has(input.providerEventId);
                seenCallbackEvents.add(input.providerEventId);
                return { metadata: { duplicate } };
            }
        }
    };
    const headers = { "x-mmpay-nonce": "raw-nonce", "x-mmpay-signature": "raw-signature" };
    const first = await invokeRawCallback(exactRawPayload, headers, callbackOptions);
    assert.deepStrictEqual(first, { status: 200, data: { received: true, duplicate: false } });
    assert.strictEqual(verifiedRawPayloads[0], exactRawPayload, "verification must receive the exact whitespace and key order sent on the wire");
    assert.strictEqual(settledBodies[0].orderId, PROVIDER_ORDER_ID, "the independently parsed callback body must remain available to settlement validation");

    const duplicate = await invokeRawCallback(reorderedPayload, headers, callbackOptions);
    assert.deepStrictEqual(duplicate, { status: 200, data: { received: true, duplicate: true } }, "canonical callback replay identity must remain unchanged across JSON formatting differences");
    assert.strictEqual(verifiedRawPayloads[1], reorderedPayload, "a reordered payload must not be reconstructed before verification");

    const beforeFailures = settlementMutations;
    const missingRaw = await invokeRawCallback("", headers, callbackOptions);
    assert.strictEqual(missingRaw.status, 400);
    assert.strictEqual(missingRaw.data.code, "MYANMYANPAY_CALLBACK_RAW_BODY_MISSING");
    const missingNonce = await invokeRawCallback(reorderedPayload, { "x-mmpay-signature": "raw-signature" }, callbackOptions);
    assert.deepStrictEqual(missingNonce, { status: 401, data: { received: false, code: "MYANMYANPAY_CALLBACK_AUTH_MISSING" } });
    const missingSignature = await invokeRawCallback(reorderedPayload, { "x-mmpay-nonce": "raw-nonce" }, callbackOptions);
    assert.deepStrictEqual(missingSignature, { status: 401, data: { received: false, code: "MYANMYANPAY_CALLBACK_AUTH_MISSING" } });
    const invalidJson = await invokeRawCallback(`{"orderId":"${PROVIDER_ORDER_ID}"`, headers, callbackOptions);
    assert.strictEqual(invalidJson.status, 400);
    assert.strictEqual(invalidJson.data.code, "MYANMYANPAY_CALLBACK_JSON_INVALID");
    assert.strictEqual(settlementMutations, beforeFailures, "missing authentication, missing raw bytes, and invalid JSON must cause zero settlement mutation");

    let rejectedSettlementMutations = 0;
    const rejected = await invokeRawCallback(reorderedPayload, { "x-mmpay-nonce": "raw-nonce", "x-mmpay-signature": "invalid-signature" }, {
        configuration,
        client: { async verifyAndListen() { throw Object.assign(new Error("verification failed"), { code: "MYANMYANPAY_CALLBACK_SIGNATURE_INVALID", httpStatus: 401 }); } },
        paymentService: { async applyMyanMyanPayCallback() { rejectedSettlementMutations += 1; } }
    });
    assert.deepStrictEqual(rejected, { status: 401, data: { received: false, code: "MYANMYANPAY_CALLBACK_SIGNATURE_INVALID" } });
    assert.strictEqual(rejectedSettlementMutations, 0, "failed SDK verification must cause zero settlement mutation");

    let captured;
    const service = createManualPaymentApplicationService({ paymentOrchestrator: { async handleProviderEvent(input) { captured = input; return { paymentStatus: "paid", metadata: {} }; } } });
    await service.applyMyanMyanPayCallback({ result: callback, environment: "SANDBOX", appId: "APP-TEST", providerEventId: eventId(callback) });
    assert.strictEqual(captured.trustedOperational, true);
    assert.strictEqual(captured.providerEvent.provider, "MYANMYANPAY");
    assert.strictEqual(captured.providerEvent.status, "SUCCESS", "application boundary delegates provider status to adapter/orchestrator");
    assert.strictEqual(captured.verifiedTransactionRef, "TX-1", "transaction reuse protection binding supplied");

    console.log("MyanMyanPay sandbox integration verification passed (configuration, TEST_ONLY access, create, MMQR, SDK auth, bindings, status mapping, replay identity, orchestrator delegation).");
})().catch(error => { console.error(error); process.exitCode = 1; });
