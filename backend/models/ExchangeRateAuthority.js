"use strict";

const mongoose = require("mongoose");
const { PRICING_CALCULATION_CURRENCY } = require("../constants/commerce");

const schema = new mongoose.Schema({
    code: { type: String, required: true, trim: true, uppercase: true, unique: true, immutable: true },
    fromCurrency: { type: String, required: true, enum: PRICING_CALCULATION_CURRENCY, uppercase: true },
    toCurrency: { type: String, required: true, enum: PRICING_CALCULATION_CURRENCY, uppercase: true },
    rate: { type: Number, required: true, min: Number.MIN_VALUE },
    source: { type: String, required: true, trim: true },
    capturedAt: { type: Date, required: true },
    maximumAgeSeconds: { type: Number, required: true, min: 60 },
    status: { type: String, enum: ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"], default: "DRAFT", required: true },
    authoritative: { type: Boolean, default: true, required: true },
    enabled: { type: Boolean, default: true, required: true },
    effectiveFrom: { type: Date, default: null },
    effectiveUntil: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: String, trim: true, default: "admin" },
    updatedBy: { type: String, trim: true, default: "admin" }
}, { timestamps: true });

schema.index({ fromCurrency: 1, toCurrency: 1, status: 1, effectiveFrom: -1 });
schema.index({ status: 1, enabled: 1, authoritative: 1 });

module.exports = mongoose.model("ExchangeRateAuthority", schema);
