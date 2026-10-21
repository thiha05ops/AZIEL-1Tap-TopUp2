#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Run = require("../models/SupplierCatalogIngestionRun");
const Observation = require("../models/SupplierCatalogCostObservation");
const { createRepositories, createWeeklySupplierCostSyncService } = require("../services/supplierCatalog/weeklySupplierCostSyncService");

const DB_NAME = "aziel_legacy_terminal_evidence_isolated";
const NAMESPACE = "FAZERCARDS_RESELLER_CATALOG";
let checks = 0;
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const rejected = async (promise, code, message) => { await assert.rejects(promise, error => error.code === code, message); checks += 1; };

async function main() {
    const server = await MongoMemoryServer.create({ instance: { dbName: DB_NAME, ip: "127.0.0.1", port: 27203 } });
    try {
        const uri = server.getUri(DB_NAME), parsed = new URL(uri);
        assert.strictEqual(parsed.hostname, "127.0.0.1");
        assert.strictEqual(parsed.pathname.replace(/^\//, ""), DB_NAME);
        assert.notStrictEqual(DB_NAME, "azielshop");
        await mongoose.connect(uri, { autoIndex: false });
        await Promise.all([Run.syncIndexes(), Observation.syncIndexes()]);

        const supplierId = new mongoose.Types.ObjectId(), otherSupplierId = new mongoose.Types.ObjectId();
        const productId = new mongoose.Types.ObjectId(), offerId = new mongoose.Types.ObjectId();
        const startedAt = new Date("2026-10-20T00:00:00.000Z"), completedAt = new Date("2026-10-20T00:00:01.000Z");
        async function seed(status, coverageState, overrides = {}) {
            const runId = new mongoose.Types.ObjectId();
            const run = await Run.create({ _id: runId, supplierId, catalogNamespace: NAMESPACE, runKey: `run-${runId}`, status, coverageState, startedAt, completedAt: status === "RUNNING" ? null : completedAt, offersObserved: 1, ...overrides.run });
            const observation = await Observation.create({ supplierCatalogOfferId: offerId, supplierCatalogProductId: productId, supplierId, catalogNamespace: NAMESPACE, supplierProductCode: "game", supplierOfferCode: "offer", amount: 1, currency: "USD", observedAt: startedAt, sourceRevision: "revision", rawSnapshotHash: "a".repeat(64), observedCostHash: new mongoose.Types.ObjectId().toHexString().repeat(3).slice(0, 64), ingestionRunId: runId, ...overrides.observation });
            return { run: run.toObject(), observation: observation.toObject() };
        }

        const repositories = createRepositories({ Run, Observation }, { evidencePolicy: { v2ReadEnabled: false } });
        const complete = await seed("SUCCEEDED_COMPLETE", "COMPLETE");
        equal((await repositories.observations([offerId], complete.run._id)).length, 1, "complete terminal legacy evidence is readable");
        const partial = await seed("SUCCEEDED_PARTIAL", "PARTIAL");
        equal((await repositories.observations([offerId], partial.run._id)).length, 1, "partial terminal legacy evidence is readable for its observed offer");

        for (const [status, coverage] of [["FAILED", "UNKNOWN"], ["RUNNING", "UNKNOWN"], ["SUCCEEDED_COMPLETE", "PARTIAL"], ["SUCCEEDED_PARTIAL", "COMPLETE"]]) {
            const row = await seed(status, coverage);
            await rejected(repositories.observations([offerId], row.run._id), "SUPPLIER_COST_EVIDENCE_RUN_NOT_ELIGIBLE", `${status}/${coverage} must be rejected`);
        }
        await rejected(repositories.observations([offerId], new mongoose.Types.ObjectId()), "SUPPLIER_COST_EVIDENCE_RUN_MISSING", "missing run must be rejected");

        const badTimeline = await seed("SUCCEEDED_COMPLETE", "COMPLETE", { run: { completedAt: new Date(startedAt.getTime() - 1) } });
        await rejected(repositories.observations([offerId], badTimeline.run._id), "SUPPLIER_COST_EVIDENCE_RUN_TIMELINE_INVALID", "corrupted timeline must be rejected");
        const supplierMismatch = await seed("SUCCEEDED_COMPLETE", "COMPLETE", { observation: { supplierId: otherSupplierId } });
        await rejected(repositories.observations([offerId], supplierMismatch.run._id), "SUPPLIER_COST_EVIDENCE_RUN_IDENTITY_MISMATCH", "supplier mismatch must be rejected");
        const namespaceMismatch = await seed("SUCCEEDED_COMPLETE", "COMPLETE", { observation: { catalogNamespace: "WRONG_NAMESPACE" } });
        await rejected(repositories.observations([offerId], namespaceMismatch.run._id), "SUPPLIER_COST_EVIDENCE_RUN_IDENTITY_MISMATCH", "namespace mismatch must be rejected");

        const historical = await Observation.create({ supplierCatalogOfferId: offerId, supplierCatalogProductId: productId, supplierId, catalogNamespace: NAMESPACE, supplierProductCode: "game", supplierOfferCode: "historical", amount: 2, currency: "USD", observedAt: startedAt, sourceRevision: "revision", rawSnapshotHash: "c".repeat(64), observedCostHash: "d".repeat(64), ingestionRunId: null });
        const historyRows = await repositories.observations([offerId], null);
        assert(historyRows.some(row => String(row._id) === String(historical._id))); checks += 1;

        const v2Row = { path: "v2" };
        const v2Reader = createRepositories({ Run, Observation }, { evidencePolicy: { v2ReadEnabled: true }, evidenceRepositories: { observationsForRun: async () => [v2Row] } });
        equal((await v2Reader.observations([offerId], complete.run._id))[0], v2Row, "validated V2 evidence remains preferred when enabled");
        const v2Fallback = createRepositories({ Run, Observation }, { evidencePolicy: { v2ReadEnabled: true }, evidenceRepositories: { observationsForRun: async () => null } });
        equal((await v2Fallback.observations([offerId], complete.run._id)).length, 1, "V2 missing-manifest fallback uses validated legacy evidence");

        const selection = { productCode: "game", packageCode: "PKG", customerMarket: "GLOBAL", supplierMappingId: "mapping" };
        const mapping = { _id: "mapping", supplierId, supplierCode: "FAZERCARDS", supplierCatalogOfferId: offerId, productCode: "game", packageCode: "PKG", supplierProductCode: "game", supplierPackageCode: "offer", supplierCostAuthority: {} };
        const offer = { _id: offerId, supplierId, supplierProductCode: "game", supplierOfferCode: "offer", catalogLifecycleState: "ACTIVE", supplierCost: { amount: 1, currency: "USD", observedAt: startedAt } };
        const serviceFor = repo => createWeeklySupplierCostSyncService({ repositories: { selections: async () => [selection], mappings: async () => [mapping], offers: async () => [offer], observations: repo.observations, supplier: async () => ({ _id: supplierId, supplierCode: "FAZERCARDS" }), approval: async () => null, createManifest: async value => value, consumeApproval: async () => null, updateRun: async () => null }, promoter: async () => { throw new Error("promotion must not run"); }, clock: () => completedAt });
        const prepared = await serviceFor(repositories).reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: complete.run._id, prepare: true, policy: { maximumObservationAgeMs: 86400000, maximumAutomaticChangePercent: 20 }, actor: {} });
        equal(prepared.initialCandidateCount, 1, "complete terminal evidence can prepare one approval candidate");
        const partialPrepared = await serviceFor(repositories).reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: partial.run._id, prepare: true, policy: { maximumObservationAgeMs: 86400000, maximumAutomaticChangePercent: 20 }, actor: {} });
        equal(partialPrepared.initialCandidateCount, 1, "partial terminal evidence can prepare only its present offer candidate");
        const failed = await seed("FAILED", "UNKNOWN");
        await rejected(serviceFor(repositories).reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: failed.run._id, prepare: true, policy: { maximumObservationAgeMs: 86400000, maximumAutomaticChangePercent: 20 }, actor: {} }), "SUPPLIER_COST_EVIDENCE_RUN_NOT_ELIGIBLE", "failed run cannot prepare approval evidence");

        console.log(JSON.stringify({ result: "PASS", checks, database: DB_NAME, productionConnections: 0, supplierCalls: 0, complete: "ELIGIBLE", partial: "ELIGIBLE_FOR_PRESENT_ROWS", failed: "REJECTED", running: "REJECTED", missing: "REJECTED", mismatched: "REJECTED", corrupted: "REJECTED", historicalWithoutRunId: "PRESERVED", v2Compatibility: "PASS" }, null, 2));
    } finally {
        await mongoose.disconnect().catch(() => {});
        await server.stop().catch(() => {});
    }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
