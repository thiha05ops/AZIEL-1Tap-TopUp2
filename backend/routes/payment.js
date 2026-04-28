// backend/routes/payment.js

const express = require("express");
const router = express.Router();

const wavepayService = require("../services/wavepayService");

// POST /api/payment/create
router.post("/payment/create", async (req, res) => {
    try {
        const {
            orderId,
            game,
            packageName,
            amount,
            currency,
            paymentMethod,
            username
        } = req.body;

        if (!orderId || !amount || !paymentMethod) {
            return res.json({
                success: false,
                message: "Missing payment data"
            });
        }

        if (paymentMethod !== "wavepay") {
            return res.json({
                success: false,
                message: "Unsupported payment method"
            });
        }

        const paymentSession = await wavepayService.createPayment({
            orderId,
            game,
            packageName,
            amount,
            currency: currency || "MMK",
            username
        });

        res.json({
            success: true,
            paymentUrl: paymentSession.paymentUrl,
            qrUrl: paymentSession.qrUrl,
            transactionId: paymentSession.transactionId
        });

    } catch (error) {
        console.log("Payment create error:", error);

        res.json({
            success: false,
            message: "Payment server error"
        });
    }
});

module.exports = router;