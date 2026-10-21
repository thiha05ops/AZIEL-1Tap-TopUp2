"use strict";

const mongoose = require("mongoose");

const entrySchema = new mongoose.Schema({
    o: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogOffer", required: true, immutable: true },
    v: { type: String, required: true, lowercase: true, match: /^[a-f0-9]{64}$/, immutable: true }
}, { _id: false, strict: "throw" });

const schema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogIngestionRun", required: true, immutable: true },
    schemaVersion: { type: Number, required: true, enum: [1], immutable: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true, immutable: true },
    catalogNamespace: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    runKey: { type: String, required: true, trim: true, maxlength: 200, immutable: true },
    observedAt: { type: Date, required: true, immutable: true },
    coverageState: { type: String, enum: ["UNKNOWN", "PARTIAL", "COMPLETE"], required: true, immutable: true },
    rowCount: { type: Number, min: 0, required: true, immutable: true },
    manifestHash: { type: String, required: true, lowercase: true, match: /^[a-f0-9]{64}$/, immutable: true },
    entries: { type: [entrySchema], required: true, immutable: true }
}, { timestamps: { createdAt: true, updatedAt: false }, strict: "throw", minimize: false, autoIndex: process.env.NODE_ENV !== "production", autoCreate: process.env.NODE_ENV !== "production" });

schema.index({ supplierId: 1, observedAt: -1 });
schema.index({ "entries.o": 1, observedAt: -1 });

module.exports = mongoose.model("SupplierCatalogRunEvidenceManifest", schema);
