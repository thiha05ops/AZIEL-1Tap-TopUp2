const mongoose = require("mongoose");
const crypto = require("crypto");
const { PRICE_VERSION_STATUS } = require("../constants/commerce");
const { packageIdentitySchema, applyMetadataValidation } = require("./commerceSchemas");

const validationSummarySchema = new mongoose.Schema(
    {
        valid: {
            type: Boolean,
            default: false
        },
        errorCount: {
            type: Number,
            min: 0,
            default: 0
        },
        warningCount: {
            type: Number,
            min: 0,
            default: 0
        },
        checkedAt: {
            type: Date,
            default: null
        }
    },
    { _id: false }
);

const priceVersionSchema = new mongoose.Schema(
    {
        versionId: {
            type: String,
            required: true,
            immutable: true,
            trim: true,
            default: () => crypto.randomUUID()
        },
        versionNumber: {
            type: Number,
            required: true,
            min: 1,
            immutable: true
        },
        branchKey: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            default: "main"
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        description: {
            type: String,
            trim: true,
            default: ""
        },
        status: {
            type: String,
            enum: PRICE_VERSION_STATUS,
            required: true,
            default: "DRAFT"
        },
        pricingPolicyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PricingPolicy",
            default: null
        },
        pricingRuleIds: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: "PricingRule" }],
            default: []
        },
        promotionRuleIds: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: "PromotionRule" }],
            default: []
        },
        campaignIds: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: "CommerceCampaign" }],
            default: []
        },
        parentVersionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PriceVersion",
            default: null
        },
        sourceVersionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PriceVersion",
            default: null
        },
        rollbackOfVersionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PriceVersion",
            default: null
        },
        changeSummary: {
            type: String,
            trim: true,
            default: ""
        },
        affectedPackages: {
            type: [packageIdentitySchema],
            default: []
        },
        validationSummary: {
            type: validationSummarySchema,
            default: () => ({})
        },
        approvedBy: {
            type: String,
            trim: true,
            default: ""
        },
        approvedAt: {
            type: Date,
            default: null
        },
        publishedBy: {
            type: String,
            trim: true,
            default: ""
        },
        publishedAt: {
            type: Date,
            default: null
        },
        supersededAt: {
            type: Date,
            default: null
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

applyMetadataValidation(priceVersionSchema);

priceVersionSchema.index({ versionId: 1 }, { unique: true });
priceVersionSchema.index({ branchKey: 1, versionNumber: 1 }, { unique: true });
priceVersionSchema.index({ status: 1, branchKey: 1 });
priceVersionSchema.index({ versionNumber: 1 });
priceVersionSchema.index({ status: 1, createdAt: -1 });
priceVersionSchema.index({ pricingPolicyId: 1 });
priceVersionSchema.index({ pricingRuleIds: 1 });
priceVersionSchema.index({ promotionRuleIds: 1 });
priceVersionSchema.index({ campaignIds: 1 });
priceVersionSchema.index({ parentVersionId: 1 });
priceVersionSchema.index({ sourceVersionId: 1 });
priceVersionSchema.index({ rollbackOfVersionId: 1 });
priceVersionSchema.index({ publishedAt: -1 });
priceVersionSchema.index({ "affectedPackages.packageId": 1 });

module.exports = mongoose.model("PriceVersion", priceVersionSchema);
