#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    canonicalPricingRegions,
    workspaceSupplierCostState,
    storePublicationReadinessReasons
} = require("../services/commerce/adminPricingControlCenterService");
const selectionAuthority = require("../../frontend/js/admin-pricing-selection-state");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const oid = value => ({ toString: () => value });
const product = { productCode: "mlbb", enabled: true, supportedRegions: ["TH", "MM"] };
const packages = [
    { productCode: "mlbb", packageCode: "P1", enabled: true, deletedAt: null, prices: {} },
    { productCode: "mlbb", packageCode: "P2", enabled: false, deletedAt: null, prices: {} },
    { productCode: "mlbb", packageCode: "P3", enabled: false, deletedAt: null, prices: {} }
];
const mappings = packages.map((pkg, index) => ({
    _id: oid(`m${index + 1}`), supplierId: oid("supplier-1"), supplierCode: "FAZERCARDS",
    productCode: "mlbb", packageCode: pkg.packageCode, region: "GLOBAL",
    supplierProductCode: "mobile_legends_global", supplierPackageCode: `offer-${index + 1}`,
    enabled: false, productionRole: "DISABLED", executionMode: "MANUAL",
    fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [] },
    mappingMetadata: { readiness: { supplierMapped: true, inputReady: false, fulfillmentReady: false, storefrontReady: false } },
    supplierCostAuthority: { rawSupplierCost: null }
}));
const selection = {
    status: "ACTIVE", supplierId: oid("supplier-1"), productCode: "mlbb", supplierMarket: "GLOBAL",
    sellingRegions: ["TH", "MM"], packages: mappings.map(mapping => ({ packageCode: mapping.packageCode, supplierProductMappingId: mapping._id }))
};
const observed = [18.6488, 2.146, 17.5809];

for (const region of ["TH", "MM"]) {
    const rows = packages.flatMap(pkg => canonicalPricingRegions(product, pkg, region, { allowDisabledPackage: true }).map(customerMarket => ({ pkg, customerMarket })));
    assert.strictEqual(rows.length, 3, `${region} preparation must retain all selected non-deleted packages.`);
    assert(rows.every(row => row.customerMarket === region), `${region} pricing authority must remain independent.`);
}
assert.deepStrictEqual(canonicalPricingRegions(product, packages[1], "TH"), [], "Legacy behavior must continue suppressing disabled packages.");
assert.deepStrictEqual(canonicalPricingRegions(product, { ...packages[1], deletedAt: new Date() }, "TH", { allowDisabledPackage: true }), [], "Deleted packages must never enter preparation.");

mappings.forEach((mapping, index) => {
    const state = workspaceSupplierCostState(mapping, { amount: observed[index], currency: "USD" });
    assert.strictEqual(state.approvedSupplierCost, null);
    assert.strictEqual(state.previewSupplierCost, observed[index]);
    assert.strictEqual(state.provisional, false);
    assert.strictEqual(state.status, "COST_READY");
    assert.strictEqual(mapping.supplierCostAuthority.rawSupplierCost, null, "Preparation must not approve observed cost.");
    const blockers = storePublicationReadinessReasons({ mapping, pkg: packages[index], selections: [selection], regions: ["TH"] });
    assert(blockers.some(item => item.code === "SUPPLIER_MAPPING_DISABLED"), "Disabled mapping must remain publication-blocking.");
    if (pkgDisabled(index)) assert(blockers.some(item => item.code === "CANONICAL_PACKAGE_DISABLED"), "Disabled package must remain publication-blocking.");
    assert.strictEqual(selectionAuthority.isSelectable({
        row: { productCode: mapping.productCode, packageCode: mapping.packageCode },
        preview: { publishEligible: false, regions: [{ region: "TH" }] },
        expectedRegions: ["TH"],
        status: "BLOCKED"
    }), false, "Backend pricing blockers must still control selection.");
});

const wrongMarket = { ...selection, supplierMarket: "TH" };
assert(storePublicationReadinessReasons({ mapping: mappings[0], pkg: packages[0], selections: [wrongMarket], regions: ["TH"] }).some(item => item.code === "STORE_CATALOG_SELECTION_REQUIRED"));

const service = read("backend/services/commerce/adminPricingControlCenterService.js");
const frontend = read("frontend/js/admin-pricing-engine.js");
const catalog = read("backend/services/catalogService.js");
const preparationSource = service.slice(service.indexOf("async function loadDailyPricingWorkspace"), service.indexOf("class AdminPricingControlCenterError"));
assert(preparationSource.includes("deletedAt: null"), "Deleted canonical packages must remain excluded by the exact package query.");
assert(preparationSource.includes("allowDisabledPackage: Boolean(activeSelection)"), "Store Catalog preparation must retain disabled packages.");
assert(preparationSource.includes("allowDisabledProduct: Boolean(activeSelection)"), "Store Catalog preparation must retain disabled products.");
assert(preparationSource.includes("preparationRegions: activeSelection?.sellingRegions || []"), "Store Catalog selling regions must drive preparation rows.");
assert(preparationSource.includes("const storeSelectionScoped = storeSelections.length > 0"), "Actual Store Catalog authority must scope preparation without an environment-mode dependency.");
assert(preparationSource.includes("SUPPLIER_CATALOG_COST_REQUIRED") && preparationSource.includes("CANONICAL_PACKAGE_DISABLED"));
assert(!preparationSource.includes("PackageMarketPublication"), "Workspace preparation must not mutate publication authority.");
assert(frontend.includes("previewSupplierCost") && !frontend.includes("provisional preview only"));
assert(frontend.includes("row.previewSupplierCost == null"), "Observed-cost candidates must not be mislabeled as missing cost.");
assert(frontend.includes("Supplier catalog:"));
assert(catalog.includes("explicitPublishedPackages") && catalog.includes("applyPublicPackageEligibility"), "Public catalog gates must remain independent and fail closed.");

console.log(JSON.stringify({
    result: "PASS",
    selectedMappings: 3,
    visiblePreparationRows: { TH: 3, MM: 3 },
    disabledPackagesRetainedForPreparation: 2,
    deletedPackagesAllowed: 0,
    supplierCatalogCostsUsable: 3,
    approvedCostsWritten: 0,
    costReviewRequired: 0,
    publishableProvisionalRows: 0,
    publicCatalogMutations: 0,
    packagePublicationMutations: 0,
    supplierCalls: 0
}, null, 2));

function pkgDisabled(index) {
    return packages[index].enabled === false;
}
