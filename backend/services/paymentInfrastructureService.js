const PaymentProviderConfig = require("../models/PaymentProviderConfig");
const { getProviderAdapter, listProviderAdapters } = require("./paymentProviderAdapterRegistry");
const { formatPaymentMethod } = require("./paymentDisplayNameService");

const RAIL_TYPES = Object.freeze({
    MANUAL_QR: "MANUAL_QR",
    MANUAL_BANK_TRANSFER: "MANUAL_BANK_TRANSFER",
    MANUAL_BANK_APP: "MANUAL_BANK_APP",
    WALLET: "WALLET",
    AUTO_PROMPTPAY: "AUTO_PROMPTPAY",
    AUTO_CARD: "AUTO_CARD"
});

const AVAILABILITY_MODES = Object.freeze({
    MANUAL_ONLY: "MANUAL_ONLY",
    AUTO_ONLY: "AUTO_ONLY",
    AUTO_WITH_MANUAL_FALLBACK: "AUTO_WITH_MANUAL_FALLBACK",
    DISABLED: "DISABLED"
});

const STATUS = Object.freeze({
    READY: "READY",
    DEGRADED: "DEGRADED",
    NOT_CONFIGURED: "NOT_CONFIGURED",
    DISABLED: "DISABLED",
    BROKEN: "BROKEN",
    LEGACY: "LEGACY",
    HIDDEN: "HIDDEN"
});

function normalizeRegion(region = "") {
    const value = String(region || "").trim().toUpperCase();
    return value === "TH" ? "TH" : value === "MM" ? "MM" : "GLOBAL";
}

function railTypeForMethod(method = {}) {
    const type = String(method.paymentType || "manual").toLowerCase();
    const key = String(method.key || "").toLowerCase();
    if (type === "wallet" || key === "wallet") return RAIL_TYPES.WALLET;
    if (type === "auto" && key === "promptpay") return RAIL_TYPES.AUTO_PROMPTPAY;
    if (type === "auto") return RAIL_TYPES.AUTO_PROMPTPAY;
    if (type === "deeplink") return RAIL_TYPES.MANUAL_BANK_APP;
    if (method.qrMode === "aziel_promptpay_dynamic" || method.qrMode === "uploaded_static" || method.qrMode === "provider_generated") {
        return RAIL_TYPES.MANUAL_QR;
    }
    return RAIL_TYPES.MANUAL_BANK_TRANSFER;
}

function availabilityModeForRail(rail = {}) {
    if (rail.enabled === false || rail.status === STATUS.DISABLED || rail.status === STATUS.HIDDEN) return AVAILABILITY_MODES.DISABLED;
    if (rail.railType === RAIL_TYPES.AUTO_PROMPTPAY || rail.railType === RAIL_TYPES.AUTO_CARD) return AVAILABILITY_MODES.AUTO_ONLY;
    return AVAILABILITY_MODES.MANUAL_ONLY;
}

function safeProviderEnvironmentStatus(env = {}) {
    return {
        environment: env.environment || "TEST",
        enabled: env.enabled === true,
        publicKeyStatus: env.publicKeyConfigured ? "Configured" : "Missing",
        secretKeyStatus: env.secretKeyConfigured ? "Configured" : "Missing",
        webhookSecretStatus: env.webhookSecretConfigured ? "Configured" : "Missing",
        merchantIdentifierStatus: env.merchantIdentifierConfigured ? "Configured" : "Missing",
        healthState: env.enabled ? env.healthState || STATUS.NOT_CONFIGURED : STATUS.DISABLED,
        lastCheckedAt: env.lastCheckedAt || null,
        webhook: {
            endpoint: "",
            secretConfigured: env.webhookSecretConfigured === true,
            lastReceivedAt: env.lastWebhookReceivedAt || null,
            lastVerifiedAt: env.lastWebhookVerifiedAt || null,
            lastEventType: env.lastWebhookEventType || "",
            lastErrorSummary: env.lastErrorSummary || "",
            replayProtectionReady: Boolean(env.webhookSecretConfigured)
        }
    };
}

function envStatusFromProcess(providerCode = "", environment = "TEST") {
    const code = String(providerCode || "").toUpperCase();
    const prefix = environment === "LIVE" ? "LIVE" : "TEST";
    if (code !== "OMISE") {
        return {
            environment,
            enabled: false,
            publicKeyConfigured: false,
            secretKeyConfigured: false,
            webhookSecretConfigured: false,
            merchantIdentifierConfigured: false,
            healthState: STATUS.NOT_CONFIGURED
        };
    }
    return {
        environment,
        enabled: false,
        publicKeyConfigured: Boolean(process.env[`${prefix}_OMISE_PUBLIC_KEY`] || process.env.OMISE_PUBLIC_KEY),
        secretKeyConfigured: Boolean(process.env[`${prefix}_OMISE_SECRET_KEY`] || process.env.OMISE_SECRET_KEY),
        webhookSecretConfigured: Boolean(process.env[`${prefix}_OMISE_WEBHOOK_SECRET`] || process.env.OMISE_WEBHOOK_SECRET),
        merchantIdentifierConfigured: Boolean(process.env[`${prefix}_OMISE_MERCHANT_ID`] || process.env.OMISE_MERCHANT_ID),
        healthState: STATUS.NOT_CONFIGURED
    };
}

function providerReadiness(provider = {}) {
    const adapter = getProviderAdapter(provider.adapterName);
    const missing = [];
    if (!adapter) missing.push("adapter");
    const environments = Array.isArray(provider.environments) && provider.environments.length
        ? provider.environments
        : [envStatusFromProcess(provider.providerCode, "TEST"), envStatusFromProcess(provider.providerCode, "LIVE")];
    const readyEnvironment = environments.find(env =>
        env.enabled === true &&
        env.publicKeyConfigured &&
        env.secretKeyConfigured &&
        env.webhookSecretConfigured
    );
    if (!readyEnvironment) missing.push("verified environment credentials");
    return {
        status: missing.length ? STATUS.NOT_CONFIGURED : STATUS.READY,
        missing,
        adapterExists: Boolean(adapter)
    };
}

function projectProvider(provider = {}) {
    const readiness = providerReadiness(provider);
    const adapter = getProviderAdapter(provider.adapterName);
    const environments = Array.isArray(provider.environments) && provider.environments.length
        ? provider.environments
        : [envStatusFromProcess(provider.providerCode, "TEST"), envStatusFromProcess(provider.providerCode, "LIVE")];
    return {
        providerCode: provider.providerCode,
        displayName: provider.displayName,
        legalRegions: provider.legalRegions || [],
        supportedCurrencies: provider.supportedCurrencies || adapter?.supportedCurrencies || [],
        supportedRails: provider.supportedRails || adapter?.supportedRails || [],
        adapterName: provider.adapterName || "",
        enabled: provider.enabled === true,
        healthState: provider.enabled ? readiness.status : STATUS.DISABLED,
        configurationReadiness: readiness.status,
        webhookReadiness: readiness.missing.includes("verified environment credentials") ? STATUS.NOT_CONFIGURED : STATUS.READY,
        refundCapability: provider.refundCapability === true || adapter?.refundCapability === true,
        partialRefundCapability: provider.partialRefundCapability === true || adapter?.partialRefundCapability === true,
        checkoutModes: provider.checkoutModes || adapter?.checkoutModes || [],
        cardNetworks: provider.cardNetworks || adapter?.cardNetworks || [],
        minAmount: Number(provider.minAmount || 0),
        maxAmount: Number(provider.maxAmount || 0),
        feeConfig: provider.feeConfig || {},
        environments: environments.map(safeProviderEnvironmentStatus),
        diagnostics: {
            adapterExists: readiness.adapterExists,
            missing: readiness.missing,
            lastCheckedAt: null
        }
    };
}

function projectManualRail(method = {}) {
    const railType = railTypeForMethod(method);
    const customerVisible = method.customerVisible === true || (
        method.customerVisible === undefined &&
        method.enabled === true &&
        method.publicReady === true &&
        !String(method.maintenanceMessage || "").trim()
    );
    const status = customerVisible ? STATUS.READY : method.enabled === true ? STATUS.DEGRADED : STATUS.DISABLED;
    return {
        id: String(method._id || method.key || ""),
        methodId: String(method._id || ""),
        key: method.key || "",
        region: normalizeRegion(method.region),
        railType,
        availabilityMode: availabilityModeForRail({ railType, enabled: method.enabled, status }),
        label: formatPaymentMethod(method, method.method || method.key || "Payment"),
        displayName: method.method || method.key || "Payment",
        enabled: method.enabled === true,
        customerVisible,
        status,
        provider: method.provider || method.key || "",
        paymentType: method.paymentType || "manual",
        qrMode: method.qrMode || "uploaded_static",
        capabilities: {
            saveQr: method.enableSaveQr === true,
            openApp: method.enableOpenApp === true,
            checklist: method.enableChecklist === true,
            receiptUpload: method.receiptUploadEnabled !== false,
            adminVerification: method.confirmationMode === "manual_admin",
            dynamicQr: method.dynamicQrSupported === true,
            bankLaunchers: Array.isArray(method.bankLaunchers) ? method.bankLaunchers.filter(item => item.enabled !== false).length : 0
        },
        diagnostics: [
            { label: "Display configured", status: method.method ? STATUS.READY : STATUS.NOT_CONFIGURED },
            { label: "Region configured", status: method.region ? STATUS.READY : STATUS.NOT_CONFIGURED },
            { label: "Receiving account configured", status: method.qrMode === "aziel_promptpay_dynamic" || (method.accountName && method.accountNumber) ? STATUS.READY : STATUS.NOT_CONFIGURED },
            { label: "QR generation available", status: method.qrMode === "aziel_promptpay_dynamic" || method.qrImageUrl || method.uploadedQrImage ? STATUS.READY : STATUS.NOT_CONFIGURED },
            { label: "Receipt upload enabled", status: method.receiptUploadEnabled !== false ? STATUS.READY : STATUS.DISABLED },
            { label: "Admin verification enabled", status: method.confirmationMode === "manual_admin" ? STATUS.READY : STATUS.DEGRADED }
        ],
        missingConfiguration: method.missingConfiguration || []
    };
}

function disabledAutoRail(region, railType, providerCode = "omise") {
    const isCard = railType === RAIL_TYPES.AUTO_CARD;
    return {
        id: `${region}:${railType}`,
        key: isCard ? "card" : "auto_promptpay",
        region,
        railType,
        availabilityMode: AVAILABILITY_MODES.DISABLED,
        label: isCard ? "Card Automatic" : "Automatic PromptPay",
        displayName: isCard ? "Card" : "Auto PromptPay",
        enabled: false,
        customerVisible: false,
        status: STATUS.NOT_CONFIGURED,
        provider: providerCode,
        environment: "TEST",
        capabilities: {
            createCharge: false,
            providerQr: !isCard,
            cardSession: isCard,
            webhook: false,
            serverVerification: false,
            autoPaid: false,
            refund: false,
            partialRefund: false,
            receiptUpload: false
        },
        diagnostics: [
            { label: "Adapter exists", status: getProviderAdapter(providerCode) ? STATUS.READY : STATUS.BROKEN },
            { label: "Provider selected", status: providerCode ? STATUS.READY : STATUS.NOT_CONFIGURED },
            { label: "Environment selected", status: STATUS.READY },
            { label: "Credentials configured", status: STATUS.NOT_CONFIGURED },
            { label: "Webhook verified", status: STATUS.NOT_CONFIGURED },
            { label: "Customer visible", status: STATUS.DISABLED }
        ],
        card: isCard ? {
            networks: ["Visa", "Mastercard", "JCB", "UnionPay", "Amex"],
            checkoutModes: ["HOSTED", "REDIRECT", "EMBEDDED"],
            threeDS: "Provider dependent",
            savedCard: false,
            tokenization: false
        } : null
    };
}

function walletRail(region = "GLOBAL") {
    return {
        id: `${region}:WALLET`,
        key: "wallet",
        region,
        railType: RAIL_TYPES.WALLET,
        availabilityMode: AVAILABILITY_MODES.MANUAL_ONLY,
        label: "AZIEL Wallet",
        displayName: "AZIEL Wallet",
        enabled: true,
        customerVisible: true,
        status: STATUS.READY,
        provider: "wallet",
        diagnostics: [
            { label: "Internal ledger", status: STATUS.READY },
            { label: "No provider credentials", status: STATUS.READY }
        ]
    };
}

function railsByRegion(methods = []) {
    const regions = {
        MM: { region: "MM", label: "Myanmar", manualRails: [], automaticRails: [], wallet: [walletRail("MM")], providers: [] },
        TH: { region: "TH", label: "Thailand", manualRails: [], automaticRails: [], wallet: [walletRail("TH")], providers: [] },
        FUTURE: { region: "FUTURE", label: "Future Regions", manualRails: [], automaticRails: [], wallet: [], providers: [] }
    };

    methods.forEach(method => {
        const rail = projectManualRail(method);
        if (rail.railType === RAIL_TYPES.WALLET) return;
        const region = regions[rail.region] || regions.FUTURE;
        if ([RAIL_TYPES.AUTO_PROMPTPAY, RAIL_TYPES.AUTO_CARD].includes(rail.railType)) region.automaticRails.push(rail);
        else region.manualRails.push(rail);
    });

    regions.TH.automaticRails.push(disabledAutoRail("TH", RAIL_TYPES.AUTO_PROMPTPAY), disabledAutoRail("TH", RAIL_TYPES.AUTO_CARD));
    regions.MM.automaticRails.push(disabledAutoRail("MM", RAIL_TYPES.AUTO_PROMPTPAY));
    return Object.values(regions);
}

async function getPaymentInfrastructureSnapshot(methods = []) {
    const providerConfigs = await PaymentProviderConfig.find({}).lean().catch(() => []);
    const providers = providerConfigs.length
        ? providerConfigs.map(projectProvider)
        : [{
            providerCode: "omise",
            displayName: "OPN / Omise",
            legalRegions: ["TH"],
            supportedCurrencies: ["THB"],
            supportedRails: ["AUTO_PROMPTPAY", "AUTO_CARD"],
            adapterName: "omise",
            enabled: false,
            environments: [envStatusFromProcess("OMISE", "TEST"), envStatusFromProcess("OMISE", "LIVE")]
        }].map(projectProvider);
    const regions = railsByRegion(methods);
    regions.forEach(region => {
        region.providers = providers.filter(provider =>
            provider.legalRegions.includes(region.region) ||
            (region.region === "FUTURE" && provider.legalRegions.length === 0)
        );
    });

    return {
        success: true,
        railTypes: Object.values(RAIL_TYPES),
        availabilityModes: Object.values(AVAILABILITY_MODES),
        statusValues: Object.values(STATUS),
        regions,
        providers,
        adapters: listProviderAdapters(),
        routing: {
            MM: { mode: AVAILABILITY_MODES.MANUAL_ONLY, primaryRail: "MANUAL_QR", fallbackRail: "", customerVisibilityUnchanged: true },
            TH: { mode: AVAILABILITY_MODES.MANUAL_ONLY, primaryRail: "MANUAL_QR", fallbackRail: "", futureMode: AVAILABILITY_MODES.AUTO_WITH_MANUAL_FALLBACK, customerVisibilityUnchanged: true }
        },
        security: {
            rawSecretsReturned: false,
            credentialDisplay: ["Missing", "Configured", "Invalid", "Test Mode", "Live Mode"],
            frontendCredentialStorage: false
        }
    };
}

module.exports = {
    AVAILABILITY_MODES,
    RAIL_TYPES,
    STATUS,
    getPaymentInfrastructureSnapshot,
    railTypeForMethod
};
