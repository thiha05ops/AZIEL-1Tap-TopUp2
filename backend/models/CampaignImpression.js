const mongoose = require("mongoose");
const { CAMPAIGN_PLACEMENTS } = require("../catalog/campaignPlacements");

const campaignImpressionSchema = new mongoose.Schema(
    {
        campaignId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Campaign",
            default: null,
            index: true
        },
        campaignCode: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        placement: {
            type: String,
            enum: CAMPAIGN_PLACEMENTS,
            required: true
        },
        frequencyPolicy: {
            type: String,
            enum: ["ONCE_PER_SESSION", "ONCE_PER_DAY", "ONCE_EVERY_3_DAYS", "ONCE_PER_CAMPAIGN"],
            required: true
        },
        dayKey: {
            type: String,
            trim: true,
            default: ""
        },
        sessionKey: {
            type: String,
            trim: true,
            default: ""
        },
        shownAt: {
            type: Date,
            required: true,
            default: Date.now,
            index: true
        }
    },
    {
        timestamps: true
    }
);

campaignImpressionSchema.index({ userId: 1, campaignCode: 1, placement: 1, shownAt: -1 });

module.exports = mongoose.model("CampaignImpression", campaignImpressionSchema);
