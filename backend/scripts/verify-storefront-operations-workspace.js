#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { evaluatePackageSupplierCandidates } = require("../services/packageSupplierCandidateService");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const ui = read("frontend/js/admin-catalog.js");
const html = read("frontend/admin.html");
const routes = read("backend/routes/catalog.js");
const service = read("backend/services/packageSupplierCandidateService.js");
const css = read("frontend/css/admin-v2/components.css");
const id = suffix => `64b0000000000000000000${String(suffix).padStart(2, "0")}`;
const now = new Date().toISOString();
const pkg = { productCode: "fixture", packageCode: "PACK", name: "Fixture", enabled: true, sortOrder: 20, prices: { TH: { amount: 100, currency: "THB", enabled: true } } };
const mapping = { _id: id(1), productCode: "fixture", packageCode: "PACK", supplierId: id(2), supplierCode: "ONE", supplierCatalogOfferId: id(3), supplierProductCode: "P", supplierPackageCode: "O", region: "GLOBAL", executionMode: "API", enabled: true, productionRole: "BACKUP", fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "test", verifiedAt: now, version: 1 }, mappingMetadata: { readiness: { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true } }, supplierCostAuthority: { rawSupplierCost: 70, supplierCurrency: "THB", capturedAt: now } };
const supplier = { _id: id(2), supplierCode: "ONE", name: "Supplier One", enabled: true, mode: "API" };
const offer = { _id: id(3), supplierId: id(2), supplierProductCode: "P", supplierOfferCode: "O", catalogLifecycleState: "ACTIVE", supplierCost: { amount: 70, currency: "THB", observedAt: now } };
const availability = { supplierCatalogOfferId: id(3), state: "AVAILABLE", observedAt: now, staleAt: new Date(Date.now() + 60000).toISOString() };
const adapterFor = () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true });
const evaluate = ({ published = true, selected = true, packagePatch = {} } = {}) => evaluatePackageSupplierCandidates({ productCode: "fixture", packageCode: "PACK", customerMarket: "TH", pkg: { ...pkg, ...packagePatch }, publication: { published }, selection: selected ? { supplierMappingId: id(1), decisionVersion: 1 } : null, mappings: [mapping], suppliers: [supplier], offers: [offer], availabilityRows: [availability], adapterFor });

const live = evaluate();
assert.strictEqual(live.operational.state, "LIVE");
assert.strictEqual(live.candidates.length, 1);
assert.strictEqual(live.candidates[0].selected, true);
const secondMapping = { ...mapping, _id: id(4), supplierId: id(5), supplierCode: "TWO", supplierCatalogOfferId: id(6), supplierPackageCode: "O2" };
const twoSupplierCanonicalRow = evaluatePackageSupplierCandidates({ productCode: "fixture", packageCode: "PACK", customerMarket: "TH", pkg, publication: { published: true }, selection: { supplierMappingId: id(1), decisionVersion: 1 }, mappings: [mapping, secondMapping], suppliers: [supplier, { ...supplier, _id: id(5), supplierCode: "TWO", name: "Supplier Two" }], offers: [offer, { ...offer, _id: id(6), supplierId: id(5), supplierOfferCode: "O2" }], availabilityRows: [availability, { ...availability, supplierCatalogOfferId: id(6) }], adapterFor });
assert.strictEqual(twoSupplierCanonicalRow.package.packageCode, "PACK", "one canonical package must remain the row identity");
assert.strictEqual(twoSupplierCanonicalRow.candidates.length, 2, "all exact supplier choices must remain in the drawer projection");
const unpublished = evaluate({ published: false });
assert.strictEqual(unpublished.operational.state, "UNPUBLISHED", "publication must take deterministic precedence");
const missingSelection = evaluate({ selected: false });
assert.strictEqual(missingSelection.operational.state, "SETUP_REQUIRED");
assert(missingSelection.operational.blockerCodes.includes("PACKAGE_SUPPLIER_SELECTION_REQUIRED"));
const noPrice = evaluate({ packagePatch: { prices: {} } });
assert.strictEqual(noPrice.operational.state, "SETUP_REQUIRED");
assert(noPrice.operational.blockerCodes.includes("NO_VALID_PRICE"));

assert(html.includes('data-catalog-panel="storefront" hidden'));
assert(css.includes('[data-catalog-panel][hidden]{display:none!important}'));
assert(!ui.slice(ui.indexOf('event.detail?.context?.view === "advanced"'), ui.indexOf('window.addEventListener("aziel:admin-locale-changed"')).includes("loadStorefrontSections(true)"), "opening Product Presentation must not preload sections");
assert(routes.includes('/storefront-package-overview'));
assert(service.includes("getProductPackageSupplierOverview"));
assert(service.includes("SupplierProductMapping.find({ productCode: normalizedProduct })"), "supplier mappings must be bulk loaded by canonical product");
assert(ui.includes("catalogPackageOverviewPending"), "duplicate overview requests must be coalesced");
assert(ui.includes("catalogPackageOverviewVersions") && ui.includes("requestVersion"), "older overview responses must not overwrite newer state");
assert(ui.includes("requestId === catalogPackageOverviewRequestId") && ui.includes("selectedCatalogProductCode === product.productCode"), "stale product responses must be guarded");
assert(ui.includes('catalogPackageOperationalFilter = "AUTO"'));
assert(ui.includes("sortStorefrontPackages") && ui.includes("pkg?.sortOrder"), "sorting must prefer canonical sort order");
assert(!ui.slice(ui.indexOf("async function mutateCatalog"), ui.indexOf("async function confirmCatalogAction")).includes("loadAdminCatalog(true)"), "catalog mutation must not trigger a broad catalog reload");
assert(ui.includes("updateManagePackagePublication") && ui.includes("updateManagePackageImage") && ui.includes("saveManagePackageSupplier"));
assert(ui.includes("renderManagePackageCandidates(modal, current)"), "failed publication mutation must restore the prior authoritative drawer state");
assert(ui.includes("No supplier") && ui.includes("Setup required") && ui.includes("Unpublished"));
assert(!ui.includes("force-enable"), "Storefront must not expose an unsafe generic force-enable path");

console.log("PASS storefront workspace isolation/bulk canonical projection/classification/sorting/local mutation/static interaction verification");
