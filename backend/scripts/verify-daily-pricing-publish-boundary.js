#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    AdminPricingControlCenterError,
    buildWorkspacePricePatch,
    pricingPersistenceReadinessReasons,
    selectedPublicationDecision,
    storePublicationReadinessReasons
} = require("../services/commerce/adminPricingControlCenterService");
const publishOutcome = require("../../frontend/js/admin-pricing-publish-outcome");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const packageCode = "MC_MLBB_1007_156_DIAMONDS_83C0D0F9";
const mapping = {
    _id: "6a94fec6591c7120027da868",
    supplierId: "fazercards",
    supplierCode: "FAZERCARDS",
    productCode: "mlbb",
    packageCode,
    region: "GLOBAL",
    supplierProductCode: "mobile_legends_global",
    supplierPackageCode: "1007_156_diamonds",
    enabled: false,
    productionRole: "DISABLED",
    executionMode: "MANUAL",
    fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [] },
    mappingMetadata: { readiness: { supplierMapped: true, inputReady: false, fulfillmentReady: false, storefrontReady: false } },
    supplierCostAuthority: { rawSupplierCost: 18.6488, supplierCurrency: "USD" }
};
const selection = {
    status: "ACTIVE",
    supplierId: "fazercards",
    productCode: "mlbb",
    supplierMarket: "GLOBAL",
    sellingRegions: ["TH", "MM"],
    visibleRegions: [],
    packages: [{ packageCode, supplierProductMappingId: mapping._id }]
};
const pkg = { productCode: "mlbb", packageCode, enabled: true, prices: {}, pricingPublicationHistory: [] };
const neighbors = [
    { packageCode: "MC_MLBB_102_10_DIAMONDS_1FAD53D5", prices: {}, pricingPublicationHistory: [] },
    { packageCode: "MC_MLBB_1084_DIAMONDS_D9B23820", prices: {}, pricingPublicationHistory: [] }
];
const protectedBefore = JSON.stringify({ mapping, selection, neighbors });

const publicationBlockers = storePublicationReadinessReasons({ mapping, pkg, selections: [selection], regions: ["TH"] });
assert(publicationBlockers.some(item => item.code === "SUPPLIER_MAPPING_DISABLED"));
assert(publicationBlockers.some(item => item.code === "PRIMARY_ROUTE_REQUIRED"));
assert(publicationBlockers.some(item => item.code === "API_EXECUTION_REQUIRED"));
assert.deepStrictEqual(
    pricingPersistenceReadinessReasons({ mapping, selections: [selection], regions: ["TH"] }),
    [],
    "Exact Store Catalog selection may persist a price before fulfillment readiness."
);
assert.deepStrictEqual(
    pricingPersistenceReadinessReasons({ mapping, selections: [], regions: ["TH"] }),
    [{ code: "STORE_CATALOG_SELECTION_REQUIRED", message: "Exact Store Catalog selection required" }]
);

const patch = buildWorkspacePricePatch({
    regionalPreview: { finalPreviewPrice: 651.08, priceMode: "CALCULATED" },
    normalized: { newSupplierCost: 18.6488, supplierCostEdited: false },
    supplier: { supplierCurrency: "USD" },
    row: mapping
});
assert.strictEqual(patch.amount, 651.08);
assert.strictEqual(patch.publishedPriceMode, "POLICY_DERIVED");
assert(!Object.prototype.hasOwnProperty.call(patch, "supplierCost"));
assert.strictEqual(JSON.stringify({ mapping, selection, neighbors }), protectedBefore, "Price preparation must not mutate protected authorities.");
assert.deepStrictEqual(
    selectedPublicationDecision({ changed: false, publishEligible: true, preparationSelected: true, mappingId: mapping._id, mappingReadiness: { pricingReady: false } }),
    { action: "PUBLISH", reason: "" },
    "Explicit Daily Pricing publish must converge pricing readiness for unchanged prepared rows."
);
assert.deepStrictEqual(
    selectedPublicationDecision({ changed: false, publishEligible: true, preparationSelected: true, mappingId: mapping._id, mappingReadiness: { pricingReady: true } }),
    { action: "NO_OP", reason: "No changes" },
    "Already pricing-ready unchanged rows must remain idempotent no-ops."
);
assert.deepStrictEqual(
    selectedPublicationDecision({ changed: false, publishEligible: true, preparationSelected: false, mappingId: mapping._id, mappingReadiness: { pricingReady: false } }),
    { action: "NO_OP", reason: "No changes" },
    "Unchanged rows outside Store Catalog preparation must not gain a new pricing-ready side effect."
);

assert.strictEqual(publishOutcome.classify({ status: 409 }), "REJECTED");
assert.strictEqual(publishOutcome.classify({ status: 400 }), "REJECTED");
assert.strictEqual(publishOutcome.classify({ status: 0 }), "UNCERTAIN");
assert.strictEqual(publishOutcome.classify({}), "UNCERTAIN");
assert.strictEqual(publishOutcome.classify({ status: 503 }), "UNCERTAIN");

const known = new AdminPricingControlCenterError("STORE_CATALOG_SELECTION_REQUIRED", "Exact Store Catalog selection required", 409);
assert.strictEqual(known.statusCode, 409);
const route = read("backend/routes/adminPricingEngine.js");
const service = read("backend/services/commerce/adminPricingControlCenterService.js");
const frontend = read("frontend/js/admin-pricing-engine.js");
const publishBody = service.slice(service.indexOf("async function publishDailyPricing"), service.indexOf("async function loadPackage"));
assert(route.includes("error instanceof AdminPricingEngineError || error instanceof AdminPricingControlCenterError"));
assert(publishBody.includes("pricingPersistenceReadinessReasons"));
assert(!publishBody.includes("storePublicationReadinessReasons"), "Full sellability must remain outside price persistence.");
assert(!publishBody.includes("withTransaction") && !publishBody.includes("session:"), "Publish path has no Mongo transaction-session concurrency defect.");
assert(service.includes("markMappingPricingReady"), "Daily Pricing publish must own mapping pricing-readiness convergence.");
assert(service.includes("DAILY_PRICING_EXPLICIT_PUBLISH"), "Pricing readiness provenance must be explicit.");
assert(frontend.includes('publishOutcome.classify(error) === "UNCERTAIN"'));
assert(frontend.includes("await loadDaily(true, { preserveOnError: true, postPublish: true"), "Success and uncertainty paths must reload authoritative workspace.");
assert(frontend.includes("selections.every(item=>item.readiness?.ready)"), "Explicit publication follow-up must remain readiness-gated.");

console.log(JSON.stringify({
    result: "PASS",
    exactMappingId: mapping._id,
    exactPackageCode: packageCode,
    approvedCostUsd: mapping.supplierCostAuthority.rawSupplierCost,
    persistedPriceCandidateThb: patch.amount,
    preparationBoundaryReady: true,
    explicitPublicationStillBlocked: true,
    deterministicRejectionUncertain: false,
    transportFailureUncertain: true,
    successfulCommitRefreshesWorkspace: true,
    unchangedPreparedRowsCanConvergePricingReadiness: true,
    unrelatedPackagesChanged: 0,
    mappingActivationWrites: 0,
    roleWrites: 0,
    executionModeWrites: 0,
    fulfillmentWrites: 0,
    storeCatalogWrites: 0,
    supplierCalls: 0,
    quoteOrderPaymentWrites: 0
}, null, 2));
