"use strict";

const mongoose = require("mongoose");

const AVAILABILITY_STATES = Object.freeze(["AVAILABLE", "UNAVAILABLE", "UNKNOWN"]);

const supplierOfferAvailabilitySchema = new mongoose.Schema({
    supplierCatalogOfferId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogOffer", required: true, immutable: true },
    state: { type: String, enum: AVAILABILITY_STATES, required: true, default: "UNKNOWN" },
    evidenceCode: { type: String, trim: true, uppercase: true, maxlength: 120, default: "INSUFFICIENT_EVIDENCE" },
    observedAt: { type: Date, required: true },
    staleAt: { type: Date, default: null },
    lastAvailableAt: { type: Date, default: null },
    lastUnavailableAt: { type: Date, default: null },
    consecutiveMissingCount: { type: Number, min: 0, default: 0, required: true },
    observationRunId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCatalogIngestionRun", default: null },
    coverageComplete: { type: Boolean, required: true, default: false },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, strict: "throw", minimize: false });

supplierOfferAvailabilitySchema.index({ supplierCatalogOfferId: 1 }, { unique: true, name: "one_current_availability_per_supplier_offer" });
supplierOfferAvailabilitySchema.index({ state: 1, staleAt: 1 });
supplierOfferAvailabilitySchema.index({ observedAt: 1 });
supplierOfferAvailabilitySchema.index({ observationRunId: 1 });

module.exports = mongoose.model("SupplierOfferAvailability", supplierOfferAvailabilitySchema);
module.exports.AVAILABILITY_STATES = AVAILABILITY_STATES;
