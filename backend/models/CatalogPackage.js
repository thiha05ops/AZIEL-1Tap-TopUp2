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
        iconAssetId: {
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

module.exports = mongoose.model("CatalogPackage", catalogPackageSchema);
