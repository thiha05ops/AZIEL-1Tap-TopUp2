"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const audit = read("backend/scripts/audit-package-supplier-cutover-readiness.js");
const indexVerifier = read("backend/scripts/verify-package-supplier-selection-production-index.js");
const deploy = read("backend/scripts/deploy-package-supplier-selection-index.js");
const model = read("backend/models/PackageSupplierSelection.js");
const adminVerifier = read("backend/scripts/verify-admin-catalog-control.js");
const auditModule = require("./audit-package-supplier-cutover-readiness");

assert(audit.includes('const READ_ONLY = true') && audit.includes('mongoose.set("autoIndex", false)'));
assert(audit.includes('toPublicCatalog({ includeDisabled: false, customerMarket })'), "coverage must reuse the customer catalog authority");
assert(audit.includes("AZIEL_CUTOVER_AUDIT_STAGE_TIMEOUT_MS") && audit.includes("CUTOVER_AUDIT_STAGE_TIMEOUT"));
assert(audit.includes("installExternalNetworkGuard") && audit.includes("READ_ONLY_AUDIT_EXTERNAL_NETWORK_BLOCKED"));
assert(audit.indexOf('logger("[1/11] Starting read-only cutover audit")') < audit.indexOf("mongoose.connect(process.env.MONGO_URI"), "progress must be emitted before MongoDB connection");
assert(!audit.includes("if (!publicState.currentlyPurchasable) continue"), "raw package projection must not define storefront eligibility");
assert(audit.includes("auditRawCounts") && audit.includes("SNAPSHOT_MAPPING_ID_ABSENT_LEGACY") && audit.includes("SNAPSHOT_MAPPING_REFERENCE_MISSING"));
assert(audit.includes("commercialOnlyBlockersExcludedFromFrozenExecution") && audit.includes("frozenExecutionBlockers"));
for (const token of ["insertOne(", "insertMany(", "updateOne(", "updateMany(", "deleteOne(", "deleteMany(", "findOneAndUpdate(", "bulkWrite(", "createIndex(", "syncIndexes(", "dropIndex("]) {
    assert(!audit.includes(`.${token}`), `read-only audit must not contain ${token}`);
}
assert(indexVerifier.includes('readPreference: "secondaryPreferred"') && !indexVerifier.includes("createIndex("));
assert(deploy.includes('const GUARD = "AZIEL_ALLOW_PRODUCTION_PACKAGE_SUPPLIER_SELECTION_INDEX_DEPLOY"'));
assert(deploy.includes("Duplicate selection authorities exist; refusing index deployment."));
assert(deploy.includes("unrelatedIndexesDropped: 0") && !deploy.includes("dropIndex("));
assert(model.includes('autoIndex: process.env.NODE_ENV !== "production"'));
assert(model.includes('autoCreate: process.env.NODE_ENV !== "production"'));
assert(adminVerifier.indexOf("await mongoose.connect(safety.mongoUri") < adminVerifier.indexOf("await assertCanonicalAdminProjection();"));

(async () => {
    const fixtureLog = [];
    const fixtureMarkets = [];
    let fixtureConnected = false;
    let fixtureDisconnected = false;
    const fixtureReport = await auditModule.executeAuditStages({
        connect: async () => { fixtureConnected = true; },
        disconnect: async () => { fixtureDisconnected = true; },
        hello: async () => ({ setName: "fixture", logicalSessionTimeoutMinutes: 30 }),
        selectionIndex: async () => ({ status: "READY", duplicateCount: 0 }),
        rawCounts: async () => ({}),
        loadPublicCatalog: async market => [{ productCode: "fixture", packages: [{ packageCode: `${market}_1` }] }],
        publicMarket: async (market, catalog) => {
            fixtureMarkets.push(market);
            assert.strictEqual(catalog[0].packages[0].packageCode, `${market}_1`);
            return [{ productCode: "fixture", packageCode: `${market}_1`, customerMarket: market, selectionStatus: "SELECTED_READY", routeComparison: "MATCH", priceComparison: "PRICE_SUPPLIER_MATCH" }];
        },
        orders: async () => ({ counts: {} }),
        logger: line => fixtureLog.push(line),
        timeoutMs: 100,
        printReport: () => {}
    });
    assert(fixtureConnected && fixtureDisconnected, "fixture audit must connect and disconnect");
    assert.deepStrictEqual(fixtureMarkets, ["TH", "MM"], "TH/MM fixture coverage must complete");
    assert.strictEqual(fixtureReport.coverage.rows.length, 2);
    assert(fixtureLog[0].includes("Starting read-only cutover audit"), "first output must precede connection");
    assert(fixtureLog.some(line => line.includes("Building TH storefront projection complete")));
    assert(fixtureLog.some(line => line.includes("Auditing TH supplier and routing coverage complete")));
    assert(fixtureLog.some(line => line.includes("Building MM storefront projection complete")));
    assert(fixtureLog.some(line => line.includes("Auditing MM supplier and routing coverage complete")));

    let timeoutDisconnected = false;
    let timeoutError;
    try {
        await auditModule.executeAuditStages({
            connect: async () => {},
            disconnect: async () => { timeoutDisconnected = true; },
            hello: async () => ({}),
            selectionIndex: () => new Promise(() => {}),
            rawCounts: async () => ({}),
            loadPublicCatalog: async () => [],
            publicMarket: async () => [],
            orders: async () => ({}),
            logger: () => {},
            timeoutMs: 100,
            printReport: () => {}
        });
    } catch (error) {
        timeoutError = error;
    }
    assert.strictEqual(timeoutError?.code, "CUTOVER_AUDIT_STAGE_TIMEOUT");
    assert.strictEqual(timeoutError?.stage, "Inspecting selection index", "timeout must name the exact stage");
    assert(timeoutDisconnected, "timeout failure must disconnect MongoDB");

    const fakeGlobal = { fetch() {} };
    const fakeHttp = { request() {}, get() {} };
    const fakeHttps = { request() {}, get() {} };
    auditModule.installExternalNetworkGuard({ globalObject: fakeGlobal, httpModule: fakeHttp, httpsModule: fakeHttps });
    for (const request of [fakeGlobal.fetch, fakeHttp.request, fakeHttp.get, fakeHttps.request, fakeHttps.get]) {
        assert.throws(() => request(), error => error.code === "READ_ONLY_AUDIT_EXTERNAL_NETWORK_BLOCKED");
    }

    console.log("PASS read-only audit progress, exact stage timeout, disconnect cleanup, external-network guard, TH/MM fixtures, controlled index, production autoIndex, and isolated-bootstrap safety contracts");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
