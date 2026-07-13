// backend/routes/order.js

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const Order = require("../models/Order");

const upload = require("../middleware/orderUpload");
const authMiddleware = require("../middleware/authMiddleware");

const { sendTelegramMessage } = require("../services/telegram");

const createNotification = require("../services/createNotification");
const adminMiddleware = require("../middleware/adminMiddleware");
const realtime = require("../services/realtime");
const {
    NOTE_BY_STATUS,
    ORDER_STATES,
    PAYMENT_STATES,
    OrderStateError,
    getAllowedNextStatuses,
    projectOrderStatus,
    transitionOrder
} = require("../services/orderStateService");
const { CatalogError, resolveOrderCatalog } = require("../services/catalogService");
const { WalletError, creditRefund } = require("../services/walletService");
const {
    StorageError,
    cleanupAfterFailedPersistence,
    logStorageError,
    uploadFile
} = require("../services/storageService");

function getCurrencyKey(currency) {
    return String(currency || "").toUpperCase() === "THB" ? "THB" : "MMK";
}

const orderCreateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_ORDER_CREATE || 12),
    standardHeaders: true,
    legacyHeaders: false
});

function getRefundAllowedStatus(status) {
    return ["failed", "cancelled"].includes(String(status || "").toLowerCase());
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
        paymentStatus: order.paymentStatus || (order.status === "paid" ? "paid" : "pending"),
        note: order.note,
        timeline: Array.isArray(order.timeline) ? order.timeline : [],
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
        let order = await Order.findOne({
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

// AUTHENTICATED CANONICAL ORDER STATUS
router.get("/order/status/:orderId", authMiddleware, async (req, res) => {
    try {
        const order = await Order.findOne({
            orderId: req.params.orderId,
            username: getAuthenticatedUsername(req)
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                code: "ORDER_NOT_FOUND",
                message: "Order not found"
            });
        }

        return res.json({
            success: true,
            order: projectOrderStatus(order),
            allowedNextStatuses: getAllowedNextStatuses(order.status)
        });
    } catch (error) {
        console.log("Order status error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
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

        order.refundRequested = true;
        order.refundRequestReason = String(reason).trim();
        order.refundRequestedAt = new Date();
        const transition = await transitionOrder(order, ORDER_STATES.REFUND_REQUESTED, {
            source: "user",
            actorType: "user",
            actor: username,
            reason: "Customer refund request",
            idempotencyKey: `refund:request:${order.orderId}`
        });
        order = transition.order;

        const notification = await createNotification({
            username: order.username,
            title: "Refund Request Submitted",
            message: `Your refund request for ${order.game} - ${order.packageName} has been submitted.`,
            type: "refund",
            category: "refunds",
            orderId: order.orderId
        });

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
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        const transition = await transitionOrder(order, status, {
            source: "admin",
            actorType: "admin",
            actor: req.admin?.username || req.user?.username || "admin",
            reason: "Admin status update",
            paymentStatus: status === ORDER_STATES.PAID ? PAYMENT_STATES.PAID : undefined,
            idempotencyKey: `admin:status:${order.orderId}:${status}`
        });

        if (!transition.changed) {
            return res.json({
                success: true,
                order: transition.order,
                allowedNextStatuses: getAllowedNextStatuses(transition.order.status)
            });
        }

        const updatedOrder = transition.order;

        const notification = await createNotification({
            username: updatedOrder.username,
            title: "Order Status Updated",
            message: `${updatedOrder.game} - ${updatedOrder.packageName} is now ${formatStatusText(updatedOrder.status)}`,
            type: "order",
            category: "orders",
            orderId: updatedOrder.orderId
        });

        await sendTelegramMessage(
            `📦 ORDER STATUS UPDATED

🎮 Game:
${updatedOrder.game}

📦 Package:
${updatedOrder.packageName}

👤 User:
${updatedOrder.username}

📌 Status:
${updatedOrder.status}`
        );

        res.json({
            success: true,
            order: updatedOrder,
            allowedNextStatuses: getAllowedNextStatuses(updatedOrder.status)
        });

    } catch (error) {
        console.log("Update status error:", error);

        res.status(error instanceof OrderStateError ? error.status : 500).json({
            success: false,
            code: error.code || "ORDER_STATUS_UPDATE_FAILED",
            message: error instanceof OrderStateError ? error.message : "Server error"
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

        order.refunded = true;
        order.refundAmount = refundAmount;
        order.refundReason =
            String(reason || "").trim() ||
            order.refundRequestReason ||
            "Refund approved by admin";
        order.refundMethod = "wallet";
        order.refundedBy = "admin";
        order.refundedAt = new Date();
        const walletResult = await creditRefund(order, {
            performedBy: req.admin?.username || req.user?.username || "admin"
        });
        const transition = await transitionOrder(order, ORDER_STATES.REFUNDED, {
            source: "admin",
            actorType: "admin",
            actor: req.admin?.username || req.user?.username || "admin",
            reason: order.refundReason,
            paymentStatus: PAYMENT_STATES.REFUNDED,
            note: `Refunded to wallet. Reason: ${order.refundReason}`,
            idempotencyKey: `refund:approve:${order.orderId}`
        });
        const updatedOrder = transition.order;

        if (!walletResult.duplicate) {
            await createNotification({
                username: updatedOrder.username,
                title: "Refund Completed",
                message: `${refundAmount.toLocaleString()} ${currencyKey} has been returned to your AZIEL Wallet.`,
                type: "refund",
                category: "refunds",
                orderId: updatedOrder.orderId
            });
        }

        await realtime.emitWalletUpdate(order.username, {
            amount: walletResult.balance,
            balance: walletResult.balance,
            currency: currencyKey,
            status: "refund",
            latestTransaction: {
                type: walletResult.transaction?.type || "",
                direction: walletResult.transaction?.direction || "",
                amount: Number(walletResult.transaction?.amount || 0),
                balanceAfter: Number(walletResult.transaction?.balanceAfter ?? walletResult.balance),
                referenceType: walletResult.transaction?.referenceType || "",
                referenceId: walletResult.transaction?.referenceId || order.orderId,
                createdAt: walletResult.transaction?.createdAt || new Date()
            }
        });

        realtime.emitAdminOrderUpdate({
            type: "order_refunded",
            orderId: updatedOrder.orderId,
            username: updatedOrder.username,
            amount: refundAmount,
            currency: currencyKey
        });

        await sendTelegramMessage(
            `✅ REFUND APPROVED TO WALLET

📦 Order:
${updatedOrder.orderId}

🎮 Game:
${updatedOrder.game}

📦 Package:
${updatedOrder.packageName}

👤 User:
${updatedOrder.username}

💰 Refund:
${refundAmount} ${currencyKey}

📝 Reason:
${updatedOrder.refundReason}`
        );

        res.json({
            success: true,
            message: "Refund approved and returned to wallet",
            order: updatedOrder,
            balance: walletResult.balance,
            transaction: walletResult.transaction,
            duplicate: Boolean(walletResult.duplicate)
        });

    } catch (error) {
        console.log("Approve refund error:", error);

        if (error instanceof WalletError) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

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

        order.refundRejectedReason = String(reason).trim();
        const transition = await transitionOrder(order, ORDER_STATES.REFUND_REJECTED, {
            source: "admin",
            actorType: "admin",
            actor: req.admin?.username || req.user?.username || "admin",
            reason: order.refundRejectedReason,
            note: `Refund rejected. Reason: ${order.refundRejectedReason}`,
            idempotencyKey: `refund:reject:${order.orderId}`
        });
        const updatedOrder = transition.order;

        const notification = await createNotification({
            username: updatedOrder.username,
            title: "Refund Request Rejected",
            message: updatedOrder.refundRejectedReason,
            type: "refund",
            category: "refunds",
            orderId: updatedOrder.orderId
        });

        realtime.emitAdminOrderUpdate({
            type: "refund_rejected",
            orderId: updatedOrder.orderId,
            username: updatedOrder.username
        });

        await sendTelegramMessage(
            `❌ REFUND REJECTED

📦 Order:
${updatedOrder.orderId}

👤 User:
${updatedOrder.username}

📝 Reason:
${updatedOrder.refundRejectedReason}`
        );

        res.json({
            success: true,
            message: "Refund request rejected",
            order: updatedOrder
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
router.post("/orders", authMiddleware, orderCreateLimiter, upload.single("paymentSlip"), async (req, res) => {
    let evidence = null;
    let evidencePersisted = false;

    try {
        const username = getAuthenticatedUsername(req);

        if (!req.body.orderId || !req.body.paymentMethod || !req.body.userId) {
            return res.status(400).json({
                success: false,
                message: "Missing order data"
            });
        }

        const pendingCount = await Order.countDocuments({
            username,
            status: "pending_payment",
            createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) }
        });

        if (pendingCount >= Number(process.env.MAX_PENDING_ORDERS_PER_USER || 5)) {
            return res.status(429).json({
                success: false,
                code: "TOO_MANY_PENDING_ORDERS",
                message: "You have too many pending orders. Please complete or wait before creating another."
            });
        }

        const existingOrder = await Order.findOne({ orderId: req.body.orderId });
        if (existingOrder) {
            return res.status(409).json({
                success: false,
                code: "DUPLICATE_ORDER_ID",
                message: "Order already exists"
            });
        }

        const catalogItem = resolveOrderCatalog(req.body);

        if (req.file) {
            evidence = await uploadFile({
                file: req.file,
                category: "paymentSlip",
                ownerReference: req.body.orderId
            });
        }

        const order = await Order.create({
            orderId: req.body.orderId,
            username,
            game: catalogItem.productName,
            productCode: catalogItem.productCode,
            productName: catalogItem.productName,
            userId: req.body.userId,
            zoneId: req.body.zoneId || "",
            packageName: catalogItem.packageName,
            packageCode: catalogItem.packageCode,
            amount: catalogItem.amount,
            currency: catalogItem.currency,
            region: catalogItem.region,
            paymentMethod: req.body.paymentMethod,
            paymentSlip: evidence?.url || "",
            paymentEvidence: evidence || undefined,
            status: ORDER_STATES.PENDING_PAYMENT,
            paymentStatus: PAYMENT_STATES.PENDING,
            timeline: [{
                status: ORDER_STATES.PENDING_PAYMENT,
                previousStatus: "",
                paymentStatus: PAYMENT_STATES.PENDING,
                source: "user",
                actorType: "user",
                actor: username,
                reason: "Order created",
                idempotencyKey: `order:create:${req.body.orderId}`,
                at: new Date()
            }]
        });
        evidencePersisted = true;

        res.json({
            success: true,
            order
        });

    } catch (error) {
        console.log("Create order error:", error);

        if (evidence && !evidencePersisted) {
            await cleanupAfterFailedPersistence(evidence);
        }

        if (error instanceof CatalogError) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        if (error instanceof StorageError) {
            logStorageError(error.code, {
                provider: error.provider,
                category: "paymentSlip",
                orderId: req.body?.orderId
            });

            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

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
