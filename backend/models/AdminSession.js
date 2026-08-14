const mongoose = require("mongoose");

const adminSessionSchema = new mongoose.Schema(
    {
        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAccount",
            required: true
        },
        sessionId: {
            type: String,
            required: true,
            unique: true
        },
        createdAt: {
            type: Date,
            default: Date.now
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
        revokedByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAccount",
            default: null
        },
        revokeReason: {
            type: String,
            trim: true,
            maxlength: 200,
            default: ""
        },
        userAgentSummary: {
            type: String,
            trim: true,
            maxlength: 220,
            default: ""
        },
        ipHash: {
            type: String,
            trim: true,
            default: ""
        }
    }
);

adminSessionSchema.index({ adminId: 1, revokedAt: 1, expiresAt: 1 });
adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("AdminSession", adminSessionSchema);
