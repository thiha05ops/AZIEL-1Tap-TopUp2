const mongoose = require("mongoose");

const walletTopupIntentSchema = new mongoose.Schema(
    {
        intentId: {
            type: String,
            required: true,
            unique: true
        },
        reference: {
            type: String,
            required: true,
            unique: true
        },
        username: {
            type: String,
            required: true,
            index: true
        },
        amount: {
            type: Number,
            required: true
        },
        currency: {
            type: String,
            required: true
        },
        region: {
            type: String,
            required: true
        },
        paymentMethod: {
            type: String,
            required: true
        },
        paymentProvider: {
            type: String,
            default: "manual"
        },
        paymentType: {
            type: String,
            enum: ["manual", "deeplink"],
            default: "manual"
        },
        methodSnapshot: {
            method: { type: String, default: "" },
            key: { type: String, default: "" },
            region: { type: String, default: "" },
            paymentType: { type: String, default: "" },
            provider: { type: String, default: "" },
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
            required: true
        },
        consumedAt: {
            type: Date,
            default: null
        },
        topupId: {
            type: String,
            default: ""
        }
    },
    { timestamps: true }
);

walletTopupIntentSchema.index({ username: 1, status: 1, expiresAt: 1 });
walletTopupIntentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 });

module.exports = mongoose.model("WalletTopupIntent", walletTopupIntentSchema);
