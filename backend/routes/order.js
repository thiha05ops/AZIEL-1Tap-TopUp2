const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Order = require("../models/Order");
const { sendTelegramPhoto } = require("../services/telegram");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "AZIEL2026";

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

// Create order
router.post("/order", upload.single("screenshot"), async (req, res) => {
    try {
        const { username, userId, serverId, selectedPackage, paymentMethod } = req.body;

        if (!username || !userId || !serverId || !selectedPackage || !paymentMethod) {
            return res.json({ success: false, message: "Missing required fields" });
        }

        if (!req.file) {
            return res.json({ success: false, message: "Payment screenshot is required" });
        }

        const order = await Order.create({
            username,
            userId,
            serverId,
            packageName: selectedPackage,
            paymentMethod,
            status: "Pending",
            note: "Order received. Waiting for admin confirmation."
        });

        const caption = `🛒 New Order
Order ID: ${order._id}
User: ${username}
Package: ${selectedPackage}
Game ID: ${userId}
Server: ${serverId}
Payment: ${paymentMethod}
Status: Pending`;

        await sendTelegramPhoto(req.file.path, caption);

        res.json({ success: true, message: "Order placed!", order });
    } catch (error) {
        console.log("Order error:", error);
        res.json({ success: false, message: "Server error" });
    }
});

// Customer history
router.get("/history/:username", async (req, res) => {
    try {
        const orders = await Order.find({ username: req.params.username }).sort({ createdAt: -1 });
        res.json({ success: true, orders });
    } catch (error) {
        res.json({ success: false, message: "Server error" });
    }
});

// Admin get all orders
router.get("/admin/orders", async (req, res) => {
    try {
        const password = req.headers["x-admin-password"];

        if (password !== ADMIN_PASSWORD) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const orders = await Order.find().sort({ createdAt: -1 });
        res.json({ success: true, orders });
    } catch (error) {
        res.json({ success: false, message: "Server error" });
    }
});

// Admin update status
router.put("/admin/orders/:id/status", async (req, res) => {
    try {
        const password = req.headers["x-admin-password"];

        if (password !== ADMIN_PASSWORD) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const { status } = req.body;

        const noteMap = {
            Pending: "Your order has been received and is pending.",
            Processing: "Your order is now processing.",
            Done: "✅ Your order has been completed.",
            Cancelled: "❌ Your order has been cancelled."
        };

        const order = await Order.findByIdAndUpdate(
            req.params.id,
            {
                status,
                note: noteMap[status] || ""
            },
            { new: true }
        );

        res.json({ success: true, order });
    } catch (error) {
        res.json({ success: false, message: "Server error" });
    }
});
// GET /api/order/track/:orderId
router.get("/order/track/:orderId", async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await Order.findOne({ orderId });

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        res.json({
            success: true,
            order
        });

    } catch (error) {
        console.log("Track order error:", error);
        res.json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;