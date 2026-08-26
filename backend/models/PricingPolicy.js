const mongoose = require("mongoose");
const { PRICING_POLICY_STATUS, CURRENCY, REGION } = require("../constants/commerce");
const {
    moneyRuleSchema,
    profitRuleSchema,
    roundingRuleSchema,
    percentValidator,
    applyMetadataValidation,
    validateStartBeforeEnd
} = require("./commerceSchemas");

const pricingPolicySchema = new mongoose.Schema(
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
            enum: PRICING_POLICY_STATUS,
            default: "DRAFT",
            required: true
        },
        region: {
            type: String,
            enum: REGION,
            required: true
        },
        currency: {
            type: String,
            enum: CURRENCY,
            required: true
        },
        effectiveFrom: {
            type: Date,
            default: null
        },
        effectiveUntil: {
            type: Date,
            default: null
        },
        defaultSupplierFee: {
            type: moneyRuleSchema,
            default: () => ({})
        },
        defaultBusinessCost: {
            type: moneyRuleSchema,
            default: () => ({})
        },
        defaultPlatformCost: {
            type: moneyRuleSchema,
            default: () => ({})
        },
        defaultGatewayFee: {
            type: moneyRuleSchema,
            default: () => ({})
        },
        defaultTax: {
            type: moneyRuleSchema,
            default: () => ({})
        },
        defaultProfitRule: {
            type: profitRuleSchema,
            default: () => ({})
        },
        defaultRoundingRule: {
            type: roundingRuleSchema,
            default: () => ({})
        },
        minimumProfitAmount: {
            type: Number,
            min: 0,
            default: 0
        },
        maximumProfitAmount: {
            type: Number,
            min: 0,
            default: null
        },
        minimumProfitMarginPercent: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
            validate: percentValidator
        },
        allowBelowMarginOverride: {
            type: Boolean,
            default: false
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

pricingPolicySchema.pre("validate", validateStartBeforeEnd("effectiveFrom", "effectiveUntil"));
pricingPolicySchema.pre("validate", function validateProfitGuardrails() {
    if (this.maximumProfitAmount != null && Number(this.maximumProfitAmount) < Number(this.minimumProfitAmount || 0)) {
        this.invalidate("maximumProfitAmount", "Maximum profit must be greater than or equal to minimum profit.");
    }
});
applyMetadataValidation(pricingPolicySchema);

pricingPolicySchema.index({ code: 1 }, { unique: true });
pricingPolicySchema.index({ status: 1, region: 1, currency: 1 });
pricingPolicySchema.index({ effectiveFrom: 1, effectiveUntil: 1 });

module.exports = mongoose.model("PricingPolicy", pricingPolicySchema);
