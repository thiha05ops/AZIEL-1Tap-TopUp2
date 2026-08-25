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
    CANONICAL_OPERATIONAL_PRODUCTS,
    CANONICAL_PRODUCT_CODES,
    CANONICAL_PRODUCT_CODE_SET
} = require("../catalog/canonicalOperationalCatalog");
const {
    isAdminCanonicalCatalogProduct,
    toPublicCatalog
} = require("../services/catalogService");

const ROOT = path.join(__dirname, "../..");
const EXPECTED_GROUPS = Object.freeze({
    "Mobile Games": {
        "Mobile Legends": ["mlbb", "mlbb-twilight-weekly-pass"],
        "PUBG Mobile": ["pubg", "pubgrp"],
        "Free Fire": ["freefire"],
        "Marvel Rivals": ["marvel-rivals"],
        "Blood Strike": ["blood-strike", "blood-strike-pass"],
        "Age of Empires Mobile": ["age-of-empires-mobile"],
        "Lineage 2M": ["lineage-2m"],
        OverMortal: ["overmortal"],
        "Magic Chess: Go Go": ["magic-chess-go-go"],
        LifeAfter: ["lifeafter"],
        "Honor of Kings": ["hok"]
    },
    "PC Games": {
        Valorant: ["valorant"]
    },
    "Social Top Up": {
        Telegram: ["telegram"],
        CapCut: ["capcut"]
    }
});

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertIncludes(source, needle, message) {
    assert(source.includes(needle), message || `Missing ${needle}`);
}

async function connect() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGO_URI is required for Admin Catalog grouping verification.");
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

function assertCanonicalGroupingSource() {
    const byCode = new Map(CANONICAL_OPERATIONAL_PRODUCTS.map(product => [product.productCode, product]));
    const seen = [];

    Object.entries(EXPECTED_GROUPS).forEach(([category, families]) => {
        Object.entries(families).forEach(([family, productCodes]) => {
            productCodes.forEach(productCode => {
                const product = byCode.get(productCode);
                assert(product, `${productCode} missing from canonical operational catalog.`);
                assert.strictEqual(product.adminCategory, category, `${productCode} category mismatch.`);
                assert.strictEqual(product.family, family, `${productCode} family mismatch.`);
                seen.push(productCode);
            });
        });
    });

    assert.deepStrictEqual([...seen].sort(), [...CANONICAL_PRODUCT_CODES].sort(), "Grouping must cover exactly the 17 canonical products.");
}

function assertAdminUiSource() {
    const adminHtml = read("frontend/admin.html");
    const adminCatalog = read("frontend/js/admin-catalog.js");
    const adminCss = read("frontend/css/admin/admin-design-system.css");
    const catalogRoutes = read("backend/routes/catalog.js");

    assertIncludes(adminHtml, "adminCatalogSearch", "Admin Catalog must keep search input.");
    assertIncludes(adminCatalog, "groupCatalogProducts", "Admin Catalog must group products.");
    assertIncludes(adminCatalog, "filterCatalogProducts", "Admin Catalog search filter missing.");
    ["product.name", "product.productCode", "product.family", "product.adminCategory"].forEach(needle => {
        assertIncludes(adminCatalog, needle, `Search must include ${needle}.`);
    });
    ["general", "packages", "presentation", "availability", "seo", "media"].forEach(tab => {
        assertIncludes(adminCatalog, `renderCatalogTabButton("${tab}"`, `Editor tab ${tab} missing.`);
    });
    ["packages", "presentation", "availability", "seo", "media"].forEach(tab => {
        assertIncludes(adminCatalog, `activeCatalogTab === "${tab}"`, `Editor panel ${tab} missing.`);
    });
    assertIncludes(adminCatalog, 'activeCatalogTab = "general"', "General editor panel must be the default section.");
    assertIncludes(adminCatalog, "readonly", "Canonical product code/route should be read-only in editor.");
    assertIncludes(adminCatalog, "renderPackageTable(filterPackages(packages))", "Packages tab must preserve package editing table.");
    assertIncludes(adminCatalog, "bindPackageDrag", "Packages tab must preserve package reorder behavior.");
    assertIncludes(adminCatalog, "renderProductImageControl", "Media tab must preserve product image controls.");
    assertIncludes(adminCatalog, "renderBannerList", "Media tab must preserve banner references.");
    assertIncludes(adminCss, "catalog-category-group", "Grouped category styling missing.");
    assertIncludes(adminCss, "catalog-family-group", "Grouped family styling missing.");
    assertIncludes(catalogRoutes, "projectAdminCatalogMetadata", "Admin API must project canonical grouping metadata.");
    assertIncludes(catalogRoutes, "CANONICAL_OPERATIONAL_PRODUCTS.map", "Admin Catalog list must enumerate canonical identity authority.");
    assertIncludes(catalogRoutes, "resolveAdminCatalogProduct(canonical.productCode", "Admin Catalog list and detail must share the canonical resolver.");
}

async function assertDatabaseState() {
    await connect();
    try {
        const [products, packageCounts, rawProducts] = await Promise.all([
            toPublicCatalog({
                source: "database",
                includeDisabled: true,
                includeAssetProjection: false,
                includeAdminPricing: false
            }),
            packageCountsByProduct(),
            CatalogProduct.find().lean()
        ]);
        const adminVisible = products.filter(isAdminCanonicalCatalogProduct);
        assert.strictEqual(adminVisible.length, 17, "Exactly 17 canonical products must be Admin-visible.");
        assert.deepStrictEqual(
            adminVisible.map(product => product.productCode).sort(),
            [...CANONICAL_PRODUCT_CODES].sort(),
            "Admin-visible products must match canonical codes."
        );
        const activeNonCanonical = rawProducts.filter(product => (
            !CANONICAL_PRODUCT_CODE_SET.has(product.productCode) &&
            product.enabled !== false &&
            !product.deletedAt
        ));
        assert.strictEqual(activeNonCanonical.length, 0, "Archived/non-canonical products must remain hidden.");
        adminVisible.forEach(product => {
            assert.strictEqual(product.packageCount, packageCounts[product.productCode] || 0, `${product.productCode} package count mismatch.`);
        });
        return {
            visibleProductCount: adminVisible.length,
            packageCounts: Object.fromEntries(adminVisible.map(product => [product.productCode, product.packageCount])),
            archivedHidden: true
        };
    } finally {
        await mongoose.disconnect();
    }
}

async function run() {
    assertCanonicalGroupingSource();
    assertAdminUiSource();
    const database = await assertDatabaseState();
    return {
        groupingVerified: EXPECTED_GROUPS,
        editorSections: ["General", "Packages", "Presentation", "Availability", "SEO", "Media"],
        searchFields: ["product display name", "product code", "family", "category"],
        database
    };
}

if (require.main === module) {
    run()
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => {
            console.error(error?.message || error);
            process.exitCode = 1;
        });
}

module.exports = { run };
