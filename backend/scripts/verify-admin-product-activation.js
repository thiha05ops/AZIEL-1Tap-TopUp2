"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { projectActivation } = require("../services/adminProductActivationService");
const { compareSupplierCost } = require("../services/supplierCatalog/supplierCostComparisonService");

const oid = value => ({ _id: value });
const now = new Date();
const products = [
    { ...oid("product-valorant"), productCode: "valorant", name: "VALORANT", enabled: true, commerceState: "ACTIVE", publicDiscoveryEnabled: true },
    { ...oid("product-afk"), productCode: "afk-journey", name: "AFK Journey", enabled: false, commerceState: "HIDDEN", publicDiscoveryEnabled: false }
];
const packages = [
    { ...oid("package-valorant"), productCode: "valorant", packageCode: "VP_475", name: "475 VP", enabled: true, deletedAt: null, prices: { TH: { enabled: true, amount: 149, currency: "THB" } } },
    { ...oid("package-afk"), productCode: "afk-journey", packageCode: "DRAGON_CRYSTALS_60", name: "60 Dragon Crystals", enabled: false, deletedAt: null, prices: {} }
];
const suppliers = [{ ...oid("supplier-fazer"), supplierCode: "FAZERCARDS", name: "FazerCards", enabled: true, mode: "API" }];
const supplierProducts = [
    { ...oid("sp-valorant"), normalizedInputContract: { fields: ["riot_id", "tagline"] }, requiredFields: ["riot_id", "tagline"] },
    { ...oid("sp-afk"), normalizedInputContract: {}, requiredFields: [] }
];
const offers = [
    { ...oid("offer-valorant"), supplierId: "supplier-fazer", supplierCatalogProductId: "sp-valorant", supplierProductCode: "valorant_global", supplierOfferCode: "vp_475", supplierOfferName: "475 VP", catalogLifecycleState: "ACTIVE", normalizedSemantics: { type: "DENOMINATION", amount: 475 } },
    { ...oid("offer-afk"), supplierId: "supplier-fazer", supplierCatalogProductId: "sp-afk", supplierProductCode: "afk_journey", supplierOfferCode: "dc_60", supplierOfferName: "60 Dragon Crystals", catalogLifecycleState: "ACTIVE", normalizedSemantics: { type: "DENOMINATION", amount: 60 } }
];
const baseMapping = {
    supplierId: "supplier-fazer", supplierCode: "FAZERCARDS", enabled: false, productionRole: "DISABLED", executionMode: "MANUAL", archivedAt: null,
    supplierMarketEvidence: { marketClassification: "PROVIDER_DECLARED", restrictions: [] },
    mappingMetadata: { readiness: { supplierMapped: true, pricingReady: false, inputReady: false, fulfillmentReady: false } },
    fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", version: 1 }, updatedAt: now
};
const mappings = [
    { ...oid("mapping-valorant"), ...baseMapping, productCode: "valorant", packageCode: "VP_475", supplierProductCode: "valorant_global", supplierPackageCode: "vp_475", supplierCatalogOfferId: "offer-valorant", region: "TH" },
    { ...oid("mapping-afk"), ...baseMapping, productCode: "afk-journey", packageCode: "DRAGON_CRYSTALS_60", supplierProductCode: "afk_journey", supplierPackageCode: "dc_60", supplierCatalogOfferId: "offer-afk", region: "GLOBAL" }
];
const availability = offers.map(offer => ({ supplierCatalogOfferId: offer._id, state: "AVAILABLE", evidenceCode: "PROVIDER_LISTED", coverageComplete: true, observedAt: now }));
const data = { products, packages, suppliers, mappings, offers, supplierProducts, availability, publications: [] };

const list = projectActivation(data, { customerMarket: "TH" });
assert.equal(list.products.length, 2, "hidden and public Master Catalog products must both be selectable");
assert(list.products.some(item => item.productCode === "afk-journey" && item.commerceState === "HIDDEN"));
assert.equal(list.automaticFailover, false);
assert.equal(list.automaticPublicRepricing, false);

const valorant = projectActivation(data, { productCode: "valorant", supplierMarket: "TH", customerMarket: "TH" });
assert.deepEqual(valorant.markets, ["TH"]);
assert.equal(valorant.packages.length, 1);
assert.equal(valorant.packages[0].supplierPackageCode, "vp_475");
assert.deepEqual(valorant.packages[0].requiredFields, ["riot_id", "tagline"]);
assert(valorant.packages[0].readiness.blockers.includes("FULFILLMENT_ELIGIBILITY_UNKNOWN"));
assert.equal(valorant.packages[0].setup.mapped, true);
assert.equal(valorant.packages[0].setup.available, false, "disabled mappings remain true mapping defects");
assert.deepEqual(valorant.packages[0].setup.blockers, ["MAPPING_DISABLED"]);
assert.equal(valorant.packages[0].publication.published, false, "selection must never publish");
assert.equal(valorant.packages[0].publishedPrice.amount, 149, "published price is projected separately from candidate pricing");

const freshProduct = projectActivation(data, { productCode: "afk-journey", supplierMarket: "GLOBAL", customerMarket: "TH" });
assert.deepEqual(freshProduct.markets, ["GLOBAL"]);
assert.equal(freshProduct.packages.length, 1);
assert.equal(freshProduct.packages[0].productEnabled, false);
assert(freshProduct.packages[0].readiness.blockers.includes("INPUT_NOT_READY"));
assert(freshProduct.packages[0].readiness.blockers.includes("CURRENT_SUPPLIER_COST_MISSING"));
assert(freshProduct.packages[0].readiness.blockers.includes("CUSTOMER_MARKET_PRICE_NOT_PUBLISHED"));

const availableUnpublishedData = { ...data, mappings: [{ ...mappings[0], enabled: true }] };
const availableUnpublished = projectActivation(availableUnpublishedData, { productCode: "valorant", supplierMarket: "TH", customerMarket: "TH" }).packages[0];
assert.equal(availableUnpublished.setup.available, true, "publication prerequisites must not erase exact mapping availability");
assert.equal(availableUnpublished.setup.readyToPublish, false);
assert.equal(availableUnpublished.setup.published, false);
assert.equal(availableUnpublished.setup.pricingPrepared, false);
assert.equal(availableUnpublished.setup.fulfillmentPrepared, false);
assert(availableUnpublished.readiness.blockers.includes("PRICING_NOT_READY"));
assert(availableUnpublished.readiness.blockers.includes("FULFILLMENT_ELIGIBILITY_UNKNOWN"));
assert.equal(availableUnpublished.dailyPricing.previewEligible, false, "missing approved cost must not be treated as numeric zero");

const unsupportedCommerce = projectActivation(data, { productCode: "afk-journey", supplierMarket: "GLOBAL", customerMarket: "SG" });
assert.equal(unsupportedCommerce.commerceMarketSupported, false);
assert(unsupportedCommerce.packages[0].readiness.blockers.includes("CUSTOMER_COMMERCE_MARKET_UNSUPPORTED"));

const root = path.resolve(__dirname, "../..");
const route = fs.readFileSync(path.join(root, "backend/routes/supplier.js"), "utf8");
const service = fs.readFileSync(path.join(root, "backend/services/adminProductActivationService.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "frontend/js/admin-supplier-catalog.js"), "utf8");
assert(route.includes("PERMISSIONS.OWNER_ROUTING_MANAGE"), "route changes remain Owner-authorized");
assert(route.includes("PERMISSIONS.CATALOG_MANAGE"), "publication remains permission protected");
assert(service.includes("setPackageMarketPublication"), "activation must delegate publication authority");
assert(service.includes("basicCandidateBlockers"), "activation must compose fulfillment readiness authority");
assert(service.includes("ACTIVATION_STALE_STATE") && service.includes("ACTIVATION_STALE_PUBLICATION"), "stale Admin state must fail closed");
assert(ui.includes("/api/admin/pricing-engine/workspace") || ui.includes("Open Daily Pricing"), "Daily Pricing must remain the pricing workflow");
assert(!service.includes("startFulfillment") && !service.includes("placeOrder") && !service.includes("purchase("), "activation preparation must not call suppliers or fulfillment");
const initialCost = compareSupplierCost({ amount: 12.5, currency: "USD", observedAt: now }, {});
assert.equal(initialCost.state, "NO_MAPPING_COST_AUTHORITY");
assert.equal(initialCost.promotable, true, "a valid first observed cost must be reviewable through guarded cost authority");
assert(ui.includes("requestId!==productActivationState.requestId"), "stale Product Activation responses must be discarded");
assert(ui.includes("data-activation-fulfillment") && ui.includes("Open Daily Pricing") && ui.includes("Review cost"), "blockers must link to existing Admin authorities");

console.log(JSON.stringify({
    result: "PASS",
    acceptance: {
        valorantTH: { markets: valorant.markets, packageCodes: valorant.packages.map(item => item.packageCode), blockers: valorant.packages[0].readiness.blockers },
        newlyCreatedPrompt1Product: { productCode: "afk-journey", markets: freshProduct.markets, packageCodes: freshProduct.packages.map(item => item.packageCode), blockers: freshProduct.packages[0].readiness.blockers }
    },
    invariants: { mappingAvailabilityDistinctFromPublicationReadiness: true, disabledMappingIsTrueDataDefect: true, missingCostIsNotZero: true, selectionPublishes: false, automaticFailover: false, automaticPublicRepricing: false, unsupportedCommerceMarketBlocked: true }
}, null, 2));
