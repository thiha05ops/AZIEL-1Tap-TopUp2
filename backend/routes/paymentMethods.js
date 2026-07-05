const express = require("express");
const router = express.Router();

const PaymentMethod = require("../models/PaymentMethod");
const adminMiddleware = require("../middleware/adminMiddleware");
const paymentQrUpload = require("../middleware/paymentQrUpload");

const defaultMethods = [
    { method: "KBZPay", key: "kbzpay", region: "MM" },
    { method: "WavePay", key: "wavepay", region: "MM" },
    { method: "AYA Pay", key: "ayapay", region: "MM" },
    { method: "PromptPay", key: "promptpay", region: "TH" },
    { method: "SCB", key: "scb", region: "TH" }
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
                paymentType: "manual",
                provider: "manual"
            });
        }
    }
}

function formatMethod(method) {
    const obj = method.toObject();

    return {
        ...obj,
        qrImage:
            obj.uploadedQrImage ||
            obj.qrImageUrl ||
            obj.qrImage ||
            ""
    };
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
router.put("/admin/payment-methods/:id", adminMiddleware, async (req, res) => {
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
    paymentQrUpload.single("qr"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.json({
                    success: false,
                    message: "No image uploaded"
                });
            }

            res.json({
                success: true,
                image: `/uploads/payments/${req.file.filename}`
            });

        } catch (error) {
            console.log("QR upload error:", error);

            res.status(500).json({
                success: false,
                message: "Upload failed"
            });
        }
    }
);

module.exports = router;