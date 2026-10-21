#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Observation = require("../models/SupplierCatalogCostObservation");
const { readSupplierCostEvidencePolicy } = require("../config/supplierCostEvidencePolicy");
const { createSupplierCatalogMongoRepositories } = require("../services/supplierCatalog/supplierCatalogMongoRepositories");

const DB_NAME = "aziel_supplier_observation_growth_isolated";
const NAMESPACE = "FAZERCARDS_RESELLER_CATALOG";
const supplierId = new mongoose.Types.ObjectId();
const productId = new mongoose.Types.ObjectId();
const baseTime = new Date("2026-10-20T00:00:00.000Z");
const productCode = "synthetic_game";
const hash = value => String(value).repeat(64).slice(0, 64);
const bsonSize = value => mongoose.mongo.BSON.calculateObjectSize(value);

let checks = 0;
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const ok = (value, message) => { assert(value, message); checks += 1; };

function offer(code, amount, observedAt, overrides = {}) {
    return {
        _id: overrides._id || new mongoose.Types.ObjectId(), supplierCatalogProductId: productId, supplierId,
        catalogNamespace: NAMESPACE, supplierProductCode: productCode, supplierOfferCode: code,
        supplierOfferName: code, rawName: code, catalogLifecycleState: "ACTIVE", reconciliationState: "SEMANTIC_REVIEW_REQUIRED",
        firstSeenAt: observedAt, lastSeenAt: observedAt, lastObservedAt: observedAt, lastChangedAt: observedAt,
        supplierCost: { amount, currency: "USD", observedAt }, sourceRevision: "synthetic-revision", rawSnapshotHash: hash(code),
        availability: { state: "AVAILABLE", evidenceCode: "SYNTHETIC_CURRENT_RESPONSE", observedAt, coverageComplete: true },
        ...overrides
    };
}

function models(state, { failObservationOnce = false, corruptOfferPersistence = false } = {}) {
    let shouldFail = failObservationOnce;
    const query = rows => ({ select: () => ({ lean: async () => rows }) });
    return {
        Product: {
            bulkWrite: async () => null,
            find: () => query([{ _id: productId, supplierProductCode: productCode }])
        },
        Offer: {
            bulkWrite: async operations => {
                if (corruptOfferPersistence) return;
                for (const operation of operations) {
                    const identity = operation.updateOne.filter;
                    const current = state.offers.find(row => row.supplierOfferCode === identity.supplierOfferCode);
                    if (current) Object.assign(current, operation.updateOne.update.$set);
                }
            },
            find: () => query(state.offers)
        },
        Availability: { bulkWrite: async () => null },
        Observation: {
            bulkWrite: async operations => {
                if (shouldFail) { shouldFail = false; throw new Error("synthetic interrupted observation write"); }
                return Observation.bulkWrite(operations, { ordered: false });
            }
        }
    };
}

function plan(currentOffers, missingOffers, coverageState = "COMPLETE") {
    return {
        supplierId, catalogNamespace: NAMESPACE, observedAt: currentOffers[0]?.supplierCost?.observedAt || baseTime,
        products: [{ supplierId, catalogNamespace: NAMESPACE, supplierProductCode: productCode, firstSeenAt: baseTime }],
        offers: currentOffers, missing: missingOffers.map(row => ({ _id: row._id, availability: { state: "UNKNOWN", observedAt: currentOffers[0]?.supplierCost?.observedAt || baseTime, coverageComplete: coverageState === "COMPLETE" } })),
        runStatus: coverageState === "COMPLETE" ? "SUCCEEDED_COMPLETE" : "SUCCEEDED_PARTIAL", coverageState, errors: [], categoryResults: [], mappingCoverage: {}
    };
}

async function snapshot() {
    const rows = await Observation.find({}).lean();
    return { count: rows.length, logicalBsonBytes: rows.reduce((sum, row) => sum + bsonSize(row), 0), rows };
}

async function apply(state, inputPlan, optimized, options = {}) {
    const policy = readSupplierCostEvidencePolicy(optimized ? { SUPPLIER_COST_OBSERVATION_CURRENT_RUN_ONLY_ENABLED: "true" } : {});
    const repositories = createSupplierCatalogMongoRepositories(models(state, options), { evidencePolicy: policy });
    return repositories.bulk.applyCatalogPlan(inputPlan, { ingestionRunId: new mongoose.Types.ObjectId() });
}

async function measureMode(optimized) {
    await Observation.deleteMany({});
    const missing = [offer("missing-a", 9, new Date("2026-01-01T00:00:00.000Z")), offer("missing-b", 10, new Date("2026-01-01T00:00:00.000Z")), offer("missing-c", 11, new Date("2026-01-01T00:00:00.000Z"))];
    const current = [offer("current-a", 1, baseTime), offer("current-b", 2, baseTime)];
    const state = { offers: [...current, ...missing] };
    const before = await snapshot();
    const result = await apply(state, plan(current, missing), optimized);
    const after = await snapshot();
    return { before, after, result, state, current, missing };
}

async function main() {
    const server = await MongoMemoryServer.create({ instance: { dbName: DB_NAME, ip: "127.0.0.1", port: 27201 } });
    try {
        const uri = server.getUri(DB_NAME);
        const parsed = new URL(uri);
        assert(["127.0.0.1", "localhost"].includes(parsed.hostname));
        assert.strictEqual(parsed.pathname.replace(/^\//, ""), DB_NAME);
        assert.notStrictEqual(DB_NAME, "azielshop");
        await mongoose.connect(uri, { autoIndex: false });
        equal(mongoose.connection.name, DB_NAME, "connected only to the disposable database");
        await Observation.syncIndexes();

        const defaults = readSupplierCostEvidencePolicy({});
        equal(defaults.currentRunLegacyObservationsEnabled, false, "optimization defaults off");
        equal(readSupplierCostEvidencePolicy({ SUPPLIER_COST_OBSERVATION_CURRENT_RUN_ONLY_ENABLED: "true" }).currentRunLegacyObservationsEnabled, true, "exact opt-in enables optimization");

        const legacy = await measureMode(false);
        equal(legacy.before.count, 0, "legacy measurement starts empty");
        equal(legacy.after.count, 5, "legacy bulk path reproduces observations for current and historical missing offers");
        equal(legacy.result.observations, 5, "legacy result reports every scoped cost-bearing offer");

        const optimized = await measureMode(true);
        equal(optimized.after.count, 2, "optimized bulk path writes only genuine current-run offers");
        equal(optimized.result.observations, 2, "optimized result reports only current-run observation writes");
        ok(optimized.after.rows.every(row => row.supplierOfferCode.startsWith("current-")), "missing historical offers receive no optimized run evidence");

        const partialTime = new Date(baseTime.getTime() + 60_000);
        const partialCurrent = [offer("current-a", 1, partialTime, { _id: optimized.current[0]._id })];
        optimized.state.offers[0] = partialCurrent[0];
        const beforePartial = await snapshot();
        await apply(optimized.state, plan(partialCurrent, [], "PARTIAL"), true);
        const afterPartial = await snapshot();
        equal(afterPartial.count - beforePartial.count, 1, "partial response writes only its one validated current offer");

        const unchangedTime = new Date(baseTime.getTime() + 120_000);
        const unchanged = optimized.current.map(row => offer(row.supplierOfferCode, row.supplierCost.amount, unchangedTime, { _id: row._id }));
        optimized.state.offers.splice(0, 2, ...unchanged);
        const beforeUnchanged = await snapshot();
        await apply(optimized.state, plan(unchanged, optimized.missing), true);
        const afterUnchanged = await snapshot();
        equal(afterUnchanged.count - beforeUnchanged.count, 2, "unchanged prices retain fresh per-run evidence for each observed offer");

        const changedTime = new Date(baseTime.getTime() + 180_000);
        const changed = [offer("current-a", 1.5, changedTime, { _id: unchanged[0]._id }), offer("current-b", 2, changedTime, { _id: unchanged[1]._id })];
        optimized.state.offers.splice(0, 2, ...changed);
        const beforeChanged = await snapshot();
        await apply(optimized.state, plan(changed, optimized.missing), true);
        const afterChanged = await snapshot();
        equal(afterChanged.count - beforeChanged.count, 2, "changed and unchanged current offers both retain run evidence");
        ok(afterChanged.rows.some(row => row.supplierOfferCode === "current-a" && row.amount === 1.5), "genuine changed cost is persisted");

        const retryTime = new Date(baseTime.getTime() + 240_000);
        const retryOffers = changed.map(row => offer(row.supplierOfferCode, row.supplierCost.amount, retryTime, { _id: row._id }));
        optimized.state.offers.splice(0, 2, ...retryOffers);
        const beforeRetry = await snapshot();
        await assert.rejects(() => apply(optimized.state, plan(retryOffers, optimized.missing), true, { failObservationOnce: true }), /synthetic interrupted/); checks += 1;
        equal((await snapshot()).count, beforeRetry.count, "interrupted observation batch publishes no partial evidence");
        await apply(optimized.state, plan(retryOffers, optimized.missing), true);
        equal((await snapshot()).count - beforeRetry.count, 2, "retry publishes the exact current-run evidence once");

        const concurrentTime = new Date(baseTime.getTime() + 300_000);
        const concurrentOffers = retryOffers.map(row => offer(row.supplierOfferCode, row.supplierCost.amount, concurrentTime, { _id: row._id }));
        optimized.state.offers.splice(0, 2, ...concurrentOffers);
        const beforeConcurrent = await snapshot();
        await Promise.all([apply(optimized.state, plan(concurrentOffers, optimized.missing), true), apply(optimized.state, plan(concurrentOffers, optimized.missing), true)]);
        equal((await snapshot()).count - beforeConcurrent.count, 2, "concurrent identical ingestion converges through observation hashes");

        const corruptTime = new Date(baseTime.getTime() + 360_000);
        const corrupt = [offer("current-a", 99, corruptTime, { _id: concurrentOffers[0]._id })];
        const beforeCorrupt = await snapshot();
        await assert.rejects(() => apply(optimized.state, plan(corrupt, optimized.missing), true, { corruptOfferPersistence: true }), error => error.code === "SUPPLIER_COST_EVIDENCE_OBSERVED_OFFER_CONFLICT"); checks += 1;
        equal((await snapshot()).count, beforeCorrupt.count, "corrupted persisted response fails before observation writes");

        const legacyBytes = legacy.after.logicalBsonBytes;
        const optimizedBytes = optimized.after.logicalBsonBytes;
        const savedBytes = legacyBytes - optimizedBytes;
        const reductionPercent = Number((savedBytes / legacyBytes * 100).toFixed(2));
        ok(savedBytes > 0, "representative optimized sync reduces logical BSON growth");

        console.log(JSON.stringify({
            result: "PASS", checks, environment: { mongodb: "mongodb-memory-server", host: parsed.hostname, database: DB_NAME, productionConnections: 0, supplierCalls: 0 },
            representativeManualSync: { currentOffers: 2, persistedMissingOffers: 3, legacy: { observations: legacy.after.count, logicalBsonBytes: legacyBytes }, optimized: { observations: optimized.after.count, logicalBsonBytes: optimizedBytes }, savings: { observations: legacy.after.count - optimized.after.count, logicalBsonBytes: savedBytes, logicalBsonReductionPercent: reductionPercent } },
            scenarios: { full: "PASS", partial: "PASS", missingOffer: "PASS", unchangedPrice: "PASS", changedPrice: "PASS", retry: "PASS", concurrent: "PASS", interrupted: "PASS", corruptedResponse: "PASS" }
        }, null, 2));
    } finally {
        await mongoose.disconnect().catch(() => {});
        await server.stop().catch(() => {});
    }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
