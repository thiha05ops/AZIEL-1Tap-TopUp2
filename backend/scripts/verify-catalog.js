const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const {
    CatalogError,
    resolveOrderCatalog,
    resolvePackagePrice,
    toPublicCatalog
} = require("../services/catalogService");

const ROOT = path.join(__dirname, "../..");
const PRICE_FILE = path.join(ROOT, "frontend/js/prices.js");
const ACTIVE_PRODUCTS = ["mlbb", "pubg", "freefire", "hok", "aovid", "pubgrp", "telegram"];
const DISABLED_PRODUCTS = ["genshin", "roblox", "valorant"];

function loadFrontendPrices() {
    const source = fs.readFileSync(PRICE_FILE, "utf8");
    const sandbox = {
        window: {},
        document: {
            addEventListener() {},
            getElementById() {
                return null;
            },
            dispatchEvent() {},
            querySelector() {
                return null;
            },
            querySelectorAll() {
                return [];
            }
        },
        CustomEvent: function CustomEvent(name, options) {
            return { name, ...options };
        },
        Event: function Event(name) {
            return { name };
        },
        console
    };

    sandbox.window.ASSET = new Proxy({}, {
        get(_target, key) {
            return file => `assets/${String(key)}/${file}`;
        }
    });

    vm.runInNewContext(source, sandbox, {
        filename: PRICE_FILE
    });

    return sandbox.window.GAME_PRICES || {};
}

function assertCatalogService() {
    const mlbbTh = resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH"
    });

    assert.strictEqual(mlbbTh.amount, 55);
    assert.strictEqual(mlbbTh.currency, "THB");
    assert.strictEqual(mlbbTh.packageName, "Weekly Pass 1x");

    const mlbbMm = resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "MM"
    });

    assert.strictEqual(mlbbMm.amount, 6800);
    assert.strictEqual(mlbbMm.currency, "MMK");

    assertCatalogError(() => resolvePackagePrice({
        productCode: "unknown",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH"
    }), "PRODUCT_NOT_FOUND");

    assertCatalogError(() => resolvePackagePrice({
        productCode: "genshin",
        packageCode: "GENSHIN_FAKE",
        region: "TH"
    }), "PRODUCT_DISABLED");

    assertCatalogError(() => resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_FAKE",
        region: "TH"
    }), "PACKAGE_NOT_FOUND");

    assertCatalogError(() => resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "US"
    }), "REGION_NOT_SUPPORTED");

    assertCatalogError(() => resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientAmount: 1
    }), "PRICE_MISMATCH");

    assertCatalogError(() => resolvePackagePrice({
        productCode: "mlbb",
        packageCode: "MLBB_WEEKLY_1X",
        region: "TH",
        clientCurrency: "MMK"
    }), "CURRENCY_MISMATCH");

    const orderProjection = resolveOrderCatalog({
        gameKey: "mlbb",
        game: "Client Name",
        packageCode: "MLBB_WEEKLY_1X",
        packageName: "Client Package",
        region: "TH",
        amount: 55,
        currency: "THB"
    });

    assert.strictEqual(orderProjection.game, "Mobile Legends");
    assert.strictEqual(orderProjection.packageName, "Weekly Pass 1x");
    assert.strictEqual(orderProjection.amount, 55);
    assert.strictEqual(orderProjection.currency, "THB");
}

function assertCatalogError(fn, code) {
    try {
        fn();
    } catch (error) {
        assert(error instanceof CatalogError, `Expected CatalogError for ${code}`);
        assert.strictEqual(error.code, code);
        return;
    }

    throw new Error(`Expected ${code}`);
}

function assertParity() {
    const frontendPrices = loadFrontendPrices();
    const backendProducts = new Map(toPublicCatalog().map(product => [product.productCode, product]));
    const mismatches = [];

    ACTIVE_PRODUCTS.forEach(productCode => {
        const frontendPackages = frontendPrices[productCode] || [];
        const backendProduct = backendProducts.get(productCode);

        if (!backendProduct?.enabled) {
            mismatches.push(`${productCode}: backend product is missing or disabled`);
            return;
        }

        const backendPackages = new Map(
            backendProduct.packages
                .filter(item => item.enabled)
                .map(item => [item.packageCode, item])
        );

        frontendPackages.forEach(frontendPackage => {
            const backendPackage = backendPackages.get(frontendPackage.code);

            if (!backendPackage) {
                mismatches.push(`${productCode}:${frontendPackage.code} missing in backend`);
                return;
            }

            comparePrice(mismatches, productCode, frontendPackage.code, "MM", frontendPackage.mmk, "MMK", backendPackage);
            comparePrice(mismatches, productCode, frontendPackage.code, "TH", frontendPackage.thb, "THB", backendPackage);
        });

        backendPackages.forEach(backendPackage => {
            if (!frontendPackages.some(frontendPackage => frontendPackage.code === backendPackage.packageCode)) {
                mismatches.push(`${productCode}:${backendPackage.packageCode} missing in frontend`);
            }
        });
    });

    DISABLED_PRODUCTS.forEach(productCode => {
        const backendProduct = backendProducts.get(productCode);
        const frontendPackages = frontendPrices[productCode] || [];

        if (backendProduct?.enabled) {
            mismatches.push(`${productCode}: disabled launch product is enabled in backend`);
        }

        if (frontendPackages.length) {
            mismatches.push(`${productCode}: disabled launch product has frontend packages`);
        }
    });

    if (mismatches.length) {
        console.error("Catalog parity failed:");
        mismatches.forEach(item => console.error(`- ${item}`));
        process.exitCode = 1;
        return;
    }

    console.log("Catalog service checks passed.");
    console.log("Catalog parity check passed.");
}

function comparePrice(mismatches, productCode, packageCode, region, amount, currency, backendPackage) {
    const backendPrice = backendPackage.prices?.[region];

    if (!backendPrice) {
        mismatches.push(`${productCode}:${packageCode}:${region} missing backend price`);
        return;
    }

    if (Math.abs(Number(amount) - Number(backendPrice.amount)) > 0.000001) {
        mismatches.push(`${productCode}:${packageCode}:${region} amount mismatch frontend=${amount} backend=${backendPrice.amount}`);
    }

    if (currency !== backendPrice.currency) {
        mismatches.push(`${productCode}:${packageCode}:${region} currency mismatch frontend=${currency} backend=${backendPrice.currency}`);
    }
}

assertCatalogService();
assertParity();
