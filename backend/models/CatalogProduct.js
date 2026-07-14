const mongoose = require("mongoose");

const catalogProductSchema = new mongoose.Schema(
    {
        productCode: {
            type: String,
            required: true,
            immutable: true,
            trim: true,
            lowercase: true
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
        supportedRegions: {
            type: [String],
            enum: ["MM", "TH"],
            default: []
        },
        aliases: {
            type: [String],
            default: []
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
        presentation: {
            imageAssetId: {
                type: String,
                trim: true,
                default: ""
            },
            bannerAssetId: {
                type: String,
                trim: true,
                default: ""
            }
        }
    },
    {
        timestamps: true
    }
);

catalogProductSchema.index({ productCode: 1 }, { unique: true });
catalogProductSchema.index({ enabled: 1, sortOrder: 1 });
catalogProductSchema.index({ "presentation.imageAssetId": 1 });
catalogProductSchema.index({ "presentation.bannerAssetId": 1 });

module.exports = mongoose.model("CatalogProduct", catalogProductSchema);
