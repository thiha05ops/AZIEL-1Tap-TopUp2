"use strict";

const {
    createProviderAdapter,
    ProviderAdapterError,
    ERROR_CODES: ADAPTER_ERROR_CODES,
    CAPABILITIES
} = require("./providerAdapter");

const PROVIDER_REGISTRY_VERSION = "2.6.3";

const ERROR_CODES = Object.freeze({
    PAYMENT_PROVIDER_NOT_FOUND: "PAYMENT_PROVIDER_NOT_FOUND",
    PAYMENT_PROVIDER_DUPLICATE: "PAYMENT_PROVIDER_DUPLICATE",
    PAYMENT_PROVIDER_INVALID: "PAYMENT_PROVIDER_INVALID",
    PAYMENT_PROVIDER_CONFIGURATION_INVALID: "PAYMENT_PROVIDER_CONFIGURATION_INVALID",
    PAYMENT_PROVIDER_CAPABILITY_UNSUPPORTED: "PAYMENT_PROVIDER_CAPABILITY_UNSUPPORTED",
    PAYMENT_PROVIDER_RESPONSE_INVALID: "PAYMENT_PROVIDER_RESPONSE_INVALID",
    PAYMENT_PROVIDER_EVENT_INVALID: "PAYMENT_PROVIDER_EVENT_INVALID",
    PAYMENT_PROVIDER_REGISTRY_FROZEN: "PAYMENT_PROVIDER_REGISTRY_FROZEN"
});

const REQUIRED_METHODS = Object.freeze([
    "createPayment",
    "refreshPayment",
    "cancelPayment",
    "expirePayment",
    "queryPayment",
    "handleProviderEvent",
    "normalizeProviderResponse",
    "validateConfiguration",
    "supportsCapability"
]);

class ProviderRegistryError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "ProviderRegistryError";
        this.code = code;
        this.stage = normalizeString(options.stage);
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

function normalizeProviderId(value) {
    const providerId = normalizeString(value);
    if (!providerId || providerId.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(providerId)) {
        throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_INVALID, "providerId is invalid.", {
            stage: "identity",
            metadata: { field: "providerId" }
        });
    }
    return providerId;
}

function normalizePaymentMethod(value) {
    const paymentMethod = normalizeString(value);
    if (paymentMethod && (paymentMethod.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(paymentMethod))) {
        throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_INVALID, "paymentMethod is invalid.", {
            stage: "identity",
            metadata: { field: "paymentMethod" }
        });
    }
    return paymentMethod;
}

function isProviderAdapter(value) {
    return value && typeof value === "object" && normalizeString(value.providerId);
}

function ensureMutable(registry) {
    if (registry.frozen) {
        throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_REGISTRY_FROZEN, "Provider registry is frozen.", {
            stage: "registry"
        });
    }
}

function mapAdapterError(error, fallbackCode = ERROR_CODES.PAYMENT_PROVIDER_INVALID) {
    if (!(error instanceof ProviderAdapterError)) return null;
    if (error.code === ADAPTER_ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID) return ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID;
    if (error.code === ADAPTER_ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID) return ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID;
    if (error.code === ADAPTER_ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID) return ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID;
    if (error.code === ADAPTER_ERROR_CODES.PAYMENT_PROVIDER_CAPABILITY_UNSUPPORTED) return ERROR_CODES.PAYMENT_PROVIDER_CAPABILITY_UNSUPPORTED;
    return fallbackCode;
}

function wrapAdapterError(error, fallbackCode, stage) {
    const mapped = mapAdapterError(error, fallbackCode);
    if (mapped) {
        return new ProviderRegistryError(mapped, error.message, {
            stage,
            metadata: error.metadata || {}
        });
    }
    return error;
}

function validateProviderShape(provider) {
    if (!isProviderAdapter(provider)) {
        throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_INVALID, "Provider adapter is invalid.", { stage: "register" });
    }
    normalizeProviderId(provider.providerId);
    REQUIRED_METHODS.forEach(method => {
        if (typeof provider[method] !== "function") {
            throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_INVALID, "Provider adapter is missing a required method.", {
                stage: "register",
                metadata: { providerId: provider.providerId, method }
            });
        }
    });
    if (!Array.isArray(provider.supportedCurrencies)) {
        throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_INVALID, "Provider supportedCurrencies must be an array.", {
            stage: "register",
            metadata: { providerId: provider.providerId }
        });
    }
    if (!Array.isArray(provider.supportedPaymentMethods)) {
        throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_INVALID, "Provider supportedPaymentMethods must be an array.", {
            stage: "register",
            metadata: { providerId: provider.providerId }
        });
    }
    if (!Array.isArray(provider.supportedCapabilities)) {
        throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_INVALID, "Provider supportedCapabilities must be an array.", {
            stage: "register",
            metadata: { providerId: provider.providerId }
        });
    }
}

function providerSummary(provider) {
    return deepFreeze({
        providerId: provider.providerId,
        displayName: provider.displayName,
        version: provider.version,
        supportedCurrencies: clonePlain(provider.supportedCurrencies || []),
        supportedPaymentMethods: clonePlain(provider.supportedPaymentMethods || []),
        supportedCapabilities: clonePlain(provider.supportedCapabilities || []),
        environment: provider.environment
    });
}

function createProviderRegistry(initialProviders = []) {
    const state = {
        providers: new Map(),
        paymentMethodIndex: new Map(),
        frozen: false
    };

    function registerProvider(providerOrConfig) {
        ensureMutable(state);
        let provider;
        try {
            provider = isProviderAdapter(providerOrConfig) && typeof providerOrConfig.supportsCapability === "function"
                ? providerOrConfig
                : createProviderAdapter(providerOrConfig);
            validateProviderShape(provider);
        } catch (error) {
            if (error instanceof ProviderRegistryError) throw error;
            throw wrapAdapterError(error, ERROR_CODES.PAYMENT_PROVIDER_INVALID, "register");
        }
        if (state.providers.has(provider.providerId)) {
            throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_DUPLICATE, "Provider is already registered.", {
                stage: "register",
                metadata: { providerId: provider.providerId }
            });
        }
        state.providers.set(provider.providerId, provider);
        (provider.supportedPaymentMethods || []).forEach(method => {
            const key = normalizePaymentMethod(method);
            if (key && !state.paymentMethodIndex.has(key)) state.paymentMethodIndex.set(key, provider.providerId);
        });
        return providerSummary(provider);
    }

    function unregisterProvider(providerId) {
        ensureMutable(state);
        const normalized = normalizeProviderId(providerId);
        const provider = state.providers.get(normalized);
        if (!provider) return false;
        state.providers.delete(normalized);
        [...state.paymentMethodIndex.entries()].forEach(([method, mappedProviderId]) => {
            if (mappedProviderId === normalized) state.paymentMethodIndex.delete(method);
        });
        return true;
    }

    function providerExists(providerId) {
        return state.providers.has(normalizeProviderId(providerId));
    }

    function resolveProvider(input = {}) {
        const providerId = normalizeString(input.providerId || input.provider || input.intent?.provider || input.payment?.provider);
        const paymentMethod = normalizeString(input.paymentMethod || input.paymentMethodId || input.intent?.paymentMethodId || input.payment?.paymentMethodId);
        let resolvedId = providerId;
        if (!resolvedId && paymentMethod) resolvedId = state.paymentMethodIndex.get(normalizePaymentMethod(paymentMethod));
        if (!resolvedId || !state.providers.has(resolvedId)) {
            throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_NOT_FOUND, "Provider could not be resolved.", {
                stage: "resolve",
                metadata: { providerId, paymentMethod }
            });
        }
        return state.providers.get(resolvedId);
    }

    function listProviders() {
        return deepFreeze([...state.providers.values()].map(providerSummary));
    }

    function listCapabilities(providerId = "") {
        if (providerId) return clonePlain(resolveProvider({ providerId }).supportedCapabilities || []);
        const capabilities = new Set();
        state.providers.forEach(provider => {
            (provider.supportedCapabilities || []).forEach(capability => capabilities.add(capability));
        });
        return deepFreeze([...capabilities].sort());
    }

    function validateProvider(input = {}) {
        const provider = resolveProvider(input);
        const currency = normalizeString(input.currency || input.intent?.currency).toUpperCase();
        const paymentMethod = normalizeString(input.paymentMethod || input.paymentMethodId || input.intent?.paymentMethodId);
        const requiredCapabilities = Array.isArray(input.requiredCapabilities) ? input.requiredCapabilities : [];
        const configResult = provider.validateConfiguration({
            currency,
            paymentMethod,
            requiredCapabilities
        });
        if (!configResult.valid) {
            throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "Provider configuration is invalid for this payment.", {
                stage: "validate",
                metadata: { providerId: provider.providerId, errors: configResult.errors }
            });
        }
        requiredCapabilities.forEach(capability => {
            const normalized = normalizeUpper(capability);
            if (!provider.supportsCapability(normalized)) {
                throw new ProviderRegistryError(ERROR_CODES.PAYMENT_PROVIDER_CAPABILITY_UNSUPPORTED, "Provider capability is unsupported.", {
                    stage: "validate",
                    metadata: { providerId: provider.providerId, capability: normalized }
                });
            }
        });
        return providerSummary(provider);
    }

    function freezeRegistry() {
        state.frozen = true;
        return true;
    }

    const registry = {
        registerProvider,
        unregisterProvider,
        resolveProvider,
        listProviders,
        providerExists,
        listCapabilities,
        validateProvider,
        freezeRegistry,
        get frozen() {
            return state.frozen;
        }
    };

    initialProviders.forEach(registerProvider);
    return registry;
}

module.exports = Object.freeze({
    createProviderRegistry,
    ProviderRegistryError,
    ERROR_CODES,
    CAPABILITIES,
    REQUIRED_METHODS,
    PROVIDER_REGISTRY_VERSION
});
