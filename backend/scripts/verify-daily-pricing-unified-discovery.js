#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    pricingTargetRegions,
    resolvePricingInventoryMappings
} = require("../services/commerce/adminPricingControlCenterService");

const mapping = (id, productCode, packageCode, region, offerCode, options = {}) => ({
    _id: id,
    supplierId: "supplier-fazer",
    supplierCode: "FAZERCARDS",
    productCode,
    packageCode,
    region,
    supplierProductCode: `provider-${productCode}`,
    supplierPackageCode: offerCode,
    enabled: options.enabled === true,
    productionRole: options.productionRole || "DISABLED",
    supplierCostAuthority: options.approvedCost == null ? {} : {
        rawSupplierCost: options.approvedCost,
        supplierCurrency: "USD",
        capturedAt: options.capturedAt || "2026-09-01T00:00:00.000Z"
    },
    mappingMetadata: { readiness: { pricingReady: options.pricingReady === true } }
});

const mappings = [
    mapping("01", "black-clover-m", "BCM_1", "ASIA", "asia-1"),
    mapping("02", "mlbb", "MLBB_1", "TH", "th-1", { enabled: true, productionRole: "PRIMARY", approvedCost: 10 }),
    mapping("03", "mlbb", "MLBB_1", "GLOBAL", "global-1", { approvedCost: 11 }),
    mapping("04", "pubg", "PUBG_1", "GLOBAL", "global-2"),
    mapping("05", "freefire", "FF_1", "TH", "th-2", { enabled: true, productionRole: "PRIMARY" }),
    mapping("06", "tarisland", "TAR_1", "ASIA", "asia-2"),
    mapping("07", "pubg", "PUBG_DELETED", "GLOBAL", "global-deleted"),
    { ...mapping("08", "freefire", "FF_BAD", "TH", "bad"), supplierPackageCode: "" }
];

const packages = [
    { productCode: "black-clover-m", packageCode: "BCM_1", deletedAt: null },
    { productCode: "mlbb", packageCode: "MLBB_1", deletedAt: null, canonicalSupplierCost: { supplierId: "supplier-fazer", providerProductCode: "provider-mlbb", providerOfferCode: "global-1" } },
    { productCode: "pubg", packageCode: "PUBG_1", deletedAt: null },
    { productCode: "freefire", packageCode: "FF_1", deletedAt: null },
    { productCode: "tarisland", packageCode: "TAR_1", deletedAt: null },
    { productCode: "pubg", packageCode: "PUBG_DELETED", deletedAt: new Date() },
    { productCode: "freefire", packageCode: "FF_BAD", deletedAt: null }
];
const packageMap = new Map(packages.map(item => [`${item.productCode}:${item.packageCode}`, item]));
const productMap = new Map([...new Set(packages.map(item => item.productCode))].map(productCode => [productCode, { productCode, deletedAt: null, enabled: false }]));
const offerMap = new Map(mappings.map((item, index) => [String(index + 1), { supplierCost: { amount: 10 + index, currency: "USD" } }]));
mappings.forEach((item, index) => { item.supplierCatalogOfferId = String(index + 1); });

const resolved = resolvePricingInventoryMappings({ mappings, packageMap, productMap, offerMap });
const products = [...new Set(resolved.map(item => item.productCode))].sort();
assert.deepStrictEqual(products, ["black-clover-m", "freefire", "mlbb", "pubg", "tarisland"]);
assert(resolved.some(item => item.region === "ASIA"));
assert(resolved.some(item => item.region === "GLOBAL"));
assert(resolved.some(item => item.region === "TH"));
assert.deepStrictEqual(pricingTargetRegions("TH"), ["TH"]);
assert.deepStrictEqual(pricingTargetRegions("MM"), ["MM"]);
assert.deepStrictEqual(pricingTargetRegions("ALL"), ["TH", "MM"]);

const mlbb = resolved.filter(item => item.productCode === "mlbb" && item.packageCode === "MLBB_1");
assert.strictEqual(mlbb.length, 1, "One authoritative mapping must represent a duplicate canonical package.");
assert.strictEqual(String(mlbb[0]._id), "03", "Existing package supplier/provider authority must outrank market or alphabetical ordering.");
assert.strictEqual(mlbb[0].region, "GLOBAL");
assert.strictEqual(resolved.find(item => item.productCode === "freefire").region, "TH", "WonDD-style TH metadata must remain discoverable.");
assert(!resolved.some(item => item.packageCode === "PUBG_DELETED"));
assert(!resolved.some(item => item.packageCode === "FF_BAD"));

const root = path.resolve(__dirname, "../..");
const service = fs.readFileSync(path.join(root, "backend/services/commerce/adminPricingControlCenterService.js"), "utf8");
const load = service.slice(service.indexOf("async function loadDailyPricingWorkspace"), service.indexOf("class AdminPricingControlCenterError"));
assert(!load.includes("marketMappings"));
assert(!load.includes("region: selectedSupplierMarket"));
assert(load.includes("resolvePricingInventoryMappings"));
assert(load.includes("mappingCount: mappings.filter"));

console.log(JSON.stringify({
    result: "PASS",
    unifiedProducts: products,
    supplierMarketsCoexist: ["ASIA", "GLOBAL", "TH"],
    customerMarkets: ["TH", "MM"],
    duplicateCanonicalMappings: 2,
    authoritativeMappingId: String(mlbb[0]._id),
    authoritativeMappingRegion: mlbb[0].region,
    exactMappingIdentityPreserved: true,
    deletedPackagesExcluded: true,
    malformedMappingsExcluded: true
}, null, 2));
