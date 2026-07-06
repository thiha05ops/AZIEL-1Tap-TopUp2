const mongoose = require("mongoose");

const notificationSchema =
    new mongoose.Schema(
        {
            username: {
                type: String,
                required: true
            },

            title: {
                type: String,
                required: true
            },

            message: {
                type: String,
                default: ""
            },

            type: {
                type: String,
                enum: [
                    "order",
                    "wallet",
                    "refund",
                    "support",
                    "order_completed",
                    "topup_delayed",
                    "announcement",
                    "promo",
                    "system",
                    "general"
                ],
                default: "general"
            },

            category: {
                type: String,
                enum: [
                    "orders",
                    "wallet",
                    "refunds",
                    "support",
                    "announcements",
                    "promotions",
                    "system"
                ],
                default: "system"
            },

            orderId: {
                type: String,
                default: ""
            },

            isRead: {
                type: Boolean,
                default: false
            },

            isArchived: {
                type: Boolean,
                default: false
            },

            deletedByUser: {
                type: Boolean,
                default: false
            },

            expiresAt: {
                type: Date,
                default: () => {
                    return new Date(
                        Date.now() + 90 * 24 * 60 * 60 * 1000
                    );
                }
            }
        },
        {
            timestamps: true
        }
    );

module.exports =
    mongoose.model(
        "Notification",
        notificationSchema
    );