const { createPricingQuote } = require("./pricingQuoteRuntime");
const {
    createQuoteRecord,
    findOwnedQuote,
    PricingQuotePersistenceError,
    ERROR_CODES: PERSISTENCE_ERROR_CODES
} = require("./pricingQuoteRepository");
const { CURRENCY, REGION } = require("../../constants/commerce");

const APPLICATION_SERVICE_VERSION = "2.4.3";

const ERROR_CODES = Object.freeze({
    INVALID_APPLICATION_INPUT: "INVALID_APPLICATION_INPUT",
    INVALID_OWNER: "INVALID_OWNER",
    INVALID_PACKAGE_IDENTITY: "INVALID_PACKAGE_IDENTITY",
    INVALID_REGION: "INVALID_REGION",
    UNSUPPORTED_CURRENCY: "UNSUPPORTED_CURRENCY",
    INVALID_QUANTITY: "INVALID_QUANTITY",
    INVALID_VALIDITY_DURATION: "INVALID_VALIDITY_DURATION",
    INVALID_IDEMPOTENCY_KEY: "INVALID_IDEMPOTENCY_KEY",
    TRUSTED_CONTEXT_REQUIRED: "TRUSTED_CONTEXT_REQUIRED",
    PACKAGE_CONTEXT_LOAD_FAILED: "PACKAGE_CONTEXT_LOAD_FAILED",
    PRICING_CONTEXT_LOAD_FAILED: "PRICING_CONTEXT_LOAD_FAILED",
    PROMOTION_CONTEXT_LOAD_FAILED: "PROMOTION_CONTEXT_LOAD_FAILED",
    QUOTE_RUNTIME_FAILED: "QUOTE_RUNTIME_FAILED",
    QUOTE_PERSISTENCE_FAILED: "QUOTE_PERSISTENCE_FAILED",
    QUOTE_NOT_FOUND: "QUOTE_NOT_FOUND",
    QUOTE_OWNERSHIP_MISMATCH: "QUOTE_OWNERSHIP_MISMATCH",
    IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
    APPLICATION_ORCHESTRATION_FAILED: "APPLICATION_ORCHESTRATION_FAILED"
});

const WARNING_CODES = Object.freeze({
    EXISTING_QUOTE_REUSED: "EXISTING_QUOTE_REUSED",
    NO_PROMOTION_APPLIED: "NO_PROMOTION_APPLIED",
    QUOTE_EXPIRES_SOON: "QUOTE_EXPIRES_SOON",
    SESSION_BOUND_QUOTE: "SESSION_BOUND_QUOTE",
    PRICE_VERSION_UNAVAILABLE: "PRICE_VERSION_UNAVAILABLE"
});

class PricingQuoteApplicationError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "PricingQuoteApplicationError";
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}

function deepFreeze(value, seen = new WeakSet()) {
    if (
        value === null ||
        value === undefined ||
        typeof value !== "object" ||
        Object.isFrozen(value)
    ) {
        return value;
    }

    // MongoDB ObjectId, Node Buffer and typed arrays may contain
    // ArrayBuffer views that cannot be frozen when they have elements.
    if (
        Buffer.isBuffer(value) ||
        ArrayBuffer.isView(value) ||
        value instanceof ArrayBuffer ||
        value instanceof Date
    ) {
        return value;
    }

    // Avoid recursive cycles from Mongoose/runtime objects.
    if (seen.has(value)) {
        return value;
    }

    seen.add(value);

    for (const key of Object.keys(value)) {
        deepFreeze(value[key], seen);
    }

    return Object.freeze(value);
}

function clonePlain(value) {
    if (value === undefined) return undefined;
    return structuredClone(value);
}

function normalizeString(value) {
    return String(value || "").trim();
}

function normalizeUpper(value) {
    return normalizeString(value).toUpperCase();
}

function assertPlainObject(value, field) {
    if (!isPlainObject(value)) {
        throw new PricingQuoteApplicationError(ERROR_CODES.INVALID_APPLICATION_INPUT, "Expected an object.", { field });
    }
    return value;
}

function normalizeOwner(owner = {}) {
    assertPlainObject(owner, "owner");
    const normalized = {
        userId: normalizeString(owner.userId),
        sessionId: normalizeString(owner.sessionId)
    };
    if (!normalized.userId && !normalized.sessionId) {
        throw new PricingQuoteApplicationError(ERROR_CODES.INVALID_OWNER, "Authenticated userId or sessionId ownership is required.");
    }
    return normalized;
}

function normalizeRegion(region) {
    const normalized = normalizeUpper(region);
    if (!REGION.includes(normalized)) {
        throw new PricingQuoteApplicationError(ERROR_CODES.INVALID_REGION, "Unsupported quote region.", { region });
    }
    return normalized;
}

function normalizeCurrency(currency) {
    const normalized = normalizeUpper(currency);
    if (!CURRENCY.includes(normalized)) {
        throw new PricingQuoteApplicationError(ERROR_CODES.UNSUPPORTED_CURRENCY, "Unsupported quote currency.", { currency });
    }
    return normalized;
}

function normalizeQuantity(quantity) {
    if (quantity === undefined || quantity === null || quantity === "") return 1;
    const normalized = Number(quantity);
    if (!Number.isInteger(normalized) || normalized <= 0) {
        throw new PricingQuoteApplicationError(ERROR_CODES.INVALID_QUANTITY, "Quantity must be a positive integer.", { quantity });
    }
    return normalized;
}

function normalizePackageIdentity(packageIdentity = {}) {
    assertPlainObject(packageIdentity, "request.packageIdentity");
    const normalized = {
        packageId: normalizeString(packageIdentity.packageId),
        packageCode: normalizeString(packageIdentity.packageCode),
        packageRef: normalizeString(packageIdentity.packageRef)
    };
    if (!normalized.packageId && !normalized.packageCode && !normalized.packageRef) {
        throw new PricingQuoteApplicationError(ERROR_CODES.INVALID_PACKAGE_IDENTITY, "At least one package identity field is required.");
    }
    return normalized;
}

function normalizeIdempotencyKey(value) {
    if (value === undefined || value === null || value === "") return "";
    const normalized = normalizeString(value);
    if (!normalized || normalized.length > 200) {
        throw new PricingQuoteApplicationError(ERROR_CODES.INVALID_IDEMPOTENCY_KEY, "idempotencyKey must be a bounded non-empty string when supplied.");
    }
    return normalized;
}

function normalizeValiditySeconds(value) {
    if (value === undefined || value === null || value === "") return 600;
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized <= 0) {
        throw new PricingQuoteApplicationError(ERROR_CODES.INVALID_VALIDITY_DURATION, "validitySeconds must be a positive integer.");
    }
    return normalized;
}

function normalizePaymentMethodId(value) {
    const normalized = normalizeString(value);
    if (!normalized) return "";
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(normalized)) {
        throw new PricingQuoteApplicationError(ERROR_CODES.INVALID_APPLICATION_INPUT, "Invalid payment method identifier.", { field: "request.paymentMethodId" });
    }
    return normalized;
}

function normalizeTrace(trace = {}) {
    const source = isPlainObject(trace) ? trace : {};
    return {
        traceId: normalizeString(source.traceId),
        issueSource: normalizeString(source.issueSource || "pricing-quote-application-service")
    };
}

function normalizeApplicationInput(input) {
    assertPlainObject(input, "input");
    const request = assertPlainObject(input.request, "request");
    const packageIdentity = normalizePackageIdentity(request.packageIdentity || {});
    const quantity = normalizeQuantity(request.quantity);
    return {
        owner: normalizeOwner(input.owner || {}),
        request: {
            region: normalizeRegion(request.region),
            currency: normalizeCurrency(request.currency),
            packageIdentity,
            paymentMethodId: normalizePaymentMethodId(request.paymentMethodId),
            couponCode: normalizeUpper(request.couponCode),
            quantity
        },
        idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
        validitySeconds: normalizeValiditySeconds(input.validitySeconds),
        trace: normalizeTrace(input.trace || {}),
        trustedContext: isPlainObject(input.trustedContext) ? clonePlain(input.trustedContext) : {}
    };
}

function getDependencies(dependencies = {}) {
    return {
        createPricingQuote: dependencies.createPricingQuote || createPricingQuote,
        createQuoteRecord: dependencies.createQuoteRecord || createQuoteRecord,
        findOwnedQuote: dependencies.findOwnedQuote || findOwnedQuote,
        loadPackageContext: dependencies.loadPackageContext,
        loadPricingContext: dependencies.loadPricingContext,
        loadPromotionContext: dependencies.loadPromotionContext,
        generateQuoteId: dependencies.generateQuoteId,
        getIssuedAt: dependencies.getIssuedAt,
        generateTraceId: dependencies.generateTraceId
    };
}

async function loadOrUseContext(stage, supplied, loader, args) {
    if (supplied) return clonePlain(supplied);
    if (typeof loader !== "function") {
        throw new PricingQuoteApplicationError(ERROR_CODES.TRUSTED_CONTEXT_REQUIRED, `${stage} trusted context or loader is required.`, { stage });
    }
    try {
        const loaded = await loader(args);
        if (!loaded || typeof loaded !== "object") {
            throw new Error(`${stage} loader returned no context.`);
        }
        return clonePlain(loaded);
    } catch (error) {
        const code = stage === "package"
            ? ERROR_CODES.PACKAGE_CONTEXT_LOAD_FAILED
            : stage === "pricing"
                ? ERROR_CODES.PRICING_CONTEXT_LOAD_FAILED
                : ERROR_CODES.PROMOTION_CONTEXT_LOAD_FAILED;
        throw new PricingQuoteApplicationError(code, `${stage} context load failed.`, {
            causeCode: error.code || "",
            message: error.message
        });
    }
}

function requireProvider(provider, code, label) {
    if (typeof provider !== "function") {
        throw new PricingQuoteApplicationError(code, `${label} provider is required.`);
    }
    return provider;
}

async function resolveIssuedAt(normalized, deps) {
    const provider = requireProvider(deps.getIssuedAt, ERROR_CODES.INVALID_APPLICATION_INPUT, "getIssuedAt");
    const issuedAt = await provider({ owner: normalized.owner, request: normalized.request, trace: normalized.trace });
    if (!issuedAt) {
        throw new PricingQuoteApplicationError(ERROR_CODES.INVALID_APPLICATION_INPUT, "getIssuedAt returned no timestamp.");
    }
    return issuedAt;
}

async function resolveQuoteId(normalized, deps, issuedAt, packageContext) {
    const provider = requireProvider(deps.generateQuoteId, ERROR_CODES.INVALID_APPLICATION_INPUT, "generateQuoteId");
    const quoteId = await provider({
        owner: normalized.owner,
        request: normalized.request,
        idempotencyKey: normalized.idempotencyKey,
        issuedAt,
        packageContext
    });
    if (!quoteId) {
        throw new PricingQuoteApplicationError(ERROR_CODES.INVALID_APPLICATION_INPUT, "generateQuoteId returned no quote id.");
    }
    return quoteId;
}

async function resolveTrace(normalized, deps, issuedAt) {
    if (normalized.trace.traceId || typeof deps.generateTraceId !== "function") {
        return normalized.trace;
    }
    const traceId = await deps.generateTraceId({ owner: normalized.owner, request: normalized.request, issuedAt });
    return { ...normalized.trace, traceId: normalizeString(traceId) };
}

function buildPackageSnapshot(normalized, packageContext) {
    const packageSnapshot = isPlainObject(packageContext.packageSnapshot)
        ? packageContext.packageSnapshot
        : packageContext;
    return {
        packageId: normalizeString(packageSnapshot.packageId || normalized.request.packageIdentity.packageId),
        packageCode: normalizeString(packageSnapshot.packageCode || normalized.request.packageIdentity.packageCode),
        packageRef: normalizeString(packageSnapshot.packageRef || normalized.request.packageIdentity.packageRef),
        packageName: normalizeString(packageSnapshot.packageName),
        gameId: normalizeString(packageSnapshot.gameId),
        gameCode: normalizeString(packageSnapshot.gameCode),
        gameName: normalizeString(packageSnapshot.gameName),
        categoryId: normalizeString(packageSnapshot.categoryId),
        categoryCode: normalizeString(packageSnapshot.categoryCode),
        quantity: normalized.request.quantity
    };
}

function buildPromotionInput(normalized, promotionContext) {
    if (!promotionContext) return null;
    return {
        promotions: Array.isArray(promotionContext.promotions) ? promotionContext.promotions : [],
        campaigns: Array.isArray(promotionContext.campaigns) ? promotionContext.campaigns : [],
        context: isPlainObject(promotionContext.context) ? promotionContext.context : {},
        strategy: isPlainObject(promotionContext.strategy) ? promotionContext.strategy : {}
    };
}

function mapWarnings(quote, persistenceOutcome = "") {
    const warningSet = new Set();
    if (persistenceOutcome === "idempotent" || persistenceOutcome === "reused") {
        warningSet.add(WARNING_CODES.EXISTING_QUOTE_REUSED);
    }
    (quote?.warnings || []).forEach(warning => {
        if (warning?.code === "NO_PROMOTION_APPLIED") warningSet.add(WARNING_CODES.NO_PROMOTION_APPLIED);
        if (warning?.code === "SESSION_BOUND_QUOTE") warningSet.add(WARNING_CODES.SESSION_BOUND_QUOTE);
        if (warning?.code === "NO_PRICE_VERSION_REFERENCE") warningSet.add(WARNING_CODES.PRICE_VERSION_UNAVAILABLE);
    });
    return [...warningSet].sort().map(code => ({ code }));
}

function toPublicQuote(record, options = {}) {
    if (!record) return null;
    const quote = typeof record.toObject === "function"
        ? record.toObject({ depopulate: true, flattenMaps: true, versionKey: false })
        : record;
    const selectedPromotion = quote.promotionSnapshot?.selectedPromotion || null;
    return deepFreeze({
        applicationServiceVersion: APPLICATION_SERVICE_VERSION,
        quoteId: quote.quoteId,
        status: quote.status || quote.lifecycle?.status || "ISSUED",
        package: {
            packageId: quote.packageSnapshot?.packageId || "",
            packageCode: quote.packageSnapshot?.packageCode || "",
            packageRef: quote.packageSnapshot?.packageRef || "",
            packageName: quote.packageSnapshot?.packageName || "",
            gameName: quote.packageSnapshot?.gameName || "",
            quantity: quote.packageSnapshot?.quantity || quote.commercialSnapshot?.quantity || 1
        },
        pricing: {
            originalPrice: quote.commercialSnapshot?.originalPrice || 0,
            discountAmount: quote.commercialSnapshot?.discountAmount || 0,
            quotedUnitPrice: quote.commercialSnapshot?.quotedUnitPrice || 0,
            quotedTotalAmount: quote.commercialSnapshot?.quotedTotalAmount || 0,
            currency: quote.commercialSnapshot?.currency || ""
        },
        promotion: selectedPromotion ? {
            code: selectedPromotion.code || "",
            name: selectedPromotion.name || "",
            promotionType: selectedPromotion.promotionType || ""
        } : null,
        issuedAt: quote.lifecycle?.issuedAt instanceof Date ? quote.lifecycle.issuedAt.toISOString() : quote.lifecycle?.issuedAt,
        expiresAt: quote.lifecycle?.expiresAt instanceof Date ? quote.lifecycle.expiresAt.toISOString() : quote.lifecycle?.expiresAt,
        warnings: mapWarnings(quote, options.persistenceOutcome)
    });
}

function mapPersistenceError(error) {
    if (!(error instanceof PricingQuotePersistenceError)) return null;
    if (error.code === PERSISTENCE_ERROR_CODES.IDEMPOTENCY_CONFLICT) {
        return ERROR_CODES.IDEMPOTENCY_CONFLICT;
    }
    if (error.code === PERSISTENCE_ERROR_CODES.QUOTE_NOT_FOUND) {
        return ERROR_CODES.QUOTE_NOT_FOUND;
    }
    if (error.code === PERSISTENCE_ERROR_CODES.QUOTE_OWNERSHIP_MISMATCH) {
        return ERROR_CODES.QUOTE_OWNERSHIP_MISMATCH;
    }
    return ERROR_CODES.QUOTE_PERSISTENCE_FAILED;
}

async function createAndPersistPricingQuote(input, dependencies = {}) {
    const originalInput = clonePlain(input);
    const normalized = normalizeApplicationInput(input);
    const deps = getDependencies(dependencies);

    try {
        const issuedAt = await resolveIssuedAt(normalized, deps);
        const trace = await resolveTrace(normalized, deps, issuedAt);
        const packageContext = await loadOrUseContext("package", normalized.trustedContext.package, deps.loadPackageContext, {
            packageIdentity: normalized.request.packageIdentity,
            region: normalized.request.region,
            currency: normalized.request.currency,
            owner: normalized.owner
        });
        const pricingContext = await loadOrUseContext("pricing", normalized.trustedContext.pricingInput ? { pricingInput: normalized.trustedContext.pricingInput, versionContext: normalized.trustedContext.versionContext || {} } : normalized.trustedContext.pricing, deps.loadPricingContext, {
            packageContext,
            region: normalized.request.region,
            currency: normalized.request.currency,
            paymentMethodId: normalized.request.paymentMethodId
        });
        const hasSuppliedPromotionContext = Boolean(
            normalized.trustedContext.promotionContext ||
            normalized.trustedContext.promotionCandidates ||
            normalized.trustedContext.campaigns ||
            normalized.trustedContext.promotionContextData ||
            normalized.trustedContext.promotionStrategy
        );
        const suppliedPromotionContext = hasSuppliedPromotionContext
            ? normalized.trustedContext.promotionContext || {
                promotions: normalized.trustedContext.promotionCandidates || [],
                campaigns: normalized.trustedContext.campaigns || [],
                context: normalized.trustedContext.promotionContextData || {},
                strategy: normalized.trustedContext.promotionStrategy || {}
            }
            : null;
        const promotionContext = hasSuppliedPromotionContext || deps.loadPromotionContext
            ? await loadOrUseContext("promotion", suppliedPromotionContext, deps.loadPromotionContext, {
                packageContext,
                owner: normalized.owner,
                region: normalized.request.region,
                currency: normalized.request.currency,
                couponCode: normalized.request.couponCode,
                issuedAt
            })
            : null;
        const quoteId = await resolveQuoteId(normalized, deps, issuedAt, packageContext);
        const packageSnapshot = buildPackageSnapshot(normalized, packageContext);
        const quoteRuntimeInput = {
            quoteId,
            issuedAt,
            validitySeconds: normalized.validitySeconds,
            owner: normalized.owner,
            request: {
                region: normalized.request.region,
                currency: normalized.request.currency,
                package: packageSnapshot,
                paymentMethodId: normalized.request.paymentMethodId,
                couponCode: normalized.request.couponCode
            },
            pricingInput: pricingContext.pricingInput || pricingContext,
            promotionInput: buildPromotionInput(normalized, promotionContext),
            versionContext: pricingContext.versionContext || normalized.trustedContext.versionContext || {},
            trace
        };
        const quote = deps.createPricingQuote(quoteRuntimeInput);
        const persistedQuote = await deps.createQuoteRecord({
            quote,
            idempotencyKey: normalized.idempotencyKey || undefined
        });
        const persistenceOutcome = persistedQuote?.quoteId === quote.quoteId ? (persistedQuote?.createdAt ? "created" : "") : "idempotent";
        const publicQuote = toPublicQuote(persistedQuote, { persistenceOutcome: persistedQuote?.__pricingQuotePersistenceOutcome || persistenceOutcome });
        const result = {
            publicQuote,
            persistedQuote,
            metadata: {
                applicationServiceVersion: APPLICATION_SERVICE_VERSION,
                traceId: publicQuote?.quoteId ? trace.traceId : "",
                quoteId: publicQuote?.quoteId || "",
                issueSource: trace.issueSource,
                ownerType: normalized.owner.userId ? "user" : "session",
                packageIdentity: normalized.request.packageIdentity,
                persistenceOutcome: persistedQuote?.__pricingQuotePersistenceOutcome || persistenceOutcome || "unknown",
                idempotentReuse: (persistedQuote?.__pricingQuotePersistenceOutcome || persistenceOutcome) === "idempotent"
            }
        };
        if (input && typeof input === "object") {
            const after = clonePlain(input);
            if (JSON.stringify(after) !== JSON.stringify(originalInput)) {
                throw new PricingQuoteApplicationError(ERROR_CODES.APPLICATION_ORCHESTRATION_FAILED, "Application service mutated caller input.");
            }
        }
        return Object.freeze({
            publicQuote: deepFreeze(result.publicQuote),
            persistedQuote: result.persistedQuote,
            metadata: deepFreeze(result.metadata)
        });
    } catch (error) {
        if (error instanceof PricingQuoteApplicationError) throw error;
        const persistenceCode = mapPersistenceError(error);
        if (persistenceCode) {
            throw new PricingQuoteApplicationError(persistenceCode, "Quote persistence failed.", {
                causeCode: error.code,
                details: error.details || {}
            });
        }
        if (error?.name === "PricingQuoteRuntimeError") {
            throw new PricingQuoteApplicationError(ERROR_CODES.QUOTE_RUNTIME_FAILED, "Quote runtime failed.", {
                causeCode: error.code,
                details: error.details || {}
            });
        }
        throw new PricingQuoteApplicationError(ERROR_CODES.APPLICATION_ORCHESTRATION_FAILED, "Quote orchestration failed.", {
            causeCode: error.code || "",
            message: error.message
        });
    }
}

async function getOwnedPricingQuote(input, dependencies = {}) {
    const source = assertPlainObject(input, "input");
    const owner = normalizeOwner(source.owner || {});
    const quoteId = normalizeString(source.quoteId);
    if (!quoteId) {
        throw new PricingQuoteApplicationError(ERROR_CODES.INVALID_APPLICATION_INPUT, "quoteId is required.", { field: "quoteId" });
    }
    const deps = getDependencies(dependencies);
    try {
        const persistedQuote = await deps.findOwnedQuote({ quoteId, ...owner });
        if (!persistedQuote) return null;
        return toPublicQuote(persistedQuote);
    } catch (error) {
        const persistenceCode = mapPersistenceError(error);
        if (persistenceCode) {
            throw new PricingQuoteApplicationError(persistenceCode, "Owned quote lookup failed.", {
                causeCode: error.code,
                details: error.details || {}
            });
        }
        throw error;
    }
}

module.exports = Object.freeze({
    createAndPersistPricingQuote,
    getOwnedPricingQuote,
    toPublicQuote,
    PricingQuoteApplicationError,
    ERROR_CODES,
    WARNING_CODES,
    APPLICATION_SERVICE_VERSION
});
