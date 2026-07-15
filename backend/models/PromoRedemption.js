const mongoose = require("mongoose");

const promoRedemptionSchema = new mongoose.Schema(
    {
        promoCodeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PromoCode",
            required: true,
            index: true
        },
        code: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true
        },
        username: {
            type: String,
            trim: true,
            default: "",
            index: true
        },
        orderId: {
            type: String,
            trim: true,
            default: "",
            index: true
        },
        manualPaymentAttemptId: {
            type: String,
            trim: true,
            default: "",
            index: true
        },
        region: {
            type: String,
            enum: ["MM", "TH"],
            required: true
        },
        currency: {
            type: String,
            enum: ["MMK", "THB"],
            required: true
        },
        originalAmount: {
            type: Number,
            required: true
        },
        discountAmount: {
            type: Number,
            required: true
        },
        finalAmount: {
            type: Number,
            required: true
        },
        status: {
            type: String,
            enum: ["RESERVED", "CONSUMED", "RELEASED"],
            default: "RESERVED",
            index: true
        },
        expiresAt: {
            type: Date,
            default: null,
            index: true
        },
        releasedAt: {
            type: Date,
            default: null
        },
        consumedAt: {
            type: Date,
            default: null
        },
        snapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { timestamps: true }
);

promoRedemptionSchema.index({ code: 1, username: 1, status: 1, expiresAt: 1 });
promoRedemptionSchema.index({ manualPaymentAttemptId: 1, status: 1 });
promoRedemptionSchema.index({ orderId: 1, status: 1 });

module.exports = mongoose.model("PromoRedemption", promoRedemptionSchema);
