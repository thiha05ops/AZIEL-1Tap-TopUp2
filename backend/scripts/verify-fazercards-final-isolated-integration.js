#!/usr/bin/env node
"use strict";

const assert = require("assert");
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Run = require("../models/SupplierCatalogIngestionRun");
const Observation = require("../models/SupplierCatalogCostObservation");
const fazer = require("../services/supplierCatalog/providers/fazerCardsCatalogIngestionService");
const { readSupplierCostEvidencePolicy } = require("../config/supplierCostEvidencePolicy");
const { createSupplierCatalogMongoRepositories } = require("../services/supplierCatalog/supplierCatalogMongoRepositories");
const { createSupplierCatalogIngestionOrchestrator } = require("../services/supplierCatalog/supplierCatalogIngestionOrchestrator");
const { createRepositories: createWeeklyRepositories } = require("../services/supplierCatalog/weeklySupplierCostSyncService");

const DB_NAME = "aziel_fazercards_final_integration_isolated";
const NAMESPACE = fazer.NAMESPACE;
let checks = 0;
const ok = (value, message) => { assert(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };

function fixtures(mode, state = {}) {
    const category = id => ({ category_id: id, name: `Synthetic ${id}`, note: "Region: GLOBAL" });
    const offer = (id, price) => ({ offer_id: id, name: `${id === "offer-a" ? 100 : 200} Diamonds`, price_usd: price });
    let categoryCalls = 0;
    return {
        async listCategories() {
            categoryCalls += 1;
            if (mode === "FAILED") throw Object.assign(new Error("synthetic fixture read failed"), { code: "SYNTHETIC_FIXTURE_FAILURE" });
            if (mode === "RETRIED" && categoryCalls === 1) throw Object.assign(new Error("synthetic transport interruption"), { code: "TRANSPORT_RESET", retryable: true });
            if (mode === "EMPTY") return { items: [], meta: { next_cursor: "" } };
            return { items: mode === "PARTIAL" ? [category("game-a"), category("game-b")] : [category("game-a")], meta: { next_cursor: "" } };
        },
        async listOffers(categoryId) {
            if (mode === "PARTIAL" && categoryId === "game-b") throw Object.assign(new Error("synthetic category failure"), { code: "SYNTHETIC_CATEGORY_FAILURE" });
            const rows = state.single ? [offer("offer-a", state.changed ? 1.5 : 1)] : [offer("offer-a", state.changed ? 1.5 : 1), offer("offer-b", 2)];
            return { offers: rows, fields: [{ key: "player_id", required: true }], meta: { revision: state.revision || "fixture-r1" } };
        },
        calls: () => categoryCalls
    };
}

function queryFacade(query, transform) {
    const select = query.select.bind(query);
    return {
        select(value) {
            const selected = select(value);
            return { lean: async () => transform(await selected.lean()) };
        }
    };
}

function offerFacadeCorruptAfterWrite() {
    return {
        bulkWrite: (...args) => Offer.bulkWrite(...args),
        find: (...args) => queryFacade(Offer.find(...args), rows => rows.map((row, index) => index ? row : ({ ...row, supplierCost: { ...row.supplierCost, amount: Number(row.supplierCost.amount) + 10 } })))
    };
}

function observationFacadePartialOnce(telemetry) {
    let first = true;
    return {
        async bulkWrite(operations, options) {
            telemetry.attempted += operations.length;
            if (first && operations.length > 1) {
                first = false;
                const result = await Observation.bulkWrite([operations[0]], options);
                telemetry.inserted += result.upsertedCount || 0;
                telemetry.matched += result.matchedCount || 0;
                telemetry.failed += operations.length - 1;
                throw Object.assign(new Error("synthetic unordered observation remainder failed"), { code: "SYNTHETIC_PARTIAL_BULK_FAILURE", result });
            }
            const result = await Observation.bulkWrite(operations, options);
            telemetry.inserted += result.upsertedCount || 0;
            telemetry.matched += result.matchedCount || 0;
            return result;
        }
    };
}

function policy(optimized) {
    return readSupplierCostEvidencePolicy(optimized ? { SUPPLIER_COST_OBSERVATION_CURRENT_RUN_ONLY_ENABLED: "true" } : {});
}

let orchestratorSequence = 0;
function makeOrchestrator({ reader, optimized, fault = "", telemetry = null }) {
    const lock = { supplierId: null, lockKey: "synthetic", ownerId: "synthetic", fencingToken: 1 };
    const locks = { acquire: async input => ({ ...lock, supplierId: input.supplierId }), renew: async value => value, release: async () => true };
    const baseModels = { Product, Offer: fault === "CORRUPT_AFTER_WRITE" ? offerFacadeCorruptAfterWrite() : Offer, Availability, Run, Observation: fault === "PARTIAL_OBSERVATION_BULK" ? observationFacadePartialOnce(telemetry) : Observation };
    let tick = 0;
    const start = Date.parse("2026-10-20T00:00:00.000Z") + (++orchestratorSequence * 60000);
    return createSupplierCatalogIngestionOrchestrator({
        policyReader: () => ({ executionEnabled: true, automatedEnabled: false, suppliers: { FAZERCARDS: { enabled: false, intervalMs: 21600000, timeoutMs: 5000, maxAttempts: 2, retryBaseMs: 1, retryMaxMs: 1, lockTtlMs: 60000 } } }),
        locks,
        models: { Supplier, Mapping, Product, Offer, Run },
        providerFactory: () => ({ service: fazer, reader }),
        repositories: () => createSupplierCatalogMongoRepositories(baseModels, { evidencePolicy: policy(optimized) }),
        reconcileSellability: async () => true,
        sleep: async () => {},
        clock: () => new Date(start + (tick++ * 1000)),
        logger: { info() {}, warn() {}, error() {} }
    });
}

function loadAdminRouter(run) {
    const orchestratorPath = require.resolve("../services/supplierCatalog/supplierCatalogIngestionOrchestrator");
    const originalOrchestrator = require(orchestratorPath);
    require.cache[orchestratorPath].exports = { ...originalOrchestrator, runSupplierCatalogIngestion: run };
    const middlewarePath = require.resolve("../middleware/adminMiddleware");
    require(middlewarePath);
    require.cache[middlewarePath].exports = (req, res, next) => { req.admin = { _id: new mongoose.Types.ObjectId(), username: "synthetic-admin", role: "OWNER" }; next(); };
    const authPath = require.resolve("../services/adminAuthorizationService");
    const auth = require(authPath);
    require.cache[authPath].exports = { ...auth, requireAdminPermission: () => (req, res, next) => next() };
    const routePath = require.resolve("../routes/supplier");
    delete require.cache[routePath];
    return require(routePath);
}

async function routeRun(orchestrator, reason) {
    const app = express();
    app.use(express.json());
    app.use("/api", loadAdminRouter(orchestrator.run));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/supplier-catalog/automation/fazercards/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
        return { status: response.status, body: await response.json() };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

async function assertWeeklyTerminal(runId, accepted) {
    const repositories = createWeeklyRepositories({}, { evidencePolicy: policy(false) });
    const offerIds = await Offer.find({}).distinct("_id");
    if (accepted) {
        const rows = await repositories.observations(offerIds, runId);
        ok(Array.isArray(rows), "terminal weekly exact-run evidence is readable");
        return rows;
    }
    await assert.rejects(() => repositories.observations(offerIds, runId), error => /SUPPLIER_COST_EVIDENCE_RUN_/.test(String(error.code))); checks += 1;
    return [];
}

async function main() {
    const server = await MongoMemoryServer.create({ instance: { dbName: DB_NAME, ip: "127.0.0.1", port: 27203 } });
    try {
        const uri = server.getUri(DB_NAME), parsed = new URL(uri);
        equal(parsed.hostname, "127.0.0.1", "disposable MongoDB is loopback-only");
        equal(parsed.pathname.slice(1), DB_NAME, "disposable database identity is exact");
        ok(DB_NAME !== "azielshop", "production database name is rejected");
        await mongoose.connect(uri, { autoIndex: false });
        await Promise.all([Supplier, Product, Offer, Availability, Run, Observation].map(model => model.syncIndexes()));
        await Supplier.create({ supplierCode: "FAZERCARDS", name: "Synthetic FazerCards", mode: "API", enabled: true, supplierCurrency: "USD" });

        const complete = await routeRun(makeOrchestrator({ reader: fixtures("COMPLETE"), optimized: true }), "synthetic complete");
        equal(complete.status, 202, "actual Admin route accepts complete synthetic sync");
        equal(complete.body.result.status, "SUCCEEDED_COMPLETE", "complete lifecycle reaches terminal complete");
        let completeRun = await Run.findById(complete.body.result.runId).lean();
        equal(completeRun.trigger, "ADMIN_MANUAL", "actual route preserves manual trigger");
        equal(await Observation.countDocuments({ ingestionRunId: completeRun._id }), 2, "complete run stores both current observations");
        await assertWeeklyTerminal(completeRun._id, true);

        const partial = await routeRun(makeOrchestrator({ reader: fixtures("PARTIAL", { single: true }), optimized: true }), "synthetic partial");
        equal(partial.status, 202, "actual Admin route accepts usable partial sync");
        equal(partial.body.result.status, "SUCCEEDED_PARTIAL", "partial lifecycle reaches terminal partial");
        const partialRun = await Run.findById(partial.body.result.runId).lean();
        equal(await Observation.countDocuments({ ingestionRunId: partialRun._id }), 1, "partial run stores only individually observed offer");
        await assertWeeklyTerminal(partialRun._id, true);

        for (const mode of ["EMPTY", "FAILED"]) {
            const response = await routeRun(makeOrchestrator({ reader: fixtures(mode), optimized: true }), `synthetic ${mode.toLowerCase()}`);
            ok(response.status >= 400, `${mode} route request fails closed`);
            const failed = await Run.findOne({ reason: `synthetic ${mode.toLowerCase()}` }).lean();
            equal(failed.status, "FAILED", `${mode} lifecycle persists FAILED terminal state`);
            equal(await Observation.countDocuments({ ingestionRunId: failed._id }), 0, `${mode} lifecycle publishes no observations`);
            await assertWeeklyTerminal(failed._id, false);
        }

        const retryReader = fixtures("RETRIED");
        const retried = await routeRun(makeOrchestrator({ reader: retryReader, optimized: true }), "synthetic retried");
        equal(retried.status, 202, "retrying manual route succeeds");
        equal(retried.body.result.attempts, 2, "retry lifecycle records two attempts");
        equal(retryReader.calls(), 2, "synthetic supplier read was retried exactly once");

        const beforeProducts = await Product.countDocuments({}), beforeOffers = await Offer.countDocuments({}), beforeAvailability = await Availability.countDocuments({}), beforeObservations = await Observation.countDocuments({});
        const corrupt = await routeRun(makeOrchestrator({ reader: fixtures("COMPLETE", { changed: true, revision: "fixture-corrupt" }), optimized: true, fault: "CORRUPT_AFTER_WRITE" }), "synthetic post-persistence validation failure");
        ok(corrupt.status >= 400, "post-persistence validation failure reaches route error response");
        const corruptRun = await Run.findOne({ reason: "synthetic post-persistence validation failure" }).lean();
        equal(corruptRun.status, "FAILED", "post-persistence validation failure marks run failed");
        equal(await Product.countDocuments({}), beforeProducts, "catalog product upserts remain persisted after validation failure");
        equal(await Offer.countDocuments({}), beforeOffers, "catalog offer upserts remain persisted after validation failure");
        equal(await Availability.countDocuments({}), beforeAvailability, "availability upserts remain persisted after validation failure");
        const persistedCorruptOffer = await Offer.findOne({ supplierOfferCode: "offer-a" }).lean();
        const persistedCorruptAvailability = await Availability.findOne({ supplierCatalogOfferId: persistedCorruptOffer._id }).lean();
        equal(persistedCorruptOffer.supplierCost.amount, 1.5, "failed run leaves its catalog offer update persisted");
        equal(String(persistedCorruptAvailability.observationRunId), String(corruptRun._id), "failed run leaves its availability write associated with that failed run");
        equal(await Observation.countDocuments({}), beforeObservations, "validation failure publishes no new observation");
        await assertWeeklyTerminal(corruptRun._id, false);

        const telemetry = { observed: 2, excluded: 0, attempted: 0, inserted: 0, matched: 0, failed: 0 };
        const partialBulk = await routeRun(makeOrchestrator({ reader: fixtures("COMPLETE", { revision: "fixture-partial-bulk" }), optimized: true, fault: "PARTIAL_OBSERVATION_BULK", telemetry }), "synthetic partial observation bulk");
        ok(partialBulk.status >= 400, "partial unordered observation bulk fails the run");
        const bulkFailedRun = await Run.findOne({ reason: "synthetic partial observation bulk" }).lean();
        equal(bulkFailedRun.status, "FAILED", "partial unordered bulk leaves FAILED run");
        equal(await Observation.countDocuments({ ingestionRunId: bulkFailedRun._id }), 1, "one unordered upsert is durably accepted before injected failure");
        await assertWeeklyTerminal(bulkFailedRun._id, false);

        const failedRunOffer = await Offer.findOne({ supplierOfferCode: "offer-a" }).lean();
        const fixedPlan = fazer.planMutations(await fazer.stageCatalog({ reader: fixtures("COMPLETE", { revision: "fixture-fixed-replay" }), supplierId: failedRunOffer.supplierId, mappings: [], observedAt: new Date("2026-10-20T02:00:00.000Z") }), { products: await Product.find({}).lean(), offers: await Offer.find({}).lean() });
        const replayRun = await Run.create({ supplierId: failedRunOffer.supplierId, catalogNamespace: NAMESPACE, runKey: "synthetic-fixed-replay", status: "RUNNING", coverageState: "UNKNOWN", startedAt: fixedPlan.observedAt });
        const replayTelemetry = { observed: fixedPlan.offers.length, excluded: 0, attempted: 0, inserted: 0, matched: 0, failed: 0 };
        const failingRepo = createSupplierCatalogMongoRepositories({ Product, Offer, Availability, Run, Observation: observationFacadePartialOnce(replayTelemetry) }, { evidencePolicy: policy(true) });
        const failedEvents = [];
        await assert.rejects(() => failingRepo.bulk.applyCatalogPlan(fixedPlan, { ingestionRunId: replayRun._id, onProgress: event => failedEvents.push(event) }), /synthetic unordered/); checks += 1;
        const failedCounterEvent = failedEvents.find(event => event.phase === "APPLY_OBSERVATION_TELEMETRY");
        equal(failedCounterEvent.insertedRows, 1, "structured telemetry reports acknowledged prefix insert");
        equal(failedCounterEvent.failedWrites, 1, "structured telemetry reports failed remainder");
        const normalRepo = createSupplierCatalogMongoRepositories({ Product, Offer, Availability, Run, Observation }, { evidencePolicy: policy(true) });
        const beforeReplay = await Observation.countDocuments({ ingestionRunId: replayRun._id });
        const convergedEvents = [];
        const converged = await normalRepo.bulk.applyCatalogPlan(fixedPlan, { ingestionRunId: replayRun._id, onProgress: event => convergedEvents.push(event) });
        const afterReplay = await Observation.countDocuments({ ingestionRunId: replayRun._id });
        equal(beforeReplay, 1, "fixed-run replay begins from a partially accepted unordered bulk");
        equal(afterReplay, fixedPlan.offers.length, "fixed-run retry converges to exact observation membership");
        equal(converged.observations, fixedPlan.offers.length, "retry attempts the complete deterministic observation set");
        const convergedCounterEvent = convergedEvents.find(event => event.phase === "APPLY_OBSERVATION_TELEMETRY");
        equal(convergedCounterEvent.insertedRows, 1, "retry telemetry reports one inserted row");
        equal(convergedCounterEvent.hashMatchedRows, 1, "retry telemetry reports one hash match");
        await normalRepo.bulk.applyCatalogPlan(fixedPlan, { ingestionRunId: replayRun._id, onProgress: () => { throw new Error("synthetic logger failure"); } });
        equal(await Observation.countDocuments({ ingestionRunId: replayRun._id }), 2, "telemetry callback failure cannot affect evidence correctness");

        const onHistory = await Observation.countDocuments({});
        const onExactRows = await Observation.countDocuments({ ingestionRunId: completeRun._id });
        const offResponse = await routeRun(makeOrchestrator({ reader: fixtures("COMPLETE", { single: true, revision: "fixture-after-restart" }), optimized: false }), "synthetic flag off after restart");
        equal(offResponse.status, 202, "new application instance with flag OFF completes manual sync");
        ok(await Observation.countDocuments({}) >= onHistory, "flag-off restart never removes optimized history");
        equal(await Observation.countDocuments({ ingestionRunId: completeRun._id }), onExactRows, "exact-run optimized evidence remains intact after rollback");
        await assertWeeklyTerminal(completeRun._id, true);

        equal(policy(false).v2WriteEnabled, false, "default intended configuration keeps V2 writes disabled");
        equal(policy(false).v2ReadEnabled, false, "default intended configuration keeps V2 reads disabled");
        equal(policy(false).legacyWriteEnabled, true, "default intended configuration keeps legacy writes enabled");
        equal(policy(true).currentRunLegacyObservationsEnabled, true, "optimization ON remains independent of V2 activation");
        ok(telemetry.attempted === 2 && telemetry.inserted === 1 && telemetry.failed === 1, "fault counters distinguish attempted, inserted, and failed operations");
        ok(replayTelemetry.attempted === 2 && replayTelemetry.inserted === 1 && replayTelemetry.failed === 1, "fixed-run partial-bulk counters are deterministic");

        console.log(JSON.stringify({
            result: "PASS", checks,
            environment: { mongodb: "mongodb-memory-server", host: parsed.hostname, database: DB_NAME, productionConnections: 0, supplierCalls: 0 },
            routeLifecycles: { complete: "PASS", partial: "PASS", empty: "PASS", failed: "PASS", retried: "PASS" },
            failureInjection: { postCatalogAvailabilityValidation: "PASS", partialUnorderedObservationBulk: "PASS", fixedRunRetryConvergence: "PASS" },
            rollback: { optimizationOn: "PASS", applicationInstanceRestart: "PASS", optimizationOff: "PASS", historicalEvidenceIntact: "PASS" },
            counters: { injectedFailedBulk: telemetry, fixedRunReplay: replayTelemetry, structuredRepositoryTelemetry: "PASS", loggerFailureIsolation: "PASS" }
        }, null, 2));
    } finally {
        await mongoose.disconnect().catch(() => {});
        await server.stop().catch(() => {});
    }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
