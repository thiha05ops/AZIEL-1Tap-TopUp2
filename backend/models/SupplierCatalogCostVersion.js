"use strict";

const mongoose = require("mongoose");

const schema = new mongoose.Schema({
    _id: { type: String, required: true, lowercase: true, match: /^[a-f0-9]{64}$/, immutable: true },
    schemaVersion: { type: Number, required: true, enum: [1], immutable: true },
    supplierCatalogOfferId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogOffer", required: true, immutable: true },
    supplierCatalogProductId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogProduct", required: true, immutable: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true, immutable: true },
    catalogNamespace: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    supplierProductCode: { type: String, required: true, trim: true, immutable: true },
    supplierOfferCode: { type: String, required: true, trim: true, immutable: true },
    amount: { type: Number, min: 0, required: true, immutable: true },
    currency: { type: String, uppercase: true, trim: true, required: true, immutable: true },
    sourceRevision: { type: String, trim: true, required: true, immutable: true },
    rawSnapshotHash: { type: String, lowercase: true, match: /^[a-f0-9]{64}$/, required: true, immutable: true },
    firstObservedAt: { type: Date, required: true, immutable: true }
}, { timestamps: { createdAt: true, updatedAt: false }, strict: "throw", minimize: false, autoIndex: process.env.NODE_ENV !== "production", autoCreate: process.env.NODE_ENV !== "production" });

schema.index({ supplierCatalogOfferId: 1, firstObservedAt: -1 });

module.exports = mongoose.model("SupplierCatalogCostVersion", schema);
