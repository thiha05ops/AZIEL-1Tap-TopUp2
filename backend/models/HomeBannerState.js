const mongoose = require("mongoose");

const homeBannerStateSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            default: "home_banners"
        },
        managed: {
            type: Boolean,
            default: false
        },
        managedAt: {
            type: Date,
            default: null
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

module.exports = mongoose.model("HomeBannerState", homeBannerStateSchema);
