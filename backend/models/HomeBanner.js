const mongoose = require("mongoose");

const homeBannerSchema = new mongoose.Schema(
    {
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
        ctaLabelLocales: {
            en: { type: String, trim: true, maxlength: 40, default: "" },
            my: { type: String, trim: true, maxlength: 40, default: "" },
            th: { type: String, trim: true, maxlength: 40, default: "" }
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
        }
    },
    {
        timestamps: true
    }
);

homeBannerSchema.index({ sortOrder: 1, _id: 1 });
homeBannerSchema.index({ enabled: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model("HomeBanner", homeBannerSchema);
