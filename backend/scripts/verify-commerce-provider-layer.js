"use strict";

const assert = require("assert");

const {
    createProviderAdapter,
    normalizeProviderResponse,
    normalizeProviderEvent,
    ProviderAdapterError,
    ERROR_CODES: ADAPTER_ERROR_CODES,
    CAPABILITIES
} = require("../services/commerce/providerAdapter");
const {
    createProviderRegistry,
    ProviderRegistryError,
    ERROR_CODES: REGISTRY_ERROR_CODES
} = require("../services/commerce/providerRegistry");

function fakeProviderConfig(overrides = {}) {
    return {
        providerId: "fake_promptpay",
        displayName: "Fake PromptPay",
        version: "1.0.0",
        environment: "test",
        supportedCurrencies: ["THB"],
        supportedPaymentMethods: ["promptpay"],
        supportedCapabilities: [
            CAPABILITIES.CREATE_PAYMENT,
            CAPABILITIES.QUERY_PAYMENT,
            CAPABILITIES.REFRESH_PAYMENT,
            CAPABILITIES.CANCEL_PAYMENT,
            CAPABILITIES.QR_CODE,
            CAPABILITIES.WEBHOOK
        ],
        handlers: {
            async createPayment() {
                return {
                    provider: "fake_promptpay",
                    providerReference: "PREF-1",
                    status: "PENDING",
                    amount: 1490,
                    currency: "THB",
                    qr: { image: "data:image/png;base64,QR" },
                    safeMetadata: { source: "verifier" }
                };
            },
            async refreshPayment() {
                return { provider: "fake_promptpay", providerReference: "PREF-1", status: "PAID", amount: 1490, currency: "THB" };
            },
            async cancelPayment() {
                return { provider: "fake_promptpay", providerReference: "PREF-1", status: "CANCELLED", amount: 1490, currency: "THB" };
            },
            async queryPayment() {
                return { provider: "fake_promptpay", providerReference: "PREF-1", status: "PENDING", amount: 1490, currency: "THB" };
            },
            async handleProviderEvent() {
                return {
                    provider: "fake_promptpay",
                    providerReference: "PREF-1",
                    providerEventId: "evt-1",
                    paymentStatus: "PAID",
                    amount: 1490,
                    currency: "THB"
                };
            }
        },
        ...overrides
    };
}

async function assertAdapterError(fn, code, message) {
    await Promise.resolve()
        .then(fn)
        .then(() => {
            throw new Error(`Expected ${code}: ${message}`);
        })
        .catch(error => {
            assert(error instanceof ProviderAdapterError, `${message}: got ${error.name || "Error"} ${error.code || ""}`);
            assert.strictEqual(error.code, code, message);
        });
}

async function assertRegistryError(fn, code, message) {
    await Promise.resolve()
        .then(fn)
        .then(() => {
            throw new Error(`Expected ${code}: ${message}`);
        })
        .catch(error => {
            assert(error instanceof ProviderRegistryError, `${message}: got ${error.name || "Error"} ${error.code || ""}`);
            assert.strictEqual(error.code, code, message);
        });
}

async function verifyAdapterContract() {
    const adapter = createProviderAdapter(fakeProviderConfig());
    assert.strictEqual(adapter.providerId, "fake_promptpay", "provider identity preserved.");
    assert.strictEqual(adapter.supportsCapability(CAPABILITIES.CREATE_PAYMENT), true, "supported capability detected.");
    assert.strictEqual(adapter.supportsCapability(CAPABILITIES.REFUND), false, "unsupported capability returns false.");
    assert(Object.isFrozen(adapter), "adapter is frozen.");
    assert.throws(() => {
        adapter.providerId = "mutated";
    }, "adapter rejects mutation.");

    const abstractAdapter = createProviderAdapter({
        providerId: "abstract",
        supportedCurrencies: ["THB"],
        supportedPaymentMethods: ["promptpay"],
        supportedCapabilities: []
    });
    await assertAdapterError(
        () => abstractAdapter.createPayment({}),
        ADAPTER_ERROR_CODES.PAYMENT_PROVIDER_METHOD_NOT_IMPLEMENTED,
        "abstract createPayment rejects clearly"
    );
}

async function verifyNormalization() {
    const normalized = normalizeProviderResponse({
        provider: "fake_promptpay",
        providerReference: "PREF-1",
        providerTransactionId: "PTX-1",
        status: "pending",
        amount: "1490",
        currency: "thb",
        expiresAt: "2026-07-26T12:15:00.000Z",
        redirect: { url: "https://example.test/pay" },
        qr: { image: "data:image/png;base64,QR" },
        instructions: { title: "Pay" },
        metadata: {
            ok: true,
            apiKey: "secret",
            rawPayload: { never: true }
        },
        rawStatus: "waiting"
    });
    assert.strictEqual(normalized.status, "PENDING", "response status normalized.");
    assert.strictEqual(normalized.amount, 1490, "response amount normalized.");
    assert.strictEqual(normalized.currency, "THB", "response currency normalized.");
    assert.strictEqual(normalized.metadata.apiKey, undefined, "response metadata redacted.");
    assert.strictEqual(normalized.metadata.rawPayload, undefined, "raw payload redacted.");
    assert(Object.isFrozen(normalized), "normalized response is frozen.");
    assert.throws(() => {
        normalized.metadata.ok = false;
    }, "normalized response is detached/frozen.");

    const event = normalizeProviderEvent({
        provider: "fake_promptpay",
        providerReference: "PREF-1",
        providerEventId: "evt-1",
        eventType: "charge.complete",
        paymentStatus: "paid",
        amount: "1490",
        currency: "thb",
        occurredAt: "2026-07-26T12:10:00.000Z",
        metadata: { webhookSignature: "secret", safe: true }
    });
    assert.strictEqual(event.paymentStatus, "PAID", "event payment status normalized.");
    assert.strictEqual(event.metadata.webhookSignature, undefined, "event metadata redacted.");
    assert(Object.isFrozen(event), "normalized event is frozen.");

    await assertAdapterError(
        () => normalizeProviderResponse({ provider: "fake_promptpay", status: "PENDING" }),
        ADAPTER_ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID,
        "malformed response rejected"
    );
    await assertAdapterError(
        () => normalizeProviderEvent({ provider: "fake_promptpay", providerReference: "PREF-1", paymentStatus: "PAID" }),
        ADAPTER_ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID,
        "malformed event rejected"
    );
}

async function verifyRegistry() {
    const registry = createProviderRegistry();
    const summary = registry.registerProvider(fakeProviderConfig());
    assert.strictEqual(summary.providerId, "fake_promptpay", "provider registered.");
    assert.strictEqual(registry.providerExists("fake_promptpay"), true, "provider exists.");
    assert.strictEqual(registry.resolveProvider({ providerId: "fake_promptpay" }).providerId, "fake_promptpay", "resolve by provider id works.");
    assert.strictEqual(registry.resolveProvider({ paymentMethod: "promptpay" }).providerId, "fake_promptpay", "resolve by payment method works.");
    assert(registry.listProviders().some(provider => provider.providerId === "fake_promptpay"), "list providers works.");
    assert(registry.listCapabilities("fake_promptpay").includes(CAPABILITIES.CREATE_PAYMENT), "provider capabilities listed.");
    assert(registry.listCapabilities().includes(CAPABILITIES.QR_CODE), "aggregate capabilities listed.");
    registry.validateProvider({
        providerId: "fake_promptpay",
        currency: "THB",
        paymentMethod: "promptpay",
        requiredCapabilities: [CAPABILITIES.CREATE_PAYMENT]
    });
    await assertRegistryError(
        () => registry.validateProvider({ providerId: "fake_promptpay", requiredCapabilities: [CAPABILITIES.REFUND] }),
        REGISTRY_ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID,
        "unsupported capability rejected"
    );
    await assertRegistryError(
        () => registry.validateProvider({ providerId: "fake_promptpay", currency: "MMK" }),
        REGISTRY_ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID,
        "unsupported currency rejected"
    );
    await assertRegistryError(
        () => registry.validateProvider({ providerId: "fake_promptpay", paymentMethod: "wallet" }),
        REGISTRY_ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID,
        "unsupported payment method rejected"
    );
    await assertRegistryError(
        () => registry.registerProvider(fakeProviderConfig()),
        REGISTRY_ERROR_CODES.PAYMENT_PROVIDER_DUPLICATE,
        "duplicate provider rejected"
    );
    assert.strictEqual(registry.unregisterProvider("fake_promptpay"), true, "provider unregistered.");
    assert.strictEqual(registry.providerExists("fake_promptpay"), false, "provider removed.");
}

async function verifyFreezeAndInvalidProviders() {
    const registry = createProviderRegistry([fakeProviderConfig()]);
    registry.freezeRegistry();
    assert.strictEqual(registry.frozen, true, "registry frozen.");
    await assertRegistryError(
        () => registry.registerProvider(fakeProviderConfig({ providerId: "second" })),
        REGISTRY_ERROR_CODES.PAYMENT_PROVIDER_REGISTRY_FROZEN,
        "register after freeze rejected"
    );
    await assertRegistryError(
        () => registry.unregisterProvider("fake_promptpay"),
        REGISTRY_ERROR_CODES.PAYMENT_PROVIDER_REGISTRY_FROZEN,
        "unregister after freeze rejected"
    );
    await assertRegistryError(
        () => createProviderRegistry([{ providerId: "" }]),
        REGISTRY_ERROR_CODES.PAYMENT_PROVIDER_INVALID,
        "invalid provider rejected"
    );
    await assertRegistryError(
        () => createProviderRegistry([{
            providerId: "bad_shape",
            displayName: "Bad Shape",
            version: "1.0.0",
            supportedCurrencies: [],
            supportedPaymentMethods: [],
            supportedCapabilities: [],
            supportsCapability() {}
        }]),
        REGISTRY_ERROR_CODES.PAYMENT_PROVIDER_INVALID,
        "missing required methods rejected"
    );
}

async function verifyAdapterConfiguration() {
    const adapter = createProviderAdapter(fakeProviderConfig());
    assert.strictEqual(adapter.validateConfiguration({ currency: "THB", paymentMethod: "promptpay" }).valid, true, "valid configuration accepted.");
    assert.strictEqual(adapter.validateConfiguration({ currency: "MMK" }).valid, false, "invalid currency reported.");
    assert.strictEqual(adapter.validateConfiguration({ paymentMethod: "wallet" }).valid, false, "invalid payment method reported.");
    assert.strictEqual(adapter.validateConfiguration({ requiredCapabilities: [CAPABILITIES.REFUND] }).valid, false, "invalid capability reported.");
}

async function run() {
    await verifyAdapterContract();
    await verifyNormalization();
    await verifyRegistry();
    await verifyFreezeAndInvalidProviders();
    await verifyAdapterConfiguration();

    console.log("Commerce provider layer verification passed.");
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
