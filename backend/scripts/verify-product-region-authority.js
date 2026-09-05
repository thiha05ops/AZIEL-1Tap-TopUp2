"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
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

    if (process.argv.includes("--isolated")) await verifyIsolatedPropagation();

    console.log("Product region authority verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
