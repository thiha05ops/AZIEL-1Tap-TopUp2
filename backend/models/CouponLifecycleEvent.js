const mongoose = require("mongoose");

const EVENT_TYPES = Object.freeze(["CLAIMED", "RESERVED", "RELEASED", "CONSUMED", "EXPIRED"]);

const couponLifecycleEventSchema = new mongoose.Schema({
    eventKey: { type: String, required: true, immutable: true, trim: true },
    eventType: { type: String, required: true, immutable: true, enum: EVENT_TYPES },
    promoCodeId: { type: mongoose.Schema.Types.ObjectId, ref: "PromoCode", required: true, immutable: true },
    promoCode: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    userCouponId: { type: mongoose.Schema.Types.ObjectId, ref: "UserCoupon", required: true, immutable: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    quoteId: { type: String, trim: true, default: "", immutable: true },
    orderId: { type: String, trim: true, default: "", immutable: true },
    paymentAttemptId: { type: String, trim: true, default: "", immutable: true },
    originalAmount: { type: Number, min: 0, default: 0, immutable: true },
    discountAmount: { type: Number, min: 0, default: 0, immutable: true },
    finalAmount: { type: Number, min: 0, default: 0, immutable: true },
    currency: { type: String, uppercase: true, trim: true, default: "", immutable: true },
    source: { type: String, trim: true, default: "", immutable: true },
    reason: { type: String, trim: true, default: "", immutable: true },
    occurredAt: { type: Date, required: true, immutable: true, default: Date.now },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true }
}, { timestamps: true, minimize: false });

couponLifecycleEventSchema.index({ eventKey: 1 }, { unique: true });
couponLifecycleEventSchema.index({ userCouponId: 1, occurredAt: -1 });
couponLifecycleEventSchema.index({ promoCodeId: 1, eventType: 1, occurredAt: -1 });
couponLifecycleEventSchema.index({ orderId: 1, eventType: 1 });
couponLifecycleEventSchema.index(
    { userCouponId: 1, eventType: 1 },
    { unique: true, partialFilterExpression: { eventType: "CONSUMED" } }
);

module.exports = mongoose.model("CouponLifecycleEvent", couponLifecycleEventSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;
