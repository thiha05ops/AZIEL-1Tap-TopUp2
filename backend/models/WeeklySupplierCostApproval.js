"use strict";

const mongoose = require("mongoose");

const candidateSchema = new mongoose.Schema({
    supplierCode: { type: String, required: true, uppercase: true, trim: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true, immutable: true },
    productCode: { type: String, required: true, trim: true, immutable: true },
    packageCode: { type: String, required: true, trim: true, immutable: true },
    mappingId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierProductMapping", required: true, immutable: true },
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogOffer", required: true, immutable: true },
    supplierProductCode: { type: String, required: true, trim: true, immutable: true },
    supplierOfferCode: { type: String, required: true, trim: true, immutable: true },
    currency: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    amount: { type: Number, required: true, min: 0, immutable: true },
    observedAt: { type: Date, required: true, immutable: true },
    observedCostHash: { type: String, required: true, lowercase: true, match: /^[a-f0-9]{64}$/, immutable: true },
    ingestionRunId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogIngestionRun", required: true, immutable: true }
}, { _id: false, strict: "throw" });

const schema = new mongoose.Schema({
    _id: { type: String, required: true, immutable: true },
    manifestHash: { type: String, required: true, lowercase: true, match: /^[a-f0-9]{64}$/, immutable: true },
    candidates: { type: [candidateSchema], required: true, immutable: true },
    status: { type: String, enum: ["PENDING", "APPROVED", "CONSUMED"], default: "PENDING", required: true },
    maximumInitialPromotions: { type: Number, min: 1, default: null },
    expiresAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: {
        adminId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminAccount", default: null },
        username: { type: String, trim: true, default: "" },
        role: { type: String, uppercase: true, trim: true, default: "" }
    },
    consumedAt: { type: Date, default: null },
    consumptionSummary: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true, strict: "throw", minimize: false, autoIndex: process.env.NODE_ENV !== "production", autoCreate: process.env.NODE_ENV !== "production" });

schema.index({ status: 1, expiresAt: 1 });
module.exports = mongoose.model("WeeklySupplierCostApproval", schema);
