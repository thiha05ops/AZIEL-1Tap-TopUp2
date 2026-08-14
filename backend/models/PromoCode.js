const mongoose = require("mongoose");

const amountByRegionSchema = new mongoose.Schema(
    {
        MM: { type: Number, default: 0 },
        TH: { type: Number, default: 0 }
    },
    { _id: false }
);

const eligiblePackageSchema = new mongoose.Schema(
    {
        productCode: {
            type: String,
            required: true,
            trim: true,
            lowercase: true
        },
        packageCode: {
            type: String,
            required: true,
            trim: true,
            uppercase: true
        }
    },
    { _id: false }
);

const promoCodeSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            immutable: true,
            trim: true,
            uppercase: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        discountType: {
            type: String,
            enum: ["PERCENTAGE", "FIXED"],
            required: true
        },
        percentageValue: {
            type: Number,
            default: 0
        },
        fixedAmounts: {
            type: amountByRegionSchema,
            default: () => ({})
        },
        maximumDiscountAmounts: {
            type: amountByRegionSchema,
            default: () => ({})
        },
        minimumOrderAmounts: {
            type: amountByRegionSchema,
            default: () => ({})
        },
        regions: {
            type: [String],
            enum: ["MM", "TH"],
            default: ["MM", "TH"]
        },
        eligibilityMode: {
            type: String,
            enum: ["ALL", "PRODUCTS", "PACKAGES"],
            default: "ALL"
        },
        eligibleProductCodes: {
            type: [String],
            default: []
        },
        eligiblePackages: {
            type: [eligiblePackageSchema],
            default: []
        },
        usageLimit: {
            type: Number,
            default: 0
        },
        perUserLimit: {
            type: Number,
            default: 0
        },
        startsAt: {
            type: Date,
            default: null
        },
        endsAt: {
            type: Date,
            default: null
        },
        enabled: {
            type: Boolean,
            default: false
        },
        archivedAt: {
            type: Date,
            default: null
        },
        createdBy: {
            type: String,
            trim: true,
            default: "admin"
        },
        updatedBy: {
            type: String,
            trim: true,
            default: "admin"
        }
    },
    { timestamps: true }
);

promoCodeSchema.index({ enabled: 1, archivedAt: 1, startsAt: 1, endsAt: 1 });
promoCodeSchema.index({ regions: 1, eligibilityMode: 1 });

module.exports = mongoose.model("PromoCode", promoCodeSchema);
