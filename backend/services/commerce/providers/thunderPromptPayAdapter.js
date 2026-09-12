"use strict";

const { createProviderAdapter, ProviderAdapterError, ERROR_CODES, CAPABILITIES } = require("../providerAdapter");
const { createPromptPayQr, normalizePromptPayRecipient, maskPromptPayRecipient } = require("../../promptPayQrService");

const PROVIDER_ID = "THUNDER_PROMPTPAY";

function text(value) { return String(value || "").trim(); }
function error(message, stage = "provider") {
    return new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, message, { stage });
}
function configuration(input = {}) {
    if (input.enabled !== true) throw error("Thunder PromptPay is disabled.", "configuration");
    const recipientType = text(input.recipientType).toUpperCase();
    const recipientValue = text(input.recipientValue);
    try { normalizePromptPayRecipient(recipientType, recipientValue); } catch (_) { throw error("Thunder PromptPay recipient is invalid.", "configuration"); }
    return Object.freeze({ recipientType, recipientValue, recipientDisplayName: text(input.recipientDisplayName || "AZIEL PromptPay"), expiryMinutes: Math.max(1, Math.min(Number(input.defaultExpiryMinutes) || 15, 120)), environment: text(input.environment || "production").toLowerCase() });
}

function createThunderPromptPayAdapter(options = {}) {
    const config = configuration(options.configuration || {});
    const qrService = options.qrService || createPromptPayQr;
    const clock = options.clock || (() => new Date());
    const base = (intent, attempt, status) => ({
        provider: PROVIDER_ID,
        providerReference: text(attempt.providerReference),
        providerTransactionId: text(attempt.providerReference),
        status,
        amount: Number(intent.amount ?? attempt.amount),
        currency: text(intent.currency || attempt.currency).toUpperCase(),
        expiresAt: attempt.expiresAt || null,
        qr: attempt.qr || null,
        paymentInstructions: attempt.paymentInstructions || null,
        safeMetadata: { providerId: PROVIDER_ID, confirmationMode: "thunder_slip", automaticVerification: true },
        rawProviderStatus: status.toLowerCase()
    });
    async function createPayment({ intent = {}, attempt = {} } = {}) {
        if (text(intent.currency).toUpperCase() !== "THB" || !(Number(intent.amount) > 0)) throw error("Thunder PromptPay requires a positive THB amount.", "amount");
        const providerReference = `AZL-${text(intent.orderId)}-${text(attempt.attemptId)}`.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 95);
        const qrResult = await qrService({ method: { key: "commerce_thunder_promptpay", promptPayRecipientType: config.recipientType, promptPayRecipientValue: config.recipientValue, dynamicQrExpiryMinutes: config.expiryMinutes }, amount: Number(intent.amount), currency: "THB", orderReference: providerReference });
        return {
            ...base(intent, { ...attempt, providerReference }, "PENDING"),
            providerReference,
            providerTransactionId: providerReference,
            expiresAt: qrResult.expiresAt || new Date(clock().getTime() + config.expiryMinutes * 60000).toISOString(),
            qr: { type: "PROMPTPAY_EMV_QR", mode: "aziel_promptpay_dynamic", sourceType: "dynamic_response", image: qrResult.qrImage, encodedAmount: qrResult.encodedAmount, payloadVerified: qrResult.qrImagePayloadMatches === true },
            paymentInstructions: { type: "THUNDER_PROMPTPAY", title: "PromptPay QR", steps: ["Pay the fixed amount", "Upload payment slip", "Automatic verification"], requiresReceiptUpload: true, receiptUploadEnabled: true, confirmationMode: "thunder_slip" },
            safeMetadata: { providerId: PROVIDER_ID, confirmationMode: "thunder_slip", automaticVerification: true, receiptRequired: true, recipientDisplayName: config.recipientDisplayName, maskedRecipient: maskPromptPayRecipient(config.recipientValue) }
        };
    }
    async function refreshPayment({ intent = {}, attempt = {} } = {}) { return base(intent, attempt, text(attempt.status || "PENDING").toUpperCase()); }
    async function expirePayment({ intent = {}, attempt = {} } = {}) { return base(intent, attempt, "EXPIRED"); }
    async function cancelPayment({ intent = {}, attempt = {} } = {}) { return base(intent, attempt, "CANCELLED"); }
    async function handleProviderEvent({ providerEvent = {}, attempt = {}, intent = {}, trustedOperational } = {}) {
        if (trustedOperational !== true || text(providerEvent.provider) !== PROVIDER_ID || text(providerEvent.providerReference) !== text(attempt.providerReference) || text(providerEvent.eventType).toUpperCase() !== "THUNDER_SLIP_VERIFIED") {
            throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "Thunder verification event is invalid.", { stage: "verification" });
        }
        return { ...base(intent, attempt, "PAID"), providerEventId: text(providerEvent.providerEventId), eventType: "THUNDER_SLIP_VERIFIED", occurredAt: providerEvent.occurredAt || clock().toISOString(), safeMetadata: { verificationMethod: "thunder_slip", receiptId: text(providerEvent.metadata?.receiptId) } };
    }
    return createProviderAdapter({ providerId: PROVIDER_ID, displayName: "Thunder Verified PromptPay", version: "1", supportedCurrencies: ["THB"], supportedPaymentMethods: ["thunder_promptpay", "THUNDER_PROMPTPAY"], supportedCapabilities: [CAPABILITIES.CREATE_PAYMENT, CAPABILITIES.QUERY_PAYMENT, CAPABILITIES.REFRESH_PAYMENT, CAPABILITIES.EXPIRE_PAYMENT, CAPABILITIES.QR_CODE, CAPABILITIES.MANUAL_APPROVAL], environment: config.environment, handlers: { createPayment, queryPayment: refreshPayment, refreshPayment, expirePayment, cancelPayment, handleProviderEvent } });
}

module.exports = Object.freeze({ createThunderPromptPayAdapter, THUNDER_PROMPTPAY_PROVIDER_ID: PROVIDER_ID });
