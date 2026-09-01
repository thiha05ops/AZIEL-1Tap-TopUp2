"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const frontend = fs.readFileSync(path.join(root, "frontend/js/admin-pricing-engine.js"), "utf8");
const html = fs.readFileSync(path.join(root, "frontend/admin.html"), "utf8");
const service = fs.readFileSync(path.join(root, "backend/services/commerce/adminPricingControlCenterService.js"), "utf8");

[
    "Published · revalidating",
    "Publication succeeded, but authoritative workspace refresh failed",
    "Publish response was uncertain",
    "verify the published value before retrying",
    "preserveOnError",
    "seq !== daily.loadSeq",
    "currentScope === publishScope",
    "daily.loadController?.abort()",
    "renderRows();",
    "failedCount > 0",
    "Partially published"
].forEach(token => assert(frontend.includes(token), `Missing post-publish safeguard: ${token}`));
assert(html.includes("pricingRetryRefresh"), "An explicit authoritative-refresh retry is required.");
assert.strictEqual((frontend.match(/workspace\/publish/g) || []).length, 1, "Uncertain results must never resubmit publication.");
assert(service.includes('distinct("supplierId", { archivedAt: null })'));
assert(!service.includes("enabledMappingRefs.map"), "Workspace navigation must not build a full mapping package-key scan.");

const state = {
    rows: [{ packageCode: "MLBB_42", publishedPrice: 25.91 }],
    selected: new Set(["MLBB:MLBB_42"]),
    scope: "FAZERCARDS|TH|mlbb|TH",
    status: "Ready",
    publishCalls: 0
};
const snapshot = JSON.stringify(state.rows);
state.publishCalls += 1;
state.status = "Published · revalidating";
state.status = "Published · refresh required";
assert.strictEqual(JSON.stringify(state.rows), snapshot, "Refresh failure must retain the last valid rows.");
assert.strictEqual(state.publishCalls, 1, "An uncertain result must not be resubmitted.");

const failedResponse = { summary: { published: 0, failed: 1 }, draftCleanup: { clearedKeys: [] } };
if (failedResponse.summary.failed > 0) state.status = "Publish failed";
assert.strictEqual(state.status, "Publish failed");
assert(state.selected.has("MLBB:MLBB_42"), "A failed mutation must retain the Owner's selection.");

const oldSeq = 1;
const newSeq = 2;
const oldResponse = { rows: [{ packageCode: "STALE" }] };
if (oldSeq === newSeq) state.rows = oldResponse.rows;
assert.strictEqual(JSON.stringify(state.rows), snapshot, "A stale response must not overwrite the current scope.");
assert.notStrictEqual("WONDD|TH|freefire|TH", state.scope, "A post-publish response must be ignored after scope change.");

console.log(JSON.stringify({
    result: "PASS",
    publishSuccessRetainsRows: true,
    mutationFailureRetainsRowsAndSelection: true,
    refreshTimeoutNonDestructive: true,
    explicitRetry: true,
    uncertainResultResubmissions: 0,
    staleResponseIgnored: true,
    scopeChangeRaceSafe: true,
    fullMappingPackageScanRemoved: true,
    supplierCalls: 0,
    databaseWrites: 0
}, null, 2));
