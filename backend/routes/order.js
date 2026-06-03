// backend/routes/order.js
const Order = require("../models/Order");

const upload = require("../middleware/orderUpload");

const {
    sendTelegramMessage,
    sendTelegramPhoto
} = require("../services/telegram");
const express = require("express");
const router = express.Router();

const Order = require("../models/Order");

const {
    sendTelegramMessage,
    sendTelegramPhoto
} = require("../services/telegram");

const createNotification =
    require("../services/createNotification");

const adminMiddleware =
    require("../middleware/adminMiddleware");


// ============================
// CUSTOMER ORDER HISTORY
// GET /api/history/:username
// ============================

router.get("/history/:username", async (req, res) => {
    try {
        const orders = await Order.find({
            username: req.params.username
        }).sort({ createdAt: -1 });

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


// ============================
// TRACK SINGLE ORDER
// GET /api/order/track/:orderId
// ============================

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
            order
        });

    } catch (error) {
        console.log("Track error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});


// ============================
// ADMIN GET ALL ORDERS
// GET /api/admin/orders
// ============================

router.get(
    "/admin/orders",
    adminMiddleware,
    async (req, res) => {
        try {
            const orders = await Order.find()
                .sort({ createdAt: -1 });

            res.json({
                success: true,
                orders
            });

        } catch (error) {
            console.log("Admin orders error:", error);

            res.json({
                success: false,
                message: "Server error"
            });
        }
    }
);


// ============================
// ADMIN UPDATE ORDER STATUS
// PUT /api/admin/orders/:id/status
// ============================

router.put(
    "/admin/orders/:id/status",
    adminMiddleware,
    async (req, res) => {
        try {
            const { status } = req.body;

            const allowedStatus = [
                "pending_payment",
                "paid",
                "processing",
                "completed",
                "cancelled",
                "failed"
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
                failed: "❌ Your order failed. Please contact support."
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

            await createNotification({
                username: order.username,
                title: "Order Status Updated",
                message: `${order.game} - ${order.packageName} is now ${order.status}`,
                type: "order",
                orderId: order.orderId
            });

            const io = req.app.get("io");

            if (io) {

                io.to(order.username).emit("newNotification", {
                    title: "Order Updated",
                    message: `${order.game} is now ${order.status}`,
                    _id: order._id,
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
    }
);
router.post(
    "/orders",
    upload.single("paymentSlip"),
    async (req, res) => {

        try {

            const order = await Order.create({
                orderId: req.body.orderId,
                username: req.body.username || "guest",
                game: req.body.game,
                userId: req.body.userId,
                zoneId: req.body.zoneId || "",
                packageName: req.body.packageName,
                amount: req.body.amount,
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

            console.log(
                "Create order error:",
                error
            );

            res.status(500).json({
                success: false,
                message: "Create order failed"
            });

        }

    }
);

module.exports = router;