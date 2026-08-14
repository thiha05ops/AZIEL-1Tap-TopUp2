"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const mongoose = require("mongoose");

const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const SitePlacement = require("../models/SitePlacement");
const { updateProduct } = require("../services/catalogAdminService");
const { toPublicCatalog } = require("../services/catalogService");
const { getAdminPlacement, resolveHomePlacements, updateAdminPlacement } = require("../services/sitePlacementService");

const ROOT = path.resolve(__dirname, "../..");
const productCode = "capcut";
const packageCode = "HOME_PLACEMENT_AUTHORITY_ISOLATED";

function homePolicy() {
    const document = {
        readyState: "loading",
        addEventListener() {},
        dispatchEvent() {},
        getElementById() { return null; }
    };
    const sandbox = {
        console, setTimeout, clearTimeout, Date, Map, Set, Promise, JSON, Number, String, Boolean, Array, Error, Intl,
        document,
        localStorage: { getItem() { return null; } },
        CustomEvent: function CustomEvent(type, options = {}) { return { type, detail: options.detail || {} }; },
        window: { document, addEventListener() {}, AZIEL: { getRegion: () => "MM" } }
    };
    const context = vm.createContext(sandbox);
    ["catalog-presentation.js", "home-placement-runtime.js"].forEach(name => {
        vm.runInContext(fs.readFileSync(path.join(ROOT, "frontend/js", name), "utf8"), context, { filename: name });
    });
    return sandbox.window.AZIEL_HOME_PLACEMENT_POLICY;
}

function product(overrides = {}) {
    return {
        productCode: "not-in-static-list",
        name: "Admin Placed Product",
        enabled: true,
        discoverable: true,
        publicState: "AVAILABLE",
        publicCategory: "mobile",
        homepageEnabled: true,
        productRoute: "product.html?product=not-in-static-list",
        ...overrides
    };
}

function verifyFrontendMembership() {
    const policy = homePolicy();
    const arbitraryMobile = product();
    const historicalStatic = product({ productCode: "mlbb", name: "Historical Static Product", productRoute: "mlbb.html" });
    assert.deepStrictEqual(
        policy.selectPopularProducts({ managed: true, items: [arbitraryMobile] }).map(item => item.productCode),
        ["not-in-static-list"],
        "Admin placement must admit a product absent from historical allowlists."
    );
    assert.strictEqual(policy.selectPopularProducts({ managed: true, items: [] }).length, 0);
    assert.strictEqual(policy.selectPopularProducts({ managed: false, items: [historicalStatic] }).length, 0, "Unmanaged placement must not resurrect a historical static member.");
    assert.strictEqual(policy.selectPopularProducts({ managed: true, items: [product({ publicCategory: "pc" })] }).length, 0, "PC category must not enter Popular Mobile.");
    assert.strictEqual(policy.selectPopularProducts({ managed: true, items: [product({ enabled: false })] }).length, 0, "Disabled placement item must not render.");

    assert.deepStrictEqual(policy.selectAllMobileProducts([
        arbitraryMobile,
        product({ productCode: "pc", publicCategory: "pc" }),
        product({ productCode: "home-off", homepageEnabled: false })
    ]).map(item => item.productCode), ["not-in-static-list"], "All Mobile must derive from eligible Home-enabled Mobile products.");

    const arbitrarySocial = product({ productCode: "new-social-service", publicCategory: "social" });
    assert.deepStrictEqual(policy.selectSocialProducts([arbitrarySocial]).map(item => item.productCode), ["new-social-service"], "Social membership must not require the former two-code list.");
    assert.strictEqual(policy.selectSocialProducts([{ ...arbitrarySocial, homepageEnabled: false }]).length, 0);

    const homeSource = fs.readFileSync(path.join(ROOT, "frontend/js/home-placement-runtime.js"), "utf8");
    const presentationSource = fs.readFileSync(path.join(ROOT, "frontend/js/catalog-presentation.js"), "utf8");
    assert(!homeSource.includes("canonicalHomeCodes"));
    assert(!homeSource.includes("approvedProducts"));
    assert(!homeSource.includes("exactOrderedProducts"));
    assert(!homeSource.includes("static-fallback"));
    assert(!presentationSource.includes("CANONICAL_HOME_PRODUCT_GROUPS"));
    assert(homeSource.includes('target.innerHTML = ""'), "Empty Home sections must clear stale rendered cards.");
}

function isolatedMongoUri() {
    require("dotenv").config({ quiet: true });
    const configured = String(process.env.MONGO_URI || "").trim();
    if (!configured) throw new Error("MONGO_URI is required for isolated verification.");
    const parsed = new URL(configured);
    parsed.pathname = "/aziel_e2e_home_placement_authority";
    const uri = parsed.toString();
    if (!uri.includes("/aziel_e2e_home_placement_authority")) throw new Error("Home placement verifier refused a non-isolated database URI.");
    return uri;
}

async function updateFixtureProduct(patch) {
    const current = await CatalogProduct.findOne({ productCode });
    return updateProduct({ productCode, patch: { ...patch, expectedUpdatedAt: current.updatedAt }, actor: "isolated-home-placement-verifier" });
}

async function verifyIsolatedPropagation() {
    await mongoose.connect(isolatedMongoUri());
    try {
        await SitePlacement.deleteMany({ placementCode: "HOME_POPULAR_GAMES" });
        await CatalogPackage.deleteMany({ productCode, packageCode });
        await CatalogProduct.deleteMany({ productCode });
        await CatalogProduct.create({
            productCode,
            name: "Home Placement Isolated Product",
            description: "Isolated product used to verify persisted Admin homepage placement authority.",
            enabled: true,
            catalogCategory: "MOBILE_GAME_TOPUP",
            lifecycleStatus: "ACTIVE",
            commerceState: "PURCHASABLE",
            publicDiscoveryEnabled: true,
            homepageEnabled: true,
            homepageOrder: 37,
            productRoute: "product.html?product=capcut",
            artworkPath: "assets/giftcards/capcut.webp",
            supportedRegions: ["MM"],
            fulfillment: { manualAllowedRegions: ["MM"] },
            source: "admin"
        });
        await CatalogPackage.create({
            productCode,
            packageCode,
            name: "Home Placement Authority Package",
            enabled: true,
            prices: {
                MM: { amount: 1000, currency: "MMK", enabled: true, supplierCost: 500, supplierCurrency: "MMK" },
                TH: { amount: 30, currency: "THB", enabled: true, supplierCost: 20, supplierCurrency: "THB" }
            },
            source: "admin"
        });
        const packageBefore = await CatalogPackage.findOne({ productCode, packageCode }).lean();
        const productBefore = await CatalogProduct.findOne({ productCode }).lean();
        const preserved = JSON.stringify({
            packageId: String(packageBefore._id), prices: packageBefore.prices, packageEnabled: packageBefore.enabled,
            category: productBefore.catalogCategory, regions: productBefore.supportedRegions
        });

        let placements = await resolveHomePlacements({ region: "MM" });
        assert.strictEqual(placements.placements.HOME_POPULAR_GAMES.managed, false);
        assert.deepStrictEqual(placements.placements.HOME_POPULAR_GAMES.items, []);

        await updateAdminPlacement("HOME_POPULAR_GAMES", { managed: true, items: [{ productCode }] }, "isolated-home-placement-verifier");
        placements = await resolveHomePlacements({ region: "MM" });
        let popular = placements.placements.HOME_POPULAR_GAMES;
        assert.strictEqual(popular.managed, true);
        assert.deepStrictEqual(popular.items.map(item => item.productCode), [productCode]);
        assert.strictEqual(popular.items[0].publicCategory, "mobile");
        assert.strictEqual(popular.items[0].packages[0].prices.TH, undefined, "Home placement must preserve Product Region Authority.");
        assert.deepStrictEqual(homePolicy().selectPopularProducts(popular).map(item => item.productCode), [productCode]);

        await updateAdminPlacement("HOME_POPULAR_GAMES", { managed: true, items: [] }, "isolated-home-placement-verifier");
        placements = await resolveHomePlacements({ region: "MM" });
        popular = placements.placements.HOME_POPULAR_GAMES;
        assert.deepStrictEqual(popular.items, []);
        assert.deepStrictEqual(homePolicy().selectPopularProducts(popular), []);

        await updateAdminPlacement("HOME_POPULAR_GAMES", { managed: true, items: [{ productCode }] }, "isolated-home-placement-verifier");
        await updateFixtureProduct({ enabled: false });
        placements = await resolveHomePlacements({ region: "MM" });
        assert.deepStrictEqual(placements.placements.HOME_POPULAR_GAMES.items, [], "Placement must not resurrect a disabled product.");
        await updateFixtureProduct({ enabled: true });

        await updateFixtureProduct({ catalogCategory: "PC_GAME" });
        const pcAdminPlacement = await getAdminPlacement("HOME_POPULAR_GAMES");
        assert(!pcAdminPlacement.availableItems.some(item => item.productCode === productCode), "Admin Popular candidates must exclude non-mobile products.");
        await assert.rejects(
            updateAdminPlacement("HOME_POPULAR_GAMES", { managed: true, items: [{ productCode }] }, "isolated-home-placement-verifier"),
            error => error?.code === "SITE_PLACEMENT_CATEGORY_MISMATCH"
        );
        await updateFixtureProduct({ catalogCategory: "MOBILE_GAME_TOPUP" });

        const catalog = await toPublicCatalog({ source: "database", includeDisabled: false });
        const displayed = catalog.map(item => ({ ...item, route: item.productRoute }));
        assert(homePolicy().selectAllMobileProducts(displayed).some(item => item.productCode === productCode));
        await updateFixtureProduct({ homepageEnabled: false });
        const homeOffCatalog = await toPublicCatalog({ source: "database", includeDisabled: false });
        assert(!homePolicy().selectAllMobileProducts(homeOffCatalog.map(item => ({ ...item, route: item.productRoute }))).some(item => item.productCode === productCode));

        await updateFixtureProduct({ catalogCategory: "DIGITAL_SERVICE", homepageEnabled: true });
        const socialCatalog = await toPublicCatalog({ source: "database", includeDisabled: false });
        assert(homePolicy().selectSocialProducts(socialCatalog.map(item => ({ ...item, route: item.productRoute }))).some(item => item.productCode === productCode), "Home-enabled Social product must appear without a frontend code allowlist.");
        await updateFixtureProduct({ homepageEnabled: false });
        const socialOffCatalog = await toPublicCatalog({ source: "database", includeDisabled: false });
        assert(!homePolicy().selectSocialProducts(socialOffCatalog.map(item => ({ ...item, route: item.productRoute }))).some(item => item.productCode === productCode), "Removing persisted Home placement must remove Social product.");
        await updateFixtureProduct({ catalogCategory: "MOBILE_GAME_TOPUP" });

        const packageAfter = await CatalogPackage.findOne({ productCode, packageCode }).lean();
        const productAfter = await CatalogProduct.findOne({ productCode }).lean();
        assert.strictEqual(JSON.stringify({
            packageId: String(packageAfter._id), prices: packageAfter.prices, packageEnabled: packageAfter.enabled,
            category: productAfter.catalogCategory, regions: productAfter.supportedRegions
        }), preserved, "Placement changes must not mutate package/category/region/pricing authority.");

        console.log("Isolated homepage placement propagation verification passed.");
    } finally {
        await SitePlacement.deleteMany({ placementCode: "HOME_POPULAR_GAMES" });
        await CatalogPackage.deleteMany({ productCode, packageCode });
        await CatalogProduct.deleteMany({ productCode });
        await mongoose.disconnect();
    }
}

async function main() {
    verifyFrontendMembership();
    if (process.argv.includes("--isolated")) await verifyIsolatedPropagation();
    console.log("Homepage placement authority verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
