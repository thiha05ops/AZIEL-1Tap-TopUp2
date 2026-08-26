#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { calculateBasePrice } = require("../services/commerce/pricingCalculationEngine");
const {
    PROFITABILITY_STATUS,
    statusFromPricingEvidence,
    rowStatusFromRegional
} = require("../services/commerce/adminPricingControlCenterService");

function calculate(landedCost, { minimum = 5, maximum = null, override = { mode: "INHERIT", value: null } } = {}) {
    return calculateBasePrice({
        supplierCost: landedCost,
        supplierCurrency: "THB",
        targetCurrency: "THB",
        policy: {
            profitRule: { enabled: true, type: "PERCENT", value: 5 },
            minimumProfitAmount: minimum,
            maximumProfitAmount: maximum,
            packageProfitOverride: override,
            roundingRule: { enabled: false, mode: "NONE" }
        }
    });
}

function region(result, extra = {}) {
    const profitabilityStatus = statusFromPricingEvidence({
        supplierConfigured: true,
        netProfit: result.profitAmount,
        minimumProfitAmount: result.minimumProfitAmount
    });
    return { region: "TH", profitabilityStatus, warnings: [], blockingErrors: [], ...extra };
}

const minimumApplied = calculate(50);
assert.strictEqual(minimumApplied.profitAmount, 5);
assert.strictEqual(region(minimumApplied).profitabilityStatus, PROFITABILITY_STATUS.HEALTHY);
assert.strictEqual(rowStatusFromRegional([region(minimumApplied)]), "Ready");

const percentageApplied = calculate(260);
assert.strictEqual(percentageApplied.profitAmount, 13);
assert.strictEqual(rowStatusFromRegional([region(percentageApplied)]), "Ready");

const maximumApplied = calculate(2000, { maximum: 50 });
assert.strictEqual(maximumApplied.profitAmount, 50);
assert.strictEqual(rowStatusFromRegional([region(maximumApplied)]), "Ready");

const fixedOverride = calculate(260, { override: { mode: "FIXED_AMOUNT", value: 20 } });
assert.strictEqual(fixedOverride.profitAmount, 20);
assert.strictEqual(rowStatusFromRegional([region(fixedOverride)]), "Ready");

const percentageOverride = calculate(260, { override: { mode: "PERCENTAGE", value: 3 } });
assert.strictEqual(percentageOverride.profitAmount, 7.8);
assert.strictEqual(rowStatusFromRegional([region(percentageOverride)]), "Ready");

// A single applicable TH result models a TH-only package; absent MM is not a warning.
assert.strictEqual(rowStatusFromRegional([region(minimumApplied)]), "Ready");

const blocked = { region: "TH", profitabilityStatus: PROFITABILITY_STATUS.INVALID_CONFIGURATION, warnings: [], blockingErrors: [{ code: "INVALID_CONFIGURATION", message: "Invalid policy" }] };
assert.strictEqual(rowStatusFromRegional([blocked]), "Blocked");

const advisory = { region: "MM", profitabilityStatus: PROFITABILITY_STATUS.HEALTHY, warnings: [{ code: "COUPON_NOT_APPLIED", message: "Coupon was not eligible" }], blockingErrors: [] };
assert.strictEqual(rowStatusFromRegional([advisory]), "Warning");

assert.strictEqual(statusFromPricingEvidence({ supplierConfigured: true, netProfit: 13, minimumProfitAmount: 5 }), PROFITABILITY_STATUS.HEALTHY);
assert.strictEqual(statusFromPricingEvidence({ supplierConfigured: true, netProfit: 4, minimumProfitAmount: 5 }), PROFITABILITY_STATUS.INVALID_CONFIGURATION);

console.log(JSON.stringify({
    result: "PASS",
    cases: 8,
    minimumGuardrail: "READY",
    defaultPercentage: "READY",
    maximumGuardrail: "READY",
    fixedOverride: "READY",
    percentageOverride: "READY",
    thOnly: "READY",
    blocker: "BLOCKED",
    advisory: "WARNING",
    realOrders: 0,
    realTopups: 0,
    pricePublications: 0
}, null, 2));
