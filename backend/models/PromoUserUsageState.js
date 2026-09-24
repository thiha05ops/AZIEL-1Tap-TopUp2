const mongoose = require("mongoose");

const promoUserUsageStateSchema = new mongoose.Schema({
    code: { type: String, required: true, uppercase: true, trim: true },
    userKey: { type: String, required: true, trim: true },
    reservedCount: { type: Number, default: 0, min: 0 },
    consumedCount: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

promoUserUsageStateSchema.index({ code: 1, userKey: 1 }, { unique: true });

module.exports = mongoose.model("PromoUserUsageState", promoUserUsageStateSchema);
