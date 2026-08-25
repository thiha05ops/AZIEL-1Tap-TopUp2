(function (root) {
    const STOREFRONT_CURRENCY = Object.freeze(["MMK", "THB"]);
    const SUPPLIER_CURRENCY = Object.freeze(["MMK", "THB", "USD"]);
    const RULE_SCOPE = Object.freeze(["GLOBAL", "REGION", "GAME", "CATEGORY", "TIER", "PACKAGE"]);
    const RULE_TYPE = Object.freeze(["MARKUP_PERCENT", "MARKUP_FIXED", "PROFIT_MARGIN_PERCENT", "PROFIT_FIXED", "FEE_PERCENT", "FEE_FIXED", "PRICE_OVERRIDE", "ROUNDING"]);
    const ROUNDING_MODE = Object.freeze(["NONE", "NEAREST", "UP", "DOWN", "PSYCHOLOGICAL"]);
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
        PRICE_OVERRIDE_APPLIED: "PRICE_OVERRIDE_APPLIED",
        ROUNDING_REDUCED_MARGIN: "ROUNDING_REDUCED_MARGIN",
        UNUSED_PRICING_RULE: "UNUSED_PRICING_RULE"
    });
    const SCOPE_RANK = Object.freeze({ PACKAGE: 60, TIER: 50, CATEGORY: 40, GAME: 30, REGION: 20, GLOBAL: 10 });
    const INTERNAL_PRECISION = 6;
    const MAX_SAFE_AMOUNT = 1000000000000;
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

    function fail(code, message, details) {
        throw new CommerceCalculationError(code, message, details);
    }

    function finite(value, code, field, min = 0) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < min) fail(code, "Invalid numeric value.", { field });
        if (Math.abs(numeric) > MAX_SAFE_AMOUNT) fail(ERROR_CODES.CALCULATION_OVERFLOW, "Calculation amount exceeds supported range.", { field });
        return numeric;
    }

    function amount(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || Math.abs(numeric) > MAX_SAFE_AMOUNT) fail(ERROR_CODES.CALCULATION_OVERFLOW, "Calculation amount exceeds supported range.");
        const normalized = Number(numeric.toFixed(INTERNAL_PRECISION));
        return Object.is(normalized, -0) ? 0 : normalized;
    }

    function currency(value, field, domain) {
        const normalized = String(value || "").toUpperCase();
        if (!domain.includes(normalized)) fail(ERROR_CODES.UNSUPPORTED_CURRENCY, "Unsupported currency.", { field, currency: normalized });
        return normalized;
    }

    function monetaryRule(rule, field) {
        if (!rule || rule.enabled === false) return { enabled: false, type: "FIXED", value: 0 };
        const type = String(rule.type || "").toUpperCase();
        if (!["FIXED", "PERCENT"].includes(type)) fail(ERROR_CODES.INVALID_MONETARY_RULE, "Unsupported monetary rule type.", { field });
        const value = finite(rule.value ?? 0, ERROR_CODES.INVALID_MONETARY_RULE, `${field}.value`);
        if (type === "PERCENT" && value > 100) fail(ERROR_CODES.INVALID_MONETARY_RULE, "Percentage monetary rule must be between 0 and 100.", { field });
        return { enabled: rule.enabled !== false, type, value };
    }

    function applyMoney(base, rule, field) {
        const normalized = monetaryRule(rule, field);
        if (!normalized.enabled) return { amount: 0, rule: normalized };
        return {
            amount: normalized.type === "PERCENT" ? amount(base * (normalized.value / 100)) : amount(normalized.value),
            rule: normalized
        };
    }

    function trace(breakdown, entry) {
        breakdown.push(Object.freeze({ ...entry, stageId: entry.stageId || entry.stage }));
    }

    function normalizePricingRule(rule, index) {
        const ruleType = String(rule?.ruleType || "").toUpperCase();
        if (!RULE_TYPE.includes(ruleType)) fail(ERROR_CODES.INVALID_RULE_VALUE, "Unsupported pricing rule type.", { field: `appliedPricingRules.${index}.ruleType` });
        const value = finite(rule.value ?? 0, ERROR_CODES.INVALID_RULE_VALUE, `appliedPricingRules.${index}.value`);
        if (ruleType.endsWith("_PERCENT") && value > 100) fail(ERROR_CODES.INVALID_RULE_VALUE, "Percentage pricing rule must be between 0 and 100.", { field: `appliedPricingRules.${index}.value` });
        const scopeType = String(rule.scopeType || "GLOBAL").toUpperCase();
        if (!RULE_SCOPE.includes(scopeType)) fail(ERROR_CODES.INVALID_RULE_VALUE, "Unsupported pricing rule scope.", { field: `appliedPricingRules.${index}.scopeType` });
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

    function dateApplies(rule, evaluationTime) {
        if (!rule.effectiveFrom && !rule.effectiveUntil) return true;
        if (!evaluationTime) fail(ERROR_CODES.INVALID_INPUT, "context.evaluationTime is required when pricing rules have effective dates.", { field: "context.evaluationTime", rule: rule.code || rule.id });
        const at = evaluationTime.getTime();
        const from = rule.effectiveFrom ? new Date(rule.effectiveFrom).getTime() : null;
        const until = rule.effectiveUntil ? new Date(rule.effectiveUntil).getTime() : null;
        if (!Number.isFinite(at) || (from !== null && !Number.isFinite(from)) || (until !== null && !Number.isFinite(until))) fail(ERROR_CODES.INVALID_RULE_VALUE, "Invalid pricing rule date.", { rule: rule.code || rule.id });
        return (from === null || at >= from) && (until === null || at <= until);
    }

    function refMatches(actual, expected) {
        if (!expected) return true;
        return String(actual || "").trim().toUpperCase() === String(expected).trim().toUpperCase();
    }

    function scopeApplies(rule, context) {
        if (rule.scopeType === "GLOBAL") return true;
        if (rule.scopeType === "REGION") return refMatches(context.region, rule.scopeReference);
        if (rule.scopeType === "GAME") return refMatches(context.gameId, rule.scopeReference);
        if (rule.scopeType === "CATEGORY") return refMatches(context.categoryId, rule.scopeReference);
        if (rule.scopeType === "TIER") return refMatches(context.tier, rule.scopeReference);
        if (rule.scopeType === "PACKAGE") return refMatches(context.packageId, rule.scopeReference) || refMatches(context.packageCode, rule.scopeReference);
        return false;
    }

    function sortRules(rules) {
        return [...rules].sort((a, b) => {
            const scope = (SCOPE_RANK[b.scopeType] || 0) - (SCOPE_RANK[a.scopeType] || 0);
            if (scope) return scope;
            if (b.priority !== a.priority) return b.priority - a.priority;
            return String(a.code || a.id).localeCompare(String(b.code || b.id)) || a.originalIndex - b.originalIndex;
        });
    }

    function selectRules(rules, context) {
        const evaluationTimeValue = context.evaluationTime || context.now || null;
        const evaluationTime = evaluationTimeValue ? new Date(evaluationTimeValue) : null;
        const normalized = (rules || []).map(normalizePricingRule);
        const applicable = sortRules(normalized).filter(rule => dateApplies(rule, evaluationTime) && scopeApplies(rule, context));
        const applicableSet = new Set(applicable.map(rule => rule.originalIndex));
        return { applicable, unused: normalized.filter(rule => !applicableSet.has(rule.originalIndex)) };
    }

    function stopRules(rules) {
        const stopped = new Set();
        return rules.filter(rule => {
            if (stopped.has(rule.ruleType)) return false;
            if (rule.stopFurtherProcessing) stopped.add(rule.ruleType);
            return true;
        });
    }

    function exchange(input) {
        if (input.supplierCurrency === input.targetCurrency) return { rate: null, metadata: null };
        const data = input.exchangeRate;
        if (!data || typeof data !== "object") fail(ERROR_CODES.INVALID_EXCHANGE_RATE, "Exchange rate is required for cross-currency calculation.", { field: "exchangeRate" });
        const rate = finite(data.rate, ERROR_CODES.INVALID_EXCHANGE_RATE, "exchangeRate.rate", Number.MIN_VALUE);
        if (data.sourceCurrency !== input.supplierCurrency || data.targetCurrency !== input.targetCurrency) {
            fail(ERROR_CODES.EXCHANGE_PAIR_MISMATCH, "Exchange pair does not match requested conversion.", { sourceCurrency: data.sourceCurrency, targetCurrency: data.targetCurrency });
        }
        const capturedValue = data.capturedAt || data.asOf || null;
        const capturedAt = capturedValue ? new Date(capturedValue) : null;
        const maxAgeSeconds = Number(data.maxAgeSeconds);
        const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
        const evaluatedAt = new Date(input.context?.evaluationTime || Date.now());
        if (!Number.isFinite(evaluatedAt.getTime())) fail(ERROR_CODES.INVALID_EXCHANGE_RATE, "Pricing evaluation time is invalid.", { field: "context.evaluationTime" });
        if (data.requireFreshness === true && (!capturedAt || !Number.isFinite(capturedAt.getTime()) || !Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0)) fail(ERROR_CODES.INVALID_EXCHANGE_RATE, "Bounded FX freshness evidence is required.", { field: "exchangeRate.capturedAt" });
        if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || evaluatedAt > expiresAt)) fail(ERROR_CODES.INVALID_EXCHANGE_RATE, "Exchange rate is stale.", { field: "exchangeRate.expiresAt" });
        if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0 && (!capturedAt || !Number.isFinite(capturedAt.getTime()) || evaluatedAt.getTime() - capturedAt.getTime() > maxAgeSeconds * 1000)) fail(ERROR_CODES.INVALID_EXCHANGE_RATE, "Exchange rate is stale.", { field: "exchangeRate.capturedAt" });
        return { rate, metadata: Object.freeze({ sourceCurrency: data.sourceCurrency, targetCurrency: data.targetCurrency, asOf: capturedValue, capturedAt: capturedValue, effectiveAt: data.effectiveAt || null, expiresAt: data.expiresAt || null, maxAgeSeconds: Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0 ? maxAgeSeconds : null, source: data.source || "" }) };
    }

    function roundingRule(rule) {
        if (!rule || rule.enabled === false) return { enabled: false, mode: "NONE", increment: 0, psychologicalEnding: 0 };
        const mode = String(rule.mode || "NONE").toUpperCase();
        if (!ROUNDING_MODE.includes(mode)) fail(ERROR_CODES.INVALID_ROUNDING_RULE, "Unsupported rounding mode.", { field: "policy.roundingRule.mode" });
        const increment = Number(rule.increment ?? 0);
        const psychologicalEnding = Number(rule.psychologicalEnding ?? 0);
        if (!Number.isFinite(increment) || increment < 0 || !Number.isFinite(psychologicalEnding) || psychologicalEnding < 0) fail(ERROR_CODES.INVALID_ROUNDING_RULE, "Invalid rounding rule value.", { field: "policy.roundingRule" });
        if (["NEAREST", "UP", "DOWN"].includes(mode) && increment <= 0) fail(ERROR_CODES.INVALID_ROUNDING_RULE, "Rounding increment must be positive.", { field: "policy.roundingRule.increment" });
        return { enabled: rule.enabled !== false, mode, increment, psychologicalEnding };
    }

    function applyRounding(value, rule) {
        const normalizedRule = roundingRule(rule);
        if (!normalizedRule.enabled || normalizedRule.mode === "NONE") return { amount: amount(value), rule: normalizedRule };
        const { mode, increment, psychologicalEnding } = normalizedRule;
        let rounded;
        if (mode === "NEAREST") rounded = Math.round(amount(value / increment)) * increment;
        else if (mode === "UP") rounded = Math.ceil(amount(value / increment) - 1e-9) * increment;
        else if (mode === "DOWN") rounded = Math.floor(amount(value / increment) + 1e-9) * increment;
        else {
            const ending = Math.trunc(psychologicalEnding);
            const base = increment > 0 ? increment : 10 ** Math.max(1, String(Math.trunc(ending)).length);
            rounded = Math.floor(value / base) * base + ending;
            if (rounded < value) rounded += base;
        }
        return { amount: Math.max(0, amount(rounded)), rule: normalizedRule };
    }

    function ruleAmount(base, rule) {
        return rule.ruleType.endsWith("_PERCENT") ? amount(base * (rule.value / 100)) : amount(rule.value);
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

    function overrideRule(rules) {
        const overrides = rules.filter(rule => rule.ruleType === "PRICE_OVERRIDE");
        if (overrides.length < 2) return overrides[0] || null;
        const [winner, second] = overrides;
        if ((SCOPE_RANK[winner.scopeType] || 0) === (SCOPE_RANK[second.scopeType] || 0) && winner.priority === second.priority) {
            fail(ERROR_CODES.CONFLICTING_PRICE_OVERRIDES, "Conflicting price override rules have equal precedence.", { firstRule: winner.code || winner.id, secondRule: second.code || second.id });
        }
        return winner;
    }

    function warning(code, message, details = {}) {
        return Object.freeze({ code, message, details: Object.freeze({ ...details }) });
    }

    function margin(price, totalCost) {
        if (price === 0) return totalCost === 0 ? 0 : -100;
        return amount(((price - totalCost) / price) * 100);
    }

    function calculateBasePrice(input) {
        if (!input || typeof input !== "object" || Array.isArray(input)) fail(ERROR_CODES.INVALID_INPUT, "Calculation input must be an object.", { field: "input" });
        const supplierCurrency = currency(input.supplierCurrency, "supplierCurrency", SUPPLIER_CURRENCY);
        const targetCurrency = currency(input.targetCurrency, "targetCurrency", STOREFRONT_CURRENCY);
        const supplierCost = amount(finite(input.supplierCost, ERROR_CODES.INVALID_SUPPLIER_COST, "supplierCost"));
        const policy = input.policy && typeof input.policy === "object" ? input.policy : {};
        if (!policy.profitRule) fail(ERROR_CODES.INVALID_INPUT, "policy.profitRule is required.", { field: "policy.profitRule" });
        const context = input.context && typeof input.context === "object" ? { ...input.context } : {};
        const selected = selectRules(input.appliedPricingRules || [], context);
        const rules = stopRules(selected.applicable);
        const priceOverride = overrideRule(rules);
        const warnings = selected.unused.map(rule => warning(WARNING_CODES.UNUSED_PRICING_RULE, "Pricing rule did not apply to this context.", { rule: rule.code || rule.id }));
        const breakdown = [];
        let subtotal = supplierCost;
        trace(breakdown, { stage: "SUPPLIER_COST", label: "Supplier cost", inputAmount: 0, amountAdded: supplierCost, outputAmount: subtotal, currency: supplierCurrency });
        const preExchangeSubtotal = subtotal;
        const exchangeData = exchange({ ...input, supplierCurrency, targetCurrency });
        subtotal = exchangeData.rate ? amount(subtotal * exchangeData.rate) : subtotal;
        const postExchangeSubtotal = subtotal;
        trace(breakdown, { stage: "EXCHANGE", label: "Currency exchange", inputAmount: preExchangeSubtotal, ruleType: exchangeData.rate ? "RATE" : "NONE", ruleValue: exchangeData.rate, amountAdded: amount(postExchangeSubtotal - preExchangeSubtotal), outputAmount: postExchangeSubtotal, currency: targetCurrency });
        const acquisition = input.acquisitionCosts && typeof input.acquisitionCosts === "object" ? input.acquisitionCosts : {};
        const fundingCost = amount(finite(acquisition.fundingCost ?? 0, ERROR_CODES.INVALID_SUPPLIER_COST, "acquisitionCosts.fundingCost"));
        const otherAcquisitionCost = amount(finite(acquisition.otherAcquisitionCost ?? 0, ERROR_CODES.INVALID_SUPPLIER_COST, "acquisitionCosts.otherAcquisitionCost"));
        if (fundingCost) { const beforeFunding = subtotal; subtotal = amount(subtotal + fundingCost); trace(breakdown, { stage: "FUNDING_COST", label: "Funding/acquisition adjustment", inputAmount: beforeFunding, amountAdded: fundingCost, outputAmount: subtotal, currency: targetCurrency }); }
        if (otherAcquisitionCost) { const beforeOther = subtotal; subtotal = amount(subtotal + otherAcquisitionCost); trace(breakdown, { stage: "OTHER_ACQUISITION_COST", label: "Other supplier acquisition cost", inputAmount: beforeOther, amountAdded: otherAcquisitionCost, outputAmount: subtotal, currency: targetCurrency }); }
        const landedCost = subtotal;
        const supplierFee = applyMoney(subtotal, policy.supplierFee, "policy.supplierFee");
        let before = subtotal;
        subtotal = amount(subtotal + supplierFee.amount);
        trace(breakdown, { stage: "SUPPLIER_FEE", label: "Exchange fee", inputAmount: before, ruleType: supplierFee.rule.type, ruleValue: supplierFee.rule.value, amountAdded: supplierFee.amount, outputAmount: subtotal, currency: targetCurrency });
        const businessCost = applyMoney(subtotal, policy.businessCost, "policy.businessCost");
        before = subtotal;
        subtotal = amount(subtotal + businessCost.amount);
        trace(breakdown, { stage: "BUSINESS_COST", label: "Business cost", inputAmount: before, ruleType: businessCost.rule.type, ruleValue: businessCost.rule.value, amountAdded: businessCost.amount, outputAmount: subtotal, currency: targetCurrency });
        const gatewayFee = applyMoney(subtotal, policy.gatewayFee, "policy.gatewayFee");
        before = subtotal;
        subtotal = amount(subtotal + gatewayFee.amount);
        trace(breakdown, { stage: "GATEWAY_FEE", label: "Gateway fee", inputAmount: before, ruleType: gatewayFee.rule.type, ruleValue: gatewayFee.rule.value, amountAdded: gatewayFee.amount, outputAmount: subtotal, currency: targetCurrency });
        const platformFee = applyMoney(subtotal, policy.platformCost, "policy.platformCost");
        before = subtotal;
        subtotal = amount(subtotal + platformFee.amount);
        trace(breakdown, { stage: "PLATFORM_FEE", label: "Platform fee", inputAmount: before, ruleType: platformFee.rule.type, ruleValue: platformFee.rule.value, amountAdded: platformFee.amount, outputAmount: subtotal, currency: targetCurrency });
        let pricingRuleFeeAmount = 0;
        rules.filter(rule => ["FEE_PERCENT", "FEE_FIXED"].includes(rule.ruleType)).forEach(rule => { pricingRuleFeeAmount = amount(pricingRuleFeeAmount + ruleAmount(subtotal, rule)); });
        if (pricingRuleFeeAmount > 0) {
            before = subtotal;
            subtotal = amount(subtotal + pricingRuleFeeAmount);
            trace(breakdown, { stage: "PRICING_RULE_FEE", label: "Pricing rule fee", inputAmount: before, amountAdded: pricingRuleFeeAmount, outputAmount: subtotal, currency: targetCurrency });
        }
        const tax = applyMoney(subtotal, policy.tax, "policy.tax");
        before = subtotal;
        subtotal = amount(subtotal + tax.amount);
        trace(breakdown, { stage: "TAX", label: "Tax", inputAmount: before, ruleType: tax.rule.type, ruleValue: tax.rule.value, amountAdded: tax.amount, outputAmount: subtotal, currency: targetCurrency });
        const costBeforeProfit = subtotal;
        const profitOverride = rules.find(rule => ["PROFIT_MARGIN_PERCENT", "PROFIT_FIXED"].includes(rule.ruleType));
        const profitRule = profitOverride ? { enabled: true, type: profitOverride.ruleType.endsWith("_PERCENT") ? "PERCENT" : "FIXED", value: profitOverride.value } : policy.profitRule;
        const profit = applyMoney(subtotal, profitRule, "policy.profitRule");
        let profitAmount = profit.amount;
        rules.filter(rule => ["MARKUP_PERCENT", "MARKUP_FIXED"].includes(rule.ruleType)).forEach(rule => { profitAmount = amount(profitAmount + ruleAmount(subtotal, rule)); });
        before = subtotal;
        subtotal = amount(subtotal + profitAmount);
        trace(breakdown, { stage: "PROFIT", label: "Profit and markup", inputAmount: before, ruleType: profit.rule.type, ruleValue: profit.rule.value, amountAdded: profitAmount, outputAmount: subtotal, currency: targetCurrency });
        const preRoundingPrice = subtotal;
        const roundingOverride = rules.find(rule => rule.ruleType === "ROUNDING");
        const round = applyRounding(subtotal, roundingOverride ? { enabled: true, mode: roundingOverride.configuration.mode || "NEAREST", increment: roundingOverride.configuration.increment ?? roundingOverride.value, psychologicalEnding: roundingOverride.configuration.psychologicalEnding ?? 0 } : policy.roundingRule);
        trace(breakdown, { stage: "ROUNDING", label: "Rounding", inputAmount: preRoundingPrice, ruleType: round.rule.mode, ruleValue: round.rule.increment || round.rule.psychologicalEnding, amountAdded: amount(round.amount - preRoundingPrice), outputAmount: round.amount, currency: targetCurrency });
        let regularPrice = round.amount;
        const preOverridePrice = regularPrice;
        if (priceOverride) {
            regularPrice = amount(priceOverride.value);
            warnings.push(warning(WARNING_CODES.PRICE_OVERRIDE_APPLIED, "Price override was applied.", { rule: priceOverride.code || priceOverride.id, preOverridePrice }));
            trace(breakdown, { stage: "PRICE_OVERRIDE", label: "Price override", inputAmount: preOverridePrice, ruleType: priceOverride.ruleType, ruleValue: priceOverride.value, amountAdded: amount(regularPrice - preOverridePrice), outputAmount: regularPrice, currency: targetCurrency });
        }
        const totalCost = costBeforeProfit;
        const calculatedProfitAmount = amount(regularPrice - totalCost);
        const calculatedMarginPercent = margin(regularPrice, totalCost);
        if (calculatedProfitAmount < 0) {
            warnings.push(warning(WARNING_CODES.NEGATIVE_EFFECTIVE_PROFIT, "Calculated profit is negative."));
            warnings.push(warning(WARNING_CODES.PRICE_BELOW_COST, "Calculated price is below cost."));
        } else if (calculatedProfitAmount === 0) {
            warnings.push(warning(WARNING_CODES.ZERO_MARGIN, "Calculated margin is zero."));
        }
        if (regularPrice < preRoundingPrice) warnings.push(warning(WARNING_CODES.ROUNDING_REDUCED_MARGIN, "Rounding reduced the pre-rounding margin."));
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
            exchangeRateApplied: exchangeData.rate,
            exchangeRateMetadata: exchangeData.metadata,
            postExchangeSubtotal,
            fxConvertedCost: postExchangeSubtotal,
            fundingCost,
            otherAcquisitionCost,
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
            appliedRules: Object.freeze(rules.map(ruleTrace)),
            warnings: Object.freeze(warnings),
            breakdown: Object.freeze(breakdown)
        });
    }

    root.AZIEL_COMMERCE_PRICING_ENGINE = Object.freeze({
        calculateBasePrice,
        CommerceCalculationError,
        ERROR_CODES,
        WARNING_CODES,
        INTERNAL_PRECISION,
        ENGINE_VERSION,
        SPECIFICATION_VERSION
    });
})(window);
