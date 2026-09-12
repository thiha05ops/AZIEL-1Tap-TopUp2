const PROVIDER_ADAPTERS = Object.freeze({
    thunder_promptpay: Object.freeze({
        name: "thunder_promptpay",
        displayName: "Thunder Verified PromptPay",
        supportedRails: ["MANUAL_QR"],
        supportedCurrencies: ["THB"],
        checkoutModes: ["SLIP_UPLOAD"],
        cardNetworks: [],
        refundCapability: false,
        partialRefundCapability: false,
        webhookRequired: false,
        methods: Object.freeze(["createPayment", "verifyBankSlip", "healthCheck"])
    }),
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
