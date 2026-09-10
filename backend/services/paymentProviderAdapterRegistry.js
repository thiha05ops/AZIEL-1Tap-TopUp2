const PROVIDER_ADAPTERS = Object.freeze({
    omise: Object.freeze({
        name: "omise",
        displayName: "OPN / Omise",
        supportedRails: ["AUTO_PROMPTPAY", "AUTO_CARD"],
        supportedCurrencies: ["THB"],
        checkoutModes: ["HOSTED", "REDIRECT"],
        cardNetworks: ["Visa", "Mastercard", "JCB", "UnionPay", "Amex"],
        refundCapability: true,
        partialRefundCapability: true,
        webhookRequired: true,
        methods: Object.freeze([
            "createCharge",
            "createPromptPayCharge",
            "createCardSession",
            "verifyWebhook",
            "retrieveCharge",
            "refundCharge",
            "healthCheck"
        ])
    }),
    tmw: Object.freeze({
        name: "tmw",
        displayName: "TMW Easy API",
        supportedRails: ["AUTO_PROMPTPAY"],
        supportedCurrencies: ["THB"],
        checkoutModes: ["QR"],
        cardNetworks: [],
        refundCapability: false,
        partialRefundCapability: false,
        webhookRequired: true,
        methods: Object.freeze(["createPay", "detailPay", "cancelPay", "verifyWebhook", "healthCheck"])
    })
});

function getProviderAdapter(adapterName = "") {
    return PROVIDER_ADAPTERS[String(adapterName || "").trim().toLowerCase()] || null;
}

function hasProviderAdapter(adapterName = "") {
    return Boolean(getProviderAdapter(adapterName));
}

function listProviderAdapters() {
    return Object.values(PROVIDER_ADAPTERS).map(adapter => ({
        name: adapter.name,
        displayName: adapter.displayName,
        supportedRails: adapter.supportedRails,
        supportedCurrencies: adapter.supportedCurrencies,
        checkoutModes: adapter.checkoutModes,
        cardNetworks: adapter.cardNetworks,
        refundCapability: adapter.refundCapability,
        partialRefundCapability: adapter.partialRefundCapability,
        webhookRequired: adapter.webhookRequired,
        methods: adapter.methods
    }));
}

module.exports = {
    getProviderAdapter,
    hasProviderAdapter,
    listProviderAdapters
};
