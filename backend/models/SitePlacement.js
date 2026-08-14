const mongoose = require("mongoose");

const sitePlacementItemSchema = new mongoose.Schema(
    {
        itemType: {
            type: String,
            enum: ["product", "promo"],
            required: true
        },
        productCode: {
            type: String,
            trim: true,
            lowercase: true,
            default: ""
        },
        promoCode: {
            type: String,
            trim: true,
            uppercase: true,
            default: ""
        },
        sortOrder: {
            type: Number,
            default: 0
        }
    },
    { _id: false }
);

const sitePlacementSchema = new mongoose.Schema(
    {
        placementCode: {
            type: String,
            enum: [
                "HOME_POPULAR_GAMES",
                "HOME_TOPUP_SHORTCUTS",
                "HOME_LATEST_PROMOTIONS"
            ],
            required: true,
            immutable: true,
            unique: true,
            trim: true,
            uppercase: true
        },
        managed: {
            type: Boolean,
            default: false
        },
        items: {
            type: [sitePlacementItemSchema],
            default: []
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
    { timestamps: true }
);

module.exports = mongoose.model("SitePlacement", sitePlacementSchema);
