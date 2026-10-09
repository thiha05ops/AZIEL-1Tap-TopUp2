#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Selection = require("../models/PackageSupplierSelection");
const { EXPECTED, classifyIndex, definition, inspectDuplicates, inspectIndexes } = require("./verify-package-supplier-selection-production-index");

const APPLY = process.argv.includes("--apply");
const GUARD = "AZIEL_ALLOW_PRODUCTION_PACKAGE_SUPPLIER_SELECTION_INDEX_DEPLOY";

async function run() {
    mongoose.set("autoIndex", false);
    mongoose.set("autoCreate", false);
    assert(process.env.MONGO_URI, "MONGO_URI is required.");
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000) });
    const before = await inspectIndexes();
    const duplicates = await inspectDuplicates();
    const status = classifyIndex(before);
    const intendedOperation = status === "INDEX_MISSING" ? { operation: "CREATE_INDEX", collection: Selection.collection.name, ...EXPECTED } : { operation: "NONE", reason: status };
    console.log(JSON.stringify({ mode: APPLY ? "APPLY_REQUESTED" : "DRY_RUN", intendedOperation, duplicateCount: duplicates.length }, null, 2));
    assert.notStrictEqual(status, "INDEX_WRONG_DEFINITION", "Conflicting index definition requires manual review; no index was changed.");
    assert.strictEqual(duplicates.length, 0, "Duplicate selection authorities exist; refusing index deployment.");
    if (APPLY && status === "INDEX_MISSING") {
        assert.strictEqual(process.env[GUARD], "true", `--apply requires ${GUARD}=true`);
        await Selection.collection.createIndex(EXPECTED.key, { name: EXPECTED.name, unique: true });
    }
    const after = await inspectIndexes();
    const finalStatus = classifyIndex(after);
    if (APPLY) assert.strictEqual(finalStatus, "INDEX_PRESENT", "Approved selection index was not verified after creation.");
    console.log(JSON.stringify({ result: "PASS", mode: APPLY ? "APPLY" : "DRY_RUN", guard: { name: GUARD, authorized: APPLY && process.env[GUARD] === "true" }, beforeStatus: status, afterStatus: finalStatus, existingIndexes: after.map(definition), unrelatedIndexesDropped: 0, businessDataWrites: 0, metadataWrites: APPLY && status === "INDEX_MISSING" ? 1 : 0 }, null, 2));
}

if (require.main === module) run().catch(error => {
    console.error(JSON.stringify({ result: "ABORTED", mode: APPLY ? "APPLY" : "DRY_RUN", code: error.code || error.name, message: error.message }, null, 2));
    process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => null));

module.exports = { APPLY, GUARD, run };
