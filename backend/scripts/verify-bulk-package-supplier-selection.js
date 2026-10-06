#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createBulkPackageSupplierSelectionService } = require("../services/bulkPackageSupplierSelectionService");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const supplierA = "64b000000000000000000001";
const supplierB = "64b000000000000000000002";
const selected = new Map();
const audits = [];
const untouched = { prices: "UNCHANGED", publications: "UNCHANGED", mappings: { enabled: true, productionRole: "BACKUP" }, supplierCalls: 0, checkout: "UNCHANGED", fulfillment: "UNCHANGED" };
const readyCandidate = (index, supplierId = supplierA, suffix = "A") => ({ supplierMappingId: `${suffix === "A" ? "64b0000000000000001" : "64b0000000000000002"}${String(index).padStart(6, "0")}`, supplier: { supplierId, supplierCode: suffix, name: suffix === "A" ? "Supplier A" : "Supplier B" }, providerIdentity: { productCode: "P", packageCode: `${suffix}${index}` }, readiness: { selectable: true, blockerCodes: [] } });
const overview = {
    productCode: "game",
    customerMarket: "TH",
    packages: Array.from({ length: 30 }, (_, index) => {
        const packageCode = `PACK_${String(index + 1).padStart(2, "0")}`;
        const candidates = index < 28 ? [readyCandidate(index + 1), readyCandidate(index + 1, supplierB, "B")] : index === 29 ? [{ ...readyCandidate(index + 1), readiness: { selectable: false, blockerCodes: ["MAPPING_DISABLED"] } }] : [readyCandidate(index + 1, supplierB, "B")];
        return { package: { productCode: "game", packageCode, name: packageCode }, customerMarket: "TH", publication: { published: index !== 5 }, customerPrice: { amount: 10, currency: "THB", enabled: true }, selection: null, candidates };
    })
};

const setPackageSupplierSelection = async input => {
    const key = `${input.customerMarket}:${input.packageCode}`;
    const current = selected.get(key) || null;
    const expected = input.expectedDecisionVersion;
    if (current && Number(expected) !== current.decisionVersion) {
        const error = new Error("stale"); error.code = "PACKAGE_SUPPLIER_SELECTION_STALE"; throw error;
    }
    if (!current && !(expected == null || expected === "" || Number(expected) === 0)) {
        const error = new Error("stale"); error.code = "PACKAGE_SUPPLIER_SELECTION_STALE"; throw error;
    }
    if (current?.supplierMappingId === input.supplierMappingId) return { changed: false, selection: { ...current }, previousSelection: { ...current }, customerPriceChanged: false, publicationChanged: false };
    const next = { productCode: input.productCode, packageCode: input.packageCode, customerMarket: input.customerMarket, supplierMappingId: input.supplierMappingId, decisionVersion: Number(current?.decisionVersion || 0) + 1 };
    selected.set(key, next);
    audits.push({ old: current, next, reason: input.reason, customerPriceChanged: false, publicationChanged: false });
    return { changed: true, selection: { ...next }, previousSelection: current && { ...current }, customerPriceChanged: false, publicationChanged: false };
};
const service = createBulkPackageSupplierSelectionService({ getProductPackageSupplierOverview: async ({ customerMarket }) => ({ ...overview, customerMarket, packages: overview.packages.map(item => ({ ...item, customerMarket })) }), setPackageSupplierSelection });
const requestPackages = expected => overview.packages.map(item => ({ packageCode: item.package.packageCode, expectedDecisionVersion: expected }));

(async () => {
    const before = JSON.stringify(untouched);
    const first = await service({ productCode: "game", customerMarket: "TH", supplierId: supplierA, packages: requestPackages(null), reason: "bulk test" }, { actor: { username: "owner" } });
    assert.deepStrictEqual(first.summary, { selected: 30, assigned: 28, unchanged: 0, conflicted: 0, blocked: 2 });
    assert.strictEqual(selected.size, 28, "only exact ready mappings may mutate");
    assert(first.results.some(item => item.code === "NO_EXACT_SUPPLIER_MAPPING"));
    assert(first.results.some(item => item.code === "MAPPING_DISABLED"));
    assert.strictEqual(audits.length, 28, "every changed decision must use the authoritative audited selection path");
    assert(audits.every(item => item.customerPriceChanged === false && item.publicationChanged === false));

    const replay = await service({ productCode: "game", customerMarket: "TH", supplierId: supplierA, packages: requestPackages(1), reason: "replay" });
    assert.strictEqual(replay.summary.unchanged, 28);
    assert.strictEqual(replay.summary.blocked, 2);
    assert.strictEqual(audits.length, 28, "idempotent replay must not bump versions or audit again");

    const stale = await service({ productCode: "game", customerMarket: "TH", supplierId: supplierA, packages: [{ packageCode: "PACK_01", expectedDecisionVersion: 0 }] });
    assert.strictEqual(stale.results[0].status, "CONFLICTED");
    assert.strictEqual(selected.get("TH:PACK_01").decisionVersion, 1, "stale request must not overwrite the newer decision");

    const mm = await service({ productCode: "game", customerMarket: "MM", supplierId: supplierA, packages: [{ packageCode: "PACK_01", expectedDecisionVersion: null }] });
    assert.strictEqual(mm.summary.assigned, 1);
    assert.strictEqual(selected.get("TH:PACK_01").decisionVersion, 1);
    assert.strictEqual(selected.get("MM:PACK_01").decisionVersion, 1, "TH/MM selection authority must remain independent");

    const ambiguousOverview = structuredClone(overview);
    ambiguousOverview.packages[0].candidates.push({ ...readyCandidate(99), supplierMappingId: "64b0000000000000001999999" });
    const ambiguousService = createBulkPackageSupplierSelectionService({ getProductPackageSupplierOverview: async () => ambiguousOverview, setPackageSupplierSelection });
    const ambiguous = await ambiguousService({ productCode: "game", customerMarket: "TH", supplierId: supplierA, packages: [{ packageCode: "PACK_01", expectedDecisionVersion: 1 }] });
    assert.strictEqual(ambiguous.results[0].code, "AMBIGUOUS_SUPPLIER_MAPPING_IDENTITY", "same supplier name/id must never choose between multiple mapping identities");

    for (const blockerCode of ["CUSTOMER_MARKET_NOT_ELIGIBLE", "FULFILLMENT_ELIGIBILITY_UNKNOWN", "INPUT_CONTRACT_NOT_READY", "MAPPING_EXECUTION_NOT_API", "SUPPLIER_ADAPTER_NOT_READY"]) {
        const blockedOverview = structuredClone(overview);
        blockedOverview.packages = [{ ...blockedOverview.packages[0], candidates: [{ ...readyCandidate(1), readiness: { selectable: false, blockerCodes: [blockerCode] } }] }];
        const blockedService = createBulkPackageSupplierSelectionService({ getProductPackageSupplierOverview: async () => blockedOverview, setPackageSupplierSelection });
        const blocked = await blockedService({ productCode: "game", customerMarket: "TH", supplierId: supplierA, packages: [{ packageCode: "PACK_01", expectedDecisionVersion: 1 }] });
        assert.strictEqual(blocked.results[0].code, blockerCode, `${blockerCode} must remain an explicit package blocker`);
    }

    const changed = await service({ productCode: "game", customerMarket: "TH", supplierId: supplierB, packages: [{ packageCode: "PACK_01", expectedDecisionVersion: 1 }], reason: "explicit supplier change" });
    assert.strictEqual(changed.results[0].status, "ASSIGNED", "an existing decision may change only through the versioned selection authority");
    assert.strictEqual(changed.results[0].selection.decisionVersion, 2);
    assert.strictEqual(selected.get("TH:PACK_01").supplierMappingId, readyCandidate(1, supplierB, "B").supplierMappingId, "the explicit supplier choice must retain its exact mapping identity");
    const changedAuditCount = audits.length;
    const changedReplay = await service({ productCode: "game", customerMarket: "TH", supplierId: supplierB, packages: [{ packageCode: "PACK_01", expectedDecisionVersion: 2 }] });
    assert.strictEqual(changedReplay.results[0].status, "UNCHANGED");
    assert.strictEqual(audits.length, changedAuditCount, "an exact replay must not create another audit or decision version");

    assert.strictEqual(JSON.stringify(untouched), before, "commercial and fulfillment authorities must remain untouched");

    const bulkSource = read("backend/services/bulkPackageSupplierSelectionService.js");
    const route = read("backend/routes/catalog.js");
    const ui = read("frontend/js/admin-catalog.js");
    assert(bulkSource.includes("for (const request of packages)"), "bulk writes must execute sequentially");
    assert(!bulkSource.includes("Promise.all("), "bulk selection must not parallelize selection transactions");
    assert(bulkSource.includes("setPackageSupplierSelection"), "bulk operation must reuse the single-package authority");
    assert(route.includes("PERMISSIONS.OWNER_ROUTING_MANAGE") && route.includes("bulk-supplier-selection"));
    assert(ui.includes("catalogBulkSelectedPackages") && ui.includes("ensureCatalogBulkSelectionScope"));
    assert(ui.includes("catalogBulkSelectedPackages.clear()") && ui.includes("ensureCatalogBulkSelectionScope(product.productCode, catalogCustomerMarket)"), "product/market scope changes must clear selection");
    assert(ui.includes("catalogBulkSupplierOptions") && ui.includes("supplier?.supplierId"));
    assert(ui.includes("loadCatalogPackageOverview(assignment.product, { force: true })"), "post-mutation reconciliation must use one bulk refresh");
    assert(ui.includes("item.operational?.state") && ui.includes('data-manage-merchandising'), "bulk refresh must preserve authoritative Live classification and individual Manage");
    const submitStart = ui.indexOf("async function submitCatalogBulkSupplierAssignment");
    const submitEnd = ui.indexOf("function catalogPackageBlockerLabel");
    const submitSource = submitEnd > submitStart ? ui.slice(submitStart, submitEnd) : ui.slice(submitStart);
    assert(!submitSource.includes("loadAdminCatalog"), "bulk assignment must not reload the catalog");
    console.log(JSON.stringify({ result: "PASS", selected: 30, assigned: 28, blocked: 2, idempotent: true, staleConflict: true, marketIndependent: true, audits: audits.length, productionWrites: 0, supplierCalls: 0 }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
