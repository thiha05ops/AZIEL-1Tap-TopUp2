"use strict";

const {
    createProviderAdapter,
    ProviderAdapterError,
    ERROR_CODES: ADAPTER_ERROR_CODES,
    CAPABILITIES
} = require("../providerAdapter");
const {
    RECIPIENT_TYPES,
    createPromptPayQr,
    maskPromptPayRecipient,
    normalizePromptPayRecipient
} = require("../../promptPayQrService");

const PROVIDER_ID = "MANUAL_PROMPTPAY";
const DISPLAY_NAME = "Manual PromptPay";
const VERSION = "1";
const SUPPORTED_CURRENCIES = Object.freeze(["THB"]);
const SUPPORTED_PAYMENT_METHODS = Object.freeze(["PROMPTPAY", "promptpay", "aziel_promptpay_dynamic"]);
const SUPPORTED_CAPABILITIES = Object.freeze([
    CAPABILITIES.CREATE_PAYMENT,
    CAPABILITIES.QUERY_PAYMENT,
    CAPABILITIES.REFRESH_PAYMENT,
    CAPABILITIES.EXPIRE_PAYMENT,
    CAPABILITIES.QR_CODE,
    CAPABILITIES.MANUAL_APPROVAL
]);
const ACTIVE_STATUSES = Object.freeze(new Set(["INITIATING", "PENDING"]));
const TERMINAL_STATUSES = Object.freeze(new Set(["PAID", "WAIVED", "REFUNDED", "CANCELLED"]));
const ALLOWED_ENVIRONMENTS = Object.freeze(new Set(["local", "development", "test", "staging", "production", "live"]));
const QR_SERVICE_METHOD_KEY = "commerce_manual_promptpay";

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}

function clonePlain(value) {
    if (value === undefined) return undefined;
    return structuredClone(value);
}

function normalizeString(value) {
    return String(value || "").trim();
}

function normalizeUpper(value) {
    return normalizeString(value).replace(/-/g, "_").toUpperCase();
}

function normalizeCurrency(value) {
    return normalizeString(value).toUpperCase();
}

function normalizeAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw providerError("Manual PromptPay amount must be positive.", "amount", { amount: value });
    }
    const decimals = String(value).includes(".") ? String(value).split(".")[1] : "";
    if (decimals.length > 2) {
        throw providerError("Manual PromptPay amount supports at most two decimals.", "amount", { amount: value });
    }
    return Number(amount.toFixed(2));
}

function safeReferencePart(value) {
    return normalizeString(value)
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}

function buildProviderReference(config, intent = {}, attempt = {}) {
    const prefix = safeReferencePart(config.referencePrefix || "AZL");
    const orderPart = safeReferencePart(intent.orderId || attempt.orderId || "ORDER");
    const attemptPart = safeReferencePart(attempt.attemptId || intent.paymentIntentId || "PAY");
    const reference = [prefix, orderPart, attemptPart].filter(Boolean).join("-").slice(0, 95);
    if (!reference) throw providerError("Manual PromptPay reference could not be generated.", "reference");
    return reference;
}

function normalizeExpiryMinutes(value) {
    const minutes = Number(value == null ? 15 : value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
        throw providerError("Manual PromptPay expiry must be between 1 and 120 minutes.", "configuration", {
            field: "defaultExpiryMinutes"
        });
    }
    return minutes;
}

function normalizeEnvironment(value) {
    const environment = normalizeString(value || "production").toLowerCase();
    if (!ALLOWED_ENVIRONMENTS.has(environment)) {
        throw providerError("Manual PromptPay environment is not supported.", "configuration", { environment });
    }
    return environment;
}

function providerError(message, stage, metadata = {}, retryable = false) {
    return new ProviderAdapterError(ADAPTER_ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, message, {
        stage,
        retryable,
        metadata
    });
}

function eventError(message, metadata = {}) {
    return new ProviderAdapterError(ADAPTER_ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, message, {
        stage: "manual_approval",
        metadata
    });
}

function normalizeConfiguration(configuration = {}) {
    if (!isPlainObject(configuration)) {
        throw providerError("Manual PromptPay configuration must be an object.", "configuration");
    }
    if (configuration.enabled !== true) {
        throw providerError("Manual PromptPay provider is disabled.", "configuration", { field: "enabled" });
    }
    const recipientType = normalizeUpper(configuration.recipientType);
    if (!Object.values(RECIPIENT_TYPES).includes(recipientType)) {
        throw providerError("Manual PromptPay recipient type is invalid.", "configuration", { field: "recipientType" });
    }
    const recipientValue = normalizeString(configuration.recipientValue);
    try {
        normalizePromptPayRecipient(recipientType, recipientValue);
    } catch (error) {
        throw providerError("Manual PromptPay recipient is invalid.", "configuration", {
            field: "recipientValue",
            causeCode: error.code || ""
        });
    }
    return Object.freeze({
        providerId: PROVIDER_ID,
        recipientType,
        recipientValue,
        recipientDisplayName: normalizeString(configuration.recipientDisplayName || DISPLAY_NAME),
        defaultExpiryMinutes: normalizeExpiryMinutes(configuration.defaultExpiryMinutes),
        environment: normalizeEnvironment(configuration.environment),
        enabled: true,
        referencePrefix: safeReferencePart(configuration.referencePrefix || "AZL"),
        receiptRequired: configuration.receiptRequired !== false
    });
}

function assertNoClientRecipientOverride(context = {}) {
    const text = JSON.stringify({
        input: context.input || {},
        request: context.request || {},
        payment: context.payment || {}
    });
    if (/"recipient(Value|Type)"|"promptPayRecipient(Value|Type)"/.test(text)) {
        throw providerError("Manual PromptPay recipient is server-owned and cannot be supplied by clients.", "input");
    }
}

function assertTrustedEvent(event = {}, context = {}) {
    if (context.trusted !== true && context.trustedOperational !== true && event.trusted !== true) {
        throw eventError("Manual PromptPay provider events must come from a trusted operational boundary.");
    }
}

function normalizeStatus(value) {
    return normalizeUpper(value || "PENDING");
}

function currentAttemptStatus(attempt = {}) {
    return normalizeStatus(attempt.status || attempt.paymentStatus || "PENDING");
}

function amountMatches(left, right) {
    return Number(left).toFixed(2) === Number(right).toFixed(2);
}

function normalizeReceiptMetadata(receipt = {}) {
    if (!receipt || typeof receipt !== "object") return null;
    const receiptId = normalizeString(receipt.receiptId || receipt.id || receipt.uploadId);
    if (!receiptId) return null;
    return {
        receiptId,
        uploadedAt: normalizeString(receipt.uploadedAt || receipt.createdAt),
        fileName: normalizeString(receipt.fileName || receipt.originalName),
        contentType: normalizeString(receipt.contentType || receipt.mimeType)
    };
}

function safeMetadataFor(config, intent, attempt, providerReference, extra = {}) {
    return {
        providerId: PROVIDER_ID,
        orderId: normalizeString(intent.orderId || attempt.orderId),
        attemptId: normalizeString(attempt.attemptId),
        quoteId: normalizeString(intent.quoteId || attempt.quoteId),
        confirmationMode: "manual_admin",
        recipientType: config.recipientType,
        recipientDisplayName: config.recipientDisplayName,
        maskedRecipient: maskPromptPayRecipient(config.recipientValue),
        manualApprovalRequired: true,
        receiptRequired: config.receiptRequired,
        providerReference,
        ...extra
    };
}

function resultForAttempt({ config, intent = {}, attempt = {}, status, providerReference, expiresAt, qr, instructions, metadata = {} }) {
    const amount = normalizeAmount(intent.amount ?? attempt.amount);
    const currency = normalizeCurrency(intent.currency || attempt.currency);
    return {
        provider: PROVIDER_ID,
        providerReference: providerReference || normalizeString(attempt.providerReference || attempt.providerTransactionId),
        providerTransactionId: providerReference || normalizeString(attempt.providerTransactionId || attempt.providerReference),
        status,
        amount,
        currency,
        expiresAt: expiresAt || attempt.expiresAt || null,
        qr: qr || clonePlain(attempt.qr || null),
        paymentInstructions: instructions || clonePlain(attempt.paymentInstructions || null),
        safeMetadata: safeMetadataFor(config, intent, attempt, providerReference || attempt.providerReference, metadata),
        rawProviderStatus: status.toLowerCase()
    };
}

function createManualPromptPayAdapter(options = {}) {
    const configuration = normalizeConfiguration(options.configuration || {});
    const qrService = options.qrService || createPromptPayQr;
    const clock = typeof options.clock === "function" ? options.clock : (() => new Date());

    async function createPayment(context = {}) {
        const { intent = {}, attempt = {} } = context;
        assertNoClientRecipientOverride(context);
        const amount = normalizeAmount(intent.amount);
        const currency = normalizeCurrency(intent.currency);
        if (currency !== "THB") throw providerError("Manual PromptPay supports THB only.", "currency", { currency });
        const providerReference = buildProviderReference(configuration, intent, attempt);
        const method = {
            key: QR_SERVICE_METHOD_KEY,
            promptPayRecipientType: configuration.recipientType,
            promptPayRecipientValue: configuration.recipientValue,
            dynamicQrExpiryMinutes: configuration.defaultExpiryMinutes
        };
        let qrResult;
        try {
            qrResult = await qrService({
                method,
                amount,
                currency,
                orderReference: providerReference
            });
        } catch (error) {
            throw new ProviderAdapterError(ADAPTER_ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Manual PromptPay QR generation failed.", {
                stage: "qr",
                retryable: false,
                metadata: { causeCode: error.code || "", message: error.message || "" }
            });
        }
        const expiresAt = qrResult.expiresAt || new Date(clock().getTime() + configuration.defaultExpiryMinutes * 60 * 1000).toISOString();
        return resultForAttempt({
            config: configuration,
            intent,
            attempt,
            status: "PENDING",
            providerReference,
            expiresAt,
            qr: {
                type: "PROMPTPAY_EMV_QR",
                mode: "aziel_promptpay_dynamic",
                sourceType: "dynamic_response",
                image: qrResult.qrImage,
                payload: qrResult.qrPayload,
                encodedAmount: qrResult.encodedAmount,
                encodedReference: qrResult.encodedReference,
                payloadVerified: qrResult.qrImagePayloadMatches === true
            },
            instructions: {
                type: "MANUAL_PROMPTPAY",
                title: "PromptPay QR",
                steps: [
                    "Save QR",
                    "Open banking app",
                    "Scan the saved QR and pay",
                    "Upload payment receipt"
                ],
                requiresReceiptUpload: true,
                confirmationMode: "manual_admin"
            },
            metadata: {
                qrGeneratedAt: clock().toISOString(),
                orderReference: qrResult.orderReference,
                encodedReference: qrResult.encodedReference
            }
        });
    }

    async function refreshPayment(context = {}) {
        const { intent = {}, attempt = {} } = context;
        const status = currentAttemptStatus(attempt);
        if (status === "PENDING" && attempt.expiresAt && new Date(attempt.expiresAt).getTime() <= clock().getTime()) {
            return resultForAttempt({ config: configuration, intent, attempt, status: "EXPIRED" });
        }
        return resultForAttempt({ config: configuration, intent, attempt, status: status === "INITIATING" ? "PENDING" : status });
    }

    async function expirePayment(context = {}) {
        const { intent = {}, attempt = {} } = context;
        const status = currentAttemptStatus(attempt);
        if (status === "EXPIRED") return resultForAttempt({ config: configuration, intent, attempt, status: "EXPIRED" });
        if (!ACTIVE_STATUSES.has(status)) {
            throw providerError("Manual PromptPay can only expire active attempts.", "status", { status });
        }
        return resultForAttempt({ config: configuration, intent, attempt, status: "EXPIRED" });
    }

    async function cancelPayment(context = {}) {
        const { intent = {}, attempt = {} } = context;
        const status = currentAttemptStatus(attempt);
        if (status === "CANCELLED") return resultForAttempt({ config: configuration, intent, attempt, status: "CANCELLED" });
        if (TERMINAL_STATUSES.has(status)) {
            throw providerError("Manual PromptPay cannot cancel terminal attempts.", "status", { status });
        }
        return resultForAttempt({ config: configuration, intent, attempt, status: "CANCELLED" });
    }

    async function handleProviderEvent(context = {}) {
        const event = context.providerEvent || context.event || {};
        const { intent = {}, attempt = {} } = context;
        assertTrustedEvent(event, context);
        const provider = normalizeString(event.provider || PROVIDER_ID);
        if (provider !== PROVIDER_ID) throw eventError("Manual PromptPay event provider is invalid.", { provider });
        const providerReference = normalizeString(event.providerReference || event.providerTransactionId);
        if (!providerReference || providerReference !== normalizeString(attempt.providerReference || event.providerReference)) {
            throw eventError("Manual PromptPay event reference does not match the attempt.", { providerReference });
        }
        const providerEventId = normalizeString(event.providerEventId || event.eventId);
        if (!providerEventId) throw eventError("Manual PromptPay event requires a provider event id.");
        const eventType = normalizeUpper(event.eventType || event.type);
        const targetStatus = eventType === "MANUAL_PAYMENT_APPROVED" ? "PAID" : eventType === "MANUAL_PAYMENT_REJECTED" ? "FAILED" : "";
        if (!targetStatus) throw eventError("Manual PromptPay event type is unsupported.", { eventType });
        if (!amountMatches(event.amount, intent.amount ?? attempt.amount)) {
            throw eventError("Manual PromptPay event amount does not match the attempt.", { amount: event.amount });
        }
        if (normalizeCurrency(event.currency) !== "THB" || normalizeCurrency(intent.currency || attempt.currency) !== "THB") {
            throw eventError("Manual PromptPay event currency must be THB.", { currency: event.currency });
        }
        const currentStatus = currentAttemptStatus(attempt);
        if (["EXPIRED", "CANCELLED"].includes(currentStatus) && targetStatus === "PAID") {
            throw eventError("Expired or cancelled Manual PromptPay attempts cannot be approved.", { status: currentStatus });
        }
        const receipt = normalizeReceiptMetadata(event.metadata?.receipt || event.safeMetadata?.receipt || event.metadata || context.receipt);
        if (targetStatus === "PAID" && configuration.receiptRequired && !receipt) {
            throw eventError("Manual PromptPay approval requires server-trusted receipt evidence.");
        }
        return {
            provider: PROVIDER_ID,
            providerReference,
            providerTransactionId: providerReference,
            providerEventId,
            eventType,
            status: targetStatus,
            paymentStatus: targetStatus,
            amount: normalizeAmount(event.amount),
            currency: "THB",
            occurredAt: event.occurredAt || clock().toISOString(),
            safeMetadata: {
                providerId: PROVIDER_ID,
                verificationMethod: normalizeString(event.metadata?.verificationMethod || event.safeMetadata?.verificationMethod || "manual_admin"),
                verifiedBy: normalizeString(event.metadata?.verifiedBy || event.safeMetadata?.verifiedBy || ""),
                receipt,
                note: normalizeString(event.metadata?.note || event.safeMetadata?.note)
            },
            rawProviderStatus: targetStatus.toLowerCase()
        };
    }

    return createProviderAdapter({
        providerId: PROVIDER_ID,
        displayName: DISPLAY_NAME,
        version: VERSION,
        supportedCurrencies: SUPPORTED_CURRENCIES,
        supportedPaymentMethods: SUPPORTED_PAYMENT_METHODS,
        supportedCapabilities: SUPPORTED_CAPABILITIES,
        environment: configuration.environment,
        handlers: {
            createPayment,
            refreshPayment,
            queryPayment: refreshPayment,
            expirePayment,
            cancelPayment,
            handleProviderEvent
        }
    });
}

module.exports = Object.freeze({
    createManualPromptPayAdapter,
    normalizeManualPromptPayConfiguration: normalizeConfiguration,
    normalizeManualPromptPayReceiptMetadata: normalizeReceiptMetadata,
    MANUAL_PROMPTPAY_PROVIDER_ID: PROVIDER_ID,
    MANUAL_PROMPTPAY_PAYMENT_METHODS: SUPPORTED_PAYMENT_METHODS,
    MANUAL_PROMPTPAY_CAPABILITIES: SUPPORTED_CAPABILITIES
});
