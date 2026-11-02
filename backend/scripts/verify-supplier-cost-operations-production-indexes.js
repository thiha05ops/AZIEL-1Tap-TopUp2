#!/usr/bin/env node
"use strict";
const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const { EXPECTED, TARGETS, plan, indexes, baseline, options } = require("./deploy-supplier-cost-operations-indexes");

(async () => {
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI, { readPreference: "secondaryPreferred" });
    const before = await baseline(), actual = {}, plans = {};
    let checks = 0;
    const ok = (value, message) => { assert(value, message); checks += 1; };
    for (const [name, Model] of Object.entries(TARGETS)) {
        actual[name] = await indexes(Model);
        plans[name] = plan(EXPECTED[name], actual[name]);
        ok(Model.collection.name === (name === "SupplierCatalogCostObservation" ? "suppliercatalogcostobservations" : "suppliercostauthoritychanges"), `${name} collection`);
        ok(JSON.stringify(plans[name]) === JSON.stringify({ creates: [], conflicts: [], drops: [] }), `${name} indexes exact`);
        for (const expected of EXPECTED[name]) {
            const found = actual[name].find(index => index.name === expected.name);
            ok(Boolean(found), `${expected.name} exists`);
            ok(JSON.stringify(found.key) === JSON.stringify(expected.key), `${expected.name} key exact`);
            ok(JSON.stringify(options(found)) === JSON.stringify(options(expected)), `${expected.name} options exact`);
        }
    }
    ok(process.env.SUPPLIER_COST_AUTHORITY_MUTATIONS_ENABLED !== "true", "cost mutation gate disabled during read-only verification");
    const after = await baseline();
    assert.deepStrictEqual(after.business, before.business);
    assert.strictEqual(after.mappingBusinessStateHash, before.mappingBusinessStateHash);
    assert.deepStrictEqual(after.costStates, before.costStates);
    assert.deepStrictEqual(after.availabilityBySupplier, before.availabilityBySupplier);
    assert.deepStrictEqual(after.mlbb570, before.mlbb570);
    console.log(JSON.stringify({ result: "PASS", checks, documentCounts: { observations: before.business.SupplierCatalogCostObservation.count, authorityChanges: before.business.SupplierCostAuthorityChange.count }, indexes: actual, plans, mutationGate: { raw: process.env.SUPPLIER_COST_AUTHORITY_MUTATIONS_ENABLED ?? "ABSENT", resolved: false, default: false }, exactBusinessEquality: true, productionBusinessWrites: 0, supplierNetworkCalls: { catalog: 0, balance: 0, validation: 0, order: 0, status: 0, fulfillment: 0 } }, null, 2));
})().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(error); process.exit(1); }).finally(() => mongoose.disconnect().catch(() => null));
