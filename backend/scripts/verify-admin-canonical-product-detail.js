"use strict";

const assert = require("assert");
const {
    CANONICAL_OPERATIONAL_PRODUCTS
} = require("../catalog/canonicalOperationalCatalog");
const {
    resolveAdminCatalogProduct
} = require("../services/catalogService");

const emptyDependencies = Object.freeze({
    findProduct: async () => null,
    findPackages: async () => [],
    findMappings: async () => [],
    findInventoryStates: async () => [],
    loadMediaMap: async () => new Map()
});

async function run() {
    const matrix = [];
    for (const canonical of CANONICAL_OPERATIONAL_PRODUCTS) {
        const detail = await resolveAdminCatalogProduct(canonical.productCode, emptyDependencies);
        assert(detail, `${canonical.productCode} must resolve without CatalogProduct metadata.`);
        assert.strictEqual(detail.productCode, canonical.productCode, `${canonical.productCode} identity changed.`);
        assert.strictEqual(detail.packageCount, 0, `${canonical.productCode} fallback package count must be zero.`);
        assert.deepStrictEqual(detail.packages, [], `${canonical.productCode} fallback packages must be empty.`);
        assert.strictEqual(detail.metadataRecordMissing, true, `${canonical.productCode} must expose missing optional metadata.`);
        matrix.push({
            productCode: canonical.productCode,
            canonical: true,
            databaseMetadata: false,
            packages: 0,
            adminDetail: 200
        });
    }

    const packageBackedFallback = await resolveAdminCatalogProduct("marvel-rivals", {
        ...emptyDependencies,
        findPackages: async () => [{
            _id: "package-1",
            productCode: "marvel-rivals",
            packageCode: "MR-100",
            name: "100 Lattice",
            enabled: true,
            prices: {}
        }]
    });
    assert.strictEqual(packageBackedFallback.packageCount, 1, "Canonical fallback must resolve packages independently.");

    const fake = await resolveAdminCatalogProduct("__aziel_nonexistent_product__", emptyDependencies);
    assert.strictEqual(fake, null, "Unknown noncanonical code must remain not found.");

    console.log(JSON.stringify({
        matrix,
        packageBackedFallback: { productCode: packageBackedFallback.productCode, packages: packageBackedFallback.packageCount, adminDetail: 200 },
        fake: { productCode: "__aziel_nonexistent_product__", adminDetail: 404 }
    }, null, 2));
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
