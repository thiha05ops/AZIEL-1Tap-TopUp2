"use strict";

const PROVIDER_ADAPTER_VERSION = "2.6.3";

const CAPABILITIES = Object.freeze({
    CREATE_PAYMENT: "CREATE_PAYMENT",
    QUERY_PAYMENT: "QUERY_PAYMENT",
    REFRESH_PAYMENT: "REFRESH_PAYMENT",
    CANCEL_PAYMENT: "CANCEL_PAYMENT",
    EXPIRE_PAYMENT: "EXPIRE_PAYMENT",
    WEBHOOK: "WEBHOOK",
    REDIRECT: "REDIRECT",
    QR_CODE: "QR_CODE",
    MANUAL_APPROVAL: "MANUAL_APPROVAL",
    REFUND: "REFUND"
});

const PAYMENT_STATUSES = Object.freeze([
    "PENDING",
    "PAID",
    "FAILED",
    "EXPIRED",
    "CANCELLED",
    "WAIVED",
    "REFUNDED"
]);

const ERROR_CODES = Object.freeze({
    PAYMENT_PROVIDER_INVALID: "PAYMENT_PROVIDER_INVALID",
    PAYMENT_PROVIDER_CONFIGURATION_INVALID: "PAYMENT_PROVIDER_CONFIGURATION_INVALID",
    PAYMENT_PROVIDER_CAPABILITY_UNSUPPORTED: "PAYMENT_PROVIDER_CAPABILITY_UNSUPPORTED",
    PAYMENT_PROVIDER_RESPONSE_INVALID: "PAYMENT_PROVIDER_RESPONSE_INVALID",
    PAYMENT_PROVIDER_EVENT_INVALID: "PAYMENT_PROVIDER_EVENT_INVALID",
    PAYMENT_PROVIDER_METHOD_NOT_IMPLEMENTED: "PAYMENT_PROVIDER_METHOD_NOT_IMPLEMENTED"
});

class ProviderAdapterError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "ProviderAdapterError";
        this.code = code;
        this.stage = normalizeString(options.stage);
        this.retryable = options.retryable === true;
        this.metadata = deepFreeze(clonePlain(options.metadata || {}));
    }
}

function clonePlain(value) {
    if (value === undefined) return undefined;
    return structuredClone(value);
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return value;
}

function normalizeString(value) {
    return String(value || "").trim();
}

function normalizeUpper(value) {
    return normalizeString(value).replace(/-/g, "_").toUpperCase();
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}

function safeArray(value) {
    return Array.isArray(value) ? value.map(normalizeString).filter(Boolean) : [];
}

function normalizeCapabilities(value) {
    const known = new Set(Object.values(CAPABILITIES));
    return [...new Set(safeArray(value).map(normalizeUpper))].filter(item => known.has(item));
}

function assertProviderId(value) {
    const providerId = normalizeString(value);
    if (!providerId || providerId.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(providerId)) {
        throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_INVALID, "providerId is invalid.", {
            stage: "identity",
            metadata: { field: "providerId" }
        });
    }
    return providerId;
}

function normalizeCurrency(value) {
    const currency = normalizeString(value).toUpperCase();
    if (currency && !/^[A-Z]{3,12}$/.test(currency)) {
        throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_INVALID, "Currency is invalid.", {
            stage: "identity",
            metadata: { currency }
        });
    }
    return currency;
}

function normalizeIdentity(config = {}) {
    if (!isPlainObject(config)) {
        throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_INVALID, "Provider config must be an object.", { stage: "identity" });
    }
    const providerId = assertProviderId(config.providerId);
    const displayName = normalizeString(config.displayName || providerId);
    const version = normalizeString(config.version || "1.0.0");
    const supportedCurrencies = [...new Set(safeArray(config.supportedCurrencies).map(normalizeCurrency).filter(Boolean))];
    const supportedPaymentMethods = [...new Set(safeArray(config.supportedPaymentMethods))];
    const supportedCapabilities = normalizeCapabilities(config.supportedCapabilities);
    return deepFreeze({
        providerId,
        displayName,
        version,
        supportedCurrencies,
        supportedPaymentMethods,
        supportedCapabilities,
        environment: normalizeString(config.environment || "runtime")
    });
}

function unsupportedMethod(providerId, methodName) {
    return async function unsupportedProviderMethod() {
        throw new ProviderAdapterError(
            ERROR_CODES.PAYMENT_PROVIDER_METHOD_NOT_IMPLEMENTED,
            `${methodName} is not implemented for provider ${providerId}.`,
            { stage: "adapter", metadata: { providerId, methodName } }
        );
    };
}

function normalizeProviderStatus(value) {
    const status = normalizeUpper(value);
    if (!PAYMENT_STATUSES.includes(status)) {
        throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Provider response status is invalid.", {
            stage: "normalization",
            metadata: { status: value }
        });
    }
    return status;
}

function normalizeAmount(value) {
    if (value === undefined || value === null || value === "") return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Provider response amount is invalid.", {
            stage: "normalization"
        });
    }
    return amount;
}

function normalizeDateValue(value, code, field) {
    if (!value) return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new ProviderAdapterError(code, `${field} is invalid.`, {
            stage: "normalization",
            metadata: { field }
        });
    }
    return date.toISOString();
}

function redactMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const clone = clonePlain(value);
    [
        "rawPayload",
        "signature",
        "webhookSignature",
        "authorization",
        "apiKey",
        "secret",
        "secretKey",
        "accessToken",
        "refreshToken",
        "card",
        "bankAccount"
    ].forEach(key => delete clone[key]);
    return clone;
}

function normalizeProviderResponse(response = {}, context = {}) {
    if (!isPlainObject(response)) {
        throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Provider response must be an object.", { stage: "normalization" });
    }
    const provider = normalizeString(response.provider || context.provider || context.providerId);
    if (!provider) {
        throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Provider response requires provider.", { stage: "normalization" });
    }
    const providerReference = normalizeString(response.providerReference || response.providerTransactionId);
    if (!providerReference && normalizeProviderStatus(response.status || response.paymentStatus) !== "WAIVED") {
        throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Provider response requires providerReference.", { stage: "normalization" });
    }
    const currency = response.currency == null ? "" : normalizeCurrency(response.currency);
    return deepFreeze({
        provider,
        providerReference,
        providerTransactionId: normalizeString(response.providerTransactionId || providerReference),
        status: normalizeProviderStatus(response.status || response.paymentStatus),
        amount: normalizeAmount(response.amount),
        currency,
        expiresAt: normalizeDateValue(response.expiresAt, ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "expiresAt"),
        redirect: clonePlain(response.redirect || null),
        qr: clonePlain(response.qr || null),
        instructions: clonePlain(response.instructions || response.paymentInstructions || null),
        paymentInstructions: clonePlain(response.paymentInstructions || response.instructions || null),
        failure: clonePlain(response.failure || null),
        metadata: redactMetadata(response.metadata || response.safeMetadata),
        safeMetadata: redactMetadata(response.safeMetadata || response.metadata),
        rawStatus: normalizeString(response.rawStatus || response.rawProviderStatus || response.providerStatus)
    });
}

function normalizeProviderEvent(event = {}, context = {}) {
    if (!isPlainObject(event)) {
        throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "Provider event must be an object.", { stage: "event" });
    }
    const provider = normalizeString(event.provider || context.provider || context.providerId);
    const providerReference = normalizeString(event.providerReference || event.providerTransactionId);
    const providerEventId = normalizeString(event.providerEventId || event.eventId);
    if (!provider || !providerReference || !providerEventId) {
        throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "Provider event requires provider, reference, and event id.", {
            stage: "event"
        });
    }
    return deepFreeze({
        provider,
        providerReference,
        providerTransactionId: normalizeString(event.providerTransactionId || providerReference),
        providerEventId,
        eventType: normalizeString(event.eventType || event.type),
        paymentStatus: normalizeProviderStatus(event.paymentStatus || event.status),
        status: normalizeProviderStatus(event.status || event.paymentStatus),
        amount: normalizeAmount(event.amount),
        currency: event.currency == null ? "" : normalizeCurrency(event.currency),
        occurredAt: normalizeDateValue(event.occurredAt || event.eventTimestamp, ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "occurredAt"),
        metadata: redactMetadata(event.metadata || event.safeMetadata),
        safeMetadata: redactMetadata(event.safeMetadata || event.metadata)
    });
}

function validateConfiguration(config = {}, identity = {}) {
    const errors = [];
    if (config.currency && identity.supportedCurrencies.length && !identity.supportedCurrencies.includes(normalizeCurrency(config.currency))) {
        errors.push({ code: "UNSUPPORTED_CURRENCY", field: "currency" });
    }
    if (config.paymentMethod && identity.supportedPaymentMethods.length && !identity.supportedPaymentMethods.includes(normalizeString(config.paymentMethod))) {
        errors.push({ code: "UNSUPPORTED_PAYMENT_METHOD", field: "paymentMethod" });
    }
    if (Array.isArray(config.requiredCapabilities)) {
        const missing = normalizeCapabilities(config.requiredCapabilities).filter(capability => !identity.supportedCapabilities.includes(capability));
        missing.forEach(capability => errors.push({ code: "UNSUPPORTED_CAPABILITY", capability }));
    }
    return deepFreeze({
        valid: errors.length === 0,
        errors
    });
}

function createProviderAdapter(config = {}) {
    const identity = normalizeIdentity(config);
    const handlers = isPlainObject(config.handlers) ? config.handlers : {};
    const adapter = {
        ...identity,
        createPayment: handlers.createPayment || unsupportedMethod(identity.providerId, "createPayment"),
        refreshPayment: handlers.refreshPayment || unsupportedMethod(identity.providerId, "refreshPayment"),
        cancelPayment: handlers.cancelPayment || unsupportedMethod(identity.providerId, "cancelPayment"),
        expirePayment: handlers.expirePayment || unsupportedMethod(identity.providerId, "expirePayment"),
        queryPayment: handlers.queryPayment || unsupportedMethod(identity.providerId, "queryPayment"),
        handleProviderEvent: handlers.handleProviderEvent || unsupportedMethod(identity.providerId, "handleProviderEvent"),
        normalizeProviderResponse(response, context = {}) {
            return normalizeProviderResponse(response, { provider: identity.providerId, ...context });
        },
        normalizeProviderEvent(event, context = {}) {
            return normalizeProviderEvent(event, { provider: identity.providerId, ...context });
        },
        validateConfiguration(configuration = {}) {
            return validateConfiguration(configuration, identity);
        },
        supportsCapability(capability) {
            return identity.supportedCapabilities.includes(normalizeUpper(capability));
        }
    };
    return deepFreeze(adapter);
}

module.exports = Object.freeze({
    createProviderAdapter,
    normalizeProviderResponse,
    normalizeProviderEvent,
    validateConfiguration,
    ProviderAdapterError,
    ERROR_CODES,
    CAPABILITIES,
    PAYMENT_STATUSES,
    PROVIDER_ADAPTER_VERSION
});
