#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const frontend = read("frontend/js/admin-pricing-engine.js");
const route = read("backend/routes/adminPricingEngine.js");
const service = read("backend/services/commerce/adminPricingControlCenterService.js");
const context = read("backend/services/commerce/productionPricingContextService.js");

assert(route.includes('router.get("/admin/pricing-engine/inventory"'));
assert(route.includes('router.get("/admin/pricing-engine/products/:productCode"'));
assert(route.includes('router.get("/admin/pricing-engine/workspace"'), "Legacy workspace route must remain compatible.");

const inventoryService = service.slice(service.indexOf("async function loadDailyPricingInventory"), service.indexOf("async function loadDailyPricingProductDetail"));
assert(inventoryService.includes("resolvePricingInventoryMappings"));
assert(inventoryService.includes("archivedAt: null"));
assert(inventoryService.includes("deletedAt: { $ne: null }"));
assert(!inventoryService.includes("pricingTargetRegions"));
assert(!inventoryService.includes("previewLoadedPackageRegion"));
assert(!inventoryService.includes("PackagePricingOverride"));
assert(!inventoryService.includes("StoreCatalogSelection"));

const detailService = service.slice(service.indexOf("async function loadDailyPricingProductDetail"), service.indexOf("class AdminPricingControlCenterError"));
assert(detailService.includes("supplierId: selected.id, productCode: normalizedProductCode, archivedAt: null"));
assert(detailService.includes("CatalogPackage.find({ productCode: normalizedProductCode"));
assert(detailService.includes("SupplierCatalogOffer.find"));
assert(detailService.includes("regionalRows"));
assert(detailService.includes("mappingId: String(mapping._id)"));
assert(!detailService.includes("products: grouped"));

assert(context.includes("async function loadProductionPricingAuthoritySnapshot"));
assert(context.includes("authoritySnapshot.policies.find"));
assert(context.includes("authoritySnapshot.fxAuthorities.find"));
assert(context.includes("authoritySnapshot.rules.filter"));
assert(context.includes("authoritySnapshot.versions"));
assert(service.includes("loadProductionPricingAuthoritySnapshot({ products, packages"));
assert(service.includes("authoritySnapshot\n        }"));
const snapshotLoader = context.slice(context.indexOf("async function loadProductionPricingAuthoritySnapshot"), context.indexOf("function isoDate"));
for (const model of ["PricingPolicy", "ExchangeRateAuthority", "PricingRule", "PriceVersion", "PackagePricingOverride"]) {
    assert.strictEqual((snapshotLoader.match(new RegExp(`${model}\\.find`, "g")) || []).length, 1, `${model} authority must be bulk-loaded exactly once per request.`);
}

const inventoryLoader = frontend.slice(frontend.indexOf("async function loadInventory"), frontend.indexOf("async function loadProductDetail"));
assert(inventoryLoader.includes("/api/admin/pricing-engine/inventory"));
assert(inventoryLoader.includes("/api/admin/pricing-engine/settings"));
assert(!inventoryLoader.includes('pricingFetch("/api/admin/pricing-engine"'));
assert(!inventoryLoader.includes("schedulePreview"));

const detailLoader = frontend.slice(frontend.indexOf("async function loadProductDetail"), frontend.indexOf("async function loadDaily"));
assert(detailLoader.includes("/api/admin/pricing-engine/products/"));
assert(detailLoader.includes("cancelDetailWork()"));
assert(detailLoader.includes("productId !== daily.selectedProductId"));
assert(detailLoader.includes("schedulePreview()"));

const workspaceRows = frontend.slice(frontend.indexOf("function workspaceRows"), frontend.indexOf("function regionRows"));
assert(workspaceRows.includes("daily.detailCache.values()"));
assert(!workspaceRows.includes("daily.products"));
const previewRunner = frontend.slice(frontend.indexOf("function schedulePreview"), frontend.indexOf("function scheduleDraftSave"));
assert(previewRunner.includes("pendingPreviewKeys"));
assert(previewRunner.includes("keys.has(rowKey(row))"));
assert(frontend.includes("schedulePreview(new Set([key]))"));
assert(frontend.includes("schedulePreview(new Set([packageKey]))"));

const browserMarket = frontend.slice(frontend.indexOf('$("pricingProductBrowserRegion")'), frontend.indexOf('$("pricingProductCards")'));
assert(!browserMarket.includes("loadInventory"));
assert(!browserMarket.includes("loadProductDetail"));
const detailMarket = frontend.slice(frontend.indexOf('$("pricingRegionSelect")'), frontend.indexOf('$("pricingProductSelect")'));
assert(!detailMarket.includes("loadInventory"));
assert(!detailMarket.includes("loadProductDetail"));
assert(frontend.includes('{ cancelDetailWork(); loadSettings(); }'));

const { resolvePricingInventoryMappings } = require("../services/commerce/adminPricingControlCenterService");
const productMap = new Map([["mlbb", { productCode: "mlbb" }], ["pubg", { productCode: "pubg" }]]);
const packageMap = new Map([["mlbb:M1", { productCode: "mlbb", packageCode: "M1" }], ["pubg:P1", { productCode: "pubg", packageCode: "P1" }]]);
const mappings = [
    { _id: "02", supplierId: "s1", productCode: "mlbb", packageCode: "M1", region: "TH", supplierProductCode: "m", supplierPackageCode: "1", enabled: true, productionRole: "PRIMARY", supplierCostAuthority: { rawSupplierCost: 10, rawSupplierCurrency: "THB" } },
    { _id: "01", supplierId: "s1", productCode: "mlbb", packageCode: "M1", region: "GLOBAL", supplierProductCode: "m", supplierPackageCode: "g", supplierCostAuthority: { rawSupplierCost: 10, rawSupplierCurrency: "THB" } },
    { _id: "03", supplierId: "s1", productCode: "pubg", packageCode: "P1", region: "ASIA", supplierProductCode: "p", supplierPackageCode: "1", supplierCostAuthority: { rawSupplierCost: 2, rawSupplierCurrency: "USD" } }
];
const resolved = resolvePricingInventoryMappings({ mappings, packageMap, productMap, offerMap: new Map() });
assert.deepStrictEqual(resolved.map(item => item.productCode).sort(), ["mlbb", "pubg"]);
assert.strictEqual(resolved.find(item => item.productCode === "mlbb")._id, "02", "Deterministic authority must preserve exact PRIMARY mapping identity, not choose by market alphabetically.");

console.log(JSON.stringify({
    result: "PASS",
    endpoints: ["inventory", "product-detail", "scoped-preview"],
    inventoryIndependentOfCustomerMarket: true,
    productQueriesScoped: true,
    exactMappingIdentityPreserved: true,
    productBrowserAutoPreview: false,
    packageEditScope: "ONE_PACKAGE",
    staleDetailResponsesIgnored: true,
    authoritySnapshotBulkLoaded: true,
    authorityQueryFamilies: 5,
    writes: 0
}, null, 2));
