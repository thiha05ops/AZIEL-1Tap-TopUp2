const assert = require("assert");

const {
    CANONICAL_OPERATIONAL_PRODUCTS,
    CANONICAL_PRODUCT_CODES,
    isCanonicalProductCode,
    isSafeStorefrontProductRoute,
    resolveCanonicalProductRoute
} = require("../catalog/canonicalOperationalCatalog");
const {
    CatalogError,
    projectCatalogProduct,
    projectCommerceReadiness,
    applyPublicReadiness,
    resolveDatabasePackagePriceFromRows
} = require("../services/catalogService");

function fixture() {
    const product = {
        ...CANONICAL_OPERATIONAL_PRODUCTS[0],
        enabled: true,
        publicDiscoveryEnabled: true,
        commerceState: "PURCHASABLE",
        homepageEnabled: true,
        fulfillment: { manualAllowedRegions: ["MM", "TH"] }
    };
    const packageRow = {
        productCode: product.productCode,
        packageCode: "VERIFIER_PACKAGE_1",
        name: "Verifier Package",
        enabled: true,
        sortOrder: 1,
        prices: {
            MM: { amount: 6800, currency: "MMK", enabled: true },
            TH: { amount: 55, currency: "THB", enabled: true }
        }
    };
    return { product, packageRow };
}

function expectError(fn, code) {
    assert.throws(fn, error => error instanceof CatalogError && error.code === code);
}

function verifyCanonicalRegistry() {
    assert(CANONICAL_PRODUCT_CODES.length > 0);
    assert.deepStrictEqual(CANONICAL_PRODUCT_CODES, CANONICAL_OPERATIONAL_PRODUCTS.map(item => item.productCode));
    assert.strictEqual(new Set(CANONICAL_PRODUCT_CODES).size, CANONICAL_PRODUCT_CODES.length);
    CANONICAL_OPERATIONAL_PRODUCTS.forEach((product, index) => {
        assert(isCanonicalProductCode(product.productCode));
        if (index > 0) assert(product.sortOrder > CANONICAL_OPERATIONAL_PRODUCTS[index - 1].sortOrder);
        assert(isSafeStorefrontProductRoute(resolveCanonicalProductRoute(product.productCode)));
    });
    assert.strictEqual(isCanonicalProductCode("unsupported-verifier-product"), false);
}

function verifyServerAuthoritativePricing() {
    const { product, packageRow } = fixture();
    const rows = { products: [product], packages: [packageRow] };
    const resolved = resolveDatabasePackagePriceFromRows({
        productCode: product.productCode,
        packageCode: packageRow.packageCode,
        region: "TH",
        clientAmount: 55,
        clientCurrency: "THB"
    }, rows);
    assert.strictEqual(resolved.amount, 55);
    assert.strictEqual(resolved.currency, "THB");
    expectError(() => resolveDatabasePackagePriceFromRows({
        productCode: product.productCode,
        packageCode: packageRow.packageCode,
        region: "TH",
        clientAmount: 1
    }, rows), "PRICE_MISMATCH");
    expectError(() => resolveDatabasePackagePriceFromRows({
        productCode: "unsupported-verifier-product",
        packageCode: packageRow.packageCode,
        region: "TH"
    }, rows), "PRODUCT_NOT_FOUND");
}

function verifyPublicProjection() {
    const { product, packageRow } = fixture();
    const readiness = projectCommerceReadiness(product, [packageRow], [], []);
    const projection = applyPublicReadiness(
        projectCatalogProduct(product, [packageRow], { includeDisabled: false }),
        product,
        [packageRow],
        readiness
    );
    assert.strictEqual(projection.productCode, product.productCode);
    assert.strictEqual(projection.publicCategory, "mobile");
    assert.strictEqual(projection.productRoute, resolveCanonicalProductRoute(product.productCode));
    assert.strictEqual(projection.availabilityCode, "AVAILABLE");
    assert.strictEqual(projection.packages[0].prices.TH.amount, 55);
}

verifyCanonicalRegistry();
verifyServerAuthoritativePricing();
verifyPublicProjection();
console.log("Catalog canonical registry, pricing, and public projection checks passed.");
