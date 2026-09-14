"use strict";

const mongoose = require("mongoose");

const adminOperationalNotificationSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
            index: true
        },

        category: {
            type: String,
            enum: [
                "orders",
                "payments",
                "wallet",
                "support",
                "live_chat",
                "system"
            ],
            default: "system",
            index: true
        },

        severity: {
            type: String,
            enum: ["info", "success", "warning", "critical"],
            default: "info",
            index: true
        },

        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 180
        },

        message: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: ""
        },

        resourceType: {
            type: String,
            trim: true,
            maxlength: 80,
            default: ""
        },

        resourceId: {
            type: String,
            trim: true,
            maxlength: 180,
            default: ""
        },

        requiredPermission: {
            type: String,
            trim: true,
            maxlength: 100,
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
            trim: true,
            maxlength: 120,
            default: "realtime"
        },

        dedupeKey: {
            type: String,
            trim: true,
            maxlength: 240,
            default: undefined
        },

        readBy: {
            type: [
                {
                    adminId: {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: "AdminAccount",
                        required: true
                    },
                    readAt: {
                        type: Date,
                        default: Date.now
                    }
                }
            ],
            default: []
        }
    },
    {
        timestamps: true
    }
);

adminOperationalNotificationSchema.index({ createdAt: -1, _id: -1 });
adminOperationalNotificationSchema.index({ "readBy.adminId": 1, createdAt: -1, _id: -1 });
adminOperationalNotificationSchema.index({ category: 1, createdAt: -1, _id: -1 });
adminOperationalNotificationSchema.index({ requiredPermission: 1, createdAt: -1, _id: -1 });

adminOperationalNotificationSchema.index(
    { dedupeKey: 1 },
    {
        unique: true,
        partialFilterExpression: {
            dedupeKey: { $type: "string" }
        }
    }
);

module.exports = mongoose.model(
    "AdminOperationalNotification",
    adminOperationalNotificationSchema
);
