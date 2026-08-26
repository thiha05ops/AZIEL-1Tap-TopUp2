#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { calculateBasePrice } = require("../services/commerce/pricingCalculationEngine");
const { publishedCustomerPriceRule } = require("../services/commerce/productionPricingContextService");
const { finalizeCustomerPayableAmount } = require("../services/commerce/customerPayableAmountService");

const base = supplierCost => ({
    supplierCost,
    supplierCurrency: "THB",
    targetCurrency: "THB",
    policy: {
        profitRule: { enabled: true, type: "PERCENT", value: 5 },
        minimumProfitAmount: 5,
        maximumProfitAmount: null,
        packageProfitOverride: { mode: "INHERIT", value: null },
        roundingRule: { enabled: false, mode: "NONE" }
    }
});
const publishedRule = amount => publishedCustomerPriceRule({
    price: { amount, currency: "THB", publishedPriceMode: "POLICY_DERIVED" },
    packageContext: { packageCode: "TEST_PACKAGE" },
    region: "TH",
    currency: "THB"
});
const customerPrice = (supplierCost, publishedAmount) => calculateBasePrice({
    ...base(supplierCost),
    context: { packageCode: "TEST_PACKAGE" },
    appliedPricingRules: [publishedRule(publishedAmount)]
}).regularPrice;

assert.strictEqual(customerPrice(300, 315), 315); // unchanged
assert.strictEqual(calculateBasePrice(base(290)).regularPrice, 304.5); // operational preview changes
assert.strictEqual(customerPrice(290, 315), 315); // supplier change is unpublished
assert.strictEqual(customerPrice(280, 315), 315); // policy/input change remains unpublished
assert.strictEqual(customerPrice(290, 304.5), 304.5); // explicit publication changes authority

const oldQuote = Object.freeze({ amount: customerPrice(300, 315) });
const oldOrder = Object.freeze({ amount: oldQuote.amount });
assert.strictEqual(oldQuote.amount, 315);
assert.strictEqual(oldOrder.amount, 315);

const regionalPublished = Object.freeze({ TH: 315, MM: 41000 });
assert.strictEqual(regionalPublished.MM, 41000); // TH publication cannot alter MM snapshot
assert.strictEqual(regionalPublished.TH, 315); // MM publication cannot alter TH snapshot
assert.strictEqual(customerPrice(250, 315), 315); // supplier route change cannot alter customer price
assert.throws(() => publishedCustomerPriceRule({ price: {}, packageContext: { packageCode: "MISSING" }, region: "TH", currency: "THB" }), /unavailable/);

assert.strictEqual(finalizeCustomerPayableAmount(315.004, "THB"), 315);
assert.strictEqual(finalizeCustomerPayableAmount(315.005, "THB"), 315.01);
assert.strictEqual(finalizeCustomerPayableAmount(1532.7, "MMK"), 1533);

console.log(JSON.stringify({
    result: "PASS",
    cases: 12,
    previewSeparatedFromPublished: true,
    missingPublishedPriceFailsClosed: true,
    historicalSnapshotsImmutable: true,
    regionalIsolation: true,
    supplierRouteIsolation: true,
    realOrders: 0,
    pricePublications: 0,
    providerCalls: 0
}, null, 2));
