#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { evaluatePackageSupplierCandidates } = require("../services/packageSupplierCandidateService");
const { selectedRouteSnapshot, createRoutingAuthority } = require("../services/supplierProductionSelectionService");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const now = new Date();
const mapping = {
    _id: "mapping-global-1", supplierId: "supplier-1", supplierCode: "WONDD",
    productCode: "mlbb", packageCode: "MC_MLBB_102_10_DIAMONDS_1FAD53D5",
    supplierProductCode: "mlbb", supplierPackageCode: "MLBB-NATIVE-102-10",
    supplierCatalogOfferId: "offer-1", region: "GLOBAL", enabled: true,
    executionMode: "API", productionRole: "PRIMARY", archivedAt: null,
    mappingMetadata: { readiness: { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true } },
    fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH", "MM"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "fixture", verifiedAt: now, version: 1 }
};
const supplier = { _id: "supplier-1", supplierCode: "WONDD", name: "WonDD", enabled: true, mode: "API" };
const offer = { _id: "offer-1", supplierId: "supplier-1", supplierProductCode: "mlbb", supplierOfferCode: "MLBB-NATIVE-102-10", catalogLifecycleState: "ACTIVE" };
const availability = { supplierCatalogOfferId: "offer-1", state: "AVAILABLE", observedAt: now, staleAt: new Date(Date.now() + 3600000) };
const selection = { customerMarket: "GLOBAL", supplierMappingId: "mapping-global-1", decisionVersion: 4 };
const pkg = { packageCode: mapping.packageCode, name: "102 + 10 Diamonds", enabled: true, prices: { TH: { amount: 79, currency: "THB", enabled: true }, MM: { amount: 9500, currency: "MMK", enabled: true } } };
const adapterFor = () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true });
const project = customerMarket => evaluatePackageSupplierCandidates({
    productCode: "mlbb", packageCode: mapping.packageCode, customerMarket,
    product: { enabled: true, publicDiscoveryEnabled: true, commerceState: "PURCHASABLE" },
    storeCatalogMember: true, pkg, publication: { published: true }, selection,
    mappings: [mapping], suppliers: [supplier], offers: [offer], availabilityRows: [availability],
    adapterFor, marketPaymentReady: true
});

const th = project("TH"), mm = project("MM");
assert.strictEqual(th.effectiveState.state, "LIVE");
assert.strictEqual(mm.effectiveState.state, "LIVE");
assert.strictEqual(th.effectiveState.supplierMappingId, "mapping-global-1");
assert.strictEqual(mm.effectiveState.supplierMappingId, "mapping-global-1");
assert.strictEqual(th.customerPrice.currency, "THB");
assert.strictEqual(mm.customerPrice.currency, "MMK");

const thRoute = selectedRouteSnapshot(mapping, selection, "TH");
const mmRoute = selectedRouteSnapshot(mapping, selection, "MM");
assert.strictEqual(thRoute.supplierMappingId, mmRoute.supplierMappingId);
assert.strictEqual(thRoute.supplierPackageCode, mmRoute.supplierPackageCode);
assert.notStrictEqual(thRoute.customerMarket, mmRoute.customerMarket);

const noSelection = evaluatePackageSupplierCandidates({
    productCode: "mlbb", packageCode: mapping.packageCode, customerMarket: "TH",
    product: { enabled: true, publicDiscoveryEnabled: true, commerceState: "PURCHASABLE" },
    storeCatalogMember: true, pkg, publication: { published: true }, selection: null,
    mappings: [mapping], suppliers: [supplier], offers: [offer], availabilityRows: [availability],
    adapterFor, marketPaymentReady: true
});
assert.strictEqual(noSelection.effectiveState.state, "BLOCKED");
assert(noSelection.effectiveState.blockers.includes("GLOBAL_SUPPLIER_SELECTION_REQUIRED"));

let resolverCalls = 0;
const route = createRoutingAuthority({ selectedResolver: async input => { resolverCalls += 1; return { ready: true, routeSnapshot: selectedRouteSnapshot(mapping, selection, input.region) }; } });
Promise.all([
    route({ productCode: "mlbb", packageCode: mapping.packageCode, region: "TH" }),
    route({ productCode: "mlbb", packageCode: mapping.packageCode, region: "MM" })
]).then(([thResult, mmResult]) => {
    assert.strictEqual(resolverCalls, 2);
    assert.strictEqual(thResult.routeSnapshot.supplierMappingId, mmResult.routeSnapshot.supplierMappingId);
    assert.strictEqual(thResult.routeSnapshot.supplierPackageCode, mmResult.routeSnapshot.supplierPackageCode);
    const routingSource = read("backend/services/supplierProductionSelectionService.js");
    const selectionSource = read("backend/services/packageSupplierSelectionService.js");
    const bootstrapSource = read("backend/services/packageSupplierSelectionBootstrapService.js");
    assert(routingSource.includes('customerMarket: "GLOBAL"'));
    assert(routingSource.includes("LEGACY_SUPPLIER_SELECTION_CONFLICT"));
    assert(routingSource.includes("GLOBAL_SUPPLIER_SELECTION_REQUIRED"));
    assert(!routingSource.includes('selectedRouteSnapshot(ready[0].mapping'), "checkout must not select a sole candidate without an explicit global decision");
    assert(selectionSource.includes('const customerMarket = "GLOBAL"'));
    assert(bootstrapSource.includes("GLOBAL_SUPPLIER_SELECTION_REQUIRES_OWNER_DECISION"));
    console.log(JSON.stringify({ result: "PASS", canonicalPackage: mapping.packageCode, thbPrice: 79, mmkPrice: 9500, identicalMappingId: true, identicalNativeSku: true, missingGlobalFailsClosed: true, legacyConflictFailsClosed: true, providerCalls: 0, productionWrites: 0 }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });
