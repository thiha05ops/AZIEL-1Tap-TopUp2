"use strict";

const mongoose = require("mongoose");

const schema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogOffer", required: true, immutable: true },
    schemaVersion: { type: Number, enum: [1], required: true, immutable: true },
    supplierCatalogProductId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogProduct", required: true, immutable: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true, immutable: true },
    catalogNamespace: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    supplierProductCode: { type: String, required: true, trim: true, immutable: true },
    supplierOfferCode: { type: String, required: true, trim: true, immutable: true },
    amount: { type: Number, min: 0, required: true },
    currency: { type: String, uppercase: true, trim: true, required: true },
    validatedObservedAt: { type: Date, required: true },
    sourceRevision: { type: String, trim: true, required: true },
    rawSnapshotHash: { type: String, lowercase: true, match: /^[a-f0-9]{64}$/, required: true },
    observedCostHash: { type: String, lowercase: true, match: /^[a-f0-9]{64}$/, required: true },
    ingestionRunId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogIngestionRun", required: true },
    runKey: { type: String, required: true, trim: true, maxlength: 200 },
    coverageState: { type: String, enum: ["PARTIAL", "COMPLETE"], required: true },
    publishedAt: { type: Date, required: true }
}, { timestamps: true, strict: "throw", minimize: false, autoIndex: process.env.NODE_ENV !== "production", autoCreate: process.env.NODE_ENV !== "production" });

module.exports = mongoose.model("SupplierCatalogLatestCost", schema);
