const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { CANONICAL_OPERATIONAL_PRODUCTS } = require("../catalog/canonicalOperationalCatalog");
const { resolvePublicProductReadiness } = require("../catalog/publicProductReadiness");

const product = { ...CANONICAL_OPERATIONAL_PRODUCTS[0], enabled: true, publicDiscoveryEnabled: true, commerceState: "PURCHASABLE", productKnowledge: {} };
const pricedPackage = { enabled: true, packageCode: "TEST", prices: { MM: { amount: 1000, enabled: true, currency: "MMK" } } };
const ready = resolvePublicProductReadiness(product, [pricedPackage], { checks: { fulfillment: true, availability: true } });
assert.equal(ready.state, "AVAILABLE");
assert.equal(ready.regions.MM.state, "AVAILABLE");
assert.equal(ready.regions.TH.state, "COMING_SOON");
assert.equal(resolvePublicProductReadiness(product, [], { checks: { fulfillment: true, availability: true } }).state, "COMING_SOON");
assert.equal(resolvePublicProductReadiness({ ...product, publicDiscoveryEnabled: false }, [pricedPackage], { checks: { fulfillment: true, availability: true } }).state, "HIDDEN");
assert.equal(resolvePublicProductReadiness({ ...product, lifecycleStatus: "COMING_SOON" }, [pricedPackage], { checks: { fulfillment: true, availability: true } }).state, "COMING_SOON");
assert.equal(resolvePublicProductReadiness({ ...product, productCode: "aovid" }, [pricedPackage], { checks: { fulfillment: true, availability: true } }).state, "HIDDEN");
assert.equal(CANONICAL_OPERATIONAL_PRODUCTS.length, 19);

const root = path.resolve(__dirname, "../..");
const stage = fs.readFileSync(path.join(root, "frontend/js/product-detail-stage.js"), "utf8");
assert(stage.includes("resolveAndRenderPublicState"));
assert(stage.includes("applyProductSeo"));
assert(stage.includes('renderUnavailableState(product, state)'));
assert(stage.includes('orderLayout.hidden = true'));
assert(stage.includes('orderLayout.hidden = false'));
assert(stage.includes('explore.href = "/mobile-games.html"'));
const productDetailCss = fs.readFileSync(path.join(root, "frontend/css/game/product-detail-desktop.css"), "utf8");
assert(productDetailCss.includes(".az-product-detail [hidden]"));
assert(productDetailCss.includes("display: none !important"));
const home = fs.readFileSync(path.join(root, "frontend/js/home-placement-runtime.js"), "utf8");
assert(home.includes("product.discoverable === true") && home.includes("product.publicState !== \"HIDDEN\""));
assert(home.includes("readinessBadge(product)"));

console.log("Storefront product readiness verification passed.");
