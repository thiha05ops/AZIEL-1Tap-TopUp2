"use strict";

const mongoose = require("mongoose");
const { MAX_RAW_SNAPSHOT_BYTES, canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");

const CATALOG_LIFECYCLE_STATES = Object.freeze(["ACTIVE", "STALE", "REVIEW_REQUIRED", "RETIRED"]);
const RECONCILIATION_STATES = Object.freeze(["UNREVIEWED", "EXACT_CANONICAL_MATCH", "SPECIAL_VARIANT", "AMBIGUOUS", "NO_CANONICAL_PACKAGE", "INTENTIONALLY_UNSUPPORTED", "MARKET_EVIDENCE_REQUIRED", "INPUT_CONTRACT_REQUIRED", "SEMANTIC_REVIEW_REQUIRED"]);
const boundedSnapshot = value => Buffer.byteLength(canonicalJson(value || {})) <= MAX_RAW_SNAPSHOT_BYTES;

const supplierCostSchema = new mongoose.Schema({
    amount: { type: Number, min: 0, required: true },
    currency: { type: String, trim: true, uppercase: true, maxlength: 12, required: true },
    observedAt: { type: Date, required: true }
}, { _id: false, strict: "throw" });

const supplierCatalogOfferSchema = new mongoose.Schema({
    supplierCatalogProductId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogProduct", required: true, immutable: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true, immutable: true },
    catalogNamespace: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
    supplierProductCode: { type: String, required: true, trim: true, maxlength: 160 },
    supplierOfferCode: { type: String, required: true, trim: true, maxlength: 180 },
    supplierOfferName: { type: String, trim: true, maxlength: 240, default: "" },
    rawName: { type: String, trim: true, maxlength: 500, default: "" },
    supplierCost: { type: supplierCostSchema, default: undefined },
    rawSemantics: { type: mongoose.Schema.Types.Mixed, default: {} },
    normalizedSemantics: { type: mongoose.Schema.Types.Mixed, default: {} },
    catalogLifecycleState: { type: String, enum: CATALOG_LIFECYCLE_STATES, required: true, default: "ACTIVE" },
    reconciliationState: { type: String, enum: RECONCILIATION_STATES, required: true, default: "UNREVIEWED" },
    reconciliationEvidence: { type: mongoose.Schema.Types.Mixed, default: {} },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    lastObservedAt: { type: Date, required: true },
    lastChangedAt: { type: Date, required: true },
    sourceRevision: { type: String, trim: true, maxlength: 160, default: "" },
    rawSnapshotHash: { type: String, trim: true, lowercase: true, match: /^[a-f0-9]{64}$/, required: true },
    rawSnapshot: { type: mongoose.Schema.Types.Mixed, default: {}, validate: { validator: boundedSnapshot, message: "Supplier catalog raw snapshot exceeds the 64 KiB limit." } },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, strict: "throw", minimize: false });

supplierCatalogOfferSchema.index({ supplierId: 1, catalogNamespace: 1, supplierProductCode: 1, supplierOfferCode: 1 }, { unique: true, name: "one_supplier_catalog_offer_identity" });
supplierCatalogOfferSchema.index({ supplierCatalogProductId: 1, catalogLifecycleState: 1 });
supplierCatalogOfferSchema.index({ supplierId: 1, reconciliationState: 1 });
supplierCatalogOfferSchema.index({ lastObservedAt: 1 });
supplierCatalogOfferSchema.index({ rawSnapshotHash: 1 });

module.exports = mongoose.model("SupplierCatalogOffer", supplierCatalogOfferSchema);
module.exports.CATALOG_LIFECYCLE_STATES = CATALOG_LIFECYCLE_STATES;
module.exports.RECONCILIATION_STATES = RECONCILIATION_STATES;
