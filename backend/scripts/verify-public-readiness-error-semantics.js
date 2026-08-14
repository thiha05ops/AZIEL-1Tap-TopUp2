"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    PUBLIC_AVAILABILITY,
    availabilityReason,
    resolvePublicProductReadiness
} = require("../catalog/publicProductReadiness");
const { CANONICAL_OPERATIONAL_PRODUCTS } = require("../catalog/canonicalOperationalCatalog");

const ROOT = path.resolve(__dirname, "../..");
const source = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const canonical = CANONICAL_OPERATIONAL_PRODUCTS[0];
const product = {
    ...canonical,
    enabled: true,
    publicDiscoveryEnabled: true,
    lifecycleStatus: "ACTIVE",
    commerceState: "PURCHASABLE",
    supportedRegions: ["MM"],
    productKnowledge: { shortDescription: "A sufficiently descriptive isolated catalog fixture for readiness verification." }
};
const pkg = {
    packageCode: "P1",
    enabled: true,
    prices: { MM: { amount: 1000, currency: "MMK", enabled: true } }
};
const commerce = {
    checks: { availability: true },
    regions: {
        MM: { fulfillment: true, availability: true },
        TH: { fulfillment: false, availability: true }
    }
};

const available = resolvePublicProductReadiness(product, [pkg], commerce);
assert.equal(available.availabilityCode, PUBLIC_AVAILABILITY.AVAILABLE);
assert.equal(available.regions.MM.availabilityCode, PUBLIC_AVAILABILITY.AVAILABLE);
assert.equal(available.regions.TH.availabilityCode, PUBLIC_AVAILABILITY.REGION_UNAVAILABLE);

const comingSoon = resolvePublicProductReadiness({ ...product, lifecycleStatus: "COMING_SOON" }, [pkg], commerce);
assert.equal(comingSoon.availabilityCode, PUBLIC_AVAILABILITY.COMING_SOON);
assert.notEqual(comingSoon.availabilityReason, availabilityReason("PRICING_UNAVAILABLE"));

const hidden = resolvePublicProductReadiness({ ...product, publicDiscoveryEnabled: false }, [pkg], commerce);
assert.equal(hidden.availabilityCode, PUBLIC_AVAILABILITY.PRODUCT_HIDDEN);
const disabled = resolvePublicProductReadiness({ ...product, enabled: false }, [pkg], commerce);
assert.equal(disabled.availabilityCode, PUBLIC_AVAILABILITY.PRODUCT_DISABLED);

const noPackages = resolvePublicProductReadiness(product, [], commerce);
assert.equal(noPackages.availabilityCode, PUBLIC_AVAILABILITY.SETUP_INCOMPLETE);
assert.equal(noPackages.regions.MM.availabilityCode, PUBLIC_AVAILABILITY.SETUP_INCOMPLETE);

const unavailableInventory = resolvePublicProductReadiness(product, [pkg], {
    checks: { availability: false },
    regions: { MM: { fulfillment: true, availability: false } }
});
assert.equal(unavailableInventory.regions.MM.availabilityCode, PUBLIC_AVAILABILITY.PACKAGE_UNAVAILABLE);

assert.equal(availabilityReason("PRICING_UNAVAILABLE"), "Prices are temporarily unavailable. Please try again shortly.");
assert.equal(availabilityReason("CATALOG_UNAVAILABLE"), "Catalog is temporarily unavailable. Please try again shortly.");

const catalogRoute = source("backend/routes/catalog.js");
assert(catalogRoute.includes('availabilityCode: "CATALOG_UNAVAILABLE"'));
assert(catalogRoute.includes("includeDisabled: true"));
assert(catalogRoute.includes("if (!product.discoverable)"));

const preview = source("backend/services/commerce/commercePricingPreviewService.js");
assert(preview.includes('"REGION_UNAVAILABLE"'));
assert(preview.includes('"PACKAGE_UNAVAILABLE"'));

const runtime = source("frontend/js/catalog-runtime.js");
assert(runtime.includes("function getAvailability"));
assert(runtime.includes("CATALOG_UNAVAILABLE"));
const prices = source("frontend/js/prices.js");
assert(prices.includes("businessUnavailable"));
assert(prices.includes('availabilityMessage("CATALOG_UNAVAILABLE"'));
assert(prices.includes("clearSelectedPackage(\"no_regional_packages\")"));
const detail = source("frontend/js/product-detail-stage.js");
assert(detail.includes("resolveDirectAvailability(gameKey)"));
assert(detail.includes("product.availabilityReason"));
const flow = source("frontend/js/game-flow.js");
assert(flow.includes('availabilityMessage?.("CATALOG_UNAVAILABLE")'));
assert(flow.includes('availability.code === "AVAILABLE" ? "PACKAGE_UNAVAILABLE"'));
const discovery = source("frontend/js/catalog-discovery.js");
assert(discovery.includes("No products are available in this category yet."));
assert(discovery.includes("Catalog is temporarily unavailable. Please try again shortly."));

console.log("Public readiness/error semantics verification passed.");
console.log("Business unavailability, region/package state, and real Catalog/Pricing failures remain distinct.");
