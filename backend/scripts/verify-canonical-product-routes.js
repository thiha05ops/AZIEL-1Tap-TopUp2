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
        assertFileExists(`frontend/${routePath(route)}`);
        destinations[product.productCode] = route;
    });

    assert.strictEqual(Object.keys(destinations).length, CANONICAL_OPERATIONAL_PRODUCTS.length, "Every registered dedicated-page product must have a route.");
    return destinations;
}

function assertFrontendUsesCanonicalRouteSource(destinations) {
    const presentation = read("frontend/js/catalog-presentation.js");
    const homePlacement = read("frontend/js/home-placement-runtime.js");
    const mobileCarousel = read("frontend/js/home-mobile-category-carousel.js");
    const discovery = read("frontend/js/catalog-discovery.js");
    const search = read("frontend/js/search.js");

    assert(!presentation.includes("CANONICAL_PRODUCT_ROUTES"), "Frontend must not duplicate the backend canonical route map.");
    assert(presentation.includes("resolveProductRoute"), "Frontend presentation must expose only projected-route plus generic fallback handling.");

    Object.entries(destinations).forEach(([code, route]) => {
        assert(route, `${code} backend route missing.`);
    });

    assert(homePlacement.includes("resolveProductRoute"), "Home placement cards must consume projected routes.");
    assert(mobileCarousel.includes("resolveProductRoute"), "Mobile storefront rows must consume projected routes.");
    assert(discovery.includes("product.route"), "Catalog discovery cards must use product.route.");
    assert(search.includes("product.route"), "Search results must use product.route.");
    assert(presentation.includes("product.html?product="), "One generic defensive product fallback must remain.");
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
    const databaseProjection = process.argv.includes("--database")
        ? await assertDatabaseProjection(destinations)
        : { skipped: true, reason: "database verification requires --database" };

    return {
        canonicalDestinations: destinations,
        storefrontRouteSource: "public Catalog productRoute",
        backendRouteSource: "backend/catalog/canonicalOperationalCatalog.js",
        fallbackBehavior: "product.html?product=<code> is the dedicated-page and malformed-payload generic fallback.",
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
