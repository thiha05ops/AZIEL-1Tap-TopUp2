const mongoose = require("mongoose");
const {
    PRICING_POLICY_STATUS,
    PRICING_RULE_SCOPE,
    PRICING_RULE_TYPE,
    CURRENCY,
    REGION
} = require("../constants/commerce");
const { percentValidator, applyMetadataValidation, validateStartBeforeEnd } = require("./commerceSchemas");

const pricingRuleSchema = new mongoose.Schema(
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
        policyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PricingPolicy",
            required: true
        },
        status: {
            type: String,
            enum: PRICING_POLICY_STATUS,
            default: "DRAFT",
            required: true
        },
        scopeType: {
            type: String,
            enum: PRICING_RULE_SCOPE,
            required: true
        },
        scopeReference: {
            type: String,
            trim: true,
            default: ""
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
        priority: {
            type: Number,
            min: 0,
            default: 0
        },
        ruleType: {
            type: String,
            enum: PRICING_RULE_TYPE,
            required: true
        },
        value: {
            type: Number,
            min: 0,
            default: 0,
            validate: {
                validator(value) {
                    return !String(this.ruleType || "").endsWith("_PERCENT") || percentValidator.validator(value);
                },
                message: "Percent pricing rule value must be between 0 and 100."
            }
        },
        configuration: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        effectiveFrom: {
            type: Date,
            default: null
        },
        effectiveUntil: {
            type: Date,
            default: null
        },
        stopFurtherProcessing: {
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

pricingRuleSchema.pre("validate", validateStartBeforeEnd("effectiveFrom", "effectiveUntil"));
applyMetadataValidation(pricingRuleSchema, "configuration");
applyMetadataValidation(pricingRuleSchema);

pricingRuleSchema.index({ code: 1 }, { unique: true });
pricingRuleSchema.index({ policyId: 1, status: 1, priority: -1 });
pricingRuleSchema.index({ scopeType: 1, scopeReference: 1 });
pricingRuleSchema.index({ region: 1, currency: 1 });
pricingRuleSchema.index({ effectiveFrom: 1, effectiveUntil: 1 });

module.exports = mongoose.model("PricingRule", pricingRuleSchema);
