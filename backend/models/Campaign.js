const mongoose = require("mongoose");
const { CAMPAIGN_PLACEMENTS } = require("../catalog/campaignPlacements");

const campaignSchema = new mongoose.Schema(
    {
        campaignCode: {
            type: String,
            required: true,
            unique: true,
            immutable: true,
            trim: true,
            uppercase: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        type: {
            type: String,
            enum: ["PROMOTION", "NEW_GAME", "ANNOUNCEMENT", "IMPORTANT_UPDATE"],
            required: true
        },
        placement: {
            type: String,
            enum: CAMPAIGN_PLACEMENTS,
            required: true,
            default: "ENTRY_POPUP"
        },
        targetProductCode: {
            type: String,
            trim: true,
            lowercase: true,
            default: "",
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        body: {
            type: String,
            required: true,
            trim: true
        },
        mediaAssetId: {
            type: String,
            trim: true,
            default: "",
            index: true
        },
        ctaLabel: {
            type: String,
            trim: true,
            default: ""
        },
        locales: {
            en: { type: mongoose.Schema.Types.Mixed, default: undefined },
            my: { type: mongoose.Schema.Types.Mixed, default: undefined },
            th: { type: mongoose.Schema.Types.Mixed, default: undefined }
        },
        ctaTarget: {
            type: String,
            trim: true,
            default: ""
        },
        regions: {
            type: [String],
            enum: ["MM", "TH"],
            default: ["MM", "TH"]
        },
        audience: {
            type: String,
            enum: ["ALL_VISITORS", "LOGGED_IN", "GUESTS"],
            default: "ALL_VISITORS"
        },
        startsAt: {
            type: Date,
            default: null
        },
        endsAt: {
            type: Date,
            default: null
        },
        frequencyPolicy: {
            type: String,
            enum: ["ONCE_PER_SESSION", "ONCE_PER_DAY", "ONCE_EVERY_3_DAYS", "ONCE_PER_CAMPAIGN"],
            default: "ONCE_PER_SESSION"
        },
        priority: {
            type: Number,
            default: 0
        },
        enabled: {
            type: Boolean,
            default: false
        },
        hasBeenEnabled: {
            type: Boolean,
            default: false
        },
        archivedAt: {
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

campaignSchema.index({ placement: 1, enabled: 1, archivedAt: 1, priority: -1, campaignCode: 1 });
campaignSchema.index({ mediaAssetId: 1, archivedAt: 1 });

module.exports = mongoose.model("Campaign", campaignSchema);
