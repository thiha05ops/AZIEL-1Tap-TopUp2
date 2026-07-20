const express = require("express");
const router = express.Router();

const PaymentMethod = require("../models/PaymentMethod");
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

const CANONICAL_PROVIDER_BY_KEY = Object.freeze({
    promptpay: "promptpay",
    scb: "scb",
    bangkok_bank: "bangkok_bank",
    kplus: "kplus",
    krungsri: "krungsri",
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
    "upload_receipt",
    "wait_for_confirmation",
    "confirm_payment"
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
        method: "PromptPay",
        key: "promptpay",
        region: "TH",
        paymentType: "auto",
        provider: "promptpay",
        qrMode: "provider_generated",
        receiptUploadEnabled: false,
        confirmationMode: "automatic_provider",
        badgeText: "Auto",
        shortDescription: "Pay with PromptPay QR",
        appDisplayName: "Banking App",
        enableSaveQr: true,
        enableOpenApp: false,
        enableChecklist: true,
        dynamicQrSupported: true,
        amountPrefillSupported: true,
        referenceSupported: true,
        galleryScanSupported: true,
        slipRequired: false,
        autoVerificationSupported: true,
        webhookSupported: true,
        checklistSteps: [
            { key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 },
            { key: "open_app", label: "Open banking app", action: "open_app", enabled: true, sortOrder: 20 },
            { key: "wait_for_confirmation", label: "Wait for payment confirmation", action: "wait_for_confirmation", enabled: true, sortOrder: 30 }
        ],
        sortOrder: 10
    },
    {
        method: "SCB",
        key: "scb",
        region: "TH",
        paymentType: "deeplink",
        provider: "scb",
        appDisplayName: "SCB EASY",
        qrMode: "uploaded_static",
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        badgeText: "Bank App",
        shortDescription: "Pay using SCB EASY",
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        galleryScanSupported: true,
        slipRequired: true,
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
        qrMode: "uploaded_static",
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        badgeText: "Bank App",
        shortDescription: "Pay using Bangkok Bank Mobile Banking",
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        galleryScanSupported: true,
        slipRequired: true,
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
        paymentType: "deeplink",
        provider: "kplus",
        appDisplayName: "K PLUS",
        qrMode: "uploaded_static",
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        badgeText: "Bank App",
        shortDescription: "Pay using the K PLUS mobile app",
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        galleryScanSupported: true,
        slipRequired: true,
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
        qrMode: "uploaded_static",
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        badgeText: "Bank App",
        shortDescription: "Pay using the Krungsri app",
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        galleryScanSupported: true,
        slipRequired: true,
        checklistSteps: [
            { key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 },
            { key: "open_app", label: "Open Krungsri app", action: "open_app", enabled: true, sortOrder: 20 },
            { key: "upload_receipt", label: "Upload receipt", action: "upload_receipt", enabled: true, sortOrder: 30 }
        ],
        sortOrder: 50
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

function canonicalMethodDefaults(item = {}) {
    return {
        method: item.method,
        region: item.region,
        paymentType: item.paymentType || "manual",
        provider: normalizeProviderKey(item.provider || item.key || ""),
        sortOrder: safeSortOrder(item.sortOrder)
    };
}

function canonicalProviderForMethod(method = {}, fallback = "") {
    const key = String(method.key || "").trim().toLowerCase();
    if (CANONICAL_PROVIDER_BY_KEY[key]) return CANONICAL_PROVIDER_BY_KEY[key];
    const normalized = normalizeProviderKey(fallback || method.provider || "");
    return normalized || defaultProviderFor(method.region, method.paymentType) || "";
}

function applyCompatibilityModes(method) {
    const key = String(method.key || "").toLowerCase();
    const provider = canonicalProviderForMethod(method);
    method.provider = provider;

    if (key === "promptpay") {
        method.paymentType = "auto";
        method.qrMode = "provider_generated";
        method.slipRequired = false;
        method.receiptUploadEnabled = false;
        method.autoVerificationSupported = true;
        method.webhookSupported = true;
        method.confirmationMode = "automatic_provider";
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
    } else if (["manual", "deeplink"].includes(String(method.paymentType || "").toLowerCase())) {
        method.receiptUploadEnabled = method.receiptUploadEnabled !== false;
        method.slipRequired = method.slipRequired !== false;
        method.autoVerificationSupported = false;
        method.webhookSupported = false;
        method.confirmationMode = "manual_admin";
        if (!["provider_generated", "uploaded_static", "none"].includes(method.qrMode)) {
            method.qrMode = "uploaded_static";
        }
    }

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

function capabilityProjection(obj = {}) {
    return {
        appDisplayName: obj.appDisplayName || "",
        deepLinkUrl: obj.deepLinkUrl || "",
        appStoreUrl: obj.appStoreUrl || "",
        playStoreUrl: obj.playStoreUrl || "",
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
        sortOrder: safeSortOrder(obj.sortOrder)
    };
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
            Object.assign(exists, canonicalMethodDefaults(item));

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
                "receiptUploadEnabled",
                "confirmationMode",
                "sortOrder"
            ].forEach(key => {
                if (item[key] !== undefined) exists[key] = item[key];
            });

            if (!exists.checklistSteps?.length) {
                exists.checklistSteps = item.checklistSteps || [];
            }

            await applyCompatibilityModes(exists).save();
        }
    }
}

function formatMethod(method) {
    const obj = method.toObject();
    const provider = normalizeProviderKey(obj.provider || obj.key || "");
    const qrImage = safePublicAssetUrl(
        obj.uploadedQrImage ||
        obj.qrImageUrl ||
        obj.qrImage ||
        ""
    );
    const displaySource = Object.assign({}, obj, { provider });
    const readiness = paymentMethodReadiness(displaySource);

    return {
        _id: obj._id,
        method: formatPaymentMethod(displaySource, getProviderLabel(provider, obj.method || "Payment")),
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
        publicReady: readiness.ready,
        missingConfiguration: readiness.missing,
        ...capabilityProjection(obj)
    };
}

function formatAdminMethod(method) {
    const obj = typeof method.toObject === "function" ? method.toObject() : method;
    return {
        ...formatMethod(method),
        appDisplayName: obj.appDisplayName || "",
        deepLinkUrl: obj.deepLinkUrl || "",
        appStoreUrl: obj.appStoreUrl || "",
        playStoreUrl: obj.playStoreUrl || "",
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
            methods: methods.map(formatMethod)
        });

    } catch (error) {
        console.log("Payment methods error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
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
        playStoreUrl: 500
    };

    Object.entries(stringFields).forEach(([key, max]) => {
        if (body[key] === undefined) return;
        if (key === "deepLinkUrl") method[key] = safeUrl(body[key], { deeplink: true });
        else if (key === "appStoreUrl" || key === "playStoreUrl" || key === "logoUrl") method[key] = safeUrl(body[key]);
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

    if (body.paymentType !== undefined && ["manual", "auto", "deeplink", "wallet"].includes(String(body.paymentType))) {
        method.paymentType = String(body.paymentType);
    }

    if (body.qrMode !== undefined && ["provider_generated", "uploaded_static", "none"].includes(String(body.qrMode))) {
        method.qrMode = String(body.qrMode);
    }

    if (body.confirmationMode !== undefined && ["manual_admin", "automatic_provider", "wallet_internal"].includes(String(body.confirmationMode))) {
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

    return applyCompatibilityModes(method);
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
