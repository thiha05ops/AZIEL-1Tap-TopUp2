#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { ObjectId } = require("mongodb");
const migration = require("../services/globalSupplierSelectionMigrationService");

const oid = () => new ObjectId();
function fixture() {
    const mappingA = { _id: oid(), supplierId: oid(), supplierCode: "FAZERCARDS", productCode: "mlbb", packageCode: "A", supplierProductCode: "mobile_legends_global", supplierPackageCode: "a", enabled: true, productionRole: "PRIMARY", executionMode: "API", fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [] } };
    const mappingB = { ...mappingA, _id: oid(), packageCode: "B", supplierPackageCode: "b" };
    const packages = ["A", "B"].map(packageCode => ({ _id: oid(), productCode: "mlbb", packageCode, deletedAt: null }));
    const selections = [mappingA, mappingB].flatMap(mapping => ["TH", "MM"].map(customerMarket => ({ _id: oid(), productCode: "mlbb", packageCode: mapping.packageCode, customerMarket, supplierMappingId: mapping._id, decisionVersion: 1 })));
    return { packages, selections, mappings: [mappingA, mappingB] };
}

function isolatedStore(initial, { partialInsert = false } = {}) {
    const clone = value => JSON.parse(JSON.stringify(value));
    let state = clone(initial);
    return {
        snapshot: () => clone(state),
        async loadState() { return clone(state); },
        async insertGlobals(documents) { const rows = partialInsert ? documents.slice(0, 1) : documents; state.selections.push(...clone(rows).map(row => ({ ...row, _id: String(oid()) }))); return rows.length; },
        async deleteMigrationGlobals(target) { const before = state.selections.length; const mark = `migration:${target.migrationId};plan:${target.planHash}`; state.selections = state.selections.filter(row => !(row.customerMarket === "GLOBAL" && row.reason === mark)); return before - state.selections.length; },
        async withTransaction(callback) { const before = clone(state); try { return await callback({ isolated: true }); } catch (error) { state = before; throw error; } }
    };
}

(async () => {
    let checks = 0; const base = fixture();
    const plan = migration.buildPlan({ ...base, migrationId: "global-test-20261011", generatedAt: "2026-10-11T00:00:00.000Z" });
    assert.strictEqual(plan.records.length, 2); assert.strictEqual(plan.conflicts.length, 0); checks += 2;
    const store = isolatedStore(base);
    const applied = await migration.applyPlan(store, plan, { now: new Date("2026-10-11T00:01:00.000Z") });
    assert.deepStrictEqual(applied, { insertedCount: 2, verifiedGlobalCount: 2, idempotentReplay: false }); checks++;
    const replay = await migration.applyPlan(store, plan);
    assert.strictEqual(replay.idempotentReplay, true); assert.strictEqual(replay.insertedCount, 0); checks += 2;
    const rolledBack = await migration.rollbackPlan(store, plan);
    assert.strictEqual(rolledBack.deletedCount, 2); assert.strictEqual(store.snapshot().selections.filter(row => row.customerMarket === "GLOBAL").length, 0); assert.strictEqual(store.snapshot().selections.length, 4); checks += 3;
    const changed = fixture(); changed.selections.find(row => row.customerMarket === "TH").decisionVersion = 2;
    await assert.rejects(() => migration.applyPlan(isolatedStore(changed), plan), error => error.code === "PRECONDITION_CHANGED"); checks++;
    const partial = isolatedStore(base, { partialInsert: true });
    await assert.rejects(() => migration.applyPlan(partial, plan), error => error.code === "PARTIAL_INSERT"); assert.strictEqual(partial.snapshot().selections.length, 4); checks += 2;
    const guarded = isolatedStore(base); await migration.applyPlan(guarded, plan); guarded.snapshot;
    const tampered = guarded.snapshot(); tampered.selections.find(row => row.customerMarket === "GLOBAL").decisionVersion = 2;
    await assert.rejects(() => migration.rollbackPlan(isolatedStore(tampered), plan), error => error.code === "ROLLBACK_TARGET_MISMATCH"); checks++;
    const conflict = fixture(); conflict.selections.find(row => row.customerMarket === "MM").supplierMappingId = conflict.mappings[1]._id;
    const conflictPlan = migration.buildPlan({ ...conflict, migrationId: "global-conflict-20261011" });
    assert.strictEqual(conflictPlan.records.length, 1); assert.strictEqual(conflictPlan.conflicts.length, 1); checks += 2;
    console.log(JSON.stringify({ result: "PASS", checks, isolatedDatabaseAdapter: true, apply: "PASS", idempotentReplay: "PASS", stalePrecondition: "PASS", partialFailureRollback: "PASS", targetedRollback: "PASS", unsafeRollbackRefusal: "PASS", productionConnections: 0, supplierCalls: 0 }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
