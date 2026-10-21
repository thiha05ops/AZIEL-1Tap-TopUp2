#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const SupplierCatalogCostVersion = require("../models/SupplierCatalogCostVersion");
const SupplierCatalogRunEvidenceManifest = require("../models/SupplierCatalogRunEvidenceManifest");
const { readSupplierCostEvidencePolicy } = require("../config/supplierCostEvidencePolicy");
const { observedCostHash } = require("../services/supplierCatalog/supplierCostComparisonService");
const { sourceLock, validateLock } = require("../services/supplierCatalog/supplierCostAuthorityService");
const fazerProvider = require("../services/supplierCatalog/providers/fazerCardsCatalogIngestionService");
const wonddProvider = require("../services/supplierCatalog/providers/wonddCatalogIngestionService");
const { legacyObservation, observedEvidenceOffers, createSupplierCatalogMongoRepositories } = require("../services/supplierCatalog/supplierCatalogMongoRepositories");
const { createRepositories: createWeeklyRepositories, createWeeklySupplierCostSyncService, immutableCandidate, manifestHash } = require("../services/supplierCatalog/weeklySupplierCostSyncService");
const { costVersionHash, buildCostVersion, buildRunManifest, validateTerminalIngestionRun, materializeObservation, createSupplierCostEvidenceRepositories } = require("../services/supplierCatalog/supplierCostEvidenceService");

let checks = 0;
const ok = (value, message) => { assert(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const oid = value => value ? new mongoose.Types.ObjectId(value) : new mongoose.Types.ObjectId();
const now = new Date("2026-10-17T00:00:00.000Z");
const later = new Date("2026-10-17T06:00:00.000Z");

function offer(overrides = {}) {
    return {
        _id: oid("111111111111111111111111"), supplierCatalogProductId: oid("222222222222222222222222"), supplierId: oid("333333333333333333333333"),
        catalogNamespace: "FAZERCARDS_RESELLER_CATALOG", supplierProductCode: "mobile_legends_global", supplierOfferCode: "10_diamonds",
        catalogLifecycleState: "ACTIVE", sourceRevision: "supplier-revision-1", rawSnapshotHash: "a".repeat(64),
        supplierCost: { amount: 1.1, currency: "USD", observedAt: now }, ...overrides
    };
}

function terminalRun(manifest, overrides = {}) {
    const coverageState = overrides.coverageState || manifest.coverageState;
    return {
        _id: manifest._id, supplierId: manifest.supplierId, catalogNamespace: manifest.catalogNamespace, runKey: manifest.runKey,
        status: coverageState === "COMPLETE" ? "SUCCEEDED_COMPLETE" : "SUCCEEDED_PARTIAL", coverageState,
        startedAt: manifest.observedAt, completedAt: new Date(new Date(manifest.observedAt).getTime() + 1000), offersObserved: manifest.rowCount,
        ...overrides
    };
}

function memoryEvidenceModels() {
    const versions = new Map(), manifests = new Map(), runs = new Map();
    const Version = {
        bulkWrite: async operations => { for (const operation of operations) { const row = operation.updateOne.update.$setOnInsert; if (!versions.has(String(row._id))) versions.set(String(row._id), row); } },
        find: query => ({ lean: async () => (query._id.$in || []).map(hash => versions.get(String(hash))).filter(Boolean) })
    };
    const Manifest = {
        findOneAndUpdate: (query, update) => ({ lean: async () => { const key = String(query._id); if (!manifests.has(key)) manifests.set(key, update.$setOnInsert); return manifests.get(key); } }),
        findById: runId => ({ lean: async () => manifests.get(String(runId)) || null }),
        find: query => ({ sort: () => ({ limit: limit => ({ lean: async () => [...manifests.values()].filter(manifest => manifest.entries.some(row => String(row.o) === String(query["entries.o"]))).sort((a, b) => new Date(b.observedAt) - new Date(a.observedAt)).slice(0, limit) }) }) })
    };
    const Run = {
        findById: runId => ({ lean: async () => runs.get(String(runId)) || null }),
        find: query => ({ lean: async () => (query._id.$in || []).map(runId => runs.get(String(runId))).filter(Boolean) })
    };
    return { Version, Manifest, Run, versions, manifests, runs };
}

async function main() {
    const defaults = readSupplierCostEvidencePolicy({});
    equal(defaults.v2WriteEnabled, false, "v2 writes default off");
    equal(defaults.v2ReadEnabled, false, "v2 reads default off");
    equal(defaults.currentRunLegacyObservationsEnabled, false, "current-run-only legacy observations default off");
    equal(readSupplierCostEvidencePolicy({ SUPPLIER_COST_OBSERVATION_CURRENT_RUN_ONLY_ENABLED: "true" }).currentRunLegacyObservationsEnabled, true, "current-run-only legacy observations require exact opt-in");
    equal(readSupplierCostEvidencePolicy({ SUPPLIER_COST_OBSERVATION_CURRENT_RUN_ONLY_ENABLED: "TRUE" }).currentRunLegacyObservationsEnabled, false, "current-run-only legacy observations reject non-exact values");
    equal(defaults.legacyWriteEnabled, true, "legacy writes remain on by default");
    equal(readSupplierCostEvidencePolicy({ SUPPLIER_COST_EVIDENCE_LEGACY_WRITE_ENABLED: "false" }).legacyWriteEnabled, true, "legacy cannot be disabled without v2 writer");
    equal(readSupplierCostEvidencePolicy({ SUPPLIER_COST_EVIDENCE_V2_WRITE_ENABLED: "true", SUPPLIER_COST_EVIDENCE_LEGACY_WRITE_ENABLED: "false" }).legacyWriteEnabled, false, "controlled v2-only writes require explicit v2 enablement");

    const first = offer(), second = offer({ supplierCost: { ...offer().supplierCost, observedAt: later } });
    equal(costVersionHash(first), costVersionHash(second), "poll time is excluded from immutable cost version identity");
    const priceChanged = offer({ supplierCost: { amount: 1.2, currency: "USD", observedAt: later } });
    ok(costVersionHash(first) !== costVersionHash(priceChanged), "genuine price change creates a version");
    ok(costVersionHash(first) !== costVersionHash(offer({ sourceRevision: "supplier-revision-2" })), "source revision change creates a version");
    ok(costVersionHash(first) !== costVersionHash(offer({ rawSnapshotHash: "b".repeat(64) })), "snapshot change creates a version");

    const run1 = oid("aaaaaaaaaaaaaaaaaaaaaaaa"), run2 = oid("bbbbbbbbbbbbbbbbbbbbbbbb");
    const manifest1 = buildRunManifest({ ingestionRunId: run1, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "run-1", observedAt: now, coverageState: "COMPLETE", offers: [first] });
    const manifest2 = buildRunManifest({ ingestionRunId: run2, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "run-2", observedAt: later, coverageState: "COMPLETE", offers: [second] });
    ok(manifest1.manifestHash !== manifest2.manifestHash, "each run has distinct immutable evidence");
    equal(manifest1.entries[0].v, manifest2.entries[0].v, "unchanged runs reference one shared cost version");
    const materialized = materializeObservation(buildCostVersion(first), manifest2);
    equal(new Date(materialized.observedAt).toISOString(), later.toISOString(), "materialized evidence retains run freshness");
    equal(String(materialized.ingestionRunId), String(run2), "materialized evidence retains exact run identity");
    equal(materialized.observedCostHash, observedCostHash(second), "legacy approval/hash contract is reproduced exactly");
    await new SupplierCatalogCostVersion(buildCostVersion(first)).validate(); checks += 1;
    await new SupplierCatalogRunEvidenceManifest(manifest1).validate(); checks += 1;
    assert.throws(() => materializeObservation({ ...buildCostVersion(first), amount: 99 }, manifest1), error => error.code === "SUPPLIER_COST_EVIDENCE_VERSION_HASH_INVALID"); checks += 1;
    assert.throws(() => materializeObservation(buildCostVersion(first), { ...manifest1, manifestHash: "0".repeat(64) }), error => error.code === "SUPPLIER_COST_EVIDENCE_MANIFEST_HASH_INVALID"); checks += 1;

    const memory = memoryEvidenceModels(), evidence = createSupplierCostEvidenceRepositories(memory);
    await evidence.writeRun({ ingestionRunId: run1, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "run-1", observedAt: now, coverageState: "COMPLETE", offers: [first] });
    await evidence.writeRun({ ingestionRunId: run2, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "run-2", observedAt: later, coverageState: "COMPLETE", offers: [second] });
    memory.runs.set(String(run1), terminalRun(manifest1));
    memory.runs.set(String(run2), terminalRun(manifest2));
    equal(memory.versions.size, 1, "two unchanged runs persist one version");
    equal(memory.manifests.size, 2, "two unchanged runs persist two freshness manifests");
    const run2Rows = await evidence.observationsForRun([first._id], run2);
    equal(run2Rows.length, 1, "exact run evidence resolves");
    const legacyOnlyRunId = oid(), legacyOnlyManifest = buildRunManifest({ ingestionRunId: legacyOnlyRunId, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "legacy-only", observedAt: later, coverageState: "COMPLETE", offers: [second] });
    memory.runs.set(String(legacyOnlyRunId), terminalRun(legacyOnlyManifest));
    equal(await evidence.observationsForRun([first._id], legacyOnlyRunId), null, "eligible terminal run without v2 manifest signals legacy fallback");
    await assert.rejects(() => evidence.observationsForRun([first._id], oid()), error => error.code === "SUPPLIER_COST_EVIDENCE_RUN_MISSING"); checks += 1;
    await evidence.writeRun({ ingestionRunId: oid("cccccccccccccccccccccccc"), supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "run-3", observedAt: later, coverageState: "COMPLETE", offers: [priceChanged] });
    equal(memory.versions.size, 2, "genuine price change persists a second version");

    const retryMemory = memoryEvidenceModels(), originalManifestWrite = retryMemory.Manifest.findOneAndUpdate; let interruptManifest = true;
    retryMemory.Manifest.findOneAndUpdate = (query, update) => ({ lean: async () => { if (interruptManifest) { interruptManifest = false; throw new Error("simulated manifest interruption"); } return originalManifestWrite(query, update).lean(); } });
    const retryEvidence = createSupplierCostEvidenceRepositories(retryMemory);
    await assert.rejects(() => retryEvidence.writeRun({ ingestionRunId: run1, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "retry-run", observedAt: now, coverageState: "COMPLETE", offers: [first] }), /simulated manifest interruption/); checks += 1;
    equal(retryMemory.versions.size, 1, "interrupted manifest persistence leaves only an immutable orphan version");
    equal(retryMemory.manifests.size, 0, "interrupted manifest persistence publishes no readable run evidence");
    await retryEvidence.writeRun({ ingestionRunId: run1, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "retry-run", observedAt: now, coverageState: "COMPLETE", offers: [first] });
    equal(retryMemory.manifests.size, 1, "retry completes the interrupted run evidence idempotently");

    const concurrentMemory = memoryEvidenceModels(), concurrentEvidence = createSupplierCostEvidenceRepositories(concurrentMemory);
    const concurrentInput = { ingestionRunId: run2, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "concurrent-run", observedAt: later, coverageState: "COMPLETE", offers: [second] };
    await Promise.all([concurrentEvidence.writeRun(concurrentInput), concurrentEvidence.writeRun(concurrentInput)]);
    equal(concurrentMemory.versions.size, 1, "concurrent identical writers converge on one immutable version");
    equal(concurrentMemory.manifests.size, 1, "concurrent identical writers converge on one run manifest");
    await assert.rejects(() => concurrentEvidence.writeRun({ ...concurrentInput, runKey: "conflicting-replay" }), error => error.code === "SUPPLIER_COST_EVIDENCE_MANIFEST_CONFLICT"); checks += 1;

    const corruptMemory = memoryEvidenceModels(), corruptEvidence = createSupplierCostEvidenceRepositories(corruptMemory);
    await corruptEvidence.writeRun({ ingestionRunId: run1, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "corrupt-run", observedAt: now, coverageState: "COMPLETE", offers: [first] });
    corruptMemory.runs.set(String(run1), terminalRun(corruptMemory.manifests.get(String(run1))));
    corruptMemory.manifests.get(String(run1)).manifestHash = "0".repeat(64);
    await assert.rejects(() => corruptEvidence.observationsForRun([first._id], run1), error => error.code === "SUPPLIER_COST_EVIDENCE_MANIFEST_HASH_INVALID"); checks += 1;

    const lifecycleMemory = memoryEvidenceModels(), lifecycleEvidence = createSupplierCostEvidenceRepositories(lifecycleMemory);
    await lifecycleEvidence.writeRun({ ingestionRunId: run1, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "lifecycle", observedAt: now, coverageState: "COMPLETE", offers: [first] });
    const lifecycleManifest = lifecycleMemory.manifests.get(String(run1));
    for (const state of [null, "RUNNING", "FAILED"]) {
        if (state === null) lifecycleMemory.runs.delete(String(run1));
        else lifecycleMemory.runs.set(String(run1), terminalRun(lifecycleManifest, { status: state, coverageState: state === "FAILED" ? "UNKNOWN" : "UNKNOWN", completedAt: state === "FAILED" ? later : null }));
        await assert.rejects(() => lifecycleEvidence.observationsForRun([first._id], run1), error => error.code === (state === null ? "SUPPLIER_COST_EVIDENCE_RUN_MISSING" : "SUPPLIER_COST_EVIDENCE_RUN_NOT_ELIGIBLE")); checks += 1;
    }
    lifecycleMemory.runs.set(String(run1), terminalRun(lifecycleManifest));
    equal((await lifecycleEvidence.observationsForRun([first._id], run1)).length, 1, "evidence becomes readable only after complete terminal success");
    const partialRunId = oid(), partialInput = { ingestionRunId: partialRunId, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "partial-terminal", observedAt: later, coverageState: "PARTIAL", offers: [second] };
    await lifecycleEvidence.writeRun(partialInput);
    const persistedPartial = lifecycleMemory.manifests.get(String(partialRunId));
    lifecycleMemory.runs.set(String(partialRunId), terminalRun(persistedPartial));
    equal((await lifecycleEvidence.observationsForRun([first._id], partialRunId)).length, 1, "partial terminal success exposes only its individually manifested observation");
    assert.throws(() => validateTerminalIngestionRun(terminalRun(lifecycleManifest, { supplierId: oid() }), lifecycleManifest), error => error.code === "SUPPLIER_COST_EVIDENCE_RUN_IDENTITY_MISMATCH"); checks += 1;
    assert.throws(() => validateTerminalIngestionRun(terminalRun(lifecycleManifest, { runKey: "wrong-run-key" }), lifecycleManifest), error => error.code === "SUPPLIER_COST_EVIDENCE_RUN_IDENTITY_MISMATCH"); checks += 1;
    assert.throws(() => validateTerminalIngestionRun(terminalRun(lifecycleManifest, { catalogNamespace: "WRONG_NAMESPACE" }), lifecycleManifest), error => error.code === "SUPPLIER_COST_EVIDENCE_RUN_IDENTITY_MISMATCH"); checks += 1;
    assert.throws(() => validateTerminalIngestionRun(terminalRun(lifecycleManifest, { status: "SUCCEEDED_PARTIAL", coverageState: "PARTIAL" }), lifecycleManifest), error => error.code === "SUPPLIER_COST_EVIDENCE_RUN_NOT_ELIGIBLE"); checks += 1;
    assert.throws(() => validateTerminalIngestionRun(terminalRun(lifecycleManifest, { startedAt: later }), lifecycleManifest), error => error.code === "SUPPLIER_COST_EVIDENCE_RUN_TIMELINE_INVALID"); checks += 1;
    assert.throws(() => validateTerminalIngestionRun(terminalRun(lifecycleManifest, { offersObserved: 0 }), lifecycleManifest), error => error.code === "SUPPLIER_COST_EVIDENCE_RUN_COUNT_INVALID"); checks += 1;
    const concurrentRead = lifecycleEvidence.observationsForRun([first._id], run1);
    lifecycleMemory.runs.set(String(run1), terminalRun(lifecycleManifest, { status: "RUNNING", coverageState: "UNKNOWN", completedAt: null }));
    await assert.rejects(concurrentRead, error => error.code === "SUPPLIER_COST_EVIDENCE_RUN_NOT_ELIGIBLE"); checks += 1;
    lifecycleMemory.runs.set(String(run1), terminalRun(lifecycleManifest));

    let legacyWrites = 0, v2Writes = 0;
    const Observation = { findOneAndUpdate: async () => { legacyWrites += 1; return {}; } };
    const offRepositories = createSupplierCatalogMongoRepositories({ Observation }, { evidencePolicy: defaults, evidenceRepositories: { writeRun: async () => { v2Writes += 1; } } });
    await offRepositories.observations.append({ offer: first, ingestionRunId: run1 });
    await offRepositories.observations.appendRun({ ingestionRunId: run1, supplierId: first.supplierId, observedAt: now, offers: [first] });
    equal(legacyWrites, 1, "default-off path performs the unchanged legacy write");
    equal(v2Writes, 0, "default-off path performs no v2 write");
    const dualRepositories = createSupplierCatalogMongoRepositories({ Observation }, { evidencePolicy: { v2WriteEnabled: true, v2ReadEnabled: false, legacyWriteEnabled: true }, evidenceRepositories: { writeRun: async () => { v2Writes += 1; return {}; } } });
    await dualRepositories.observations.append({ offer: first, ingestionRunId: run1 });
    await dualRepositories.observations.appendRun({ ingestionRunId: run1, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "run-1", observedAt: now, coverageState: "COMPLETE", offers: [first] });
    equal(legacyWrites, 2, "shadow mode preserves legacy writes");
    equal(v2Writes, 1, "shadow mode adds v2 evidence");

    const missingHistorical = offer({ _id: oid("555555555555555555555555"), supplierOfferCode: "historical-missing", supplierCost: { amount: 9.9, currency: "USD", observedAt: new Date("2026-01-01T00:00:00.000Z") } });
    const observedRows = new Map([[`${first.supplierProductCode}/${first.supplierOfferCode}`, first], [`${missingHistorical.supplierProductCode}/${missingHistorical.supplierOfferCode}`, missingHistorical]]);
    const currentOnly = observedEvidenceOffers([first], observedRows, new Map([[first.supplierProductCode, first.supplierCatalogProductId]]));
    equal(currentOnly.length, 1, "v2 bulk evidence contains only current-run observations");
    equal(String(currentOnly[0]._id), String(first._id), "historical missing offer is excluded from fresh evidence");
    const partialManifest = buildRunManifest({ ingestionRunId: oid("dddddddddddddddddddddddd"), supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "partial-current-only", observedAt: now, coverageState: "PARTIAL", offers: currentOnly });
    equal(partialManifest.coverageState, "PARTIAL", "partial supplier response preserves partial coverage in v2 evidence");
    equal(partialManifest.rowCount, 1, "partial supplier response cannot manufacture evidence for a missing historical offer");
    assert.throws(() => observedEvidenceOffers([{ ...first, supplierCost: { ...first.supplierCost, amount: 2 } }], observedRows, new Map([[first.supplierProductCode, first.supplierCatalogProductId]])), error => error.code === "SUPPLIER_COST_EVIDENCE_OBSERVED_OFFER_CONFLICT"); checks += 1;
    assert.throws(() => observedEvidenceOffers([{ ...first, supplierOfferCode: "not-persisted" }], observedRows, new Map([[first.supplierProductCode, first.supplierCatalogProductId]])), error => error.code === "SUPPLIER_COST_EVIDENCE_OBSERVED_OFFER_MISSING"); checks += 1;

    let bulkEvidenceInput = null, legacyBulkCount = 0;
    const query = rows => ({ select: () => ({ lean: async () => rows }) });
    const bulkRepositories = createSupplierCatalogMongoRepositories({
        Product: { bulkWrite: async () => null, find: () => query([{ _id: first.supplierCatalogProductId, supplierProductCode: first.supplierProductCode }]) },
        Offer: { bulkWrite: async () => null, find: () => query([first, missingHistorical]) },
        Availability: { bulkWrite: async () => null },
        Observation: { bulkWrite: async operations => { legacyBulkCount += operations.length; } }
    }, { evidencePolicy: { v2WriteEnabled: true, v2ReadEnabled: false, legacyWriteEnabled: true }, evidenceRepositories: { writeRun: async input => { bulkEvidenceInput = input; return {}; } } });
    await bulkRepositories.bulk.applyCatalogPlan({ supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, products: [{ supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, supplierProductCode: first.supplierProductCode, firstSeenAt: now }], offers: [{ ...first, availability: { state: "AVAILABLE" } }], missing: [{ _id: missingHistorical._id, availability: { state: "UNKNOWN" } }] }, { ingestionRunId: run1, evidenceContext: { supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: "bulk-current-only", observedAt: now, coverageState: "COMPLETE" } });
    equal(legacyBulkCount, 2, "legacy bulk observation behavior remains unchanged");
    equal(bulkEvidenceInput.offers.length, 1, "Fazer bulk v2 manifest excludes persisted offers missing from the current run");
    equal(String(bulkEvidenceInput.offers[0]._id), String(first._id), "Fazer bulk v2 manifest retains the genuine current-run offer");

    let optimizedBulkCount = 0;
    const optimizedRepositories = createSupplierCatalogMongoRepositories({
        Product: { bulkWrite: async () => null, find: () => query([{ _id: first.supplierCatalogProductId, supplierProductCode: first.supplierProductCode }]) },
        Offer: { bulkWrite: async () => null, find: () => query([first, missingHistorical]) },
        Availability: { bulkWrite: async () => null },
        Observation: { bulkWrite: async operations => { optimizedBulkCount += operations.length; } }
    }, { evidencePolicy: { v2WriteEnabled: false, v2ReadEnabled: false, legacyWriteEnabled: true, currentRunLegacyObservationsEnabled: true } });
    await optimizedRepositories.bulk.applyCatalogPlan({ supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, products: [{ supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, supplierProductCode: first.supplierProductCode, firstSeenAt: now }], offers: [{ ...first, availability: { state: "AVAILABLE" } }], missing: [{ _id: missingHistorical._id, availability: { state: "UNKNOWN" } }] }, { ingestionRunId: run1 });
    equal(optimizedBulkCount, 1, "optimized legacy bulk observations include only validated current-run offers");

    let fazerContext = null, wonddContext = null;
    const emptyPlan = { supplierId: first.supplierId, observedAt: now, coverageState: "COMPLETE", runStatus: "SUCCEEDED_COMPLETE", products: [], offers: [], missing: [], mappingCoverage: {}, categoryResults: [], errors: [] };
    await fazerProvider.applyCatalogOnlyPlan(emptyPlan, { runs: { start: async () => ({ _id: run1 }), finalize: async () => ({ status: "SUCCEEDED_COMPLETE" }) }, bulk: { applyCatalogPlan: async (_plan, options) => { fazerContext = options.evidenceContext; } } }, { runKey: "fazer-run" });
    equal(fazerContext.runKey, "fazer-run", "Fazer bulk ingestion passes immutable run evidence context");
    const wonddPlan = { ...emptyPlan, coverageState: "PARTIAL", runStatus: "SUCCEEDED_PARTIAL", contentRevision: "revision", products: [{ supplierProductCode: first.supplierProductCode }], offers: [{ ...first, availability: { state: "AVAILABLE" } }] };
    await wonddProvider.applyCatalogOnlyPlan(wonddPlan, { runs: { start: async () => ({ _id: run2 }), finalize: async () => ({ status: "SUCCEEDED_PARTIAL" }) }, products: { upsert: async row => ({ ...row, _id: first.supplierCatalogProductId }) }, offers: { upsert: async row => row }, availability: { upsert: async row => row }, observations: { append: async () => null, appendRun: async input => { wonddContext = input; } } }, { runKey: "wondd-run" });
    equal(wonddContext.runKey, "wondd-run", "WonDD ingestion publishes one complete run manifest after offer persistence");
    equal(wonddContext.offers.length, 1, "WonDD manifest receives persisted cost-bearing offers");

    let legacyReads = 0, v2Reads = 0;
    const legacyRun = { _id: run1, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, status: "SUCCEEDED_COMPLETE", coverageState: "COMPLETE", startedAt: now, completedAt: later };
    const LegacyRun = { findById: () => ({ lean: async () => legacyRun }) };
    const LegacyObservation = { find: () => ({ sort: () => ({ lean: async () => { legacyReads += 1; return [{ path: "legacy", ingestionRunId: run1, supplierId: first.supplierId, catalogNamespace: first.catalogNamespace }]; } }) }) };
    const legacyReader = createWeeklyRepositories({ Observation: LegacyObservation, Run: LegacyRun }, { evidencePolicy: defaults, evidenceRepositories: { observationsForRun: async () => { v2Reads += 1; return []; } } });
    equal((await legacyReader.observations([first._id], run1))[0].path, "legacy", "default-off reads remain legacy");
    equal(v2Reads, 0, "default-off reads never query v2");
    const v2Reader = createWeeklyRepositories({ Observation: LegacyObservation, Run: LegacyRun }, { evidencePolicy: { ...defaults, v2ReadEnabled: true }, evidenceRepositories: { observationsForRun: async () => { v2Reads += 1; return [{ path: "v2" }]; } } });
    equal((await v2Reader.observations([first._id], run1))[0].path, "v2", "enabled reads prefer exact-run v2 evidence");
    const fallbackReader = createWeeklyRepositories({ Observation: LegacyObservation, Run: LegacyRun }, { evidencePolicy: { ...defaults, v2ReadEnabled: true }, evidenceRepositories: { observationsForRun: async () => null } });
    equal((await fallbackReader.observations([first._id], run1))[0].path, "legacy", "missing v2 manifest rolls back to legacy evidence");
    const guardedWeeklyReader = createWeeklyRepositories({ Observation: LegacyObservation }, { evidencePolicy: { ...defaults, v2ReadEnabled: true }, evidenceRepositories: lifecycleEvidence });
    lifecycleMemory.runs.set(String(run1), terminalRun(lifecycleManifest, { status: "RUNNING", coverageState: "UNKNOWN", completedAt: null }));
    await assert.rejects(() => guardedWeeklyReader.observations([first._id], run1), error => error.code === "SUPPLIER_COST_EVIDENCE_RUN_NOT_ELIGIBLE"); checks += 1;
    equal(legacyReads, 2, "ineligible v2 run cannot bypass the terminal gate through legacy fallback");
    lifecycleMemory.runs.set(String(run1), terminalRun(lifecycleManifest));

    const selection = { productCode: "mlbb", packageCode: "MLBB_10", customerMarket: "GLOBAL", supplierMappingId: "m1" };
    const supplier = { _id: String(first.supplierId), supplierCode: "FAZERCARDS" };
    const mapping = { _id: "m1", supplierId: String(first.supplierId), supplierCode: "FAZERCARDS", supplierCatalogOfferId: String(first._id), productCode: "mlbb", packageCode: "MLBB_10", supplierProductCode: first.supplierProductCode, supplierPackageCode: first.supplierOfferCode, updatedAt: later, supplierCostAuthority: {} };
    const currentOffer = { ...second, _id: String(second._id), supplierId: String(second.supplierId), supplierCatalogProductId: String(second.supplierCatalogProductId) };
    const observation = { ...run2Rows[0], supplierCatalogOfferId: String(run2Rows[0].supplierCatalogOfferId), supplierId: String(run2Rows[0].supplierId), ingestionRunId: String(run2Rows[0].ingestionRunId) };
    const baseRepos = { selections: async () => [selection], mappings: async () => [mapping], offers: async () => [currentOffer], observations: async () => [observation], supplier: async () => supplier, approval: async () => null, createManifest: async value => ({ _id: value.manifestHash, ...value }), consumeApproval: async () => null, updateRun: async () => null };
    const policy = { maximumObservationAgeMs: 86_400_000, maximumAutomaticChangePercent: 20 };
    const preparedService = createWeeklySupplierCostSyncService({ repositories: baseRepos, promoter: async () => ({ replayed: false }), clock: () => later });
    const prepared = await preparedService.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: String(run2), prepare: true, policy, actor: {} });
    equal(prepared.initialCandidateCount, 1, "v2 evidence preserves initial approval candidate behavior");
    const approvalCandidate = immutableCandidate({ ...prepared.decisions[0], status: "ACCEPTABLE", mapping, offer: currentOffer, observation });
    const approvalHash = manifestHash([approvalCandidate]);
    const approvedRepos = { ...baseRepos, approval: async hash => hash === approvalHash ? { manifestHash: approvalHash, status: "APPROVED", maximumInitialPromotions: 1, expiresAt: new Date(later.getTime() + 60_000), candidates: [approvalCandidate], approvedBy: { adminId: "444444444444444444444444", username: "owner", role: "OWNER" } } : null };
    let promotions = 0;
    const approvedService = createWeeklySupplierCostSyncService({ repositories: approvedRepos, promoter: async () => ({ replayed: promotions++ > 0 }), clock: () => later });
    const approved = await approvedService.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: String(run2), approvalHash, initialOnly: true, policy, actor: {} });
    equal(approved.updated, 1, "exact v2-backed approval promotes once");
    const replay = await approvedService.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: String(run2), approvalHash, initialOnly: true, policy, actor: {} });
    equal(replay.replayed, 1, "v2-backed approval replay remains idempotent");
    const missingService = createWeeklySupplierCostSyncService({ repositories: { ...baseRepos, observations: async () => [] }, promoter: async () => { throw new Error("must not promote"); }, clock: () => later });
    equal((await missingService.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: "missing", dryRun: true, policy, actor: {} })).decisions[0].code, "FRESH_RUN_OBSERVATION_MISSING", "missing evidence fails closed");
    const staleService = createWeeklySupplierCostSyncService({ repositories: { ...baseRepos, observations: async () => [{ ...observation, observedAt: new Date(later.getTime() - 90_000_000) }] }, promoter: async () => { throw new Error("must not promote"); }, clock: () => later });
    equal((await staleService.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: "stale", dryRun: true, policy, actor: {} })).decisions[0].code, "STALE_OBSERVATION", "stale evidence fails closed");

    const lockMapping = { ...mapping, supplierCostAuthority: { rawSupplierCost: 1, supplierCurrency: "USD" } }, lock = sourceLock(lockMapping, currentOffer);
    assert.throws(() => validateLock({ ...lock, observedAt: now.toISOString() }, lock), error => error.code === "COST_RECONFIRMATION_REQUIRED"); checks += 1;

    const representativeOffers = Array.from({ length: 259 }, (_, index) => offer({ _id: oid(), supplierCatalogProductId: oid(), supplierOfferCode: `offer-${index}` }));
    const legacyDocuments = [];
    const v2Versions = representativeOffers.map(buildCostVersion);
    const v2Manifests = [];
    for (let run = 0; run < 8; run += 1) {
        const observedAt = new Date(now.getTime() + run * 6 * 60 * 60 * 1000);
        legacyDocuments.push(...representativeOffers.map(row => ({ ...legacyObservation({ ...row, supplierCost: { ...row.supplierCost, observedAt } }, oid()), _id: oid() })));
        v2Manifests.push(buildRunManifest({ ingestionRunId: oid(), supplierId: first.supplierId, catalogNamespace: first.catalogNamespace, runKey: `representative-${run}`, observedAt, coverageState: "COMPLETE", offers: representativeOffers.map(row => ({ ...row, supplierCost: { ...row.supplierCost, observedAt } })) }));
    }
    const bsonSize = value => mongoose.mongo.BSON.calculateObjectSize(value);
    const legacyBytes = legacyDocuments.reduce((sum, row) => sum + bsonSize(row), 0);
    const v2Bytes = v2Versions.reduce((sum, row) => sum + bsonSize(row), 0) + v2Manifests.reduce((sum, row) => sum + bsonSize(row), 0);
    ok(v2Bytes < legacyBytes, "representative v2 BSON is smaller than full per-run observations");

    console.log(JSON.stringify({ result: "PASS", checks, isolated: true, productionConnections: 0, supplierCalls: 0, legacyCompatibility: "PASS", storageEstimate: { assumptions: { offers: 259, runs: 8, unchangedCostRate: 1, excludesIndexAndStorageEngineOverhead: true }, legacyBytes, v2Bytes, reductionBytes: legacyBytes - v2Bytes, reductionPercent: Number(((legacyBytes - v2Bytes) / legacyBytes * 100).toFixed(2)) } }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
