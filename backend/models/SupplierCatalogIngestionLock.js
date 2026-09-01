"use strict";
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
    lockKey: { type: String, required: true, immutable: true, trim: true, maxlength: 200 },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    supplierCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
    ownerId: { type: String, required: true, trim: true, maxlength: 200 },
    acquiredAt: { type: Date, required: true },
    heartbeatAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    runKey: { type: String, trim: true, maxlength: 200, default: "" },
    version: { type: Number, min: 1, default: 1 }
}, { timestamps: true, strict: "throw", minimize: false });
schema.index({ lockKey: 1 }, { unique: true, name: "one_supplier_catalog_ingestion_lock" });
schema.index({ expiresAt: 1 }, { name: "supplier_catalog_ingestion_lock_expiry" });
schema.index({ supplierCode: 1, expiresAt: 1 }, { name: "supplier_catalog_ingestion_lock_supplier_expiry" });
module.exports = mongoose.model("SupplierCatalogIngestionLock", schema);
