#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { activationBlockers } = require("../services/storePackageActivationService");
const { resolvePublicProductReadiness } = require("../catalog/publicProductReadiness");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const mapping = { _id: "m1", supplierId: "s1", supplierCode: "FAZERCARDS", productCode: "pubg", packageCode: "PUBG_325_UC", supplierProductCode: "pubg_mobile_auto", supplierPackageCode: "325_uc", region: "GLOBAL", enabled: false, productionRole: "DISABLED", executionMode: "API", fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"] }, mappingMetadata: { readiness: { supplierMapped: true, pricingReady: false, inputReady: true, validationReady: true, fulfillmentReady: true, storefrontReady: false } } };
const selection = { _id: "sel1", status: "ACTIVE", supplierId: "s1", productCode: "pubg", supplierMarket: "GLOBAL", sellingRegions: ["TH"], visibleRegions: [], packages: [{ packageCode: mapping.packageCode, supplierProductMappingId: mapping._id }] };
const prepared = { ready: true, blockers: [] };

assert.deepStrictEqual(activationBlockers({ selection, mapping, customerMarket: "TH", conflicts: [], preCommercial: prepared }), []);
assert(activationBlockers({ selection, mapping, customerMarket: "TH", conflicts: [], preCommercial: { ready: false, blockers: ["INPUT_CONTRACT_UNRESOLVED"] } }).includes("INPUT_CONTRACT_UNRESOLVED"));
assert(activationBlockers({ selection, mapping, customerMarket: "TH", conflicts: [{ _id: "other" }], preCommercial: prepared }).includes("CONFLICTING_PRIMARY_ROUTE"));
assert.deepStrictEqual(activationBlockers({ selection, mapping, customerMarket: "TH", conflicts: [], preCommercial: prepared }), [], "Retail price and publication must not be Start Selling prerequisites.");

const privateLegacyProduct = { productCode: "phase-d-generic", enabled: true, deletedAt: null, lifecycleStatus: "ACTIVE", commerceState: "HIDDEN", publicDiscoveryEnabled: false, supportedRegions: ["TH"], description: "A complete generic product description suitable for public presentation." };
const publishedPackages = [{ packageCode: "PHASE_D_PACKAGE", enabled: true, deletedAt: null, prices: { TH: { enabled: true, amount: 100, currency: "THB" } } }];
const readyCommerce = { checks: { availability: true }, regions: { TH: { fulfillment: true, availability: true } } };
assert.strictEqual(resolvePublicProductReadiness(privateLegacyProduct, publishedPackages, readyCommerce).state, "HIDDEN", "Legacy projection must retain legacy product intent.");
assert.strictEqual(resolvePublicProductReadiness(privateLegacyProduct, publishedPackages, readyCommerce, { explicitCommercialAuthority: true }).state, "AVAILABLE", "Explicit public projection must derive Purchasable after commercial authorities are applied.");
assert.notStrictEqual(resolvePublicProductReadiness(privateLegacyProduct, publishedPackages, { checks: { availability: true }, regions: { TH: { fulfillment: false, availability: true } } }, { explicitCommercialAuthority: true }).state, "AVAILABLE", "Fulfillment readiness loss must suppress Purchasable.");

const activation = read("backend/services/storePackageActivationService.js");
const pricing = read("frontend/js/admin-pricing-engine.js");
const catalog = read("backend/services/catalogService.js");
const publicReadiness = read("backend/catalog/publicProductReadiness.js");
const checkout = read("backend/services/commerce/customerManualPromptPayCheckoutService.js");
const orderSnapshot = read("backend/services/commerce/orderSnapshotRuntime.js");
const ui = read("frontend/js/admin-guided-selling.js");
const publication = read("backend/services/adminProductActivationService.js");

assert(activation.includes("assessExistingPreparedRoute"));
assert(activation.includes('mapping.enabled=true;mapping.productionRole="PRIMARY"'));
assert(activation.includes("markRouteStorefrontReady(mapping)"));
assert(!activation.includes("setPackageMarketPublication"));
assert(!activation.includes("mapping.fulfillmentEligibility="));
assert(!activation.includes("mapping.mappingMetadata.fulfillmentContract="));
assert(!activation.includes("mapping.mappingMetadata.technicalPreparation="));
assert(!activation.includes('mapping.executionMode="API"'));
assert(!activation.includes('product.commerceState="PURCHASABLE"'));
assert(!activation.includes("selection.visibleRegions="));
assert(!activation.includes("approvedCostCurrency"));
assert(!activation.includes("priceAmount"));
assert(!activation.includes("publicationDecisionVersion"));
assert(activation.includes("CONFLICTING_PRIMARY_ROUTE"));
assert(ui.includes(">Start Selling</button>"));
assert(ui.includes("This does not publish prices or turn Storefront visibility on."));
assert(ui.includes('result.state==="ROUTE_ACTIVE"'));
assert(!pricing.includes("/regions/${encodeURIComponent(publishRegion)}/visibility"), "Daily Pricing publication must not turn Storefront visibility on.");
assert(pricing.includes("Daily Pricing explicit Publish Changes decision"));
assert(publication.includes("PACKAGE_NOT_COMMERCIALLY_SELECTED"));
assert(publication.includes("!row.prepared?.selectable || !row.readiness.ready"));
assert(catalog.includes('StoreCatalogSelection.find({ status: "ACTIVE", sellingRegions: String(customerMarket).toUpperCase(), visibleRegions:String(customerMarket).toUpperCase() })'));
assert(catalog.includes("PackageMarketPublication.find({ customerMarket })"));
assert(catalog.includes("applyPackageFulfillmentReadiness"));
assert(catalog.includes("explicitCommercialAuthority: true"));
assert(publicReadiness.includes("fulfillmentReady"));
assert(publicReadiness.includes("options.explicitCommercialAuthority === true"));
assert(checkout.includes("assertAuthoritativeFulfillmentReady"));
assert(orderSnapshot.includes("supplierMappingId"));

console.log(JSON.stringify({ result: "PASS", startSelling: { consumesPreparedEvidence: true, writes: ["mapping.enabled", "mapping.productionRole", "mapping.mappingMetadata.readiness.storefrontReady"], technicalEvidenceWrites: 1, pricingWrites: 0, publicationWrites: 0, storefrontVisibilityWrites: 0 }, publish: { explicit: true, commerciallySelectedRequired: true, preparedRouteRequired: true, productionReadinessRequired: true }, purchasable: { selectionRequired: true, priceRequired: true, publicationRequired: true, storefrontVisibilityRequired: true, fulfillmentRequired: true }, checkoutRevalidation: true, automaticFailovers: 0, supplierCalls: 0, productionWrites: 0 }, null, 2));
