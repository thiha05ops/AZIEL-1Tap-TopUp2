const { STOREFRONT_CURRENCY, SUPPLIER_CURRENCY, PRICING_RULE_SCOPE, PRICING_RULE_TYPE, ROUNDING_MODE } = require("../../constants/commerce");

const ERROR_CODES = Object.freeze({
    INVALID_INPUT: "INVALID_INPUT",
    INVALID_SUPPLIER_COST: "INVALID_SUPPLIER_COST",
    INVALID_MONETARY_RULE: "INVALID_MONETARY_RULE",
    INVALID_RULE_VALUE: "INVALID_RULE_VALUE",
    INVALID_EXCHANGE_RATE: "INVALID_EXCHANGE_RATE",
    EXCHANGE_PAIR_MISMATCH: "EXCHANGE_PAIR_MISMATCH",
    UNSUPPORTED_CURRENCY: "UNSUPPORTED_CURRENCY",
    INVALID_ROUNDING_RULE: "INVALID_ROUNDING_RULE",
    CONFLICTING_PRICE_OVERRIDES: "CONFLICTING_PRICE_OVERRIDES",
    CALCULATION_OVERFLOW: "CALCULATION_OVERFLOW"
});

const WARNING_CODES = Object.freeze({
    NEGATIVE_EFFECTIVE_PROFIT: "NEGATIVE_EFFECTIVE_PROFIT",
    ZERO_MARGIN: "ZERO_MARGIN",
    PRICE_BELOW_COST: "PRICE_BELOW_COST",
    STALE_EXCHANGE_RATE_METADATA: "STALE_EXCHANGE_RATE_METADATA",
    PRICE_OVERRIDE_APPLIED: "PRICE_OVERRIDE_APPLIED",
    ROUNDING_REDUCED_MARGIN: "ROUNDING_REDUCED_MARGIN",
    UNUSED_PRICING_RULE: "UNUSED_PRICING_RULE"
});

const SCOPE_RANK = Object.freeze({
    PACKAGE: 60,
    TIER: 50,
    CATEGORY: 40,
    GAME: 30,
    REGION: 20,
    GLOBAL: 10
});

const INTERNAL_PRECISION = 6;
const MAX_SAFE_AMOUNT = 1_000_000_000_000;
const ENGINE_VERSION = "2.2.1";
const SPECIFICATION_VERSION = "2.1.2";

class CommerceCalculationError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "CommerceCalculationError";
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

function assertPlainInput(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_INPUT, "Calculation input must be an object.", { field: "input" });
    }
}

function assertCurrency(currency, field, domain) {
    if (!domain.includes(currency)) {
        throw new CommerceCalculationError(ERROR_CODES.UNSUPPORTED_CURRENCY, "Unsupported currency.", { field, currency });
    }
}

function assertFiniteNumber(value, code, field, { min = 0 } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < min) {
        throw new CommerceCalculationError(code, "Invalid numeric value.", { field });
    }
    if (Math.abs(numeric) > MAX_SAFE_AMOUNT) {
        throw new CommerceCalculationError(ERROR_CODES.CALCULATION_OVERFLOW, "Calculation amount exceeds supported range.", { field });
    }
    return numeric;
}

function normalizeAmount(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Math.abs(numeric) > MAX_SAFE_AMOUNT) {
        throw new CommerceCalculationError(ERROR_CODES.CALCULATION_OVERFLOW, "Calculation amount exceeds supported range.");
    }
    const normalized = Number(numeric.toFixed(INTERNAL_PRECISION));
    return Object.is(normalized, -0) ? 0 : normalized;
}

function normalizeRule(rule, field) {
    if (!rule || rule.enabled === false) {
        return { enabled: false, type: "FIXED", value: 0 };
    }

    const type = String(rule.type || "").toUpperCase();
    if (!["FIXED", "PERCENT"].includes(type)) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_MONETARY_RULE, "Unsupported monetary rule type.", { field });
    }

    const value = assertFiniteNumber(rule.value ?? 0, ERROR_CODES.INVALID_MONETARY_RULE, `${field}.value`);
    if (type === "PERCENT" && value > 100) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_MONETARY_RULE, "Percentage monetary rule must be between 0 and 100.", { field });
    }

    return { enabled: rule.enabled !== false, type, value };
}

function applyMonetaryRule(baseAmount, rule, field) {
    const normalizedRule = normalizeRule(rule, field);
    if (!normalizedRule.enabled) {
        return { amount: 0, rule: normalizedRule };
    }

    const amount = normalizedRule.type === "PERCENT"
        ? normalizeAmount(baseAmount * (normalizedRule.value / 100))
        : normalizeAmount(normalizedRule.value);
    return { amount, rule: normalizedRule };
}

function breakdownStage(breakdown, stage) {
    breakdown.push(Object.freeze({
        ...stage,
        stageId: stage.stageId || stage.stage
    }));
}

function normalizePricingRule(rule, index) {
    const ruleType = String(rule?.ruleType || "").toUpperCase();
    if (!PRICING_RULE_TYPE.includes(ruleType)) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_RULE_VALUE, "Unsupported pricing rule type.", { field: `appliedPricingRules.${index}.ruleType` });
    }

    const value = assertFiniteNumber(rule.value ?? 0, ERROR_CODES.INVALID_RULE_VALUE, `appliedPricingRules.${index}.value`);
    if (ruleType.endsWith("_PERCENT") && value > 100) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_RULE_VALUE, "Percentage pricing rule must be between 0 and 100.", { field: `appliedPricingRules.${index}.value` });
    }

    const scopeType = String(rule.scopeType || "GLOBAL").toUpperCase();
    if (!PRICING_RULE_SCOPE.includes(scopeType)) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_RULE_VALUE, "Unsupported pricing rule scope.", { field: `appliedPricingRules.${index}.scopeType` });
    }

    return {
        id: rule.id || rule.code || rule.name || `rule-${index}`,
        code: rule.code || "",
        ruleType,
        value,
        priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0,
        scopeType,
        scopeReference: String(rule.scopeReference || "").trim(),
        stopFurtherProcessing: rule.stopFurtherProcessing === true,
        effectiveFrom: rule.effectiveFrom || null,
        effectiveUntil: rule.effectiveUntil || null,
        configuration: rule.configuration && typeof rule.configuration === "object" ? { ...rule.configuration } : {},
        originalIndex: index
    };
}

function hasDateWindow(rule) {
    return Boolean(rule.effectiveFrom || rule.effectiveUntil);
}

function ruleDateApplies(rule, evaluationTime) {
    if (!hasDateWindow(rule)) {
        return true;
    }

    if (!evaluationTime) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_INPUT, "context.evaluationTime is required when pricing rules have effective dates.", {
            field: "context.evaluationTime",
            rule: rule.code || rule.id
        });
    }

    const timestamp = evaluationTime.getTime();
    const from = rule.effectiveFrom ? new Date(rule.effectiveFrom).getTime() : null;
    const until = rule.effectiveUntil ? new Date(rule.effectiveUntil).getTime() : null;
    if ((from !== null && !Number.isFinite(from)) || (until !== null && !Number.isFinite(until)) || !Number.isFinite(timestamp)) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_RULE_VALUE, "Invalid pricing rule date.", { rule: rule.code || rule.id });
    }
    if (from !== null && timestamp < from) return false;
    if (until !== null && timestamp > until) return false;
    return true;
}

function matchesReference(actual, expected) {
    if (!expected) return true;
    return String(actual || "").trim().toUpperCase() === String(expected).trim().toUpperCase();
}

function ruleScopeApplies(rule, context = {}) {
    switch (rule.scopeType) {
        case "GLOBAL":
            return true;
        case "REGION":
            return matchesReference(context.region, rule.scopeReference);
        case "GAME":
            return matchesReference(context.gameId, rule.scopeReference);
        case "CATEGORY":
            return matchesReference(context.categoryId, rule.scopeReference);
        case "TIER":
            return matchesReference(context.tier, rule.scopeReference);
        case "PACKAGE":
            return matchesReference(context.packageId, rule.scopeReference) || matchesReference(context.packageCode, rule.scopeReference);
        default:
            return false;
    }
}

function sortPricingRules(rules) {
    return [...rules].sort((a, b) => {
        const scopeDiff = (SCOPE_RANK[b.scopeType] || 0) - (SCOPE_RANK[a.scopeType] || 0);
        if (scopeDiff) return scopeDiff;
        const priorityDiff = b.priority - a.priority;
        if (priorityDiff) return priorityDiff;
        return String(a.code || a.id).localeCompare(String(b.code || b.id)) || a.originalIndex - b.originalIndex;
    });
}

function selectApplicableRules(rules = [], context = {}) {
    const evaluationTimeValue = context.evaluationTime || context.now || null;
    const evaluationTime = evaluationTimeValue ? new Date(evaluationTimeValue) : null;
    const normalized = rules.map(normalizePricingRule);
    const applicable = sortPricingRules(normalized).filter(rule => ruleDateApplies(rule, evaluationTime) && ruleScopeApplies(rule, context));
    const applicableSet = new Set(applicable.map(rule => rule.originalIndex));
    const unused = normalized.filter(rule => !applicableSet.has(rule.originalIndex));
    return { applicable, unused };
}

function applyStopFurtherProcessing(rules) {
    const applied = [];
    const stoppedTypes = new Set();

    rules.forEach(rule => {
        if (stoppedTypes.has(rule.ruleType)) {
            return;
        }
        applied.push(rule);
        if (rule.stopFurtherProcessing) {
            stoppedTypes.add(rule.ruleType);
        }
    });

    return applied;
}

function validateExchange(input) {
    if (input.supplierCurrency === input.targetCurrency) {
        return { rate: null, metadata: null };
    }

    const rateData = input.exchangeRate;
    if (!rateData || typeof rateData !== "object") {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_EXCHANGE_RATE, "Exchange rate is required for cross-currency calculation.", { field: "exchangeRate" });
    }

    const rate = assertFiniteNumber(rateData.rate, ERROR_CODES.INVALID_EXCHANGE_RATE, "exchangeRate.rate", { min: Number.MIN_VALUE });
    if (rate <= 0) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_EXCHANGE_RATE, "Exchange rate must be positive.", { field: "exchangeRate.rate" });
    }

    if (rateData.sourceCurrency !== input.supplierCurrency || rateData.targetCurrency !== input.targetCurrency) {
        throw new CommerceCalculationError(ERROR_CODES.EXCHANGE_PAIR_MISMATCH, "Exchange pair does not match requested conversion.", {
            sourceCurrency: rateData.sourceCurrency,
            targetCurrency: rateData.targetCurrency
        });
    }

    const capturedAtValue = rateData.capturedAt || rateData.asOf || null;
    const capturedAt = capturedAtValue ? new Date(capturedAtValue) : null;
    const maxAgeSeconds = Number(rateData.maxAgeSeconds);
    const expiresAt = rateData.expiresAt ? new Date(rateData.expiresAt) : null;
    const evaluatedAt = new Date(input.context?.evaluationTime || Date.now());
    if (!Number.isFinite(evaluatedAt.getTime())) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_EXCHANGE_RATE, "Pricing evaluation time is invalid.", { field: "context.evaluationTime" });
    }
    if (rateData.requireFreshness === true && (!capturedAt || !Number.isFinite(capturedAt.getTime()) || !Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0)) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_EXCHANGE_RATE, "Bounded FX freshness evidence is required.", { field: "exchangeRate.capturedAt" });
    }
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || evaluatedAt > expiresAt)) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_EXCHANGE_RATE, "Exchange rate is stale.", { field: "exchangeRate.expiresAt" });
    }
    if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
        if (!capturedAt || !Number.isFinite(capturedAt.getTime()) || evaluatedAt.getTime() - capturedAt.getTime() > maxAgeSeconds * 1000) {
            throw new CommerceCalculationError(ERROR_CODES.INVALID_EXCHANGE_RATE, "Exchange rate is stale.", { field: "exchangeRate.capturedAt" });
        }
    }

    return {
        rate,
        metadata: Object.freeze({
            sourceCurrency: rateData.sourceCurrency,
            targetCurrency: rateData.targetCurrency,
            asOf: capturedAtValue,
            capturedAt: capturedAtValue,
            effectiveAt: rateData.effectiveAt || null,
            expiresAt: rateData.expiresAt || null,
            maxAgeSeconds: Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0 ? maxAgeSeconds : null,
            source: rateData.source || ""
        })
    };
}

function normalizeAcquisitionCosts(input = {}) {
    const raw = input.acquisitionCosts && typeof input.acquisitionCosts === "object" ? input.acquisitionCosts : {};
    return {
        fundingCost: normalizeAmount(assertFiniteNumber(raw.fundingCost ?? 0, ERROR_CODES.INVALID_SUPPLIER_COST, "acquisitionCosts.fundingCost")),
        otherAcquisitionCost: normalizeAmount(assertFiniteNumber(raw.otherAcquisitionCost ?? 0, ERROR_CODES.INVALID_SUPPLIER_COST, "acquisitionCosts.otherAcquisitionCost"))
    };
}

function validateRoundingRule(rule) {
    if (!rule || rule.enabled === false) {
        return { enabled: false, mode: "NONE", increment: 0, psychologicalEnding: 0 };
    }

    const mode = String(rule.mode || "NONE").toUpperCase();
    if (!ROUNDING_MODE.includes(mode)) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_ROUNDING_RULE, "Unsupported rounding mode.", { field: "policy.roundingRule.mode" });
    }

    const increment = Number(rule.increment ?? 0);
    const psychologicalEnding = Number(rule.psychologicalEnding ?? 0);
    if (!Number.isFinite(increment) || increment < 0 || !Number.isFinite(psychologicalEnding) || psychologicalEnding < 0) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_ROUNDING_RULE, "Invalid rounding rule value.", { field: "policy.roundingRule" });
    }

    if (["NEAREST", "UP", "DOWN"].includes(mode) && increment <= 0) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_ROUNDING_RULE, "Rounding increment must be positive.", { field: "policy.roundingRule.increment" });
    }

    return { enabled: rule.enabled !== false, mode, increment, psychologicalEnding };
}

function psychologicalBase(ending, increment) {
    if (increment > 0) return increment;
    const digits = String(Math.trunc(ending)).length;
    return 10 ** Math.max(1, digits);
}

function applyRounding(amount, rule) {
    const roundingRule = validateRoundingRule(rule);
    if (!roundingRule.enabled || roundingRule.mode === "NONE") {
        return { amount: normalizeAmount(amount), rule: roundingRule };
    }

    const { mode, increment, psychologicalEnding } = roundingRule;
    let rounded;
    const quotient = increment > 0 ? normalizeAmount(amount / increment) : 0;
    const epsilon = 1e-9;

    if (mode === "NEAREST") {
        rounded = Math.round(quotient) * increment;
    } else if (mode === "UP") {
        rounded = Math.ceil(quotient - epsilon) * increment;
    } else if (mode === "DOWN") {
        rounded = Math.floor(quotient + epsilon) * increment;
    } else {
        const ending = Math.trunc(psychologicalEnding);
        const base = psychologicalBase(ending, increment);
        rounded = Math.floor(amount / base) * base + ending;
        if (rounded < amount) {
            rounded += base;
        }
    }

    return { amount: Math.max(0, normalizeAmount(rounded)), rule: roundingRule };
}

function ruleAmount(baseAmount, rule) {
    if (rule.ruleType.endsWith("_PERCENT")) {
        return normalizeAmount(baseAmount * (rule.value / 100));
    }
    return normalizeAmount(rule.value);
}

function ruleTrace(rule) {
    return Object.freeze({
        id: rule.id,
        code: rule.code,
        ruleType: rule.ruleType,
        value: rule.value,
        priority: rule.priority,
        scopeType: rule.scopeType,
        scopeReference: rule.scopeReference,
        stopFurtherProcessing: rule.stopFurtherProcessing
    });
}

function resolvePriceOverride(rules) {
    const overrides = rules.filter(rule => rule.ruleType === "PRICE_OVERRIDE");
    if (overrides.length < 2) {
        return overrides[0] || null;
    }

    const [winner, second] = overrides;
    const winnerRank = SCOPE_RANK[winner.scopeType] || 0;
    const secondRank = SCOPE_RANK[second.scopeType] || 0;
    if (winnerRank === secondRank && winner.priority === second.priority) {
        throw new CommerceCalculationError(ERROR_CODES.CONFLICTING_PRICE_OVERRIDES, "Conflicting price override rules have equal precedence.", {
            firstRule: winner.code || winner.id,
            secondRule: second.code || second.id
        });
    }

    return winner;
}

function buildWarning(code, message, details = {}) {
    return Object.freeze({ code, message, details: Object.freeze({ ...details }) });
}

function calculateMargin(price, totalCost) {
    if (price === 0) {
        return totalCost === 0 ? 0 : -100;
    }
    return normalizeAmount(((price - totalCost) / price) * 100);
}

function calculateBasePrice(input) {
    assertPlainInput(input);
    const supplierCurrency = String(input.supplierCurrency || "").toUpperCase();
    const targetCurrency = String(input.targetCurrency || "").toUpperCase();
    assertCurrency(supplierCurrency, "supplierCurrency", SUPPLIER_CURRENCY);
    assertCurrency(targetCurrency, "targetCurrency", STOREFRONT_CURRENCY);

    const supplierCost = normalizeAmount(assertFiniteNumber(input.supplierCost, ERROR_CODES.INVALID_SUPPLIER_COST, "supplierCost"));
    const policy = input.policy && typeof input.policy === "object" ? input.policy : {};
    if (!policy.profitRule) {
        throw new CommerceCalculationError(ERROR_CODES.INVALID_INPUT, "policy.profitRule is required.", { field: "policy.profitRule" });
    }

    const context = input.context && typeof input.context === "object" ? { ...input.context } : {};
    const { applicable, unused } = selectApplicableRules(input.appliedPricingRules || [], context);
    const rules = applyStopFurtherProcessing(applicable);
    const priceOverride = resolvePriceOverride(rules);
    const appliedRules = rules.map(ruleTrace);
    const warnings = unused.map(rule => buildWarning(WARNING_CODES.UNUSED_PRICING_RULE, "Pricing rule did not apply to this context.", { rule: rule.code || rule.id }));
    const breakdown = [];

    let subtotal = supplierCost;
    breakdownStage(breakdown, {
        stage: "SUPPLIER_COST",
        label: "Supplier cost",
        inputAmount: 0,
        amountAdded: supplierCost,
        outputAmount: subtotal,
        currency: supplierCurrency
    });

    const preExchangeSubtotal = subtotal;
    const exchange = validateExchange({ ...input, supplierCurrency, targetCurrency });
    subtotal = exchange.rate ? normalizeAmount(subtotal * exchange.rate) : subtotal;
    const postExchangeSubtotal = subtotal;
    breakdownStage(breakdown, {
        stage: "EXCHANGE",
        label: "Currency exchange",
        inputAmount: preExchangeSubtotal,
        ruleType: exchange.rate ? "RATE" : "NONE",
        ruleValue: exchange.rate,
        amountAdded: normalizeAmount(postExchangeSubtotal - preExchangeSubtotal),
        outputAmount: postExchangeSubtotal,
        currency: targetCurrency
    });

    const acquisitionCosts = normalizeAcquisitionCosts(input);
    if (acquisitionCosts.fundingCost) {
        const beforeFunding = subtotal;
        subtotal = normalizeAmount(subtotal + acquisitionCosts.fundingCost);
        breakdownStage(breakdown, { stage: "FUNDING_COST", label: "Funding/acquisition adjustment", inputAmount: beforeFunding, amountAdded: acquisitionCosts.fundingCost, outputAmount: subtotal, currency: targetCurrency });
    }
    if (acquisitionCosts.otherAcquisitionCost) {
        const beforeOtherAcquisition = subtotal;
        subtotal = normalizeAmount(subtotal + acquisitionCosts.otherAcquisitionCost);
        breakdownStage(breakdown, { stage: "OTHER_ACQUISITION_COST", label: "Other supplier acquisition cost", inputAmount: beforeOtherAcquisition, amountAdded: acquisitionCosts.otherAcquisitionCost, outputAmount: subtotal, currency: targetCurrency });
    }
    const landedCost = subtotal;

    const supplierFee = applyMonetaryRule(subtotal, policy.supplierFee, "policy.supplierFee");
    const beforeSupplierFee = subtotal;
    subtotal = normalizeAmount(subtotal + supplierFee.amount);
    breakdownStage(breakdown, {
        stage: "SUPPLIER_FEE",
        label: "Exchange fee",
        inputAmount: beforeSupplierFee,
        ruleType: supplierFee.rule.type,
        ruleValue: supplierFee.rule.value,
        amountAdded: supplierFee.amount,
        outputAmount: subtotal,
        currency: targetCurrency
    });

    const businessCost = applyMonetaryRule(subtotal, policy.businessCost, "policy.businessCost");
    const beforeBusinessCost = subtotal;
    subtotal = normalizeAmount(subtotal + businessCost.amount);
    breakdownStage(breakdown, {
        stage: "BUSINESS_COST",
        label: "Business cost",
        inputAmount: beforeBusinessCost,
        ruleType: businessCost.rule.type,
        ruleValue: businessCost.rule.value,
        amountAdded: businessCost.amount,
        outputAmount: subtotal,
        currency: targetCurrency
    });

    const gatewayFee = applyMonetaryRule(subtotal, policy.gatewayFee, "policy.gatewayFee");
    const beforeGateway = subtotal;
    subtotal = normalizeAmount(subtotal + gatewayFee.amount);
    breakdownStage(breakdown, {
        stage: "GATEWAY_FEE",
        label: "Gateway fee",
        inputAmount: beforeGateway,
        ruleType: gatewayFee.rule.type,
        ruleValue: gatewayFee.rule.value,
        amountAdded: gatewayFee.amount,
        outputAmount: subtotal,
        currency: targetCurrency
    });

    const platformFee = applyMonetaryRule(subtotal, policy.platformCost, "policy.platformCost");
    const beforePlatform = subtotal;
    subtotal = normalizeAmount(subtotal + platformFee.amount);
    breakdownStage(breakdown, {
        stage: "PLATFORM_FEE",
        label: "Platform fee",
        inputAmount: beforePlatform,
        ruleType: platformFee.rule.type,
        ruleValue: platformFee.rule.value,
        amountAdded: platformFee.amount,
        outputAmount: subtotal,
        currency: targetCurrency
    });

    let pricingRuleFeeAmount = 0;
    rules.filter(rule => ["FEE_PERCENT", "FEE_FIXED"].includes(rule.ruleType)).forEach(rule => {
        pricingRuleFeeAmount = normalizeAmount(pricingRuleFeeAmount + ruleAmount(subtotal, rule));
    });
    if (pricingRuleFeeAmount > 0) {
        const beforeRuleFee = subtotal;
        subtotal = normalizeAmount(subtotal + pricingRuleFeeAmount);
        breakdownStage(breakdown, {
            stage: "PRICING_RULE_FEE",
            label: "Pricing rule fee",
            inputAmount: beforeRuleFee,
            amountAdded: pricingRuleFeeAmount,
            outputAmount: subtotal,
            currency: targetCurrency
        });
    }

    const tax = applyMonetaryRule(subtotal, policy.tax, "policy.tax");
    const beforeTax = subtotal;
    subtotal = normalizeAmount(subtotal + tax.amount);
    breakdownStage(breakdown, {
        stage: "TAX",
        label: "Tax",
        inputAmount: beforeTax,
        ruleType: tax.rule.type,
        ruleValue: tax.rule.value,
        amountAdded: tax.amount,
        outputAmount: subtotal,
        currency: targetCurrency
    });

    const costBeforeProfit = subtotal;
    const profitRuleOverride = [...rules].filter(rule => ["PROFIT_MARGIN_PERCENT", "PROFIT_FIXED"].includes(rule.ruleType))[0];
    const profitRule = profitRuleOverride
        ? { enabled: true, type: profitRuleOverride.ruleType.endsWith("_PERCENT") ? "PERCENT" : "FIXED", value: profitRuleOverride.value }
        : policy.profitRule;
    const profit = applyMonetaryRule(subtotal, profitRule, "policy.profitRule");
    let profitAmount = profit.amount;
    rules.filter(rule => ["MARKUP_PERCENT", "MARKUP_FIXED"].includes(rule.ruleType)).forEach(rule => {
        profitAmount = normalizeAmount(profitAmount + ruleAmount(subtotal, rule));
    });
    const beforeProfit = subtotal;
    subtotal = normalizeAmount(subtotal + profitAmount);
    breakdownStage(breakdown, {
        stage: "PROFIT",
        label: "Profit and markup",
        inputAmount: beforeProfit,
        ruleType: profit.rule.type,
        ruleValue: profit.rule.value,
        amountAdded: profitAmount,
        outputAmount: subtotal,
        currency: targetCurrency
    });

    const preRoundingPrice = subtotal;
    const roundingOverride = [...rules].filter(rule => rule.ruleType === "ROUNDING")[0];
    const roundingRule = roundingOverride
        ? {
            enabled: true,
            mode: roundingOverride.configuration.mode || "NEAREST",
            increment: roundingOverride.configuration.increment ?? roundingOverride.value,
            psychologicalEnding: roundingOverride.configuration.psychologicalEnding ?? 0
        }
        : policy.roundingRule;
    let rounded = applyRounding(subtotal, roundingRule);
    breakdownStage(breakdown, {
        stage: "ROUNDING",
        label: "Rounding",
        inputAmount: preRoundingPrice,
        ruleType: rounded.rule.mode,
        ruleValue: rounded.rule.increment || rounded.rule.psychologicalEnding,
        amountAdded: normalizeAmount(rounded.amount - preRoundingPrice),
        outputAmount: rounded.amount,
        currency: targetCurrency
    });

    let regularPrice = rounded.amount;
    const preOverridePrice = regularPrice;
    if (priceOverride) {
        regularPrice = normalizeAmount(priceOverride.value);
        warnings.push(buildWarning(WARNING_CODES.PRICE_OVERRIDE_APPLIED, "Price override was applied.", { rule: priceOverride.code || priceOverride.id, preOverridePrice }));
        breakdownStage(breakdown, {
            stage: "PRICE_OVERRIDE",
            label: "Price override",
            inputAmount: preOverridePrice,
            ruleType: priceOverride.ruleType,
            ruleValue: priceOverride.value,
            amountAdded: normalizeAmount(regularPrice - preOverridePrice),
            outputAmount: regularPrice,
            currency: targetCurrency
        });
    }

    const totalCost = costBeforeProfit;
    const calculatedProfitAmount = normalizeAmount(regularPrice - totalCost);
    const calculatedMarginPercent = calculateMargin(regularPrice, totalCost);
    if (calculatedProfitAmount < 0) {
        warnings.push(buildWarning(WARNING_CODES.NEGATIVE_EFFECTIVE_PROFIT, "Calculated profit is negative."));
        warnings.push(buildWarning(WARNING_CODES.PRICE_BELOW_COST, "Calculated price is below cost."));
    } else if (calculatedProfitAmount === 0) {
        warnings.push(buildWarning(WARNING_CODES.ZERO_MARGIN, "Calculated margin is zero."));
    }
    if (regularPrice < preRoundingPrice) {
        warnings.push(buildWarning(WARNING_CODES.ROUNDING_REDUCED_MARGIN, "Rounding reduced the pre-rounding margin."));
    }

    return Object.freeze({
        success: true,
        engineVersion: ENGINE_VERSION,
        specificationVersion: SPECIFICATION_VERSION,
        currency: targetCurrency,
        supplierCurrency,
        supplierCost,
        rawSupplierCurrency: supplierCurrency,
        rawSupplierCost: supplierCost,
        supplierFeeAmount: supplierFee.amount,
        businessCostAmount: businessCost.amount,
        costBeforeProfit,
        profitAmount,
        preExchangeSubtotal,
        exchangeRateApplied: exchange.rate,
        exchangeRateMetadata: exchange.metadata,
        postExchangeSubtotal,
        fxConvertedCost: postExchangeSubtotal,
        fundingCost: acquisitionCosts.fundingCost,
        otherAcquisitionCost: acquisitionCosts.otherAcquisitionCost,
        landedCost,
        landedCurrency: targetCurrency,
        gatewayFeeAmount: gatewayFee.amount,
        platformFeeAmount: platformFee.amount,
        pricingRuleFeeAmount,
        taxAmount: tax.amount,
        preRoundingPrice,
        regularPrice,
        originalPrice: regularPrice,
        preOverridePrice: priceOverride ? preOverridePrice : null,
        totalCost,
        calculatedProfitAmount,
        calculatedMarginPercent,
        appliedRules: Object.freeze(appliedRules),
        warnings: Object.freeze(warnings),
        breakdown: Object.freeze(breakdown)
    });
}

module.exports = Object.freeze({
    calculateBasePrice,
    CommerceCalculationError,
    ERROR_CODES,
    WARNING_CODES,
    INTERNAL_PRECISION,
    ENGINE_VERSION,
    SPECIFICATION_VERSION
});
