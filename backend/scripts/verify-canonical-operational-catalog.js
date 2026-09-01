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
const PackageMarketPublication = require("../models/PackageMarketPublication");
const WalletTransaction = require("../models/WalletTransaction");
const {
    CANONICAL_OPERATIONAL_PRODUCTS,
    CANONICAL_PRODUCT_CODES,
    CANONICAL_PRODUCT_CODE_SET
} = require("../catalog/canonicalOperationalCatalog");
const {
    isAdminCanonicalCatalogProduct,
    resolveAdminCatalogProduct,
    toPublicCatalog
} = require("../services/catalogService");

const ROOT = path.join(__dirname, "../..");
const EXPECTED_EXPLICIT_TH_PACKAGE_COUNTS = Object.freeze({
    mlbb: 18,
    "mlbb-twilight-weekly-pass": 2,
    pubg: 6,
    freefire: 9,
    "freefire-pass-membership": 10,
    hok: 12
});

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

async function packageStateCountsByProduct() {
    const rows = await CatalogPackage.find().select("productCode enabled deletedAt").lean();
    return rows.reduce((counts, pkg) => {
        const state = counts[pkg.productCode] || { total: 0, enabled: 0, disabled: 0, archived: 0 };
        state.total += 1;
        if (pkg.enabled === false) state.disabled += 1;
        else state.enabled += 1;
        if (pkg.deletedAt) state.archived += 1;
        counts[pkg.productCode] = state;
        return counts;
    }, {});
}

function packageIdentitySet(products = []) {
    return new Set(products.flatMap(product => (product.packages || []).map(pkg => `${product.productCode}/${pkg.packageCode}`)));
}

function assertSubset(subset, superset, message) {
    const missing = [...subset].filter(identity => !superset.has(identity));
    assert.deepStrictEqual(missing, [], message);
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
    const packageStateCounts = await packageStateCountsByProduct();
    const products = await CatalogProduct.find().sort({ sortOrder: 1, productCode: 1 }).lean();
    const productsByCode = new Map(products.map(product => [product.productCode, product]));
    const canonicalInventoryProducts = await Promise.all(CANONICAL_PRODUCT_CODES.map(productCode => resolveAdminCatalogProduct(productCode, {
        includeAssetProjection: false,
        includeAdminPricing: true,
        customerMarket: "TH"
    })));
    const explicitPublicProducts = await toPublicCatalog({
        source: "database",
        includeDisabled: true,
        includeAssetProjection: false,
        includeAdminPricing: false,
        customerMarket: "TH",
        publicationProjectionMode: "EXPLICIT"
    });
    const legacyPublicProducts = await toPublicCatalog({
        source: "database",
        includeDisabled: true,
        includeAssetProjection: false,
        includeAdminPricing: false,
        customerMarket: "TH",
        publicationProjectionMode: "LEGACY"
    });
    const originalLog = console.log;
    let shadowPublicProducts;
    try {
        console.log = () => {};
        shadowPublicProducts = await toPublicCatalog({
            source: "database",
            includeDisabled: true,
            includeAssetProjection: false,
            includeAdminPricing: false,
            customerMarket: "TH",
            publicationProjectionMode: "SHADOW"
        });
    } finally {
        console.log = originalLog;
    }
    const publishedRecords = await PackageMarketPublication.find({ customerMarket: "TH", published: true }).lean();
    const adminVisibleProducts = canonicalInventoryProducts.filter(isAdminCanonicalCatalogProduct);
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
        assert.strictEqual(typeof product.enabled, "boolean", `${canonical.productCode} must retain an explicit enabled/disabled state.`);
        if (product.metadata?.category != null) assert.strictEqual(product.metadata.category, canonical.category, `${canonical.productCode} category metadata conflicts with canonical authority.`);
        if (product.metadata?.platform != null) assert.strictEqual(product.metadata.platform, canonical.platform, `${canonical.productCode} platform metadata conflicts with canonical authority.`);
        if (product.metadata?.market != null) assert.strictEqual(product.metadata.market, canonical.market, `${canonical.productCode} market metadata conflicts with canonical authority.`);

        const canonicalProjection = adminVisibleProducts.find(item => item.productCode === canonical.productCode);
        assert(canonicalProjection, `${canonical.productCode} must appear in Admin Catalog projection.`);
        assert.strictEqual(canonicalProjection.packageCount, packageCounts[canonical.productCode] || 0, `${canonical.productCode} canonical package count projection mismatch.`);
        assert.strictEqual(packageStateCounts[canonical.productCode]?.total || 0, packageCounts[canonical.productCode] || 0, `${canonical.productCode} enabled/disabled package accounting mismatch.`);

        return {
            productCode: canonical.productCode,
            name: product.name,
            enabled: product.enabled,
            packageCount: packageCounts[canonical.productCode] || 0
        };
    });

    const canonicalPackageSet = packageIdentitySet(adminVisibleProducts);
    const explicitPublicPackageSet = packageIdentitySet(explicitPublicProducts);
    const legacyPublicPackageSet = packageIdentitySet(legacyPublicProducts);
    const shadowPublicPackageSet = packageIdentitySet(shadowPublicProducts);
    const publishedRecordSet = new Set(publishedRecords.map(record => `${record.productCode}/${record.packageCode}`));
    const explicitCounts = Object.fromEntries(explicitPublicProducts.map(product => [product.productCode, product.packageCount]));

    assertSubset(explicitPublicPackageSet, canonicalPackageSet, "Every explicit public package must exist in canonical inventory.");
    assertSubset(publishedRecordSet, canonicalPackageSet, "Every published package decision must reference canonical inventory.");
    assertSameArray(explicitPublicPackageSet, publishedRecordSet, "EXPLICIT public identities must equal published TH decisions.");
    assertSameArray(shadowPublicPackageSet, legacyPublicPackageSet, "SHADOW includeDisabled projection must retain LEGACY customer behavior.");
    assert.deepStrictEqual(explicitCounts, EXPECTED_EXPLICIT_TH_PACKAGE_COUNTS, "EXPLICIT TH public composition must match the reviewed Phase 1C baseline.");
    assert.strictEqual(explicitPublicPackageSet.size, 57, "EXPLICIT TH public package count must remain 57.");
    assert(canonicalPackageSet.size > explicitPublicPackageSet.size, "Private canonical packages must remain valid outside the public projection.");
    assert(packageCounts.mlbb >= 36, "MLBB canonical inventory must preserve the operational baseline while allowing disabled Master Catalog packages.");
    const masterCatalogPackages = await CatalogPackage.find({ "metadata.masterCatalog.authority": "SOURCE_LOCKED_SUPPLIER_SEMANTICS" }).lean();
    assert(masterCatalogPackages.every(pkg => pkg.enabled === false && !pkg.prices?.MM && !pkg.prices?.TH), "Master Catalog packages must remain disabled and unpriced.");
    assert.strictEqual(explicitCounts.mlbb, 18, "MLBB public count is pinned to the reviewed Phase 1C publication baseline.");

    assertMigrationDoesNotMutateCommerceHistory();

    return {
        adminVisibleCodes,
        retainedProducts,
        archivedProducts: products
            .filter(product => !CANONICAL_PRODUCT_CODE_SET.has(product.productCode) && product.deletedAt)
            .map(product => product.productCode)
            .sort(),
        packageCounts,
        packageStateCounts,
        publicProjection: {
            mode: "EXPLICIT",
            packageCount: explicitPublicPackageSet.size,
            packageCounts: explicitCounts,
            publishedIdentityCount: publishedRecordSet.size,
            subsetOfCanonicalInventory: true
        },
        includeDisabledSemantics: {
            LEGACY: "Prevents the base projector from excluding disabled/deleted candidates, but later public eligibility/readiness rules still apply; it is not a full canonical/Admin inventory authority.",
            SHADOW: "Uses the same effective LEGACY projection while computing EXPLICIT comparison diagnostics only.",
            EXPLICIT: "Applies the base includeDisabled choice, then restricts packages to explicit published decisions before public readiness."
        },
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
