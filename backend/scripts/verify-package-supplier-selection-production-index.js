#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Selection = require("../models/PackageSupplierSelection");

const EXPECTED = Object.freeze({
    name: "one_package_supplier_selection_per_customer_market",
    key: Object.freeze({ productCode: 1, packageCode: 1, customerMarket: 1 }),
    unique: true
});

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const definition = index => ({ name: index.name, key: index.key, unique: index.unique === true });

async function collectionExists() {
    return (await mongoose.connection.db.listCollections({ name: Selection.collection.name }, { nameOnly: true }).toArray()).length === 1;
}

async function inspectIndexes() {
    return await collectionExists() ? Selection.collection.indexes() : [];
}

async function inspectDuplicates() {
    if (!await collectionExists()) return [];
    return Selection.aggregate([
        { $group: { _id: { productCode: "$productCode", packageCode: "$packageCode", customerMarket: "$customerMarket" }, count: { $sum: 1 }, documentIds: { $push: "$_id" } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1, "_id.productCode": 1, "_id.packageCode": 1, "_id.customerMarket": 1 } }
    ]).option({ readPreference: "secondaryPreferred" });
}

function classifyIndex(indexes = []) {
    const named = indexes.find(index => index.name === EXPECTED.name);
    const keyed = indexes.find(index => same(index.key, EXPECTED.key));
    if (named && same(named.key, EXPECTED.key) && named.unique === true) return "INDEX_PRESENT";
    if (named || keyed) return "INDEX_WRONG_DEFINITION";
    return "INDEX_MISSING";
}

async function inspect() {
    const [indexes, duplicates] = await Promise.all([inspectIndexes(), inspectDuplicates()]);
    const status = classifyIndex(indexes);
    return {
        result: "PASS",
        mode: "READ_ONLY",
        collection: Selection.collection.name,
        collectionExists: await collectionExists(),
        expected: EXPECTED,
        status,
        deploymentRequired: status !== "INDEX_PRESENT",
        duplicateCount: duplicates.length,
        duplicates: duplicates.map(row => ({ ...row, documentIds: row.documentIds.map(String) })),
        existingIndexes: indexes.map(definition),
        writes: 0
    };
}

async function run() {
    mongoose.set("autoIndex", false);
    mongoose.set("autoCreate", false);
    assert(process.env.MONGO_URI, "MONGO_URI is required.");
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, readPreference: "secondaryPreferred", serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000) });
    console.log(JSON.stringify(await inspect(), null, 2));
}

if (require.main === module) run().catch(error => {
    console.error(JSON.stringify({ result: "FAILED", mode: "READ_ONLY", code: error.code || error.name, message: error.message }, null, 2));
    process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => null));

module.exports = { EXPECTED, classifyIndex, collectionExists, definition, inspect, inspectDuplicates, inspectIndexes, run };
