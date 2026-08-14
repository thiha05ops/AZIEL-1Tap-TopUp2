const mongoose = require("mongoose");

const promoUsageStateSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true
        },
        consumedCount: {
            type: Number,
            default: 0
        },
        reservedCount: {
            type: Number,
            default: 0
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("PromoUsageState", promoUsageStateSchema);
