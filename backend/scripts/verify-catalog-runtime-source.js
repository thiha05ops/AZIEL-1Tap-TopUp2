const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { CANONICAL_PRODUCT_CODES } = require("../catalog/canonicalOperationalCatalog");
const { CatalogError, getCatalogSource, resolveDatabasePackagePriceFromRows } = require("../services/catalogService");

const ROOT = path.join(__dirname, "../..");

function fixtureRows() {
    return {
        products: [{
            productCode: CANONICAL_PRODUCT_CODES[0], name: "Verifier Product", enabled: true,
            supportedRegions: ["MM", "TH"]
        }],
        packages: [{
            productCode: CANONICAL_PRODUCT_CODES[0], packageCode: "VERIFIER_RUNTIME_1",
            name: "Verifier Runtime Package", enabled: true,
            prices: { MM: { amount: 6800, currency: "MMK", enabled: true }, TH: { amount: 55, currency: "THB", enabled: true } }
        }, { productCode: CANONICAL_PRODUCT_CODES[0], packageCode: "VERIFIER_DISABLED", name: "Disabled", enabled: false,
            prices: { TH: { amount: 1, currency: "THB", enabled: true } } }]
    };
}

function expectError(payload, rows, code) {
    assert.throws(() => resolveDatabasePackagePriceFromRows(payload, rows), error => error instanceof CatalogError && error.code === code);
}

function verifyRuntimeResolution() {
    const rows = fixtureRows();
    const identity = { productCode: CANONICAL_PRODUCT_CODES[0], packageCode: "VERIFIER_RUNTIME_1" };
    const mm = resolveDatabasePackagePriceFromRows({ ...identity, region: "MM" }, rows);
    const th = resolveDatabasePackagePriceFromRows({ ...identity, region: "TH" }, rows);
    assert.deepStrictEqual([mm.currency, th.currency], ["MMK", "THB"]);
    assert.deepStrictEqual([mm.amount, th.amount], [6800, 55]);
    expectError({ ...identity, region: "TH", clientAmount: 1 }, rows, "PRICE_MISMATCH");
    expectError({ ...identity, region: "TH", clientCurrency: "MMK" }, rows, "CURRENCY_MISMATCH");
    expectError({ ...identity, packageCode: "MISSING", region: "TH" }, rows, "PACKAGE_NOT_FOUND");
    expectError({ ...identity, packageCode: "VERIFIER_DISABLED", region: "TH" }, rows, "PACKAGE_DISABLED");
    expectError({ ...identity, region: "US" }, rows, "REGION_NOT_SUPPORTED");
    expectError({ ...identity, productCode: "unsupported-verifier-product", region: "TH" }, rows, "PRODUCT_NOT_FOUND");
}

function verifySourceConfiguration() {
    const original = process.env.CATALOG_SOURCE;
    try {
        process.env.CATALOG_SOURCE = "static";
        assert.strictEqual(getCatalogSource(), "static");
        process.env.CATALOG_SOURCE = "database";
        assert.strictEqual(getCatalogSource(), "database");
        process.env.CATALOG_SOURCE = "browser";
        assert.throws(() => getCatalogSource(), /invalid/);
    } finally {
        if (original === undefined) delete process.env.CATALOG_SOURCE;
        else process.env.CATALOG_SOURCE = original;
    }
}

function verifyRouteOwnership() {
    ["backend/routes/payment.js", "backend/routes/order.js"].forEach(file => {
        const source = fs.readFileSync(path.join(ROOT, file), "utf8");
        assert(source.includes("catalogService"), `${file} must use catalogService`);
        assert(!/catalog\/catalog[\"']/.test(source), `${file} must not own static catalog authority`);
    });
}

verifySourceConfiguration();
verifyRuntimeResolution();
verifyRouteOwnership();
console.log("Catalog runtime source and server-authoritative resolution checks passed.");
