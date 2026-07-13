const mongoose = require("mongoose");

const manualPaymentAttemptSchema = new mongoose.Schema(
    {
        attemptId: {
            type: String,
            required: true,
            unique: true
        },
        username: {
            type: String,
            required: true,
            index: true
        },
        productCode: {
            type: String,
            required: true
        },
        packageCode: {
            type: String,
            required: true
        },
        region: {
            type: String,
            required: true
        },
        canonicalAmount: {
            type: Number,
            required: true
        },
        canonicalCurrency: {
            type: String,
            required: true
        },
        productName: {
            type: String,
            required: true
        },
        packageName: {
            type: String,
            required: true
        },
        paymentMethod: {
            type: String,
            required: true
        },
        paymentType: {
            type: String,
            enum: ["manual", "deeplink"],
            default: "manual"
        },
        provider: {
            type: String,
            default: "manual"
        },
        reference: {
            type: String,
            required: true,
            unique: true
        },
        gameUserData: {
            userId: { type: String, required: true },
            zoneId: { type: String, default: "" }
        },
        instructions: {
            method: { type: String, default: "" },
            key: { type: String, default: "" },
            accountName: { type: String, default: "" },
            accountNumber: { type: String, default: "" },
            qrImage: { type: String, default: "" }
        },
        status: {
            type: String,
            enum: ["active", "consumed", "expired"],
            default: "active",
            index: true
        },
        expiresAt: {
            type: Date,
            required: true,
            index: true
        },
        consumedAt: {
            type: Date,
            default: null
        },
        orderId: {
            type: String,
            default: ""
        },
        evidence: {
            provider: { type: String, default: "" },
            key: { type: String, default: "" },
            url: { type: String, default: "" },
            mimeType: { type: String, default: "" },
            size: { type: Number, default: 0 },
            originalName: { type: String, default: "" },
            uploadedAt: { type: Date, default: null }
        }
    },
    {
        timestamps: true
    }
);

manualPaymentAttemptSchema.index({ username: 1, status: 1, expiresAt: 1 });
manualPaymentAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

module.exports = mongoose.model("ManualPaymentAttempt", manualPaymentAttemptSchema);
