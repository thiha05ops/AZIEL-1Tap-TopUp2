const assert = require("assert");

const {
    CatalogError,
    resolveOrderCatalog,
    resolvePackagePrice,
    toPublicCatalog
} = require("../services/catalogService");

const ACTIVE_PRODUCTS = ["mlbb", "pubg", "freefire", "hok", "aovid", "pubgrp", "telegram"];
const DISABLED_PRODUCTS = ["genshin", "roblox", "valorant"];

async function assertCatalogError(fn, code) {
    try {
        await fn();
    } catch (error) {
        assert(error instanceof CatalogError, `Expected CatalogError for ${code}`);
        assert.strictEqual(error.code, code);
        return;
    }

    throw new Error(`Expected ${code}`);
}

async function assertCatalogService() {
    const mlbbTh = await resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH"
    }, { source: "static" });

    assert.strictEqual(mlbbTh.amount, 55);
    assert.strictEqual(mlbbTh.currency, "THB");
    assert.strictEqual(mlbbTh.packageName, "Weekly Pass 1x");

    const mlbbMm = await resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "MM"
    }, { source: "static" });

    assert.strictEqual(mlbbMm.amount, 6800);
    assert.strictEqual(mlbbMm.currency, "MMK");

    await assertCatalogError(() => resolvePackagePrice({
        productCode: "unknown",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH"
    }, { source: "static" }), "PRODUCT_NOT_FOUND");

    await assertCatalogError(() => resolvePackagePrice({
        productCode: "genshin",
        packageCode: "GENSHIN_FAKE",
        region: "TH"
    }, { source: "static" }), "PRODUCT_DISABLED");

    await assertCatalogError(() => resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_FAKE",
        region: "TH"
    }, { source: "static" }), "PACKAGE_NOT_FOUND");

    await assertCatalogError(() => resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "US"
    }, { source: "static" }), "REGION_NOT_SUPPORTED");

    await assertCatalogError(() => resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientAmount: 1
    }, { source: "static" }), "PRICE_MISMATCH");

    await assertCatalogError(() => resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientCurrency: "MMK"
    }, { source: "static" }), "CURRENCY_MISMATCH");

    const orderProjection = await resolveOrderCatalog({
        gameKey: "mlbb",
        game: "Client Name",
        packageCode: "MLBB_WEEKLY_1X",
        packageName: "Client Package",
        region: "TH",
        amount: 55,
        currency: "THB"
    }, { source: "static" });

    assert.strictEqual(orderProjection.game, "Mobile Legends");
    assert.strictEqual(orderProjection.packageName, "Weekly Pass 1x");
    assert.strictEqual(orderProjection.amount, 55);
    assert.strictEqual(orderProjection.currency, "THB");
}

async function assertPublicProjection() {
    const products = await toPublicCatalog({ source: "static", includeDisabled: false });
    const byCode = new Map(products.map(product => [product.productCode, product]));

    ACTIVE_PRODUCTS.forEach(productCode => {
        const product = byCode.get(productCode);
        assert(product, `${productCode} missing from public catalog`);
        assert(product.enabled !== false, `${productCode} not public enabled`);
        assert(Array.isArray(product.packages), `${productCode} packages missing`);
        assert(product.packages.length > 0, `${productCode} has no public packages`);
    });

    DISABLED_PRODUCTS.forEach(productCode => {
        assert(!byCode.has(productCode), `${productCode} should be excluded from public catalog`);
    });

    products.forEach(product => {
        product.packages.forEach(item => {
            assert(item.prices?.MM?.amount > 0, `${product.productCode}:${item.packageCode} missing MM amount`);
            assert.strictEqual(item.prices.MM.currency, "MMK");
            assert(item.prices?.TH?.amount > 0, `${product.productCode}:${item.packageCode} missing TH amount`);
            assert.strictEqual(item.prices.TH.currency, "THB");
        });
    });
}

async function main() {
    await assertCatalogService();
    await assertPublicProjection();
    console.log("Catalog service checks passed.");
    console.log("Catalog public projection check passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
