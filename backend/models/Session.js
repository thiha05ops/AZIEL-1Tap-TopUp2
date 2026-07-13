const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
    {
        sessionId: {
            type: String,
            required: true,
            unique: true
        },

        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        userAgent: {
            type: String,
            default: ""
        },

        deviceName: {
            type: String,
            default: "Unknown Device"
        },

        deviceType: {
            type: String,
            enum: [
                "windows",
                "macos",
                "ios",
                "android",
                "linux",
                "unknown",
                "mobile",
                "tablet",
                "desktop",
                ""
            ],
            default: "unknown"
        },

        deviceLabel: {
            type: String,
            default: "Unknown Device"
        },

        platform: {
            type: String,
            default: ""
        },

        browser: {
            type: String,
            default: ""
        },

        ipAddress: {
            type: String,
            default: ""
        },

        lastSeenAt: {
            type: Date,
            default: Date.now
        },

        expiresAt: {
            type: Date,
            required: true
        },

        revokedAt: {
            type: Date,
            default: null
        },

        revokeReason: {
            type: String,
            default: ""
        }
    },
    {
        timestamps: true
    }
);

sessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });

module.exports = mongoose.model("Session", sessionSchema);
