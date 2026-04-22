const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Order = require("../models/Order");
const { sendTelegramPhoto } = require("../services/telegram");

const uploadDir = path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });

// Create Order
router.post("/order", upload.single("screenshot"), async (req, res) => {
    try {
        const { username, userId, serverId, selectedPackage, paymentMethod } = req.body;

        console.log("BODY:", req.body);
        console.log("FILE:", req.file);

        if (!username || !userId || !serverId || !selectedPackage || !paymentMethod) {
            return res.json({
                success: false,
                message: "Missing required fields"
            });
        }

        if (!req.file) {
            return res.json({
                success: false,
                message: "Payment screenshot is required"
            });
        }

        await Order.create({
            username,
            userId,
            serverId,
            packageName: selectedPackage,
            status: "Pending"
        });

        const caption = `🛒 New Order
User: ${username}
Package: ${selectedPackage}
Game ID: ${userId}
Server: ${serverId}
Payment: ${paymentMethod}
Status: Pending`;

        try {
            const tgResult = await sendTelegramPhoto(req.file.path, caption);
            console.log("Telegram result:", tgResult);
        } catch (tgError) {
            console.log("Telegram send error:", tgError);
            return res.json({
                success: false,
                message: "Telegram send failed"
            });
        }

        res.json({
            success: true,
            message: "Order placed!"
        });

    } catch (error) {
        console.log("Order route error:", error);
        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// Get History
router.get("/history/:username", async (req, res) => {
    try {
        const username = req.params.username;

        const orders = await Order.find({ username }).sort({
            createdAt: -1
        });

        res.json({
            success: true,
            orders
        });

    } catch (error) {
        console.log("History error:", error);
        res.json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;