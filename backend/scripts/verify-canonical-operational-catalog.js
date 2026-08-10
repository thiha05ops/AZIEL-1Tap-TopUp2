const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "../..", ".env")
});

const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const CommerceOrder = require("../models/CommerceOrder");
const ManualPaymentAttempt = require("../models/ManualPaymentAttempt");
const WalletTransaction = require("../models/WalletTransaction");
const {
    CANONICAL_OPERATIONAL_PRODUCTS,
    CANONICAL_PRODUCT_CODES,
    CANONICAL_PRODUCT_CODE_SET
} = require("../catalog/canonicalOperationalCatalog");
const {
    isAdminCanonicalCatalogProduct,
    toPublicCatalog
} = require("../services/catalogService");

const ROOT = path.join(__dirname, "../..");

async function connect() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        throw new Error("MONGO_URI is required for canonical catalog verification.");
    }
    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });
}

async function packageCountsByProduct() {
    const rows = await CatalogPackage.aggregate([
        { $group: { _id: "$productCode", count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
    ]);
    return Object.fromEntries(rows.map(row => [row._id, row.count]));
}

async function commerceCounts() {
    const [commerceOrders, manualPaymentAttempts, walletTransactions] = await Promise.all([
        CommerceOrder.countDocuments(),
        ManualPaymentAttempt.countDocuments(),
        WalletTransaction.countDocuments()
    ]);
    return { CommerceOrder: commerceOrders, ManualPaymentAttempt: manualPaymentAttempts, WalletTransaction: walletTransactions };
}

function assertSameArray(actual, expected, message) {
    assert.deepStrictEqual([...actual].sort(), [...expected].sort(), message);
}

function assertMigrationDoesNotMutateCommerceHistory() {
    const source = fs.readFileSync(path.join(ROOT, "backend/scripts/migrate-canonical-operational-catalog.js"), "utf8");
    [
        "CommerceOrder.update",
        "CommerceOrder.delete",
        "ManualPaymentAttempt.update",
        "ManualPaymentAttempt.delete",
        "WalletTransaction.update",
        "WalletTransaction.delete",
        "CatalogPackage.update",
        "CatalogPackage.delete"
    ].forEach(forbidden => {
        assert(!source.includes(forbidden), `Migration must not call ${forbidden}`);
    });
}

async function run() {
    await connect();

    const packageCounts = await packageCountsByProduct();
    const products = await CatalogProduct.find().sort({ sortOrder: 1, productCode: 1 }).lean();
    const productsByCode = new Map(products.map(product => [product.productCode, product]));
    const projectedProducts = await toPublicCatalog({
        source: "database",
        includeDisabled: true,
        includeAssetProjection: false,
        includeAdminPricing: false
    });
    const adminVisibleProducts = projectedProducts.filter(isAdminCanonicalCatalogProduct);
    const adminVisibleCodes = adminVisibleProducts.map(product => product.productCode);
    const activeNonCanonicalProducts = products.filter(product => (
        !CANONICAL_PRODUCT_CODE_SET.has(product.productCode) &&
        product.enabled !== false &&
        !product.deletedAt
    ));

    assertSameArray(adminVisibleCodes, CANONICAL_PRODUCT_CODES, "Admin Catalog must surface only the canonical products.");
    assert.strictEqual(activeNonCanonicalProducts.length, 0, "No active non-canonical products may remain.");

    const retainedProducts = CANONICAL_OPERATIONAL_PRODUCTS.map(canonical => {
        const product = productsByCode.get(canonical.productCode);
        assert(product, `${canonical.productCode} must exist in the canonical catalog.`);
        assert.strictEqual(product.deletedAt, null, `${canonical.productCode} must not be archived.`);
        assert.strictEqual(product.enabled, true, `${canonical.productCode} must be enabled for Admin management.`);
        assert.strictEqual(product.metadata?.category, canonical.category, `${canonical.productCode} category metadata mismatch.`);
        assert.strictEqual(product.metadata?.platform, canonical.platform, `${canonical.productCode} platform metadata mismatch.`);
        assert.strictEqual(product.metadata?.market, canonical.market, `${canonical.productCode} market metadata mismatch.`);

        const projected = adminVisibleProducts.find(item => item.productCode === canonical.productCode);
        assert(projected, `${canonical.productCode} must appear in Admin Catalog projection.`);
        assert.strictEqual(projected.packageCount, packageCounts[canonical.productCode] || 0, `${canonical.productCode} package count projection mismatch.`);

        return {
            productCode: canonical.productCode,
            name: product.name,
            packageCount: packageCounts[canonical.productCode] || 0
        };
    });

    assertMigrationDoesNotMutateCommerceHistory();

    return {
        adminVisibleCodes,
        retainedProducts,
        archivedProducts: products
            .filter(product => !CANONICAL_PRODUCT_CODE_SET.has(product.productCode) && product.deletedAt)
            .map(product => product.productCode)
            .sort(),
        packageCounts,
        historicalCommerceCounts: await commerceCounts(),
        sourceSafety: {
            catalogPackagesUntouched: true,
            historicalCommerceModelsUntouched: true
        }
    };
}

if (require.main === module) {
    run()
        .then(result => {
            console.log(JSON.stringify(result, null, 2));
        })
        .catch(error => {
            console.error(error?.message || error);
            process.exitCode = 1;
        })
        .finally(async () => {
            await mongoose.disconnect();
        });
}

module.exports = { run };
