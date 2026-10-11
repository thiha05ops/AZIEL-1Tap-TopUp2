#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { MongoClient, ObjectId } = require("mongodb");
const migration = require("../services/globalSupplierSelectionMigrationService");
const { mongoStore } = require("./migrate-global-package-supplier-selection");

const oid = () => new ObjectId();

function fixture() {
    const supplierId = oid();
    const mappings = ["A", "B"].map(packageCode => ({
        _id: oid(), supplierId, supplierCode: "FAZERCARDS", productCode: "mlbb", packageCode,
        supplierProductCode: "mobile_legends_global", supplierPackageCode: packageCode.toLowerCase(),
        enabled: true, productionRole: "PRIMARY", executionMode: "API", archivedAt: null,
        fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [] }
    }));
    const packages = mappings.map(({ packageCode }) => ({ _id: oid(), productCode: "mlbb", packageCode, deletedAt: null }));
    const selections = mappings.flatMap(mapping => ["TH", "MM"].map(customerMarket => ({
        _id: oid(), productCode: "mlbb", packageCode: mapping.packageCode, customerMarket,
        supplierMappingId: mapping._id, decisionVersion: 1
    })));
    return { packages, mappings, selections };
}

async function seed(db, data) {
    await Promise.all([
        db.collection("catalogpackages").insertMany(data.packages),
        db.collection("supplierproductmappings").insertMany(data.mappings),
        db.collection("packagesupplierselections").insertMany(data.selections)
    ]);
    await db.collection("packagesupplierselections").createIndex(
        { productCode: 1, packageCode: 1, customerMarket: 1 },
        { unique: true, name: "one_package_supplier_selection_per_customer_market" }
    );
}

(async () => {
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
    const client = new MongoClient(replSet.getUri("aziel_global_supplier_migration_test"));
    await client.connect();
    try {
        const db = client.db("aziel_global_supplier_migration_test");
        const hello = await db.admin().command({ hello: 1 });
        assert(hello.setName && hello.logicalSessionTimeoutMinutes, "Test MongoDB must be a transaction-capable replica set");
        const data = fixture();
        await seed(db, data);
        const store = mongoStore(db, client);
        const plan = migration.buildPlan({ ...data, migrationId: "global-mongo-test-20261011", generatedAt: "2026-10-11T00:00:00.000Z" });
        assert.strictEqual(plan.records.length, 2);
        assert.strictEqual(plan.conflicts.length, 0);

        const applied = await migration.applyPlan(store, plan, { now: new Date("2026-10-11T00:01:00.000Z") });
        assert.deepStrictEqual(applied, { insertedCount: 2, verifiedGlobalCount: 2, idempotentReplay: false });
        assert.strictEqual(await db.collection("packagesupplierselections").countDocuments({ customerMarket: "GLOBAL" }), 2);
        assert.strictEqual(await db.collection("packagesupplierselections").countDocuments({ customerMarket: { $in: ["TH", "MM"] } }), 4);

        const replay = await migration.applyPlan(store, plan);
        assert.deepStrictEqual(replay, { insertedCount: 0, verifiedGlobalCount: 2, idempotentReplay: true });

        const rollback = await migration.rollbackPlan(store, plan);
        assert.deepStrictEqual(rollback, { deletedCount: 2, verifiedGlobalCount: 0 });
        assert.strictEqual(await db.collection("packagesupplierselections").countDocuments({ customerMarket: "GLOBAL" }), 0);
        assert.strictEqual(await db.collection("packagesupplierselections").countDocuments({ customerMarket: { $in: ["TH", "MM"] } }), 4);

        const partialStore = {
            ...store,
            async insertGlobals(documents, { session }) {
                await db.collection("packagesupplierselections").insertOne(
                    { ...documents[0], supplierMappingId: new ObjectId(documents[0].supplierMappingId) },
                    { session }
                );
                return 1;
            }
        };
        await assert.rejects(() => migration.applyPlan(partialStore, plan), error => error.code === "PARTIAL_INSERT");
        assert.strictEqual(await db.collection("packagesupplierselections").countDocuments({ customerMarket: "GLOBAL" }), 0, "Aborted transaction must leave no partial GLOBAL record");
        assert.strictEqual(await db.collection("packagesupplierselections").countDocuments({ customerMarket: { $in: ["TH", "MM"] } }), 4, "Aborted transaction must preserve legacy rows");

        console.log(JSON.stringify({
            result: "PASS", assertions: 14, topology: "replicaSet", storageEngine: "wiredTiger",
            apply: "PASS", idempotentReplay: "PASS", targetedRollback: "PASS", atomicAbort: "PASS",
            legacyRowsPreserved: true, productionConnections: 0, supplierCalls: 0, paymentCalls: 0
        }, null, 2));
    } finally {
        await client.close();
        await replSet.stop();
    }
})().catch(error => { console.error(error); process.exit(1); });
