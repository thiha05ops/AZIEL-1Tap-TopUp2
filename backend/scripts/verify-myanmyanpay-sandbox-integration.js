"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const { inspectMyanMyanPayConfiguration, loadMyanMyanPayConfiguration, CALLBACK_URL } = require("../services/myanmyanpay/myanMyanPayConfiguration");
const { createMyanMyanPayClient } = require("../services/myanmyanpay/myanMyanPayClient");
const { createMyanMyanPayAdapter } = require("../services/commerce/providers/myanMyanPayAdapter");
const { createManualPaymentApplicationService } = require("../services/commerce/manualPaymentApplicationService");
const { myanMyanPayAccessDecision } = require("../services/myanmyanpay/myanMyanPayPaymentPolicy");
const { validateCallback, eventId } = require("../routes/myanMyanPaySettlementCallback");

const env = { MYANMYANPAY_SANDBOX_ENABLED: "true", MYANMYANPAY_SANDBOX_APP_ID: "APP-TEST", MYANMYANPAY_SANDBOX_PUBLISHABLE_KEY: "pk_test_example", MYANMYANPAY_SANDBOX_SECRET_KEY: "sk_test_example", MYANMYANPAY_SANDBOX_API_BASE_URL: "https://sandbox.example.test" };
assert.strictEqual(inspectMyanMyanPayConfiguration({}).configured, false, "missing configuration fails closed");
const configuration = loadMyanMyanPayConfiguration(env);
assert.strictEqual(configuration.environment, "SANDBOX");
assert.strictEqual(configuration.callbackUrl, CALLBACK_URL);

const method = { key: "myanmyanpay_mmqr", enabled: true, myanMyanPayActivationState: "TEST_ONLY", myanMyanPaySandboxTestApproved: true, myanMyanPayAuthorizedTestUserIds: ["user-1"] };
assert.strictEqual(myanMyanPayAccessDecision(method, {}).allowed, false, "public users cannot see TEST_ONLY");
assert.strictEqual(myanMyanPayAccessDecision(method, { id: "user-1" }, env).allowed, true, "allowlisted test user can access sandbox method");

(async () => {
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
