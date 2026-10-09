"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { projectCommerceReadiness } = require("../services/catalogService");
const { resolvePublicProductReadiness } = require("../catalog/publicProductReadiness");

const product = {
    productCode: "mlbb",
    productRoute: "mlbb.html",
    enabled: true,
    publicDiscoveryEnabled: true,
    commerceState: "PURCHASABLE",
    lifecycleStatus: "ACTIVE",
    supportedRegions: ["MM", "TH"],
    productKnowledge: {},
    seo: {}
};
const pkg = {
    _id: "package-1",
    productCode: "mlbb",
    packageCode: "TEST_PACKAGE",
    enabled: true,
    prices: {
        MM: { amount: 1000, enabled: true, currency: "MMK" },
        TH: { amount: 30, enabled: true, currency: "THB" }
    }
};
const mmMapping = {
    productCode: "mlbb",
    packageCode: "TEST_PACKAGE",
    region: "MM",
    enabled: true,
    supplierId: "supplier-1"
};
const wonddThMapping = {
    ...mmMapping,
    region: "TH",
    supplierCode: "WONDD",
    supplierProductCode: "mlbb",
    supplierPackageCode: "MLTEST",
    productionRole: "PRIMARY",
    executionMode: "API",
    fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "verifier", verifiedAt: "2026-08-30T00:00:00.000Z", version: 1 },
    mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, validationReady: true, pricingReady: true, fulfillmentReady: true, storefrontReady: true } }
};
const supplier = { _id: "supplier-1", supplierCode: "WONDD", enabled: true, mode: "API", supportedRegions: ["TH"] };
const eligibilityContext = { adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }), mappingSupportResolver: () => true };

function readiness(packages, mappings, overrides = {}, suppliers = []) {
    const subject = { ...product, ...overrides };
    const commerce = projectCommerceReadiness(subject, packages, mappings, [], suppliers, eligibilityContext);
    return resolvePublicProductReadiness(subject, packages, commerce);
}

const noFulfillment = readiness([pkg], []);
assert.strictEqual(noFulfillment.state, "COMING_SOON");
assert.strictEqual(noFulfillment.regions.MM.state, "COMING_SOON");
assert(noFulfillment.regions.MM.blockers.includes("fulfillment"));
assert(!noFulfillment.regions.MM.blockers.includes("availability"), "Missing fulfillment must not be mislabeled as missing inventory availability.");

const mmOnly = readiness([pkg], [mmMapping]);
assert.strictEqual(mmOnly.state, "AVAILABLE");
assert.strictEqual(mmOnly.regions.MM.state, "AVAILABLE");
assert.strictEqual(mmOnly.regions.TH.state, "COMING_SOON");

const bothRegions = readiness([pkg], [mmMapping, wonddThMapping], {}, [supplier]);
assert.strictEqual(bothRegions.regions.MM.state, "AVAILABLE");
assert.strictEqual(bothRegions.regions.TH.state, "AVAILABLE");

assert.notStrictEqual(readiness([], []).state, "AVAILABLE");
assert.strictEqual(readiness([pkg], [mmMapping], { commerceState: "HIDDEN" }).state, "HIDDEN");
assert.strictEqual(readiness([pkg], [mmMapping], { productCode: "aovid" }).state, "COMING_SOON");

const futureMapping = readiness([pkg], [wonddThMapping], {}, [supplier]);
assert.strictEqual(futureMapping.regions.TH.state, "AVAILABLE", "A legitimate future mapping must enable readiness without product exceptions.");

const root = path.resolve(__dirname, "../..");
const checkout = fs.readFileSync(path.join(root, "backend/services/commerce/customerManualPromptPayCheckoutService.js"), "utf8");
const catalogRuntime = fs.readFileSync(path.join(root, "frontend/js/catalog-runtime.js"), "utf8");
assert(checkout.includes("assertAuthoritativeFulfillmentReady"));
assert(checkout.includes("packageCode: catalog.packageCode"));
assert(checkout.includes("region: catalog.region"));
assert(checkout.includes("enabled: true"));
assert(checkout.includes("FULFILLMENT_UNAVAILABLE"));
assert(catalogRuntime.includes("item.fulfillmentRegions[region] !== true"));
assert(!fs.readFileSync(path.join(root, "backend/catalog/publicProductReadiness.js"), "utf8").includes('productCode === "pubg"'));

console.log("Fulfillment-aware public readiness verification passed.");
