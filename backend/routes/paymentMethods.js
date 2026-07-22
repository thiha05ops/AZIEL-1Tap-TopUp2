const express = require("express");
const { Readable } = require("stream");
const router = express.Router();

const PaymentMethod = require("../models/PaymentMethod");
const ManualPaymentAttempt = require("../models/ManualPaymentAttempt");
const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const paymentQrUpload = require("../middleware/paymentQrUpload");
const {
    StorageError,
    logStorageError,
    uploadFile
} = require("../services/storageService");
const { formatPaymentMethod } = require("../services/paymentDisplayNameService");
const {
    defaultProviderFor,
    getPaymentLogo,
    getProviderLabel,
    isProviderValidFor,
    normalizeProviderKey,
    paymentMethodReadiness,
    validProvidersFor
} = require("../services/paymentProviderRegistry");
const authMiddleware = require("../middleware/authMiddleware");
const {
    createPromptPayQr,
    maskPromptPayRecipient
} = require("../services/promptPayQrService");

const CANONICAL_PROVIDER_BY_KEY = Object.freeze({
    promptpay: "promptpay",
    scb: "scb",
    bangkok_bank: "bangkok_bank",
    kplus: "kplus",
    krungsri: "krungsri",
    krungthai: "krungthai",
    wallet: "wallet",
    kbzpay: "kbzpay",
    wavepay: "wavepay",
    ayapay: "ayapay",
    mmqr: "mmqr",
    manual_bank: "manual_bank"
});

const CHECKLIST_ACTIONS = new Set([
    "save_qr",
    "open_app",
    "scan_saved_qr",
    "upload_receipt",
    "wait_for_confirmation",
    "confirm_payment"
]);

const OPEN_APP_MODES = new Set(["direct", "bank_chooser", "disabled"]);
const THAI_PROMPTPAY_LAUNCHER_KEYS = new Set(["scb", "bangkok_bank", "krungsri", "krungthai"]);
const THAI_STANDALONE_BANK_KEYS = new Set(["scb", "bangkok_bank", "kplus", "krungsri", "krungthai"]);
const PUBLIC_LAUNCHER_STATUSES = new Set(["", "verified", "usable", "ready", "active"]);

const defaultPromptPayBankLaunchers = Object.freeze([
    {
        key: "scb",
        displayName: "SCB EASY",
        logoUrl: "/assets/payment/scb.png",
        enabled: true,
        sortOrder: 10,
        androidPackageName: "com.scb.phone",
        androidAppLaunchUrl: "intent://#Intent;scheme=scbeasy;package=com.scb.phone;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.scb.phone;end",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.scb.phone",
        iosAppLaunchUrl: "scbeasy://",
        appStoreFallbackUrl: "",
        verificationStatus: "verified",
        operatorNotes: "Launcher opens SCB EASY for gallery QR scan guidance."
    },
    {
        key: "bangkok_bank",
        displayName: "Bangkok Bank Mobile Banking",
        logoUrl: "/assets/payment/bank-neutral.svg",
        enabled: true,
        sortOrder: 20,
        androidPackageName: "com.bbl.mobilebanking",
        androidAppLaunchUrl: "intent://#Intent;scheme=bualuangmbanking;package=com.bbl.mobilebanking;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.bbl.mobilebanking;end",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.bbl.mobilebanking",
        iosAppLaunchUrl: "bualuangmbanking://",
        appStoreFallbackUrl: "",
        verificationStatus: "verified",
        operatorNotes: "Launcher opens Bangkok Bank app for gallery QR scan guidance."
    },
    {
        key: "krungsri",
        displayName: "Krungsri",
        logoUrl: "/assets/payment/bank-neutral.svg",
        enabled: true,
        sortOrder: 30,
        androidPackageName: "com.krungsri.kma",
        androidAppLaunchUrl: "intent://openpage-landing#Intent;scheme=krungsri-kma;package=com.krungsri.kma;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.krungsri.kma;end",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.krungsri.kma",
        iosAppLaunchUrl: "krungsri-kma://openpage-landing",
        appStoreFallbackUrl: "",
        verificationStatus: "verified",
        operatorNotes: "Launcher opens Krungsri for gallery QR scan guidance."
    },
    {
        key: "krungthai",
        displayName: "Krungthai NEXT",
        logoUrl: "/assets/payment/bank-neutral.svg",
        enabled: true,
        sortOrder: 40,
        androidPackageName: "ktbcs.netbank",
        androidAppLaunchUrl: "intent://#Intent;scheme=ktb-next;package=ktbcs.netbank;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dktbcs.netbank;end",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=ktbcs.netbank",
        iosAppLaunchUrl: "ktbnext://",
        appStoreFallbackUrl: "",
        verificationStatus: "verified",
        operatorNotes: "Launcher opens Krungthai NEXT for gallery QR scan guidance."
    }
]);

const defaultMethods = [
    {
        method: "KBZPay",
        key: "kbzpay",
        region: "MM",
        paymentType: "manual",
        provider: "kbzpay"
    },
    {
        method: "WavePay",
        key: "wavepay",
        region: "MM",
        paymentType: "manual",
        provider: "wavepay"
    },
    {
        method: "AYA Pay",
        key: "ayapay",
        region: "MM",
        paymentType: "manual",
        provider: "ayapay"
    },
    {
        method: "PromptPay QR",
        key: "promptpay",
        region: "TH",
        paymentType: "manual",
        provider: "promptpay",
        qrMode: "aziel_promptpay_dynamic",
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        openAppMode: "bank_chooser",
        appLaunchMode: "APP_ONLY",
        badgeText: "QR",
        shortDescription: "Pay with any Thai banking app",
        appDisplayName: "Banking App",
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        dynamicQrSupported: true,
        amountPrefillSupported: true,
        referenceSupported: true,
        galleryScanSupported: true,
        slipRequired: true,
        autoVerificationSupported: false,
        webhookSupported: false,
        checklistSteps: [
            { key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 },
            { key: "open_app", label: "Open Banking App", action: "open_app", enabled: true, sortOrder: 20 },
            { key: "scan_saved_qr", label: "Scan the saved QR and pay", action: "scan_saved_qr", enabled: true, sortOrder: 30 },
            { key: "upload_receipt", label: "Upload payment receipt", action: "upload_receipt", enabled: true, sortOrder: 40 }
        ],
        bankLaunchers: defaultPromptPayBankLaunchers,
        sortOrder: 10
    },
    {
        method: "SCB",
        key: "scb",
        region: "TH",
        paymentType: "deeplink",
        provider: "scb",
        appDisplayName: "SCB EASY",
        qrMode: "aziel_promptpay_dynamic",
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        openAppMode: "direct",
        iosAppLaunchUrl: "scbeasy://",
        badgeText: "Bank App",
        shortDescription: "Pay using SCB EASY",
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        dynamicQrSupported: true,
        amountPrefillSupported: true,
        referenceSupported: true,
        galleryScanSupported: true,
        slipRequired: true,
        autoVerificationSupported: false,
        webhookSupported: false,
        checklistSteps: [
            { key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 },
            { key: "open_app", label: "Open SCB EASY", action: "open_app", enabled: true, sortOrder: 20 },
            { key: "upload_receipt", label: "Upload receipt", action: "upload_receipt", enabled: true, sortOrder: 30 }
        ],
        sortOrder: 20
    },
    {
        method: "Bangkok Bank",
        key: "bangkok_bank",
        region: "TH",
        paymentType: "deeplink",
        provider: "bangkok_bank",
        appDisplayName: "Bangkok Bank Mobile Banking",
        qrMode: "aziel_promptpay_dynamic",
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        openAppMode: "direct",
        androidPackageName: "com.bbl.mobilebanking",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.bbl.mobilebanking",
        badgeText: "Bank App",
        shortDescription: "Pay using Bangkok Bank Mobile Banking",
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        dynamicQrSupported: true,
        amountPrefillSupported: true,
        referenceSupported: true,
        galleryScanSupported: true,
        slipRequired: true,
        autoVerificationSupported: false,
        webhookSupported: false,
        checklistSteps: [
            { key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 },
            { key: "open_app", label: "Open Bangkok Bank Mobile Banking", action: "open_app", enabled: true, sortOrder: 20 },
            { key: "upload_receipt", label: "Upload receipt", action: "upload_receipt", enabled: true, sortOrder: 30 }
        ],
        sortOrder: 30
    },
    {
        method: "K PLUS",
        key: "kplus",
        region: "TH",
        enabled: false,
        paymentType: "deeplink",
        provider: "kplus",
        appDisplayName: "K PLUS",
        qrMode: "aziel_promptpay_dynamic",
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        openAppMode: "direct",
        androidPackageName: "com.kasikorn.retail.mbanking.wap",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.kasikorn.retail.mbanking.wap",
        badgeText: "Bank App",
        shortDescription: "Pay using the K PLUS mobile app",
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        dynamicQrSupported: true,
        amountPrefillSupported: true,
        referenceSupported: true,
        galleryScanSupported: true,
        slipRequired: true,
        autoVerificationSupported: false,
        webhookSupported: false,
        checklistSteps: [
            { key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 },
            { key: "open_app", label: "Open K PLUS", action: "open_app", enabled: true, sortOrder: 20 },
            { key: "upload_receipt", label: "Upload receipt", action: "upload_receipt", enabled: true, sortOrder: 30 }
        ],
        sortOrder: 40
    },
    {
        method: "Krungsri",
        key: "krungsri",
        region: "TH",
        paymentType: "deeplink",
        provider: "krungsri",
        appDisplayName: "Krungsri app",
        qrMode: "aziel_promptpay_dynamic",
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        openAppMode: "direct",
        androidPackageName: "com.krungsri.kma",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.krungsri.kma",
        badgeText: "Bank App",
        shortDescription: "Pay using the Krungsri app",
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        dynamicQrSupported: true,
        amountPrefillSupported: true,
        referenceSupported: true,
        galleryScanSupported: true,
        slipRequired: true,
        autoVerificationSupported: false,
        webhookSupported: false,
        checklistSteps: [
            { key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 },
            { key: "open_app", label: "Open Krungsri app", action: "open_app", enabled: true, sortOrder: 20 },
            { key: "upload_receipt", label: "Upload receipt", action: "upload_receipt", enabled: true, sortOrder: 30 }
        ],
        sortOrder: 50
    },
    {
        method: "Krungthai NEXT",
        key: "krungthai",
        region: "TH",
        paymentType: "deeplink",
        provider: "krungthai",
        appDisplayName: "Krungthai NEXT",
        qrMode: "aziel_promptpay_dynamic",
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        openAppMode: "direct",
        iosAppLaunchUrl: "ktbnext://",
        androidPackageName: "ktbcs.netbank",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=ktbcs.netbank",
        badgeText: "Bank App",
        shortDescription: "Pay using Krungthai NEXT",
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        dynamicQrSupported: true,
        amountPrefillSupported: true,
        referenceSupported: true,
        galleryScanSupported: true,
        slipRequired: true,
        autoVerificationSupported: false,
        webhookSupported: false,
        checklistSteps: [
            { key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 },
            { key: "open_app", label: "Open Krungthai NEXT", action: "open_app", enabled: true, sortOrder: 20 },
            { key: "upload_receipt", label: "Upload receipt", action: "upload_receipt", enabled: true, sortOrder: 30 }
        ],
        sortOrder: 60
    },
    {
        method: "AZIEL Wallet",
        key: "wallet",
        region: "TH",
        paymentType: "wallet",
        provider: "wallet",
        slipRequired: false,
        qrMode: "none",
        receiptUploadEnabled: false,
        confirmationMode: "wallet_internal",
        badgeText: "Wallet",
        shortDescription: "Pay instantly with AZIEL Wallet",
        enabled: true,
        sortOrder: 90
    }
];

function isSlipRequired(method = {}) {
    if (typeof method.slipRequired === "boolean") return method.slipRequired;
    return ["manual", "deeplink"].includes(String(method.paymentType || "manual").toLowerCase());
}

function safeText(value = "", max = 160) {
    return String(value || "").trim().slice(0, max);
}

function safeSortOrder(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function safeUrl(value = "", options = {}) {
    const url = safeText(value, 500);
    if (!url) return "";

    if (options.deeplink) {
        if (/^(https?:\/\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(url)) return url;
        return "";
    }

    if (/^https:\/\//i.test(url)) return url;
    return "";
}

function safeAndroidPackageName(value = "") {
    const packageName = safeText(value, 160).toLowerCase();
    if (!packageName) return "";
    return /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(packageName) ? packageName : "";
}

function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function safePositiveInt(value, fallback = 15, max = 1440) {
    const number = Math.trunc(Number(value));
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.min(number, max);
}

function safePromptPayRecipientType(value = "") {
    const type = String(value || "").trim().toUpperCase();
    return ["PHONE", "NATIONAL_ID", "TAX_ID"].includes(type) ? type : "";
}

function safeDownloadFilePart(value = "payment") {
    return String(value || "payment")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "payment";
}

function isTrustedCloudinaryQrUrl(value = "", env = process.env) {
    try {
        const parsed = new URL(String(value || ""));
        if (parsed.protocol !== "https:") return false;
        if (parsed.hostname !== "res.cloudinary.com") return false;

        const cloudName = String(env.CLOUDINARY_CLOUD_NAME || "").trim();
        if (!cloudName) return true;

        const firstPathPart = parsed.pathname.split("/").filter(Boolean)[0] || "";
        return firstPathPart === cloudName;
    } catch (error) {
        return false;
    }
}

function qrDownloadFilename(method = {}, reference = "") {
    const methodKey = safeDownloadFilePart(method.key || method.provider || method.method || "payment");
    const referencePart = safeDownloadFilePart(reference || "qr");
    return `aziel-${methodKey}-${referencePart}.png`;
}

function getConfiguredQrUrl(method = {}) {
    return method.uploadedQrImage || method.qrImageUrl || method.qrImage || "";
}

function canonicalMethodDefaults(item = {}) {
    return {
        method: item.method,
        region: item.region,
        paymentType: item.paymentType || "manual",
        provider: normalizeProviderKey(item.provider || item.key || ""),
        sortOrder: safeSortOrder(item.sortOrder)
    };
}

function applySeedDefaultIfMissing(method, key, value) {
    if (value === undefined) return;

    if (typeof value === "boolean") {
        if (typeof method[key] !== "boolean") method[key] = value;
        return;
    }

    if (typeof value === "number") {
        if (!Number.isFinite(Number(method[key]))) method[key] = value;
        return;
    }

    if (method[key] === undefined || method[key] === null) {
        method[key] = value;
    }
}

function applySeedDefaultsWithoutOverwriting(method, item = {}) {
    method.provider = canonicalProviderForMethod(method, item.provider);

    [
        "appDisplayName",
        "enableSaveQr",
        "enableOpenApp",
        "enableChecklist",
        "dynamicQrSupported",
        "amountPrefillSupported",
        "referenceSupported",
        "galleryScanSupported",
        "slipRequired",
        "autoVerificationSupported",
        "webhookSupported",
        "shortDescription",
        "badgeText",
        "qrMode",
        "openAppMode",
        "appLaunchMode",
        "iosAppLaunchUrl",
        "androidAppLaunchUrl",
        "androidPackageName",
        "appStoreFallbackUrl",
        "playStoreFallbackUrl",
        "promptPayRecipientType",
        "promptPayRecipientValue",
        "receiptUploadEnabled",
        "confirmationMode",
        "bankLaunchers",
        "sortOrder"
    ].forEach(key => {
        applySeedDefaultIfMissing(method, key, item[key]);
    });

    if (!method.checklistSteps?.length) {
        method.checklistSteps = item.checklistSteps || [];
    }
}

function canonicalProviderForMethod(method = {}, fallback = "") {
    const key = String(method.key || "").trim().toLowerCase();
    if (CANONICAL_PROVIDER_BY_KEY[key]) return CANONICAL_PROVIDER_BY_KEY[key];
    const normalized = normalizeProviderKey(fallback || method.provider || "");
    return normalized || defaultProviderFor(method.region, method.paymentType) || "";
}

function safeOpenAppMode(value = "", fallback = "disabled") {
    const mode = String(value || "").trim().toLowerCase();
    return OPEN_APP_MODES.has(mode) ? mode : fallback;
}

function applyCompatibilityModes(method) {
    const key = String(method.key || "").toLowerCase();
    const provider = canonicalProviderForMethod(method);
    method.provider = provider;

    if (key === "promptpay" && method.qrMode !== "aziel_promptpay_dynamic") {
        method.paymentType = "auto";
        method.qrMode = "provider_generated";
        method.slipRequired = false;
        method.receiptUploadEnabled = false;
        method.autoVerificationSupported = true;
        method.webhookSupported = true;
        method.confirmationMode = ["provider_webhook", "automatic_provider"].includes(method.confirmationMode)
            ? method.confirmationMode
            : "provider_webhook";
        method.openAppMode = method.enableOpenApp === true ? safeOpenAppMode(method.openAppMode, "bank_chooser") : "disabled";
    } else if (provider === "wallet") {
        method.paymentType = "wallet";
        method.qrMode = "none";
        method.slipRequired = false;
        method.receiptUploadEnabled = false;
        method.enableSaveQr = false;
        method.enableOpenApp = false;
        method.enableChecklist = false;
        method.autoVerificationSupported = false;
        method.webhookSupported = false;
        method.confirmationMode = "wallet_internal";
        method.openAppMode = "disabled";
    } else if (["manual", "deeplink"].includes(String(method.paymentType || "").toLowerCase())) {
        method.receiptUploadEnabled = method.receiptUploadEnabled !== false;
        method.slipRequired = method.slipRequired !== false;
        method.autoVerificationSupported = false;
        method.webhookSupported = false;
        method.confirmationMode = "manual_admin";
        method.openAppMode = method.enableOpenApp === true ? safeOpenAppMode(method.openAppMode, "direct") : "disabled";
        if (!["provider_generated", "uploaded_static", "aziel_promptpay_dynamic", "none"].includes(method.qrMode)) {
            method.qrMode = "uploaded_static";
        }
    }

    return method;
}

function applyPromptPayConsolidation(method) {
    if (String(method.key || "").toLowerCase() !== "promptpay" || String(method.region || "").toUpperCase() !== "TH") {
        return method;
    }

    method.method = "PromptPay QR";
    method.paymentType = "manual";
    method.provider = "promptpay";
    method.qrMode = "aziel_promptpay_dynamic";
    method.receiptUploadEnabled = true;
    method.confirmationMode = "manual_admin";
    method.openAppMode = "bank_chooser";
    method.appLaunchMode = "APP_ONLY";
    method.badgeText = method.badgeText || "QR";
    method.shortDescription = method.shortDescription || "Pay with any Thai banking app";
    method.appDisplayName = method.appDisplayName || "Banking App";
    method.enableSaveQr = true;
    method.enableOpenApp = true;
    method.enableChecklist = true;
    method.dynamicQrSupported = true;
    method.amountPrefillSupported = true;
    method.referenceSupported = true;
    method.galleryScanSupported = true;
    method.slipRequired = true;
    method.autoVerificationSupported = false;
    method.webhookSupported = false;
    method.checklistSteps = [
        { key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 },
        { key: "open_app", label: "Open Banking App", action: "open_app", enabled: true, sortOrder: 20 },
        { key: "scan_saved_qr", label: "Scan the saved QR and pay", action: "scan_saved_qr", enabled: true, sortOrder: 30 },
        { key: "upload_receipt", label: "Upload payment receipt", action: "upload_receipt", enabled: true, sortOrder: 40 }
    ];
    return method;
}

function sanitizeChecklistSteps(value = []) {
    if (!Array.isArray(value)) return [];

    return value
        .slice(0, 8)
        .map(step => {
            const action = safeText(step?.action, 40);
            if (!CHECKLIST_ACTIONS.has(action)) return null;

            const key = safeText(step?.key || action, 60)
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, "_");

            return {
                key: key || action,
                label: safeText(step?.label || action.replaceAll("_", " "), 80),
                action,
                enabled: step?.enabled !== false,
                sortOrder: safeSortOrder(step?.sortOrder)
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.sortOrder - b.sortOrder);
}

function sanitizeBankLaunchers(value = []) {
    if (!Array.isArray(value)) return [];

    const seen = new Set();
    return value
        .slice(0, 12)
        .map(item => {
            const key = normalizeProviderKey(item?.key || "");
            if (!THAI_PROMPTPAY_LAUNCHER_KEYS.has(key) || seen.has(key)) return null;
            seen.add(key);

            const androidPackageName = safeAndroidPackageName(item?.androidPackageName || "");
            const androidAppLaunchUrl = safeUrl(item?.androidAppLaunchUrl || "", { deeplink: true });
            const playStoreFallbackUrl = safeUrl(item?.playStoreFallbackUrl || item?.playStoreUrl || "");
            const iosAppLaunchUrl = safeUrl(item?.iosAppLaunchUrl || "", { deeplink: true });
            const appStoreFallbackUrl = safeUrl(item?.appStoreFallbackUrl || item?.appStoreUrl || "");
            const verificationStatus = safeText(item?.verificationStatus || "verified", 40).toLowerCase();

            return {
                key,
                displayName: safeText(item?.displayName || item?.appDisplayName || getProviderLabel(key, "Banking App"), 80),
                logoUrl: safePublicAssetUrl(item?.logoUrl || item?.logo || "") || getPaymentLogo({ key, provider: key }),
                enabled: item?.enabled !== false && item?.enabled !== "false",
                sortOrder: safeSortOrder(item?.sortOrder),
                androidPackageName,
                androidAppLaunchUrl,
                playStoreFallbackUrl,
                iosAppLaunchUrl,
                appStoreFallbackUrl,
                verificationStatus: verificationStatus || "verified",
                sourcePaymentMethodKey: key,
                legacyPaymentMethodId: safeText(item?.legacyPaymentMethodId || "", 80),
                operatorNotes: safeText(item?.operatorNotes || "", 240)
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
}

function launcherFromPaymentMethod(method = {}, fallback = {}) {
    const obj = typeof method.toObject === "function" ? method.toObject() : method;
    const key = normalizeProviderKey(obj.key || obj.provider || fallback.key || "");
    const fallbackUrl = fallback.playStoreFallbackUrl || "";
    return sanitizeBankLaunchers([{
        key,
        displayName: obj.appDisplayName || obj.method || fallback.displayName || getProviderLabel(key, "Banking App"),
        logoUrl: obj.logoUrl || fallback.logoUrl || "",
        enabled: key !== "kplus" && obj.enabled === true && obj.enableOpenApp === true,
        sortOrder: obj.sortOrder || fallback.sortOrder || 0,
        androidPackageName: obj.androidPackageName || fallback.androidPackageName || "",
        androidAppLaunchUrl: obj.androidAppLaunchUrl || fallback.androidAppLaunchUrl || "",
        playStoreFallbackUrl: obj.playStoreFallbackUrl || obj.playStoreUrl || fallbackUrl,
        iosAppLaunchUrl: obj.iosAppLaunchUrl || fallback.iosAppLaunchUrl || "",
        appStoreFallbackUrl: obj.appStoreFallbackUrl || obj.appStoreUrl || fallback.appStoreFallbackUrl || "",
        verificationStatus: obj.launcherVerificationStatus || fallback.verificationStatus || "verified",
        sourcePaymentMethodKey: key,
        legacyPaymentMethodId: obj._id ? String(obj._id) : "",
        operatorNotes: obj.launcherOperatorNotes || fallback.operatorNotes || ""
    }])[0] || null;
}

function mergePromptPayLaunchers(existing = [], derived = []) {
    const byKey = new Map();
    sanitizeBankLaunchers(defaultPromptPayBankLaunchers).forEach(item => {
        byKey.set(item.key, { ...item });
    });
    sanitizeBankLaunchers(derived).forEach(item => {
        byKey.set(item.key, { ...byKey.get(item.key), ...item });
    });
    sanitizeBankLaunchers(existing).forEach(item => {
        byKey.set(item.key, { ...byKey.get(item.key), ...item });
    });
    return sanitizeBankLaunchers(Array.from(byKey.values()))
        .filter(item => item.key !== "kplus");
}

async function syncPromptPayBankLaunchers() {
    const promptPay = await PaymentMethod.findOne({ key: "promptpay", region: "TH" });
    if (!promptPay) return;

    const beforeState = JSON.stringify({
        method: promptPay.method,
        paymentType: promptPay.paymentType,
        provider: promptPay.provider,
        qrMode: promptPay.qrMode,
        receiptUploadEnabled: promptPay.receiptUploadEnabled,
        confirmationMode: promptPay.confirmationMode,
        openAppMode: promptPay.openAppMode,
        appLaunchMode: promptPay.appLaunchMode,
        enableSaveQr: promptPay.enableSaveQr,
        enableOpenApp: promptPay.enableOpenApp,
        enableChecklist: promptPay.enableChecklist,
        dynamicQrSupported: promptPay.dynamicQrSupported,
        amountPrefillSupported: promptPay.amountPrefillSupported,
        referenceSupported: promptPay.referenceSupported,
        galleryScanSupported: promptPay.galleryScanSupported,
        slipRequired: promptPay.slipRequired,
        autoVerificationSupported: promptPay.autoVerificationSupported,
        webhookSupported: promptPay.webhookSupported,
        promptPayRecipientType: promptPay.promptPayRecipientType,
        promptPayRecipientValue: promptPay.promptPayRecipientValue,
        bankLaunchers: sanitizeBankLaunchers(promptPay.bankLaunchers || [])
    });

    const legacyBanks = await PaymentMethod.find({
        region: "TH",
        key: { $in: Array.from(THAI_PROMPTPAY_LAUNCHER_KEYS) }
    });

    const derived = legacyBanks
        .map(bank => {
            const fallback = defaultPromptPayBankLaunchers.find(item => item.key === bank.key) || {};
            return launcherFromPaymentMethod(bank, fallback);
        })
        .filter(Boolean);

    const merged = mergePromptPayLaunchers(promptPay.bankLaunchers || [], derived);
    const recipientSource = legacyBanks.find(bank =>
        String(bank.qrMode || "") === "aziel_promptpay_dynamic" &&
        String(bank.promptPayRecipientType || "").trim() &&
        String(bank.promptPayRecipientValue || "").trim()
    );

    if (!String(promptPay.promptPayRecipientType || "").trim() && recipientSource?.promptPayRecipientType) {
        promptPay.promptPayRecipientType = recipientSource.promptPayRecipientType;
    }
    if (!String(promptPay.promptPayRecipientValue || "").trim() && recipientSource?.promptPayRecipientValue) {
        promptPay.promptPayRecipientValue = recipientSource.promptPayRecipientValue;
    }

    applyPromptPayConsolidation(promptPay);
    promptPay.bankLaunchers = merged;

    const afterState = JSON.stringify({
        method: promptPay.method,
        paymentType: promptPay.paymentType,
        provider: promptPay.provider,
        qrMode: promptPay.qrMode,
        receiptUploadEnabled: promptPay.receiptUploadEnabled,
        confirmationMode: promptPay.confirmationMode,
        openAppMode: promptPay.openAppMode,
        appLaunchMode: promptPay.appLaunchMode,
        enableSaveQr: promptPay.enableSaveQr,
        enableOpenApp: promptPay.enableOpenApp,
        enableChecklist: promptPay.enableChecklist,
        dynamicQrSupported: promptPay.dynamicQrSupported,
        amountPrefillSupported: promptPay.amountPrefillSupported,
        referenceSupported: promptPay.referenceSupported,
        galleryScanSupported: promptPay.galleryScanSupported,
        slipRequired: promptPay.slipRequired,
        autoVerificationSupported: promptPay.autoVerificationSupported,
        webhookSupported: promptPay.webhookSupported,
        promptPayRecipientType: promptPay.promptPayRecipientType,
        promptPayRecipientValue: promptPay.promptPayRecipientValue,
        bankLaunchers: sanitizeBankLaunchers(promptPay.bankLaunchers || [])
    });

    if (beforeState !== afterState) {
        await promptPay.save();
    }
}

function capabilityProjection(obj = {}) {
    return {
        appDisplayName: obj.appDisplayName || "",
        openAppMode: safeOpenAppMode(obj.openAppMode, obj.enableOpenApp === true ? "direct" : "disabled"),
        deepLinkUrl: obj.deepLinkUrl || "",
        appStoreUrl: obj.appStoreUrl || "",
        playStoreUrl: obj.playStoreUrl || "",
        appLaunchMode: obj.appLaunchMode || "OFFICIAL_PAYMENT_DEEPLINK",
        iosAppLaunchUrl: obj.iosAppLaunchUrl || "",
        androidAppLaunchUrl: obj.androidAppLaunchUrl || "",
        androidPackageName: obj.androidPackageName || "",
        appStoreFallbackUrl: obj.appStoreFallbackUrl || obj.appStoreUrl || "",
        playStoreFallbackUrl: obj.playStoreFallbackUrl || obj.playStoreUrl || "",
        promptPayRecipientType: obj.promptPayRecipientType || "",
        promptPayRecipientMasked: maskPromptPayRecipient(obj.promptPayRecipientValue || ""),
        dynamicQrExpiryMinutes: safePositiveInt(obj.dynamicQrExpiryMinutes, 15),
        enableSaveQr: obj.enableSaveQr === true,
        enableOpenApp: obj.enableOpenApp === true,
        enableChecklist: obj.enableChecklist === true,
        dynamicQrSupported: obj.dynamicQrSupported === true,
        amountPrefillSupported: obj.amountPrefillSupported === true,
        referenceSupported: obj.referenceSupported === true,
        galleryScanSupported: obj.galleryScanSupported === true,
        slipRequired: isSlipRequired(obj),
        autoVerificationSupported: obj.autoVerificationSupported === true,
        webhookSupported: obj.webhookSupported === true,
        checklistSteps: sanitizeChecklistSteps(obj.checklistSteps || []),
        bankLaunchers: publicBankLaunchersProjection(obj),
        sortOrder: safeSortOrder(obj.sortOrder)
    };
}

function publicTrustDisplayForMethod(obj = {}, readiness = { ready: false }) {
    const provider = normalizeProviderKey(obj.provider || obj.key || "");
    const key = String(obj.key || provider || "").trim().toLowerCase();
    if (obj.enabled !== true || readiness.ready !== true) return null;

    const logo = safePublicAssetUrl(obj.logoUrl) || getPaymentLogo({ key, provider });
    if (!logo) return null;

    return {
        enabled: true,
        logo,
        label: obj.region === "TH" && key === "promptpay" && obj.qrMode === "aziel_promptpay_dynamic"
            ? "PromptPay"
            : formatPaymentMethod({ ...obj, provider }, getProviderLabel(provider, obj.method || "Payment")),
        sortOrder: safeSortOrder(obj.sortOrder),
        group: provider === "wallet" || key === "wallet" ? "wallet" : "payment_method"
    };
}

function publicBankLaunchersProjection(obj = {}) {
    return sanitizeBankLaunchers(obj.bankLaunchers || [])
        .filter(item => item.enabled === true && item.key !== "kplus" && PUBLIC_LAUNCHER_STATUSES.has(String(item.verificationStatus || "").toLowerCase()))
        .map(item => ({
            ...item,
            region: "TH",
            trustDisplay: {
                enabled: true,
                logo: item.logoUrl,
                label: item.displayName,
                sortOrder: safeSortOrder(item.sortOrder),
                group: "bank_launcher"
            }
        }));
}

async function seedPaymentMethods() {
    for (const item of defaultMethods) {
        const exists = await PaymentMethod.findOne({ key: item.key });

        if (!exists) {
            await PaymentMethod.create({
                ...item,
                enabled: item.enabled === true,
                accountName: "",
                accountNumber: "",
                qrImageUrl: "",
                uploadedQrImage: "",
                logoUrl: "",
                maintenanceMessage: "",
                paymentType: item.paymentType || "manual",
                provider: canonicalProviderForMethod(item)
            });
        } else {
            Object.assign(exists, canonicalMethodDefaults({
                ...item,
                sortOrder: exists.sortOrder
            }));
            applySeedDefaultsWithoutOverwriting(exists, item);
            await applyCompatibilityModes(applyPromptPayConsolidation(exists)).save();
        }
    }
    await syncPromptPayBankLaunchers();
}

function isLegacyThailandBankMethod(method = {}) {
    return String(method.region || "").toUpperCase() === "TH" &&
        THAI_STANDALONE_BANK_KEYS.has(String(method.key || "").toLowerCase());
}

function formatMethod(method) {
    const obj = method.toObject();
    const provider = normalizeProviderKey(obj.provider || obj.key || "");
    const isDynamicPromptPayQr = obj.qrMode === "aziel_promptpay_dynamic";
    const configuredQrImage = safePublicAssetUrl(
        obj.uploadedQrImage ||
        obj.qrImageUrl ||
        obj.qrImage ||
        ""
    );
    const qrImage = isDynamicPromptPayQr ? null : configuredQrImage;
    const displaySource = Object.assign({}, obj, { provider });
    const readiness = paymentMethodReadiness(displaySource);

    const publicMethodName = obj.region === "TH" && obj.key === "promptpay" && isDynamicPromptPayQr
        ? "PromptPay QR"
        : formatPaymentMethod(displaySource, getProviderLabel(provider, obj.method || "Payment"));
    const trustDisplay = publicTrustDisplayForMethod(obj, readiness);

    return {
        _id: obj._id,
        method: publicMethodName,
        key: obj.key,
        region: obj.region,
        enabled: obj.enabled === true,
        accountName: obj.accountName || "",
        accountNumber: obj.accountNumber || "",
        qrImage,
        qrImageUrl: qrImage,
        uploadedQrImage: qrImage,
        maintenanceMessage: obj.maintenanceMessage || "",
        shortDescription: obj.shortDescription || "",
        badgeText: obj.badgeText || "",
        recipientLabel: obj.recipientLabel || "",
        referenceInstructions: obj.referenceInstructions || "",
        qrMode: obj.qrMode || "uploaded_static",
        receiptUploadEnabled: obj.receiptUploadEnabled !== false,
        confirmationMode: obj.confirmationMode || "manual_admin",
        availabilitySchedule: obj.availabilitySchedule || "",
        paymentType: obj.paymentType || "manual",
        provider,
        logoUrl: safePublicAssetUrl(obj.logoUrl) || getPaymentLogo(displaySource),
        trustDisplay,
        publicReady: readiness.ready,
        missingConfiguration: readiness.missing,
        ...capabilityProjection(obj)
    };
}

function formatAdminMethod(method) {
    const obj = typeof method.toObject === "function" ? method.toObject() : method;
    const configuredQrImage = safePublicAssetUrl(
        obj.uploadedQrImage ||
        obj.qrImageUrl ||
        obj.qrImage ||
        ""
    );
    return {
        ...formatMethod(method),
        qrImage: configuredQrImage,
        qrImageUrl: configuredQrImage,
        uploadedQrImage: configuredQrImage,
        appDisplayName: obj.appDisplayName || "",
        openAppMode: safeOpenAppMode(obj.openAppMode, obj.enableOpenApp === true ? "direct" : "disabled"),
        deepLinkUrl: obj.deepLinkUrl || "",
        appStoreUrl: obj.appStoreUrl || "",
        playStoreUrl: obj.playStoreUrl || "",
        appLaunchMode: obj.appLaunchMode || "OFFICIAL_PAYMENT_DEEPLINK",
        iosAppLaunchUrl: obj.iosAppLaunchUrl || "",
        androidAppLaunchUrl: obj.androidAppLaunchUrl || "",
        androidPackageName: obj.androidPackageName || "",
        appStoreFallbackUrl: obj.appStoreFallbackUrl || obj.appStoreUrl || "",
        playStoreFallbackUrl: obj.playStoreFallbackUrl || obj.playStoreUrl || "",
        promptPayRecipientType: obj.promptPayRecipientType || "",
        promptPayRecipientMasked: maskPromptPayRecipient(obj.promptPayRecipientValue || ""),
        promptPayRecipientValue: obj.promptPayRecipientValue || "",
        dynamicQrExpiryMinutes: safePositiveInt(obj.dynamicQrExpiryMinutes, 15),
        logoUrl: safePublicAssetUrl(obj.logoUrl) || getPaymentLogo(obj),
        shortDescription: obj.shortDescription || "",
        badgeText: obj.badgeText || "",
        recipientLabel: obj.recipientLabel || "",
        referenceInstructions: obj.referenceInstructions || "",
        qrMode: obj.qrMode || "uploaded_static",
        receiptUploadEnabled: obj.receiptUploadEnabled !== false,
        confirmationMode: obj.confirmationMode || "manual_admin",
        availabilitySchedule: obj.availabilitySchedule || "",
        enableSaveQr: obj.enableSaveQr === true,
        enableOpenApp: obj.enableOpenApp === true,
        enableChecklist: obj.enableChecklist === true,
        dynamicQrSupported: obj.dynamicQrSupported === true,
        amountPrefillSupported: obj.amountPrefillSupported === true,
        referenceSupported: obj.referenceSupported === true,
        galleryScanSupported: obj.galleryScanSupported === true,
        slipRequired: isSlipRequired(obj),
        autoVerificationSupported: obj.autoVerificationSupported === true,
        webhookSupported: obj.webhookSupported === true,
        checklistSteps: sanitizeChecklistSteps(obj.checklistSteps || []),
        bankLaunchers: sanitizeBankLaunchers(obj.bankLaunchers || []),
        sortOrder: safeSortOrder(obj.sortOrder),
        providerOptions: validProvidersFor(obj.region, obj.paymentType).map(item => ({
            key: item.key,
            label: item.label
        }))
    };
}

function safePublicAssetUrl(value = "") {
    const url = String(value || "").trim();
    if (!url) return "";
    if (/^[a-zA-Z]:\\|^\/Users\/|^\/private\/|^file:/i.test(url)) return "";
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("/uploads/") || url.startsWith("/assets/")) return url;
    return "";
}

// GET /api/payment-methods
router.get("/payment-methods", async (req, res) => {
    try {
        await seedPaymentMethods();

        const filter = {};

        if (req.query.region) {
            filter.region = req.query.region;
        }

        const methods = await PaymentMethod
            .find(filter)
            .sort({ region: 1, sortOrder: 1, method: 1 });

        res.json({
            success: true,
            methods: methods
                .filter(method => !isLegacyThailandBankMethod(method))
                .map(formatMethod)
        });

    } catch (error) {
        console.log("Payment methods error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// GET /api/payment-methods/:key/qr-download
router.get("/payment-methods/:key/qr-download", async (req, res) => {
    try {
        await seedPaymentMethods();

        const key = safeText(req.params.key, 60)
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "");
        const region = String(req.query.region || "").trim().toUpperCase();
        const filter = { key, enabled: true };
        if (["MM", "TH"].includes(region)) filter.region = region;

        const method = await PaymentMethod.findOne(filter);
        const qrUrl = getConfiguredQrUrl(method || {});
        if (!method || !qrUrl) {
            return res.status(404).json({
                success: false,
                message: "QR image not found"
            });
        }

        if (!isTrustedCloudinaryQrUrl(qrUrl)) {
            return res.status(400).json({
                success: false,
                message: "QR image cannot be proxied"
            });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let upstream;

        try {
            upstream = await fetch(qrUrl, {
                signal: controller.signal,
                headers: {
                    Accept: "image/*"
                },
                redirect: "follow"
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!upstream.ok || !isTrustedCloudinaryQrUrl(upstream.url || qrUrl)) {
            return res.status(502).json({
                success: false,
                message: "QR image unavailable"
            });
        }

        const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
        if (!contentType.startsWith("image/")) {
            return res.status(415).json({
                success: false,
                message: "QR image type is not supported"
            });
        }

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${qrDownloadFilename(method, req.query.reference)}"`);
        res.setHeader("Cache-Control", "no-store");

        const body = upstream.body;
        if (!body) return res.status(502).end();
        return Readable.fromWeb(body).pipe(res);
    } catch (error) {
        if (error?.name === "AbortError") {
            return res.status(504).json({
                success: false,
                message: "QR image request timed out"
            });
        }

        console.log("Payment QR download proxy error:", error);
        return res.status(500).json({
            success: false,
            message: "QR image download failed"
        });
    }
});

// POST /api/payment-methods/:key/promptpay-qr
router.post("/payment-methods/:key/promptpay-qr", authMiddleware, async (req, res) => {
    try {
        await seedPaymentMethods();

        const key = safeText(req.params.key, 60)
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "");
        const method = await PaymentMethod.findOne({
            key,
            enabled: true
        });

        if (
            !method ||
            method.region !== "TH" ||
            method.qrMode !== "aziel_promptpay_dynamic" ||
            method.confirmationMode !== "manual_admin" ||
            method.dynamicQrSupported !== true ||
            method.amountPrefillSupported !== true ||
            method.receiptUploadEnabled === false ||
            method.slipRequired === false
        ) {
            return res.status(400).json({
                success: false,
                code: "PROMPTPAY_DYNAMIC_QR_UNAVAILABLE",
                message: "Dynamic PromptPay QR is not available for this payment method."
            });
        }

        if (!String(req.body.orderReference || "").trim()) {
            return res.status(400).json({
                success: false,
                code: "PROMPTPAY_REFERENCE_INVALID",
                message: "Payment reference is required."
            });
        }

        const attempt = await ManualPaymentAttempt.findOne({
            reference: String(req.body.orderReference || "").trim(),
            username: req.user.username,
            status: "active",
            paymentMethod: method.key
        });

        if (!attempt) {
            return res.status(400).json({
                success: false,
                code: "PROMPTPAY_REFERENCE_INVALID",
                message: "Payment reference is unavailable."
            });
        }

        const result = await createPromptPayQr({
            method,
            amount: attempt.finalAmount || attempt.canonicalAmount || req.body.amount,
            currency: attempt.canonicalCurrency || req.body.currency,
            orderReference: attempt.reference
        });

        await ManualPaymentAttempt.updateOne(
            {
                reference: result.orderReference,
                username: req.user.username,
                status: "active",
                paymentMethod: method.key
            },
            {
                $set: {
                    "instructions.dynamicQr.orderReference": result.orderReference,
                    "instructions.dynamicQr.encodedReference": result.encodedReference,
                    "instructions.dynamicQr.qrPayload": result.qrPayload,
                    "instructions.dynamicQr.expiresAt": new Date(result.expiresAt)
                }
            }
        ).catch(error => {
            if (process.env.NODE_ENV !== "production") {
                console.log("PromptPay QR attempt snapshot skipped:", error.message);
            }
        });

        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        const code = error?.code || "PROMPTPAY_DYNAMIC_QR_FAILED";
        const status = code.includes("INVALID") ? 400 : 500;
        return res.status(status).json({
            success: false,
            code,
            message: status === 400
                ? error.message
                : "PromptPay QR generation failed"
        });
    }
});

// GET /api/admin/payment-methods
router.get("/admin/payment-methods", adminMiddleware, requireAdminPermission(PERMISSIONS.PAYMENT_METHODS_MANAGE), async (req, res) => {
    try {
        await seedPaymentMethods();

        const filter = {};
        if (req.query.region) filter.region = String(req.query.region).toUpperCase();

        const methods = await PaymentMethod
            .find(filter)
            .sort({ region: 1, sortOrder: 1, method: 1 });

        return res.json({
            success: true,
            methods: methods.map(formatAdminMethod)
        });
    } catch (error) {
        console.log("Admin payment methods error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

function applyPaymentMethodPatch(method, body = {}) {
    const stringFields = {
        method: 80,
        accountName: 120,
        accountNumber: 120,
        qrImageUrl: 500,
        uploadedQrImage: 500,
        maintenanceMessage: 240,
        logoUrl: 500,
        shortDescription: 160,
        badgeText: 40,
        recipientLabel: 80,
        referenceInstructions: 240,
        availabilitySchedule: 160,
        appDisplayName: 80,
        deepLinkUrl: 500,
        appStoreUrl: 500,
        playStoreUrl: 500,
        iosAppLaunchUrl: 500,
        androidAppLaunchUrl: 500,
        androidPackageName: 160,
        appStoreFallbackUrl: 500,
        playStoreFallbackUrl: 500,
        promptPayRecipientValue: 80
    };

    Object.entries(stringFields).forEach(([key, max]) => {
        if (body[key] === undefined) return;
        if (key === "deepLinkUrl") method[key] = safeUrl(body[key], { deeplink: true });
        else if (key === "androidPackageName") {
            const packageName = safeAndroidPackageName(body[key]);
            if (safeText(body[key], max) && !packageName) {
                const error = new Error("Android package name is malformed.");
                error.statusCode = 400;
                throw error;
            }
            method[key] = packageName;
        }
        else if (key === "androidAppLaunchUrl") method[key] = safeUrl(body[key], { deeplink: true });
        else if (key === "iosAppLaunchUrl") method[key] = safeUrl(body[key], { deeplink: true });
        else if (["appStoreUrl", "playStoreUrl", "logoUrl", "appStoreFallbackUrl", "playStoreFallbackUrl"].includes(key)) method[key] = safeUrl(body[key]);
        else method[key] = safeText(body[key], max);
    });

    [
        "enabled",
        "enableSaveQr",
        "enableOpenApp",
        "enableChecklist",
        "dynamicQrSupported",
        "amountPrefillSupported",
        "referenceSupported",
        "galleryScanSupported",
        "slipRequired",
        "receiptUploadEnabled",
        "autoVerificationSupported",
        "webhookSupported"
    ].forEach(key => {
        if (body[key] !== undefined) method[key] = body[key] === true || body[key] === "true";
    });

    if (body.uploadedQrImageEvidence !== undefined) {
        method.uploadedQrImageEvidence = body.uploadedQrImageEvidence || {};
    }

    if (body.bankLaunchers !== undefined) {
        method.bankLaunchers = sanitizeBankLaunchers(body.bankLaunchers);
    }

    if (body.paymentType !== undefined && ["manual", "auto", "deeplink", "wallet"].includes(String(body.paymentType))) {
        method.paymentType = String(body.paymentType);
    }

    if (body.qrMode !== undefined && ["provider_generated", "uploaded_static", "aziel_promptpay_dynamic", "none"].includes(String(body.qrMode))) {
        method.qrMode = String(body.qrMode);
    }

    if (body.appLaunchMode !== undefined && ["APP_ONLY", "OFFICIAL_PAYMENT_DEEPLINK"].includes(String(body.appLaunchMode).toUpperCase())) {
        method.appLaunchMode = String(body.appLaunchMode).toUpperCase();
    }

    if (body.promptPayRecipientType !== undefined) method.promptPayRecipientType = safePromptPayRecipientType(body.promptPayRecipientType);
    if (body.dynamicQrExpiryMinutes !== undefined) method.dynamicQrExpiryMinutes = safePositiveInt(body.dynamicQrExpiryMinutes, 15);

    if (body.openAppMode !== undefined) {
        method.openAppMode = safeOpenAppMode(body.openAppMode, method.openAppMode || "disabled");
    }

    if (body.confirmationMode !== undefined && ["manual_admin", "provider_webhook", "automatic_provider", "wallet_internal"].includes(String(body.confirmationMode))) {
        method.confirmationMode = String(body.confirmationMode);
    }

    if (body.region !== undefined && ["MM", "TH"].includes(String(body.region).toUpperCase())) {
        method.region = String(body.region).toUpperCase();
    }

    method.provider = canonicalProviderForMethod(method, body.provider);
    if (!isProviderValidFor(method.region, method.paymentType, method.provider)) {
        const allowed = validProvidersFor(method.region, method.paymentType).map(item => item.label).join(", ");
        const error = new Error(`Provider is not valid for ${method.region} ${method.paymentType}. Allowed: ${allowed || "none"}`);
        error.statusCode = 400;
        throw error;
    }
    if (body.sortOrder !== undefined) method.sortOrder = safeSortOrder(body.sortOrder);
    if (body.checklistSteps !== undefined) method.checklistSteps = sanitizeChecklistSteps(body.checklistSteps);

    return applyCompatibilityModes(applyPromptPayConsolidation(method));
}

function normalizedPromptPayRecipient(method = {}) {
    return {
        type: safePromptPayRecipientType(method.promptPayRecipientType || ""),
        value: safeText(method.promptPayRecipientValue || "", 80)
            .toUpperCase()
            .replace(/\s+/g, "")
    };
}

function isThailandManualDynamicMethod(method = {}) {
    return method.enabled === true &&
        String(method.region || "").toUpperCase() === "TH" &&
        ["manual", "deeplink"].includes(String(method.paymentType || "").toLowerCase()) &&
        method.qrMode === "aziel_promptpay_dynamic";
}

function configError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function hasAndroidLaunchCapability(method = {}) {
    if (String(method.androidAppLaunchUrl || "").trim()) return true;
    return Boolean(
        String(method.androidPackageName || "").trim() &&
        String(method.playStoreFallbackUrl || method.playStoreUrl || "").trim()
    );
}

async function validatePaymentMethodConfiguration(method) {
    const paymentType = String(method.paymentType || "manual").toLowerCase();
    const openAppMode = safeOpenAppMode(method.openAppMode, method.enableOpenApp === true ? "direct" : "disabled");

    if (method.qrMode === "aziel_promptpay_dynamic") {
        if (String(method.region || "").toUpperCase() !== "TH") {
            throw configError("AZIEL Dynamic PromptPay QR is only available for Thailand methods.");
        }
        if (!["manual", "deeplink"].includes(paymentType)) {
            throw configError("AZIEL Dynamic PromptPay QR requires a manual or deeplink payment type.");
        }
        if (method.confirmationMode !== "manual_admin") {
            throw configError("AZIEL Dynamic PromptPay QR requires manual admin confirmation.");
        }
        if (method.receiptUploadEnabled === false || method.slipRequired === false) {
            throw configError("AZIEL Dynamic PromptPay QR requires receipt upload and payment slip verification.");
        }
        if (method.autoVerificationSupported === true || method.webhookSupported === true) {
            throw configError("Manual Dynamic PromptPay methods cannot enable automatic verification or webhooks.");
        }
        const recipient = normalizedPromptPayRecipient(method);
        if (!recipient.type || !recipient.value) {
            throw configError("AZIEL Dynamic PromptPay QR requires a valid PromptPay recipient.");
        }
        if (method.enabled === true) {
            const existing = await PaymentMethod.find({
                _id: { $ne: method._id },
                enabled: true,
                region: "TH",
                qrMode: "aziel_promptpay_dynamic"
            }).select("key method paymentType promptPayRecipientType promptPayRecipientValue").lean();
            const conflict = existing.find(item => {
                if (!["manual", "deeplink"].includes(String(item.paymentType || "").toLowerCase())) return false;
                const other = normalizedPromptPayRecipient(item);
                return other.type &&
                    other.value &&
                    (other.type !== recipient.type || other.value !== recipient.value);
            });
            if (conflict) {
                throw configError(`Enabled Thailand manual Dynamic PromptPay methods must use the same AZIEL receiving account. Conflict: ${conflict.method || conflict.key}.`);
            }
        }
    }

    if (method.qrMode === "provider_generated") {
        if (!["provider_webhook", "automatic_provider"].includes(String(method.confirmationMode || ""))) {
            throw configError("Provider-generated QR requires provider webhook confirmation.");
        }
        if (!method.autoVerificationSupported && !method.webhookSupported && paymentType === "auto") {
            throw configError("Provider-generated auto payments require provider verification support.");
        }
    }

    if (method.enableOpenApp === true && openAppMode === "direct") {
        if (!String(method.appDisplayName || "").trim()) {
            throw configError("Direct app opening requires an app display name.");
        }
        const hasIosLaunchOrStore = Boolean(String(method.iosAppLaunchUrl || method.appStoreFallbackUrl || method.appStoreUrl || "").trim());
        const hasLaunch = Boolean(method.deepLinkUrl || hasIosLaunchOrStore || hasAndroidLaunchCapability(method));
        if (!hasLaunch) {
            throw configError("Direct app opening requires a configured app launch URL or deeplink.");
        }
        if (String(method.androidPackageName || "").trim() && !String(method.androidAppLaunchUrl || "").trim() && !String(method.playStoreFallbackUrl || method.playStoreUrl || "").trim()) {
            throw configError("Android app opening requires a Play Store fallback URL.");
        }
    }
}

// POST /api/admin/payment-methods
router.post("/admin/payment-methods", adminMiddleware, requireAdminPermission(PERMISSIONS.PAYMENT_METHODS_MANAGE), async (req, res) => {
    try {
        const methodName = safeText(req.body.method || req.body.displayName, 80);
        const key = safeText(req.body.key, 60)
            .toLowerCase()
            .replace(/\s+/g, "")
            .replace(/[-_]/g, "")
            .replace(/[^a-z0-9]/g, "");
        const region = String(req.body.region || "").toUpperCase();

        if (!methodName || !key || !["MM", "TH"].includes(region)) {
            return res.status(400).json({
                success: false,
                message: "Payment method name, key, and valid region are required."
            });
        }

        const method = new PaymentMethod({
            method: methodName,
            key,
            region,
            enabled: req.body.enabled === true,
            paymentType: ["manual", "auto", "deeplink", "wallet"].includes(req.body.paymentType)
                ? req.body.paymentType
                : "manual",
            provider: safeText(req.body.provider, 60).toLowerCase() || "manual"
        });

        applyPaymentMethodPatch(method, req.body);
        await validatePaymentMethodConfiguration(method);
        await method.save();

        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PAYMENT_METHOD_UPDATED,
            resourceType: "PaymentMethod",
            resourceId: String(method._id),
            metadata: { key: method.key, region: method.region, created: true }
        }).catch(error => console.log("Admin audit failed:", error.message));

        return res.status(201).json({
            success: true,
            message: "Payment method created",
            method: formatAdminMethod(method)
        });
    } catch (error) {
        console.log("Create payment method error:", error);

        if (error?.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Payment method key already exists."
            });
        }

        if (error?.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// PUT /api/admin/payment-methods/:id
router.put("/admin/payment-methods/:id", adminMiddleware, requireAdminPermission(PERMISSIONS.PAYMENT_METHODS_MANAGE), async (req, res) => {
    try {
        const method = await PaymentMethod.findById(req.params.id);

        if (!method) {
            return res.status(404).json({
                success: false,
                message: "Payment method not found"
            });
        }

        applyPaymentMethodPatch(method, req.body);
        await validatePaymentMethodConfiguration(method);

        await method.save();
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PAYMENT_METHOD_UPDATED,
            resourceType: "PaymentMethod",
            resourceId: String(method._id),
            metadata: { key: method.key, region: method.region }
        }).catch(error => console.log("Admin audit failed:", error.message));

        res.json({
            success: true,
            message: "Payment method updated",
            method: formatAdminMethod(method)
        });

    } catch (error) {
        console.log("Update payment method error:", error);

        if (error?.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// POST /api/admin/upload-payment-qr
router.post(
    "/admin/upload-payment-qr",
    adminMiddleware,
    requireAdminPermission(PERMISSIONS.PAYMENT_METHODS_MANAGE),
    paymentQrUpload.single("qr"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.json({
                    success: false,
                    message: "No image uploaded"
                });
            }

            const evidence = await uploadFile({
                file: req.file,
                category: "paymentAsset",
                ownerReference: "payment-method"
            });

            res.json({
                success: true,
                image: evidence.url,
                evidence
            });

        } catch (error) {
            console.log("QR upload error:", error);

            if (error instanceof StorageError) {
                logStorageError(error.code, {
                    provider: error.provider,
                    category: "paymentAsset"
                });

                return res.status(error.statusCode).json({
                    success: false,
                    code: error.code,
                    message: error.message
                });
            }

            res.status(500).json({
                success: false,
                message: "Upload failed"
            });
        }
    }
);

// POST /api/admin/upload-payment-logo
router.post(
    "/admin/upload-payment-logo",
    adminMiddleware,
    requireAdminPermission(PERMISSIONS.PAYMENT_METHODS_MANAGE),
    paymentQrUpload.single("logo"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.json({
                    success: false,
                    message: "No logo uploaded"
                });
            }

            const evidence = await uploadFile({
                file: req.file,
                category: "paymentAsset",
                ownerReference: "payment-method-logo"
            });

            res.json({
                success: true,
                image: evidence.url,
                evidence
            });

        } catch (error) {
            console.log("Payment logo upload error:", error);

            if (error instanceof StorageError) {
                logStorageError(error.code, {
                    provider: error.provider,
                    category: "paymentAsset"
                });

                return res.status(error.statusCode).json({
                    success: false,
                    code: error.code,
                    message: error.message
                });
            }

            res.status(500).json({
                success: false,
                message: "Logo upload failed"
            });
        }
    }
);

module.exports = router;
module.exports._test = {
    applyCompatibilityModes,
    applyPaymentMethodPatch,
    applySeedDefaultsWithoutOverwriting,
    defaultMethods,
    isLegacyThailandBankMethod,
    mergePromptPayLaunchers,
    publicBankLaunchersProjection,
    publicTrustDisplayForMethod,
    sanitizeBankLaunchers
};
