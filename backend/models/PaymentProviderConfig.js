const mongoose = require("mongoose");

const providerEnvironmentSchema = new mongoose.Schema(
    {
        environment: {
            type: String,
            enum: ["TEST", "LIVE"],
            required: true
        },
        enabled: {
            type: Boolean,
            default: false
        },
        publicKeyConfigured: {
            type: Boolean,
            default: false
        },
        secretKeyConfigured: {
            type: Boolean,
            default: false
        },
        webhookSecretConfigured: {
            type: Boolean,
            default: false
        },
        merchantIdentifierConfigured: {
            type: Boolean,
            default: false
        },
        healthState: {
            type: String,
            enum: ["READY", "DEGRADED", "NOT_CONFIGURED", "DISABLED", "BROKEN", "LEGACY", "HIDDEN"],
            default: "NOT_CONFIGURED"
        },
        lastCheckedAt: {
            type: Date,
            default: null
        },
        lastWebhookReceivedAt: {
            type: Date,
            default: null
        },
        lastWebhookVerifiedAt: {
            type: Date,
            default: null
        },
        lastWebhookEventType: {
            type: String,
            default: ""
        },
        lastErrorSummary: {
            type: String,
            default: ""
        }
    },
    { _id: false }
);

const paymentProviderConfigSchema = new mongoose.Schema(
    {
        providerCode: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        displayName: {
            type: String,
            required: true
        },
        legalRegions: {
            type: [String],
            default: []
        },
        supportedCurrencies: {
            type: [String],
            default: []
        },
        supportedRails: {
            type: [String],
            default: []
        },
        adapterName: {
            type: String,
            default: ""
        },
        enabled: {
            type: Boolean,
            default: false
        },
        checkoutModes: {
            type: [String],
            default: []
        },
        cardNetworks: {
            type: [String],
            default: []
        },
        refundCapability: {
            type: Boolean,
            default: false
        },
        partialRefundCapability: {
            type: Boolean,
            default: false
        },
        minAmount: {
            type: Number,
            default: 0
        },
        maxAmount: {
            type: Number,
            default: 0
        },
        feeConfig: {
            percentageFee: { type: Number, default: 0 },
            fixedFee: { type: Number, default: 0 },
            feeAbsorbedBy: {
                type: String,
                enum: ["CUSTOMER", "MERCHANT"],
                default: "MERCHANT"
            },
            displayText: { type: String, default: "" }
        },
        environments: {
            type: [providerEnvironmentSchema],
            default: []
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("PaymentProviderConfig", paymentProviderConfigSchema);
