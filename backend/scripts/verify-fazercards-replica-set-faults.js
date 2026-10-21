#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { assertIsolatedMongoUri } = require("./lib/assertIsolatedMongoUri");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Run = require("../models/SupplierCatalogIngestionRun");
const Observation = require("../models/SupplierCatalogCostObservation");
const fazer = require("../services/supplierCatalog/providers/fazerCardsCatalogIngestionService");
const { readSupplierCostEvidencePolicy } = require("../config/supplierCostEvidencePolicy");
const { createSupplierCatalogMongoRepositories } = require("../services/supplierCatalog/supplierCatalogMongoRepositories");

const DB_NAME = "aziel_fazercards_replset_isolated";
const supplierId = new mongoose.Types.ObjectId();
let checks = 0;
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const ok = (value, message) => { assert(value, message); checks += 1; };
const reader = revision => ({
    listCategories: async () => ({ items: [{ category_id: "game-a", name: "Synthetic Game", note: "Region: GLOBAL" }], meta: { next_cursor: "" } }),
    listOffers: async () => ({ offers: [{ offer_id: "offer-a", name: "100 Diamonds", price_usd: 1 }, { offer_id: "offer-b", name: "200 Diamonds", price_usd: 2 }], fields: [], meta: { revision } })
});

async function plan(at, revision) {
    const stage = await fazer.stageCatalog({ reader: reader(revision), supplierId, mappings: [], observedAt: at });
    return fazer.planMutations(stage, { products: await Product.find({ supplierId }).lean(), offers: await Offer.find({ supplierId }).lean() });
}

function repositories(ObservationModel = Observation) {
    return createSupplierCatalogMongoRepositories({ Product, Offer, Availability, Run, Observation: ObservationModel }, { evidencePolicy: readSupplierCostEvidencePolicy({ SUPPLIER_COST_OBSERVATION_CURRENT_RUN_ONLY_ENABLED: "true" }) });
}

async function apply(inputPlan, runId, ObservationModel = Observation) {
    return repositories(ObservationModel).bulk.applyCatalogPlan(inputPlan, { ingestionRunId: runId });
}

async function main() {
    let replSet;
    const outcomes = { replicaSetStart: "NOT_TESTED", majorityWriteConcern: "NOT_TESTED", interruption: "NOT_TESTED", primaryStepdown: "NOT_TESTED", reconnect: "NOT_TESTED", retryConsistency: "NOT_TESTED" };
    try {
        replSet = await MongoMemoryReplSet.create({ replSet: { count: 3, storageEngine: "wiredTiger", ip: "127.0.0.1" } });
        outcomes.replicaSetStart = "PASS";
        const uri = replSet.getUri(DB_NAME);
        equal(assertIsolatedMongoUri(uri, "aziel_fazercards_replset_").database, DB_NAME, "replica-set URI is loopback-only and disposable");
        await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 15000, writeConcern: { w: "majority", wtimeoutMS: 10000 } });
        await Promise.all([Product, Offer, Availability, Run, Observation].map(model => model.syncIndexes()));

        const firstRun = new mongoose.Types.ObjectId(), firstPlan = await plan(new Date("2026-10-20T05:00:00.000Z"), "repl-r1");
        const first = await apply(firstPlan, firstRun);
        equal(first.observationTelemetry.insertedRows, 2, "majority-configured write acknowledges two inserted observations");
        equal(await Observation.countDocuments({ ingestionRunId: firstRun }), 2, "majority-configured evidence is readable");
        outcomes.majorityWriteConcern = "PASS";

        const interruptedRun = new mongoose.Types.ObjectId(), interruptedPlan = await plan(new Date("2026-10-20T05:01:00.000Z"), "repl-r2");
        let firstBatch = true;
        const interruptedObservation = {
            async bulkWrite(operations, options) {
                if (firstBatch) {
                    firstBatch = false;
                    const result = await Observation.bulkWrite([operations[0]], options);
                    throw Object.assign(new Error("synthetic connection interruption after acknowledged prefix"), { code: "SYNTHETIC_CONNECTION_INTERRUPTION", result });
                }
                return Observation.bulkWrite(operations, options);
            }
        };
        await assert.rejects(() => apply(interruptedPlan, interruptedRun, interruptedObservation), /synthetic connection interruption/); checks += 1;
        equal(await Observation.countDocuments({ ingestionRunId: interruptedRun }), 1, "interruption leaves one acknowledged prefix row");
        outcomes.interruption = "PASS";
        const retried = await apply(interruptedPlan, interruptedRun);
        equal(await Observation.countDocuments({ ingestionRunId: interruptedRun }), 2, "retry converges interrupted run to exact evidence set");
        equal(retried.observationTelemetry.insertedRows, 1, "retry inserts only missing row");
        equal(retried.observationTelemetry.hashMatchedRows, 1, "retry hash-matches acknowledged prefix row");
        outcomes.retryConsistency = "PASS";

        try {
            await mongoose.connection.db.admin().command({ replSetStepDown: 2, force: true });
        } catch (error) {
            if (!/not primary|node is recovering|network|closed|interrupted/i.test(String(error?.message || error))) throw error;
        }
        outcomes.primaryStepdown = "PASS";
        await mongoose.disconnect();
        await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 20000, writeConcern: { w: "majority", wtimeoutMS: 10000 } });
        outcomes.reconnect = "PASS";
        const postRun = new mongoose.Types.ObjectId(), postPlan = await plan(new Date("2026-10-20T05:02:00.000Z"), "repl-r3");
        await apply(postPlan, postRun);
        equal(await Observation.countDocuments({ ingestionRunId: postRun }), 2, "post-stepdown reconnect writes consistent exact-run evidence");
        ok(await Observation.countDocuments({ ingestionRunId: interruptedRun }) === 2, "stepdown preserves converged evidence");

        console.log(JSON.stringify({ result: "PASS", checks, database: DB_NAME, hosts: 3, outcomes, productionConnections: 0, supplierCalls: 0 }, null, 2));
    } catch (error) {
        if (outcomes.replicaSetStart === "NOT_TESTED") {
            console.log(JSON.stringify({ result: "NOT_TESTED", checks, database: DB_NAME, outcomes, limitation: String(error?.code || error?.name || "REPLICA_SET_UNAVAILABLE"), productionConnections: 0, supplierCalls: 0 }, null, 2));
            return;
        }
        throw error;
    } finally {
        await mongoose.disconnect().catch(() => {});
        await replSet?.stop().catch(() => {});
    }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
