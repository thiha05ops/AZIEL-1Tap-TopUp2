const mongoose = require("mongoose");

const campaignClaimStateSchema = new mongoose.Schema(
    {
        campaignCode: {
            type: String,
            required: true,
            trim: true,
            uppercase: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        placement: {
            type: String,
            enum: ["ENTRY_POPUP"],
            required: true
        },
        lastShownAt: {
            type: Date,
            default: null
        },
        lastDayKey: {
            type: String,
            trim: true,
            default: ""
        },
        sessionKeys: {
            type: [String],
            default: []
        }
    },
    {
        timestamps: true
    }
);

campaignClaimStateSchema.index(
    { campaignCode: 1, userId: 1, placement: 1 },
    { unique: true }
);

module.exports = mongoose.model("CampaignClaimState", campaignClaimStateSchema);
