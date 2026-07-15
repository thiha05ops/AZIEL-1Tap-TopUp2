const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "../..", ".env")
});

const ManualPaymentAttempt = require("../models/ManualPaymentAttempt");
const Order = require("../models/Order");
const User = require("../models/User");
const WalletTopup = require("../models/WalletTopup");
const WalletTransaction = require("../models/WalletTransaction");
const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const {
    getStaticCatalogSnapshot
} = require("../catalog/catalogProjection");
const {
    CatalogError,
    getCatalogSource,
    resolveOrderCatalog,
    resolvePackagePrice
} = require("../services/catalogService");

const ROOT = path.join(__dirname, "../..");
const ENABLED_SAMPLES = [
    ["mlbb", "MLBB_WEEKLY_1X"],
    ["pubg", "PUBG_60_UC"],
    ["freefire", "FF_100_DIA"],
    ["hok", "HOK_WEEKLY_CARD"],
    ["aovid", "AOVID_40"],
    ["pubgrp", "PUBGRP_ELITE_1_100"],
    ["telegram", "TG_50_STARS"]
];
const DISABLED_PRODUCTS = ["genshin", "roblox", "valorant"];

async function countOperationalCollections() {
    const [orders, walletTransactions, walletTopups, users, manualPaymentAttempts] = await Promise.all([
        Order.countDocuments(),
        WalletTransaction.countDocuments(),
        WalletTopup.countDocuments(),
        User.countDocuments(),
        ManualPaymentAttempt.countDocuments()
    ]);

    return {
        Order: orders,
        WalletTransaction: walletTransactions,
        WalletTopup: walletTopups,
        User: users,
        ManualPaymentAttempt: manualPaymentAttempts
    };
}

function assertCountsUnchanged(before, after) {
    Object.keys(before).forEach(key => {
        assert.strictEqual(after[key], before[key], `${key} count changed`);
    });
}

async function expectCatalogError(promise, code) {
    try {
        await promise;
    } catch (error) {
        assert(error instanceof CatalogError, `Expected CatalogError ${code}`);
        assert.strictEqual(error.code, code);
        return;
    }

    throw new Error(`Expected ${code}`);
}

function assertProjectionEqual(left, right, label) {
    [
        "productCode",
        "packageCode",
        "productName",
        "packageName",
        "region",
        "amount",
        "currency"
    ].forEach(key => {
        assert.strictEqual(left[key], right[key], `${label}: ${key}`);
    });
}

async function verifySourceBasics(source) {
    const mlbbMm = await resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "MM"
    }, { source });
    const mlbbTh = await resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH"
    }, { source });

    assert.strictEqual(mlbbMm.currency, "MMK");
    assert.strictEqual(mlbbTh.currency, "THB");
    assert(Number.isFinite(Number(mlbbMm.amount)) && Number(mlbbMm.amount) > 0, `${source} MM amount must be positive`);
    assert(Number.isFinite(Number(mlbbTh.amount)) && Number(mlbbTh.amount) > 0, `${source} TH amount must be positive`);

    if (source === "static") {
        assert.strictEqual(mlbbMm.amount, 6800);
        assert.strictEqual(mlbbTh.amount, 55);
    }

    await expectCatalogError(resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientAmount: Number(mlbbTh.amount) + 1
    }, { source }), "PRICE_MISMATCH");
    await expectCatalogError(resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientCurrency: "MMK"
    }, { source }), "CURRENCY_MISMATCH");
    await expectCatalogError(resolvePackagePrice({
        productCode: "unknown-product",
        packageCode: "NOPE",
        region: "TH"
    }, { source }), "PRODUCT_NOT_FOUND");
    await expectCatalogError(resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "NOPE",
        region: "TH"
    }, { source }), "PACKAGE_NOT_FOUND");
    await expectCatalogError(resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "US"
    }, { source }), "REGION_NOT_SUPPORTED");

    for (const productCode of DISABLED_PRODUCTS) {
        await expectCatalogError(resolvePackagePrice({
            productCode,
            packageCode: "DISABLED_TEST",
            region: "TH"
        }, { source }), "PRODUCT_DISABLED");
    }

    for (const [productCode, packageCode] of ENABLED_SAMPLES) {
        const mm = await resolvePackagePrice({ productCode, packageCode, region: "MM" }, { source });
        const th = await resolvePackagePrice({ productCode, packageCode, region: "TH" }, { source });

        assert.strictEqual(mm.productCode, productCode);
        assert.strictEqual(mm.packageCode, packageCode);
        assert.strictEqual(mm.currency, "MMK");
        assert.strictEqual(th.currency, "THB");
        assert(mm.productName);
        assert(th.packageName);
    }
}

async function verifyLiveDatabaseIntegrity() {
    const [products, packages] = await Promise.all([
        CatalogProduct.find().lean(),
        CatalogPackage.find().lean()
    ]);

    const productCodes = new Set();
    const packageKeys = new Set();

    products.forEach(product => {
        assert(product.productCode, "productCode missing");
        assert(!productCodes.has(product.productCode), `duplicate productCode ${product.productCode}`);
        productCodes.add(product.productCode);
        assert(product.name, `${product.productCode} name missing`);
        assert(Array.isArray(product.supportedRegions), `${product.productCode} supportedRegions missing`);
        product.supportedRegions.forEach(region => {
            assert(["MM", "TH"].includes(region), `${product.productCode} invalid region ${region}`);
        });
    });

    packages.forEach(item => {
        assert(productCodes.has(item.productCode), `${item.productCode}:${item.packageCode} orphan package`);
        const key = `${item.productCode}:${item.packageCode}`;
        assert(!packageKeys.has(key), `duplicate package identity ${key}`);
        packageKeys.add(key);
        assert(item.name, `${key} name missing`);

        [
            ["MM", "MMK"],
            ["TH", "THB"]
        ].forEach(([region, currency]) => {
            const price = item.prices?.[region];
            if (!price) return;

            assert.strictEqual(price.currency, currency, `${key}:${region} currency`);
            assert(Number.isFinite(Number(price.amount)) && Number(price.amount) > 0, `${key}:${region} amount must be positive`);
        });
    });

    return {
        liveProducts: products.length,
        livePackages: packages.length
    };
}

async function verifyStaticDatabaseDriftReport() {
    const snapshot = getStaticCatalogSnapshot();
    const identityErrors = [];
    const priceDrifts = [];
    const enabledDrifts = [];
    let regionalResolutions = 0;
    const dbProducts = await CatalogProduct.find().lean();
    const dbPackages = await CatalogPackage.find().lean();
    const dbProductMap = new Map(dbProducts.map(item => [item.productCode, item]));
    const dbPackageMap = new Map(dbPackages.map(item => [`${item.productCode}:${item.packageCode}`, item]));

    snapshot.products.forEach(staticProduct => {
        const dbProduct = dbProductMap.get(staticProduct.productCode);
        if (!dbProduct) {
            identityErrors.push(`${staticProduct.productCode}:missing_product`);
            return;
        }

        if (Boolean(dbProduct.enabled) !== Boolean(staticProduct.enabled)) {
            enabledDrifts.push(`${staticProduct.productCode}:product_enabled:${staticProduct.enabled}->${dbProduct.enabled}`);
        }
    });

    for (const item of snapshot.packages) {
        const dbPackage = dbPackageMap.get(`${item.productCode}:${item.packageCode}`);

        if (!dbPackage) {
            identityErrors.push(`${item.productCode}:${item.packageCode}:missing_package`);
            continue;
        }

        if (Boolean(dbPackage.enabled) !== Boolean(item.enabled)) {
            enabledDrifts.push(`${item.productCode}:${item.packageCode}:package_enabled:${item.enabled}->${dbPackage.enabled}`);
        }

        for (const region of Object.keys(item.prices || {})) {
            regionalResolutions += 1;
            const staticPrice = item.prices?.[region];
            const dbPrice = dbPackage.prices?.[region];

            if (!dbPrice) {
                identityErrors.push(`${item.productCode}:${item.packageCode}:${region}:missing_price`);
                continue;
            }

            if (dbPrice.currency !== staticPrice.currency) {
                identityErrors.push(`${item.productCode}:${item.packageCode}:${region}:currency:${staticPrice.currency}->${dbPrice.currency}`);
            }

            if (Number(dbPrice.amount) !== Number(staticPrice.amount)) {
                priceDrifts.push(`${item.productCode}:${item.packageCode}:${region}:${staticPrice.amount}->${dbPrice.amount}`);
            }

            if (Boolean(dbPrice.enabled) !== Boolean(staticPrice.enabled)) {
                enabledDrifts.push(`${item.productCode}:${item.packageCode}:${region}_price_enabled:${staticPrice.enabled}->${dbPrice.enabled}`);
            }
        }
    }

    for (const productCode of DISABLED_PRODUCTS) {
        try {
            await expectCatalogError(resolvePackagePrice({
                productCode,
                packageCode: "DISABLED_TEST",
                region: "TH"
            }, { source: "static" }), "PRODUCT_DISABLED");
            await expectCatalogError(resolvePackagePrice({
                productCode,
                packageCode: "DISABLED_TEST",
                region: "TH"
            }, { source: "database" }), "PRODUCT_DISABLED");
        } catch (error) {
            identityErrors.push(`${productCode}:disabled:${error.code || error.message}`);
        }
    }

    assert.deepStrictEqual(identityErrors, []);

    return {
        productsCompared: snapshot.products.length,
        packagesCompared: snapshot.packages.length,
        regionalResolutions,
        identityErrors: identityErrors.length,
        adminManagedPriceDrifts: priceDrifts,
        adminManagedEnabledDrifts: enabledDrifts
    };
}

async function verifyOrderProjection(source) {
    const canonical = await resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH"
    }, { source });
    const projected = await resolveOrderCatalog({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        amount: canonical.amount,
        currency: canonical.currency
    }, { source });

    assert.strictEqual(projected.game, "Mobile Legends");
    assert.strictEqual(projected.selectedPackage, "Weekly Pass 1x");
    assert.strictEqual(projected.amount, canonical.amount);
    assert.strictEqual(projected.currency, canonical.currency);
}

async function verifyDatabaseReadFailure() {
    const originalFind = CatalogProduct.find;

    try {
        CatalogProduct.find = () => {
            throw new Error("SIMULATED_DB_READ_FAILURE");
        };

        await expectCatalogError(resolvePackagePrice({
            productCode: "mlbb",
            packageCode: "MLBB_WEEKLY_1X",
            region: "TH",
            clientAmount: 1,
            clientCurrency: "MMK"
        }, { source: "database" }), "CATALOG_UNAVAILABLE");
    } finally {
        CatalogProduct.find = originalFind;
    }
}

function verifyRouteOwnership() {
    const routeFiles = [
        "backend/routes/payment.js",
        "backend/routes/order.js",
        "backend/routes/wallet.js"
    ];

    routeFiles.forEach(file => {
        const source = fs.readFileSync(path.join(ROOT, file), "utf8");
        assert(source.includes("require(\"../services/catalogService\")"), `${file} should use catalogService`);
        assert(!source.includes("require(\"../catalog/catalog\")"), `${file} must not import static catalog directly`);
        assert(!source.includes("require('../catalog/catalog')"), `${file} must not import static catalog directly`);
    });

    const payment = fs.readFileSync(path.join(ROOT, "backend/routes/payment.js"), "utf8");
    const order = fs.readFileSync(path.join(ROOT, "backend/routes/order.js"), "utf8");
    const wallet = fs.readFileSync(path.join(ROOT, "backend/routes/wallet.js"), "utf8");

    const paymentCatalogCalls =
        (payment.match(/await resolveOrderCatalog/g) || []).length +
        (payment.match(/await resolvePurchasePricing/g) || []).length;
    const orderCatalogCalls =
        (order.match(/await resolveOrderCatalog/g) || []).length +
        (order.match(/await resolvePurchasePricing/g) || []).length;
    const walletCatalogCalls =
        (wallet.match(/await resolveOrderCatalog/g) || []).length +
        (wallet.match(/await resolvePurchasePricing/g) || []).length;

    assert(paymentCatalogCalls >= 2, "payment route catalog-backed calls must be awaited");
    assert(orderCatalogCalls >= 1, "order route catalog-backed call must be awaited");
    assert(walletCatalogCalls >= 1, "wallet route catalog-backed call must be awaited");
}

function verifySourceConfiguration() {
    const original = process.env.CATALOG_SOURCE;

    try {
        process.env.CATALOG_SOURCE = "static";
        assert.strictEqual(getCatalogSource(), "static");
        process.env.CATALOG_SOURCE = "database";
        assert.strictEqual(getCatalogSource(), "database");
        process.env.CATALOG_SOURCE = "browser";
        assert.throws(() => getCatalogSource(), /Catalog source configuration is invalid/);
    } finally {
        if (original === undefined) {
            delete process.env.CATALOG_SOURCE;
        } else {
            process.env.CATALOG_SOURCE = original;
        }
    }
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });

    try {
        const before = await countOperationalCollections();
        verifySourceConfiguration();
        verifyRouteOwnership();
        await verifySourceBasics("static");
        await verifySourceBasics("database");
        await verifyOrderProjection("static");
        await verifyOrderProjection("database");
        const liveIntegrity = await verifyLiveDatabaseIntegrity();
        const driftReport = await verifyStaticDatabaseDriftReport();
        await verifyDatabaseReadFailure();
        const after = await countOperationalCollections();
        assertCountsUnchanged(before, after);

        console.log(JSON.stringify({
            activeCatalogSource: getCatalogSource(),
            ...liveIntegrity,
            ...driftReport,
            operationalCountsBefore: before,
            operationalCountsAfter: after
        }, null, 2));
        console.log("Catalog runtime source verification checks passed.");
    } finally {
        await mongoose.connection.close(false);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
