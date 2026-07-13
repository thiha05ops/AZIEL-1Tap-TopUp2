const mongoose = require("mongoose");

const securityEventSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        username: {
            type: String,
            default: ""
        },

        type: {
            type: String,
            required: true,
            enum: [
                "login.success",
                "login.failed",
                "session.created",
                "password.changed",
                "password.reset",
                "email.verified",
                "session.created",
                "session.revoked",
                "sessions.revoked_all",
                "sessions.revoked_others",
                "google.login",
                "google.linked",
                "two_factor.enabled",
                "two_factor.disabled",
                "two_factor.challenge_failed",
                "recovery_codes.regenerated",
                "recovery_code.used"
            ]
        },

        title: {
            type: String,
            required: true
        },

        sessionId: {
            type: String,
            default: ""
        },

        ipAddress: {
            type: String,
            default: ""
        },

        userAgent: {
            type: String,
            default: ""
        },

        deviceName: {
            type: String,
            default: ""
        },

        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true
    }
);

securityEventSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("SecurityEvent", securityEventSchema);
