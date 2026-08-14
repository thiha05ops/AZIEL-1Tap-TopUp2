"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const SitePlacement = require("../models/SitePlacement");
const {
    CANONICAL_PRODUCT_CODES,
    genericProductRoute,
    isCanonicalProductCode,
    resolveCanonicalProductRoute
} = require("../catalog/canonicalOperationalCatalog");
const { updateProduct } = require("../services/catalogAdminService");
const {
    getCatalogProductDetail,
    isAdminCanonicalCatalogProduct,
    resolveAdminCatalogProduct,
    resolvePackagePrice,
    toPublicCatalog
} = require("../services/catalogService");
const { getAdminPlacement, resolveHomePlacements, updateAdminPlacement } = require("../services/sitePlacementService");
const { loadCatalogPackage: loadCommercePreviewPackage } = require("../services/commerce/commercePricingPreviewService");

const ROOT = path.resolve(__dirname, "../..");
const PRODUCT_CODE = "authoritynoncanonicalfixture";
const PACKAGE_CODE = "NONCANONICAL_PACKAGE";

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function verifyPolicySource() {
    assert(CANONICAL_PRODUCT_CODES.length > 0);
    assert.strictEqual(isCanonicalProductCode(PRODUCT_CODE), false);
    assert.strictEqual(genericProductRoute(PRODUCT_CODE), `product.html?product=${PRODUCT_CODE}`);
    assert.strictEqual(resolveCanonicalProductRoute(PRODUCT_CODE), `product.html?product=${PRODUCT_CODE}`);

    const routes = read("backend/routes/catalog.js");
    assert(routes.includes("CANONICAL_OPERATIONAL_PRODUCTS.map"), "Admin list must enumerate the closed canonical registry.");
    assert(!routes.includes('router.post("/admin/catalog/products"'), "Admin must not expose arbitrary product creation.");
    const genericDetail = read("frontend/js/product-detail.js");
    assert(genericDetail.includes("PRODUCT_COPY"), "Generic detail remains bounded to known canonical product contracts.");
    assert(genericDetail.includes('userIdSelector: "#userId"') && genericDetail.includes('zoneIdSelector: ""'), "Generic order fields remain a product-shell contract, not Mongo schema.");
    [
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        "backend/services/commerce/customerWalletCheckoutService.js"
    ].forEach(file => assert(read(file).includes("isCanonicalProductCode(productCode)"), `${file} must enforce canonical membership.`));
    assert(read("backend/services/commerce/adminPricingEngineService.js").includes("CANONICAL_PRICING_PRODUCT_CODES"), "Admin pricing workspace must enumerate only canonical products.");
    assert(read("backend/services/commerce/adminPricingControlCenterService.js").includes("CATALOG_PRODUCT_UNSUPPORTED"), "Direct Admin pricing operations must reject unsupported products.");
}

function isolatedMongoUri() {
    require("dotenv").config({ quiet: true });
    const configured = String(process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
    if (!configured) throw new Error("MONGO_URI is required for isolated verification.");
    const parsed = new URL(configured);
    parsed.pathname = "/aziel_e2e_canonical_membership_policy";
    const uri = parsed.toString();
    if (!uri.includes("/aziel_e2e_canonical_membership_policy")) throw new Error("Membership verifier refused a non-isolated database URI.");
    return uri;
}

async function expectCode(promise, code) {
    await assert.rejects(promise, error => error?.code === code, `Expected ${code}.`);
}

async function verifyIsolatedPolicy() {
    await mongoose.connect(isolatedMongoUri());
    try {
        await SitePlacement.deleteMany({ placementCode: "HOME_POPULAR_GAMES" });
        await CatalogPackage.deleteMany({ productCode: PRODUCT_CODE });
        await CatalogProduct.deleteMany({ productCode: PRODUCT_CODE });
        await CatalogProduct.create({
            productCode: PRODUCT_CODE,
            name: "Unsupported Membership Fixture",
            description: "Valid-looking isolated Mongo product that is intentionally absent from the canonical registry.",
            enabled: true,
            catalogCategory: "MOBILE_GAME_TOPUP",
            lifecycleStatus: "ACTIVE",
            commerceState: "PURCHASABLE",
            publicDiscoveryEnabled: true,
            homepageEnabled: true,
            homepageOrder: 501,
            productRoute: `product.html?product=${PRODUCT_CODE}`,
            artworkPath: "assets/fallbacks/game-topup.svg",
            supportedRegions: ["MM"],
            fulfillment: { manualAllowedRegions: ["MM"] },
            source: "admin"
        });
        await CatalogPackage.create({
            productCode: PRODUCT_CODE,
            packageCode: PACKAGE_CODE,
            name: "Unsupported Fixture Package",
            enabled: true,
            prices: {
                MM: { amount: 1000, currency: "MMK", enabled: true, supplierCost: 500, supplierCurrency: "MMK" },
                TH: { amount: 30, currency: "THB", enabled: true, supplierCost: 20, supplierCurrency: "THB" }
            },
            source: "admin"
        });
        const productBefore = await CatalogProduct.findOne({ productCode: PRODUCT_CODE }).lean();
        const packageBefore = await CatalogPackage.findOne({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE }).lean();

        assert.strictEqual(await resolveAdminCatalogProduct(PRODUCT_CODE), null, "Unsupported product must not enter normal Admin membership.");
        await expectCode(updateProduct({ productCode: PRODUCT_CODE, patch: { enabled: false, expectedUpdatedAt: productBefore.updatedAt } }), "CATALOG_PRODUCT_UNSUPPORTED");

        const publicCatalog = await toPublicCatalog({ source: "database", includeDisabled: false });
        assert(!publicCatalog.some(product => product.productCode === PRODUCT_CODE), "Unsupported product must not enter public membership.");
        const diagnosticCatalog = await toPublicCatalog({ source: "database", includeDisabled: true });
        const diagnostic = diagnosticCatalog.find(product => product.productCode === PRODUCT_CODE);
        assert(diagnostic, "Diagnostic projection must retain the record without deleting it.");
        assert.strictEqual(diagnostic.publicState, "HIDDEN");
        assert(diagnostic.publicReadiness.blockers.includes("canonicalIdentity"));
        assert.strictEqual(isAdminCanonicalCatalogProduct(diagnostic), false);
        assert.strictEqual(await getCatalogProductDetail(PRODUCT_CODE, { source: "database", includeDisabled: false }), null);

        await expectCode(resolvePackagePrice({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE, region: "MM" }, { source: "database" }), "PRODUCT_NOT_FOUND");
        await expectCode(loadCommercePreviewPackage({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE, region: "MM", currency: "MMK" }), "PRODUCT_UNAVAILABLE");

        const placement = await getAdminPlacement("HOME_POPULAR_GAMES");
        assert(!placement.availableItems.some(product => product.productCode === PRODUCT_CODE), "Unsupported product must not be offered for Home placement.");
        await expectCode(updateAdminPlacement("HOME_POPULAR_GAMES", { managed: true, items: [{ productCode: PRODUCT_CODE }] }), "SITE_PLACEMENT_PRODUCT_UNSUPPORTED");
        const home = await resolveHomePlacements({ region: "MM" });
        assert(!home.placements.HOME_POPULAR_GAMES.items.some(product => product.productCode === PRODUCT_CODE));

        const productAfter = await CatalogProduct.findOne({ productCode: PRODUCT_CODE }).lean();
        const packageAfter = await CatalogPackage.findOne({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE }).lean();
        assert.strictEqual(productAfter.enabled, productBefore.enabled);
        assert.deepStrictEqual(productAfter.supportedRegions, productBefore.supportedRegions);
        assert.strictEqual(productAfter.catalogCategory, productBefore.catalogCategory);
        assert.strictEqual(packageAfter.enabled, packageBefore.enabled);
        assert.strictEqual(packageAfter.prices.MM.amount, packageBefore.prices.MM.amount);
        assert.strictEqual(packageAfter.prices.TH.amount, packageBefore.prices.TH.amount);
        console.log("Isolated closed canonical membership policy verification passed.");
    } finally {
        await SitePlacement.deleteMany({ placementCode: "HOME_POPULAR_GAMES" });
        await CatalogPackage.deleteMany({ productCode: PRODUCT_CODE });
        await CatalogProduct.deleteMany({ productCode: PRODUCT_CODE });
        await mongoose.disconnect();
    }
}

async function main() {
    verifyPolicySource();
    if (process.argv.includes("--isolated")) await verifyIsolatedPolicy();
    console.log("Closed canonical catalog membership policy verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
