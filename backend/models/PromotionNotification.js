const mongoose = require("mongoose");

const promotionNotificationSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },
        summary: {
            type: String,
            required: true,
            trim: true
        },
        body: {
            type: String,
            default: "",
            trim: true
        },
        imageUrl: {
            type: String,
            default: "",
            trim: true
        },
        icon: {
            type: String,
            default: "gift",
            trim: true
        },
        ctaLabel: {
            type: String,
            default: "",
            trim: true
        },
        ctaUrl: {
            type: String,
            default: "",
            trim: true
        },
        promoCode: {
            type: String,
            default: "",
            trim: true,
            uppercase: true
        },
        campaignCode: {
            type: String,
            default: "",
            trim: true,
            uppercase: true
        },
        regions: {
            type: [String],
            enum: ["MM", "TH"],
            default: ["MM", "TH"]
        },
        audience: {
            type: String,
            enum: ["ALL_VISITORS", "LOGGED_IN", "GUESTS"],
            default: "ALL_VISITORS"
        },
        startsAt: {
            type: Date,
            default: null
        },
        endsAt: {
            type: Date,
            default: null
        },
        priority: {
            type: Number,
            default: 0
        },
        enabled: {
            type: Boolean,
            default: false
        },
        publishedAt: {
            type: Date,
            default: null
        },
        disabledAt: {
            type: Date,
            default: null
        },
        createdBy: {
            type: String,
            default: "admin",
            trim: true
        },
        updatedBy: {
            type: String,
            default: "admin",
            trim: true
        }
    },
    { timestamps: true }
);

promotionNotificationSchema.index({ enabled: 1, startsAt: 1, endsAt: 1, priority: -1, publishedAt: -1 });
promotionNotificationSchema.index({ regions: 1, audience: 1, enabled: 1 });
promotionNotificationSchema.index({ promoCode: 1 });
promotionNotificationSchema.index({ campaignCode: 1 });

module.exports = mongoose.model("PromotionNotification", promotionNotificationSchema);
