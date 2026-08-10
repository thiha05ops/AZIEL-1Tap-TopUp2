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
    CANONICAL_PRODUCT_CODE_SET
} = require("../catalog/canonicalOperationalCatalog");

const ACTOR = "canonical-catalog-cleanup-step-1";

function shouldApply() {
    return process.argv.includes("--apply");
}

async function connect() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        throw new Error("MONGO_URI is required for canonical catalog cleanup.");
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

function marketLabel(market) {
    return market === "southeast_asia" ? "Southeast Asia" : "Global";
}

function buildCanonicalUpdate(product, canonical, packageCount, now) {
    const hasPackages = packageCount > 0;
    const existingMetadata = product?.metadata && typeof product.metadata === "object" ? product.metadata : {};
    const existingPresentation = product?.presentation && typeof product.presentation === "object" ? product.presentation : {};
    const existingRoute = String(canonical.productRoute || product?.productRoute || "").trim();

    return {
        name: canonical.name,
        enabled: true,
        catalogCategory: canonical.catalogCategory,
        lifecycleStatus: hasPackages ? "ACTIVE" : "COMING_SOON",
        commerceState: hasPackages ? "PURCHASABLE" : "HIDDEN",
        publicDiscoveryEnabled: hasPackages,
        productRoute: existingRoute,
        supportedRegions: canonical.supportedRegions,
        sortOrder: canonical.sortOrder,
        deletedAt: null,
        deletedBy: "",
        metadata: {
            ...existingMetadata,
            category: canonical.category,
            platform: canonical.platform,
            market: canonical.market,
            canonicalOperationalCatalog: true,
            canonicalCleanupVersion: 1,
            canonicalCleanupAppliedAt: now,
            canonicalProductName: canonical.name
        },
        presentation: {
            ...existingPresentation,
            displayMarketLabel: marketLabel(canonical.market),
            marketScope: "MULTI_REGION"
        }
    };
}

function buildCreatedProduct(canonical, now) {
    return {
        productCode: canonical.productCode,
        name: canonical.name,
        description: "",
        enabled: true,
        featured: false,
        catalogCategory: canonical.catalogCategory,
        lifecycleStatus: "COMING_SOON",
        commerceState: "HIDDEN",
        publicDiscoveryEnabled: false,
        homepageEnabled: false,
        homepageCategory: canonical.catalogCategory,
        homepageOrder: 0,
        homepageFlags: [],
        homepageSections: [],
        productRoute: canonical.productRoute || "",
        artworkPath: "",
        supportedRegions: canonical.supportedRegions,
        aliases: [],
        sortOrder: canonical.sortOrder,
        source: "admin",
        metadata: {
            category: canonical.category,
            platform: canonical.platform,
            market: canonical.market,
            canonicalOperationalCatalog: true,
            canonicalCleanupVersion: 1,
            canonicalCleanupAppliedAt: now,
            canonicalProductName: canonical.name
        },
        presentation: {
            displayMarketLabel: marketLabel(canonical.market),
            marketScope: "MULTI_REGION"
        },
        deletedAt: null,
        deletedBy: ""
    };
}

function assertCountsUnchanged(before, after, label) {
    Object.keys(before).forEach(key => {
        if (before[key] !== after[key]) {
            throw new Error(`${label} count changed for ${key}: ${before[key]} -> ${after[key]}`);
        }
    });
}

async function run() {
    const apply = shouldApply();
    await connect();

    const now = new Date();
    const beforeProducts = await CatalogProduct.find().sort({ productCode: 1 }).lean();
    const beforePackageCounts = await packageCountsByProduct();
    const beforeCommerceCounts = await commerceCounts();
    const beforeByCode = new Map(beforeProducts.map(product => [product.productCode, product]));

    const productsRetained = [];
    const productsCreated = [];

    for (const canonical of CANONICAL_OPERATIONAL_PRODUCTS) {
        const existing = beforeByCode.get(canonical.productCode);
        const packageCount = beforePackageCounts[canonical.productCode] || 0;

        if (existing) {
            productsRetained.push({
                productCode: canonical.productCode,
                name: canonical.name,
                packageCount
            });
            if (apply) {
                await CatalogProduct.updateOne(
                    { productCode: canonical.productCode },
                    { $set: buildCanonicalUpdate(existing, canonical, packageCount, now) }
                );
            }
        } else {
            productsCreated.push({
                productCode: canonical.productCode,
                name: canonical.name,
                packageCount: 0
            });
            if (apply) {
                await CatalogProduct.create(buildCreatedProduct(canonical, now));
            }
        }
    }

    const nonCanonicalProducts = beforeProducts.filter(product => !CANONICAL_PRODUCT_CODE_SET.has(product.productCode));
    const productsArchived = nonCanonicalProducts.map(product => ({
        productCode: product.productCode,
        name: product.name,
        alreadyArchived: Boolean(product.deletedAt || product.enabled === false),
        packageCount: beforePackageCounts[product.productCode] || 0
    }));

    if (apply && nonCanonicalProducts.length > 0) {
        await CatalogProduct.updateMany(
            { productCode: { $nin: Array.from(CANONICAL_PRODUCT_CODE_SET) } },
            {
                $set: {
                    enabled: false,
                    publicDiscoveryEnabled: false,
                    homepageEnabled: false,
                    commerceState: "HIDDEN",
                    lifecycleStatus: "COMING_SOON",
                    deletedAt: now,
                    deletedBy: ACTOR,
                    "metadata.canonicalOperationalCatalog": false,
                    "metadata.archivedByCanonicalCleanup": true,
                    "metadata.archivedReason": "NON_CANONICAL_OPERATIONAL_PRODUCT",
                    "metadata.canonicalCleanupVersion": 1,
                    "metadata.canonicalCleanupAppliedAt": now
                }
            }
        );
    }

    const afterPackageCounts = await packageCountsByProduct();
    const afterCommerceCounts = await commerceCounts();
    assertCountsUnchanged(beforePackageCounts, afterPackageCounts, "CatalogPackage");
    assertCountsUnchanged(beforeCommerceCounts, afterCommerceCounts, "Historical commerce");

    const afterProducts = await CatalogProduct.find().sort({ sortOrder: 1, productCode: 1 }).lean();
    const activeNonCanonical = afterProducts.filter(product => (
        !CANONICAL_PRODUCT_CODE_SET.has(product.productCode) &&
        product.enabled !== false &&
        !product.deletedAt
    ));
    if (apply && activeNonCanonical.length > 0) {
        throw new Error(`Active non-canonical products remain: ${activeNonCanonical.map(item => item.productCode).join(", ")}`);
    }

    const retainedAfter = CANONICAL_OPERATIONAL_PRODUCTS.map(canonical => ({
        productCode: canonical.productCode,
        name: canonical.name,
        packageCount: afterPackageCounts[canonical.productCode] || 0
    }));

    return {
        mode: apply ? "apply" : "dry-run",
        migrationPerformed: apply,
        productsRetained: retainedAfter,
        productsCreated,
        productsArchived,
        packageCountsPreserved: Object.fromEntries(retainedAfter.map(item => [item.productCode, item.packageCount])),
        historicalCommerceCounts: afterCommerceCounts,
        activeNonCanonicalProductsRemaining: activeNonCanonical.map(item => item.productCode)
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
