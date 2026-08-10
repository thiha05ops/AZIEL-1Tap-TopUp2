const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "../..", ".env")
});

const {
    CANONICAL_OPERATIONAL_PRODUCTS,
    resolveCanonicalProductRoute
} = require("../catalog/canonicalOperationalCatalog");
const { toPublicCatalog } = require("../services/catalogService");

const ROOT = path.join(__dirname, "../..");
const GENERIC_FALLBACK = "coming-soon.html";

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertFileExists(relativePath) {
    assert(fs.existsSync(path.join(ROOT, relativePath)), `${relativePath} must exist`);
}

function routePath(route = "") {
    return String(route || "").split("?")[0];
}

function assertCanonicalRoutes() {
    const destinations = {};

    CANONICAL_OPERATIONAL_PRODUCTS.forEach(product => {
        const route = resolveCanonicalProductRoute(product.productCode);
        assert(route, `${product.productCode} must resolve to a canonical destination.`);
        assert(!route.includes(GENERIC_FALLBACK), `${product.productCode} must not resolve to generic unavailable fallback.`);
        assertFileExists(`frontend/${routePath(route)}`);
        destinations[product.productCode] = route;
    });

    assert.strictEqual(Object.keys(destinations).length, 16, "All 16 canonical products must have routes.");
    return destinations;
}

function assertFrontendUsesCanonicalRouteSource(destinations) {
    const presentation = read("frontend/js/catalog-presentation.js");
    const homePlacement = read("frontend/js/home-placement-runtime.js");
    const mobileCarousel = read("frontend/js/home-mobile-category-carousel.js");
    const discovery = read("frontend/js/catalog-discovery.js");
    const search = read("frontend/js/search.js");

    assert(presentation.includes("CANONICAL_PRODUCT_ROUTES"), "Frontend presentation must own one canonical route map.");
    assert(presentation.includes("resolveCanonicalProductRoute"), "Frontend presentation must export canonical route resolver.");

    Object.entries(destinations).forEach(([code, route]) => {
        assert(presentation.includes(code), `Frontend canonical route map missing ${code}.`);
        assert(presentation.includes(route), `Frontend canonical route map missing route ${route}.`);
        assert(!presentation.includes(`coming-soon.html?product=${code}`), `${code} must not point to generic fallback in presentation map.`);
    });

    assert(homePlacement.includes("resolveCanonicalProductRoute"), "Home placement cards must use canonical route resolver.");
    assert(mobileCarousel.includes("resolveCanonicalProductRoute"), "Mobile storefront rows must use canonical route resolver.");
    assert(discovery.includes("product.route"), "Catalog discovery cards must use product.route.");
    assert(search.includes("product.route"), "Search results must use product.route.");
    assert(homePlacement.includes("coming-soon.html?product="), "Generic fallback must remain for true unavailable/discovery-only products.");
}

function assertPaymentPricingUntouched() {
    [
        "backend/routes/payment.js",
        "backend/routes/wallet.js",
        "backend/services/commerce/checkoutApplicationService.js",
        "backend/services/commerce/pricingCalculationEngine.js",
        "frontend/js/payment/payment-engine.js",
        "frontend/js/prices.js",
        "frontend/js/game-flow.js"
    ].forEach(relativePath => {
        const source = read(relativePath);
        assert(!source.includes("CANONICAL_PRODUCT_ROUTES"), `${relativePath} must not depend on storefront routing.`);
        assert(!source.includes("resolveCanonicalProductRoute"), `${relativePath} must not depend on storefront routing.`);
    });
}

async function assertDatabaseProjection(destinations) {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        return { skipped: true, reason: "MONGO_URI not configured" };
    }

    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });

    try {
        const products = await toPublicCatalog({
            source: "database",
            includeDisabled: true,
            includeAssetProjection: false,
            includeAdminPricing: false
        });
        const byCode = new Map(products.map(product => [product.productCode, product]));
        Object.entries(destinations).forEach(([code, route]) => {
            const product = byCode.get(code);
            assert(product, `${code} must project from database catalog.`);
            assert.strictEqual(product.productRoute, route, `${code} database projection route mismatch.`);
            assert(!String(product.productRoute || "").includes(GENERIC_FALLBACK), `${code} database projection must not use fallback.`);
        });
    } finally {
        await mongoose.disconnect();
    }

    return { skipped: false };
}

async function run() {
    const destinations = assertCanonicalRoutes();
    assertFrontendUsesCanonicalRouteSource(destinations);
    assertPaymentPricingUntouched();
    const databaseProjection = await assertDatabaseProjection(destinations);

    return {
        canonicalDestinations: destinations,
        storefrontRouteSource: "frontend/js/catalog-presentation.js::CANONICAL_PRODUCT_ROUTES",
        backendRouteSource: "backend/catalog/canonicalOperationalCatalog.js",
        fallbackBehavior: "coming-soon.html remains only for non-canonical/unavailable fallback resolution.",
        databaseProjection,
        paymentPricingUntouched: true
    };
}

if (require.main === module) {
    run()
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => {
            console.error(error?.message || error);
            process.exitCode = 1;
        });
}

module.exports = { run };
