"use strict";

const LatestCost = require("../../models/SupplierCatalogLatestCost");
const IngestionRun = require("../../models/SupplierCatalogIngestionRun");
const { observedCostHash, effectiveRevision } = require("./supplierCostComparisonService");

const id = value => String(value?._id || value || "");
const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

function validateTerminalRun(run, expected = {}) {
    if (!run) fail("SUPPLIER_LATEST_COST_RUN_MISSING", "The publishing ingestion run does not exist.");
    if (expected.ingestionRunId && id(run._id) !== id(expected.ingestionRunId)) fail("SUPPLIER_LATEST_COST_RUN_IDENTITY_MISMATCH", "The latest cost is not bound to the requested run.");
    if (expected.supplierId && id(run.supplierId) !== id(expected.supplierId)) fail("SUPPLIER_LATEST_COST_RUN_IDENTITY_MISMATCH", "The latest cost supplier does not match its run.");
    if (expected.catalogNamespace && upper(run.catalogNamespace) !== upper(expected.catalogNamespace)) fail("SUPPLIER_LATEST_COST_RUN_IDENTITY_MISMATCH", "The latest cost namespace does not match its run.");
    if (expected.runKey && clean(run.runKey) !== clean(expected.runKey)) fail("SUPPLIER_LATEST_COST_RUN_IDENTITY_MISMATCH", "The latest cost run key does not match.");
    const status = upper(run.status), coverage = upper(run.coverageState);
    if (!((status === "SUCCEEDED_COMPLETE" && coverage === "COMPLETE") || (status === "SUCCEEDED_PARTIAL" && coverage === "PARTIAL"))) fail("SUPPLIER_LATEST_COST_RUN_NOT_ELIGIBLE", "Latest cost publication requires a terminal successful run.");
    if (expected.coverageState && coverage !== upper(expected.coverageState)) fail("SUPPLIER_LATEST_COST_RUN_IDENTITY_MISMATCH", "The latest cost coverage does not match its run.");
    const started = new Date(run.startedAt), completed = new Date(run.completedAt);
    if (!Number.isFinite(started.getTime()) || !Number.isFinite(completed.getTime()) || completed < started) fail("SUPPLIER_LATEST_COST_RUN_TIMELINE_INVALID", "The publishing run timeline is invalid.");
    return true;
}

function latestDocument(offer, run, publishedAt = new Date()) {
    if (!offer?.supplierCost) fail("SUPPLIER_LATEST_COST_MISSING", "A validated supplier cost is required.");
    validateTerminalRun(run, { ingestionRunId: run._id, supplierId: offer.supplierId, catalogNamespace: offer.catalogNamespace });
    const observedAt = new Date(offer.supplierCost.observedAt);
    if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() !== new Date(run.startedAt).getTime()) fail("SUPPLIER_LATEST_COST_RUN_TIMELINE_INVALID", "Offer freshness does not match the publishing run.");
    const amount = Number(offer.supplierCost.amount), currency = upper(offer.supplierCost.currency), snapshotHash = clean(offer.rawSnapshotHash).toLowerCase();
    if (!Number.isFinite(amount) || amount < 0 || !currency || !/^[a-f0-9]{64}$/.test(snapshotHash)) fail("SUPPLIER_LATEST_COST_INVALID", "The latest supplier cost evidence is invalid.");
    return {
        _id: offer._id, schemaVersion: 1, supplierCatalogProductId: offer.supplierCatalogProductId, supplierId: offer.supplierId,
        catalogNamespace: offer.catalogNamespace, supplierProductCode: offer.supplierProductCode, supplierOfferCode: offer.supplierOfferCode,
        amount, currency, validatedObservedAt: observedAt,
        sourceRevision: effectiveRevision(offer), rawSnapshotHash: snapshotHash, observedCostHash: observedCostHash(offer),
        ingestionRunId: run._id, runKey: run.runKey, coverageState: upper(run.coverageState), publishedAt
    };
}

function validateLatestRow(row, run) {
    validateTerminalRun(run, row);
    const amount = Number(row?.amount), currency = upper(row?.currency), observedAt = new Date(row?.validatedObservedAt);
    const snapshotHash = clean(row?.rawSnapshotHash).toLowerCase(), costHash = clean(row?.observedCostHash).toLowerCase();
    if (!Number.isFinite(amount) || amount < 0 || !currency || !Number.isFinite(observedAt.getTime())
        || !/^[a-f0-9]{64}$/.test(snapshotHash) || !/^[a-f0-9]{64}$/.test(costHash)) {
        fail("SUPPLIER_LATEST_COST_INVALID", "The persisted latest supplier cost evidence is invalid.");
    }
    const recalculated = observedCostHash({
        _id: row._id,
        supplierCost: { amount, currency, observedAt },
        sourceRevision: row.sourceRevision,
        rawSnapshotHash: snapshotHash
    });
    if (recalculated !== costHash) fail("SUPPLIER_LATEST_COST_HASH_INVALID", "The persisted latest supplier cost hash does not match its content.");
    return true;
}

function createSupplierLatestCostService(models = {}, options = {}) {
    const Latest = models.Latest || LatestCost, Run = models.Run || IngestionRun, clock = options.clock || (() => new Date());
    async function publishRun(run, offers, { session = null } = {}) {
        validateTerminalRun(run);
        const documents = (offers || []).filter(row => row?.supplierCost).map(offer => latestDocument(offer, run, clock()));
        if (!documents.length) return { attempted: 0, published: 0 };
        let query = Latest.find({ _id: { $in: documents.map(row => row._id) } }).select("_id");
        if (session) query = query.session(session);
        const existing = new Set((await query.lean()).map(row => id(row._id)));
        const inserts = documents.filter(row => !existing.has(id(row._id)));
        if (inserts.length) await Latest.insertMany(inserts, { ordered: false, session });
        const updates = documents.filter(row => existing.has(id(row._id))).map(doc => {
            const { _id, schemaVersion, supplierCatalogProductId, supplierId, catalogNamespace, supplierProductCode, supplierOfferCode, ...mutable } = doc;
            return { updateOne: { filter: { _id, supplierCatalogProductId, supplierId, catalogNamespace, supplierProductCode, supplierOfferCode, $or: [{ validatedObservedAt: { $lt: doc.validatedObservedAt } }, { validatedObservedAt: doc.validatedObservedAt, ingestionRunId: doc.ingestionRunId }] }, update: { $set: mutable }, upsert: false } };
        });
        const result = updates.length ? await Latest.bulkWrite(updates, { ordered: false, session }) : null;
        return { attempted: documents.length, published: inserts.length + Number(result?.modifiedCount || 0) };
    }
    async function forOffers(offerIds, { ingestionRunId = null, session = null } = {}) {
        let latestQuery = Latest.find({ _id: { $in: offerIds } }), runQuery;
        if (session) latestQuery = latestQuery.session(session);
        const rows = await latestQuery.lean();
        runQuery = Run.find({ _id: { $in: [...new Set(rows.map(row => id(row.ingestionRunId)))] } });
        if (session) runQuery = runQuery.session(session);
        const runs = await runQuery.lean();
        const byRun = new Map(runs.map(run => [id(run._id), run]));
        return rows.filter(row => {
            validateLatestRow(row, byRun.get(id(row.ingestionRunId)));
            return !ingestionRunId || id(row.ingestionRunId) === id(ingestionRunId);
        }).map(row => ({
            supplierCatalogOfferId: row._id, supplierCatalogProductId: row.supplierCatalogProductId, supplierId: row.supplierId,
            catalogNamespace: row.catalogNamespace, supplierProductCode: row.supplierProductCode, supplierOfferCode: row.supplierOfferCode,
            amount: row.amount, currency: row.currency, observedAt: row.validatedObservedAt, sourceRevision: row.sourceRevision,
            rawSnapshotHash: row.rawSnapshotHash, observedCostHash: row.observedCostHash, ingestionRunId: row.ingestionRunId,
            evidenceSchemaVersion: 1, evidenceMode: "LATEST_ONLY"
        }));
    }
    return Object.freeze({ publishRun, forOffers });
}

module.exports = Object.freeze({ validateTerminalRun, validateLatestRow, latestDocument, createSupplierLatestCostService });
