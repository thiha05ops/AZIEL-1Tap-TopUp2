"use strict";

const crypto = require("crypto");
const { createProviderAdapter, ProviderAdapterError, ERROR_CODES, CAPABILITIES } = require("../providerAdapter");

const PROVIDER_ID = "MANUAL_ADMIN";
const text = value => String(value || "").trim();
const upper = value => text(value).replace(/-/g, "_").toUpperCase();
const clone = value => value == null ? value : structuredClone(value);
function error(message, stage, metadata = {}) { return new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, message, { stage, metadata }); }
function reference(intent, attempt) { return `AZL-${text(intent.orderId)}-${text(attempt.attemptId)}`.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 110); }

function normalizeConfiguration(configuration = {}) {
    const methodKey = text(configuration.methodKey).toLowerCase();
    if (!methodKey) throw error("Manual Admin method key is required.", "configuration");
    if (upper(configuration.confirmationMode) !== "MANUAL_ADMIN") throw error("Manual Admin confirmation mode is required.", "configuration");
    return Object.freeze({
        methodKey,
        methodName: text(configuration.methodName || methodKey),
        region: upper(configuration.region),
        currency: upper(configuration.currency || "MMK"),
        accountName: text(configuration.accountName),
        accountNumber: text(configuration.accountNumber),
        qrImage: text(configuration.qrImage),
        qrMode: text(configuration.qrMode || (configuration.qrImage ? "uploaded_static" : "none")),
        referenceInstructions: text(configuration.referenceInstructions),
        receiptUploadEnabled: configuration.receiptUploadEnabled !== false,
        slipRequired: configuration.receiptUploadEnabled !== false && configuration.slipRequired !== false,
        enableOpenApp: configuration.enableOpenApp === true,
        openAppMode: text(configuration.openAppMode || "disabled"),
        deepLinkUrl: text(configuration.deepLinkUrl),
        appDisplayName: text(configuration.appDisplayName),
        expiresMinutes: Math.max(5, Math.min(1440, Number(configuration.expiresMinutes || 60)))
    });
}

function createManualAdminAdapter(options = {}) {
    const config = normalizeConfiguration(options.configuration || {});
    const clock = options.clock || (() => new Date());
    const result = (intent, attempt, status, extra = {}) => ({
        provider: PROVIDER_ID,
        providerReference: text(attempt.providerReference) || reference(intent, attempt),
        providerTransactionId: text(attempt.providerReference) || reference(intent, attempt),
        status,
        amount: Number(intent.amount ?? attempt.amount),
        currency: upper(intent.currency || attempt.currency),
        expiresAt: extra.expiresAt || attempt.expiresAt || null,
        qr: extra.qr === undefined ? clone(attempt.qr || null) : extra.qr,
        paymentInstructions: extra.instructions === undefined ? clone(attempt.paymentInstructions || null) : extra.instructions,
        safeMetadata: { providerId: PROVIDER_ID, methodKey: config.methodKey, manualApprovalRequired: true, receiptRequired: config.slipRequired },
        rawProviderStatus: status.toLowerCase()
    });
    async function createPayment({ intent = {}, attempt = {} } = {}) {
        if (upper(intent.region) !== config.region || upper(intent.currency) !== config.currency || text(intent.paymentMethodId).toLowerCase() !== config.methodKey) throw error("Manual Admin intent does not match server payment configuration.", "intent");
        const providerReference = reference(intent, attempt);
        const expiresAt = new Date(clock().getTime() + config.expiresMinutes * 60000).toISOString();
        return { ...result(intent, { ...attempt, providerReference }, "PENDING", {
            expiresAt,
            qr: config.qrImage ? { type: "STATIC_PAYMENT_QR", mode: config.qrMode, sourceType: "server_configuration", image: config.qrImage, encodedReference: providerReference } : null,
            instructions: { type: "MANUAL_ADMIN", title: config.methodName, methodKey: config.methodKey, accountName: config.accountName, accountNumber: config.accountNumber, reference: providerReference, referenceInstructions: config.referenceInstructions, confirmationMode: "manual_admin", receiptUploadEnabled: config.receiptUploadEnabled, slipRequired: config.slipRequired, enableOpenApp: config.enableOpenApp, openAppMode: config.openAppMode, deepLinkUrl: config.deepLinkUrl, appDisplayName: config.appDisplayName }
        }), providerReference };
    }
    async function handleProviderEvent(context = {}) {
        const event = context.providerEvent || context.event || {}, intent = context.intent || {}, attempt = context.attempt || {};
        if (context.trustedOperational !== true && context.trusted !== true) throw error("Manual Admin events require a trusted operational boundary.", "event");
        if (upper(event.provider) !== PROVIDER_ID || text(event.providerReference) !== text(attempt.providerReference)) throw error("Manual Admin event identity mismatch.", "event");
        const eventType = upper(event.eventType), status = eventType === "MANUAL_PAYMENT_APPROVED" ? "PAID" : eventType === "MANUAL_PAYMENT_REJECTED" ? "FAILED" : "";
        if (!status) throw error("Manual Admin event type is unsupported.", "event");
        if (Number(event.amount) !== Number(attempt.amount) || upper(event.currency) !== upper(attempt.currency)) throw error("Manual Admin event commercial identity mismatch.", "event");
        if (status === "PAID" && config.slipRequired && !event.metadata?.receiptId) throw error("Manual Admin approval requires trusted receipt evidence.", "event");
        return { ...result(intent, attempt, status), providerEventId: text(event.providerEventId) || crypto.randomUUID(), eventType, occurredAt: event.occurredAt || clock().toISOString(), safeMetadata: { verificationMethod: "manual_admin", verifiedBy: text(event.metadata?.verifiedBy), receiptId: text(event.metadata?.receiptId), note: text(event.metadata?.note) } };
    }
    return createProviderAdapter({ providerId: PROVIDER_ID, displayName: "Manual Admin", version: "1", supportedCurrencies: [config.currency], supportedPaymentMethods: [config.methodKey], supportedCapabilities: [CAPABILITIES.CREATE_PAYMENT, CAPABILITIES.MANUAL_APPROVAL, CAPABILITIES.CANCEL_PAYMENT, CAPABILITIES.EXPIRE_PAYMENT], handlers: { createPayment, handleProviderEvent, cancelPayment: async ({ intent, attempt }) => result(intent, attempt, "CANCELLED"), expirePayment: async ({ intent, attempt }) => result(intent, attempt, "EXPIRED") } });
}

module.exports = Object.freeze({ createManualAdminAdapter, MANUAL_ADMIN_PROVIDER_ID: PROVIDER_ID, normalizeConfiguration });
