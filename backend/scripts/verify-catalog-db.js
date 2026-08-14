const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    getStaticCatalogSnapshot
} = require("../catalog/catalogProjection");
const {
    CatalogError,
    resolveDatabasePackagePriceFromRows
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
    const sampleProduct = snapshot.products.find(item => item.enabled !== false && item.productCode === "mlbb") || snapshot.products[0];
    const samplePackage = snapshot.packages.find(item => item.productCode === sampleProduct.productCode && item.prices?.MM && item.prices?.TH);
    assert(samplePackage, "static compatibility snapshot must provide a dual-region planning fixture");
    const sampleKey = `${samplePackage.productCode}:${samplePackage.packageCode}`;
    assert(snapshot.products.length > 0, "static compatibility snapshot should normalize products");
    assert(snapshot.packages.length > 0, "static compatibility snapshot should normalize packages");

    const fullDbProducts = clone(snapshot.products);
    const fullDbPackages = clone(snapshot.packages);
    const unchangedPlan = buildCatalogSeedPlan({
        dbProducts: fullDbProducts,
        dbPackages: fullDbPackages,
        staticSnapshot: snapshot
    });

    assert.strictEqual(summarizePlan(unchangedPlan).creates, 0, "seed dry-run should be idempotent when DB matches static catalog");
    assert(unchangedPlan.products.unchanged.includes(sampleProduct.productCode), "unchanged product should be detected");
    assert(unchangedPlan.packages.unchanged.includes(sampleKey), "unchanged package should be detected");

    const missingProductPlan = buildCatalogSeedPlan({
        dbProducts: fullDbProducts.filter(item => item.productCode !== sampleProduct.productCode),
        dbPackages: fullDbPackages,
        staticSnapshot: snapshot
    });
    assert(missingProductPlan.products.create.some(item => item.productCode === sampleProduct.productCode), "missing product should be planned for create");

    const missingPackagePlan = buildCatalogSeedPlan({
        dbProducts: fullDbProducts,
        dbPackages: fullDbPackages.filter(item => `${item.productCode}:${item.packageCode}` !== sampleKey),
        staticSnapshot: snapshot
    });
    assert(missingPackagePlan.packages.create.some(item => `${item.productCode}:${item.packageCode}` === sampleKey), "missing package should be planned for create");

    const mmAmountDb = clone(fullDbPackages);
    mmAmountDb.find(item => `${item.productCode}:${item.packageCode}` === sampleKey).prices.MM.amount += 1;
    assertConflict(buildCatalogSeedPlan({ dbProducts: fullDbProducts, dbPackages: mmAmountDb, staticSnapshot: snapshot }), "package", item => (
        `${item.productCode}:${item.packageCode}` === sampleKey && item.conflicts.some(conflict => conflict.includes("MM amount"))
    ));

    const thAmountDb = clone(fullDbPackages);
    thAmountDb.find(item => `${item.productCode}:${item.packageCode}` === sampleKey).prices.TH.amount += 1;
    assertConflict(buildCatalogSeedPlan({ dbProducts: fullDbProducts, dbPackages: thAmountDb, staticSnapshot: snapshot }), "package", item => (
        `${item.productCode}:${item.packageCode}` === sampleKey && item.conflicts.some(conflict => conflict.includes("TH amount"))
    ));

    const currencyDb = clone(fullDbPackages);
    currencyDb.find(item => `${item.productCode}:${item.packageCode}` === sampleKey).prices.TH.currency = "MMK";
    assertConflict(buildCatalogSeedPlan({ dbProducts: fullDbProducts, dbPackages: currencyDb, staticSnapshot: snapshot }), "package", item => (
        `${item.productCode}:${item.packageCode}` === sampleKey && item.conflicts.some(conflict => conflict.includes("TH currency"))
    ));

    const enabledProductDb = clone(fullDbProducts);
    enabledProductDb.find(item => item.productCode === sampleProduct.productCode).enabled = false;
    assertConflict(buildCatalogSeedPlan({ dbProducts: enabledProductDb, dbPackages: fullDbPackages, staticSnapshot: snapshot }), "product", item => (
        item.productCode === sampleProduct.productCode && item.conflicts.some(conflict => conflict.includes("enabled"))
    ));

    const enabledPackageDb = clone(fullDbPackages);
    enabledPackageDb.find(item => `${item.productCode}:${item.packageCode}` === sampleKey).enabled = false;
    assertConflict(buildCatalogSeedPlan({ dbProducts: fullDbProducts, dbPackages: enabledPackageDb, staticSnapshot: snapshot }), "package", item => (
        `${item.productCode}:${item.packageCode}` === sampleKey && item.conflicts.some(conflict => conflict.includes("enabled"))
    ));

    const regionDb = clone(fullDbProducts);
    regionDb.find(item => item.productCode === sampleProduct.productCode).supportedRegions = ["MM"];
    assertConflict(buildCatalogSeedPlan({ dbProducts: regionDb, dbPackages: fullDbPackages, staticSnapshot: snapshot }), "product", item => (
        item.productCode === sampleProduct.productCode && item.conflicts.some(conflict => conflict.includes("supportedRegions"))
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

function assertSourceResolvers() {
    const rows = {
        products: [{ productCode: "mlbb", name: "Verifier", enabled: true, supportedRegions: ["MM", "TH"] }],
        packages: [{ productCode: "mlbb", packageCode: "VERIFIER_DB_1", name: "Verifier Package", enabled: true,
            prices: { MM: { amount: 6800, currency: "MMK", enabled: true }, TH: { amount: 55, currency: "THB", enabled: true } } }]
    };
    const databaseItem = resolveDatabasePackagePriceFromRows({
        productCode: "mlbb",
        packageCode: "VERIFIER_DB_1",
        region: "TH",
        clientAmount: 55,
        clientCurrency: "THB"
    }, rows);

    assert.strictEqual(databaseItem.amount, 55);
    assert.strictEqual(databaseItem.currency, "THB");

    const disabledProductRows = clone(rows);
    disabledProductRows.products[0].enabled = false;
    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "VERIFIER_DB_1",
        region: "TH"
    }, disabledProductRows, "PRODUCT_DISABLED");

    const disabledPackageRows = clone(rows);
    disabledPackageRows.packages[0].enabled = false;
    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "VERIFIER_DB_1",
        region: "TH"
    }, disabledPackageRows, "PACKAGE_DISABLED");

    const unsupportedRegionRows = clone(rows);
    unsupportedRegionRows.packages[0].prices.TH.enabled = false;
    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "VERIFIER_DB_1",
        region: "TH"
    }, unsupportedRegionRows, "REGION_NOT_SUPPORTED");

    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "UNKNOWN_PACKAGE",
        region: "TH"
    }, rows, "PACKAGE_NOT_FOUND");

    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "VERIFIER_DB_1",
        region: "TH",
        clientAmount: 1
    }, rows, "PRICE_MISMATCH");

    assertDatabaseCatalogError({
        productCode: "mlbb",
        packageCode: "VERIFIER_DB_1",
        region: "TH",
        clientCurrency: "MMK"
    }, rows, "CURRENCY_MISMATCH");
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

async function main() {
    assertSeedPlanning();
    assertNoHistoricalMutationOwnership();
    assertSourceResolvers();

    console.log("Catalog deterministic seed planning and row-resolution checks passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
