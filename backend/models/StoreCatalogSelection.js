"use strict";

const mongoose = require("mongoose");

const selectedPackageSchema = new mongoose.Schema({
    packageCode: { type: String, required: true, trim: true, uppercase: true },
    supplierProductMappingId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierProductMapping", required: true }
}, { _id: false });

const storeCatalogSelectionSchema = new mongoose.Schema({
    productCode: { type: String, required: true, trim: true, lowercase: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    supplierCode: { type: String, required: true, trim: true, uppercase: true },
    supplierMarket: { type: String, required: true, trim: true, uppercase: true },
    sellingRegions: { type: [String], enum: ["TH", "MM"], default: [] },
    visibleRegions: { type: [String], enum: ["TH", "MM"], default: [] },
    packages: { type: [selectedPackageSchema], default: [] },
    status: { type: String, enum: ["ACTIVE", "REMOVED"], default: "ACTIVE" },
    decisionVersion: { type: Number, min: 1, default: 1 },
    selectedBy: { type: String, trim: true, default: "admin" },
    selectedAt: { type: Date, default: Date.now },
    removedBy: { type: String, trim: true, default: "" },
    removedAt: { type: Date, default: null },
    provenance: {
        source: { type: String, trim: true, default: "ADMIN" },
        sourceHash: { type: String, trim: true, default: "" },
        planHash: { type: String, trim: true, default: "" },
        reversible: { type: Boolean, default: true }
    }
}, { timestamps: true });

storeCatalogSelectionSchema.index({ productCode: 1, supplierMarket: 1 }, { unique: true, name: "one_store_selection_per_product_account_market" });
storeCatalogSelectionSchema.index({ status: 1, sellingRegions: 1 });
storeCatalogSelectionSchema.index({ "packages.supplierProductMappingId": 1 });

module.exports = mongoose.model("StoreCatalogSelection", storeCatalogSelectionSchema);
