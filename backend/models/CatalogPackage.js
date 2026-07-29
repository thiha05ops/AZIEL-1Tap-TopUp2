const mongoose = require("mongoose");

const regionalPriceSchema = new mongoose.Schema(
    {
        amount: {
            type: Number,
            required: true
        },
        currency: {
            type: String,
            enum: ["MMK", "THB"],
            required: true
        },
        enabled: {
            type: Boolean,
            default: true
        },
        supplierCost: {
            type: Number,
            min: 0,
            default: null
        },
        supplierCurrency: {
            type: String,
            enum: ["MMK", "THB"],
            default: null
        },
        supplierName: {
            type: String,
            trim: true,
            default: ""
        },
        supplierVersion: {
            type: String,
            trim: true,
            default: ""
        },
        supplierCostTimestamp: {
            type: Date,
            default: null
        },
        pricingNote: {
            type: String,
            trim: true,
            default: ""
        }
    },
    {
        _id: false
    }
);

const supplierCostHistorySchema = new mongoose.Schema(
    {
        region: {
            type: String,
            enum: ["MM", "TH"],
            required: true
        },
        previousSupplierCost: {
            type: Number,
            default: null
        },
        newSupplierCost: {
            type: Number,
            default: null
        },
        previousSupplierCurrency: {
            type: String,
            enum: ["MMK", "THB", ""],
            default: ""
        },
        newSupplierCurrency: {
            type: String,
            enum: ["MMK", "THB", ""],
            default: ""
        },
        supplierName: {
            type: String,
            trim: true,
            default: ""
        },
        supplierVersion: {
            type: String,
            trim: true,
            default: ""
        },
        supplierCostTimestamp: {
            type: Date,
            default: null
        },
        pricingNote: {
            type: String,
            trim: true,
            default: ""
        },
        changedBy: {
            type: String,
            trim: true,
            default: "admin"
        },
        changedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        _id: false
    }
);

const catalogPackageSchema = new mongoose.Schema(
    {
        productCode: {
            type: String,
            required: true,
            immutable: true,
            trim: true,
            lowercase: true
        },
        packageCode: {
            type: String,
            required: true,
            immutable: true,
            trim: true,
            uppercase: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        enabled: {
            type: Boolean,
            default: true
        },
        prices: {
            MM: {
                type: regionalPriceSchema,
                default: undefined
            },
            TH: {
                type: regionalPriceSchema,
                default: undefined
            }
        },
        sortOrder: {
            type: Number,
            default: 0
        },
        source: {
            type: String,
            enum: ["seeded", "admin"],
            default: "seeded"
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        supplierCostHistory: {
            type: [supplierCostHistorySchema],
            default: []
        },
        iconAssetId: {
            type: String,
            trim: true,
            default: ""
        },
        deletedAt: {
            type: Date,
            default: null
        },
        deletedBy: {
            type: String,
            trim: true,
            default: ""
        }
    },
    {
        timestamps: true
    }
);

catalogPackageSchema.index({ productCode: 1, packageCode: 1 }, { unique: true });
catalogPackageSchema.index({ productCode: 1, sortOrder: 1 });
catalogPackageSchema.index({ enabled: 1 });
catalogPackageSchema.index({ iconAssetId: 1 });
catalogPackageSchema.index({ productCode: 1, deletedAt: 1 });

module.exports = mongoose.model("CatalogPackage", catalogPackageSchema);
