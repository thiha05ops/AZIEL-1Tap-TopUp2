"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const Supplier = require("../models/Supplier");
const PackageInventoryState = require("../models/PackageInventoryState");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const {
    CatalogError,
    applyPackageFulfillmentReadiness,
    projectCatalogProduct,
    resolveDatabasePackagePriceFromRows
} = require("../services/catalogService");
const { toPublicCatalog } = require("../services/catalogService");
const {
    CommercePricingPreviewError,
    loadCatalogPackage
} = require("../services/commerce/commercePricingPreviewService");

const ROOT = path.resolve(__dirname, "../..");
const baseProduct = {
    productCode: "pubg",
    name: "Region Authority Fixture",
    enabled: true,
    deletedAt: null,
    publicDiscoveryEnabled: true,
    commerceState: "PURCHASABLE",
    supportedRegions: ["MM", "TH"],
    fulfillment: { manualAllowedRegions: ["MM", "TH"] }
};
const basePackage = {
    _id: "region-authority-package",
    productCode: "pubg",
    packageCode: "REGION_AUTHORITY_TEST",
    name: "Region Authority Package",
    enabled: true,
    deletedAt: null,
    prices: {
        MM: { amount: 1000, currency: "MMK", enabled: true },
        TH: { amount: 30, currency: "THB", enabled: true }
    }
};

function publicProjection(product, pkg = basePackage) {
    const projection = projectCatalogProduct(product, [pkg], { includeDisabled: false });
    applyPackageFulfillmentReadiness(projection, [], []);
    return projection;
}

async function withCatalogRows(product, pkg, callback) {
    const originalProductFindOne = CatalogProduct.findOne;
    const originalPackageFindOne = CatalogPackage.findOne;
    CatalogProduct.findOne = () => ({ lean: () => Promise.resolve(product) });
    CatalogPackage.findOne = () => ({ lean: () => Promise.resolve(pkg) });
    try {
        return await callback();
    } finally {
        CatalogProduct.findOne = originalProductFindOne;
        CatalogPackage.findOne = originalPackageFindOne;
    }
}

async function expectError(promise, ErrorType, code) {
    let caught = null;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert(caught instanceof ErrorType, `Expected ${ErrorType.name}, received ${caught?.constructor?.name || "no error"}`);
    assert.strictEqual(caught.code, code);
}

function queryResult(value) {
    return {
        sort() { return this; },
        select() { return this; },
        lean: () => Promise.resolve(value)
    };
}

async function withExplicitStoreCatalogProjection({ products, packages, mappings = [], suppliers = [], publications = [], selections = [] }, callback) {
    const originals = {
        CatalogProductFind: CatalogProduct.find,
        CatalogPackageFind: CatalogPackage.find,
        SupplierProductMappingFind: SupplierProductMapping.find,
        SupplierFind: Supplier.find,
        PackageInventoryStateFind: PackageInventoryState.find,
        PackageMarketPublicationFind: PackageMarketPublication.find,
        StoreCatalogSelectionFind: StoreCatalogSelection.find,
        STORE_CATALOG_SELECTION_MODE: process.env.STORE_CATALOG_SELECTION_MODE,
        PACKAGE_MARKET_PUBLICATION_MODE: process.env.PACKAGE_MARKET_PUBLICATION_MODE
    };
    CatalogProduct.find = () => queryResult(products);
    CatalogPackage.find = () => queryResult(packages);
    SupplierProductMapping.find = () => queryResult(mappings);
    Supplier.find = () => queryResult(suppliers);
    PackageInventoryState.find = () => queryResult([]);
    PackageMarketPublication.find = query => queryResult(publications.filter(item => String(item.customerMarket || "").toUpperCase() === String(query?.customerMarket || "").toUpperCase()));
    StoreCatalogSelection.find = query => queryResult(selections.filter(item => (
        item.status === query?.status &&
        (item.sellingRegions || []).includes(String(query?.sellingRegions || "").toUpperCase()) &&
        (item.visibleRegions || []).includes(String(query?.visibleRegions || "").toUpperCase())
    )));
    process.env.STORE_CATALOG_SELECTION_MODE = "EXPLICIT";
    process.env.PACKAGE_MARKET_PUBLICATION_MODE = "EXPLICIT";
    try {
        return await callback();
    } finally {
        CatalogProduct.find = originals.CatalogProductFind;
        CatalogPackage.find = originals.CatalogPackageFind;
        SupplierProductMapping.find = originals.SupplierProductMappingFind;
        Supplier.find = originals.SupplierFind;
        PackageInventoryState.find = originals.PackageInventoryStateFind;
        PackageMarketPublication.find = originals.PackageMarketPublicationFind;
        StoreCatalogSelection.find = originals.StoreCatalogSelectionFind;
        if (originals.STORE_CATALOG_SELECTION_MODE == null) delete process.env.STORE_CATALOG_SELECTION_MODE;
        else process.env.STORE_CATALOG_SELECTION_MODE = originals.STORE_CATALOG_SELECTION_MODE;
        if (originals.PACKAGE_MARKET_PUBLICATION_MODE == null) delete process.env.PACKAGE_MARKET_PUBLICATION_MODE;
        else process.env.PACKAGE_MARKET_PUBLICATION_MODE = originals.PACKAGE_MARKET_PUBLICATION_MODE;
    }
}

async function verifyExplicitStorefrontVisibilitySeparatesPublishedPackages() {
    const productCode = "visible-unpublished-product";
    const product = {
        ...baseProduct,
        productCode,
        name: "Visible Unpublished Product",
        homepageEnabled: true,
        commerceState: "PURCHASABLE",
        presentation: {}
    };
    const publishedPackage = {
        ...basePackage,
        _id: "published-package",
        productCode,
        packageCode: "PUBLISHED_PACKAGE",
        name: "Published Package"
    };
    const unpublishedPackage = {
        ...basePackage,
        _id: "unpublished-package",
        productCode,
        packageCode: "UNPUBLISHED_PACKAGE",
        name: "Unpublished Package"
    };
    const selection = regions => ({
        productCode,
        status: "ACTIVE",
        sellingRegions: regions,
        visibleRegions: regions,
        packages: [
            { packageCode: "PUBLISHED_PACKAGE" },
            { packageCode: "UNPUBLISHED_PACKAGE" }
        ]
    });
    const readPublicMm = async ({ visibleRegions = ["MM"], published = [] } = {}) => withExplicitStoreCatalogProjection({
        products: [product],
        packages: [publishedPackage, unpublishedPackage],
        selections: [selection(visibleRegions)],
        publications: published.map(packageCode => ({
            productCode,
            packageCode,
            customerMarket: "MM",
            published: true,
            decisionVersion: 1
        }))
    }, () => toPublicCatalog({
        source: "database",
        includeDisabled: false,
        includeAssetProjection: false,
        includeAdminPricing: false,
        customerMarket: "MM",
        publicationProjectionMode: "EXPLICIT"
    }));

    let catalog = await readPublicMm({ published: [] });
    let projected = catalog.find(item => item.productCode === productCode);
    assert(projected, "CASE A: Store Catalog visible product must appear even when zero MM packages are published.");
    assert.strictEqual(projected.packageCount, 0, "CASE A: zero published packages must expose zero purchasable package options.");
    assert.deepStrictEqual(projected.packages, [], "CASE A: unpublished packages must not leak into the public package list.");
    assert.strictEqual(projected.purchasable, false, "CASE A: visible product with no published packages must not be purchasable.");
    assert.strictEqual(projected.publicState, "COMING_SOON", "CASE A: visible product with no purchasable packages must use unavailable/coming-soon semantics.");

    catalog = await readPublicMm({ published: ["PUBLISHED_PACKAGE"] });
    projected = catalog.find(item => item.productCode === productCode);
    assert(projected, "CASE B: product with one published package must appear.");
    assert.deepStrictEqual(projected.packages.map(item => item.packageCode), ["PUBLISHED_PACKAGE"], "CASE B/E: only published package options may be exposed.");
    assert.strictEqual(projected.packages[0].prices.MM.amount, 1000, "CASE B: published package pricing must remain available.");

    catalog = await readPublicMm({ visibleRegions: ["TH"], published: ["PUBLISHED_PACKAGE"] });
    assert(!catalog.some(item => item.productCode === productCode), "CASE C/D: product not visible in MM must remain hidden from MM.");

    const source = fs.readFileSync(path.join(ROOT, "backend/services/catalogService.js"), "utf8");
    assert(!source.includes("if (!projection.packages.length) return null;"), "Public Store Catalog product inclusion must not be gated by published package count.");
    return { zeroPublishedVisible: true, unpublishedPackagesHidden: true, publishedPackageVisible: true, hiddenRegionHidden: true };
}

function isolatedMongoUri() {
    require("dotenv").config({ quiet: true });
    const configured = String(process.env.MONGO_URI || "").trim();
    if (!configured) throw new Error("MONGO_URI is required for isolated verification.");
    const parsed = new URL(configured);
    parsed.pathname = "/aziel_e2e_product_region_authority";
    const uri = parsed.toString();
    if (!uri.includes("/aziel_e2e_product_region_authority")) {
        throw new Error("Isolated verification refused a non-isolated database URI.");
    }
    return uri;
}

async function verifyIsolatedPropagation() {
    const productCode = "capcut";
    const packageCode = "REGION_AUTHORITY_ISOLATED";
    await mongoose.connect(isolatedMongoUri());
    try {
        await CatalogPackage.deleteMany({ productCode, packageCode });
        await CatalogProduct.deleteMany({ productCode });
        await CatalogProduct.create({
            ...baseProduct,
            productCode,
            name: "Isolated Region Authority Product",
            description: "Isolated product used only to verify regional catalog authority safely.",
            artworkPath: "assets/giftcards/capcut.webp",
            supportedRegions: ["MM", "TH"]
        });
        const { _id: ignoredFixtureId, ...persistedPackage } = basePackage;
        await CatalogPackage.create({
            ...persistedPackage,
            productCode,
            packageCode,
            name: "Isolated Region Authority Package"
        });

        let products = await toPublicCatalog({ source: "database", includeDisabled: false });
        let projected = products.find(item => item.productCode === productCode);
        assert(projected?.packages[0]?.prices?.TH, "Initial isolated TH public price must be available.");

        await CatalogProduct.updateOne({ productCode }, { $set: { supportedRegions: ["MM"] } });
        const persisted = await CatalogProduct.findOne({ productCode }).lean();
        assert.deepStrictEqual(persisted.supportedRegions, ["MM"], "Admin-equivalent region change must persist.");

        products = await toPublicCatalog({ source: "database", includeDisabled: false });
        projected = products.find(item => item.productCode === productCode);
        assert(projected, "Product must remain publicly projected because commerce market is independent from product compatibility.");
        assert(projected.packages[0].prices.TH, "TH commerce price must remain projected even when product compatibility metadata is MM.");
        assert.strictEqual(projected.packages[0].fulfillmentRegions.TH, true);
        const thPreview = await loadCatalogPackage({ productCode, packageCode, region: "TH", currency: "THB" });
        assert.strictEqual(thPreview.price.amount, 30);
        const storedPackage = await CatalogPackage.findOne({ productCode, packageCode }).lean();
        const thOrderCatalog = resolveDatabasePackagePriceFromRows({ productCode, packageCode, region: "TH" }, {
            products: [persisted],
            packages: [storedPackage]
        });
        assert.strictEqual(thOrderCatalog.amount, 30);

        assert(storedPackage.prices.TH, "Removing product TH support must not delete stored TH package configuration.");
        await CatalogProduct.updateOne({ productCode }, { $set: { supportedRegions: ["MM", "TH"] } });
        products = await toPublicCatalog({ source: "database", includeDisabled: false });
        projected = products.find(item => item.productCode === productCode);
        assert(projected?.packages[0]?.prices?.TH, "Product compatibility metadata changes must not delete existing TH commerce configuration.");
        const restoredPreview = await loadCatalogPackage({ productCode, packageCode, region: "TH", currency: "THB" });
        assert.strictEqual(restoredPreview.price.amount, 30);
        console.log("Isolated Admin-to-Public region propagation verification passed.");
    } finally {
        await CatalogPackage.deleteMany({ productCode, packageCode });
        await CatalogProduct.deleteMany({ productCode });
        await mongoose.disconnect();
    }
}

async function main() {
    const valorantThailand = {
        ...baseProduct,
        productCode: "valorant-th",
        name: "Valorant (Thailand)",
        supportedRegions: ["TH"],
        presentation: { displayMarketLabel: "Thailand" }
    };
    const codmIndonesia = {
        ...baseProduct,
        productCode: "codm-id",
        name: "Call of Duty Mobile (Indonesia)",
        supportedRegions: ["ID"],
        presentation: { displayMarketLabel: "Indonesia" }
    };
    [valorantThailand, codmIndonesia].forEach(product => {
        const projected = publicProjection(product, { ...basePackage, productCode: product.productCode });
        assert(projected.packages[0].prices.TH, `${product.name} must remain visible in TH commerce when TH price/publication exists.`);
        assert(projected.packages[0].prices.MM, `${product.name} must remain visible in MM commerce when MM price/publication exists.`);
        assert.deepStrictEqual(projected.supportedRegions, product.supportedRegions, "Product/account compatibility label must remain unchanged by commerce projection.");
    });

    const mmOnlyProduct = { ...baseProduct, supportedRegions: ["MM"] };
    const mmOnly = publicProjection(mmOnlyProduct);
    assert(mmOnly.packages[0].prices.TH, "TH commerce price must be publicly projected independently of product compatibility.");
    assert.strictEqual(mmOnly.packages[0].fulfillmentRegions.TH, true, "TH fulfillment readiness must follow commerce route readiness, not product compatibility labels.");
    assert(mmOnly.packages[0].prices.MM, "Supported MM price must remain projected.");

    await withCatalogRows(mmOnlyProduct, basePackage, async () => {
        const catalog = await loadCatalogPackage({
            productCode: "pubg", packageCode: basePackage.packageCode, region: "TH", currency: "THB"
        });
        assert.strictEqual(catalog.price.amount, 30);
    });
    await withCatalogRows({ ...baseProduct, publicDiscoveryEnabled: false }, basePackage, async () => {
        await expectError(loadCatalogPackage({
            productCode: "pubg", packageCode: basePackage.packageCode, region: "TH", currency: "THB"
        }), CommercePricingPreviewError, "PRODUCT_UNAVAILABLE");
    });

    const supported = publicProjection(baseProduct);
    assert(supported.packages[0].prices.TH, "Supported TH price must remain projected.");
    assert.strictEqual(supported.packages[0].fulfillmentRegions.TH, true, "Supported manual TH fulfillment must remain available.");
    await withCatalogRows(baseProduct, basePackage, async () => {
        const catalog = await loadCatalogPackage({
            productCode: "pubg", packageCode: basePackage.packageCode, region: "TH", currency: "THB"
        });
        assert.strictEqual(catalog.price.amount, 30);
    });

    const thDisabledPackage = {
        ...basePackage,
        prices: { ...basePackage.prices, TH: { ...basePackage.prices.TH, enabled: false } }
    };
    const packageDisabled = publicProjection(baseProduct, thDisabledPackage);
    assert.strictEqual(packageDisabled.packages[0].prices.TH, undefined, "Product support must not override package-region disablement.");
    await withCatalogRows(baseProduct, thDisabledPackage, async () => {
        await expectError(loadCatalogPackage({
            productCode: "pubg", packageCode: basePackage.packageCode, region: "TH", currency: "THB"
        }), CommercePricingPreviewError, "PACKAGE_UNAVAILABLE");
    });

    const mmOnlyOrderCatalog = resolveDatabasePackagePriceFromRows({
        productCode: "pubg", packageCode: basePackage.packageCode, region: "TH"
    }, { products: [mmOnlyProduct], packages: [basePackage] });
    assert.strictEqual(mmOnlyOrderCatalog.amount, 30);

    const underlyingBefore = JSON.stringify(basePackage.prices.TH);
    publicProjection(mmOnlyProduct);
    assert.strictEqual(JSON.stringify(basePackage.prices.TH), underlyingBefore, "Projection must not mutate stored package region configuration.");
    assert(publicProjection(baseProduct).packages[0].prices.TH, "Product compatibility metadata changes must not delete existing TH commerce configuration.");

    const adminProjection = projectCatalogProduct(mmOnlyProduct, [basePackage], {
        includeDisabled: true,
        includeAdminPricing: true,
        publicProjection: false
    });
    assert(adminProjection.packages[0].prices.TH, "Admin projection must retain unsupported-region configuration for later restoration.");

    const frontend = fs.readFileSync(path.join(ROOT, "frontend/js/catalog-runtime.js"), "utf8");
    assert(!frontend.includes("product.supportedRegions?.includes(normalizedRegion) === false"), "Frontend must not hide packages because product compatibility metadata differs from commerce market.");

    const adminService = fs.readFileSync(path.join(ROOT, "backend/services/catalogAdminService.js"), "utf8");
    assert(!adminService.includes("This product does not support the selected region."), "Admin pricing must not use product compatibility metadata as a TH/MM commerce gate.");
    assert(adminService.includes("normalizeManualAllowedRegions"), "Manual fulfillment regions must have a separate TH/MM commerce normalizer.");

    const explicitStorefrontVisibility = await verifyExplicitStorefrontVisibilitySeparatesPublishedPackages();

    if (process.argv.includes("--isolated")) await verifyIsolatedPropagation();

    console.log("Product region authority verification passed.", JSON.stringify({ explicitStorefrontVisibility }));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
