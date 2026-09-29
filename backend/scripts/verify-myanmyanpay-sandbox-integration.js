"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { inspectMyanMyanPayConfiguration, loadMyanMyanPayConfiguration, CALLBACK_URL } = require("../services/myanmyanpay/myanMyanPayConfiguration");
const { createMyanMyanPayClient, _test: myanMyanPayClientTest } = require("../services/myanmyanpay/myanMyanPayClient");
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
const { sessionFrom } = require("../services/commerce/customerManualPaymentCheckoutService");
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
    await assert.rejects(() => diagnosticClient.pay({}), error => error.code === "MYANMYANPAY_CREATE_RESPONSE_INVALID", "temporary diagnostics must not change invalid-response behavior");
    assert.strictEqual(capturedLogs.length, 1, "exactly one response-shape diagnostic must be emitted");
    assert.strictEqual(capturedLogs[0][0], "[MYANMYANPAY_RESPONSE_SHAPE]");
    assert.notStrictEqual(capturedLogs[0][1], sensitiveResponse, "raw provider response must never be logged");
    assert(!JSON.stringify(capturedLogs).includes("must-not-log"), "diagnostic log must contain no raw response or credential values");
    const validResponse = { status: "PENDING", orderId: "PAY-1", qr: "QR", amount: 1, currency: "MMK" };
    const loggerFailureClient = createMyanMyanPayClient(configuration, { sdk: { async pay() { return validResponse; } }, logger: { info() { throw new Error("logger unavailable"); } } });
    assert.strictEqual(await loggerFailureClient.pay({}), validResponse, "diagnostic logging failure must not change successful payment behavior");

    function reconciliationHarness(providerResponse) {
        const state = {
            attempt: { attemptId: "PAY-RECON-1", orderId: "AZL-RECON-1", subjectType: "COMMERCE_ORDER", subjectId: "AZL-RECON-1", ownerId: "user-1", owner: { type: "USER", userId: "user-1" }, provider: "MYANMYANPAY", paymentMethod: "myanmyanpay_mmqr", paymentMethodId: "myanmyanpay_mmqr", paymentChannel: "MYANMYANPAY_MMQR", confirmationMode: "provider_webhook", amount: 34740, currency: "MMK", region: "MM", status: "INITIATING", providerReference: "", providerTransactionId: "", qr: null },
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
            async get(input) { state.calls.get += 1; assert.deepStrictEqual(input, { orderId: state.attempt.attemptId }, "reconciliation get must use the exact PaymentAttempt ID"); return typeof providerResponse === "function" ? providerResponse(state) : providerResponse; },
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

    for (const response of [() => { throw new Error("handshake failed"); }, new Error("network"), { code: "PROVIDER_ERROR", message: "rejected" }, null, { status: "PENDING" }, { orderId: "WRONG", amount: 34740, currency: "MMK", method: "QR", status: "PENDING" }, { orderId: "PAY-RECON-1", amount: 34741, currency: "MMK", method: "QR", status: "PENDING" }, { orderId: "PAY-RECON-1", amount: 34740, currency: "MMK", method: "QR", status: "UNKNOWN" }]) {
        const { state, service } = reconciliationHarness(response);
        const result = await service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1", actor: { id: "admin-1" } });
        assert.strictEqual(result.stateChanged, false, "error, malformed, mismatched and unknown results must not mutate state");
        assert.deepStrictEqual({ setReference: state.calls.setReference, attemptStatus: state.calls.attemptStatus, orderPayment: state.calls.orderPayment, orderStatus: state.calls.orderStatus, pay: state.calls.pay }, { setReference: 0, attemptStatus: 0, orderPayment: 0, orderStatus: 0, pay: 0 });
    }

    const pendingHarness = reconciliationHarness({ orderId: "PAY-RECON-1", amount: 34740, currency: "MMK", appId: configuration.appId, method: "QR", vendor: "KBZPay", status: "PENDING", transactionRefId: "TX-1", vendorQrRefId: "QR-1", qr: "000201010212MMQR" });
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

    const successHarness = reconciliationHarness({ orderId: "PAY-RECON-1", amount: 34740, currency: "MMK", appId: configuration.appId, method: "QR", status: "SUCCESS", transactionRefId: "TX-SUCCESS" });
    const successResult = await successHarness.service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1" });
    assert.strictEqual(successResult.providerSuccessObserved, true);
    assert.strictEqual(successResult.settlementAuthority, "AUTHENTICATED_CALLBACK");
    assert.strictEqual(successResult.stateChanged, false);
    assert.strictEqual(successHarness.state.attempt.status, "INITIATING");
    assert.strictEqual(successHarness.state.order.paymentStatus, "unpaid");
    assert.strictEqual(successHarness.state.calls.fulfillment, 0, "SUCCESS reconciliation must never trigger fulfillment");

    const refundedHarness = reconciliationHarness({ orderId: "PAY-RECON-1", amount: 34740, currency: "MMK", appId: configuration.appId, method: "QR", status: "REFUNDED" });
    const refundedResult = await refundedHarness.service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1" });
    assert.strictEqual(refundedResult.reconciliationOutcome, "PROVIDER_REFUNDED_OBSERVED");
    assert.strictEqual(refundedResult.stateChanged, false, "REFUNDED observation must remain non-mutating until refund lifecycle support exists");

    const notFoundHarness = reconciliationHarness({ code: "NOT_FOUND", message: "not found" });
    const notFoundResult = await notFoundHarness.service.reconcileMyanMyanPayPayment({ attemptId: "PAY-RECON-1" });
    assert.strictEqual(notFoundResult.reconciliationOutcome, "NOT_FOUND_INCONCLUSIVE");
    assert.strictEqual(notFoundResult.stateChanged, false);

    for (const [providerStatus, attemptStatus, orderPayment, orderStatus] of [["FAILED", "FAILED", "failed", "payment_failed"], ["CANCELLED", "CANCELLED", "cancelled", "cancelled"], ["EXPIRED", "EXPIRED", "expired", "expired"]]) {
        const harness = reconciliationHarness({ orderId: "PAY-RECON-1", amount: 34740, currency: "MMK", appId: configuration.appId, method: "QR", status: providerStatus });
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
    const mmPaymentShellSource = fs.readFileSync(path.join(root, "frontend/js/payment/mm-payment-shell.js"), "utf8");
    const customerCheckoutSource = fs.readFileSync(path.join(root, "backend/services/commerce/customerManualPaymentCheckoutService.js"), "utf8");
    assert(paymentRouteSource.includes('requireAdminPermission(PERMISSIONS.PAYMENT_METHODS_MANAGE)'), "tester lookup remains payment-management authorized");
    assert(paymentRouteSource.includes('authorizedTesterCustomerIds'), "activation must accept customer-facing tester IDs");
    assert(paymentRouteSource.includes('if (!["DISABLED", "TEST_ONLY"].includes(state))'), "PUBLIC must remain rejected");
    assert(paymentRouteSource.includes('MYANMYANPAY_CANONICAL_IDENTITY_INVALID'), "canonical identity must fail closed");
    assert(adminPaymentSource.includes('myanmyanpay_mmqr: { key: "myanmyanpay_mmqr"'), "Admin provider catalog must include MyanMyanPay");
    assert(adminPaymentSource.includes('Use the MyanMyanPay sandbox activation control'), "generic enable toggle must remain locked");
    assert(adminPaymentSource.includes('PUBLIC — unavailable'), "PUBLIC must be visibly unavailable");
    assert(adminPaymentSource.includes('authorizedTesterCustomerIds'), "Admin activation must submit customer IDs, not ObjectIds");
    assert(adminUsersSource.includes('{ customerId: { $regex:'), "Admin Users must search customerId");
    const commerceRoutesSource = fs.readFileSync(path.join(root, "backend/routes/commerceManualPaymentRoutes.js"), "utf8");
    assert(commerceRoutesSource.includes('"/admin/payment-attempts/:attemptId/myanmyanpay-reconcile"'), "Admin reconciliation route must remain registered");
    assert(commerceRoutesSource.includes("requireAdminPermission(PERMISSIONS.ORDERS_MANAGE)"), "Admin reconciliation must require order-management permission");
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
    assert(mmPaymentShellSource.includes("Waiting for payment confirmation. This page cannot confirm payment."), "MyanMyanPay presentation must remain callback-authoritative");
    assert(mmPaymentShellSource.includes("Payment QR is unavailable. Do not send payment"), "missing provider QR must fail visibly");
    const myanMyanPayPresentationBranch = mmPaymentShellSource.slice(mmPaymentShellSource.indexOf("if (isMyanMyanPay(staged)) {", mmPaymentShellSource.indexOf("const deepLink")), mmPaymentShellSource.indexOf("const receiptEnabled"));
    assert(!myanMyanPayPresentationBranch.includes("submitReceipt") && !myanMyanPayPresentationBranch.includes("Submit Payment"), "MyanMyanPay presentation must expose no manual submission action");

    const calls = [];
    const adapter = createMyanMyanPayAdapter({ configuration, client: { async pay(payload) { calls.push(payload); return { orderId: payload.orderId, amount: payload.amount, currency: "MMK", status: "PENDING", vendorQrRefId: "QR-1", qr: "000201010212MMQR" }; } } });
    const created = await adapter.createPayment({ intent: { orderId: "ORDER-1", amount: 1500, currency: "MMK", paymentMethodId: "myanmyanpay_mmqr", items: [] }, attempt: { attemptId: "PAY-1" } });
    assert.strictEqual(created.status, "PENDING", "creation remains pending");
    assert.strictEqual(calls[0].amount, 1500, "authoritative integer MMK amount sent");
    assert.strictEqual(calls[0].callbackUrl, CALLBACK_URL);
    assert(created.qr.image.startsWith("data:image/png;base64,"), "MMQR rendered as safe image");
    assert(!JSON.stringify(created).includes(configuration.secretKey), "secret never enters normalized result");
    const checkoutSession = sessionFrom({
        checkout: { orderId: "AZL-1", quoteId: "QUOTE-1", region: "MM", productName: "Game", packageName: "Package" },
        payment: { attemptId: "PAY-1", paymentStatus: "pending", provider: "MYANMYANPAY", amount: 34740, currency: "MMK", qr: created.qr, paymentInstructions: created.paymentInstructions },
        method: { key: "myanmyanpay_mmqr", method: "MyanMyanPay / MMQR", paymentType: "auto", paymentChannel: "MYANMYANPAY_MMQR", confirmationMode: "provider_webhook" }
    });
    assert.deepStrictEqual({
        commerceOrderId: checkoutSession.commerceOrderId,
        attemptId: checkoutSession.attemptId,
        provider: checkoutSession.provider,
        paymentChannel: checkoutSession.paymentChannel,
        confirmationMode: checkoutSession.confirmationMode,
        qrImage: checkoutSession.qrImage,
        qrPayload: checkoutSession.qrPayload,
        amount: checkoutSession.amount,
        currency: checkoutSession.currency
    }, {
        commerceOrderId: "AZL-1", attemptId: "PAY-1", provider: "MYANMYANPAY", paymentChannel: "MYANMYANPAY_MMQR",
        confirmationMode: "provider_webhook", qrImage: created.qr.image, qrPayload: created.qr.payload, amount: 34740, currency: "MMK"
    }, "Commerce session must preserve the provider QR presentation contract");

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
