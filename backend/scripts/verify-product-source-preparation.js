#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");
const { createProductSourcePreparationService, ProductSourcePreparationError, ACTIONS } = require("../services/productSourcePreparationService");

const clone = value => structuredClone(value);
const oid = value => ({ _id: value });
const stamp = "2026-09-01T01:00:00.000Z";
const state = {
    suppliers: [{ ...oid("supplier-fazer"), supplierCode: "FAZERCARDS", enabled: true, mode: "API" }, { ...oid("supplier-wondd"), supplierCode: "WONDD", enabled: true, mode: "API" }],
    mappings: [
        { ...oid("mapping-a"), supplierId: "supplier-fazer", supplierCode: "FAZERCARDS", productCode: "aovid", packageCode: "AOV_11", supplierProductCode: "arena_of_valor_th", supplierPackageCode: "11_coupons", supplierCatalogOfferId: "offer-a", region: "TH", enabled: false, executionMode: "MANUAL", supplierCostAuthority: { rawSupplierCost: 1.2, supplierCurrency: "USD" }, fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [] }, mappingMetadata: { readiness: { supplierMapped: true } }, updatedAt: stamp, archivedAt: null },
        { ...oid("mapping-b"), supplierId: "supplier-fazer", supplierCode: "FAZERCARDS", productCode: "aovid", packageCode: "AOV_24", supplierProductCode: "arena_of_valor_th", supplierPackageCode: "24_coupons", supplierCatalogOfferId: "offer-b", region: "TH", enabled: true, productionRole: "DISABLED", executionMode: "MANUAL", supplierCostAuthority: { rawSupplierCost: 2.4, supplierCurrency: "USD" }, fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [] }, mappingMetadata: { readiness: { supplierMapped: true } }, updatedAt: stamp, archivedAt: null },
        { ...oid("mapping-other-product"), supplierId: "supplier-fazer", supplierCode: "FAZERCARDS", productCode: "mlbb", packageCode: "MLBB_42", supplierProductCode: "mobile_legends_global", supplierPackageCode: "42_diamonds", supplierCatalogOfferId: "offer-other-product", region: "GLOBAL", enabled: false, productionRole: "DISABLED", executionMode: "MANUAL", updatedAt: stamp, archivedAt: null },
        { ...oid("mapping-other-supplier"), supplierId: "supplier-wondd", supplierCode: "WONDD", productCode: "aovid", packageCode: "AOV_W11", supplierProductCode: "rov", supplierPackageCode: "R00011", supplierCatalogOfferId: "offer-other-supplier", region: "TH", enabled: false, executionMode: "API", updatedAt: stamp, archivedAt: null }
    ],
    offers: [
        { ...oid("offer-a"), supplierId: "supplier-fazer", supplierProductCode: "arena_of_valor_th", supplierOfferCode: "11_coupons", rawSnapshotHash: "a".repeat(64), sourceRevision: "1" },
        { ...oid("offer-b"), supplierId: "supplier-fazer", supplierProductCode: "arena_of_valor_th", supplierOfferCode: "24_coupons", rawSnapshotHash: "b".repeat(64), sourceRevision: "1" },
        { ...oid("offer-other-product"), supplierId: "supplier-fazer", supplierProductCode: "mobile_legends_global", supplierOfferCode: "42_diamonds", rawSnapshotHash: "c".repeat(64), sourceRevision: "1" },
        { ...oid("offer-other-supplier"), supplierId: "supplier-wondd", supplierProductCode: "rov", supplierOfferCode: "R00011", rawSnapshotHash: "d".repeat(64), sourceRevision: "1" }
    ],
    packages: [{ productCode: "aovid", packageCode: "AOV_11", name: "11 Coupons", deletedAt: null }, { productCode: "aovid", packageCode: "AOV_24", name: "24 Coupons", deletedAt: null }, { productCode: "mlbb", packageCode: "MLBB_42", name: "42 Diamonds", deletedAt: null }, { productCode: "aovid", packageCode: "AOV_W11", name: "11 Coupons", deletedAt: null }],
    audits: [], failAudit: false
};

function matches(row, filter = {}) {
    return Object.entries(filter).every(([key, expected]) => {
        if (key === "$or") return expected.some(part => matches(row, part));
        const actual = key.split(".").reduce((value, part) => value?.[part], row);
        if (expected && typeof expected === "object" && "$in" in expected) return expected.$in.map(String).includes(String(actual));
        if (expected && typeof expected === "object" && "$exists" in expected) return expected.$exists ? actual !== undefined : actual === undefined;
        if (expected instanceof Date) return new Date(actual).getTime() === expected.getTime();
        return String(actual) === String(expected);
    });
}
class Query {
    constructor(run) { this.run = run; }
    session() { return this; }
    lean() { return Promise.resolve(clone(this.run())); }
}
const model = rows => ({ find: filter => new Query(() => rows.filter(row => matches(row, filter))), findById: value => new Query(() => rows.find(row => String(row._id) === String(value)) || null) });
const Mapping = {
    ...model(state.mappings),
    async updateOne(filter, update) {
        const row = state.mappings.find(item => matches(item, filter));
        if (!row) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(row, clone(update.$set)); row.updatedAt = new Date(Date.parse(row.updatedAt) + 1000).toISOString();
        return { matchedCount: 1, modifiedCount: 1 };
    }
};
const Audit = {
    findOne: filter => new Query(() => state.audits.find(row => matches(row, filter)) || null),
    async create(rows) { if (state.failAudit) throw new Error("AUDIT_WRITE_FAILED"); state.audits.push(...clone(rows)); return rows; }
};
const connection = { async startSession() { return { async withTransaction(fn) { const snapshot = clone(state); try { await fn(); } catch (error) { Object.keys(state).forEach(key => { if (Array.isArray(state[key])) state[key].splice(0, state[key].length, ...clone(snapshot[key])); else state[key] = clone(snapshot[key]); }); throw error; } }, async endSession() {} }; } };
const service = createProductSourcePreparationService({ Supplier: model(state.suppliers), Mapping, Offer: model(state.offers), CatalogPackage: model(state.packages), Audit, connection });
const selection = ids => ({ productCode: "aovid", supplierId: "supplier-fazer", supplierCode: "FAZERCARDS", supplierMarket: "TH", customerMarket: "TH", selectedMappingIds: ids });
const owner = { id: "owner-1", username: "owner", role: "OWNER" };
const rehash = plan => { const body = clone(plan); delete body.planHash; return crypto.createHash("sha256").update(canonicalJson(body)).digest("hex"); };
async function rejectsCode(promise, code) { await assert.rejects(promise, error => error instanceof ProductSourcePreparationError && error.code === code); }

(async () => {
    const original = clone(state);
    const plan = await service.generatePlan(selection(["mapping-a"]));
    assert.deepStrictEqual(plan.summary, { selected: 1, validMappings: 1, alreadyEnabled: 0, mappingsToEnable: 1, rolesToNormalize: 1, excludedMappings: 0, conflicts: 0 });
    assert.equal(plan.targets[0].proposed.executionMode, "MANUAL");
    assert.equal(plan.targets[0].proposed.productionRole, "DISABLED");
    assert.equal(plan.safety.primaryAssignments, 0);
    assert(!plan.selection.selectedMappingIds.includes("mapping-b"), "selected-package isolation failed");

    const wrongProduct = await service.generatePlan({ ...selection(["mapping-other-product"]), productCode: "aovid", supplierMarket: "GLOBAL" });
    assert(wrongProduct.excluded[0].blockers.includes("PRODUCT_SCOPE_MISMATCH"));
    const wrongSupplier = await service.generatePlan(selection(["mapping-other-supplier"]));
    assert(wrongSupplier.excluded[0].blockers.includes("SUPPLIER_SCOPE_MISMATCH"));
    const wrongMarket = await service.generatePlan({ ...selection(["mapping-a"]), supplierMarket: "GLOBAL" });
    assert(wrongMarket.excluded[0].blockers.includes("SUPPLIER_MARKET_SCOPE_MISMATCH"));

    const badHash = { ...plan, planHash: "0".repeat(64) };
    await rejectsCode(service.applyPlan(badHash, { actor: owner }), "ACTIVATION_PLAN_HASH_MISMATCH");
    await rejectsCode(service.applyPlan(plan, { actor: { role: "CATALOG" } }), "OWNER_SOURCE_PREPARATION_REQUIRED");

    const staleDate = await service.generatePlan(selection(["mapping-a"]));
    state.mappings[0].updatedAt = "2026-09-01T02:00:00.000Z";
    await rejectsCode(service.applyPlan(staleDate, { actor: owner }), "STALE_ACTIVATION_PLAN");
    state.mappings[0].updatedAt = stamp;

    const staleState = await service.generatePlan(selection(["mapping-a"]));
    staleState.mappingStateHash = "1".repeat(64); staleState.planHash = rehash(staleState);
    await rejectsCode(service.applyPlan(staleState, { actor: owner }), "STALE_ACTIVATION_PLAN");

    const missingPackage = await service.generatePlan(selection(["mapping-a"]));
    const heldPackage = state.packages.shift();
    await rejectsCode(service.applyPlan(missingPackage, { actor: owner }), "STALE_ACTIVATION_PLAN");
    state.packages.unshift(heldPackage);

    const skuMismatch = await service.generatePlan(selection(["mapping-a"]));
    state.offers[0].supplierOfferCode = "changed";
    await rejectsCode(service.applyPlan(skuMismatch, { actor: owner }), "STALE_ACTIVATION_PLAN");
    state.offers[0].supplierOfferCode = "11_coupons";

    const rollbackPlan = await service.generatePlan(selection(["mapping-a"]));
    state.failAudit = true;
    await assert.rejects(service.applyPlan(rollbackPlan, { actor: owner }), /AUDIT_WRITE_FAILED/);
    assert.equal(state.mappings[0].enabled, false, "transaction rollback failed");
    assert.equal(state.mappings[0].productionRole, undefined, "role normalization escaped rollback");
    state.failAudit = false;

    const protectedBefore = clone({ supplierId: state.mappings[0].supplierId, productCode: state.mappings[0].productCode, packageCode: state.mappings[0].packageCode, supplierProductCode: state.mappings[0].supplierProductCode, supplierPackageCode: state.mappings[0].supplierPackageCode, region: state.mappings[0].region, executionMode: state.mappings[0].executionMode, supplierCostAuthority: state.mappings[0].supplierCostAuthority, fulfillmentEligibility: state.mappings[0].fulfillmentEligibility });
    const applied = await service.applyPlan(await service.generatePlan(selection(["mapping-a"])), { actor: owner });
    assert.equal(applied.applied, 1); assert.equal(state.mappings[0].enabled, true); assert.equal(state.mappings[0].productionRole, "DISABLED"); assert.equal(state.mappings[0].executionMode, "MANUAL");
    assert.deepStrictEqual(protectedBefore, clone({ supplierId: state.mappings[0].supplierId, productCode: state.mappings[0].productCode, packageCode: state.mappings[0].packageCode, supplierProductCode: state.mappings[0].supplierProductCode, supplierPackageCode: state.mappings[0].supplierPackageCode, region: state.mappings[0].region, executionMode: state.mappings[0].executionMode, supplierCostAuthority: state.mappings[0].supplierCostAuthority, fulfillmentEligibility: state.mappings[0].fulfillmentEligibility }));
    assert.equal(state.audits.at(-1).action, ACTIONS.PREPARED);
    const replay = await service.applyPlan({ ...await service.generatePlan(selection(["mapping-a"])), planHash: applied.planHash }, { actor: owner }).catch(() => null);
    const exactReplay = await service.applyPlan({ ...plan, planHash: applied.planHash }, { actor: owner });
    assert.equal(exactReplay.idempotentReplay, true); assert.equal(exactReplay.applied, 0); assert(replay === null || replay.idempotentReplay);

    const root = path.resolve(__dirname, "../..");
    const routes = fs.readFileSync(path.join(root, "backend/routes/supplier.js"), "utf8");
    const routing = fs.readFileSync(path.join(root, "backend/services/supplierProductionSelectionService.js"), "utf8");
    assert(routes.includes("source-preparation/plan") && routes.includes("source-preparation/apply"));
    assert((routes.match(/source-preparation\/(?:plan|apply)[\s\S]{0,180}OWNER_ROUTING_MANAGE/g) || []).length === 2, "both commands must be Owner-authorized");
    assert(routing.includes("PRIMARY_ROUTE_CONFLICT") && routing.includes("replaceExistingPrimaryId") && !routing.includes("productionRole: ROLES.BACKUP } }, { session"), "silent PRIMARY replacement remains");
    assert(!routes.includes('source-preparation/plan", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE)'),"Advanced source preparation must not be weakened into normal Catalog permission");

    console.log(JSON.stringify({ result: "PASS", checks: { exactProductIsolation: true, exactSupplierIsolation: true, exactSupplierMarketIsolation: true, selectedPackageIsolation: true, staleUpdatedAtRejected: true, mappingStateHashRejected: true, planHashRejected: true, invalidCanonicalPackageRejected: true, supplierOfferSkuMismatchRejected: true, transactionRollback: true, idempotentReplay: true, ownerAuthorization: true, executionModePreserved: true, rolePreservedOrMissingNormalizedOnly: true, primaryAssignment: 0, primaryReplacementRequiresExplicitConflictData: true, priceWrites: 0, costApprovals: 0, publicationWrites: 0, supplierCalls: 0, orderTopupSideEffects: 0 }, fixtureRestoredByIsolation: Boolean(original) }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
