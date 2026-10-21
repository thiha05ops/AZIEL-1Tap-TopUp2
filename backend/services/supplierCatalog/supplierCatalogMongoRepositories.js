"use strict";

const mongoose = require("mongoose");
const Product = require("../../models/SupplierCatalogProduct");
const Offer = require("../../models/SupplierCatalogOffer");
const Availability = require("../../models/SupplierOfferAvailability");
const Run = require("../../models/SupplierCatalogIngestionRun");
const Observation = require("../../models/SupplierCatalogCostObservation");
const { readSupplierCostEvidencePolicy } = require("../../config/supplierCostEvidencePolicy");
const { observedCostHash, effectiveRevision } = require("./supplierCostComparisonService");
const { createSupplierCostEvidenceRepositories } = require("./supplierCostEvidenceService");
const { createSupplierLatestCostService } = require("./supplierLatestCostService");

const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const chunks = (rows, size = 500) => { const out = []; for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size)); return out; };
const id = value => String(value?._id || value || "");
const clean = value => String(value == null ? "" : value).trim();
const countResult = result => ({ inserted: Number(result?.upsertedCount || result?.result?.upsertedCount || 0), matched: Number(result?.matchedCount || result?.result?.matchedCount || 0) });
const safeProgress = (callback, event) => { try { callback(event); } catch { /* Telemetry must never affect ingestion correctness. */ } };
const LATEST_COST_TRANSACTION_OPTIONS = Object.freeze({
    readConcern: Object.freeze({ level: "snapshot" }),
    writeConcern: Object.freeze({ w: "majority", wtimeoutMS: 10000 }),
    readPreference: "primary",
    maxCommitTimeMS: 10000
});

function observedEvidenceOffers(planOffers, persistedByIdentity, productIds) {
    const seen = new Set();
    return planOffers.map(input => {
        const identity = `${input.supplierProductCode}/${input.supplierOfferCode}`;
        if (seen.has(identity)) throw Object.assign(new Error(`Duplicate observed offer ${identity}.`), { code: "SUPPLIER_COST_EVIDENCE_DUPLICATE_OFFER" });
        seen.add(identity);
        const persisted = persistedByIdentity.get(identity);
        if (!persisted) throw Object.assign(new Error(`Persisted observed offer ${identity} is missing.`), { code: "SUPPLIER_COST_EVIDENCE_OBSERVED_OFFER_MISSING" });
        const expectedProductId = productIds.get(input.supplierProductCode);
        const sameCost = Number(persisted.supplierCost?.amount) === Number(input.supplierCost?.amount)
            && clean(persisted.supplierCost?.currency).toUpperCase() === clean(input.supplierCost?.currency).toUpperCase()
            && new Date(persisted.supplierCost?.observedAt).getTime() === new Date(input.supplierCost?.observedAt).getTime();
        const sameIdentity = id(persisted.supplierId) === id(input.supplierId)
            && clean(persisted.catalogNamespace).toUpperCase() === clean(input.catalogNamespace).toUpperCase()
            && id(persisted.supplierCatalogProductId) === id(expectedProductId)
            && persisted.supplierProductCode === input.supplierProductCode
            && persisted.supplierOfferCode === input.supplierOfferCode;
        const sameSource = clean(persisted.sourceRevision) === clean(input.sourceRevision)
            && clean(persisted.rawSnapshotHash).toLowerCase() === clean(input.rawSnapshotHash).toLowerCase();
        if (!persisted.supplierCost || !sameIdentity || !sameCost || !sameSource) throw Object.assign(new Error(`Persisted observed offer ${identity} conflicts with current-run evidence.`), { code: "SUPPLIER_COST_EVIDENCE_OBSERVED_OFFER_CONFLICT" });
        return persisted;
    });
}

function legacyObservation(offer, ingestionRunId) {
    const hash = observedCostHash(offer);
    return {
        supplierCatalogOfferId: offer._id, supplierCatalogProductId: offer.supplierCatalogProductId, supplierId: offer.supplierId,
        catalogNamespace: offer.catalogNamespace, supplierProductCode: offer.supplierProductCode, supplierOfferCode: offer.supplierOfferCode,
        amount: offer.supplierCost.amount, currency: offer.supplierCost.currency, observedAt: offer.supplierCost.observedAt,
        sourceRevision: effectiveRevision(offer), rawSnapshotHash: offer.rawSnapshotHash, observedCostHash: hash, ingestionRunId
    };
}

function createSupplierCatalogMongoRepositories(models = {}, options = {}) {
    const P = models.Product || Product, O = models.Offer || Offer, A = models.Availability || Availability;
    const R = models.Run || Run, H = models.Observation || Observation;
    const evidencePolicy = options.evidencePolicy || readSupplierCostEvidencePolicy();
    const evidence = options.evidenceRepositories || createSupplierCostEvidenceRepositories(models.evidenceModels || {});
    const latestCosts = options.latestCostService || createSupplierLatestCostService(models.latestCostModels || {});
    const requireEvidenceContext = context => {
        if (!context?.ingestionRunId || !context?.supplierId || !context?.observedAt) throw Object.assign(new Error("Complete v2 run evidence context is required."), { code: "SUPPLIER_COST_EVIDENCE_CONTEXT_REQUIRED" });
        return context;
    };
    const finalization = plan => { const completedAt = new Date(); return { status: plan.runStatus, coverageState: plan.coverageState, completedAt, productsObserved: plan.products.length, offersObserved: plan.offers.length, newProducts: plan.products.filter(x => x.operation === "CREATE").length, newOffers: plan.offers.filter(x => x.operation === "CREATE").length, changedOffers: plan.offers.filter(x => x.operation === "UPDATE").length, missingOffers: plan.missing.length, availabilityTransitions: plan.offers.length + plan.missing.length, mappingCoverage: plan.mappingCoverage || {}, categoryResults: plan.categoryResults, errors: plan.errors, durationMs: Math.max(0, completedAt.getTime() - new Date(plan.observedAt).getTime()), metadata: { completenessEvidence: plan.completenessEvidence || "" } }; };
    return {
        products: { async upsert(input) { const identity = { supplierId: input.supplierId, catalogNamespace: input.catalogNamespace, supplierProductCode: input.supplierProductCode }, set = omit(input, ["_id", "operation", "firstSeenAt", "supplierId", "catalogNamespace", "supplierProductCode"]); return P.findOneAndUpdate(identity, { $set: set, $setOnInsert: { ...identity, firstSeenAt: input.firstSeenAt } }, { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }); } },
        offers: { async upsert(input) { const identity = { supplierId: input.supplierId, catalogNamespace: input.catalogNamespace, supplierProductCode: input.supplierProductCode, supplierOfferCode: input.supplierOfferCode }, set = omit(input, ["_id", "operation", "availability", "firstSeenAt", "supplierId", "catalogNamespace", "supplierProductCode", "supplierOfferCode"]); return O.findOneAndUpdate(identity, { $set: set, $setOnInsert: { ...identity, firstSeenAt: input.firstSeenAt } }, { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }); } },
        availability: { async upsert(input) { const identity = { supplierCatalogOfferId: input.supplierCatalogOfferId }; return A.findOneAndUpdate(identity, { $set: omit(input, ["_id"]) }, { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }); } },
        observations: {
            async append({ offer, ingestionRunId = null }) {
                if (!offer?.supplierCost || !evidencePolicy.legacyWriteEnabled) return null;
                const doc = legacyObservation(offer, ingestionRunId);
                return H.findOneAndUpdate({ observedCostHash: doc.observedCostHash }, { $setOnInsert: doc }, { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true });
            },
            async appendRun(input) {
                if (!evidencePolicy.v2WriteEnabled) return null;
                return evidence.writeRun(requireEvidenceContext(input));
            }
        },
        bulk: {
            async applyCatalogPlan(plan, { ingestionRunId = null, evidenceContext = null, onProgress = () => {} } = {}) {
                const productOperations = plan.products.map(input => { const identity = { supplierId: input.supplierId, catalogNamespace: input.catalogNamespace, supplierProductCode: input.supplierProductCode }, set = omit(input, ["_id", "operation", "firstSeenAt", "supplierId", "catalogNamespace", "supplierProductCode"]); return { updateOne: { filter: identity, update: { $set: set, $setOnInsert: { ...identity, firstSeenAt: input.firstSeenAt } }, upsert: true } }; });
                for (const batch of chunks(productOperations)) await P.bulkWrite(batch, { ordered: false });
                safeProgress(onProgress, { phase: "APPLY_PRODUCTS", completed: plan.products.length, total: plan.products.length });
                const scope = { supplierId: plan.supplierId, catalogNamespace: plan.catalogNamespace, supplierProductCode: { $in: plan.products.map(row => row.supplierProductCode) } };
                const productRows = await P.find(scope).select("_id supplierProductCode").lean(), productIds = new Map(productRows.map(row => [row.supplierProductCode, row._id]));
                const offerOperations = plan.offers.map(input => { const identity = { supplierId: input.supplierId, catalogNamespace: input.catalogNamespace, supplierProductCode: input.supplierProductCode, supplierOfferCode: input.supplierOfferCode }, set = omit(input, ["_id", "operation", "availability", "firstSeenAt", "supplierId", "catalogNamespace", "supplierProductCode", "supplierOfferCode"]); set.supplierCatalogProductId = productIds.get(input.supplierProductCode); return { updateOne: { filter: identity, update: { $set: set, $setOnInsert: { ...identity, firstSeenAt: input.firstSeenAt } }, upsert: true } }; });
                let appliedOffers = 0;
                for (const batch of chunks(offerOperations)) { await O.bulkWrite(batch, { ordered: false }); appliedOffers += batch.length; safeProgress(onProgress, { phase: "APPLY_OFFERS", completed: appliedOffers, total: offerOperations.length }); }
                const offerRows = await O.find(scope).select("_id supplierId catalogNamespace supplierCatalogProductId supplierProductCode supplierOfferCode supplierCost sourceRevision rawSnapshotHash").lean(), offerIds = new Map(offerRows.map(row => [`${row.supplierProductCode}/${row.supplierOfferCode}`, row]));
                const availabilityOperations = plan.offers.map(input => { const offer = offerIds.get(`${input.supplierProductCode}/${input.supplierOfferCode}`); return { updateOne: { filter: { supplierCatalogOfferId: offer._id }, update: { $set: { ...omit(input.availability, ["_id"]), supplierCatalogOfferId: offer._id, observationRunId: ingestionRunId } }, upsert: true } }; }).concat(plan.missing.map(input => ({ updateOne: { filter: { supplierCatalogOfferId: input._id }, update: { $set: { ...omit(input.availability, ["_id"]), supplierCatalogOfferId: input._id, observationRunId: ingestionRunId } }, upsert: true } })));
                for (const batch of chunks(availabilityOperations)) await A.bulkWrite(batch, { ordered: false });
                safeProgress(onProgress, { phase: "APPLY_AVAILABILITY", completed: availabilityOperations.length, total: availabilityOperations.length });
                const needsCurrentRunRows = evidencePolicy.currentRunLegacyObservationsEnabled || evidencePolicy.v2WriteEnabled || evidencePolicy.latestOnlyEnabled;
                const currentRunRows = needsCurrentRunRows ? observedEvidenceOffers(plan.offers, offerIds, productIds) : null;
                const legacyObservationRows = evidencePolicy.currentRunLegacyObservationsEnabled ? currentRunRows : offerRows;
                const observationOperations = evidencePolicy.legacyWriteEnabled ? legacyObservationRows.filter(offer => offer.supplierCost).map(offer => { const doc = legacyObservation(offer, ingestionRunId); return { updateOne: { filter: { observedCostHash: doc.observedCostHash }, update: { $setOnInsert: doc }, upsert: true } }; }) : [];
                const observationTelemetry = {
                    currentResponseOffers: plan.offers.filter(offer => offer.supplierCost).length,
                    scopedHistoricalOffers: offerRows.filter(offer => offer.supplierCost).length,
                    excludedHistoricalRows: evidencePolicy.currentRunLegacyObservationsEnabled ? Math.max(0, offerRows.filter(offer => offer.supplierCost).length - currentRunRows.filter(offer => offer.supplierCost).length) : 0,
                    attemptedObservationWrites: observationOperations.length,
                    insertedRows: 0,
                    hashMatchedRows: 0,
                    failedWrites: 0
                };
                try {
                    for (const batch of chunks(observationOperations)) {
                        try {
                            const result = await H.bulkWrite(batch, { ordered: false }), counts = countResult(result);
                            observationTelemetry.insertedRows += counts.inserted;
                            observationTelemetry.hashMatchedRows += counts.matched;
                        } catch (error) {
                            const counts = countResult(error?.result);
                            observationTelemetry.insertedRows += counts.inserted;
                            observationTelemetry.hashMatchedRows += counts.matched;
                            observationTelemetry.failedWrites += Math.max(0, batch.length - counts.inserted - counts.matched);
                            throw error;
                        }
                    }
                } finally {
                    safeProgress(onProgress, { phase: "APPLY_OBSERVATION_TELEMETRY", schemaVersion: 1, ...observationTelemetry });
                }
                if (evidencePolicy.v2WriteEnabled) {
                    await evidence.writeRun(requireEvidenceContext({ ...evidenceContext, ingestionRunId, offers: currentRunRows }));
                }
                safeProgress(onProgress, { phase: "APPLY_OBSERVATIONS", completed: observationOperations.length, total: observationOperations.length });
                return { products: productRows.length, offers: offerRows.length, availability: availabilityOperations.length, observations: observationOperations.length, observationTelemetry, evidenceManifest: evidencePolicy.v2WriteEnabled ? 1 : 0, currentRunOffers: currentRunRows || [] };
            }
        },
        runs: {
            async start(input) { if (typeof input.runKey !== "string" || !input.runKey.trim()) throw new TypeError("A deterministic supplier catalog ingestion runKey is required"); const identity = { supplierId: input.supplierId, catalogNamespace: input.catalogNamespace, runKey: input.runKey }; return R.findOneAndUpdate(identity, { $setOnInsert: { ...input, ...identity } }, { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }); },
            async finalize(idValue, plan) { return R.findByIdAndUpdate(idValue, { $set: finalization(plan) }, { returnDocument: "after", runValidators: true }); },
            async finalizeWithLatest(idValue, plan, offers) {
                if (!evidencePolicy.latestOnlyEnabled) return this.finalize(idValue, plan);
                const session = await mongoose.startSession();
                try {
                    let finalized;
                    await session.withTransaction(async () => {
                        finalized = await R.findByIdAndUpdate(idValue, { $set: finalization(plan) }, { returnDocument: "after", runValidators: true, session });
                        await latestCosts.publishRun(finalized, offers, { session });
                    }, LATEST_COST_TRANSACTION_OPTIONS);
                    return finalized;
                } finally { await session.endSession(); }
            }
        }
    };
}

module.exports = Object.freeze({ LATEST_COST_TRANSACTION_OPTIONS, legacyObservation, observedEvidenceOffers, createSupplierCatalogMongoRepositories });
