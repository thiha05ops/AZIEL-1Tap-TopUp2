#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { WONDD_FAMILIES, resolveFamilyForServiceCode } = require("../services/suppliers/wonddCatalogConfig");
const { parseScopeArgs, buildScopedMappingQuery, mappingMutationFilter, applyCostAuthorityUpdates, resolveWonddFamilyForMapping, findWonddCatalogOffer } = require("./refresh-existing-supplier-cost-authority");

(async () => {
const direct = resolveWonddFamilyForMapping({
    productCode: "freefire",
    supplierProductCode: "freefire"
});
assert.strictEqual(direct.serviceId, "9602");
assert.strictEqual(direct.family, WONDD_FAMILIES["9602"]);

const entitlementSplit = resolveWonddFamilyForMapping({
    productCode: "freefire-pass-membership",
    supplierProductCode: "freefire"
});
assert.strictEqual(entitlementSplit.serviceId, direct.serviceId);
assert.strictEqual(entitlementSplit.family, direct.family);

assert.throws(
    () => resolveWonddFamilyForMapping({ productCode: "freefire", supplierProductCode: "mlbb" }),
    error => error.code === "WONDD_CANONICAL_SUPPLIER_FAMILY_MISMATCH"
);
assert.throws(
    () => resolveWonddFamilyForMapping({ productCode: "freefire", supplierProductCode: "unknown-service" }),
    error => error.code === "WONDD_SERVICE_CODE_UNKNOWN"
);
assert.throws(
    () => resolveWonddFamilyForMapping({ productCode: "freefire", supplierProductCode: "" }),
    error => error.code === "WONDD_SERVICE_CODE_MISSING"
);
assert.throws(
    () => resolveFamilyForServiceCode("freefire", {
        "9602": WONDD_FAMILIES["9602"],
        duplicate: { ...WONDD_FAMILIES["9602"] }
    }),
    error => error.code === "WONDD_SERVICE_CODE_AMBIGUOUS"
);

const exactOffer = { serviceid: "9602", packcode: "FBPC84", netpricedealer: "84" };
const offers = new Map([["9602:FBPC84", exactOffer]]);
assert.strictEqual(findWonddCatalogOffer(offers, "9602", "FBPC84"), exactOffer);
assert.strictEqual(findWonddCatalogOffer(offers, "9602", "FBPC85"), null);
assert.strictEqual(findWonddCatalogOffer(offers, "9602", "fbpc84"), null);
assert.strictEqual(findWonddCatalogOffer(offers, "9622", "FBPC84"), null);

const scope = parseScopeArgs(["--supplier=WONDD", "--product=mlbb"]);
assert.deepStrictEqual(scope, { supplier: "WONDD", product: "mlbb", requested: true });
assert.deepStrictEqual(buildScopedMappingQuery(scope), { supplierCode: "WONDD", archivedAt: null, enabled: true, productCode: "mlbb" });
assert.throws(() => parseScopeArgs(["--supplier=UNKNOWN"]), /Unknown supplier scope/);
assert.throws(() => parseScopeArgs(["--product=unknown-product"]), /Unknown product scope/);
assert.deepStrictEqual(buildScopedMappingQuery(parseScopeArgs([])), { supplierCode: { $in: ["WONDD", "FAZERCARDS"] }, archivedAt: null });

const insideMapping = { _id: "inside", supplierCode: "WONDD", productCode: "mlbb", packageCode: "MLBB_86", supplierProductCode: "mlbb", supplierPackageCode: "ML00086", enabled: true, archivedAt: null };
const outsideMapping = { _id: "outside", supplierCode: "WONDD", productCode: "freefire", packageCode: "FF_100", supplierProductCode: "freefire", supplierPackageCode: "FF00100", enabled: true, archivedAt: null };
assert.deepStrictEqual(mappingMutationFilter(insideMapping, scope), { _id: "inside", archivedAt: null, supplierProductCode: "mlbb", supplierPackageCode: "ML00086", enabled: true, supplierCode: "WONDD", productCode: "mlbb" });
assert.throws(() => mappingMutationFilter(outsideMapping, scope), /escaped requested scope/);

let scopedMutationCalls = 0;
const fakeMappingModel = { async updateOne() { scopedMutationCalls += 1; } };
await assert.rejects(
    () => applyCostAuthorityUpdates({ updates: [{ mapping: insideMapping }, { mapping: outsideMapping }], MappingModel: fakeMappingModel, session: {}, scope, capturedAt: new Date() }),
    /escaped requested scope/
);
assert.strictEqual(scopedMutationCalls, 0, "Scoped apply must preflight every update before mutating any mapping.");

await applyCostAuthorityUpdates({ updates: [{ mapping: insideMapping, raw: 41, currency: "THB", source: "TEST", evidenceHash: "hash" }], MappingModel: fakeMappingModel, session: {}, scope, capturedAt: new Date() });
assert.strictEqual(scopedMutationCalls, 1);

console.log(JSON.stringify({
    result: "PASS",
    directServiceId: direct.serviceId,
    entitlementSplitServiceId: entitlementSplit.serviceId,
    mismatchedSupplierFamilyRejected: true,
    missingSupplierFamilyRejected: true,
    ambiguousSupplierFamilyRejected: true,
    exactPackcodeRequired: true,
    scopedSupplier: scope.supplier,
    scopedProduct: scope.product,
    scopedApplyOutsideMutations: 0,
    providerCalls: 0,
    databaseWrites: 0
}, null, 2));
})().catch(error => {
    console.error(`VERIFY_REFRESH_SUPPLIER_COST_AUTHORITY_FAILED: ${error.message}`);
    process.exitCode = 1;
});
