"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { calculateBasePrice, WARNING_CODES } = require("../services/commerce/pricingCalculationEngine");
const { buildProductionPricingContext } = require("../services/commerce/productionPricingContextService");
const { CatalogAdminError, updatePackage } = require("../services/catalogAdminService");

const ROOT = path.resolve(__dirname, "../..");

function almostEqual(actual, expected, label, epsilon = 0.000001) {
    assert(Math.abs(Number(actual) - Number(expected)) <= epsilon, `${label}: expected ${expected}, got ${actual}`);
}

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function fakePackage(overrides = {}) {
    return {
        _id: "pkg-runtime-test",
        productCode: "mlbb",
        packageCode: "MLBB_TEST",
        name: "Runtime Test Package",
        updatedAt: "2026-07-29T00:00:00.000Z",
        prices: {},
        metadata: {},
        ...overrides
    };
}

async function verifyRuntimeExamples() {
    const th = calculateBasePrice({
        supplierCost: 40,
        supplierCurrency: "THB",
        targetCurrency: "THB",
        policy: {
            supplierFee: { enabled: false, type: "PERCENT", value: 0 },
            gatewayFee: { enabled: true, type: "PERCENT", value: 2 },
            platformCost: { enabled: true, type: "FIXED", value: 3 },
            profitRule: { enabled: true, type: "PERCENT", value: 20 },
            tax: { enabled: false, type: "PERCENT", value: 0 },
            roundingRule: { enabled: true, mode: "UP", increment: 1 }
        }
    });
    assert.strictEqual(th.exchangeRateApplied, null, "Thailand same-currency pricing must not require exchange.");
    almostEqual(th.postExchangeSubtotal, 40, "Thailand converted supplier cost");
    almostEqual(th.regularPrice, 53, "Thailand recommended price");

    const mm = calculateBasePrice({
        supplierCost: 40,
        supplierCurrency: "THB",
        targetCurrency: "MMK",
        exchangeRate: {
            rate: 120,
            sourceCurrency: "THB",
            targetCurrency: "MMK",
            source: "test"
        },
        policy: {
            supplierFee: { enabled: true, type: "PERCENT", value: 1 },
            gatewayFee: { enabled: true, type: "PERCENT", value: 2 },
            platformCost: { enabled: true, type: "FIXED", value: 300 },
            profitRule: { enabled: true, type: "PERCENT", value: 20 },
            tax: { enabled: false, type: "PERCENT", value: 0 },
            roundingRule: { enabled: true, mode: "UP", increment: 100 }
        }
    });
    almostEqual(mm.postExchangeSubtotal, 4800, "Myanmar THB to MMK conversion direction");
    almostEqual(mm.regularPrice, 6300, "Myanmar recommended price");
}

async function verifyProductionContextOverrideOwnership() {
    const originalRate = process.env.COMMERCE_EXCHANGE_RATE_THB_MMK;
    const PricingPolicy = require("../models/PricingPolicy");
    const PricingRule = require("../models/PricingRule");
    const PriceVersion = require("../models/PriceVersion");
    const originalPolicyFindOne = PricingPolicy.findOne;
    const originalRuleFind = PricingRule.find;
    const originalVersionFind = PriceVersion.find;
    process.env.COMMERCE_EXCHANGE_RATE_THB_MMK = "120";

    try {
        PricingPolicy.findOne = () => ({ sort: () => ({ lean: () => Promise.resolve(null) }) });
        PricingRule.find = () => ({ sort: () => ({ lean: () => Promise.resolve([]) }) });
        PriceVersion.find = () => ({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }) });

        const legacyPrice = {
            amount: 6500,
            currency: "MMK",
            enabled: true,
            supplierCost: 40,
            supplierCurrency: "THB",
            supplierName: "Thai Supplier",
            supplierVersion: "v1",
            publishedPriceMode: "LEGACY_COMPATIBILITY_PRICE"
        };
        const legacyContext = await buildProductionPricingContext({
            pkg: fakePackage({ prices: { MM: legacyPrice } }),
            price: legacyPrice,
            catalog: { productCode: "mlbb", packageCode: "MLBB_TEST", productName: "Mobile Legends" },
            region: "MM",
            currency: "MMK",
            now: new Date("2026-07-29T00:00:00.000Z")
        });
        const override = legacyContext.pricing.pricingInput.appliedPricingRules.find(rule => rule.ruleType === "PRICE_OVERRIDE");
        assert(!override, "legacy catalog outputs must not override current pricing policy authority.");

        const derivedPrice = {
            ...legacyPrice,
            amount: 6500,
            publishedPriceMode: "POLICY_DERIVED"
        };
        const derivedContext = await buildProductionPricingContext({
            pkg: fakePackage({ prices: { MM: derivedPrice } }),
            price: derivedPrice,
            catalog: { productCode: "mlbb", packageCode: "MLBB_TEST", productName: "Mobile Legends" },
            region: "MM",
            currency: "MMK",
            now: new Date("2026-07-29T00:00:00.000Z")
        });
        assert(!derivedContext.pricing.pricingInput.appliedPricingRules.some(rule => rule.ruleType === "PRICE_OVERRIDE"), "policy-derived pricing must remove catalog price override.");
    } finally {
        PricingPolicy.findOne = originalPolicyFindOne;
        PricingRule.find = originalRuleFind;
        PriceVersion.find = originalVersionFind;
        if (originalRate === undefined) delete process.env.COMMERCE_EXCHANGE_RATE_THB_MMK;
        else process.env.COMMERCE_EXCHANGE_RATE_THB_MMK = originalRate;
    }
}

async function verifyManualOverrideReasonRequired() {
    const fakeDoc = {
        productCode: "mlbb",
        supportedRegions: ["MM"],
        prices: {
            MM: { amount: 6800, currency: "MMK", enabled: true, publishedPriceMode: "LEGACY_COMPATIBILITY_PRICE" }
        },
        updatedAt: new Date("2026-07-29T00:00:00.000Z"),
        set() {},
        toObject() { return this; },
        save: async () => {}
    };
    const CatalogPackage = require("../models/CatalogPackage");
    const CatalogProduct = require("../models/CatalogProduct");
    const originalPackageFindOne = CatalogPackage.findOne;
    const originalProductFindOne = CatalogProduct.findOne;

    CatalogPackage.findOne = () => Promise.resolve(fakeDoc);
    CatalogProduct.findOne = () => ({ lean: () => Promise.resolve({ productCode: "mlbb", supportedRegions: ["MM"] }) });
    try {
        let error = null;
        try {
            await updatePackage({
                productCode: "mlbb",
                packageCode: "MLBB_TEST",
                patch: {
                    expectedUpdatedAt: fakeDoc.updatedAt,
                    prices: {
                        MM: {
                            publishedPriceMode: "MANUAL_OVERRIDE",
                            manualOverrideReason: ""
                        }
                    }
                },
                actor: "verify"
            });
        } catch (err) {
            error = err;
        }
        assert(error instanceof CatalogAdminError, "manual override without reason must fail.");
        assert.strictEqual(error.code, "CATALOG_PATCH_INVALID");
    } finally {
        CatalogPackage.findOne = originalPackageFindOne;
        CatalogProduct.findOne = originalProductFindOne;
    }
}

function verifyPublicRedactionAndUiOwnership() {
    const catalogService = read("backend/services/catalogService.js");
    assert(catalogService.includes("includeAdminPricing"), "supplier/profit fields must use explicit admin projection gate.");
    assert(/if\s*\(\s*includeAdminPricing\s*\)\s*{[\s\S]*supplierCost/.test(catalogService), "supplier cost must stay out of public projection by default.");

    const adminHtml = read("frontend/admin.html");
    assert(adminHtml.includes("pricingSupplierSelect"), "Daily Pricing must expose canonical supplier selection.");
    assert(adminHtml.includes("pricingSettingsForm"), "Business policy ownership must live in Pricing Settings.");
    assert(!adminHtml.includes("pricingScopeSelector"), "Legacy mixed-workspace scope selector must be removed.");

    const adminCatalog = read("frontend/js/admin-catalog.js");
    assert(adminCatalog.includes("Published Price Mode"), "Catalog editor must show published price mode.");
    assert(adminCatalog.includes("Manual override reason is required."), "Catalog editor must require manual override reason.");

    const engine = read("backend/services/commerce/pricingCalculationEngine.js");
    const exchangeIndex = engine.indexOf('stage: "EXCHANGE"');
    const gatewayIndex = engine.indexOf('stage: "GATEWAY_FEE"');
    const profitIndex = engine.indexOf('stage: "PROFIT"');
    assert(exchangeIndex > -1 && gatewayIndex > exchangeIndex && profitIndex > gatewayIndex, "calculation order must be supplier cost -> exchange -> fees -> profit.");
}

async function main() {
    await verifyRuntimeExamples();
    await verifyProductionContextOverrideOwnership();
    await verifyManualOverrideReasonRequired();
    verifyPublicRedactionAndUiOwnership();
    assert(WARNING_CODES.PRICE_OVERRIDE_APPLIED, "manual override warning code remains available.");
    console.log("Pricing ownership runtime verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
