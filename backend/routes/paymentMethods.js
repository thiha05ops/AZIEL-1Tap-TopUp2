const express = require("express");
const router = express.Router();

const PaymentMethod = require("../models/PaymentMethod");
const adminMiddleware = require("../middleware/adminMiddleware");

const defaultMethods = [
    {
        method: "KBZPay",
        key: "kbzpay",
        region: "MM"
    },
    {
        method: "WavePay",
        key: "wavepay",
        region: "MM"
    },
    {
        method: "AYA Pay",
        key: "ayapay",
        region: "MM"
    },
    {
        method: "PromptPay",
        key: "promptpay",
        region: "TH"
    },
    {
        method: "SCB",
        key: "scb",
        region: "TH"
    }
];

async function seedPaymentMethods() {
    for (const item of defaultMethods) {
        const exists = await PaymentMethod.findOne({
            key: item.key
        });

        if (!exists) {
            await PaymentMethod.create(item);
        }
    }
}

router.get("/payment-methods", async (req, res) => {
    try {
        await seedPaymentMethods();

        const region = req.query.region;

        const filter = {};

        if (region) {
            filter.region = region;
        }

        const methods = await PaymentMethod
            .find(filter)
            .sort({ region: 1, method: 1 });

        res.json({
            success: true,
            methods
        });

    } catch (error) {
        console.log("Payment methods error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

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
            method: {
                ...method.toObject(),
                qrImage:
                    method.uploadedQrImage ||
                    method.qrImageUrl ||
                    ""
            }
        });
        const methods = await PaymentMethod
            .find(filter)
            .sort({ region: 1, method: 1 });

        const formattedMethods = methods.map(method => ({
            ...method.toObject(),
            qrImage:
                method.uploadedQrImage ||
                method.qrImageUrl ||
                ""
        }));

        res.json({
            success: true,
            methods: formattedMethods
        });
    } catch (error) {
        console.log("Update payment method error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;