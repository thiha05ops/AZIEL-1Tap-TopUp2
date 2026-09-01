"use strict";

const mongoose = require("mongoose");

const RUN_STATUSES = Object.freeze(["RUNNING", "SUCCEEDED_COMPLETE", "SUCCEEDED_PARTIAL", "FAILED"]);
const COVERAGE_STATES = Object.freeze(["UNKNOWN", "PARTIAL", "COMPLETE"]);
const TRIGGERS = Object.freeze(["LEGACY", "SCHEDULED", "ADMIN_MANUAL", "SYSTEM"]);

const supplierCatalogIngestionRunSchema = new mongoose.Schema({
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true, immutable: true },
    catalogNamespace: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
    runKey: { type: String, required: true, trim: true, maxlength: 200, immutable: true },
    status: { type: String, enum: RUN_STATUSES, required: true, default: "RUNNING" },
    coverageState: { type: String, enum: COVERAGE_STATES, required: true, default: "UNKNOWN" },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    sourceRevision: { type: String, trim: true, maxlength: 160, default: "" },
    productsObserved: { type: Number, min: 0, default: 0 },
    offersObserved: { type: Number, min: 0, default: 0 },
    newProducts: { type: Number, min: 0, default: 0 },
    newOffers: { type: Number, min: 0, default: 0 },
    changedOffers: { type: Number, min: 0, default: 0 },
    missingOffers: { type: Number, min: 0, default: 0 },
    availabilityTransitions: { type: Number, min: 0, default: 0 },
    mappingCoverage: { type: mongoose.Schema.Types.Mixed, default: {} },
    categoryResults: { type: [mongoose.Schema.Types.Mixed], default: [] },
    errors: { type: [mongoose.Schema.Types.Mixed], default: [] },
    durationMs: { type: Number, min: 0, default: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
    ,trigger: { type: String, enum: TRIGGERS, default: "LEGACY" }
    ,requestedAt: { type: Date, default: null }
    ,attemptCount: { type: Number, min: 0, default: 0 }
    ,lockOwnerId: { type: String, trim: true, maxlength: 200, default: "" }
    ,errorCategory: { type: String, trim: true, maxlength: 80, default: "" }
    ,requestedBy: { type: mongoose.Schema.Types.Mixed, default: {} }
    ,reason: { type: String, trim: true, maxlength: 500, default: "" }
}, { timestamps: true, strict: "throw", minimize: false, suppressReservedKeysWarning: true });

supplierCatalogIngestionRunSchema.index({ supplierId: 1, catalogNamespace: 1, runKey: 1 }, { unique: true, name: "one_supplier_catalog_ingestion_run_key" });
supplierCatalogIngestionRunSchema.index({ supplierId: 1, startedAt: -1 });
supplierCatalogIngestionRunSchema.index({ status: 1, startedAt: 1 });

module.exports = mongoose.model("SupplierCatalogIngestionRun", supplierCatalogIngestionRunSchema);
module.exports.RUN_STATUSES = RUN_STATUSES;
module.exports.COVERAGE_STATES = COVERAGE_STATES;
module.exports.TRIGGERS = TRIGGERS;
