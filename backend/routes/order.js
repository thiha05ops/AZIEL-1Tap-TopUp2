// backend/routes/order.js

const express = require("express");
const router = express.Router();

const Order = require("../models/Order");

const {
    sendTelegramMessage
} = require("../services/telegram");

const createNotification =
    require("../services/createNotification");

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || "AZIEL2026";


// ============================
// CUSTOMER ORDER HISTORY
// GET /api/history/:username
// ============================

router.get("/history/:username", async (req, res) => {

    try {

        const orders =
            await Order.find({
                username: req.params.username
            }).sort({
                createdAt: -1
            });

        res.json({
            success: true,
            orders
        });

    } catch (error) {

        console.log(
            "History error:",
            error
        );

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

        const order =
            await Order.findOne({
                orderId:
                    req.params.orderId
            });

        if (!order) {

            return res.json({
                success: false,
                message:
                    "Order not found"
            });

        }

        res.json({
            success: true,
            order
        });

    } catch (error) {

        console.log(
            "Track error:",
            error
        );

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

router.get("/admin/orders", async (req, res) => {

    try {

        const password =
            req.headers[
            "x-admin-password"
            ];

        if (
            password !==
            ADMIN_PASSWORD
        ) {

            return res.status(401)
                .json({
                    success: false,
                    message:
                        "Unauthorized"
                });

        }

        const orders =
            await Order.find()
                .sort({
                    createdAt: -1
                });

        res.json({
            success: true,
            orders
        });

    } catch (error) {

        console.log(
            "Admin orders error:",
            error
        );

        res.json({
            success: false,
            message: "Server error"
        });

    }

});


// ============================
// ADMIN UPDATE ORDER STATUS
// PUT /api/admin/orders/:id/status
// ============================

router.put(
    "/admin/orders/:id/status",
    async (req, res) => {

        try {

            const password =
                req.headers[
                "x-admin-password"
                ];

            if (
                password !==
                ADMIN_PASSWORD
            ) {

                return res.status(401)
                    .json({
                        success: false,
                        message:
                            "Unauthorized"
                    });

            }

            const { status } =
                req.body;

            const allowedStatus = [

                "pending_payment",

                "paid",

                "processing",

                "completed",

                "cancelled",

                "failed"

            ];

            if (
                !allowedStatus.includes(
                    status
                )
            ) {

                return res.json({
                    success: false,
                    message:
                        "Invalid status"
                });

            }

            const noteMap = {

                pending_payment:
                    "Waiting for payment confirmation.",

                paid:
                    "Payment received. Waiting for processing.",

                processing:
                    "Your order is processing.",

                completed:
                    "✅ Your order has been completed.",

                cancelled:
                    "❌ Your order has been cancelled.",

                failed:
                    "❌ Your order failed. Please contact support."

            };


            const order =
                await Order.findByIdAndUpdate(

                    req.params.id,

                    {
                        status,

                        note:
                            noteMap[status] || ""
                    },

                    {
                        new: true
                    }

                );

            if (!order) {

                return res.json({
                    success: false,
                    message:
                        "Order not found"
                });

            }


            // ============================
            // CREATE DATABASE NOTIFICATION
            // ============================

            await createNotification({

                username:
                    order.username,

                title:
                    "Order Status Updated",

                message:
                    `${order.game} - ${order.packageName} is now ${order.status}`,

                type:
                    "order",

                orderId:
                    order.orderId

            });


            // ============================
            // SOCKET.IO LIVE UPDATE
            // ============================

            const io =
                req.app.get("io");

            if (io) {

                io.to(order.username)
                    .emit(
                        "userOrderUpdate",
                        {
                            orderId:
                                order.orderId,

                            status:
                                order.status,

                            game:
                                order.game,

                            packageName:
                                order.packageName
                        }
                    );

            }


            // ============================
            // TELEGRAM ALERT
            // ============================

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

            console.log(
                "Update status error:",
                error
            );

            res.json({
                success: false,
                message: "Server error"
            });

        }

    }
);

module.exports = router;