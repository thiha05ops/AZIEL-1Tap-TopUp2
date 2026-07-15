const mongoose = require("mongoose");

const notificationSchema =
    new mongoose.Schema(
        {
            userId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                default: null,
                index: true
            },

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
                    "payments",
                    "wallet",
                    "refunds",
                    "support",
                    "announcements",
                    "promotions",
                    "security",
                    "system"
                ],
                default: "system"
            },

            status: {
                type: String,
                default: "active"
            },

            orderId: {
                type: String,
                default: ""
            },

            action: {
                type: mongoose.Schema.Types.Mixed,
                default: null
            },

            metadata: {
                type: mongoose.Schema.Types.Mixed,
                default: {}
            },

            source: {
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
                default: null
            }
        },
        {
            timestamps: true
        }
    );

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ username: 1, createdAt: -1 });
notificationSchema.index({ username: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ username: 1, createdAt: -1, _id: -1 });

module.exports =
    mongoose.model(
        "Notification",
        notificationSchema
    );
