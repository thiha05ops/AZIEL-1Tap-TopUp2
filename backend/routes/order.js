// backend/routes/order.js

const express = require("express");
const router = express.Router();

const Order = require("../models/Order");
const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");

const upload = require("../middleware/orderUpload");
const authMiddleware = require("../middleware/authMiddleware");

const {
    sendTelegramMessage,
    sendTelegramPhoto
} = require("../services/telegram");

const createNotification = require("../services/createNotification");
const adminMiddleware = require("../middleware/adminMiddleware");
const realtime = require("../services/realtime");

function getCurrencyKey(currency) {
    return String(currency || "").toUpperCase() === "THB" ? "THB" : "MMK";
}

function getRefundAllowedStatus(status) {
    return ["failed", "cancelled"].includes(String(status || "").toLowerCase());
}

function createTransactionId(prefix = "WTX") {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function getAuthenticatedUsername(req) {
    return req.user?.username || "";
}

function publicTrackingOrder(order) {
    return {
        orderId: order.orderId,
        game: order.game,
        userId: order.userId,
        zoneId: order.zoneId || "",
        packageName: order.packageName,
        selectedPackage: order.packageName,
        amount: order.amount,
        currency: order.currency,
        region: order.region,
        paymentMethod: order.paymentMethod,
        status: order.status,
        note: order.note,
        refundRequested: order.refundRequested,
        refundRequestReason: order.refundRequestReason,
        refundRequestedAt: order.refundRequestedAt,
        refunded: order.refunded,
        refundAmount: order.refundAmount,
        refundReason: order.refundReason,
        refundRejectedReason: order.refundRejectedReason,
        refundMethod: order.refundMethod,
        refundedAt: order.refundedAt,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
    };
}

// CUSTOMER ORDER HISTORY
router.get("/history/:username", authMiddleware, async (req, res) => {
    try {
        const orders = await Order.find({
            username: getAuthenticatedUsername(req)
        }).sort({ createdAt: -1 });

        res.json({ success: true, orders });

    } catch (error) {
        console.log("History error:", error);
        res.json({ success: false, message: "Server error" });
    }
});

// CUSTOMER RECENT ORDERS
router.get("/order/user/:username", authMiddleware, async (req, res) => {
    try {
        const orders = await Order.find({
            username: getAuthenticatedUsername(req)
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

        res.json({
            success: true,
            order: publicTrackingOrder(order)
        });

    } catch (error) {
        console.log("Track error:", error);
        res.json({ success: false, message: "Server error" });
    }
});

// CUSTOMER REQUEST REFUND
// POST /api/order/:orderId/refund-request
router.post("/order/:orderId/refund-request", authMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;
        const username = getAuthenticatedUsername(req);

        if (!reason || !String(reason).trim()) {
            return res.json({
                success: false,
                message: "Refund reason is required"
            });
        }

        const order = await Order.findOne({
            orderId: req.params.orderId,
            username
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        if (!getRefundAllowedStatus(order.status)) {
            return res.json({
                success: false,
                message: "Refund can only be requested for failed or cancelled orders"
            });
        }

        if (order.refunded || order.status === "refunded") {
            return res.json({
                success: false,
                message: "This order has already been refunded"
            });
        }

        if (order.refundRequested || order.status === "refund_requested") {
            return res.json({
                success: false,
                message: "Refund request already submitted"
            });
        }

        order.status = "refund_requested";
        order.refundRequested = true;
        order.refundRequestReason = String(reason).trim();
        order.refundRequestedAt = new Date();
        order.note = "Refund request submitted. Admin will review your request.";

        await order.save();

        const notification = await createNotification({
            username: order.username,
            title: "Refund Request Submitted",
            message: `Your refund request for ${order.game} - ${order.packageName} has been submitted.`,
            type: "refund",
            category: "refunds",
            orderId: order.orderId
        });

        await realtime.emitNotification(order.username, notification);
        await realtime.emitOrderUpdate(order.username, order);

        realtime.emitAdminOrderUpdate({
            type: "refund_requested",
            orderId: order.orderId,
            username: order.username,
            amount: order.amount,
            currency: order.currency
        });

        await sendTelegramMessage(
            `💸 REFUND REQUESTED

📦 Order:
${order.orderId}

🎮 Game:
${order.game}

📦 Package:
${order.packageName}

👤 User:
${order.username}

💰 Amount:
${order.amount} ${order.currency}

📝 Reason:
${order.refundRequestReason}`
        );

        res.json({
            success: true,
            message: "Refund request submitted",
            order
        });

    } catch (error) {
        console.log("Refund request error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
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
            "refund_requested",
            "refund_pending",
            "refund_rejected",
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
            failed: "❌ Your order failed. You may request a wallet refund.",
            refund_requested: "Refund request submitted. Admin will review your request.",
            refund_pending: "Refund is being reviewed.",
            refund_rejected: "Refund request was rejected.",
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
            message: `${order.game} - ${order.packageName} is now ${formatStatusText(order.status)}`,
            type: "order",
            category: "orders",
            orderId: order.orderId
        });

        await realtime.emitNotification(order.username, notification || {
            title: "Order Updated",
            message: `${order.game} is now ${order.status}`,
            orderId: order.orderId,
            isRead: false
        });
        await realtime.emitOrderUpdate(order.username, order);

        realtime.emitAdminOrderUpdate({
            type: "order_status",
            orderId: order.orderId,
            username: order.username,
            status: order.status,
            game: order.game
        });

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

// ADMIN APPROVE REFUND TO WALLET
// POST /api/admin/orders/:id/refund/approve
router.post("/admin/orders/:id/refund/approve", adminMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        if (order.refunded || order.status === "refunded") {
            return res.json({
                success: false,
                message: "This order has already been refunded"
            });
        }

        if (!order.refundRequested && order.status !== "refund_requested") {
            return res.json({
                success: false,
                message: "Customer has not requested refund yet"
            });
        }

        const refundAmount = Number(order.amount || 0);
        const currencyKey = getCurrencyKey(order.currency);

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
            transactionId: createTransactionId("RF"),
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
        order.refundReason =
            String(reason || "").trim() ||
            order.refundRequestReason ||
            "Refund approved by admin";
        order.refundMethod = "wallet";
        order.refundedBy = "admin";
        order.refundedAt = new Date();
        order.note = `Refunded to wallet. Reason: ${order.refundReason}`;

        await order.save();

        const notification = await createNotification({
            username: order.username,
            title: "Refund Completed",
            message: `${refundAmount.toLocaleString()} ${currencyKey} has been returned to your AZIEL Wallet.`,
            type: "refund",
            category: "refunds",
            orderId: order.orderId
        });

        await realtime.emitWalletUpdate(order.username, {
            amount: user.wallet?.[currencyKey] || 0,
            currency: currencyKey,
            status: "refund"
        });

        await realtime.emitNotification(order.username, notification);
        await realtime.emitOrderUpdate(order.username, order);

        realtime.emitAdminOrderUpdate({
            type: "order_refunded",
            orderId: order.orderId,
            username: order.username,
            amount: refundAmount,
            currency: currencyKey
        });

        await sendTelegramMessage(
            `✅ REFUND APPROVED TO WALLET

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
${order.refundReason}`
        );

        res.json({
            success: true,
            message: "Refund approved and returned to wallet",
            order,
            balance: user.wallet?.[currencyKey] || 0
        });

    } catch (error) {
        console.log("Approve refund error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ADMIN REJECT REFUND
// POST /api/admin/orders/:id/refund/reject
router.post("/admin/orders/:id/refund/reject", adminMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;

        if (!reason || !String(reason).trim()) {
            return res.json({
                success: false,
                message: "Reject reason is required"
            });
        }

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        if (!order.refundRequested && order.status !== "refund_requested") {
            return res.json({
                success: false,
                message: "No refund request to reject"
            });
        }

        if (order.refunded || order.status === "refunded") {
            return res.json({
                success: false,
                message: "This order has already been refunded"
            });
        }

        order.status = "refund_rejected";
        order.refundRejectedReason = String(reason).trim();
        order.note = `Refund rejected. Reason: ${order.refundRejectedReason}`;

        await order.save();

        const notification = await createNotification({
            username: order.username,
            title: "Refund Request Rejected",
            message: order.refundRejectedReason,
            type: "refund",
            category: "refunds",
            orderId: order.orderId
        });

        await realtime.emitNotification(order.username, notification);
        await realtime.emitOrderUpdate(order.username, order);

        realtime.emitAdminOrderUpdate({
            type: "refund_rejected",
            orderId: order.orderId,
            username: order.username
        });

        await sendTelegramMessage(
            `❌ REFUND REJECTED

📦 Order:
${order.orderId}

👤 User:
${order.username}

📝 Reason:
${order.refundRejectedReason}`
        );

        res.json({
            success: true,
            message: "Refund request rejected",
            order
        });

    } catch (error) {
        console.log("Reject refund error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// LEGACY DIRECT ADMIN REFUND - Optional compatibility
// POST /api/admin/orders/:id/refund
router.post("/admin/orders/:id/refund", adminMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        if (!order.refundRequested && order.status !== "refund_requested") {
            return res.json({
                success: false,
                message: "Customer has not requested refund yet"
            });
        }

        req.url = `/admin/orders/${req.params.id}/refund/approve`;
        return router.handle(req, res);

    } catch (error) {
        console.log("Legacy refund error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// LEGACY / MANUAL ORDER CREATE
router.post("/orders", authMiddleware, upload.single("paymentSlip"), async (req, res) => {
    try {
        const order = await Order.create({
            orderId: req.body.orderId,
            username: getAuthenticatedUsername(req),
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

function formatStatusText(status) {
    return String(status || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = router;
