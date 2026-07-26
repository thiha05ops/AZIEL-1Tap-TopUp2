const assert = require("assert");

const {
    calculateBasePrice,
    CommerceCalculationError,
    ERROR_CODES,
    WARNING_CODES,
    ENGINE_VERSION,
    SPECIFICATION_VERSION
} = require("../services/commerce/pricingCalculationEngine");

function almostEqual(actual, expected, message, epsilon = 0.000001) {
    assert(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, received ${actual}`);
}

function assertError(fn, code, message) {
    let error = null;
    try {
        fn();
    } catch (err) {
        error = err;
    }
    assert(error instanceof CommerceCalculationError, message);
    assert.strictEqual(error.code, code, message);
}

function baseInput(overrides = {}) {
    return {
        supplierCost: 100,
        supplierCurrency: "MMK",
        targetCurrency: "MMK",
        policy: {
            profitRule: { enabled: true, type: "PERCENT", value: 10 },
            roundingRule: { enabled: false, mode: "NONE" }
        },
        ...overrides
    };
}

function clone(value) {
    return structuredClone(value);
}

function verifyBasicCalculations() {
    almostEqual(calculateBasePrice(baseInput({ policy: { profitRule: { enabled: true, type: "FIXED", value: 0 } } })).regularPrice, 100, "supplier cost only");
    almostEqual(calculateBasePrice(baseInput({ policy: { supplierFee: { enabled: true, type: "FIXED", value: 5 }, profitRule: { enabled: true, type: "FIXED", value: 0 } } })).supplierFeeAmount, 5, "fixed supplier fee");
    almostEqual(calculateBasePrice(baseInput({ policy: { supplierFee: { enabled: true, type: "PERCENT", value: 5 }, profitRule: { enabled: true, type: "FIXED", value: 0 } } })).supplierFeeAmount, 5, "percentage supplier fee");
    almostEqual(calculateBasePrice(baseInput({ policy: { businessCost: { enabled: true, type: "FIXED", value: 10 }, profitRule: { enabled: true, type: "FIXED", value: 0 } } })).businessCostAmount, 10, "fixed business cost");
    almostEqual(calculateBasePrice(baseInput({ policy: { businessCost: { enabled: true, type: "PERCENT", value: 10 }, profitRule: { enabled: true, type: "FIXED", value: 0 } } })).businessCostAmount, 10, "percentage business cost");
    almostEqual(calculateBasePrice(baseInput({ policy: { profitRule: { enabled: true, type: "FIXED", value: 20 } } })).profitAmount, 20, "fixed profit");
    almostEqual(calculateBasePrice(baseInput()).profitAmount, 10, "percentage profit");
}

function verifyExchange() {
    const sameCurrency = calculateBasePrice(baseInput());
    assert.strictEqual(sameCurrency.exchangeRateApplied, null, "same currency must not require exchange.");

    const mmToTh = calculateBasePrice(baseInput({
        supplierCurrency: "MMK",
        targetCurrency: "THB",
        exchangeRate: { rate: 0.0125, sourceCurrency: "MMK", targetCurrency: "THB", source: "test" }
    }));
    almostEqual(mmToTh.postExchangeSubtotal, 1.375, "MMK to THB should use supplied rate.");
    assert.strictEqual(mmToTh.exchangeRateMetadata.source, "test", "exchange metadata must be preserved.");

    const thToMm = calculateBasePrice(baseInput({
        supplierCurrency: "THB",
        targetCurrency: "MMK",
        exchangeRate: { rate: 80, sourceCurrency: "THB", targetCurrency: "MMK" }
    }));
    almostEqual(thToMm.postExchangeSubtotal, 8800, "THB to MMK should use supplied rate.");

    assertError(() => calculateBasePrice(baseInput({ supplierCurrency: "MMK", targetCurrency: "THB" })), ERROR_CODES.INVALID_EXCHANGE_RATE, "missing exchange rate must fail.");
    assertError(() => calculateBasePrice(baseInput({ supplierCurrency: "MMK", targetCurrency: "THB", exchangeRate: { rate: 0, sourceCurrency: "MMK", targetCurrency: "THB" } })), ERROR_CODES.INVALID_EXCHANGE_RATE, "invalid exchange rate must fail.");
    assertError(() => calculateBasePrice(baseInput({ supplierCurrency: "MMK", targetCurrency: "THB", exchangeRate: { rate: 1, sourceCurrency: "THB", targetCurrency: "MMK" } })), ERROR_CODES.EXCHANGE_PAIR_MISMATCH, "mismatched exchange pair must fail.");
}

function verifyFeesTaxAndCompounding() {
    const result = calculateBasePrice(baseInput({
        policy: {
            profitRule: { enabled: true, type: "FIXED", value: 0 },
            gatewayFee: { enabled: true, type: "PERCENT", value: 10 },
            platformCost: { enabled: true, type: "FIXED", value: 5 },
            tax: { enabled: true, type: "PERCENT", value: 5 }
        }
    }));
    almostEqual(result.gatewayFeeAmount, 10, "percentage gateway fee should compound on running subtotal.");
    almostEqual(result.platformFeeAmount, 5, "fixed platform fee should apply.");
    almostEqual(result.taxAmount, 5.75, "percentage tax should compound after gateway and platform.");
    almostEqual(result.regularPrice, 120.75, "fees and tax should produce expected total.");

    const fixedTax = calculateBasePrice(baseInput({
        policy: {
            profitRule: { enabled: true, type: "FIXED", value: 0 },
            gatewayFee: { enabled: true, type: "FIXED", value: 3 },
            platformCost: { enabled: true, type: "PERCENT", value: 10 },
            tax: { enabled: true, type: "FIXED", value: 7 }
        }
    }));
    almostEqual(fixedTax.regularPrice, 120.3, "fixed and percentage fees should compound deterministically.");
}

function verifyRounding() {
    const withRounding = rule => calculateBasePrice(baseInput({
        supplierCost: 1153.39,
        policy: { profitRule: { enabled: true, type: "FIXED", value: 0 }, roundingRule: rule }
    }));

    almostEqual(withRounding({ enabled: false, mode: "NONE" }).regularPrice, 1153.39, "NONE rounding should preserve amount.");
    almostEqual(withRounding({ enabled: true, mode: "NEAREST", increment: 10 }).regularPrice, 1150, "NEAREST rounding.");
    almostEqual(withRounding({ enabled: true, mode: "UP", increment: 10 }).regularPrice, 1160, "UP rounding.");
    almostEqual(withRounding({ enabled: true, mode: "DOWN", increment: 10 }).regularPrice, 1150, "DOWN rounding.");
    almostEqual(withRounding({ enabled: true, mode: "PSYCHOLOGICAL", psychologicalEnding: 9 }).regularPrice, 1159, "PSYCHOLOGICAL rounding.");
    almostEqual(withRounding({ enabled: true, mode: "NEAREST", increment: 0.05 }).regularPrice, 1153.4, "fractional NEAREST rounding.");
    almostEqual(withRounding({ enabled: true, mode: "UP", increment: 0.01 }).regularPrice, 1153.39, "fractional UP rounding.");
    assertError(() => withRounding({ enabled: true, mode: "UP", increment: 0 }), ERROR_CODES.INVALID_ROUNDING_RULE, "invalid increment must fail.");

    const input = baseInput({ policy: { profitRule: { enabled: true, type: "FIXED", value: 0 }, roundingRule: { enabled: true, mode: "UP", increment: 10 } } });
    const original = clone(input);
    calculateBasePrice(input);
    assert.deepStrictEqual(input, original, "rounding must not mutate input.");
}

function verifyPricingRules() {
    const result = calculateBasePrice(baseInput({
        context: { region: "TH", gameId: "mlbb", packageId: "MLBB_100" },
        appliedPricingRules: [
            { code: "GLOBAL-MARKUP", ruleType: "MARKUP_FIXED", value: 1, priority: 1, scopeType: "GLOBAL" },
            { code: "PACKAGE-MARKUP", ruleType: "MARKUP_FIXED", value: 5, priority: 1, scopeType: "PACKAGE", scopeReference: "MLBB_100", stopFurtherProcessing: true },
            { code: "GAME-MARKUP", ruleType: "MARKUP_FIXED", value: 3, priority: 10, scopeType: "GAME", scopeReference: "mlbb" },
            { code: "REGION-FEE", ruleType: "FEE_FIXED", value: 2, priority: 1, scopeType: "REGION", scopeReference: "TH" }
        ]
    }));
    assert.deepStrictEqual(result.appliedRules.map(rule => rule.code), ["PACKAGE-MARKUP", "REGION-FEE"], "rule precedence and stopFurtherProcessing must be deterministic.");
    almostEqual(result.profitAmount, 15, "markup rule should add to profit stage.");
    almostEqual(result.pricingRuleFeeAmount, 2, "fee rule should add after platform fee stage.");

    const override = calculateBasePrice(baseInput({
        context: { packageId: "PKG1" },
        appliedPricingRules: [
            { code: "GLOBAL-OVERRIDE", ruleType: "PRICE_OVERRIDE", value: 90, priority: 1, scopeType: "GLOBAL" },
            { code: "PACKAGE-OVERRIDE", ruleType: "PRICE_OVERRIDE", value: 120, priority: 1, scopeType: "PACKAGE", scopeReference: "PKG1" }
        ]
    }));
    almostEqual(override.regularPrice, 120, "package override should win.");
    assert(override.warnings.some(warning => warning.code === WARNING_CODES.PRICE_OVERRIDE_APPLIED), "override warning must be emitted.");

    assertError(() => calculateBasePrice(baseInput({
        appliedPricingRules: [
            { code: "A", ruleType: "PRICE_OVERRIDE", value: 90, priority: 1, scopeType: "GLOBAL" },
            { code: "B", ruleType: "PRICE_OVERRIDE", value: 95, priority: 1, scopeType: "GLOBAL" }
        ]
    })), ERROR_CODES.CONFLICTING_PRICE_OVERRIDES, "equal-precedence overrides must fail.");

    const tieBreak = calculateBasePrice(baseInput({
        appliedPricingRules: [
            { code: "B-RULE", ruleType: "FEE_FIXED", value: 2, priority: 5, scopeType: "GLOBAL" },
            { code: "A-RULE", ruleType: "FEE_FIXED", value: 1, priority: 5, scopeType: "GLOBAL" }
        ]
    }));
    assert.deepStrictEqual(tieBreak.appliedRules.map(rule => rule.code), ["A-RULE", "B-RULE"], "equal scope/priority tie-break must use stable code ordering.");

    assertError(() => calculateBasePrice(baseInput({
        appliedPricingRules: [
            { code: "DATED", ruleType: "FEE_FIXED", value: 1, priority: 1, scopeType: "GLOBAL", effectiveFrom: "2026-01-01" }
        ]
    })), ERROR_CODES.INVALID_INPUT, "date-windowed rules must require explicit evaluation time.");

    const stale = calculateBasePrice(baseInput({
        context: { evaluationTime: "2026-07-26T00:00:00.000Z" },
        appliedPricingRules: [
            { code: "EXPIRED", ruleType: "FEE_FIXED", value: 1, priority: 1, scopeType: "GLOBAL", effectiveUntil: "2026-01-01T00:00:00.000Z" }
        ]
    }));
    assert(stale.warnings.some(warning => warning.code === WARNING_CODES.UNUSED_PRICING_RULE && warning.details.rule === "EXPIRED"), "expired/stale rule should be reported as unused.");
}

function verifySafetyAndOutput() {
    assertError(() => calculateBasePrice(baseInput({ supplierCost: -1 })), ERROR_CODES.INVALID_SUPPLIER_COST, "negative supplier cost must fail.");
    assertError(() => calculateBasePrice(baseInput({ supplierCost: NaN })), ERROR_CODES.INVALID_SUPPLIER_COST, "NaN supplier cost must fail.");
    assertError(() => calculateBasePrice(baseInput({ supplierCost: Infinity })), ERROR_CODES.INVALID_SUPPLIER_COST, "Infinity supplier cost must fail.");
    assertError(() => calculateBasePrice(baseInput({ targetCurrency: "USD" })), ERROR_CODES.UNSUPPORTED_CURRENCY, "unsupported currency must fail.");

    const zero = calculateBasePrice(baseInput({ supplierCost: 0, policy: { profitRule: { enabled: true, type: "FIXED", value: 0 } } }));
    assert.strictEqual(zero.regularPrice, 0, "zero cost should be supported.");
    assert.strictEqual(zero.calculatedMarginPercent, 0, "zero revenue and zero cost margin should be zero.");
    assert(zero.warnings.some(warning => warning.code === WARNING_CODES.ZERO_MARGIN), "zero margin warning should be emitted.");

    const zeroRevenue = calculateBasePrice(baseInput({
        supplierCost: 100,
        policy: { profitRule: { enabled: true, type: "FIXED", value: 0 } },
        appliedPricingRules: [{ code: "ZERO-PRICE", ruleType: "PRICE_OVERRIDE", value: 0, priority: 1, scopeType: "GLOBAL" }]
    }));
    assert.strictEqual(zeroRevenue.calculatedMarginPercent, -100, "zero revenue with positive cost margin should be -100.");
    assert(zeroRevenue.warnings.some(warning => warning.code === WARNING_CODES.PRICE_BELOW_COST), "override below cost must warn.");

    const input = baseInput({
        policy: {
            supplierFee: { enabled: true, type: "FIXED", value: 0 },
            businessCost: { enabled: true, type: "PERCENT", value: 0 },
            profitRule: { enabled: true, type: "PERCENT", value: 0 }
        }
    });
    const original = clone(input);
    const first = calculateBasePrice(input);
    const second = calculateBasePrice(input);
    assert.deepStrictEqual(input, original, "calculation must not mutate input.");
    assert.deepStrictEqual(first, second, "calculation must be deterministic.");
    assert.strictEqual(first.engineVersion, ENGINE_VERSION, "result must include engineVersion.");
    assert.strictEqual(first.specificationVersion, SPECIFICATION_VERSION, "result must include specificationVersion.");
    [
        "SUPPLIER_COST",
        "SUPPLIER_FEE",
        "BUSINESS_COST",
        "PROFIT",
        "EXCHANGE",
        "GATEWAY_FEE",
        "PLATFORM_FEE",
        "TAX",
        "ROUNDING"
    ].forEach(stage => assert(first.breakdown.some(item => item.stageId === stage), `breakdown must include stable stageId ${stage}.`));
    first.breakdown.forEach(item => {
        assert(item.stageId, "every breakdown entry must include stageId.");
        assert(item.stage, "every breakdown entry keeps debug stage.");
        assert(item.currency, "every breakdown entry must include currency.");
    });
    assert.strictEqual(first.regularPrice, first.originalPrice, "regular and original price should match before promotions.");

    const negativeZero = calculateBasePrice(baseInput({ supplierCost: -0, policy: { profitRule: { enabled: true, type: "FIXED", value: -0 } } }));
    assert(!Object.is(negativeZero.supplierCost, -0), "supplierCost must normalize negative zero.");
    assert(!Object.is(negativeZero.regularPrice, -0), "regularPrice must normalize negative zero.");

    const large = calculateBasePrice(baseInput({ supplierCost: 999_999_999_999, policy: { profitRule: { enabled: true, type: "FIXED", value: 1 } } }));
    assert.strictEqual(large.regularPrice, 1_000_000_000_000, "maximum safe configured range should calculate.");
    assertError(() => calculateBasePrice(baseInput({ supplierCost: 1_000_000_000_001 })), ERROR_CODES.CALCULATION_OVERFLOW, "amount above supported range must fail.");
}

function verifyDeepImmutability() {
    const input = {
        supplierCost: 100,
        supplierCurrency: "MMK",
        targetCurrency: "THB",
        exchangeRate: { rate: 0.0125, sourceCurrency: "MMK", targetCurrency: "THB", asOf: "2026-07-26T00:00:00.000Z", source: "unit-test" },
        policy: {
            supplierFee: { enabled: true, type: "PERCENT", value: 1.25 },
            businessCost: { enabled: true, type: "FIXED", value: 2 },
            profitRule: { enabled: true, type: "PERCENT", value: 10.5 },
            gatewayFee: { enabled: true, type: "PERCENT", value: 2.75 },
            platformCost: { enabled: true, type: "FIXED", value: 1.25 },
            tax: { enabled: true, type: "PERCENT", value: 7 },
            roundingRule: { enabled: true, mode: "UP", increment: 0.05 }
        },
        appliedPricingRules: [
            { code: "B", ruleType: "MARKUP_FIXED", value: 2, priority: 1, scopeType: "GLOBAL", configuration: { display: { label: "b" } } },
            { code: "A", ruleType: "FEE_PERCENT", value: 1, priority: 2, scopeType: "GLOBAL", configuration: { display: { label: "a" } } }
        ],
        context: { region: "TH", evaluationTime: "2026-07-26T00:00:00.000Z" }
    };
    const original = clone(input);
    const result = calculateBasePrice(input);
    assert.deepStrictEqual(input, original, "nested policy/rules/context must remain unchanged.");
    assert.deepStrictEqual(input.appliedPricingRules.map(rule => rule.code), ["B", "A"], "caller rule array order must be unchanged.");
    assert(Object.isFrozen(result.breakdown), "breakdown array must be frozen.");
    assert(Object.isFrozen(result.breakdown[0]), "breakdown entries must be frozen.");
    assert(Object.isFrozen(result.appliedRules), "appliedRules array must be frozen.");
    assert(Object.isFrozen(result.warnings), "warnings array must be frozen.");
    assert(Object.isFrozen(result.exchangeRateMetadata), "exchange metadata must be frozen.");
}

function verifyWorkedExamples() {
    const mmk = calculateBasePrice({
        supplierCost: 8000,
        supplierCurrency: "MMK",
        targetCurrency: "MMK",
        policy: {
            businessCost: { enabled: true, type: "FIXED", value: 500 },
            profitRule: { enabled: true, type: "PERCENT", value: 20 },
            gatewayFee: { enabled: true, type: "PERCENT", value: 2 },
            platformCost: { enabled: true, type: "FIXED", value: 300 },
            tax: { enabled: true, type: "PERCENT", value: 0 },
            roundingRule: { enabled: true, mode: "NEAREST", increment: 100 }
        }
    });
    almostEqual(mmk.regularPrice, 10700, "documented MMK original price example.");

    const thb = calculateBasePrice({
        supplierCost: 950,
        supplierCurrency: "THB",
        targetCurrency: "THB",
        policy: {
            businessCost: { enabled: true, type: "FIXED", value: 20 },
            profitRule: { enabled: true, type: "PERCENT", value: 15 },
            gatewayFee: { enabled: true, type: "PERCENT", value: 2.5 },
            platformCost: { enabled: true, type: "FIXED", value: 10 },
            tax: { enabled: true, type: "PERCENT", value: 0 },
            roundingRule: { enabled: true, mode: "PSYCHOLOGICAL", psychologicalEnding: 9 }
        }
    });
    almostEqual(thb.regularPrice, 1159, "documented THB original price example.");
}

function main() {
    verifyBasicCalculations();
    verifyExchange();
    verifyFeesTaxAndCompounding();
    verifyRounding();
    verifyPricingRules();
    verifySafetyAndOutput();
    verifyDeepImmutability();
    verifyWorkedExamples();
    console.log("Commerce calculation engine verification checks passed.");
}

main();
