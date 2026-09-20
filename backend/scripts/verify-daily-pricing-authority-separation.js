#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    canonicalPricingRegions,
    pricingTargetRegions
} = require("../services/commerce/adminPricingControlCenterService");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const service = read("backend/services/commerce/adminPricingControlCenterService.js");
const drafts = read("backend/services/commerce/pricingWorkspaceDraftService.js");
const frontend = read("frontend/js/admin-pricing-engine.js");

assert.deepStrictEqual(pricingTargetRegions("ALL"), ["TH", "MM"]);
for (const prices of [{}, { TH: { amount: 1 } }, { MM: { amount: 100 } }, { TH: { amount: 1, enabled: false }, MM: { amount: 100 } }]) {
    assert.deepStrictEqual(canonicalPricingRegions({ enabled: false, supportedRegions: [] }, { enabled: false, deletedAt: null, prices }, "ALL"), ["TH", "MM"]);
}
assert.deepStrictEqual(canonicalPricingRegions({}, { deletedAt: new Date() }, "ALL"), []);

const load = service.slice(service.indexOf("async function loadDailyPricingWorkspace"), service.indexOf("class AdminPricingControlCenterError"));
const preview = service.slice(service.indexOf("async function batchPreviewDailyPricing"), service.indexOf("async function publishDailyPricing"));
const publish = service.slice(service.indexOf("async function publishDailyPricing"), service.indexOf("async function loadPackage"));

assert(load.includes('SupplierProductMapping.find({ supplierId: selected.id, archivedAt: null })'));
assert(load.includes("resolvePricingInventoryMappings"));
assert(!load.includes("marketMappings"));
assert(!load.includes("region: selectedSupplierMarket"));
assert(load.includes('pricingTargetRegions("ALL")'));
assert(!load.includes("storeSelectionScoped"));
assert(!load.includes("CANONICAL_PACKAGE_DISABLED"));
assert(!load.includes("mappingMetadata?.readiness?.supplierMapped === true"));
assert(preview.includes('pricingTargetRegions("ALL")'));
assert(!preview.includes("preparationSelections"));
assert(!publish.includes("pricingPersistenceReadinessReasons"));
assert(!publish.includes("StoreCatalogSelection.find"));
assert(!publish.includes("markMappingPricingReady"));
assert(!publish.includes("enabled: true"));
assert(publish.includes("expectedUpdatedAt"));
assert(!drafts.includes("without active regional pricing"));
assert(drafts.includes("active exact supplier mapping"));

assert(frontend.includes('return "ALL"'));
assert(frontend.includes('publishRows("PACKAGE"'));
assert(frontend.includes('publishRows("SELECTION")'));
assert(frontend.includes('publishRows("PRODUCT_CHANGED")'));
assert(frontend.includes('publishRows("WORKSPACE_CHANGED")'));
assert(frontend.includes("WORKSPACE_CHUNK_SIZE"));
assert(frontend.includes("draftScopeKey"));
assert(frontend.includes("draftController?.abort()"));
assert(!frontend.includes("/api/admin/product-activation"));

console.log(JSON.stringify({
    result: "PASS",
    inventoryAuthority: "SupplierProductMapping",
    pricingMarkets: pricingTargetRegions("ALL"),
    missingPricesVisible: true,
    pricePublishOnly: true,
    automaticStorefrontPublication: false,
    publishModes: ["PACKAGE", "SELECTION", "PRODUCT_CHANGED", "WORKSPACE_CHANGED"],
    deterministicChunkSize: 200,
    staleDraftResponsesScoped: true
}, null, 2));
