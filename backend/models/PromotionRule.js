const mongoose = require("mongoose");
const {
    PROMOTION_RULE_STATUS,
    PROMOTION_TYPE,
    CURRENCY,
    REGION
} = require("../constants/commerce");
const {
    promotionScopeSchema,
    packageIdentitySchema,
    eligibilitySchema,
    percentValidator,
    applyMetadataValidation,
    validateEligibilityDepth,
    validateStartBeforeEnd
} = require("./commerceSchemas");

const promotionRuleSchema = new mongoose.Schema(
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
            enum: PROMOTION_RULE_STATUS,
            default: "DRAFT",
            required: true
        },
        promotionType: {
            type: String,
            enum: PROMOTION_TYPE,
            required: true
        },
        scopes: {
            type: [promotionScopeSchema],
            default: []
        },
        region: {
            type: String,
            enum: REGION,
            default: undefined
        },
        currency: {
            type: String,
            enum: CURRENCY,
            default: undefined
        },
        discountValue: {
            type: Number,
            min: 0,
            default: 0,
            validate: {
                validator(value) {
                    return this.promotionType !== "PERCENTAGE_DISCOUNT" || percentValidator.validator(value);
                },
                message: "Percentage discount value must be between 0 and 100."
            }
        },
        maximumDiscountAmount: {
            type: Number,
            min: 0,
            default: 0
        },
        minimumOrderAmount: {
            type: Number,
            min: 0,
            default: 0
        },
        overridePrice: {
            type: Number,
            min: 0,
            default: 0
        },
        priority: {
            type: Number,
            min: 0,
            default: 0
        },
        stackable: {
            type: Boolean,
            default: false
        },
        exclusive: {
            type: Boolean,
            default: false
        },
        usageLimitTotal: {
            type: Number,
            min: 0,
            default: 0
        },
        usageLimitPerUser: {
            type: Number,
            min: 0,
            default: 0
        },
        eligiblePaymentMethods: {
            type: [String],
            default: []
        },
        eligibleUserSegments: {
            type: [String],
            default: []
        },
        eligiblePackages: {
            type: [packageIdentitySchema],
            default: []
        },
        excludedPackages: {
            type: [packageIdentitySchema],
            default: []
        },
        eligibleGameIds: {
            type: [String],
            default: []
        },
        excludedGameIds: {
            type: [String],
            default: []
        },
        effectiveFrom: {
            type: Date,
            default: null
        },
        effectiveUntil: {
            type: Date,
            default: null
        },
        requiresCoupon: {
            type: Boolean,
            default: false
        },
        couponCode: {
            type: String,
            trim: true,
            uppercase: true,
            default: ""
        },
        restoreEligibilityOnQualifiedRefund: {
            type: Boolean,
            default: false
        },
        eligibility: {
            type: eligibilitySchema,
            default: () => ({ operator: "ALL", conditions: [] })
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

promotionRuleSchema.pre("validate", validateStartBeforeEnd("effectiveFrom", "effectiveUntil"));
applyMetadataValidation(promotionRuleSchema);
validateEligibilityDepth(promotionRuleSchema);

promotionRuleSchema.index({ code: 1 }, { unique: true });
promotionRuleSchema.index({ status: 1, priority: -1 });
promotionRuleSchema.index({ promotionType: 1 });
promotionRuleSchema.index({ region: 1, currency: 1 });
promotionRuleSchema.index({ couponCode: 1, requiresCoupon: 1 });
promotionRuleSchema.index({ effectiveFrom: 1, effectiveUntil: 1 });
promotionRuleSchema.index({ "eligiblePackages.packageId": 1 });
promotionRuleSchema.index({ "excludedPackages.packageId": 1 });

module.exports = mongoose.model("PromotionRule", promotionRuleSchema);
