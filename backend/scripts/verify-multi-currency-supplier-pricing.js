#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Supplier = require("../models/Supplier");
const CatalogPackage = require("../models/CatalogPackage");
const { CURRENCY, STOREFRONT_CURRENCY, SUPPLIER_CURRENCY } = require("../constants/commerce");
const { calculateBasePrice, ERROR_CODES } = require("../services/commerce/pricingCalculationEngine");
const { resolveSupplierCostSnapshot } = require("../services/commerce/supplierCostService");
const { resolveProductionExchangeRate } = require("../services/commerce/productionPricingContextService");
const { normalizePrice } = require("../catalog/catalogProjection");

function policy(profit = 3.5) {
    return {
        supplierFee: { enabled: false, type: "FIXED", value: 0 },
        businessCost: { enabled: false, type: "FIXED", value: 0 },
        gatewayFee: { enabled: false, type: "FIXED", value: 0 },
        platformCost: { enabled: false, type: "FIXED", value: 0 },
        tax: { enabled: false, type: "FIXED", value: 0 },
        profitRule: { enabled: true, type: "FIXED", value: profit },
        roundingRule: { enabled: false, mode: "NONE", increment: 0, psychologicalEnding: 0 }
    };
}

function assertCode(fn, code) {
    assert.throws(fn, error => error?.code === code, `Expected ${code}.`);
}

(async () => {
const evaluatedAt = "2026-08-25T00:00:00.000Z";
assert.deepStrictEqual(CURRENCY, ["MMK", "THB"], "Legacy CURRENCY must remain the settlement domain.");
assert.deepStrictEqual(STOREFRONT_CURRENCY, ["MMK", "THB"]);
assert.deepStrictEqual(SUPPLIER_CURRENCY, ["MMK", "THB", "USD"]);

const thb = calculateBasePrice({ supplierCost: 41, supplierCurrency: "THB", targetCurrency: "THB", policy: policy(), context: { evaluationTime: evaluatedAt } });
assert.strictEqual(thb.exchangeRateApplied, null);
assert.strictEqual(thb.landedCost, 41);
assert.strictEqual(thb.landedCurrency, "THB");
assert.strictEqual(thb.regularPrice, 44.5);

const mmk = calculateBasePrice({ supplierCost: 1000, supplierCurrency: "MMK", targetCurrency: "MMK", policy: policy(100), context: { evaluationTime: evaluatedAt } });
assert.strictEqual(mmk.landedCost, 1000);
assert.strictEqual(mmk.regularPrice, 1100);

const fx = { rate: 36.5, sourceCurrency: "USD", targetCurrency: "THB", source: "fixture_manual_acquisition", capturedAt: "2026-08-24T23:00:00.000Z", maxAgeSeconds: 86400, requireFreshness: true };
const usd = calculateBasePrice({ supplierCost: 0.8874, supplierCurrency: "USD", targetCurrency: "THB", exchangeRate: fx, acquisitionCosts: { fundingCost: 0.5, otherAcquisitionCost: 0.1 }, policy: policy(), context: { evaluationTime: evaluatedAt } });
assert.strictEqual(usd.rawSupplierCost, 0.8874);
assert.strictEqual(usd.rawSupplierCurrency, "USD");
assert.strictEqual(usd.fxConvertedCost, 32.3901);
assert.strictEqual(usd.landedCost, 32.9901);
assert.strictEqual(usd.landedCurrency, "THB");
assert.strictEqual(usd.regularPrice, 36.4901);
assert(usd.calculatedProfitAmount > 0);

assertCode(() => calculateBasePrice({ supplierCost: 0.8874, supplierCurrency: "USD", targetCurrency: "THB", policy: policy(), context: { evaluationTime: evaluatedAt } }), ERROR_CODES.INVALID_EXCHANGE_RATE);
assertCode(() => calculateBasePrice({ supplierCost: 0.8874, supplierCurrency: "USD", targetCurrency: "THB", exchangeRate: { ...fx, capturedAt: "2026-08-20T00:00:00.000Z" }, policy: policy(), context: { evaluationTime: evaluatedAt } }), ERROR_CODES.INVALID_EXCHANGE_RATE);
assertCode(() => calculateBasePrice({ supplierCost: 0.8874, supplierCurrency: "USD", targetCurrency: "THB", exchangeRate: { ...fx, rate: -1 }, policy: policy(), context: { evaluationTime: evaluatedAt } }), ERROR_CODES.INVALID_EXCHANGE_RATE);

const supplier = new Supplier({ supplierCode: "FIXTURE_USD", name: "Fixture supplier", mode: "API", supportedRegions: ["TH"], supplierCurrency: "USD", balanceCurrency: "USD" });
await supplier.validate();
const catalogPackage = new CatalogPackage({ productCode: "mlbb", packageCode: "FIXTURE_USD", name: "Fixture", enabled: false, prices: { TH: { amount: 45, currency: "THB", supplierCost: 0.8874, supplierCurrency: "USD", rawSupplierCost: 0.8874, rawSupplierCurrency: "USD", fxRate: 36.5, fxRateSource: "fixture", fxRateCapturedAt: evaluatedAt, fxConvertedCost: 32.3901, fundingCost: 0.5, otherAcquisitionCost: 0.1, landedCost: 32.9901, landedCurrency: "THB" } }, canonicalSupplierCost: { amount: 0.8874, currency: "USD", rawSupplierCost: 0.8874, rawSupplierCurrency: "USD", landedCost: 32.9901, landedCurrency: "THB" } });
await catalogPackage.validate();

const snapshot = resolveSupplierCostSnapshot({ pkg: catalogPackage.toObject(), price: catalogPackage.toObject().prices.TH, region: "TH", currency: "THB", now: new Date(evaluatedAt) });
assert.strictEqual(snapshot.rawSupplierCost, 0.8874);
assert.strictEqual(snapshot.rawSupplierCurrency, "USD");
assert.strictEqual(snapshot.configured, true);

const policyFx = resolveProductionExchangeRate({ policy: { updatedAt: evaluatedAt, metadata: { supplierCurrency: "USD", exchangeRate: 36.5, exchangeRateSource: "fixture_manual_acquisition", exchangeRateCapturedAt: evaluatedAt, exchangeRateMaxAgeSeconds: 86400 } }, supplierCurrency: "USD", targetCurrency: "THB", now: new Date(evaluatedAt) });
assert.strictEqual(policyFx.rate, 36.5);
assert.strictEqual(policyFx.requireFreshness, true);
assert.throws(() => resolveProductionExchangeRate({ policy: { updatedAt: evaluatedAt, metadata: { supplierCurrency: "USD", exchangeRate: 36.5, exchangeRateSource: "fixture", exchangeRateMaxAgeSeconds: 86400 } }, supplierCurrency: "USD", targetCurrency: "THB", now: new Date(evaluatedAt) }), /exchangeRateCapturedAt/);

const publicPrice = normalizePrice("TH", { amount: 45, currency: "THB", enabled: true, rawSupplierCost: 0.8874, rawSupplierCurrency: "USD", fxRate: 36.5, fxConvertedCost: 32.3901, landedCost: 32.9901, landedCurrency: "THB" });
for (const forbidden of ["supplierCost", "rawSupplierCost", "rawSupplierCurrency", "fxRate", "fxConvertedCost", "landedCost", "landedCurrency"]) assert.strictEqual(Object.hasOwn(publicPrice, forbidden), false, `Public price leaked ${forbidden}.`);

const controlSource = require("fs").readFileSync(require("path").resolve(__dirname, "../services/commerce/adminPricingControlCenterService.js"), "utf8");
assert(controlSource.includes("supplierCostEvidence.rawSupplierCost ?? supplierCostEvidence.priceUsd ?? supplierCostEvidence.netDealerPrice"), "Mapping cost must override client cost from server authority.");
assert(!/row\.fxRate|row\.exchangeRate/.test(controlSource), "Daily Pricing must not accept client FX fields.");

console.log(JSON.stringify({ result: "PASS", supplierCurrencies: SUPPLIER_CURRENCY, storefrontCurrencies: STOREFRONT_CURRENCY, rawUsdCost: usd.rawSupplierCost, fxConvertedThb: usd.fxConvertedCost, landedThb: usd.landedCost, sellingPriceThb: usd.regularPrice, profitThb: usd.calculatedProfitAmount, missingFxFailClosed: true, staleFxFailClosed: true, publicLeakage: false, providerCalls: 0, productionMutations: 0 }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
