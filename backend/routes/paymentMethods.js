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

const defaultMethods = [
    {
        method: "KBZPay",
        key: "kbzpay",
        region: "MM",
        paymentType: "manual",
        provider: "manual"
    },
    {
        method: "WavePay",
        key: "wavepay",
        region: "MM",
        paymentType: "manual",
        provider: "manual"
    },
    {
        method: "AYA Pay",
        key: "ayapay",
        region: "MM",
        paymentType: "manual",
        provider: "manual"
    },
    {
        method: "PromptPay",
        key: "promptpay",
        region: "TH",
        paymentType: "auto",
        provider: "omise"
    },
    {
        method: "SCB",
        key: "scb",
        region: "TH",
        paymentType: "deeplink",
        provider: "scb"
    }
];

async function seedPaymentMethods() {
    for (const item of defaultMethods) {
        const exists = await PaymentMethod.findOne({ key: item.key });

        if (!exists) {
            await PaymentMethod.create({
                ...item,
                enabled: false,
                accountName: "",
                accountNumber: "",
                qrImageUrl: "",
                uploadedQrImage: "",
                maintenanceMessage: "",
                paymentType: item.paymentType || "manual",
                provider: item.provider || "manual"
            });
        }
    }
}

function formatMethod(method) {
    const obj = method.toObject();
    const qrImage = safePublicAssetUrl(
        obj.uploadedQrImage ||
        obj.qrImageUrl ||
        obj.qrImage ||
        ""
    );

    return {
        _id: obj._id,
        method: formatPaymentMethod(obj, obj.method || "Payment"),
        key: obj.key,
        region: obj.region,
        enabled: obj.enabled === true,
        accountName: obj.accountName || "",
        accountNumber: obj.accountNumber || "",
        qrImage,
        qrImageUrl: qrImage,
        uploadedQrImage: qrImage,
        maintenanceMessage: obj.maintenanceMessage || "",
        paymentType: obj.paymentType || "manual",
        provider: obj.provider || "manual",
        logoUrl: `/assets/payment/${obj.key}.png`
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
            .sort({ region: 1, method: 1 });

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

        const allowed = [
            "enabled",
            "accountName",
            "accountNumber",
            "qrImageUrl",
            "uploadedQrImage",
            "uploadedQrImageEvidence",
            "maintenanceMessage",
            "paymentType",
            "provider"
        ];

        allowed.forEach(key => {
            if (req.body[key] !== undefined) {
                method[key] = req.body[key];
            }
        });

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
            method: formatMethod(method)
        });

    } catch (error) {
        console.log("Update payment method error:", error);

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

module.exports = router;
