"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { calculateSha256 } = require("../services/dinger/dingerCryptoService");
const { paymentStatusForDingerTransaction } = require("../services/dinger/dingerCallbackContract");
const { createDingerAdapter } = require("../services/commerce/providers/dingerAdapter");
const { createManualPaymentApplicationService } = require("../services/commerce/manualPaymentApplicationService");
const {
    callbackEventId,
    processDingerSettlementCallback
} = require("../routes/dingerSettlementCallback");

function encryptCallback(exactJsonText, key) {
    const cipher = crypto.createCipheriv("aes-256-ecb", Buffer.from(key, "utf8"), null);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(exactJsonText, "utf8"), cipher.final()]).toString("base64");
}

function callback(overrides = {}) {
    return {
        totalAmount: 500,
        createdAt: "20260924 120000",
        transactionStatus: "SUCCESS",
        methodName: "PIN",
        merchantOrderId: "paymentAttempt-1",
        transactionId: "TRX-1",
        customerName: "Synthetic Customer",
        providerName: "Wave Pay",
        ...overrides
    };
}

(async () => {
    assert.strictEqual(paymentStatusForDingerTransaction("SUCCESS"), "PAID");
    assert.strictEqual(paymentStatusForDingerTransaction("CANCELLED"), "CANCELLED");
    assert.strictEqual(paymentStatusForDingerTransaction("TIMEOUT"), "EXPIRED");
    ["ERROR", "DECLINED", "SYSTEM_ERROR"].forEach(status => assert.strictEqual(paymentStatusForDingerTransaction(status), "FAILED"));

    const calls = [];
    const application = createManualPaymentApplicationService({
        paymentOrchestrator: { handleProviderEvent: async input => { calls.push(input); return { metadata: { duplicate: calls.length > 1 } }; } }
    });
    await application.applyDingerCallback({ result: callback(), providerEventId: "dinger:event-1", occurredAt: "2026-09-24T05:30:00.000Z" });
    assert.strictEqual(calls[0].trustedOperational, true);
    assert.strictEqual(calls[0].verifiedTransactionRef, "TRX-1");
    assert.strictEqual(calls[0].providerEvent.providerReference, "paymentAttempt-1");
    assert.strictEqual(calls[0].providerEvent.currency, "MMK");

    const key = "0123456789abcdef0123456789abcdef";
    const result = callback();
    const exactJsonText = JSON.stringify(result);
    const body = { paymentResult: encryptCallback(exactJsonText, key), checksum: calculateSha256(exactJsonText) };
    const settled = [];
    const paymentService = { applyDingerCallback: async input => { settled.push(input); return { metadata: { duplicate: false } }; } };
    const processed = await processDingerSettlementCallback(body, {
        configuration: { enabled: true, live: true, contractConfirmed: true, validKeyLength: true, key },
        paymentService
    });
    assert.strictEqual(processed.result.transactionStatus, "SUCCESS");
    assert.strictEqual(settled.length, 1);
    assert.strictEqual(settled[0].providerEventId, callbackEventId(result));
    assert.strictEqual(settled[0].occurredAt, "2026-09-24T05:30:00.000Z");
    await assert.rejects(processDingerSettlementCallback({ ...body, checksum: "0".repeat(64) }, {
        configuration: { enabled: true, live: true, contractConfirmed: true, validKeyLength: true, key }, paymentService
    }), error => error.code === "DINGER_CALLBACK_CHECKSUM_INVALID");
    assert.strictEqual(settled.length, 1, "invalid checksum must not reach settlement");

    const adapter = createDingerAdapter({ configuration: { enabled: false }, apiClient: {} });
    const attempt = { providerReference: "paymentAttempt-1", providerTransactionId: "TRX-1", paymentMethodId: "dinger_wavepay_pin", amount: 500, currency: "MMK" };
    const event = { provider: "DINGER", providerReference: "paymentAttempt-1", providerTransactionId: "TRX-1", providerEventId: "dinger:event-1", transactionStatus: "SUCCESS", providerName: "Wave Pay", methodName: "PIN", amount: 500, currency: "MMK", occurredAt: "2026-09-24T05:30:00.000Z" };
    const normalized = await adapter.handleProviderEvent({ trustedOperational: true, providerEvent: event, attempt, intent: { amount: 500, currency: "MMK", paymentMethodId: "dinger_wavepay_pin" } });
    assert.strictEqual(normalized.status, "PAID", "disabled initiation configuration must not block a verified pending callback");
    await assert.rejects(adapter.handleProviderEvent({ trustedOperational: true, providerEvent: { ...event, amount: 501 }, attempt, intent: {} }), error => error.stage === "callback");
    await assert.rejects(adapter.handleProviderEvent({ trustedOperational: true, providerEvent: { ...event, providerName: "AYA Pay" }, attempt, intent: {} }), error => error.stage === "callback");
    await assert.rejects(adapter.handleProviderEvent({ trustedOperational: false, providerEvent: event, attempt, intent: {} }), error => error.stage === "callback");

    console.log("Dinger authenticated settlement callback verification passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
