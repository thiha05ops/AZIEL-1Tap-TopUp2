const mongoose = require("mongoose");
const schema = new mongoose.Schema({
    productCode: { type: String, required: true, trim: true, lowercase: true },
    packageCode: { type: String, required: true, trim: true, uppercase: true },
    region: { type: String, required: true, enum: ["TH", "MM"] },
    profitOverride: {
        mode: { type: String, enum: ["INHERIT", "FIXED_AMOUNT", "PERCENTAGE"], default: "INHERIT" },
        value: { type: Number, min: 0, default: null }
    },
    updatedBy: { type: String, trim: true, default: "admin" }
}, { timestamps: true });
schema.pre("validate", function() {
    const mode = this.profitOverride?.mode || "INHERIT";
    if (mode === "INHERIT") this.profitOverride.value = null;
    else if (!Number.isFinite(Number(this.profitOverride?.value))) this.invalidate("profitOverride.value", "Profit override value is required.");
    else if (mode === "PERCENTAGE" && Number(this.profitOverride.value) > 100) this.invalidate("profitOverride.value", "Percentage must not exceed 100.");
});
schema.index({ productCode: 1, packageCode: 1, region: 1 }, { unique: true });
module.exports = mongoose.model("PackagePricingOverride", schema);
