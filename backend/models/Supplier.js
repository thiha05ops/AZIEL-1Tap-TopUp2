const mongoose = require("mongoose");

const SUPPLIER_MODES = Object.freeze({
    MANUAL: "MANUAL",
    API: "API"
});

const SUPPLIER_BALANCE_SOURCES = Object.freeze({
    UNKNOWN: "UNKNOWN",
    MANUAL: "MANUAL",
    API: "API"
});

const SUPPLIER_CONFIGURATION_STATUSES = Object.freeze({
    NOT_CONFIGURED: "NOT_CONFIGURED",
    CONFIGURED: "CONFIGURED",
    MANUAL_READY: "MANUAL_READY"
});

const supplierSchema = new mongoose.Schema(
    {
        supplierCode: {
            type: String,
            required: true,
            immutable: true,
            trim: true,
            uppercase: true,
            match: /^[A-Z0-9_-]{2,40}$/
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120
        },
        mode: {
            type: String,
            enum: Object.values(SUPPLIER_MODES),
            required: true,
            default: SUPPLIER_MODES.MANUAL
        },
        enabled: {
            type: Boolean,
            default: true
        },
        supportedRegions: {
            type: [String],
            enum: ["MM", "TH"],
            default: []
        },
        capabilities: {
            type: [String],
            default: []
        },
        balanceAmount: {
            type: Number,
            default: null
        },
        balanceCurrency: {
            type: String,
            enum: ["MMK", "THB", ""],
            default: ""
        },
        balanceSource: {
            type: String,
            enum: Object.values(SUPPLIER_BALANCE_SOURCES),
            default: SUPPLIER_BALANCE_SOURCES.UNKNOWN
        },
        lastBalanceSyncAt: {
            type: Date,
            default: null
        },
        configurationStatus: {
            type: String,
            enum: Object.values(SUPPLIER_CONFIGURATION_STATUSES),
            default: SUPPLIER_CONFIGURATION_STATUSES.MANUAL_READY
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true
    }
);

supplierSchema.index({ supplierCode: 1 }, { unique: true });
supplierSchema.index({ enabled: 1, mode: 1 });

module.exports = mongoose.model("Supplier", supplierSchema);
module.exports.SUPPLIER_MODES = SUPPLIER_MODES;
module.exports.SUPPLIER_BALANCE_SOURCES = SUPPLIER_BALANCE_SOURCES;
module.exports.SUPPLIER_CONFIGURATION_STATUSES = SUPPLIER_CONFIGURATION_STATUSES;
