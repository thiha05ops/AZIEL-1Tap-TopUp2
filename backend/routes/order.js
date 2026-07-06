// backend/routes/order.js

const express = require("express");
const router = express.Router();

const Order = require("../models/Order");
const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");

const upload = require("../middleware/orderUpload");

const {
    sendTelegramMessage,
    sendTelegramPhoto
} = require("../services/telegram");

const createNotification = require("../services/createNotification");
const adminMiddleware = require("../middleware/adminMiddleware");

function getCurrencyKey(currency) {
    return currency === "THB" ? "THB" : "MMK";
}

// CUSTOMER ORDER HISTORY
router.get("/history/:username", async (req, res) => {
    try {
        const orders = await Order.find({
            username: req.params.username
        }).sort({ createdAt: -1 });

        res.json({ success: true, orders });

    } catch (error) {
        console.log("History error:", error);
        res.json({ success: false, message: "Server error" });
    }
});

// CUSTOMER RECENT ORDERS
router.get("/order/user/:username", async (req, res) => {
    try {
        const orders = await Order.find({
            username: req.params.username
        }).sort({ createdAt: -1 });

        res.json({ success: true, orders });

    } catch (error) {
        console.log("User orders error:", error);
        res.json({ success: false, message: "Server error" });
    }
});

// TRACK SINGLE ORDER
router.get("/order/track/:orderId", async (req, res) => {
    try {
        const order = await Order.findOne({
            orderId: req.params.orderId
        });

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        res.json({ success: true, order });

    } catch (error) {
        console.log("Track error:", error);
        res.json({ success: false, message: "Server error" });
    }
});

// ADMIN GET ALL ORDERS
router.get("/admin/orders", adminMiddleware, async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });

        res.json({ success: true, orders });

    } catch (error) {
        console.log("Admin orders error:", error);
        res.json({ success: false, message: "Server error" });
    }
});

// ADMIN UPDATE ORDER STATUS
router.put("/admin/orders/:id/status", adminMiddleware, async (req, res) => {
    try {
        const { status } = req.body;

        const allowedStatus = [
            "pending_payment",
            "paid",
            "processing",
            "completed",
            "cancelled",
            "failed",
            "refund_pending",
            "refunded"
        ];

        if (!allowedStatus.includes(status)) {
            return res.json({
                success: false,
                message: "Invalid status"
            });
        }

        const noteMap = {
            pending_payment: "Waiting for payment confirmation.",
            paid: "Payment received. Waiting for processing.",
            processing: "Your order is processing.",
            completed: "✅ Your order has been completed.",
            cancelled: "❌ Your order has been cancelled.",
            failed: "❌ Your order failed. Please contact support.",
            refund_pending: "Refund is being reviewed.",
            refunded: "✅ This order has been refunded to your wallet."
        };

        const order = await Order.findByIdAndUpdate(
            req.params.id,
            {
                status,
                note: noteMap[status] || ""
            },
            { new: true }
        );

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        const notification = await createNotification({
            username: order.username,
            title: "Order Status Updated",
            message: `${order.game} - ${order.packageName} is now ${order.status}`,
            type: "order",
            category: "orders",
            orderId: order.orderId
        });

        const io = req.app.get("io");

        if (io) {
            io.to(order.username).emit("newNotification", notification || {
                title: "Order Updated",
                message: `${order.game} is now ${order.status}`,
                orderId: order.orderId,
                isRead: false
            });

            io.to("admins").emit("adminNewUpdate", {
                type: "order_status",
                orderId: order.orderId,
                username: order.username,
                status: order.status,
                game: order.game
            });
        }

        await sendTelegramMessage(
            `📦 ORDER STATUS UPDATED

🎮 Game:
${order.game}

📦 Package:
${order.packageName}

👤 User:
${order.username}

📌 Status:
${order.status}`
        );

        res.json({
            success: true,
            order
        });

    } catch (error) {
        console.log("Update status error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// ADMIN REFUND ORDER TO WALLET
router.post("/admin/orders/:id/refund", adminMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;

        if (!reason || !String(reason).trim()) {
            return res.json({
                success: false,
                message: "Refund reason is required"
            });
        }

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        if (order.refunded === true || order.status === "refunded") {
            return res.json({
                success: false,
                message: "This order has already been refunded"
            });
        }

        const currencyKey = getCurrencyKey(order.currency);
        const refundAmount = Number(order.amount || 0);

        if (refundAmount <= 0) {
            return res.json({
                success: false,
                message: "Invalid refund amount"
            });
        }

        const user = await User.findOneAndUpdate(
            { username: order.username },
            {
                $inc: {
                    [`wallet.${currencyKey}`]: refundAmount
                }
            },
            { new: true }
        );

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        await WalletTransaction.create({
            transactionId: "RF-" + Date.now(),
            username: order.username,
            orderId: order.orderId,
            type: "refund",
            amount: refundAmount,
            currency: currencyKey,
            status: "completed",
            description: `Refund for ${order.game} - ${order.packageName}`,
            referenceType: "refund",
            performedBy: "admin"
        });

        order.status = "refunded";
        order.refunded = true;
        order.refundAmount = refundAmount;
        order.refundReason = String(reason).trim();
        order.refundMethod = "wallet";
        order.refundedBy = "admin";
        order.refundedAt = new Date();
        order.note = `Refunded to wallet. Reason: ${reason}`;

        await order.save();

        const notification = await createNotification({
            username: order.username,
            title: "Refund Completed",
            message: `${refundAmount.toLocaleString()} ${currencyKey} has been returned to your AZIEL Wallet.`,
            type: "wallet",
            category: "wallet",
            orderId: order.orderId
        });

        const io = req.app.get("io");

        if (io) {
            io.to(order.username).emit("walletUpdated", {
                amount: user.wallet?.[currencyKey] || 0,
                currency: currencyKey,
                status: "refund"
            });

            io.to(order.username).emit("newNotification", notification);

            io.to("admins").emit("adminNewUpdate", {
                type: "order_refunded",
                orderId: order.orderId,
                username: order.username,
                amount: refundAmount,
                currency: currencyKey
            });
        }

        await sendTelegramMessage(
            `💸 ORDER REFUNDED TO WALLET

📦 Order:
${order.orderId}

🎮 Game:
${order.game}

📦 Package:
${order.packageName}

👤 User:
${order.username}

💰 Refund:
${refundAmount} ${currencyKey}

📝 Reason:
${reason}`
        );

        res.json({
            success: true,
            message: "Order refunded to wallet",
            order,
            balance: user.wallet?.[currencyKey] || 0
        });

    } catch (error) {
        console.log("Refund order error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// LEGACY / MANUAL ORDER CREATE
router.post("/orders", upload.single("paymentSlip"), async (req, res) => {
    try {
        const order = await Order.create({
            orderId: req.body.orderId,
            username: req.body.username || "guest",
            game: req.body.game,
            userId: req.body.userId,
            zoneId: req.body.zoneId || "",
            packageName: req.body.packageName,
            amount: Number(req.body.amount || 0),
            currency: req.body.currency,
            region: req.body.region,
            paymentMethod: req.body.paymentMethod,
            paymentSlip: req.file
                ? `/uploads/orders/${req.file.filename}`
                : "",
            status: "pending_payment"
        });

        if (req.file) {
            await sendTelegramPhoto(
                req.file.path,
                `🛒 NEW ORDER

🎮 Game: ${order.game}

📦 Package: ${order.packageName}

👤 User: ${order.username}

🆔 User ID: ${order.userId}

🌐 Server ID: ${order.zoneId || "-"}

🌍 Region: ${order.region}

💳 Payment: ${order.paymentMethod}

💰 Amount: ${order.amount} ${order.currency}

📌 Status: ${order.status}`
            );
        }

        res.json({
            success: true,
            order
        });

    } catch (error) {
        console.log("Create order error:", error);

        res.status(500).json({
            success: false,
            message: "Create order failed"
        });
    }
});

module.exports = router;