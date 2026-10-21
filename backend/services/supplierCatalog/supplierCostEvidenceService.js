"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const CostVersion = require("../../models/SupplierCatalogCostVersion");
const RunManifest = require("../../models/SupplierCatalogRunEvidenceManifest");
const IngestionRun = require("../../models/SupplierCatalogIngestionRun");
const { canonicalJson } = require("./supplierCatalogNormalization");
const { effectiveRevision, observedCostHash } = require("./supplierCostComparisonService");

const SCHEMA_VERSION = 1;
const MAX_MANIFEST_BSON_BYTES = 12 * 1024 * 1024;
const clean = value => String(value == null ? "" : value).trim();
const id = value => String(value?._id || value || "");
const sha = value => crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");

function costVersionIdentity(offer = {}) {
    const cost = offer.supplierCost || {};
    return {
        schemaVersion: SCHEMA_VERSION,
        supplierCatalogOfferId: id(offer),
        amount: Number(cost.amount),
        currency: clean(cost.currency).toUpperCase(),
        sourceRevision: effectiveRevision(offer),
        rawSnapshotHash: clean(offer.rawSnapshotHash).toLowerCase()
    };
}

function costVersionHash(offer) { return sha(costVersionIdentity(offer)); }

function buildCostVersion(offer) {
    if (!offer?.supplierCost) return null;
    return {
        _id: costVersionHash(offer),
        schemaVersion: SCHEMA_VERSION,
        supplierCatalogOfferId: offer._id,
        supplierCatalogProductId: offer.supplierCatalogProductId,
        supplierId: offer.supplierId,
        catalogNamespace: offer.catalogNamespace,
        supplierProductCode: offer.supplierProductCode,
        supplierOfferCode: offer.supplierOfferCode,
        amount: Number(offer.supplierCost.amount),
        currency: clean(offer.supplierCost.currency).toUpperCase(),
        sourceRevision: effectiveRevision(offer),
        rawSnapshotHash: clean(offer.rawSnapshotHash).toLowerCase(),
        firstObservedAt: new Date(offer.supplierCost.observedAt)
    };
}

function validateCostVersion(version) {
    const recalculated = costVersionHash({
        _id: version.supplierCatalogOfferId,
        supplierCost: { amount: version.amount, currency: version.currency },
        sourceRevision: version.sourceRevision,
        rawSnapshotHash: version.rawSnapshotHash
    });
    if (recalculated !== id(version._id)) throw Object.assign(new Error("Cost version hash does not match its immutable content."), { code: "SUPPLIER_COST_EVIDENCE_VERSION_HASH_INVALID" });
    return true;
}

function manifestIdentity(input) {
    const entries = input.entries.map(row => ({ o: id(row.o), v: clean(row.v).toLowerCase() }))
        .sort((left, right) => left.o.localeCompare(right.o));
    return {
        schemaVersion: SCHEMA_VERSION,
        ingestionRunId: id(input.ingestionRunId),
        supplierId: id(input.supplierId),
        catalogNamespace: clean(input.catalogNamespace).toUpperCase(),
        runKey: clean(input.runKey),
        observedAt: new Date(input.observedAt).toISOString(),
        coverageState: clean(input.coverageState).toUpperCase(),
        entries
    };
}

function buildRunManifest({ ingestionRunId, supplierId, catalogNamespace, runKey, observedAt, coverageState, offers }) {
    const costOffers = offers.filter(offer => offer?.supplierCost);
    const entries = costOffers.map(offer => ({ o: offer._id, v: costVersionHash(offer) }))
        .sort((left, right) => id(left.o).localeCompare(id(right.o)));
    const uniqueOffers = new Set(entries.map(row => id(row.o)));
    if (uniqueOffers.size !== entries.length) throw Object.assign(new Error("Run evidence contains a duplicate offer."), { code: "SUPPLIER_COST_EVIDENCE_DUPLICATE_OFFER" });
    const identity = manifestIdentity({ ingestionRunId, supplierId, catalogNamespace, runKey, observedAt, coverageState, entries });
    const manifest = { _id: ingestionRunId, schemaVersion: SCHEMA_VERSION, supplierId, catalogNamespace: identity.catalogNamespace, runKey: identity.runKey, observedAt: new Date(identity.observedAt), coverageState: identity.coverageState, rowCount: entries.length, manifestHash: sha(identity), entries };
    const bytes = mongoose.mongo.BSON.calculateObjectSize(manifest);
    if (bytes > MAX_MANIFEST_BSON_BYTES) throw Object.assign(new Error(`Run evidence manifest exceeds ${MAX_MANIFEST_BSON_BYTES} bytes.`), { code: "SUPPLIER_COST_EVIDENCE_MANIFEST_TOO_LARGE", bytes });
    return manifest;
}

function validateRunManifest(manifest) {
    if (Number(manifest.rowCount) !== manifest.entries.length) throw Object.assign(new Error("Run evidence row count is invalid."), { code: "SUPPLIER_COST_EVIDENCE_MANIFEST_COUNT_INVALID" });
    const duplicateCount = new Set(manifest.entries.map(entry => id(entry.o))).size;
    if (duplicateCount !== manifest.entries.length) throw Object.assign(new Error("Run evidence contains a duplicate offer."), { code: "SUPPLIER_COST_EVIDENCE_DUPLICATE_OFFER" });
    const identity = manifestIdentity({ ingestionRunId: manifest._id, supplierId: manifest.supplierId, catalogNamespace: manifest.catalogNamespace, runKey: manifest.runKey, observedAt: manifest.observedAt, coverageState: manifest.coverageState, entries: manifest.entries });
    if (sha(identity) !== manifest.manifestHash) throw Object.assign(new Error("Run evidence manifest hash is invalid."), { code: "SUPPLIER_COST_EVIDENCE_MANIFEST_HASH_INVALID" });
    return true;
}

function validateTerminalIngestionRun(run, manifest) {
    const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
    if (!run) fail("SUPPLIER_COST_EVIDENCE_RUN_MISSING", "The ingestion run for this evidence does not exist.");
    if (id(run._id) !== id(manifest._id)) fail("SUPPLIER_COST_EVIDENCE_RUN_IDENTITY_MISMATCH", "Evidence is not bound to the requested ingestion run.");
    if (id(run.supplierId) !== id(manifest.supplierId)
        || clean(run.catalogNamespace).toUpperCase() !== clean(manifest.catalogNamespace).toUpperCase()
        || clean(run.runKey) !== clean(manifest.runKey)) {
        fail("SUPPLIER_COST_EVIDENCE_RUN_IDENTITY_MISMATCH", "Evidence identity does not match its ingestion run.");
    }
    const status = clean(run.status).toUpperCase(), coverage = clean(run.coverageState).toUpperCase();
    const eligible = (status === "SUCCEEDED_COMPLETE" && coverage === "COMPLETE")
        || (status === "SUCCEEDED_PARTIAL" && coverage === "PARTIAL");
    if (!eligible || coverage !== clean(manifest.coverageState).toUpperCase()) {
        fail("SUPPLIER_COST_EVIDENCE_RUN_NOT_ELIGIBLE", "Evidence requires a matching terminal successful ingestion run.");
    }
    const completedAt = new Date(run.completedAt), startedAt = new Date(run.startedAt), observedAt = new Date(manifest.observedAt);
    if (!Number.isFinite(completedAt.getTime()) || !Number.isFinite(startedAt.getTime())
        || startedAt.getTime() !== observedAt.getTime() || completedAt.getTime() < startedAt.getTime()) {
        fail("SUPPLIER_COST_EVIDENCE_RUN_TIMELINE_INVALID", "Evidence does not match a valid completed ingestion-run timeline.");
    }
    const offersObserved = Number(run.offersObserved);
    if (!Number.isInteger(offersObserved) || offersObserved < Number(manifest.rowCount)) {
        fail("SUPPLIER_COST_EVIDENCE_RUN_COUNT_INVALID", "Evidence contains more offers than the ingestion run observed.");
    }
    return true;
}

function validateTerminalLegacyFallbackRun(run) {
    if (!run) throw Object.assign(new Error("The ingestion run for this evidence does not exist."), { code: "SUPPLIER_COST_EVIDENCE_RUN_MISSING" });
    const status = clean(run.status).toUpperCase(), coverage = clean(run.coverageState).toUpperCase();
    if (!((status === "SUCCEEDED_COMPLETE" && coverage === "COMPLETE") || (status === "SUCCEEDED_PARTIAL" && coverage === "PARTIAL"))) {
        throw Object.assign(new Error("Legacy fallback requires a terminal successful ingestion run."), { code: "SUPPLIER_COST_EVIDENCE_RUN_NOT_ELIGIBLE" });
    }
    const startedAt = new Date(run.startedAt), completedAt = new Date(run.completedAt);
    if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(completedAt.getTime()) || completedAt.getTime() < startedAt.getTime()) {
        throw Object.assign(new Error("Legacy fallback requires a valid completed ingestion-run timeline."), { code: "SUPPLIER_COST_EVIDENCE_RUN_TIMELINE_INVALID" });
    }
    return true;
}

function materializeObservation(version, manifest, { manifestValidated = false } = {}) {
    validateCostVersion(version);
    if (!manifestValidated) validateRunManifest(manifest);
    const offer = {
        _id: version.supplierCatalogOfferId,
        supplierCost: { amount: version.amount, currency: version.currency, observedAt: manifest.observedAt },
        sourceRevision: version.sourceRevision,
        rawSnapshotHash: version.rawSnapshotHash
    };
    return {
        supplierCatalogOfferId: version.supplierCatalogOfferId,
        supplierCatalogProductId: version.supplierCatalogProductId,
        supplierId: version.supplierId,
        catalogNamespace: version.catalogNamespace,
        supplierProductCode: version.supplierProductCode,
        supplierOfferCode: version.supplierOfferCode,
        amount: Number(version.amount),
        currency: clean(version.currency).toUpperCase(),
        observedAt: new Date(manifest.observedAt),
        sourceRevision: version.sourceRevision,
        rawSnapshotHash: version.rawSnapshotHash,
        observedCostHash: observedCostHash(offer),
        ingestionRunId: manifest._id,
        evidenceSchemaVersion: SCHEMA_VERSION,
        costVersionHash: version._id,
        runManifestHash: manifest.manifestHash
    };
}

function createSupplierCostEvidenceRepositories(models = {}) {
    const Version = models.Version || CostVersion, Manifest = models.Manifest || RunManifest, Run = models.Run || IngestionRun;
    async function versionsByHashes(hashes) {
        if (!hashes.length) return [];
        return Version.find({ _id: { $in: hashes } }).lean();
    }
    async function materialize(manifests, offerFilter = null) {
        manifests.forEach(validateRunManifest);
        if (manifests.length) {
            const runs = await Run.find({ _id: { $in: manifests.map(manifest => manifest._id) } }).lean();
            const runsById = new Map(runs.map(run => [id(run._id), run]));
            manifests.forEach(manifest => validateTerminalIngestionRun(runsById.get(id(manifest._id)), manifest));
        }
        const rows = manifests.flatMap(manifest => manifest.entries
            .filter(entry => !offerFilter || offerFilter.has(id(entry.o)))
            .map(entry => ({ manifest, entry })));
        const versions = await versionsByHashes([...new Set(rows.map(row => row.entry.v))]);
        const byHash = new Map(versions.map(version => [id(version._id), version]));
        return rows.map(({ manifest, entry }) => {
            const version = byHash.get(id(entry.v));
            if (!version || id(version.supplierCatalogOfferId) !== id(entry.o)) throw Object.assign(new Error("Run evidence version reference is missing or mismatched."), { code: "SUPPLIER_COST_EVIDENCE_REFERENCE_INVALID" });
            return materializeObservation(version, manifest, { manifestValidated: true });
        }).sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt));
    }
    return Object.freeze({
        async writeRun(input) {
            const offers = input.offers.filter(offer => offer?.supplierCost);
            const versions = offers.map(buildCostVersion);
            if (versions.length) await Version.bulkWrite(versions.map(version => ({ updateOne: { filter: { _id: version._id }, update: { $setOnInsert: version }, upsert: true } })), { ordered: false });
            const manifest = buildRunManifest({ ...input, offers });
            const persisted = await Manifest.findOneAndUpdate({ _id: manifest._id }, { $setOnInsert: manifest }, { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }).lean();
            if (!persisted || persisted.manifestHash !== manifest.manifestHash || Number(persisted.rowCount) !== manifest.rowCount) throw Object.assign(new Error("Run evidence replay conflicts with the persisted manifest."), { code: "SUPPLIER_COST_EVIDENCE_MANIFEST_CONFLICT" });
            validateRunManifest(persisted);
            return { versions: versions.length, manifest: persisted };
        },
        async observationsForRun(offerIds, ingestionRunId) {
            const manifest = await Manifest.findById(ingestionRunId).lean();
            if (!manifest) {
                const run = await Run.findById(ingestionRunId).lean();
                validateTerminalLegacyFallbackRun(run);
                return null;
            }
            return materialize([manifest], new Set(offerIds.map(id)));
        },
        async recentForOffer(offerId, limit = 20) {
            const manifests = await Manifest.find({ "entries.o": offerId }).sort({ observedAt: -1 }).limit(limit).lean();
            return materialize(manifests, new Set([id(offerId)]));
        }
    });
}

module.exports = Object.freeze({ SCHEMA_VERSION, MAX_MANIFEST_BSON_BYTES, costVersionIdentity, costVersionHash, buildCostVersion, validateCostVersion, manifestIdentity, buildRunManifest, validateRunManifest, validateTerminalIngestionRun, validateTerminalLegacyFallbackRun, materializeObservation, createSupplierCostEvidenceRepositories });
