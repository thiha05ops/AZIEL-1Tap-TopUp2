const mongoose = require("mongoose");
const { CAMPAIGN_STATUS, REGION } = require("../constants/commerce");
const { packageIdentitySchema, applyMetadataValidation, validateStartBeforeEnd } = require("./commerceSchemas");

const commerceCampaignSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        code: {
            type: String,
            required: true,
            immutable: true,
            trim: true,
            uppercase: true
        },
        description: {
            type: String,
            trim: true,
            default: ""
        },
        status: {
            type: String,
            enum: CAMPAIGN_STATUS,
            default: "DRAFT",
            required: true
        },
        startAt: {
            type: Date,
            default: null
        },
        endAt: {
            type: Date,
            default: null
        },
        timezone: {
            type: String,
            trim: true,
            default: "Asia/Bangkok"
        },
        promotionRuleIds: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: "PromotionRule" }],
            default: []
        },
        targetRegions: {
            type: [String],
            enum: REGION,
            default: []
        },
        targetGameIds: {
            type: [String],
            default: []
        },
        targetCategoryIds: {
            type: [String],
            default: []
        },
        targetTierIds: {
            type: [String],
            default: []
        },
        targetPackages: {
            type: [packageIdentitySchema],
            default: []
        },
        excludedPackages: {
            type: [packageIdentitySchema],
            default: []
        },
        targetUserSegments: {
            type: [String],
            default: []
        },
        budgetLimit: {
            type: Number,
            min: 0,
            default: 0
        },
        redemptionLimit: {
            type: Number,
            min: 0,
            default: 0
        },
        perUserLimit: {
            type: Number,
            min: 0,
            default: 0
        },
        priority: {
            type: Number,
            min: 0,
            default: 0
        },
        badgeText: {
            type: String,
            trim: true,
            default: ""
        },
        customerMessage: {
            type: String,
            trim: true,
            default: ""
        },
        placementKeys: {
            type: [String],
            default: []
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
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

commerceCampaignSchema.pre("validate", validateStartBeforeEnd("startAt", "endAt"));
applyMetadataValidation(commerceCampaignSchema);

commerceCampaignSchema.index({ code: 1 }, { unique: true });
commerceCampaignSchema.index({ status: 1, startAt: 1, endAt: 1 });
commerceCampaignSchema.index({ targetRegions: 1, priority: -1 });
commerceCampaignSchema.index({ promotionRuleIds: 1 });
commerceCampaignSchema.index({ placementKeys: 1 });
commerceCampaignSchema.index({ "targetPackages.packageId": 1 });
commerceCampaignSchema.index({ "excludedPackages.packageId": 1 });

module.exports = mongoose.model("CommerceCampaign", commerceCampaignSchema);
