"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const mongoose = require("mongoose");

const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const SitePlacement = require("../models/SitePlacement");
const {
    CANONICAL_OPERATIONAL_PRODUCTS,
    genericProductRoute,
    isSafeStorefrontProductRoute,
    resolveCanonicalProductRoute
} = require("../catalog/canonicalOperationalCatalog");
const { updateProduct } = require("../services/catalogAdminService");
const { toPublicCatalog } = require("../services/catalogService");
const { updateAdminPlacement } = require("../services/sitePlacementService");

const ROOT = path.resolve(__dirname, "../..");
const PRODUCT_CODE = "capcut";
const PACKAGE_CODE = "ROUTE_AUTHORITY_ISOLATED";

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function presentationRuntime() {
    const document = { querySelectorAll() { return []; } };
    const sandbox = { URL, document, window: { document } };
    vm.runInContext(read("frontend/js/catalog-presentation.js"), vm.createContext(sandbox), { filename: "catalog-presentation.js" });
    return sandbox.window.AZIEL_CATALOG_PRESENTATION;
}

function verifyBackendContract() {
    const destinations = Object.fromEntries(CANONICAL_OPERATIONAL_PRODUCTS.map(product => [
        product.productCode,
        resolveCanonicalProductRoute(product.productCode)
    ]));
    assert.strictEqual(destinations.mlbb, "mlbb.html");
    assert.strictEqual(destinations.pubg, "pubg.html");
    assert.strictEqual(destinations.freefire, "freefire.html");
    assert.strictEqual(destinations.hok, "hok.html");
    assert.strictEqual(destinations.telegram, "telegram.html");
    assert.strictEqual(destinations.capcut, "product.html?product=capcut");
    assert.strictEqual(resolveCanonicalProductRoute("unknown-safe-product"), "product.html?product=unknown-safe-product");
    assert.strictEqual(genericProductRoute("bad/value"), "");
    ["javascript:alert(1)", "data:text/html,bad", "//evil.example/x", "https://evil.example/x", "/absolute/path", "\\\\evil.example\\x"]
        .forEach(route => assert.strictEqual(isSafeStorefrontProductRoute(route), false, `${route} must be rejected.`));
    ["mlbb.html", "product.html?product=capcut", "products/detail.html?id=one#buy"]
        .forEach(route => assert.strictEqual(isSafeStorefrontProductRoute(route), true, `${route} must remain valid.`));
    Object.values(destinations).forEach(route => {
        assert(isSafeStorefrontProductRoute(route));
        assert(fs.existsSync(path.join(ROOT, "frontend", route.split(/[?#]/)[0])), `${route} must resolve to an existing storefront page.`);
    });
}

function verifyFrontendContract() {
    const presentation = presentationRuntime();
    const serverRoute = "server-projected-detail.html?product=mlbb";
    const display = presentation.buildDisplayProduct({
        productCode: "mlbb",
        productRoute: serverRoute,
        publicCategory: "mobile",
        homepageFlags: []
    });
    assert.strictEqual(display.route, serverRoute, "Projected route must win even for a product that historically had a conflicting frontend route.");
    assert.strictEqual(presentation.resolveProductRoute("", "unknown-safe-product"), "product.html?product=unknown-safe-product");
    assert.strictEqual(presentation.resolveProductRoute("javascript:alert(1)", "mlbb"), "product.html?product=mlbb");

    const source = read("frontend/js/catalog-presentation.js");
    assert(!source.includes("CANONICAL_PRODUCT_ROUTES"), "Frontend canonical route map must be removed.");
    assert(!source.includes("resolveCanonicalProductRoute"), "Frontend must not resolve dedicated routes by product code.");
    assert(!/\broute:\s*(?:"[^\"]*\.html|CANONICAL_PRODUCT_ROUTES)/.test(source), "Presentation records must not own product routes.");
    ["frontend/js/catalog-discovery.js", "frontend/js/search.js"].forEach(file => {
        assert(read(file).includes("product.route"), `${file} must consume projected routes.`);
    });
    assert(read("frontend/js/home-placement-runtime.js").includes("resolveProductRoute?.(product.productRoute || product.route"));
    assert(read("frontend/js/home-mobile-category-carousel.js").includes("resolveProductRoute?.(product.productRoute || product.route"));
    assert(read("frontend/js/product-detail.js").includes("URLSearchParams"), "Generic product detail must resolve query-string identity.");
}

function verifyAdminContract() {
    const frontend = read("frontend/js/admin-catalog.js");
    const service = read("backend/services/catalogAdminService.js");
    assert(frontend.includes('id="catalogProductRoute" type="text" maxlength="240" readonly'));
    const payload = frontend.slice(frontend.indexOf("function readProductEditorPayload"), frontend.indexOf("async function saveProductEditor"));
    assert(!payload.includes("productRoute:"), "Admin must not submit a route value that runtime ignores.");
    const patchBuilder = service.slice(service.indexOf("function buildProductPatch"), service.indexOf("function buildPackagePatch"));
    assert(!patchBuilder.includes('"productRoute"'), "Admin patch API must not advertise canonical route editing.");
}

function isolatedMongoUri() {
    require("dotenv").config({ quiet: true });
    const configured = String(process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
    if (!configured) throw new Error("MONGO_URI is required for isolated verification.");
    const parsed = new URL(configured);
    parsed.pathname = "/aziel_e2e_product_route_authority";
    const uri = parsed.toString();
    if (!uri.includes("/aziel_e2e_product_route_authority")) throw new Error("Route verifier refused a non-isolated database URI.");
    return uri;
}

async function publicFixture() {
    const catalog = await toPublicCatalog({ source: "database", includeDisabled: true });
    return catalog.find(product => product.productCode === PRODUCT_CODE);
}

async function patchFixture(patch) {
    const product = await CatalogProduct.findOne({ productCode: PRODUCT_CODE });
    return updateProduct({ productCode: PRODUCT_CODE, patch: { ...patch, expectedUpdatedAt: product.updatedAt }, actor: "isolated-route-verifier" });
}

async function verifyIsolatedComposition() {
    await mongoose.connect(isolatedMongoUri());
    try {
        await SitePlacement.deleteMany({ placementCode: "HOME_POPULAR_GAMES" });
        await CatalogPackage.deleteMany({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE });
        await CatalogProduct.deleteMany({ productCode: PRODUCT_CODE });
        await CatalogProduct.create({
            productCode: PRODUCT_CODE,
            name: "Route Authority Fixture",
            description: "Isolated canonical fixture for product route authority verification.",
            enabled: true,
            catalogCategory: "MOBILE_GAME_TOPUP",
            lifecycleStatus: "ACTIVE",
            commerceState: "PURCHASABLE",
            publicDiscoveryEnabled: true,
            homepageEnabled: true,
            homepageOrder: 42,
            productRoute: "javascript:legacy-admin-route",
            artworkPath: "assets/giftcards/capcut.webp",
            supportedRegions: ["MM"],
            fulfillment: { manualAllowedRegions: ["MM"] },
            source: "admin"
        });
        await CatalogPackage.create({
            productCode: PRODUCT_CODE,
            packageCode: PACKAGE_CODE,
            name: "Route Authority Package",
            enabled: true,
            prices: {
                MM: { amount: 1000, currency: "MMK", enabled: true, supplierCost: 500, supplierCurrency: "MMK" },
                TH: { amount: 30, currency: "THB", enabled: true, supplierCost: 20, supplierCurrency: "THB" }
            },
            source: "admin"
        });

        let projected = await publicFixture();
        assert.strictEqual(projected.productRoute, "product.html?product=capcut", "Unsafe persisted route must not override canonical projection.");
        assert.strictEqual(projected.packages[0].prices.TH, undefined, "Route authority must preserve MM-only projection.");
        const route = projected.productRoute;

        await patchFixture({ catalogCategory: "DIGITAL_SERVICE" });
        assert.strictEqual((await publicFixture()).productRoute, route, "Category movement must not change route.");
        await updateAdminPlacement("HOME_POPULAR_GAMES", { managed: true, items: [] }, "isolated-route-verifier");
        assert.strictEqual((await publicFixture()).productRoute, route, "Home placement must not change route.");
        await patchFixture({ enabled: false });
        assert.strictEqual((await publicFixture()).productRoute, route, "Disable must not corrupt route.");
        await patchFixture({ enabled: true });
        assert.strictEqual((await publicFixture()).productRoute, route, "Re-enable must not corrupt route.");
        await assert.rejects(
            patchFixture({ productRoute: "other.html" }),
            error => error?.code === "CATALOG_PATCH_INVALID"
        );
        const storedPackage = await CatalogPackage.findOne({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE }).lean();
        assert.strictEqual(storedPackage.prices.MM.amount, 1000);
        assert.strictEqual(storedPackage.prices.TH.amount, 30);
        console.log("Isolated product route authority composition verification passed.");
    } finally {
        await SitePlacement.deleteMany({ placementCode: "HOME_POPULAR_GAMES" });
        await CatalogPackage.deleteMany({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE });
        await CatalogProduct.deleteMany({ productCode: PRODUCT_CODE });
        await mongoose.disconnect();
    }
}

async function main() {
    verifyBackendContract();
    verifyFrontendContract();
    verifyAdminContract();
    if (process.argv.includes("--isolated")) await verifyIsolatedComposition();
    console.log("Product route authority verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
