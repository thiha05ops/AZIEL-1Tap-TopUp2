const mongoose = require("mongoose");

const USER_COUPON_STATUSES = Object.freeze(["AVAILABLE", "RESERVED", "USED", "EXPIRED"]);

const userCouponSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        promoCodeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PromoCode",
            required: true,
            index: true
        },
        promoCode: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            index: true
        },
        status: {
            type: String,
            enum: USER_COUPON_STATUSES,
            default: "AVAILABLE",
            required: true,
            index: true
        },
        claimedAt: {
            type: Date,
            required: true,
            default: Date.now
        },
        expiresAt: {
            type: Date,
            default: null,
            index: true
        },
        reservedQuoteId: {
            type: String,
            trim: true,
            default: "",
            index: true
        },
        reservedOrderId: {
            type: String,
            trim: true,
            default: "",
            index: true
        },
        reservationToken: {
            type: String,
            trim: true,
            default: "",
            index: true
        },
        reservedAt: {
            type: Date,
            default: null
        },
        reservationExpiresAt: {
            type: Date,
            default: null,
            index: true
        },
        usedOrderId: {
            type: String,
            trim: true,
            default: "",
            index: true
        },
        usedAt: {
            type: Date,
            default: null
        },
        lastReleasedAt: {
            type: Date,
            default: null
        },
        snapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true,
        minimize: false
    }
);

userCouponSchema.index({ userId: 1, promoCodeId: 1 }, { unique: true });
userCouponSchema.index({ userId: 1, status: 1, expiresAt: 1 });
userCouponSchema.index({ status: 1, reservationExpiresAt: 1 });

module.exports = mongoose.model("UserCoupon", userCouponSchema);
module.exports.USER_COUPON_STATUSES = USER_COUPON_STATUSES;
