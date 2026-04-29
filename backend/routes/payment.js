// backend/routes/payment.js

const express = require("express");
const router = express.Router();

const Order = require("../models/Order");
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
            region,
            paymentMethod,
            username,
            userId,
            zoneId
        } = req.body;

        if (!orderId || !game || !packageName || !amount || !paymentMethod || !userId) {
            return res.json({
                success: false,
                message: "Missing order data"
            });
        }

        // Save order first
        await Order.create({
            orderId,
            username: username || "guest",
            game,
            userId,
            zoneId: zoneId || "",
            packageName,
            amount,
            currency,
            region,
            paymentMethod,
            status: "pending_payment",
            paymentSlip: "",
            transactionId: ""
        });
        const { sendTelegramMessage } = require("../services/telegram");

        await sendTelegramMessage(
            `🆕 New Order Created
Order: ${orderId}
Game: ${game}
Package: ${packageName}
Amount: ${amount} ${currency}
User: ${username || "guest"}`
        );

        // Create payment page/session
        const paymentSession = await wavepayService.createPayment(req.body);

        // Save transaction id
        await Order.updateOne(
            { orderId },
            { transactionId: paymentSession.transactionId }
        );

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