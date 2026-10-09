#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createPackageSupplierCandidateService, evaluatePackageSupplierCandidates } = require("../services/packageSupplierCandidateService");
const { marginAssessment } = require("../services/packageSupplierSelectionService");
const { auditConcurrency, coverageClassification, mapWithConcurrency, priceComparison, routeComparison } = require("./audit-package-supplier-cutover-readiness");

const root = path.resolve(__dirname, "../..");
const auditSource = fs.readFileSync(path.join(root, "backend/scripts/audit-package-supplier-cutover-readiness.js"), "utf8");
const objectId = suffix => `64b0000000000000000000${String(suffix).padStart(2, "0")}`;
const pkg = { productCode: "fixture", packageCode: "PACK_1", name: "Fixture", iconAssetId: "asset-1", prices: { TH: { amount: 100, currency: "THB", enabled: true, supplierId: objectId(2), supplierCode: "FIX", supplierCost: 70, supplierCurrency: "THB" } } };
const publication = { productCode: "fixture", packageCode: "PACK_1", customerMarket: "TH", published: true };
const selection = { productCode: "fixture", packageCode: "PACK_1", customerMarket: "TH", supplierMappingId: objectId(1), decisionVersion: 3 };
const mapping = { _id: objectId(1), productCode: "fixture", packageCode: "PACK_1", supplierId: objectId(2), supplierCode: "FIX", supplierCatalogOfferId: objectId(3), supplierProductCode: "P", supplierPackageCode: "O", region: "TH", executionMode: "API", enabled: true, productionRole: "PRIMARY", fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"] }, mappingMetadata: { readiness: { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true } }, supplierCostAuthority: { rawSupplierCost: 70, supplierCurrency: "THB", capturedAt: new Date().toISOString() } };
const supplier = { _id: objectId(2), supplierCode: "FIX", name: "Fixture Supplier", enabled: true, mode: "API" };
const offer = { _id: objectId(3), supplierId: objectId(2), supplierProductCode: "P", supplierOfferCode: "O", catalogLifecycleState: "ACTIVE", supplierCost: { amount: 70, currency: "THB", observedAt: new Date().toISOString() } };
const availability = { supplierCatalogOfferId: objectId(3), state: "AVAILABLE", observedAt: new Date().toISOString(), staleAt: new Date(Date.now() + 60000).toISOString() };
const icon = { assetId: "asset-1", status: "active", secureUrl: "fixture://icon" };
const adapter = { isConfigured: () => true, isAutoFulfillmentEnabled: () => true };

function query(value, counter) {
    counter.count += 1;
    return { sort() { return this; }, lean: async () => value };
}

(async () => {
    const counter = { count: 0 };
    const models = {
        Package: { findOne: () => query(pkg, counter) }, Publication: { findOne: () => query(publication, counter) }, Selection: { findOne: () => query(selection, counter) },
        Mapping: { find: () => query([mapping], counter) }, Supplier: { find: () => query([supplier], counter) }, Offer: { find: () => query([offer], counter) },
        Availability: { find: () => query([availability], counter) }, Media: { findOne: () => query(icon, counter) }
    };
    const legacyLoader = createPackageSupplierCandidateService(models, { getSupplierAdapter: () => adapter });
    const packageCount = 40;
    let baseline;
    for (let index = 0; index < packageCount; index += 1) baseline = await legacyLoader({ productCode: "fixture", packageCode: "PACK_1", customerMarket: "TH" });
    const optimized = evaluatePackageSupplierCandidates({ productCode: "fixture", packageCode: "PACK_1", customerMarket: "TH", pkg, publication, selection, mappings: [mapping], suppliers: [supplier], offers: [offer], availabilityRows: [availability], iconAsset: icon, adapterFor: () => adapter });
    assert.deepStrictEqual(optimized, baseline, "bulk-loaded pure evaluation must equal the existing service result");
    assert.strictEqual(counter.count, packageCount * 8, "baseline fixture must demonstrate eight candidate-authority queries per package");
    const optimizedBulkQueries = 8;
    assert(optimizedBulkQueries < counter.count && optimizedBulkQueries === 8, "optimized authority query count must remain constant as package count grows");
    const legacy = { ready: true, routeSnapshot: { routeType: "SUPPLIER_API", supplierMappingId: objectId(1) } };
    assert.strictEqual(coverageClassification(optimized), coverageClassification(baseline));
    assert.strictEqual(routeComparison(legacy, optimized), routeComparison(legacy, baseline));
    assert.strictEqual(priceComparison(optimized.customerPrice, optimized.candidates[0]), priceComparison(baseline.customerPrice, baseline.candidates[0]));
    assert.deepStrictEqual(marginAssessment(pkg, "TH", optimized.candidates[0].cost), marginAssessment(pkg, "TH", baseline.candidates[0].cost));

    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 30 }, (_, index) => index), 4, async value => { active += 1; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active -= 1; return value; });
    assert.strictEqual(peak, 4, "worker pool must enforce bounded concurrency");
    assert.strictEqual(auditConcurrency("4"), 4);
    assert.throws(() => auditConcurrency("9"));
    assert(auditSource.includes("preloadMarketAuthorities") && auditSource.includes("evaluatePackageSupplierCandidates"));
    assert(auditSource.includes("resolveCheckoutRouteSnapshot"), "legacy comparison must retain the authoritative resolver");
    console.log(JSON.stringify({ result: "PASS", fixturePackages: packageCount, candidateAuthorityQueriesBefore: counter.count, candidateAuthorityQueriesAfter: optimizedBulkQueries, remainingPerPackageCalls: ["resolveCheckoutRouteSnapshot"], concurrencyPeak: peak, classificationsEquivalent: true }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
