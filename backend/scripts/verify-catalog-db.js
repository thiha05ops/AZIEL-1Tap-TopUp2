const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "../..", ".env")
});

const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const {
    getStaticCatalogSnapshot
} = require("../catalog/catalogProjection");
const {
    CatalogError,
    resolveDatabasePackagePriceFromRows,
    resolvePackagePrice
} = require("../services/catalogService");
const {
    buildCatalogSeedPlan,
    summarizePlan
} = require("../services/catalogMigrationService");

const ROOT = path.join(__dirname, "../..");

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function assertConflict(plan, scope, matcher) {
    const rows = scope === "product" ? plan.products.conflicts : plan.packages.conflicts;
    assert(rows.some(matcher), `Expected ${scope} conflict`);
}

function assertSeedPlanning() {
    const snapshot = getStaticCatalogSnapshot();
    assert(snapshot.products.length >= 10, "static product normalization should include launch products");
    assert(snapshot.packages.length >= 80, "static package normalization should include launch packages");

    const fullDbProducts = clone(snapshot.products);
    const fullDbPackages = clone(snapshot.packages);
    const unchangedPlan = buildCatalogSeedPlan({
        dbProducts: fullDbProducts,
        dbPackages: fullDbPackages,
        staticSnapshot: snapshot
    });

    assert.strictEqual(summarizePlan(unchangedPlan).creates, 0, "seed dry-run should be idempotent when DB matches static catalog");
    assert(unchangedPlan.products.unchanged.includes("mlbb"), "unchanged product should be detected");
    assert(unchangedPlan.packages.unchanged.includes("mlbb:MLBB_WEEKLY_1X"), "unchanged package should be detected");

    const missingProductPlan = buildCatalogSeedPlan({
        dbProducts: fullDbProducts.filter(item => item.productCode !== "mlbb"),
        dbPackages: fullDbPackages,
        staticSnapshot: snapshot
    });
    assert(missingProductPlan.products.create.some(item => item.productCode === "mlbb"), "missing product should be planned for create");

    const missingPackagePlan = buildCatalogSeedPlan({
        dbProducts: fullDbProducts,
        dbPackages: fullDbPackages.filter(item => item.packageCode !== "MLBB_WEEKLY_1X"),
        staticSnapshot: snapshot
    });
    assert(missingPackagePlan.packages.create.some(item => item.packageCode === "MLBB_WEEKLY_1X"), "missing package should be planned for create");

    const mmAmountDb = clone(fullDbPackages);
    mmAmountDb.find(item => item.packageCode === "MLBB_WEEKLY_1X").prices.MM.amount += 1;
    assertConflict(buildCatalogSeedPlan({ dbProducts: fullDbProducts, dbPackages: mmAmountDb, staticSnapshot: snapshot }), "package", item => (
        item.packageCode === "MLBB_WEEKLY_1X" && item.conflicts.some(conflict => conflict.includes("MM amount"))
    ));

    const thAmountDb = clone(fullDbPackages);
    thAmountDb.find(item => item.packageCode === "MLBB_WEEKLY_1X").prices.TH.amount += 1;
    assertConflict(buildCatalogSeedPlan({ dbProducts: fullDbProducts, dbPackages: thAmountDb, staticSnapshot: snapshot }), "package", item => (
        item.packageCode === "MLBB_WEEKLY_1X" && item.conflicts.some(conflict => conflict.includes("TH amount"))
    ));

    const currencyDb = clone(fullDbPackages);
    currencyDb.find(item => item.packageCode === "MLBB_WEEKLY_1X").prices.TH.currency = "MMK";
    assertConflict(buildCatalogSeedPlan({ dbProducts: fullDbProducts, dbPackages: currencyDb, staticSnapshot: snapshot }), "package", item => (
        item.packageCode === "MLBB_WEEKLY_1X" && item.conflicts.some(conflict => conflict.includes("TH currency"))
    ));

    const enabledProductDb = clone(fullDbProducts);
    enabledProductDb.find(item => item.productCode === "mlbb").enabled = false;
    assertConflict(buildCatalogSeedPlan({ dbProducts: enabledProductDb, dbPackages: fullDbPackages, staticSnapshot: snapshot }), "product", item => (
        item.productCode === "mlbb" && item.conflicts.some(conflict => conflict.includes("enabled"))
    ));

    const enabledPackageDb = clone(fullDbPackages);
    enabledPackageDb.find(item => item.packageCode === "MLBB_WEEKLY_1X").enabled = false;
    assertConflict(buildCatalogSeedPlan({ dbProducts: fullDbProducts, dbPackages: enabledPackageDb, staticSnapshot: snapshot }), "package", item => (
        item.packageCode === "MLBB_WEEKLY_1X" && item.conflicts.some(conflict => conflict.includes("enabled"))
    ));

    const regionDb = clone(fullDbProducts);
    regionDb.find(item => item.productCode === "mlbb").supportedRegions = ["MM"];
    assertConflict(buildCatalogSeedPlan({ dbProducts: regionDb, dbPackages: fullDbPackages, staticSnapshot: snapshot }), "product", item => (
        item.productCode === "mlbb" && item.conflicts.some(conflict => conflict.includes("supportedRegions"))
    ));

    const extraPlan = buildCatalogSeedPlan({
        dbProducts: [...fullDbProducts, { productCode: "extra", name: "Extra", enabled: true, supportedRegions: [] }],
        dbPackages: [...fullDbPackages, { productCode: "extra", packageCode: "EXTRA_1", name: "Extra", enabled: true, prices: {} }],
        staticSnapshot: snapshot
    });
    assert(extraPlan.products.extra.includes("extra"), "extra DB product should be reported");
    assert(extraPlan.packages.extra.includes("extra:EXTRA_1"), "extra DB package should be reported");

    const productCodes = new Set(snapshot.products.map(item => item.productCode));
    const packageKeys = new Set(snapshot.packages.map(item => `${item.productCode}:${item.packageCode}`));
    assert.strictEqual(productCodes.size, snapshot.products.length, "productCode identity must be unique");
    assert.strictEqual(packageKeys.size, snapshot.packages.length, "productCode + packageCode identity must be unique");
}

function assertNoHistoricalMutationOwnership() {
    const seedSource = fs.readFileSync(path.join(ROOT, "backend/scripts/seed-catalog.js"), "utf8");
    const migrationSource = fs.readFileSync(path.join(ROOT, "backend/services/catalogMigrationService.js"), "utf8");
    const combined = `${seedSource}\n${migrationSource}`;

    assert(!combined.includes("../models/Order"), "catalog seed must not import Order");
    assert(!combined.includes("../models/WalletTransaction"), "catalog seed must not import WalletTransaction");
    assert(!combined.includes("../models/WalletTopup"), "catalog seed must not import WalletTopup");
    assert(!/\bupdateMany\b|\bdeleteMany\b|\bfindOneAndUpdate\b/.test(combined), "catalog seed must not perform broad historical mutation");
}

async function assertSourceResolvers() {
    const staticItem = await resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientAmount: 55,
        clientCurrency: "THB"
    }, { source: "static" });

    assert.strictEqual(staticItem.amount, 55);
    assert.strictEqual(staticItem.currency, "THB");

    await assertCatalogError(resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientAmount: 1
    }, { source: "static" }), "PRICE_MISMATCH");

    await assertCatalogError(resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientCurrency: "MMK"
    }, { source: "static" }), "CURRENCY_MISMATCH");

    const snapshot = getStaticCatalogSnapshot();
    const rows = {
        products: clone(snapshot.products),
        packages: clone(snapshot.packages)
    };
    const databaseItem = resolveDatabasePackagePriceFromRows({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientAmount: 55,
        clientCurrency: "THB"
    }, rows);

    assert.strictEqual(databaseItem.amount, 55);
    assert.strictEqual(databaseItem.currency, "THB");

    const disabledProductRows = clone(rows);
    disabledProductRows.products.find(item => item.productCode === "mlbb").enabled = false;
    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH"
    }, disabledProductRows, "PRODUCT_DISABLED");

    const disabledPackageRows = clone(rows);
    disabledPackageRows.packages.find(item => item.packageCode === "MLBB_WEEKLY_1X").enabled = false;
    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH"
    }, disabledPackageRows, "PACKAGE_DISABLED");

    const unsupportedRegionRows = clone(rows);
    unsupportedRegionRows.packages.find(item => item.packageCode === "MLBB_WEEKLY_1X").prices.TH.enabled = false;
    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH"
    }, unsupportedRegionRows, "REGION_NOT_SUPPORTED");

    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "UNKNOWN_PACKAGE",
        region: "TH"
    }, rows, "PACKAGE_NOT_FOUND");

    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientAmount: 1
    }, rows, "PRICE_MISMATCH");

    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientCurrency: "MMK"
    }, rows, "CURRENCY_MISMATCH");
}

async function assertCatalogError(promise, code) {
    try {
        await promise;
    } catch (error) {
        assert(error instanceof CatalogError, `Expected CatalogError for ${code}`);
        assert.strictEqual(error.code, code);
        return;
    }

    throw new Error(`Expected ${code}`);
}

function assertDatabaseCatalogError(payload, rows, code) {
    try {
        resolveDatabasePackagePriceFromRows(payload, rows);
    } catch (error) {
        assert(error instanceof CatalogError, `Expected CatalogError for ${code}`);
        assert.strictEqual(error.code, code);
        return;
    }

    throw new Error(`Expected ${code}`);
}

async function assertLiveDbIntegrity() {
    const [products, packages] = await Promise.all([
        CatalogProduct.find().lean(),
        CatalogPackage.find().lean()
    ]);
    const productCodes = new Set();
    const packageKeys = new Set();

    assert(products.length >= 10, "live DB should contain seeded launch products");
    assert(packages.length >= 80, "live DB should contain seeded launch packages");

    products.forEach(product => {
        assert(product.productCode, "live product missing productCode");
        assert(!productCodes.has(product.productCode), `duplicate live productCode ${product.productCode}`);
        productCodes.add(product.productCode);
        assert(product.name, `${product.productCode} live name missing`);
        assert(Array.isArray(product.supportedRegions), `${product.productCode} live supportedRegions missing`);
        product.supportedRegions.forEach(region => {
            assert(["MM", "TH"].includes(region), `${product.productCode} invalid live region ${region}`);
        });
    });

    packages.forEach(item => {
        const key = `${item.productCode}:${item.packageCode}`;
        assert(productCodes.has(item.productCode), `${key} orphan live package`);
        assert(!packageKeys.has(key), `duplicate live package identity ${key}`);
        packageKeys.add(key);
        assert(item.name, `${key} live name missing`);

        [
            ["MM", "MMK"],
            ["TH", "THB"]
        ].forEach(([region, currency]) => {
            const price = item.prices?.[region];
            if (!price) return;

            assert.strictEqual(price.currency, currency, `${key}:${region} live currency`);
            assert(Number.isFinite(Number(price.amount)) && Number(price.amount) > 0, `${key}:${region} live amount must be positive`);
        });
    });
}

async function main() {
    assertSeedPlanning();
    assertNoHistoricalMutationOwnership();
    await assertSourceResolvers();
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });

    try {
        await assertLiveDbIntegrity();
    } finally {
        await mongoose.connection.close(false);
    }

    console.log("Catalog DB foundation verification checks passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
