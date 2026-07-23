const mongoose = require("mongoose");

const gameBannerSchema = new mongoose.Schema(
    {
        productCode: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        mediaAssetId: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        enabled: {
            type: Boolean,
            default: true
        },
        sortOrder: {
            type: Number,
            default: 0
        },
        ctaLabel: {
            type: String,
            trim: true,
            default: ""
        },
        ctaTarget: {
            type: String,
            trim: true,
            default: ""
        },
        startsAt: {
            type: Date,
            default: null
        },
        endsAt: {
            type: Date,
            default: null
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
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
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

gameBannerSchema.index({ productCode: 1, sortOrder: 1, _id: 1 });
gameBannerSchema.index({ productCode: 1, enabled: 1, startsAt: 1, endsAt: 1 });
gameBannerSchema.index({ productCode: 1, deletedAt: 1 });

module.exports = mongoose.model("GameBanner", gameBannerSchema);
