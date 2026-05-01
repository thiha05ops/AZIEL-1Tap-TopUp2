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
            message: error.message || "Payment server error"
        });
    }
});
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { sendTelegramPhoto } = require("../services/telegram");

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

// POST /api/payment/submit
router.post("/payment/submit", upload.single("slip"), async (req, res) => {
    try {
        const { orderId } = req.body;

        if (!orderId || !req.file) {
            return res.json({
                success: false,
                message: "Missing payment slip"
            });
        }

        const order = await Order.findOne({ orderId });

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        order.paymentSlip = req.file.filename;
        order.status = "paid";
        await order.save();

        await sendTelegramPhoto(
            req.file.path,
            `💸 Payment Slip

Order: ${order.orderId}
User ID: ${order.userId}
Server: ${order.zoneId || "-"}
Package: ${order.packageName}
Amount: ${order.amount} ${order.currency}
Payment: ${order.paymentMethod}
Status: ${order.status}`
        );

        res.json({
            success: true,
            message: "Payment submitted"
        });

    } catch (error) {
        console.log("Payment submit error:", error);
        res.json({
            success: false,
            message: error.message || "Server error"
        });
    }
});

module.exports = router;