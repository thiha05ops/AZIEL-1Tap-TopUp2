const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");
const vm = require("vm");

require("dotenv").config({
    path: path.join(__dirname, "../..", ".env")
});

const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const Order = require("../models/Order");
const User = require("../models/User");
const WalletTopup = require("../models/WalletTopup");
const WalletTransaction = require("../models/WalletTransaction");
const {
    resolvePackagePrice,
    toPublicCatalog
} = require("../services/catalogService");
const {
    CatalogAdminError,
    updatePackage,
    updateProduct
} = require("../services/catalogAdminService");
const {
    assertSafeMutatingVerifierDatabase
} = require("./verifierDatabaseSafety");

const ROOT = path.join(__dirname, "../..");
const TEST_PRODUCT = "phase6test";
const TEST_PACKAGE = "PHASE6_TEST_PACKAGE";

async function cleanupFixture() {
    await CatalogPackage.deleteOne({ productCode: TEST_PRODUCT, packageCode: TEST_PACKAGE });
    await CatalogProduct.deleteOne({ productCode: TEST_PRODUCT });
}

async function createFixture() {
    await cleanupFixture();
    await CatalogProduct.create({
        productCode: TEST_PRODUCT,
        name: "Phase 6 Test Product",
        enabled: true,
        supportedRegions: ["MM", "TH"],
        source: "admin",
        sortOrder: 9999
    });
    await CatalogPackage.create({
        productCode: TEST_PRODUCT,
        packageCode: TEST_PACKAGE,
        name: "Phase 6 Test Package",
        enabled: true,
        prices: {
            MM: { amount: 6800, currency: "MMK", enabled: true },
            TH: { amount: 55, currency: "THB", enabled: true }
        },
        source: "admin",
        sortOrder: 1
    });
}

async function getFixtureProduct() {
    return CatalogProduct.findOne({ productCode: TEST_PRODUCT });
}

async function getFixturePackage() {
    return CatalogPackage.findOne({ productCode: TEST_PRODUCT, packageCode: TEST_PACKAGE });
}

async function expectAdminError(promise, code) {
    try {
        await promise;
    } catch (error) {
        assert(error instanceof CatalogAdminError, `Expected CatalogAdminError ${code}`);
        assert.strictEqual(error.code, code);
        return;
    }

    throw new Error(`Expected ${code}`);
}

async function expectCatalogError(promise, code) {
    try {
        await promise;
    } catch (error) {
        assert.strictEqual(error.code, code);
        return;
    }

    throw new Error(`Expected ${code}`);
}

async function operationalCounts() {
    const [orders, walletTransactions, walletTopups, users] = await Promise.all([
        Order.countDocuments(),
        WalletTransaction.countDocuments(),
        WalletTopup.countDocuments(),
        User.countDocuments()
    ]);
    const userWallets = await User.find().select("wallet").lean();

    return {
        orders,
        walletTransactions,
        walletTopups,
        users,
        walletTotal: userWallets.reduce((sum, user) => (
            sum + Number(user.wallet?.MMK || 0) + Number(user.wallet?.THB || 0)
        ), 0)
    };
}

function assertRouteSecurity() {
    const routes = fs.readFileSync(path.join(ROOT, "backend/routes/catalog.js"), "utf8");
    assert(routes.includes('router.patch("/admin/catalog/products/:productCode", adminMiddleware'), "product mutation must require adminMiddleware");
    assert(routes.includes('router.patch("/admin/catalog/products/:productCode/packages/:packageCode", adminMiddleware'), "package mutation must require adminMiddleware");
}

function assertFrontendOverlay() {
    const runtimeSource = fs.readFileSync(path.join(ROOT, "frontend/js/catalog-runtime.js"), "utf8");
    const pricesSource = fs.readFileSync(path.join(ROOT, "frontend/js/prices.js"), "utf8");
    const flowSource = fs.readFileSync(path.join(ROOT, "frontend/js/game-flow.js"), "utf8");
    assert(runtimeSource.includes("/api/catalog"), "runtime overlay must fetch public catalog");
    assert(runtimeSource.includes("overlayGamePrices"), "runtime overlay must map public catalog packages");
    assert(pricesSource.includes("window.AZIEL_CATALOG"), "prices.js must use shared catalog client");
    assert(pricesSource.includes("catalog.getPackages"), "prices.js must render packages from catalog truth");
    assert(flowSource.includes("ensureFreshForPurchase"), "purchase flow must require fresh catalog");
    assert(flowSource.includes("Price updated to the latest catalog price"), "purchase flow must block stale selected price for review");

    const sandbox = {
        window: {},
        document: {
            dispatchEvent() {}
        },
        CustomEvent: function CustomEvent(type, options = {}) {
            return { type, detail: options.detail || {} };
        },
        fetch: async () => ({
            ok: true,
            json: async () => ({
                success: true,
                products: [{
                    productCode: "mlbb",
                    enabled: true,
                    packages: [{
                        packageCode: "MLBB_WEEKLY_1X",
                        enabled: true,
                        prices: {
                            MM: { amount: 7000, currency: "MMK", enabled: true },
                            TH: { amount: 60, currency: "THB", enabled: true }
                        }
                    }]
                }]
            })
        }),
        Date,
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(runtimeSource, sandbox, {
        filename: "catalog-runtime.js"
    });

    return sandbox.window.AZIEL_CATALOG_RUNTIME.loadCatalog()
        .then(() => {
            const overlay = sandbox.window.AZIEL_CATALOG_RUNTIME.overlayGamePrices("mlbb", [
                { code: "MLBB_WEEKLY_1X", name: "Weekly Pass 1x", mmk: 6800, thb: 55 }
            ]);
            assert.strictEqual(overlay.packages[0].mmk, 7000);
            assert.strictEqual(overlay.packages[0].thb, 60);
        });
}

async function main() {
    const safety = assertSafeMutatingVerifierDatabase("verify-admin-catalog-control");
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });

    const before = await operationalCounts();

    try {
        assertRouteSecurity();
        await createFixture();

        let product = await getFixtureProduct();
        let item = await getFixturePackage();

        await expectAdminError(updateProduct({
            productCode: TEST_PRODUCT,
            patch: { productCode: "evil", expectedUpdatedAt: product.updatedAt },
            actor: "verify"
        }), "CATALOG_PATCH_INVALID");
        await expectAdminError(updatePackage({
            productCode: TEST_PRODUCT,
            packageCode: TEST_PACKAGE,
            patch: { packageCode: "EVIL", expectedUpdatedAt: item.updatedAt },
            actor: "verify"
        }), "CATALOG_PATCH_INVALID");

        for (const bad of ["", "abc", "NaN", "Infinity", 0, -1]) {
            await expectAdminError(updatePackage({
                productCode: TEST_PRODUCT,
                packageCode: TEST_PACKAGE,
                patch: { prices: { MM: { amount: bad } }, expectedUpdatedAt: item.updatedAt },
                actor: "verify"
            }), "CATALOG_PRICE_INVALID");
        }

        let result = await updatePackage({
            productCode: TEST_PRODUCT,
            packageCode: TEST_PACKAGE,
            patch: { prices: { MM: { amount: 7000 }, TH: { amount: 60.5 } }, expectedUpdatedAt: item.updatedAt },
            actor: "verify"
        });
        assert.strictEqual(result.changed, true);

        item = await getFixturePackage();
        assert.strictEqual(item.prices.MM.amount, 7000);
        assert.strictEqual(item.prices.MM.currency, "MMK");
        assert.strictEqual(item.prices.TH.amount, 60.5);
        assert.strictEqual(item.prices.TH.currency, "THB");

        result = await updatePackage({
            productCode: TEST_PRODUCT,
            packageCode: TEST_PACKAGE,
            patch: { prices: { MM: { amount: 7000 } }, expectedUpdatedAt: item.updatedAt },
            actor: "verify"
        });
        assert.strictEqual(result.changed, false);

        const staleUpdatedAt = item.updatedAt;
        result = await updatePackage({
            productCode: TEST_PRODUCT,
            packageCode: TEST_PACKAGE,
            patch: { prices: { MM: { amount: 7100 } }, expectedUpdatedAt: item.updatedAt },
            actor: "verify"
        });
        assert.strictEqual(result.changed, true);
        await expectAdminError(updatePackage({
            productCode: TEST_PRODUCT,
            packageCode: TEST_PACKAGE,
            patch: { prices: { MM: { amount: 7200 } }, expectedUpdatedAt: staleUpdatedAt },
            actor: "verify"
        }), "CATALOG_CONFLICT");

        let resolved = await resolvePackagePrice({ productCode: TEST_PRODUCT, packageCode: TEST_PACKAGE, region: "MM" }, { source: "database" });
        assert.strictEqual(resolved.amount, 7100);
        await expectCatalogError(resolvePackagePrice({ productCode: TEST_PRODUCT, packageCode: TEST_PACKAGE, region: "MM", clientAmount: 6800 }, { source: "database" }), "PRICE_MISMATCH");
        resolved = await resolvePackagePrice({ productCode: TEST_PRODUCT, packageCode: TEST_PACKAGE, region: "MM", clientAmount: 7100, clientCurrency: "MMK" }, { source: "database" });
        assert.strictEqual(resolved.amount, 7100);

        product = await getFixtureProduct();
        await updateProduct({
            productCode: TEST_PRODUCT,
            patch: { enabled: false, expectedUpdatedAt: product.updatedAt },
            actor: "verify"
        });
        await expectCatalogError(resolvePackagePrice({ productCode: TEST_PRODUCT, packageCode: TEST_PACKAGE, region: "MM" }, { source: "database" }), "PRODUCT_DISABLED");
        assert(!(await toPublicCatalog({ source: "database", includeDisabled: false })).some(row => row.productCode === TEST_PRODUCT));
        assert((await toPublicCatalog({ source: "database", includeDisabled: true })).some(row => row.productCode === TEST_PRODUCT && row.enabled === false));

        product = await getFixtureProduct();
        await updateProduct({
            productCode: TEST_PRODUCT,
            patch: { enabled: true, expectedUpdatedAt: product.updatedAt },
            actor: "verify"
        });

        item = await getFixturePackage();
        await updatePackage({
            productCode: TEST_PRODUCT,
            packageCode: TEST_PACKAGE,
            patch: { enabled: false, expectedUpdatedAt: item.updatedAt },
            actor: "verify"
        });
        await expectCatalogError(resolvePackagePrice({ productCode: TEST_PRODUCT, packageCode: TEST_PACKAGE, region: "MM" }, { source: "database" }), "PACKAGE_DISABLED");
        const publicProduct = (await toPublicCatalog({ source: "database", includeDisabled: false })).find(row => row.productCode === TEST_PRODUCT);
        assert(!publicProduct.packages.some(row => row.packageCode === TEST_PACKAGE));
        const adminProduct = (await toPublicCatalog({ source: "database", includeDisabled: true })).find(row => row.productCode === TEST_PRODUCT);
        assert(adminProduct.packages.some(row => row.packageCode === TEST_PACKAGE && row.enabled === false));

        item = await getFixturePackage();
        await updatePackage({
            productCode: TEST_PRODUCT,
            packageCode: TEST_PACKAGE,
            patch: { enabled: true, expectedUpdatedAt: item.updatedAt },
            actor: "verify"
        });

        const order = await Order.findOne().lean();
        const orderSnapshot = order ? {
            amount: order.amount,
            currency: order.currency,
            packageName: order.packageName,
            packageCode: order.packageCode
        } : null;
        const orderAfter = order ? await Order.findById(order._id).lean() : null;
        if (orderSnapshot && orderAfter) {
            assert.deepStrictEqual({
                amount: orderAfter.amount,
                currency: orderAfter.currency,
                packageName: orderAfter.packageName,
                packageCode: orderAfter.packageCode
            }, orderSnapshot);
        }

        await assertFrontendOverlay();
    } finally {
        await cleanupFixture();
        const after = await operationalCounts();
        assert.deepStrictEqual(after, before);
        await mongoose.connection.close(false);
    }

    console.log("Admin catalog control verification checks passed.", {
        database: safety.databaseName
    });
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
