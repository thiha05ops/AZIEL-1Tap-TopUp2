"use strict";

const mongoose = require("mongoose");
const { MAX_RAW_SNAPSHOT_BYTES, canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");

const SUPPORT_STATES = Object.freeze(["DISCOVERED", "SUPPORTED", "UNSUPPORTED", "REVIEW_REQUIRED", "RETIRED"]);
const boundedSnapshot = value => Buffer.byteLength(canonicalJson(value || {})) <= MAX_RAW_SNAPSHOT_BYTES;

const supplierCatalogProductSchema = new mongoose.Schema({
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true, immutable: true },
    catalogNamespace: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
    supplierProductCode: { type: String, required: true, trim: true, maxlength: 160 },
    supplierMarketCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 80, default: "UNSPECIFIED", match: /^[A-Z0-9_-]+$/ },
    displayName: { type: String, trim: true, maxlength: 240, default: "" },
    rawName: { type: String, trim: true, maxlength: 500, default: "" },
    categoryCode: { type: String, trim: true, maxlength: 160, default: "" },
    supportState: { type: String, enum: SUPPORT_STATES, required: true, default: "DISCOVERED" },
    requiredFields: { type: [mongoose.Schema.Types.Mixed], default: [] },
    normalizedInputContract: { type: mongoose.Schema.Types.Mixed, default: {} },
    validationCapability: { type: mongoose.Schema.Types.Mixed, default: {} },
    restrictions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    lastObservedAt: { type: Date, required: true },
    lastChangedAt: { type: Date, required: true },
    sourceRevision: { type: String, trim: true, maxlength: 160, default: "" },
    rawSnapshotHash: { type: String, trim: true, lowercase: true, match: /^[a-f0-9]{64}$/, required: true },
    rawSnapshot: { type: mongoose.Schema.Types.Mixed, default: {}, validate: { validator: boundedSnapshot, message: "Supplier catalog raw snapshot exceeds the 64 KiB limit." } }
}, { timestamps: true, strict: "throw", minimize: false });

supplierCatalogProductSchema.index({ supplierId: 1, catalogNamespace: 1, supplierProductCode: 1 }, { unique: true, name: "one_supplier_catalog_product_identity" });
supplierCatalogProductSchema.index({ supplierId: 1, supplierMarketCode: 1, supportState: 1 });
supplierCatalogProductSchema.index({ lastObservedAt: 1 });
supplierCatalogProductSchema.index({ rawSnapshotHash: 1 });

module.exports = mongoose.model("SupplierCatalogProduct", supplierCatalogProductSchema);
module.exports.SUPPORT_STATES = SUPPORT_STATES;
