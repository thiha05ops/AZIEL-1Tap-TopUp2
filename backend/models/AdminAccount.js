const mongoose = require("mongoose");

const adminAccountSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            trim: true,
            minlength: 3,
            maxlength: 64
        },
        usernameNormalized: {
            type: String,
            required: true,
            unique: true,
            immutable: true,
            trim: true,
            lowercase: true,
            minlength: 3,
            maxlength: 64
        },
        displayName: {
            type: String,
            trim: true,
            maxlength: 100,
            default: ""
        },
        passwordHash: {
            type: String,
            required: true
        },
        role: {
            type: String,
            enum: ["OWNER", "OPERATIONS", "FINANCE", "SUPPORT", "CATALOG"],
            required: true,
            default: "SUPPORT"
        },
        status: {
            type: String,
            enum: ["ACTIVE", "DISABLED"],
            required: true,
            default: "ACTIVE"
        },
        twoFactor: {
            enabled: { type: Boolean, default: false },
            secretEncrypted: { type: String, default: "" },
            pendingSecretEncrypted: { type: String, default: "" },
            pendingExpiresAt: { type: Date, default: null },
            enabledAt: { type: Date, default: null }
        },
        passwordChangedAt: {
            type: Date,
            default: null
        },
        lastLoginAt: {
            type: Date,
            default: null
        },
        createdByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAccount",
            default: null
        },
        updatedByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAccount",
            default: null
        }
    },
    { timestamps: true }
);

adminAccountSchema.index({ usernameNormalized: 1 }, { unique: true });
adminAccountSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model("AdminAccount", adminAccountSchema);
