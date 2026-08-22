"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const mongoose = require("mongoose");

const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const { updateProduct } = require("../services/catalogAdminService");
const { projectCatalogProduct, toPublicCatalog } = require("../services/catalogService");
const {
    PUBLIC_CATEGORY_BY_CATALOG_CATEGORY,
    PUBLIC_GAME_CATEGORY_KEYS,
    publicCategoryFor
} = require("../catalog/catalogTaxonomy");

const ROOT = path.resolve(__dirname, "../..");
const productCode = "capcut";
const packageCode = "CATEGORY_AUTHORITY_ISOLATED";

function verifyDomainMapping() {
    assert.strictEqual(publicCategoryFor("MOBILE_GAME_TOPUP"), "mobile");
    assert.strictEqual(publicCategoryFor("PC_GAME"), "pc");
    assert.strictEqual(publicCategoryFor("GIFT_CARD"), "gift-card");
    assert.strictEqual(publicCategoryFor("DIGITAL_SERVICE"), "social");
    assert.strictEqual(publicCategoryFor("WEB_GAME"), "", "Unsupported Web taxonomy must not be invented.");
    assert.deepStrictEqual(PUBLIC_GAME_CATEGORY_KEYS, ["mobile", "pc"]);
    assert.strictEqual(PUBLIC_CATEGORY_BY_CATALOG_CATEGORY.WEB_GAME, undefined);

    const projected = projectCatalogProduct({
        productCode: "mlbb", name: "Fixture", enabled: true, catalogCategory: "MOBILE_GAME_TOPUP", supportedRegions: ["MM"]
    }, []);
    assert.strictEqual(projected.catalogCategory, "MOBILE_GAME_TOPUP");
    assert.strictEqual(projected.publicCategory, "mobile");
}

function frontendRuntime(publicCatalog) {
    const listeners = {};
    const document = {
        readyState: "loading",
        addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
        dispatchEvent(event) { (listeners[event.type] || []).forEach(callback => callback(event)); },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
    const sandbox = {
        console, setTimeout, clearTimeout, Date, Map, Set, Promise, JSON, Number, String, Boolean, Array, Error,
        document,
        CustomEvent: function CustomEvent(type, options = {}) { return { type, detail: options.detail || {} }; },
        fetch: async () => ({ ok: true, json: async () => publicCatalog }),
        window: {
            document,
            location: { pathname: "/mobile-games.html" },
            addEventListener() {},
            dispatchEvent() {},
            AZIEL: { getRegion: () => "MM" }
        }
    };
    sandbox.window.fetch = sandbox.fetch;
    sandbox.window.CustomEvent = sandbox.CustomEvent;
    const context = vm.createContext(sandbox);
    ["catalog-presentation.js", "catalog-runtime.js", "catalog-discovery.js"].forEach(name => {
        vm.runInContext(fs.readFileSync(path.join(ROOT, "frontend/js", name), "utf8"), context, { filename: name });
    });
    return sandbox.window;
}

async function discoveryMembership(products) {
    const window = frontendRuntime({ success: true, source: "database", products });
    await window.AZIEL_CATALOG.load();
    return {
        mobile: window.AZIEL_CATALOG_DISCOVERY.activeProducts("mobile").map(item => item.productCode),
        pc: window.AZIEL_CATALOG_DISCOVERY.activeProducts("pc").map(item => item.productCode),
        social: window.AZIEL_CATALOG_DISCOVERY.activeProducts("social").map(item => item.productCode),
        all: window.AZIEL_CATALOG_DISCOVERY.activeProducts("all").map(item => item.productCode),
        emptyMarkup: window.AZIEL_CATALOG_DISCOVERY.emptyCategoryMarkup(),
        failureMarkup: window.AZIEL_CATALOG_DISCOVERY.catalogFailureMarkup()
    };
}

async function verifyFrontendContract() {
    const products = [
        { productCode: "mobile-fixture", name: "Mobile", enabled: true, publicCategory: "mobile", productRoute: "mobile.html", packages: [] },
        { productCode: "pc-fixture", name: "PC", enabled: true, publicCategory: "pc", productRoute: "pc.html", packages: [] },
        { productCode: "social-fixture", name: "Social", enabled: true, publicCategory: "social", productRoute: "social.html", packages: [] }
    ];
    const membership = await discoveryMembership(products);
    assert.deepStrictEqual(membership.mobile, ["mobile-fixture"]);
    assert.deepStrictEqual(membership.pc, ["pc-fixture"]);
    assert.deepStrictEqual(membership.social, ["social-fixture"]);
    assert.deepStrictEqual(membership.all, ["mobile-fixture", "pc-fixture"], "All Games must include game categories and exclude Social Top Up.");
    assert(membership.emptyMarkup.includes("No products are available"));
    assert(!membership.emptyMarkup.includes("Prices are temporarily unavailable"));
    assert(membership.failureMarkup.includes("Catalog is temporarily unavailable"));
    assert.notStrictEqual(membership.emptyMarkup, membership.failureMarkup);

    const discoverySource = fs.readFileSync(path.join(ROOT, "frontend/js/catalog-discovery.js"), "utf8");
    const presentationSource = fs.readFileSync(path.join(ROOT, "frontend/js/catalog-presentation.js"), "utf8");
    assert(discoverySource.includes('href="all-games.html"'));
    assert(!discoverySource.includes('<a href="mobile-games.html"><span>All Games</span></a>'));
    assert(!/activeProducts\([^)]*\)[\s\S]{0,200}\["mlbb"/.test(discoverySource), "Category membership must not use hardcoded product codes.");
    assert(!discoverySource.includes('const priority = ["mlbb", "pubg", "freefire", "hok"]'), "Popular discovery order must come from catalog Home placement fields.");
    assert(!presentationSource.includes('Boolean(presentation?.featured)'), "Presentation fallbacks must not override Admin featured authority.");
    assert(!presentationSource.includes('presentation?.description ||'), "Presentation fallbacks must not override Admin product descriptions.");
    assert(!presentationSource.includes("HOME_PRESENTATION_RECORDS"), "Dead Home product truth registry must remain retired.");
    assert(!fs.existsSync(path.join(ROOT, "frontend/js/script.js")), "Unreferenced static package authority must remain removed.");
    assert(fs.existsSync(path.join(ROOT, "frontend/all-games.html")));
}

function isolatedMongoUri() {
    require("dotenv").config({ quiet: true });
    const configured = String(process.env.MONGO_URI || "").trim();
    if (!configured) throw new Error("MONGO_URI is required for isolated verification.");
    const parsed = new URL(configured);
    parsed.pathname = "/aziel_e2e_category_discovery_authority";
    const uri = parsed.toString();
    if (!uri.includes("/aziel_e2e_category_discovery_authority")) throw new Error("Category verifier refused a non-isolated database URI.");
    return uri;
}

async function updateCategory(catalogCategory) {
    const product = await CatalogProduct.findOne({ productCode });
    return updateProduct({
        productCode,
        patch: { catalogCategory, expectedUpdatedAt: product.updatedAt },
        actor: "isolated-category-verifier"
    });
}

async function verifyIsolatedPropagation() {
    await mongoose.connect(isolatedMongoUri());
    try {
        await CatalogPackage.deleteMany({ productCode, packageCode });
        await CatalogProduct.deleteMany({ productCode });
        await CatalogProduct.create({
            productCode,
            name: "Category Authority Isolated Product",
            description: "Isolated product used to verify Admin-controlled discovery category propagation.",
            enabled: true,
            catalogCategory: "MOBILE_GAME_TOPUP",
            lifecycleStatus: "ACTIVE",
            commerceState: "PURCHASABLE",
            publicDiscoveryEnabled: true,
            productRoute: "product.html?product=capcut",
            artworkPath: "assets/giftcards/capcut.webp",
            supportedRegions: ["MM"],
            fulfillment: { manualAllowedRegions: ["MM"] },
            source: "admin"
        });
        await CatalogPackage.create({
            productCode,
            packageCode,
            name: "Category Authority Package",
            enabled: true,
            prices: {
                MM: { amount: 1000, currency: "MMK", enabled: true, supplierCost: 500, supplierCurrency: "MMK" },
                TH: { amount: 30, currency: "THB", enabled: true, supplierCost: 20, supplierCurrency: "THB" }
            },
            source: "admin"
        });
        const packageBefore = await CatalogPackage.findOne({ productCode, packageCode }).lean();
        const preserved = JSON.stringify({ id: String(packageBefore._id), enabled: packageBefore.enabled, prices: packageBefore.prices });

        let products = await toPublicCatalog({ source: "database", includeDisabled: false });
        let projected = products.find(item => item.productCode === productCode);
        assert.strictEqual(projected.publicCategory, "mobile");
        let membership = await discoveryMembership(products);
        assert(membership.mobile.includes(productCode));
        assert(!membership.pc.includes(productCode));
        assert.strictEqual(projected.packages[0].prices.TH, undefined, "Category projection must preserve Product Region Authority.");

        await updateCategory("PC_GAME");
        assert.strictEqual((await CatalogProduct.findOne({ productCode }).lean()).catalogCategory, "PC_GAME");
        products = await toPublicCatalog({ source: "database", includeDisabled: false });
        projected = products.find(item => item.productCode === productCode);
        assert.strictEqual(projected.publicCategory, "pc");
        membership = await discoveryMembership(products);
        assert(!membership.mobile.includes(productCode));
        assert(membership.pc.includes(productCode));

        const product = await CatalogProduct.findOne({ productCode });
        await updateProduct({ productCode, patch: { enabled: false, expectedUpdatedAt: product.updatedAt }, actor: "isolated-category-verifier" });
        products = await toPublicCatalog({ source: "database", includeDisabled: false });
        membership = await discoveryMembership(products);
        assert(!membership.pc.includes(productCode), "Disabled product must remain excluded after category propagation.");
        const disabled = await CatalogProduct.findOne({ productCode });
        await updateProduct({ productCode, patch: { enabled: true, expectedUpdatedAt: disabled.updatedAt }, actor: "isolated-category-verifier" });

        await updateCategory("MOBILE_GAME_TOPUP");
        products = await toPublicCatalog({ source: "database", includeDisabled: false });
        membership = await discoveryMembership(products);
        assert(membership.mobile.includes(productCode));
        assert(!membership.pc.includes(productCode));
        const packageAfter = await CatalogPackage.findOne({ productCode, packageCode }).lean();
        assert.strictEqual(JSON.stringify({ id: String(packageAfter._id), enabled: packageAfter.enabled, prices: packageAfter.prices }), preserved, "Category changes must not mutate package, region, or pricing data.");

        console.log("Isolated category discovery propagation verification passed.");
    } finally {
        await CatalogPackage.deleteMany({ productCode, packageCode });
        await CatalogProduct.deleteMany({ productCode });
        await mongoose.disconnect();
    }
}

async function main() {
    verifyDomainMapping();
    await verifyFrontendContract();
    if (process.argv.includes("--isolated")) await verifyIsolatedPropagation();
    console.log("Category discovery authority verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
