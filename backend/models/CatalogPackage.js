const mongoose = require("mongoose");
const { SUPPLIER_CURRENCY, STOREFRONT_CURRENCY } = require("../constants/commerce");

const regionalPriceSchema = new mongoose.Schema(
    {
        amount: {
            type: Number,
            required: true
        },
        currency: {
            type: String,
            enum: STOREFRONT_CURRENCY,
            required: true
        },
        referencePrice: {
            type: Number,
            min: 0,
            default: null
        },
        showDiscount: {
            type: Boolean,
            default: false
        },
        showSaveAmount: {
            type: Boolean,
            default: true
        },
        showOriginalPrice: {
            type: Boolean,
            default: true
        },
        discountLabel: {
            type: String,
            trim: true,
            maxlength: 40,
            default: ""
        },
        publishedPriceMode: {
            type: String,
            enum: ["POLICY_DERIVED", "MANUAL_OVERRIDE", "LEGACY_COMPATIBILITY_PRICE"],
            default: "LEGACY_COMPATIBILITY_PRICE"
        },
        manualOverrideReason: {
            type: String,
            trim: true,
            default: ""
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
            enum: SUPPLIER_CURRENCY,
            default: null
        },
        rawSupplierCost: { type: Number, min: 0, default: null },
        rawSupplierCurrency: { type: String, enum: SUPPLIER_CURRENCY, default: null },
        supplierCostSource: { type: String, trim: true, default: "" },
        providerProductCode: { type: String, trim: true, default: "" },
        providerOfferCode: { type: String, trim: true, default: "" },
        fxRate: { type: Number, min: 0, default: null },
        fxRateSource: { type: String, trim: true, default: "" },
        fxRateCapturedAt: { type: Date, default: null },
        fxRateEffectiveAt: { type: Date, default: null },
        fxRateExpiresAt: { type: Date, default: null },
        fxRateMaxAgeSeconds: { type: Number, min: 0, default: null },
        fxConvertedCost: { type: Number, min: 0, default: null },
        fundingCost: { type: Number, min: 0, default: 0 },
        otherAcquisitionCost: { type: Number, min: 0, default: 0 },
        landedCost: { type: Number, min: 0, default: null },
        landedCurrency: { type: String, enum: STOREFRONT_CURRENCY, default: null },
        supplierName: {
            type: String,
            trim: true,
            default: ""
        },
        supplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Supplier",
            default: null
        },
        supplierCode: {
            type: String,
            trim: true,
            uppercase: true,
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
            enum: [...SUPPLIER_CURRENCY, ""],
            default: ""
        },
        newSupplierCurrency: {
            type: String,
            enum: [...SUPPLIER_CURRENCY, ""],
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
        aliases: {
            type: [String],
            default: []
        },
        productAliases: {
            type: [String],
            default: []
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        packageFamily: {
            code: { type: String, trim: true, uppercase: true, maxlength: 80, default: "" },
            name: { type: String, trim: true, maxlength: 120, default: "" },
            sortOrder: { type: Number, min: 0, default: 90 },
            parentCode: { type: String, trim: true, uppercase: true, maxlength: 80, default: "" },
            authority: { type: String, trim: true, maxlength: 120, default: "CANONICAL_PACKAGE_FAMILY" }
        },
        customerNote: {
            type: String,
            trim: true,
            maxlength: 500,
            default: ""
        },
        customerNoteLocales: {
            en: { type: String, trim: true, maxlength: 500, default: "" },
            my: { type: String, trim: true, maxlength: 500, default: "" },
            th: { type: String, trim: true, maxlength: 500, default: "" }
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
        canonicalSupplierCost: {
            supplierId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Supplier",
                default: null
            },
            supplierCode: {
                type: String,
                trim: true,
                uppercase: true,
                default: ""
            },
            supplierName: {
                type: String,
                trim: true,
                default: ""
            },
            amount: {
                type: Number,
                min: 0,
                default: null
            },
            currency: {
                type: String,
                enum: SUPPLIER_CURRENCY,
                default: null
            },
            rawSupplierCost: { type: Number, min: 0, default: null },
            rawSupplierCurrency: { type: String, enum: SUPPLIER_CURRENCY, default: null },
            supplierCostSource: { type: String, trim: true, default: "" },
            providerProductCode: { type: String, trim: true, default: "" },
            providerOfferCode: { type: String, trim: true, default: "" },
            fxRate: { type: Number, min: 0, default: null },
            fxRateSource: { type: String, trim: true, default: "" },
            fxRateCapturedAt: { type: Date, default: null },
            fxRateEffectiveAt: { type: Date, default: null },
            fxRateExpiresAt: { type: Date, default: null },
            fxRateMaxAgeSeconds: { type: Number, min: 0, default: null },
            fxConvertedCost: { type: Number, min: 0, default: null },
            fundingCost: { type: Number, min: 0, default: 0 },
            otherAcquisitionCost: { type: Number, min: 0, default: 0 },
            landedCost: { type: Number, min: 0, default: null },
            landedCurrency: { type: String, enum: STOREFRONT_CURRENCY, default: null },
            capturedAt: {
                type: Date,
                default: null
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
        pricingPublicationHistory: {
            type: [mongoose.Schema.Types.Mixed],
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

catalogPackageSchema.index(
    { productCode: 1, packageCode: 1 },
    { unique: true }
);
catalogPackageSchema.index({ productCode: 1, sortOrder: 1 });
catalogPackageSchema.index({ enabled: 1 });
catalogPackageSchema.index({ iconAssetId: 1 });
catalogPackageSchema.index({ productCode: 1, deletedAt: 1 });
catalogPackageSchema.index({ productAliases: 1, packageCode: 1 });

module.exports = mongoose.model("CatalogPackage", catalogPackageSchema);
