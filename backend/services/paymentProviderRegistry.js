const PROVIDERS = Object.freeze({
    promptpay: { key: "promptpay", label: "PromptPay", region: "TH", logo: "/assets/payment/promptpay.png" },
    scb: { key: "scb", label: "SCB", region: "TH", logo: "/assets/payment/scb.png" },
    bangkok_bank: { key: "bangkok_bank", label: "Bangkok Bank", region: "TH", logo: "/assets/payment/bank-neutral.svg" },
    kplus: { key: "kplus", label: "K PLUS", region: "TH", logo: "/assets/payment/bank-neutral.svg" },
    krungsri: { key: "krungsri", label: "Krungsri", region: "TH", logo: "/assets/payment/bank-neutral.svg" },
    krungthai: { key: "krungthai", label: "Krungthai NEXT", region: "TH", logo: "/assets/payment/bank-neutral.svg" },
    kbzpay: { key: "kbzpay", label: "KBZPay", region: "MM", logo: "/assets/payment/kbzpay.png" },
    wavepay: { key: "wavepay", label: "WavePay", region: "MM", logo: "/assets/payment/wavepay.png" },
    ayapay: { key: "ayapay", label: "AYA Pay", region: "MM", logo: "/assets/payment/ayapay.png" },
    mmqr: { key: "mmqr", label: "MMQR", region: "MM", logo: "/assets/payment/payment-neutral.svg" },
    manual_bank: { key: "manual_bank", label: "Manual Bank Transfer", region: "MM", logo: "/assets/payment/bank-neutral.svg" },
    wallet: { key: "wallet", label: "AZIEL Wallet", region: "GLOBAL", logo: "/assets/logo.png" }
});

const ALIASES = Object.freeze({
    omise: "promptpay",
    opnpromptpay: "promptpay",
    prompt_pay: "promptpay",
    promptpay: "promptpay",
    prompt: "promptpay",
    aya: "ayapay",
    aya_pay: "ayapay",
    kbz_pay: "kbzpay",
    wave_pay: "wavepay",
    bangkokbank: "bangkok_bank",
    bbl: "bangkok_bank",
    k_plus: "kplus",
    kasikorn: "kplus",
    krungsriapp: "krungsri",
    krungthai_next: "krungthai",
    krungthainext: "krungthai",
    ktb: "krungthai",
    manual: "manual_bank",
    bank: "manual_bank",
    aziel_wallet: "wallet",
    azielwallet: "wallet"
});

const PROVIDERS_BY_REGION_TYPE = Object.freeze({
    TH: {
        auto: ["promptpay"],
        deeplink: ["scb", "bangkok_bank", "kplus", "krungsri", "krungthai"],
        manual: ["promptpay", "scb", "bangkok_bank", "kplus", "krungsri", "krungthai"],
        wallet: ["wallet"]
    },
    MM: {
        auto: [],
        deeplink: ["kbzpay", "wavepay", "ayapay", "manual_bank"],
        manual: ["kbzpay", "wavepay", "ayapay", "mmqr", "manual_bank"],
        wallet: ["wallet"]
    }
});

function normalizeProviderKey(value = "") {
    const raw = String(value || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "")
        .replace(/-/g, "_")
        .replace(/[^a-z0-9_]/g, "");

    if (PROVIDERS[raw]) return raw;
    return ALIASES[raw] || raw;
}

function getProvider(key) {
    return PROVIDERS[normalizeProviderKey(key)] || null;
}

function getProviderLabel(key, fallback = "") {
    return getProvider(key)?.label || fallback || String(key || "");
}

function validProvidersFor(region = "MM", paymentType = "manual") {
    const regionKey = String(region || "MM").toUpperCase() === "TH" ? "TH" : "MM";
    const typeKey = ["auto", "deeplink", "wallet"].includes(String(paymentType || "").toLowerCase())
        ? String(paymentType).toLowerCase()
        : "manual";

    return (PROVIDERS_BY_REGION_TYPE[regionKey]?.[typeKey] || [])
        .map(key => PROVIDERS[key])
        .filter(Boolean);
}

function isProviderValidFor(region, paymentType, provider) {
    const key = normalizeProviderKey(provider);
    return validProvidersFor(region, paymentType).some(item => item.key === key);
}

function defaultProviderFor(region, paymentType) {
    return validProvidersFor(region, paymentType)[0]?.key || "";
}

function isEnabled(value) {
    return value === true || value === "true";
}

function enabledChecklistUses(method = {}, action = "") {
    return Array.isArray(method.checklistSteps) &&
        method.checklistSteps.some(step => step?.action === action && step.enabled !== false && step.enabled !== "false");
}

function isAzielDynamicPromptPay(method = {}) {
    return method.qrMode === "aziel_promptpay_dynamic";
}

function hasPromptPayRecipient(method = {}) {
    const type = String(method.promptPayRecipientType || "").trim().toUpperCase();
    const value = String(method.promptPayRecipientValue || "").trim();
    if (!["PHONE", "NATIONAL_ID", "TAX_ID"].includes(type)) return false;
    return Boolean(value);
}

function hasAndroidLaunchConfiguration(method = {}) {
    return Boolean(
        String(method.androidPackageName || "").trim() ||
        String(method.androidAppLaunchUrl || "").trim()
    );
}

function paymentMethodReadiness(method = {}) {
    const normalizedProvider = normalizeProviderKey(method.provider || method.key || "");
    const paymentType = String(method.paymentType || "manual").toLowerCase();
    const provider = getProvider(normalizedProvider);
    const missing = [];

    if (!String(method.method || "").trim() && !provider?.label) missing.push("display name");
    if (!isProviderValidFor(method.region, paymentType, normalizedProvider)) missing.push("valid provider");

    if (paymentType === "wallet" || normalizedProvider === "wallet") {
        return { ready: missing.length === 0, missing };
    }

    if (paymentType === "auto") {
        return { ready: missing.length === 0, missing };
    }

    const dynamicPromptPay = isAzielDynamicPromptPay(method);
    const confirmationMode = String(method.confirmationMode || "").trim();
    if (!dynamicPromptPay) {
        if (!String(method.accountName || "").trim()) missing.push("account name");
        if (!String(method.accountNumber || "").trim()) missing.push("account number");
    }
    const expectsQr = isEnabled(method.enableSaveQr) || ["manual", "deeplink"].includes(paymentType);
    const hasQr = Boolean(method.uploadedQrImage || method.qrImageUrl || method.qrImage || method.finalQrImage);
    if (expectsQr && !hasQr && !dynamicPromptPay) missing.push("QR image");
    if (dynamicPromptPay) {
        if (String(method.region || "").toUpperCase() !== "TH") missing.push("Thailand region");
        if (confirmationMode && confirmationMode !== "manual_admin") missing.push("manual admin confirmation mode");
        if (paymentType === "auto") missing.push("manual payment type");
        if (!isEnabled(method.dynamicQrSupported)) missing.push("dynamic QR supported");
        if (!isEnabled(method.amountPrefillSupported)) missing.push("amount prefill supported");
        if (!hasPromptPayRecipient(method)) missing.push("PromptPay recipient");
    }

    const openAppChecklistEnabled = enabledChecklistUses(method, "open_app");
    const openAppEnabled = isEnabled(method.enableOpenApp);
    if (openAppChecklistEnabled && !openAppEnabled) missing.push("open app enabled");

    if (openAppEnabled || openAppChecklistEnabled) {
        const openAppMode = String(method.openAppMode || "direct").toLowerCase();
        if (openAppMode === "direct") {
            if (!String(method.appDisplayName || "").trim()) missing.push("app display name");
            const appLaunchMode = String(method.appLaunchMode || "OFFICIAL_PAYMENT_DEEPLINK").toUpperCase();
            if (appLaunchMode === "APP_ONLY") {
                if (!String(method.iosAppLaunchUrl || "").trim() && !hasAndroidLaunchConfiguration(method)) missing.push("app launch URL");
                if (hasAndroidLaunchConfiguration(method) && !String(method.playStoreFallbackUrl || method.playStoreUrl || "").trim()) {
                    missing.push("Play Store fallback URL");
                }
            } else if (!String(method.deepLinkUrl || "").trim()) {
                missing.push("deep link URL");
            }
        }
    }

    if (["manual", "deeplink"].includes(paymentType)) {
        if (method.receiptUploadEnabled === false || method.receiptUploadEnabled === "false") {
            missing.push("receipt upload enabled");
        }
        if (method.slipRequired === false || method.slipRequired === "false") {
            missing.push("slip required");
        }
        if (method.confirmationMode && method.confirmationMode !== "manual_admin") {
            missing.push("manual admin confirmation mode");
        }
    }

    return { ready: missing.length === 0, missing };
}

function getPaymentLogo(method = {}) {
    const explicit = String(method.logoUrl || "").trim();
    if (explicit) return explicit;

    const provider = getProvider(method.provider || method.key || method.method);
    if (provider) return provider.logo;

    return "/assets/payment/payment-neutral.svg";
}

module.exports = {
    PAYMENT_PROVIDERS: PROVIDERS,
    normalizeProviderKey,
    getProvider,
    getProviderLabel,
    getPaymentLogo,
    validProvidersFor,
    isProviderValidFor,
    defaultProviderFor,
    paymentMethodReadiness
};
