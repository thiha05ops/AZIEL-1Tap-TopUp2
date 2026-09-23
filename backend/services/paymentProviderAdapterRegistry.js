const PROVIDER_ADAPTERS = Object.freeze({
    dinger: Object.freeze({
        name: "dinger",
        displayName: "Dinger Myanmar Payments",
        supportedRails: [],
        supportedCurrencies: ["MMK"],
        checkoutModes: ["QR", "REDIRECT"],
        cardNetworks: [],
        refundCapability: false,
        partialRefundCapability: false,
        webhookRequired: true,
        customerAvailable: false,
        contractReadiness: Object.freeze({
            configuration: "REQUIRED",
            tokenContract: "CONFIRMED",
            rsaRequestEncryption: "CONFIRMED",
            payRequestTransport: "CONFIRMED",
            qrPayResponseSchema: "CONFIRMED",
            stagingRedirectContract: "CONFIRMED",
            payResponseSignatureVerification: "UNCONFIRMED",
            callbackAesDecryption: "CONFIRMED",
            callbackChecksumAuthentication: "UNCONFIRMED",
            callbackRoute: "DIAGNOSTIC_ONLY_DISABLED_DEFAULT",
            liveContract: "UNCONFIRMED",
            customerExposure: "DISABLED"
        }),
        methods: Object.freeze(["createPayment", "handleProviderEvent", "healthCheck"])
    }),
    thunder_truewallet: Object.freeze({
        name: "thunder_truewallet",
        displayName: "Thunder Verified TrueMoney Wallet",
        supportedRails: ["TRUE_MONEY_WALLET"],
        supportedCurrencies: ["THB"],
        checkoutModes: ["SLIP_UPLOAD"],
        cardNetworks: [],
        refundCapability: false,
        partialRefundCapability: false,
        webhookRequired: false,
        methods: Object.freeze(["createPayment", "verifyTrueWallet", "healthCheck"])
    }),
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
        customerAvailable: adapter.customerAvailable === true,
        contractReadiness: adapter.contractReadiness || {},
        methods: adapter.methods
    }));
}

module.exports = {
    getProviderAdapter,
    hasProviderAdapter,
    listProviderAdapters
};
