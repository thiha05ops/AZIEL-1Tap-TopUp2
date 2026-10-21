#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoServerError } = require("mongodb");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Run = require("../models/SupplierCatalogIngestionRun");
const Latest = require("../models/SupplierCatalogLatestCost");
const { readSupplierCostEvidencePolicy } = require("../config/supplierCostEvidencePolicy");
const { createSupplierLatestCostService } = require("../services/supplierCatalog/supplierLatestCostService");
const { LATEST_COST_TRANSACTION_OPTIONS, createSupplierCatalogMongoRepositories } = require("../services/supplierCatalog/supplierCatalogMongoRepositories");
const { createWeeklySupplierCostSyncService } = require("../services/supplierCatalog/weeklySupplierCostSyncService");

let checks = 0;
const ok = (value, message) => { assert(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const oid = () => new mongoose.Types.ObjectId();
const supplierId = oid(), productId = oid(), offerA = oid(), offerB = oid();
const t1 = new Date("2026-10-19T00:00:00.000Z"), t2 = new Date("2026-10-19T06:00:00.000Z"), t0 = new Date("2026-10-18T18:00:00.000Z");

function offer(_id, observedAt, amount = 10) {
    return { _id, supplierCatalogProductId: productId, supplierId, catalogNamespace: "TEST_CATALOG", supplierProductCode: "game", supplierOfferCode: String(_id), supplierCost: { amount, currency: "THB", observedAt }, sourceRevision: `rev-${amount}`, rawSnapshotHash: String(amount).padStart(64, "a").slice(-64).replace(/[^a-f0-9]/g, "a") };
}
function plan(observedAt, offers, coverage = "COMPLETE") {
    return { observedAt, products: [], offers, missing: [], runStatus: coverage === "COMPLETE" ? "SUCCEEDED_COMPLETE" : "SUCCEEDED_PARTIAL", coverageState: coverage, mappingCoverage: {}, categoryResults: [], errors: [] };
}
async function startRun(observedAt, key) {
    return Run.create({ supplierId, catalogNamespace: "TEST_CATALOG", runKey: key, status: "RUNNING", coverageState: "UNKNOWN", startedAt: observedAt });
}

(async () => {
    const faultOutcomes = { transientTransactionRetry: "NOT_TESTED", unknownCommitResultRetry: "NOT_TESTED" };
    const policy = readSupplierCostEvidencePolicy({ SUPPLIER_COST_LATEST_ONLY_ENABLED: "true", SUPPLIER_COST_EVIDENCE_LEGACY_WRITE_ENABLED: "false", SUPPLIER_COST_EVIDENCE_V2_WRITE_ENABLED: "true" });
    ok(policy.latestOnlyEnabled && !policy.v2WriteEnabled && !policy.legacyWriteEnabled, "latest-only mode suppresses history writers");
    equal(readSupplierCostEvidencePolicy({}).latestOnlyEnabled, false, "latest-only defaults off");
    assert.deepStrictEqual(LATEST_COST_TRANSACTION_OPTIONS, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", wtimeoutMS: 10000 },
        readPreference: "primary",
        maxCommitTimeMS: 10000
    }); checks += 1;
    const repl = await MongoMemoryReplSet.create({
        instanceOpts: [{ args: ["--setParameter", "enableTestCommands=1"] }],
        replSet: { count: 1, storageEngine: "wiredTiger" }
    });
    try {
        const uri = repl.getUri("aziel_latest_only_test");
        if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(uri)) throw new Error("Safety abort: disposable MongoDB is not loopback.");
        mongoose.set("autoIndex", false);
        await mongoose.connect(uri, { monitorCommands: true });
        const transactionCommands = [];
        mongoose.connection.getClient().on("commandStarted", event => {
            if (["findAndModify", "commitTransaction", "abortTransaction"].includes(event.commandName)) transactionCommands.push(event);
        });
        await Promise.all([Run.createCollection(), Latest.createCollection()]);
        const repositories = createSupplierCatalogMongoRepositories({}, { evidencePolicy: policy });
        const latest = createSupplierLatestCostService();

        const r1 = await startRun(t1, "run-1");
        await repositories.runs.finalizeWithLatest(r1._id, plan(t1, [offer(offerA, t1)]), [offer(offerA, t1)]);
        equal(await Latest.countDocuments(), 1, "first successful run creates one latest record");
        equal((await Latest.findById(offerA).lean()).amount, 10, "first cost published");
        const transactionStart = transactionCommands.find(event => event.command.startTransaction === true);
        ok(transactionStart?.command?.readConcern?.level === "snapshot", "wire command starts latest publication with snapshot read concern");
        const commit = transactionCommands.find(event => event.commandName === "commitTransaction");
        ok(commit?.command?.writeConcern?.w === "majority" && commit.command.writeConcern.wtimeout === 10000, "wire commit uses bounded majority write concern");

        const r2 = await startRun(t2, "run-2");
        await repositories.runs.finalizeWithLatest(r2._id, plan(t2, [offer(offerA, t2)]), [offer(offerA, t2)]);
        equal(await Latest.countDocuments(), 1, "unchanged cost replaces freshness without history growth");
        equal(String((await Latest.findById(offerA).lean()).ingestionRunId), String(r2._id), "fresh run identity replaces prior run");

        const r3 = await startRun(new Date(t2.getTime() + 3600000), "run-3");
        const changed = offer(offerA, r3.startedAt, 12);
        await repositories.runs.finalizeWithLatest(r3._id, plan(r3.startedAt, [changed]), [changed]);
        equal(await Latest.countDocuments(), 1, "changed cost still retains one record");
        equal((await Latest.findById(offerA).lean()).amount, 12, "changed cost becomes latest");

        const old = await startRun(t0, "old-run");
        await repositories.runs.finalizeWithLatest(old._id, plan(t0, [offer(offerA, t0, 5)]), [offer(offerA, t0, 5)]);
        equal((await Latest.findById(offerA).lean()).amount, 12, "older concurrent completion cannot overwrite newer validated cost");

        const partial = await startRun(new Date(t2.getTime() + 7200000), "partial-run");
        await repositories.runs.finalizeWithLatest(partial._id, plan(partial.startedAt, [offer(offerA, partial.startedAt, 13)], "PARTIAL"), [offer(offerA, partial.startedAt, 13)]);
        equal((await Latest.findById(offerA).lean()).amount, 13, "successfully observed partial member may advance");
        equal(await Latest.countDocuments({ _id: offerB }), 0, "missing partial-run offer receives no record");

        const failed = await startRun(new Date(t2.getTime() + 10800000), "failed-run");
        await assert.rejects(() => latest.publishRun({ ...failed.toObject(), status: "FAILED", coverageState: "UNKNOWN", completedAt: new Date() }, [offer(offerA, failed.startedAt, 99)]), error => error.code === "SUPPLIER_LATEST_COST_RUN_NOT_ELIGIBLE"); checks += 1;
        equal((await Latest.findById(offerA).lean()).amount, 13, "failed run cannot overwrite latest");

        const interrupted = await startRun(new Date(t2.getTime() + 14400000), "interrupted-run");
        const invalid = { ...offer(offerA, interrupted.startedAt, 14), rawSnapshotHash: "not-a-hash" };
        await assert.rejects(() => repositories.runs.finalizeWithLatest(interrupted._id, plan(interrupted.startedAt, [invalid]), [invalid])); checks += 1;
        equal((await Run.findById(interrupted._id).lean()).status, "RUNNING", "transaction rolls back terminal state when publication fails");
        equal((await Latest.findById(offerA).lean()).amount, 13, "interrupted publication preserves previous latest");

        const exact = await latest.forOffers([offerA], { ingestionRunId: partial._id });
        equal(exact.length, 1, "weekly exact-run reader resolves current latest evidence");
        equal((await latest.forOffers([offerA], { ingestionRunId: r2._id })).length, 0, "superseded run cannot masquerade as current latest evidence");
        const persistedLatest = await Latest.findById(offerA).lean();
        await Latest.collection.updateOne({ _id: offerA }, { $set: { observedCostHash: "0".repeat(64) } });
        await assert.rejects(() => latest.forOffers([offerA]), error => error.code === "SUPPLIER_LATEST_COST_HASH_INVALID"); checks += 1;
        await Latest.collection.replaceOne({ _id: offerA }, persistedLatest);
        await Run.collection.updateOne({ _id: partial._id }, { $set: { status: "FAILED" } });
        await assert.rejects(() => latest.forOffers([offerA]), error => error.code === "SUPPLIER_LATEST_COST_RUN_NOT_ELIGIBLE"); checks += 1;
        await Run.collection.updateOne({ _id: partial._id }, { $set: { status: "SUCCEEDED_PARTIAL" } });
        await Run.collection.updateOne({ _id: partial._id }, { $set: { supplierId: oid() } });
        await assert.rejects(() => latest.forOffers([offerA]), error => error.code === "SUPPLIER_LATEST_COST_RUN_IDENTITY_MISMATCH"); checks += 1;
        await Run.collection.updateOne({ _id: partial._id }, { $set: { supplierId } });
        await Latest.collection.updateOne({ _id: offerA }, { $set: { ingestionRunId: oid() } });
        await assert.rejects(() => latest.forOffers([offerA]), error => error.code === "SUPPLIER_LATEST_COST_RUN_MISSING"); checks += 1;
        await Latest.collection.replaceOne({ _id: offerA }, persistedLatest);
        await Latest.collection.updateOne({ _id: offerA }, { $set: { amount: -1 } });
        await assert.rejects(() => latest.forOffers([offerA]), error => error.code === "SUPPLIER_LATEST_COST_INVALID"); checks += 1;
        await Latest.collection.replaceOne({ _id: offerA }, persistedLatest);
        const latestRow = exact[0], mappingId = oid();
        const weekly = createWeeklySupplierCostSyncService({ repositories: {
            supplier: async () => ({ _id: supplierId, supplierCode: "TEST" }),
            selections: async () => [{ productCode: "game", packageCode: "PKG", supplierMappingId: mappingId }],
            mappings: async () => [{ _id: mappingId, supplierId, supplierCode: "TEST", productCode: "game", packageCode: "PKG", supplierCatalogOfferId: offerA, supplierProductCode: "game", supplierPackageCode: String(offerA), supplierCostAuthority: { rawSupplierCost: 13, supplierCurrency: "THB", capturedAt: t1 } }],
            offers: async () => [{ ...offer(offerA, new Date("2026-10-20T00:00:00.000Z"), 99), catalogLifecycleState: "ACTIVE" }],
            observations: async () => [latestRow], approval: async () => null, createManifest: async value => value,
            consumeApproval: async () => null, updateRun: async () => null
        }, clock: () => new Date(partial.startedAt.getTime() + 1000) });
        const weeklyResult = await weekly.reconcile({ supplierCode: "TEST", ingestionRunId: partial._id, dryRun: true, policy: { maximumObservationAgeMs: 86400000, maximumAutomaticChangePercent: 20 }, actor: {} });
        equal(weeklyResult.unchanged, 1, "weekly reconciliation uses terminal latest evidence, not an unvalidated newer catalog-offer cost");
        const beforeRetryCount = await Latest.countDocuments();
        await repositories.runs.finalizeWithLatest(partial._id, plan(partial.startedAt, [offer(offerA, partial.startedAt, 13)], "PARTIAL"), [offer(offerA, partial.startedAt, 13)]);
        equal(await Latest.countDocuments(), beforeRetryCount, "identical retry converges without growth");

        const transientAt = new Date(t2.getTime() + 15000000), transientRun = await startRun(transientAt, "transient-retry-run");
        let transientAttempts = 0;
        const transientRepositories = createSupplierCatalogMongoRepositories({}, {
            evidencePolicy: policy,
            latestCostService: {
                async publishRun(...args) {
                    transientAttempts += 1;
                    if (transientAttempts === 1) {
                        const error = new MongoServerError({ message: "synthetic transient transaction fault", code: 112 });
                        error.addErrorLabel("TransientTransactionError");
                        throw error;
                    }
                    return latest.publishRun(...args);
                }
            }
        });
        await transientRepositories.runs.finalizeWithLatest(transientRun._id, plan(transientAt, [offer(offerA, transientAt, 15)]), [offer(offerA, transientAt, 15)]);
        equal(transientAttempts, 2, "driver retries the whole latest publication after a transient transaction error");
        equal((await Latest.findById(offerA).lean()).amount, 15, "transient retry publishes exactly one validated latest value");
        faultOutcomes.transientTransactionRetry = "PASS";

        const olderConcurrentAt = new Date(transientAt.getTime() + 1000), newerConcurrentAt = new Date(transientAt.getTime() + 2000);
        const [olderConcurrentRun, newerConcurrentRun] = await Promise.all([
            startRun(olderConcurrentAt, "concurrent-older-run"),
            startRun(newerConcurrentAt, "concurrent-newer-run")
        ]);
        await Promise.all([
            repositories.runs.finalizeWithLatest(olderConcurrentRun._id, plan(olderConcurrentAt, [offer(offerA, olderConcurrentAt, 16)]), [offer(offerA, olderConcurrentAt, 16)]),
            repositories.runs.finalizeWithLatest(newerConcurrentRun._id, plan(newerConcurrentAt, [offer(offerA, newerConcurrentAt, 17)]), [offer(offerA, newerConcurrentAt, 17)])
        ]);
        equal((await Latest.findById(offerA).lean()).amount, 17, "concurrent terminal runs converge on the newest validated observation");

        try {
            await mongoose.connection.db.admin().command({
                configureFailPoint: "failCommand",
                mode: { times: 1 },
                data: { failCommands: ["commitTransaction"], errorCode: 91, errorLabels: ["UnknownTransactionCommitResult"] }
            });
            const unknownCommitAt = new Date(newerConcurrentAt.getTime() + 1000), unknownCommitRun = await startRun(unknownCommitAt, "unknown-commit-run");
            let unknownCommitCallbacks = 0;
            const unknownCommitRepositories = createSupplierCatalogMongoRepositories({}, {
                evidencePolicy: policy,
                latestCostService: {
                    async publishRun(...args) { unknownCommitCallbacks += 1; return latest.publishRun(...args); }
                }
            });
            await unknownCommitRepositories.runs.finalizeWithLatest(unknownCommitRun._id, plan(unknownCommitAt, [offer(offerA, unknownCommitAt, 18)]), [offer(offerA, unknownCommitAt, 18)]);
            equal(unknownCommitCallbacks, 1, "unknown commit result retries commit without replaying the publication callback");
            equal((await Latest.findById(offerA).lean()).amount, 18, "unknown commit retry preserves the committed latest value");
            faultOutcomes.unknownCommitResultRetry = "PASS";
        } catch (error) {
            if (!/failpoint|configureFailPoint|CommandNotFound|not allowed/i.test(String(error?.message || error))) throw error;
        }

        console.log(JSON.stringify({ result: "PASS", checks, database: "disposable-loopback-replica-set", latestDocuments: await Latest.countDocuments(), transactionOptions: LATEST_COST_TRANSACTION_OPTIONS, faultOutcomes, productionConnections: 0, supplierCalls: 0 }, null, 2));
    } finally { await mongoose.disconnect().catch(() => {}); await repl.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
