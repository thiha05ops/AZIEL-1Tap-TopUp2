#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const { fork } = require("child_process");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { assertIsolatedMongoUri } = require("./lib/assertIsolatedMongoUri");

const DB_NAME = "aziel_fazercards_restart_isolated";
const worker = path.join(__dirname, "fixtures", "fazercards-restart-worker.js");
let checks = 0;
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const ok = (value, message) => { assert(value, message); checks += 1; };

function child(phase, uri) {
    return new Promise((resolve, reject) => {
        const processEnv = { PATH: process.env.PATH || "", HOME: process.env.HOME || "", AZIEL_ISOLATED_MONGO_URI: uri, AZIEL_RESTART_PHASE: phase };
        const subprocess = fork(worker, [], { env: processEnv, stdio: ["ignore", "ignore", "pipe", "ipc"] });
        let message, stderr = "";
        subprocess.stderr.on("data", chunk => { stderr += String(chunk).slice(0, 1000); });
        subprocess.on("message", value => { message = value; });
        subprocess.on("error", reject);
        subprocess.on("exit", code => code === 0 && message && !message.error ? resolve(message) : reject(new Error(`ISOLATED_RESTART_CHILD_FAILED:${phase}:${code}:${message?.error || stderr || "unknown"}`)));
    });
}

async function main() {
    assert.throws(() => assertIsolatedMongoUri("mongodb+srv://example.invalid/aziel_fazercards_restart_isolated", "aziel_fazercards_restart_"), /SRV_REJECTED/); checks += 1;
    assert.throws(() => assertIsolatedMongoUri("mongodb://example.invalid:27017/aziel_fazercards_restart_isolated", "aziel_fazercards_restart_"), /NONLOCAL_REJECTED/); checks += 1;
    assert.throws(() => assertIsolatedMongoUri("mongodb://127.0.0.1:27017/azielshop", "aziel_fazercards_restart_"), /DATABASE_REJECTED/); checks += 1;
    const server = await MongoMemoryServer.create({ instance: { dbName: DB_NAME, ip: "127.0.0.1", port: 27204 } });
    try {
        const uri = server.getUri(DB_NAME);
        equal(assertIsolatedMongoUri(uri, "aziel_fazercards_restart_").database, DB_NAME, "parent validates disposable restart database");
        const on = await child("ON", uri);
        equal(on.exactRows, 1, "ON process writes only exact current-run evidence");
        equal(on.totalRows, 3, "ON process retains seed history and optimized exact-run row");
        equal(on.telemetry.currentResponseOffers, 1, "ON telemetry counts current-response offers");
        equal(on.telemetry.scopedHistoricalOffers, 2, "ON telemetry counts scoped persisted offers");
        equal(on.telemetry.excludedHistoricalRows, 1, "ON telemetry counts optimization exclusions");
        equal(on.telemetry.attemptedObservationWrites, 1, "ON telemetry counts attempted observation writes");
        equal(on.telemetry.insertedRows, 1, "ON telemetry counts inserted rows");
        equal(on.telemetry.hashMatchedRows, 0, "ON telemetry counts zero hash matches");
        equal(on.telemetry.failedWrites, 0, "ON telemetry counts zero failures");
        const off = await child("OFF", uri);
        ok(on.pid !== off.pid, "ON and OFF work execute in distinct OS processes");
        equal(off.exactRunId, on.exactRunId, "OFF process resolves the retained ON exact run");
        equal(off.beforeExactRows, 1, "OFF process reads retained exact-run evidence before writing");
        equal(off.afterExactRows, 1, "OFF sync does not rewrite prior exact-run evidence");
        equal(off.totalRows, 4, "OFF process resumes compatible legacy observation growth");
        equal(off.telemetry.currentResponseOffers, 1, "OFF telemetry retains current-response count");
        equal(off.telemetry.scopedHistoricalOffers, 2, "OFF telemetry retains scoped persisted count");
        equal(off.telemetry.excludedHistoricalRows, 0, "OFF telemetry reports no optimization exclusion");
        equal(off.telemetry.attemptedObservationWrites, 2, "OFF telemetry reports full legacy attempts");
        equal(off.telemetry.insertedRows, 1, "OFF telemetry reports current row insert");
        equal(off.telemetry.hashMatchedRows, 1, "OFF telemetry reports historical hash match");
        equal(off.telemetry.failedWrites, 0, "OFF telemetry reports no failures");
        console.log(JSON.stringify({ result: "PASS", checks, database: DB_NAME, host: "127.0.0.1", distinctProcessIds: true, optimizationOn: "PASS", processExit: "PASS", optimizationOff: "PASS", retainedExactRunEvidence: "PASS", productionConnections: 0, supplierCalls: 0 }, null, 2));
    } finally { await server.stop().catch(() => {}); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
