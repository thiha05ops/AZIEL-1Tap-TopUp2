const {
    calculateBasePrice,
    CommerceCalculationError,
    ENGINE_VERSION: PRICING_ENGINE_VERSION,
    SPECIFICATION_VERSION: PRICING_SPECIFICATION_VERSION
} = require("./pricingCalculationEngine");
const {
    resolvePromotion,
    PromotionResolverError
} = require("./promotionResolver");
const { CURRENCY, REGION } = require("../../constants/commerce");
const {
    finalizeCustomerPayableAmount
} = require("./customerPayableAmountService");

const QUOTE_RUNTIME_VERSION = "2.4.2";
const QUOTE_SPECIFICATION_VERSION = "2.4.1";
const DEFAULT_PAYLOAD_VERSION = "commerce.quote.v1";
const DEFAULT_INTEGRITY_ALGORITHM = "canonical-json-sha256-deferred";
const MAX_SAFE_AMOUNT = 1_000_000_000_000;
const INTERNAL_PRECISION = 6;

const ERROR_CODES = Object.freeze({
    INVALID_INPUT: "INVALID_INPUT",
    INVALID_QUOTE_ID: "INVALID_QUOTE_ID",
    INVALID_OWNER: "INVALID_OWNER",
    INVALID_PACKAGE_IDENTITY: "INVALID_PACKAGE_IDENTITY",
    INVALID_ISSUED_AT: "INVALID_ISSUED_AT",
    INVALID_EXPIRES_AT: "INVALID_EXPIRES_AT",
    INVALID_VALIDITY_DURATION: "INVALID_VALIDITY_DURATION",
    INVALID_QUOTE_WINDOW: "INVALID_QUOTE_WINDOW",
    INVALID_QUANTITY: "INVALID_QUANTITY",
    PRICING_CALCULATION_FAILED: "PRICING_CALCULATION_FAILED",
    PRICING_CURRENCY_MISMATCH: "PRICING_CURRENCY_MISMATCH",
    INVALID_PRICING_RESULT: "INVALID_PRICING_RESULT",
    PROMOTION_RESOLUTION_FAILED: "PROMOTION_RESOLUTION_FAILED",
    PROMOTION_CURRENCY_MISMATCH: "PROMOTION_CURRENCY_MISMATCH",
    INVALID_PROMOTION_RESULT: "INVALID_PROMOTION_RESULT",
    INVALID_FINAL_AMOUNT: "INVALID_FINAL_AMOUNT",
    QUOTE_AMOUNT_OVERFLOW: "QUOTE_AMOUNT_OVERFLOW",
    INVALID_INTEGRITY_PAYLOAD: "INVALID_INTEGRITY_PAYLOAD",
    CANONICALISATION_FAILED: "CANONICALISATION_FAILED"
});

const WARNING_CODES = Object.freeze({
    NO_PROMOTION_APPLIED: "NO_PROMOTION_APPLIED",
    PRICING_WARNINGS_PRESENT: "PRICING_WARNINGS_PRESENT",
    PROMOTION_WARNINGS_PRESENT: "PROMOTION_WARNINGS_PRESENT",
    ZERO_PRICE_QUOTE: "ZERO_PRICE_QUOTE",
    SESSION_BOUND_QUOTE: "SESSION_BOUND_QUOTE",
    NO_PRICE_VERSION_REFERENCE: "NO_PRICE_VERSION_REFERENCE",
    INTEGRITY_SIGNATURE_NOT_GENERATED: "INTEGRITY_SIGNATURE_NOT_GENERATED"
});

class PricingQuoteRuntimeError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "PricingQuoteRuntimeError";
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }
    Object.freeze(value);
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return value;
}

function clonePlain(value, path = "value", seen = new WeakMap()) {
    if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_INTEGRITY_PAYLOAD, "Unsupported value in quote payload.", { path });
    }
    if (value === null || typeof value !== "object") {
        if (typeof value === "number") return normalizeAmount(value, path);
        return value;
    }
    if (value instanceof Date) {
        return normalizeDate(value, path).toISOString();
    }
    if (seen.has(value)) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.CANONICALISATION_FAILED, "Circular quote payload reference is not supported.", { path });
    }
    seen.set(value, true);
    if (Array.isArray(value)) {
        const clonedArray = value.map((item, index) => clonePlain(item, `${path}[${index}]`, seen));
        seen.delete(value);
        return clonedArray;
    }
    if (!isPlainObject(value)) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_INTEGRITY_PAYLOAD, "Quote payload must contain plain objects only.", { path });
    }
    const clonedObject = {};
    Object.keys(value).sort().forEach(key => {
        const child = value[key];
        if (child !== undefined) {
            clonedObject[key] = clonePlain(child, `${path}.${key}`, seen);
        }
    });
    seen.delete(value);
    return clonedObject;
}

function canonicalSerialize(value) {
    try {
        return JSON.stringify(clonePlain(value));
    } catch (error) {
        if (error instanceof PricingQuoteRuntimeError) throw error;
        throw new PricingQuoteRuntimeError(ERROR_CODES.CANONICALISATION_FAILED, "Could not canonicalize quote payload.", { message: error.message });
    }
}

function normalizeAmount(value, field = "amount") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_FINAL_AMOUNT, "Quote amount must be finite.", { field });
    }
    if (Math.abs(numeric) > MAX_SAFE_AMOUNT) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.QUOTE_AMOUNT_OVERFLOW, "Quote amount exceeds supported range.", { field });
    }
    const normalized = Number(numeric.toFixed(INTERNAL_PRECISION));
    return Object.is(normalized, -0) ? 0 : normalized;
}

function normalizeDate(value, field) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        const code = field === "issuedAt" ? ERROR_CODES.INVALID_ISSUED_AT : ERROR_CODES.INVALID_EXPIRES_AT;
        throw new PricingQuoteRuntimeError(code, "Quote timestamp is invalid.", { field });
    }
    return date;
}

function requirePlainObject(value, field) {
    if (!isPlainObject(value)) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_INPUT, "Expected an object.", { field });
    }
    return value;
}

function normalizeString(value) {
    return String(value || "").trim();
}

function normalizeUpper(value) {
    return normalizeString(value).toUpperCase();
}

function normalizeCurrency(value) {
    const currency = normalizeUpper(value);
    if (!CURRENCY.includes(currency)) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_INPUT, "Unsupported quote currency.", { field: "request.currency", currency });
    }
    return currency;
}

function normalizeRegion(value) {
    const region = normalizeUpper(value);
    if (!REGION.includes(region)) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_INPUT, "Unsupported quote region.", { field: "request.region", region });
    }
    return region;
}

function normalizeQuoteId(value) {
    const quoteId = normalizeString(value);
    if (!quoteId || quoteId.length < 8 || quoteId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(quoteId)) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_QUOTE_ID, "quoteId must be a public-safe non-empty identifier.", { field: "quoteId" });
    }
    return quoteId;
}

function normalizeOwner(owner = {}) {
    requirePlainObject(owner, "owner");
    const normalized = {
        userId: normalizeString(owner.userId),
        sessionId: normalizeString(owner.sessionId)
    };
    if (!normalized.userId && !normalized.sessionId) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_OWNER, "A quote requires userId or sessionId ownership.", { field: "owner" });
    }
    return normalized;
}

function normalizeQuantity(value) {
    if (value === undefined || value === null || value === "") return 1;
    const quantity = Number(value);
    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_QUANTITY, "Quote quantity must be a positive integer.", { field: "request.package.quantity" });
    }
    return quantity;
}

function normalizePackageSnapshot(packageInput = {}) {
    requirePlainObject(packageInput, "request.package");
    const snapshot = {
        packageId: normalizeString(packageInput.packageId),
        packageCode: normalizeString(packageInput.packageCode),
        packageRef: normalizeString(packageInput.packageRef),
        packageName: normalizeString(packageInput.packageName),
        gameId: normalizeString(packageInput.gameId),
        gameCode: normalizeString(packageInput.gameCode),
        gameName: normalizeString(packageInput.gameName),
        categoryId: normalizeString(packageInput.categoryId),
        categoryCode: normalizeString(packageInput.categoryCode),
        quantity: normalizeQuantity(packageInput.quantity)
    };
    if (!snapshot.packageId && !snapshot.packageCode && !snapshot.packageRef) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_PACKAGE_IDENTITY, "At least one stable package identity field is required.", {
            field: "request.package"
        });
    }
    return snapshot;
}

function normalizeTimes(input) {
    const issuedAt = normalizeDate(input.issuedAt, "issuedAt");
    let expiresAt = input.expiresAt ? normalizeDate(input.expiresAt, "expiresAt") : null;

    if (input.validitySeconds !== undefined && input.validitySeconds !== null) {
        const validitySeconds = Number(input.validitySeconds);
        if (!Number.isInteger(validitySeconds) || validitySeconds <= 0) {
            throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_VALIDITY_DURATION, "validitySeconds must be a positive integer.", { field: "validitySeconds" });
        }
        const computedExpiresAt = new Date(issuedAt.getTime() + validitySeconds * 1000);
        if (expiresAt && expiresAt.getTime() !== computedExpiresAt.getTime()) {
            throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_QUOTE_WINDOW, "expiresAt conflicts with validitySeconds.", {
                issuedAt: issuedAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
                computedExpiresAt: computedExpiresAt.toISOString()
            });
        }
        expiresAt = computedExpiresAt;
    }

    if (!expiresAt) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_VALIDITY_DURATION, "expiresAt or validitySeconds is required.", { field: "expiresAt" });
    }
    if (expiresAt.getTime() <= issuedAt.getTime()) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_QUOTE_WINDOW, "expiresAt must be later than issuedAt.", {
            issuedAt: issuedAt.toISOString(),
            expiresAt: expiresAt.toISOString()
        });
    }

    return {
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString()
    };
}

function sanitizeRule(rule = {}, index) {
    return {
        id: normalizeString(rule.id || rule._id),
        code: normalizeString(rule.code),
        ruleType: normalizeString(rule.ruleType),
        scopeType: normalizeString(rule.scopeType),
        scopeReference: normalizeString(rule.scopeReference),
        priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0,
        value: rule.value === undefined ? null : normalizeAmount(rule.value, `appliedPricingRules.${index}.value`),
        stopFurtherProcessing: rule.stopFurtherProcessing === true
    };
}

function summarizePricingInput(pricingInput = {}) {
    return {
        supplierCost: normalizeAmount(pricingInput.supplierCost, "pricingInput.supplierCost"),
        supplierCurrency: normalizeUpper(pricingInput.supplierCurrency),
        targetCurrency: normalizeUpper(pricingInput.targetCurrency),
        exchangeRate: pricingInput.exchangeRate ? clonePlain(pricingInput.exchangeRate, "pricingInput.exchangeRate") : null,
        policy: pricingInput.policy ? clonePlain(pricingInput.policy, "pricingInput.policy") : null,
        context: pricingInput.context ? clonePlain(pricingInput.context, "pricingInput.context") : null,
        appliedPricingRules: Array.isArray(pricingInput.appliedPricingRules)
            ? pricingInput.appliedPricingRules.map(sanitizeRule)
            : []
    };
}

function normalizeVersionContext(versionContext = {}) {
    const source = isPlainObject(versionContext) ? versionContext : {};
    return {
        priceVersionId: normalizeString(source.priceVersionId),
        priceVersionNumber: source.priceVersionNumber === undefined || source.priceVersionNumber === null || source.priceVersionNumber === ""
            ? null
            : Number(source.priceVersionNumber),
        branchKey: normalizeString(source.branchKey),
        parentVersionId: normalizeString(source.parentVersionId)
    };
}

function normalizeTrace(trace = {}) {
    const source = isPlainObject(trace) ? trace : {};
    return {
        traceId: normalizeString(source.traceId),
        issueSource: normalizeString(source.issueSource)
    };
}

function normalizeIntegrity(integrity = {}) {
    const source = isPlainObject(integrity) ? integrity : {};
    return {
        payloadVersion: normalizeString(source.payloadVersion) || DEFAULT_PAYLOAD_VERSION,
        algorithm: normalizeString(source.algorithm) || DEFAULT_INTEGRITY_ALGORITHM,
        keyId: normalizeString(source.keyId)
    };
}

function runPricingCalculation(pricingInput) {
    try {
        return calculateBasePrice(pricingInput);
    } catch (error) {
        if (error instanceof CommerceCalculationError) {
            throw new PricingQuoteRuntimeError(ERROR_CODES.PRICING_CALCULATION_FAILED, `Base pricing calculation failed: ${error.message}`, {
                code: error.code,
                message: error.message,
                details: error.details
            });
        }
        throw error;
    }
}

function supplierCostConfigured(pricingInput = {}) {
    return pricingInput.context?.supplierCostSnapshot?.configured === true;
}

function validatePricingResult(result, requestCurrency, pricingInput = {}) {
    if (!result || result.success !== true) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_PRICING_RESULT, "Pricing result did not succeed.");
    }
    if (normalizeUpper(result.currency) !== requestCurrency) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.PRICING_CURRENCY_MISMATCH, "Pricing result currency does not match quote request.", {
            requestCurrency,
            pricingCurrency: result.currency
        });
    }
    const originalPrice = normalizeAmount(result.originalPrice, "pricingResult.originalPrice");
    if (originalPrice < 0) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_PRICING_RESULT, "Pricing original price cannot be negative.");
    }
    const warningCodes = new Set((result.warnings || []).map(warning => warning?.code).filter(Boolean));
    if (supplierCostConfigured(pricingInput) && (warningCodes.has("NEGATIVE_EFFECTIVE_PROFIT") || warningCodes.has("PRICE_BELOW_COST"))) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_PRICING_RESULT, "Pricing result failed margin safety checks.", {
            warningCodes: [...warningCodes]
        });
    }
    return originalPrice;
}

function buildPromotionInput(input, originalPrice, currency, context) {
    const supplied = isPlainObject(input.promotionInput) ? input.promotionInput : null;
    if (!supplied) return null;
    const suppliedContext = isPlainObject(supplied.context) ? supplied.context : {};
    return {
        originalPrice,
        currency,
        promotions: Array.isArray(supplied.promotions) ? supplied.promotions : [],
        campaigns: Array.isArray(supplied.campaigns) ? supplied.campaigns : [],
        strategy: isPlainObject(supplied.strategy) ? supplied.strategy : {},
        context: {
            ...suppliedContext,
            evaluationTime: context.issuedAt,
            region: context.region,
            currency,
            packageId: context.packageSnapshot.packageId,
            packageCode: context.packageSnapshot.packageCode,
            packageRef: context.packageSnapshot.packageRef,
            gameId: context.packageSnapshot.gameId || suppliedContext.gameId,
            categoryId: context.packageSnapshot.categoryId || suppliedContext.categoryId,
            userId: context.owner.userId || suppliedContext.userId,
            sessionId: context.owner.sessionId || suppliedContext.sessionId,
            couponCode: context.couponCode,
            orderSubtotal: originalPrice,
            originalPrice
        }
    };
}

function runPromotionResolver(promotionInput) {
    if (!promotionInput) return null;
    try {
        return resolvePromotion(promotionInput);
    } catch (error) {
        if (error instanceof PromotionResolverError) {
            throw new PricingQuoteRuntimeError(ERROR_CODES.PROMOTION_RESOLUTION_FAILED, "Promotion resolution failed.", {
                code: error.code,
                details: error.details
            });
        }
        throw error;
    }
}

function validatePromotionResult(result, currency) {
    if (!result) return;
    if (normalizeUpper(result.currency) !== currency) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.PROMOTION_CURRENCY_MISMATCH, "Promotion result currency does not match quote currency.", {
            quoteCurrency: currency,
            promotionCurrency: result.currency
        });
    }
    const finalPrice = normalizeAmount(result.candidateFinalPrice, "promotionResult.candidateFinalPrice");
    const discountAmount = normalizeAmount(result.discountAmount || 0, "promotionResult.discountAmount");
    if (finalPrice < 0 || discountAmount < 0) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_PROMOTION_RESULT, "Promotion result cannot produce negative values.");
    }
}

function buildPricingSnapshot(pricingInput, pricingResult, priceVersion) {
    const inputSummary = summarizePricingInput(pricingInput);
    const configuredSupplierCost = inputSummary.context?.supplierCostSnapshot?.configured === true;
    const pricingWarningCodes = new Set((pricingResult.warnings || []).map(warning => warning?.code).filter(Boolean));
    const profitabilityStatus = configuredSupplierCost
        ? (pricingWarningCodes.has("NEGATIVE_EFFECTIVE_PROFIT") || pricingWarningCodes.has("PRICE_BELOW_COST")
            ? "NEGATIVE"
            : pricingWarningCodes.has("ZERO_MARGIN")
                ? "LOW"
                : "HEALTHY")
        : "UNKNOWN_SUPPLIER_COST";
    return {
        inputSummary,
        result: clonePlain(pricingResult, "pricingResult"),
        supplierCostSnapshot: inputSummary.context?.supplierCostSnapshot || null,
        exchangeSnapshot: inputSummary.context?.exchangeRateSnapshot || inputSummary.exchangeRate || null,
        businessRuntime: {
            supplierCost: inputSummary.supplierCost,
            supplierCurrency: inputSummary.supplierCurrency,
            supplierCostConfigured: configuredSupplierCost,
            supplierCostSource: inputSummary.context?.supplierCostSnapshot?.source || "",
            sellingPrice: normalizeAmount(pricingResult.originalPrice || 0, "pricingResult.originalPrice"),
            sellingCurrency: normalizeUpper(pricingResult.currency),
            discount: 0,
            gatewayFee: normalizeAmount(pricingResult.gatewayFeeAmount || 0, "pricingResult.gatewayFeeAmount"),
            walletFee: 0,
            netRevenue: normalizeAmount(pricingResult.originalPrice || 0, "pricingResult.originalPrice"),
            grossProfit: configuredSupplierCost ? normalizeAmount(pricingResult.calculatedProfitAmount || 0, "pricingResult.calculatedProfitAmount") : null,
            netProfit: configuredSupplierCost ? normalizeAmount(pricingResult.calculatedProfitAmount || 0, "pricingResult.calculatedProfitAmount") : null,
            marginPercent: configuredSupplierCost ? normalizeAmount(pricingResult.calculatedMarginPercent || 0, "pricingResult.calculatedMarginPercent") : null,
            profitabilityStatus,
            marginEnforcementApplied: configuredSupplierCost,
            healthyMargin: profitabilityStatus === "HEALTHY",
            warnings: configuredSupplierCost ? [] : ["SUPPLIER_COST_NOT_CONFIGURED"]
        },
        engineVersion: pricingResult.engineVersion || PRICING_ENGINE_VERSION,
        specificationVersion: pricingResult.specificationVersion || PRICING_SPECIFICATION_VERSION,
        priceVersion: clonePlain(priceVersion, "versionContext")
    };
}

function buildPromotionSnapshot(promotionResult) {
    if (!promotionResult) return null;
    return {
        selectedPromotion: promotionResult.selectedPromotion ? clonePlain(promotionResult.selectedPromotion, "promotionResult.selectedPromotion") : null,
        resolverVersion: promotionResult.resolverVersion,
        specificationVersion: promotionResult.specificationVersion,
        campaignId: promotionResult.selectedPromotion?.campaignId || null,
        discountAmount: normalizeAmount(promotionResult.discountAmount || 0, "promotionSnapshot.discountAmount"),
        candidateFinalPrice: normalizeAmount(promotionResult.candidateFinalPrice, "promotionSnapshot.candidateFinalPrice"),
        effectiveDiscountPercent: normalizeAmount(promotionResult.effectiveDiscountPercent || 0, "promotionSnapshot.effectiveDiscountPercent"),
        eligiblePromotions: clonePlain(promotionResult.eligiblePromotions || [], "promotionResult.eligiblePromotions"),
        rejectedPromotions: clonePlain(promotionResult.rejectedPromotions || [], "promotionResult.rejectedPromotions"),
        warnings: clonePlain(promotionResult.warnings || [], "promotionResult.warnings"),
        traceSummary: clonePlain(promotionResult.resolutionTrace || [], "promotionResult.resolutionTrace")
    };
}

function addWarning(warnings, code, details = {}) {
    warnings.push({ code, details });
}

function buildIntegrityPayload({ quoteId, owner, packageSnapshot, commercialSnapshot, pricingSnapshot, promotionSnapshot, lifecycle, payloadVersion }) {
    const canonicalCommercialData = {
        quoteId,
        owner,
        packageIdentity: {
            packageId: packageSnapshot.packageId,
            packageCode: packageSnapshot.packageCode,
            packageRef: packageSnapshot.packageRef
        },
        region: commercialSnapshot.region,
        currency: commercialSnapshot.currency,
        originalPrice: commercialSnapshot.originalPrice,
        discountAmount: commercialSnapshot.discountAmount,
        quotedUnitPrice: commercialSnapshot.quotedUnitPrice,
        quantity: commercialSnapshot.quantity,
        quotedTotalAmount: commercialSnapshot.quotedTotalAmount,
        pricing: {
            engineVersion: pricingSnapshot.engineVersion,
            specificationVersion: pricingSnapshot.specificationVersion,
            priceVersion: pricingSnapshot.priceVersion
        },
        promotion: promotionSnapshot ? {
            resolverVersion: promotionSnapshot.resolverVersion,
            specificationVersion: promotionSnapshot.specificationVersion,
            selectedPromotionId: promotionSnapshot.selectedPromotion?.id || null,
            selectedPromotionCode: promotionSnapshot.selectedPromotion?.code || null,
            campaignId: promotionSnapshot.campaignId || null
        } : null,
        issuedAt: lifecycle.issuedAt,
        expiresAt: lifecycle.expiresAt,
        payloadVersion
    };
    return {
        payloadVersion,
        canonicalCommercialData,
        canonicalSerialized: canonicalSerialize(canonicalCommercialData)
    };
}

function validateFinalAmounts(unitPrice, quantity, totalAmount) {
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_FINAL_AMOUNT, "quotedUnitPrice must be finite and non-negative.");
    }
    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.INVALID_FINAL_AMOUNT, "quotedTotalAmount must be finite and non-negative.");
    }
    if (totalAmount > MAX_SAFE_AMOUNT) {
        throw new PricingQuoteRuntimeError(ERROR_CODES.QUOTE_AMOUNT_OVERFLOW, "quotedTotalAmount exceeds supported range.");
    }
}

function createPricingQuote(input) {
    requirePlainObject(input, "input");
    const quoteId = normalizeQuoteId(input.quoteId);
    const owner = normalizeOwner(input.owner || {});
    const request = requirePlainObject(input.request, "request");
    const region = normalizeRegion(request.region);
    const currency = normalizeCurrency(request.currency);
    const packageSnapshot = normalizePackageSnapshot(request.package || {});
    const times = normalizeTimes(input);
    const versionContext = normalizeVersionContext(input.versionContext || {});
    const integrityContext = normalizeIntegrity(input.integrity || {});
    const trace = normalizeTrace(input.trace || {});
    const pricingInput = requirePlainObject(input.pricingInput, "pricingInput");

    const pricingResult = runPricingCalculation(pricingInput);
    const originalPrice = validatePricingResult(pricingResult, currency, pricingInput);
    const promotionInput = buildPromotionInput(input, originalPrice, currency, {
        issuedAt: times.issuedAt,
        region,
        owner,
        packageSnapshot,
        couponCode: normalizeUpper(request.couponCode)
    });
    const promotionResult = runPromotionResolver(promotionInput);
    validatePromotionResult(promotionResult, currency);

    const discountAmount = promotionResult ? normalizeAmount(promotionResult.discountAmount || 0, "discountAmount") : 0;
    const quotedUnitPrice = promotionResult
        ? normalizeAmount(promotionResult.candidateFinalPrice, "quotedUnitPrice")
        : originalPrice;
    const quantity = packageSnapshot.quantity;
    // Pricing and promotion calculations retain internal precision. The quote is
    // the single settlement boundary: every downstream order, payment attempt,
    // provider payload and customer display consumes this finalized total.
    const quotedTotalAmount = finalizeCustomerPayableAmount(
        normalizeAmount(quotedUnitPrice * quantity, "quotedTotalAmount"),
        currency
    );
    validateFinalAmounts(quotedUnitPrice, quantity, quotedTotalAmount);

    const warnings = [];
    if ((pricingResult.warnings || []).length) addWarning(warnings, WARNING_CODES.PRICING_WARNINGS_PRESENT);
    if (promotionResult?.warnings?.length) addWarning(warnings, WARNING_CODES.PROMOTION_WARNINGS_PRESENT);
    if (!promotionResult?.selectedPromotion) addWarning(warnings, WARNING_CODES.NO_PROMOTION_APPLIED);
    if (quotedTotalAmount === 0) addWarning(warnings, WARNING_CODES.ZERO_PRICE_QUOTE);
    if (!owner.userId && owner.sessionId) addWarning(warnings, WARNING_CODES.SESSION_BOUND_QUOTE);
    if (!versionContext.priceVersionId) addWarning(warnings, WARNING_CODES.NO_PRICE_VERSION_REFERENCE);
    addWarning(warnings, WARNING_CODES.INTEGRITY_SIGNATURE_NOT_GENERATED);

    const commercialSnapshot = {
        region,
        currency,
        originalPrice,
        discountAmount,
        quotedUnitPrice,
        quantity,
        quotedTotalAmount,
        promotionAppliesTo: "UNIT_PRICE"
    };
    const pricingSnapshot = buildPricingSnapshot(pricingInput, pricingResult, versionContext);
    const promotionSnapshot = buildPromotionSnapshot(promotionResult);
    const lifecycle = {
        issuedAt: times.issuedAt,
        expiresAt: times.expiresAt,
        status: "ISSUED"
    };
    const integrityPayload = buildIntegrityPayload({
        quoteId,
        owner,
        packageSnapshot,
        commercialSnapshot,
        pricingSnapshot,
        promotionSnapshot,
        lifecycle,
        payloadVersion: integrityContext.payloadVersion
    });

    return deepFreeze({
        quoteRuntimeVersion: QUOTE_RUNTIME_VERSION,
        quoteSpecificationVersion: QUOTE_SPECIFICATION_VERSION,
        quoteId,
        status: "ISSUED",
        payloadVersion: integrityContext.payloadVersion,
        owner: clonePlain(owner, "owner"),
        packageSnapshot: clonePlain(packageSnapshot, "packageSnapshot"),
        commercialSnapshot,
        pricingSnapshot,
        promotionSnapshot,
        lifecycle,
        integrityPayload,
        integrityMetadata: {
            algorithm: integrityContext.algorithm,
            keyId: integrityContext.keyId,
            canonicalHash: null,
            signature: null
        },
        trace,
        warnings: clonePlain(warnings, "warnings")
    });
}

module.exports = Object.freeze({
    createPricingQuote,
    canonicalSerialize,
    PricingQuoteRuntimeError,
    ERROR_CODES,
    WARNING_CODES,
    QUOTE_RUNTIME_VERSION,
    QUOTE_SPECIFICATION_VERSION,
    DEFAULT_PAYLOAD_VERSION
});
