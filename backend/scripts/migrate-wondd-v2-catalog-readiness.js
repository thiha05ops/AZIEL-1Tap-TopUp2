#!/usr/bin/env node
"use strict";

const path = require("path");
const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const { resolveWonddCatalogIdentity } = require("../services/suppliers/wonddCatalogConfig");

const APPLY = process.argv.includes("--apply");
const clean = value => String(value == null ? "" : value).trim();

function buildPlan({ supplier, mappings = [], products = [], offers = [], availability = [] } = {}) {
    if (!supplier || clean(supplier.supplierCode).toUpperCase() !== "WONDD") throw new Error("A WonDD supplier is required.");
    const productById = new Map(products.map(row => [clean(row._id), row]));
    const offerById = new Map(offers.map(row => [clean(row._id), row]));
    const availabilityByOfferId = new Map(availability.map(row => [clean(row.supplierCatalogOfferId), row]));
    const updates = [], blockers = [];
    for (const mapping of mappings) {
        const offer = offerById.get(clean(mapping.supplierCatalogOfferId));
        const product = offer ? productById.get(clean(offer.supplierCatalogProductId)) : null;
        const identity = resolveWonddCatalogIdentity(mapping.supplierProductCode);
        const reasons = [];
        if (!offer || clean(offer.catalogNamespace).toUpperCase() !== "WONDD_PACKAGE_CATALOG" || clean(offer.catalogLifecycleState).toUpperCase() !== "ACTIVE") reasons.push("ACTIVE_LINKED_OFFER_REQUIRED");
        if (!product || clean(product.supplierProductCode) !== clean(offer?.supplierProductCode)) reasons.push("CATALOG_PRODUCT_IDENTITY_MISMATCH");
        if (clean(offer?.supplierId) !== clean(mapping.supplierId) || clean(mapping.supplierId) !== clean(supplier._id)) reasons.push("SUPPLIER_IDENTITY_MISMATCH");
        if (clean(offer?.supplierOfferCode) !== clean(mapping.supplierPackageCode)) reasons.push("SUPPLIER_PACKAGE_IDENTITY_MISMATCH");
        if (!identity || identity.serviceId !== clean(offer?.supplierProductCode)) reasons.push("WONDD_PRODUCT_IDENTITY_AMBIGUOUS");
        if (reasons.length) {
            blockers.push({ mappingId: clean(mapping._id), reasons });
            continue;
        }
        const currentAvailability = availabilityByOfferId.get(clean(offer._id));
        const observedAt = new Date(offer.lastObservedAt || offer.lastSeenAt || 0);
        if (!Number.isFinite(observedAt.getTime())) {
            blockers.push({ mappingId: clean(mapping._id), reasons: ["OFFER_OBSERVATION_TIME_INVALID"] });
            continue;
        }
        const staleAt = currentAvailability?.staleAt ? new Date(currentAvailability.staleAt) : null;
        const availabilityObservedAt = currentAvailability?.observedAt ? new Date(currentAvailability.observedAt) : null;
        const refreshAvailability = !currentAvailability ||
            ((currentAvailability.state !== "AVAILABLE" || staleAt) &&
                (!availabilityObservedAt || observedAt > availabilityObservedAt) &&
                (!staleAt || observedAt > staleAt));
        const updateMapping = clean(mapping.supplierProductCode) !== clean(offer.supplierProductCode);
        if (!updateMapping && !refreshAvailability) continue;
        updates.push({
            mappingId: clean(mapping._id),
            fromSupplierProductCode: clean(mapping.supplierProductCode),
            supplierProductCode: clean(offer.supplierProductCode),
            supplierCatalogOfferId: clean(offer._id),
            updateMapping,
            availability: refreshAvailability ? {
                state: "AVAILABLE",
                evidenceCode: "WONDD_PACKAGE_LISTED",
                observedAt,
                staleAt: null,
                lastAvailableAt: observedAt,
                consecutiveMissingCount: 0,
                coverageComplete: false,
                metadata: { repairedFromActiveCatalogOffer: true }
            } : null
        });
    }
    return { supplierId: clean(supplier._id), updates, blockers };
}

async function main() {
    require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
    await mongoose.connect(process.env.MONGO_URI);
    const supplier = await Supplier.findOne({ supplierCode: "WONDD" }).lean();
    if (!supplier) throw new Error("WonDD supplier not found.");
    const mappings = await Mapping.find({ supplierCode: "WONDD", archivedAt: null, supplierCatalogOfferId: { $ne: null } }).lean();
    const offers = await Offer.find({ _id: { $in: mappings.map(row => row.supplierCatalogOfferId) } }).lean();
    const products = await Product.find({ _id: { $in: offers.map(row => row.supplierCatalogProductId) } }).lean();
    const availability = await Availability.find({ supplierCatalogOfferId: { $in: offers.map(row => row._id) } }).lean();
    const plan = buildPlan({ supplier, mappings, products, offers, availability });
    if (!APPLY) {
        console.log(JSON.stringify({ mode: "DRY_RUN", writes: 0, ...plan }, null, 2));
        return;
    }
    if (plan.blockers.length) throw new Error(`WonDD V2 readiness migration blocked for ${plan.blockers.length} mapping(s).`);
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            for (const row of plan.updates) {
                if (row.updateMapping) {
                    const mappingResult = await Mapping.updateOne(
                        { _id: row.mappingId, supplierCode: "WONDD", supplierId: plan.supplierId, supplierCatalogOfferId: row.supplierCatalogOfferId, supplierProductCode: row.fromSupplierProductCode },
                        { $set: { supplierProductCode: row.supplierProductCode } },
                        { session }
                    );
                    if (mappingResult.matchedCount !== 1) throw new Error(`WonDD mapping changed during migration: ${row.mappingId}`);
                }
                if (row.availability) await Availability.updateOne(
                    { supplierCatalogOfferId: row.supplierCatalogOfferId },
                    { $set: row.availability },
                    { upsert: true, runValidators: true, session }
                );
            }
        });
    } finally {
        await session.endSession();
    }
    console.log(JSON.stringify({ mode: "APPLY", mappingsProcessed: plan.updates.length, blockers: 0 }, null, 2));
}

if (require.main === module) main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => {}));

module.exports = { buildPlan };
