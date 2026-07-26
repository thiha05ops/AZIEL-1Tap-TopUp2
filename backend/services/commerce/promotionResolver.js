const {
    CURRENCY,
    REGION,
    PROMOTION_RULE_STATUS,
    PROMOTION_TYPE,
    CAMPAIGN_STATUS,
    ELIGIBILITY_OPERATOR,
    ELIGIBILITY_COMPARATOR
} = require("../../constants/commerce");

const RESOLVER_VERSION = "2.3.1";
const SPECIFICATION_VERSION = "2.3.0";
const MAX_SAFE_AMOUNT = 1_000_000_000_000;
const INTERNAL_PRECISION = 6;
const MAX_ELIGIBILITY_DEPTH = 5;

const ERROR_CODES = Object.freeze({
    INVALID_INPUT: "INVALID_INPUT",
    INVALID_ORIGINAL_PRICE: "INVALID_ORIGINAL_PRICE",
    UNSUPPORTED_CURRENCY: "UNSUPPORTED_CURRENCY",
    MISSING_EVALUATION_TIME: "MISSING_EVALUATION_TIME",
    INVALID_EVALUATION_TIME: "INVALID_EVALUATION_TIME",
    INVALID_PROMOTION_CANDIDATE: "INVALID_PROMOTION_CANDIDATE",
    INVALID_CAMPAIGN_CANDIDATE: "INVALID_CAMPAIGN_CANDIDATE",
    INVALID_ELIGIBILITY_TREE: "INVALID_ELIGIBILITY_TREE",
    ELIGIBILITY_TREE_DEPTH_EXCEEDED: "ELIGIBILITY_TREE_DEPTH_EXCEEDED",
    INVALID_STRATEGY: "INVALID_STRATEGY",
    RESOLUTION_OVERFLOW: "RESOLUTION_OVERFLOW"
});

const REASON_CODES = Object.freeze({
    PROMOTION_DISABLED: "PROMOTION_DISABLED",
    PROMOTION_NOT_ACTIVE: "PROMOTION_NOT_ACTIVE",
    PROMOTION_NOT_STARTED: "PROMOTION_NOT_STARTED",
    PROMOTION_EXPIRED: "PROMOTION_EXPIRED",
    PROMOTION_ARCHIVED: "PROMOTION_ARCHIVED",
    UNSUPPORTED_PROMOTION_TYPE: "UNSUPPORTED_PROMOTION_TYPE",
    PRICE_OVERRIDE_DISABLED: "PRICE_OVERRIDE_DISABLED",
    REGION_NOT_ELIGIBLE: "REGION_NOT_ELIGIBLE",
    CURRENCY_NOT_ELIGIBLE: "CURRENCY_NOT_ELIGIBLE",
    PACKAGE_NOT_ELIGIBLE: "PACKAGE_NOT_ELIGIBLE",
    GAME_NOT_ELIGIBLE: "GAME_NOT_ELIGIBLE",
    CATEGORY_NOT_ELIGIBLE: "CATEGORY_NOT_ELIGIBLE",
    USER_TIER_NOT_ELIGIBLE: "USER_TIER_NOT_ELIGIBLE",
    FIRST_PURCHASE_REQUIRED: "FIRST_PURCHASE_REQUIRED",
    MINIMUM_SPEND_NOT_MET: "MINIMUM_SPEND_NOT_MET",
    MAXIMUM_SPEND_EXCEEDED: "MAXIMUM_SPEND_EXCEEDED",
    COUPON_REQUIRED: "COUPON_REQUIRED",
    COUPON_MISMATCH: "COUPON_MISMATCH",
    TOTAL_USAGE_LIMIT_REACHED: "TOTAL_USAGE_LIMIT_REACHED",
    USER_USAGE_LIMIT_REACHED: "USER_USAGE_LIMIT_REACHED",
    CAMPAIGN_MISSING: "CAMPAIGN_MISSING",
    CAMPAIGN_NOT_ACTIVE: "CAMPAIGN_NOT_ACTIVE",
    CAMPAIGN_NOT_STARTED: "CAMPAIGN_NOT_STARTED",
    CAMPAIGN_EXPIRED: "CAMPAIGN_EXPIRED",
    CAMPAIGN_TARGET_MISMATCH: "CAMPAIGN_TARGET_MISMATCH",
    ELIGIBILITY_TREE_FAILED: "ELIGIBILITY_TREE_FAILED",
    INVALID_PROMOTION_CONFIGURATION: "INVALID_PROMOTION_CONFIGURATION",
    ELIGIBLE: "ELIGIBLE"
});

const WARNING_CODES = Object.freeze({
    NO_ELIGIBLE_PROMOTION: "NO_ELIGIBLE_PROMOTION",
    MULTIPLE_ELIGIBLE_PROMOTIONS: "MULTIPLE_ELIGIBLE_PROMOTIONS",
    PRICE_OVERRIDE_SELECTED: "PRICE_OVERRIDE_SELECTED",
    PRICE_CLAMPED_TO_ZERO: "PRICE_CLAMPED_TO_ZERO",
    CAMPAIGN_METADATA_UNUSED: "CAMPAIGN_METADATA_UNUSED",
    USAGE_FACTS_MISSING: "USAGE_FACTS_MISSING",
    UNSUPPORTED_PROMOTIONS_IGNORED: "UNSUPPORTED_PROMOTIONS_IGNORED"
});

const PRICE_AFFECTING_TYPES = Object.freeze({
    PERCENTAGE_DISCOUNT: "PERCENTAGE_DISCOUNT",
    FIXED_DISCOUNT: "FIXED_DISCOUNT",
    PRICE_OVERRIDE: "PRICE_OVERRIDE",
    OVERRIDE_PRICE: "PRICE_OVERRIDE"
});

const DEFERRED_TYPES = Object.freeze(new Set([
    "FREE_BONUS",
    "BUNDLE",
    "WALLET_CREDIT",
    "FREE_ITEM",
    "NON_PRICE_REWARD"
]));

const SCOPE_RANK = Object.freeze({
    PACKAGE: 50,
    CATEGORY: 40,
    GAME: 30,
    REGION: 20,
    GLOBAL: 10
});

class PromotionResolverError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "PromotionResolverError";
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

function freeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }
    Object.freeze(value);
    Object.keys(value).forEach(key => freeze(value[key]));
    return value;
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeAmount(value, field = "amount") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
        throw new PromotionResolverError(ERROR_CODES.RESOLUTION_OVERFLOW, "Promotion amount must be finite.", { field });
    }
    if (Math.abs(numeric) > MAX_SAFE_AMOUNT) {
        throw new PromotionResolverError(ERROR_CODES.RESOLUTION_OVERFLOW, "Promotion amount exceeds supported range.", { field });
    }
    const normalized = Number(numeric.toFixed(INTERNAL_PRECISION));
    return Object.is(normalized, -0) ? 0 : normalized;
}

function assertFiniteNumber(value, code, field, { min = 0, max = MAX_SAFE_AMOUNT } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < min || numeric > max) {
        throw new PromotionResolverError(code, "Invalid numeric value.", { field });
    }
    return numeric;
}

function normalizeUpper(value) {
    return String(value || "").trim().toUpperCase();
}

function normalizeId(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function normalizeDate(value, field, code = ERROR_CODES.INVALID_PROMOTION_CANDIDATE) {
    if (!value) return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new PromotionResolverError(code, "Invalid date value.", { field });
    }
    return date;
}

function normalizeEvaluationTime(value) {
    if (!value) {
        throw new PromotionResolverError(ERROR_CODES.MISSING_EVALUATION_TIME, "context.evaluationTime is required.");
    }
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_EVALUATION_TIME, "context.evaluationTime must be a valid date.");
    }
    return date;
}

function asArray(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function uniqueNormalized(values) {
    return [...new Set(asArray(values).map(normalizeUpper).filter(Boolean))];
}

function identityMatches(actualValues, identity = {}) {
    const expected = [
        identity.packageId,
        identity.packageCode,
        identity.packageRef,
        identity.id,
        identity.code,
        identity.ref
    ].map(normalizeUpper).filter(Boolean);
    if (!expected.length) return false;
    return actualValues.some(actual => expected.includes(normalizeUpper(actual)));
}

function buildContext(inputContext, evaluationTime, currency, originalPrice) {
    const context = isPlainObject(inputContext) ? { ...inputContext } : {};
    return {
        ...context,
        evaluationTime,
        currency: normalizeUpper(context.currency || currency),
        region: normalizeUpper(context.region),
        packageId: normalizeUpper(context.packageId),
        packageCode: normalizeUpper(context.packageCode),
        packageRef: normalizeId(context.packageRef),
        gameId: normalizeId(context.gameId),
        categoryId: normalizeId(context.categoryId),
        userId: normalizeId(context.userId),
        userTier: normalizeUpper(context.userTier || context.tier),
        isFirstPurchase: context.isFirstPurchase === true,
        orderSubtotal: Number.isFinite(Number(context.orderSubtotal)) ? Number(context.orderSubtotal) : originalPrice,
        originalPrice,
        couponCode: normalizeUpper(context.couponCode),
        usage: isPlainObject(context.usage) ? context.usage : {}
    };
}

function scopeSpecificity(candidate) {
    const ranks = [];
    candidate.scopes.forEach(scope => ranks.push(SCOPE_RANK[scope.scopeType] || 0));
    if (candidate.targeting.packages.length) ranks.push(SCOPE_RANK.PACKAGE);
    if (candidate.targeting.categoryIds.length) ranks.push(SCOPE_RANK.CATEGORY);
    if (candidate.targeting.gameIds.length) ranks.push(SCOPE_RANK.GAME);
    if (candidate.targeting.regions.length || candidate.region) ranks.push(SCOPE_RANK.REGION);
    return Math.max(SCOPE_RANK.GLOBAL, ...ranks);
}

function normalizeScopes(promo) {
    return asArray(promo.scopes).filter(isPlainObject).map(scope => ({
        scopeType: normalizeUpper(scope.scopeType || scope.type),
        scopeReference: normalizeUpper(scope.scopeReference || scope.reference || scope.value)
    })).filter(scope => scope.scopeType);
}

function normalizePackageIdentities(values) {
    return asArray(values).map(value => {
        if (isPlainObject(value)) {
            return {
                packageId: normalizeUpper(value.packageId || value.id),
                packageCode: normalizeUpper(value.packageCode || value.code),
                packageRef: normalizeId(value.packageRef || value.ref)
            };
        }
        return {
            packageId: normalizeUpper(value),
            packageCode: "",
            packageRef: ""
        };
    }).filter(identity => identity.packageId || identity.packageCode || identity.packageRef);
}

function normalizeTargeting(promo) {
    const targeting = isPlainObject(promo.targeting) ? promo.targeting : {};
    return {
        regions: uniqueNormalized(targeting.regions || targeting.region || promo.regions || promo.region),
        currencies: uniqueNormalized(targeting.currencies || targeting.currency || promo.currency),
        packages: normalizePackageIdentities(targeting.packages || promo.eligiblePackages),
        excludedPackages: normalizePackageIdentities(targeting.excludedPackages || promo.excludedPackages),
        gameIds: asArray(targeting.gameIds || targeting.games || promo.eligibleGameIds).map(normalizeId).filter(Boolean),
        excludedGameIds: asArray(targeting.excludedGameIds || targeting.excludedGames || promo.excludedGameIds).map(normalizeId).filter(Boolean),
        categoryIds: asArray(targeting.categoryIds || targeting.categories || promo.eligibleCategoryIds).map(normalizeId).filter(Boolean),
        userTiers: uniqueNormalized(targeting.userTiers || targeting.tiers || promo.eligibleUserSegments)
    };
}

function normalizePromotionType(rawType) {
    const type = normalizeUpper(rawType);
    if (PRICE_AFFECTING_TYPES[type]) return PRICE_AFFECTING_TYPES[type];
    return type;
}

function normalizePromotion(promo, index) {
    if (!isPlainObject(promo)) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_PROMOTION_CANDIDATE, "Promotion candidate must be an object.", { index });
    }
    const promotionType = normalizePromotionType(promo.promotionType || promo.type);
    const knownTypes = new Set([...PROMOTION_TYPE, "PRICE_OVERRIDE", "FREE_BONUS", "BUNDLE", "WALLET_CREDIT"]);
    if (!knownTypes.has(normalizeUpper(promo.promotionType || promo.type || ""))) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_PROMOTION_CANDIDATE, "Unsupported promotion type shape.", { index });
    }
    const status = normalizeUpper(promo.status || "ACTIVE");
    if (!PROMOTION_RULE_STATUS.includes(status)) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_PROMOTION_CANDIDATE, "Unsupported promotion status.", { index, status });
    }

    const candidate = {
        id: normalizeId(promo.id || promo._id || promo.promotionId || promo.code || `promotion-${index}`),
        code: normalizeUpper(promo.code || promo.promotionCode || `PROMOTION-${index}`),
        name: String(promo.name || promo.title || promo.code || `Promotion ${index + 1}`).trim(),
        enabled: promo.enabled !== false,
        status,
        promotionType,
        rawPromotionType: normalizeUpper(promo.promotionType || promo.type),
        discountValue: Number(promo.discountValue ?? promo.value ?? 0),
        maximumDiscountAmount: Number(promo.maximumDiscountAmount ?? promo.maxDiscountAmount ?? 0),
        minimumOrderAmount: Number(promo.minimumOrderAmount ?? promo.minimumSpend ?? 0),
        maximumOrderAmount: promo.maximumOrderAmount ?? promo.maximumSpend,
        overridePrice: Number(promo.overridePrice ?? promo.priceOverride ?? promo.discountValue ?? 0),
        priority: Number.isFinite(Number(promo.priority)) ? Number(promo.priority) : 0,
        stackable: promo.stackable === true,
        exclusive: promo.exclusive === true,
        exclusiveGroupKey: normalizeUpper(promo.exclusiveGroupKey || promo.mutuallyExclusiveGroup || ""),
        usageLimitTotal: Number(promo.usageLimitTotal ?? promo.totalUsageLimit ?? 0),
        usageLimitPerUser: Number(promo.usageLimitPerUser ?? promo.perUserUsageLimit ?? 0),
        effectiveFrom: normalizeDate(promo.effectiveFrom || promo.startAt, `promotions.${index}.effectiveFrom`),
        effectiveUntil: normalizeDate(promo.effectiveUntil || promo.endAt, `promotions.${index}.effectiveUntil`),
        requiresCoupon: promo.requiresCoupon === true || Boolean(promo.couponCode),
        couponCode: normalizeUpper(promo.couponCode),
        firstPurchaseOnly: promo.firstPurchaseOnly === true || promo.requiresFirstPurchase === true,
        campaignId: normalizeId(promo.campaignId || promo.campaignRef || promo.campaignCode),
        campaignIds: asArray(promo.campaignIds || promo.campaignRefs).map(normalizeId).filter(Boolean),
        eligibility: promo.eligibilityTree || promo.eligibility || null,
        scopes: normalizeScopes(promo),
        targeting: normalizeTargeting(promo),
        createdAt: normalizeDate(promo.createdAt, `promotions.${index}.createdAt`),
        originalIndex: index
    };

    if (!candidate.id && !candidate.code) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_PROMOTION_CANDIDATE, "Promotion candidate needs a stable id or code.", { index });
    }

    return candidate;
}

function normalizeCampaign(campaign, index) {
    if (!isPlainObject(campaign)) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_CAMPAIGN_CANDIDATE, "Campaign candidate must be an object.", { index });
    }
    const status = normalizeUpper(campaign.status || "ACTIVE");
    if (!CAMPAIGN_STATUS.includes(status)) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_CAMPAIGN_CANDIDATE, "Unsupported campaign status.", { index, status });
    }
    return {
        id: normalizeId(campaign.id || campaign._id || campaign.campaignId || campaign.code),
        code: normalizeUpper(campaign.code || campaign.campaignCode),
        status,
        enabled: campaign.enabled !== false,
        startAt: normalizeDate(campaign.startAt || campaign.effectiveFrom, `campaigns.${index}.startAt`, ERROR_CODES.INVALID_CAMPAIGN_CANDIDATE),
        endAt: normalizeDate(campaign.endAt || campaign.effectiveUntil, `campaigns.${index}.endAt`, ERROR_CODES.INVALID_CAMPAIGN_CANDIDATE),
        promotionRuleIds: asArray(campaign.promotionRuleIds || campaign.promotionIds).map(normalizeId).filter(Boolean),
        targetRegions: uniqueNormalized(campaign.targetRegions || campaign.regions),
        targetGameIds: asArray(campaign.targetGameIds || campaign.gameIds).map(normalizeId).filter(Boolean),
        targetCategoryIds: asArray(campaign.targetCategoryIds || campaign.categoryIds).map(normalizeId).filter(Boolean),
        targetTierIds: uniqueNormalized(campaign.targetTierIds || campaign.userTiers),
        targetPackages: normalizePackageIdentities(campaign.targetPackages || campaign.packages),
        excludedPackages: normalizePackageIdentities(campaign.excludedPackages),
        targetUserSegments: uniqueNormalized(campaign.targetUserSegments || campaign.userSegments),
        metadata: isPlainObject(campaign.metadata) ? { ...campaign.metadata } : {},
        originalIndex: index
    };
}

function buildCampaignIndex(campaigns) {
    const index = new Map();
    campaigns.forEach(campaign => {
        [campaign.id, campaign.code].filter(Boolean).forEach(key => index.set(key, campaign));
        campaign.promotionRuleIds.forEach(key => index.set(key, campaign));
    });
    return index;
}

function sameValue(actual, expected) {
    if (typeof actual === "string" || typeof expected === "string") {
        return normalizeUpper(actual) === normalizeUpper(expected);
    }
    return actual === expected;
}

function listIncludes(list, actual) {
    return asArray(list).some(expected => sameValue(actual, expected));
}

function getFact(context, field) {
    const path = String(field || "").trim();
    if (!path) return undefined;
    const aliases = {
        tier: "userTier",
        firstPurchase: "isFirstPurchase",
        subtotal: "orderSubtotal",
        package: "packageId",
        game: "gameId",
        category: "categoryId"
    };
    const resolvedPath = aliases[path] || path;
    return resolvedPath.split(".").reduce((current, key) => {
        if (current === undefined || current === null) return undefined;
        return current[key];
    }, context);
}

function compareFact(actual, condition) {
    const comparator = normalizeUpper(condition.comparator);
    const value = condition.value;
    const values = condition.values !== undefined ? condition.values : value;
    switch (comparator) {
        case "EQUALS":
            return sameValue(actual, value);
        case "NOT_EQUALS":
            return !sameValue(actual, value);
        case "IN":
            return listIncludes(values, actual);
        case "NOT_IN":
            return !listIncludes(values, actual);
        case "GREATER_THAN":
            return Number(actual) > Number(value);
        case "GREATER_THAN_OR_EQUAL":
            return Number(actual) >= Number(value);
        case "LESS_THAN":
            return Number(actual) < Number(value);
        case "LESS_THAN_OR_EQUAL":
            return Number(actual) <= Number(value);
        case "EXISTS":
            return actual !== undefined && actual !== null && actual !== "";
        case "NOT_EXISTS":
            return actual === undefined || actual === null || actual === "";
        case "BETWEEN": {
            const [min, max] = asArray(values);
            return Number(actual) >= Number(min) && Number(actual) <= Number(max);
        }
        case "CONTAINS":
            return Array.isArray(actual) ? actual.some(item => sameValue(item, value)) : String(actual || "").includes(String(value || ""));
        default:
            throw new PromotionResolverError(ERROR_CODES.INVALID_ELIGIBILITY_TREE, "Unsupported eligibility comparator.", { comparator });
    }
}

function validateEligibilityNode(node, depth = 1) {
    if (depth > MAX_ELIGIBILITY_DEPTH) {
        throw new PromotionResolverError(ERROR_CODES.ELIGIBILITY_TREE_DEPTH_EXCEEDED, "Eligibility tree nesting is too deep.");
    }
    if (!isPlainObject(node)) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_ELIGIBILITY_TREE, "Eligibility node must be an object.");
    }
    const operator = node.operator === undefined ? "" : normalizeUpper(node.operator);
    const comparator = node.comparator === undefined ? "" : normalizeUpper(node.comparator);
    if (operator) {
        if (!ELIGIBILITY_OPERATOR.includes(operator)) {
            throw new PromotionResolverError(ERROR_CODES.INVALID_ELIGIBILITY_TREE, "Unsupported eligibility operator.", { operator });
        }
        const conditions = asArray(node.conditions);
        if (operator === "NOT" && conditions.length !== 1) {
            throw new PromotionResolverError(ERROR_CODES.INVALID_ELIGIBILITY_TREE, "NOT eligibility operator requires exactly one child.");
        }
        conditions.forEach(condition => validateEligibilityNode(condition, depth + 1));
        return;
    }
    if (!comparator || !ELIGIBILITY_COMPARATOR.includes(comparator)) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_ELIGIBILITY_TREE, "Eligibility leaf requires a supported comparator.", { comparator });
    }
    if (!node.field && comparator !== "EXISTS" && comparator !== "NOT_EXISTS") {
        throw new PromotionResolverError(ERROR_CODES.INVALID_ELIGIBILITY_TREE, "Eligibility leaf requires a field.");
    }
}

function evaluateEligibilityNode(node, context) {
    const operator = node.operator === undefined ? "" : normalizeUpper(node.operator);
    if (operator) {
        const conditions = asArray(node.conditions);
        if (operator === "ALL") return conditions.every(condition => evaluateEligibilityNode(condition, context));
        if (operator === "ANY") return conditions.some(condition => evaluateEligibilityNode(condition, context));
        return !evaluateEligibilityNode(conditions[0], context);
    }
    return compareFact(getFact(context, node.field), node);
}

function scopeApplies(candidate, context) {
    if (!candidate.scopes.length) return true;
    return candidate.scopes.some(scope => {
        switch (scope.scopeType) {
            case "GLOBAL":
                return true;
            case "REGION":
                return normalizeUpper(context.region) === scope.scopeReference;
            case "GAME":
                return normalizeId(context.gameId) === scope.scopeReference || normalizeUpper(context.gameId) === scope.scopeReference;
            case "CATEGORY":
                return normalizeId(context.categoryId) === scope.scopeReference || normalizeUpper(context.categoryId) === scope.scopeReference;
            case "PACKAGE":
                return [context.packageId, context.packageCode, context.packageRef].some(value => normalizeUpper(value) === scope.scopeReference);
            case "TIER":
            case "USER_SEGMENT":
                return normalizeUpper(context.userTier) === scope.scopeReference;
            default:
                return false;
        }
    });
}

function campaignMatchesTargeting(campaign, context) {
    const packageValues = [context.packageId, context.packageCode, context.packageRef].filter(Boolean);
    if (campaign.targetRegions.length && !campaign.targetRegions.includes(normalizeUpper(context.region))) return false;
    if (campaign.targetGameIds.length && !campaign.targetGameIds.includes(normalizeId(context.gameId))) return false;
    if (campaign.targetCategoryIds.length && !campaign.targetCategoryIds.includes(normalizeId(context.categoryId))) return false;
    if (campaign.targetTierIds.length && !campaign.targetTierIds.includes(normalizeUpper(context.userTier))) return false;
    if (campaign.targetPackages.length && !campaign.targetPackages.some(identity => identityMatches(packageValues, identity))) return false;
    if (campaign.excludedPackages.some(identity => identityMatches(packageValues, identity))) return false;
    if (campaign.targetUserSegments.length && !campaign.targetUserSegments.includes(normalizeUpper(context.userTier))) return false;
    return true;
}

function checkCampaign(candidate, context, campaignIndex, warnings) {
    const campaignKeys = [candidate.campaignId, ...candidate.campaignIds].filter(Boolean);
    if (!campaignKeys.length) return { campaign: null, reason: null };
    const campaign = campaignKeys.map(key => campaignIndex.get(key) || campaignIndex.get(normalizeUpper(key))).find(Boolean);
    if (!campaign) return { campaign: null, reason: REASON_CODES.CAMPAIGN_MISSING };
    if (Object.keys(campaign.metadata || {}).length) {
        warnings.add(WARNING_CODES.CAMPAIGN_METADATA_UNUSED);
    }
    if (campaign.enabled === false || campaign.status === "DRAFT" || campaign.status === "PAUSED" || campaign.status === "CANCELLED" || campaign.status === "ARCHIVED") {
        return { campaign, reason: REASON_CODES.CAMPAIGN_NOT_ACTIVE };
    }
    if (campaign.status === "SCHEDULED" || (campaign.startAt && context.evaluationTime < campaign.startAt)) {
        return { campaign, reason: REASON_CODES.CAMPAIGN_NOT_STARTED };
    }
    if (campaign.status === "ENDED" || (campaign.endAt && context.evaluationTime > campaign.endAt)) {
        return { campaign, reason: REASON_CODES.CAMPAIGN_EXPIRED };
    }
    if (!campaignMatchesTargeting(campaign, context)) {
        return { campaign, reason: REASON_CODES.CAMPAIGN_TARGET_MISMATCH };
    }
    return { campaign, reason: null };
}

function checkUsage(candidate, context, warnings) {
    const usage = context.usage || {};
    const totalLimit = Number(candidate.usageLimitTotal || 0);
    const userLimit = Number(candidate.usageLimitPerUser || 0);
    const idKeys = [candidate.id, candidate.code].filter(Boolean);
    if (totalLimit > 0) {
        if (!isPlainObject(usage.promotionUsageTotal)) {
            warnings.add(WARNING_CODES.USAGE_FACTS_MISSING);
            return REASON_CODES.INVALID_PROMOTION_CONFIGURATION;
        }
        const used = idKeys.reduce((max, key) => Math.max(max, Number(usage.promotionUsageTotal[key] || 0)), 0);
        if (used >= totalLimit) return REASON_CODES.TOTAL_USAGE_LIMIT_REACHED;
    }
    if (userLimit > 0) {
        if (!isPlainObject(usage.userPromotionUsage)) {
            warnings.add(WARNING_CODES.USAGE_FACTS_MISSING);
            return REASON_CODES.INVALID_PROMOTION_CONFIGURATION;
        }
        const used = idKeys.reduce((max, key) => Math.max(max, Number(usage.userPromotionUsage[key] || 0)), 0);
        if (used >= userLimit) return REASON_CODES.USER_USAGE_LIMIT_REACHED;
    }
    return null;
}

function reject(candidate, reasonCode, details = {}) {
    return freeze({
        id: candidate.id,
        code: candidate.code,
        name: candidate.name,
        promotionType: candidate.promotionType,
        reasonCode,
        reasons: [reasonCode],
        details
    });
}

function publicCandidate(candidate, extra = {}) {
    return freeze({
        id: candidate.id,
        code: candidate.code,
        name: candidate.name,
        promotionType: candidate.promotionType,
        priority: candidate.priority,
        scopeSpecificity: candidate.scopeSpecificity,
        stackable: candidate.stackable,
        exclusive: candidate.exclusive,
        exclusiveGroupKey: candidate.exclusiveGroupKey,
        campaignId: candidate.resolvedCampaign?.id || candidate.resolvedCampaign?.code || null,
        ...extra
    });
}

function calculateBenefit(candidate, originalPrice, strategy, warnings) {
    if (candidate.promotionType === "PERCENTAGE_DISCOUNT") {
        const percent = assertFiniteNumber(candidate.discountValue, ERROR_CODES.INVALID_PROMOTION_CANDIDATE, `${candidate.code}.discountValue`, { min: 0, max: 100 });
        let discountAmount = normalizeAmount(originalPrice * (percent / 100), "discountAmount");
        if (candidate.maximumDiscountAmount > 0) {
            discountAmount = Math.min(discountAmount, normalizeAmount(candidate.maximumDiscountAmount, "maximumDiscountAmount"));
        }
        const candidateFinalPrice = normalizeAmount(Math.max(0, originalPrice - discountAmount), "candidateFinalPrice");
        return { discountAmount, candidateFinalPrice, effectiveDiscountPercent: originalPrice > 0 ? normalizeAmount((discountAmount / originalPrice) * 100) : 0 };
    }
    if (candidate.promotionType === "FIXED_DISCOUNT") {
        const rawDiscount = assertFiniteNumber(candidate.discountValue, ERROR_CODES.INVALID_PROMOTION_CANDIDATE, `${candidate.code}.discountValue`);
        const discountAmount = normalizeAmount(Math.min(originalPrice, rawDiscount), "discountAmount");
        if (rawDiscount > originalPrice) {
            warnings.add(WARNING_CODES.PRICE_CLAMPED_TO_ZERO);
        }
        const candidateFinalPrice = normalizeAmount(Math.max(0, originalPrice - discountAmount), "candidateFinalPrice");
        return { discountAmount, candidateFinalPrice, effectiveDiscountPercent: originalPrice > 0 ? normalizeAmount((discountAmount / originalPrice) * 100) : 0 };
    }
    if (candidate.promotionType === "PRICE_OVERRIDE") {
        if (strategy.allowPriceOverride !== true) {
            return { rejectedReason: REASON_CODES.PRICE_OVERRIDE_DISABLED };
        }
        const candidateFinalPrice = normalizeAmount(assertFiniteNumber(candidate.overridePrice, ERROR_CODES.INVALID_PROMOTION_CANDIDATE, `${candidate.code}.overridePrice`), "candidateFinalPrice");
        const discountAmount = normalizeAmount(Math.max(0, originalPrice - candidateFinalPrice), "discountAmount");
        warnings.add(WARNING_CODES.PRICE_OVERRIDE_SELECTED);
        return { discountAmount, candidateFinalPrice, effectiveDiscountPercent: originalPrice > 0 ? normalizeAmount((discountAmount / originalPrice) * 100) : 0 };
    }
    return { rejectedReason: REASON_CODES.UNSUPPORTED_PROMOTION_TYPE };
}

function eligibilityCheck(candidate, context, campaignIndex, warnings) {
    const packageValues = [context.packageId, context.packageCode, context.packageRef].filter(Boolean);
    if (!candidate.enabled) return REASON_CODES.PROMOTION_DISABLED;
    if (candidate.status === "DRAFT" || candidate.status === "PAUSED") return REASON_CODES.PROMOTION_NOT_ACTIVE;
    if (candidate.status === "SCHEDULED") return REASON_CODES.PROMOTION_NOT_STARTED;
    if (candidate.status === "ENDED") return REASON_CODES.PROMOTION_EXPIRED;
    if (candidate.status === "ARCHIVED") return REASON_CODES.PROMOTION_ARCHIVED;
    if (candidate.effectiveFrom && context.evaluationTime < candidate.effectiveFrom) return REASON_CODES.PROMOTION_NOT_STARTED;
    if (candidate.effectiveUntil && context.evaluationTime > candidate.effectiveUntil) return REASON_CODES.PROMOTION_EXPIRED;
    if (DEFERRED_TYPES.has(candidate.promotionType) || !PRICE_AFFECTING_TYPES[candidate.promotionType]) {
        warnings.add(WARNING_CODES.UNSUPPORTED_PROMOTIONS_IGNORED);
        return REASON_CODES.UNSUPPORTED_PROMOTION_TYPE;
    }
    if (!scopeApplies(candidate, context)) return REASON_CODES.REGION_NOT_ELIGIBLE;
    if (candidate.targeting.regions.length && !candidate.targeting.regions.includes(normalizeUpper(context.region))) return REASON_CODES.REGION_NOT_ELIGIBLE;
    if (candidate.targeting.currencies.length && !candidate.targeting.currencies.includes(normalizeUpper(context.currency))) return REASON_CODES.CURRENCY_NOT_ELIGIBLE;
    if (candidate.targeting.packages.length && !candidate.targeting.packages.some(identity => identityMatches(packageValues, identity))) return REASON_CODES.PACKAGE_NOT_ELIGIBLE;
    if (candidate.targeting.excludedPackages.some(identity => identityMatches(packageValues, identity))) return REASON_CODES.PACKAGE_NOT_ELIGIBLE;
    if (candidate.targeting.gameIds.length && !candidate.targeting.gameIds.includes(normalizeId(context.gameId))) return REASON_CODES.GAME_NOT_ELIGIBLE;
    if (candidate.targeting.excludedGameIds.includes(normalizeId(context.gameId))) return REASON_CODES.GAME_NOT_ELIGIBLE;
    if (candidate.targeting.categoryIds.length && !candidate.targeting.categoryIds.includes(normalizeId(context.categoryId))) return REASON_CODES.CATEGORY_NOT_ELIGIBLE;
    if (candidate.targeting.userTiers.length && !candidate.targeting.userTiers.includes(normalizeUpper(context.userTier))) return REASON_CODES.USER_TIER_NOT_ELIGIBLE;
    if (candidate.firstPurchaseOnly && context.isFirstPurchase !== true) return REASON_CODES.FIRST_PURCHASE_REQUIRED;
    if (candidate.minimumOrderAmount > 0 && context.orderSubtotal < candidate.minimumOrderAmount) return REASON_CODES.MINIMUM_SPEND_NOT_MET;
    if (candidate.maximumOrderAmount !== undefined && candidate.maximumOrderAmount !== null && candidate.maximumOrderAmount !== "") {
        const maximumOrderAmount = Number(candidate.maximumOrderAmount);
        if (Number.isFinite(maximumOrderAmount) && maximumOrderAmount > 0 && context.orderSubtotal > maximumOrderAmount) return REASON_CODES.MAXIMUM_SPEND_EXCEEDED;
    }
    if (candidate.requiresCoupon && !context.couponCode) return REASON_CODES.COUPON_REQUIRED;
    if (candidate.requiresCoupon && candidate.couponCode && context.couponCode !== candidate.couponCode) return REASON_CODES.COUPON_MISMATCH;

    const usageReason = checkUsage(candidate, context, warnings);
    if (usageReason) return usageReason;

    const campaignResult = checkCampaign(candidate, context, campaignIndex, warnings);
    if (campaignResult.reason) return campaignResult.reason;
    candidate.resolvedCampaign = campaignResult.campaign;

    if (candidate.eligibility) {
        validateEligibilityNode(candidate.eligibility);
        if (!evaluateEligibilityNode(candidate.eligibility, context)) return REASON_CODES.ELIGIBILITY_TREE_FAILED;
    }
    return null;
}

function sortEligiblePromotions(promotions) {
    return [...promotions].sort((a, b) => {
        const priceDiff = a.candidateFinalPrice - b.candidateFinalPrice;
        if (priceDiff) return priceDiff;
        const scopeDiff = b.scopeSpecificity - a.scopeSpecificity;
        if (scopeDiff) return scopeDiff;
        const priorityDiff = b.priority - a.priority;
        if (priorityDiff) return priorityDiff;
        const aTime = a.createdAt ? a.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.createdAt ? b.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
        if (aTime !== bTime) return aTime - bTime;
        return String(a.code).localeCompare(String(b.code)) || String(a.id).localeCompare(String(b.id)) || a.originalIndex - b.originalIndex;
    });
}

function normalizeStrategy(strategy = {}) {
    if (!isPlainObject(strategy)) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_STRATEGY, "strategy must be an object.");
    }
    const mode = normalizeUpper(strategy.mode || "BEST_PRICE");
    if (mode !== "BEST_PRICE") {
        throw new PromotionResolverError(ERROR_CODES.INVALID_STRATEGY, "Unsupported promotion resolution strategy.", { mode });
    }
    return {
        mode,
        allowPriceOverride: strategy.allowPriceOverride === true
    };
}

function validateInput(input) {
    if (!isPlainObject(input)) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_INPUT, "Promotion resolver input must be an object.");
    }
    const originalPrice = assertFiniteNumber(input.originalPrice, ERROR_CODES.INVALID_ORIGINAL_PRICE, "originalPrice");
    const currency = normalizeUpper(input.currency);
    if (!CURRENCY.includes(currency)) {
        throw new PromotionResolverError(ERROR_CODES.UNSUPPORTED_CURRENCY, "Unsupported promotion currency.", { currency });
    }
    if (!Array.isArray(input.promotions)) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_INPUT, "promotions must be an array.", { field: "promotions" });
    }
    if (input.campaigns !== undefined && !Array.isArray(input.campaigns)) {
        throw new PromotionResolverError(ERROR_CODES.INVALID_INPUT, "campaigns must be an array.", { field: "campaigns" });
    }
    const evaluationTime = normalizeEvaluationTime(input.context?.evaluationTime);
    return {
        originalPrice: normalizeAmount(originalPrice, "originalPrice"),
        currency,
        evaluationTime,
        strategy: normalizeStrategy(input.strategy || {}),
        context: buildContext(input.context || {}, evaluationTime, currency, originalPrice)
    };
}

function resolvePromotion(input) {
    const normalizedInput = validateInput(input);
    const warnings = new Set();
    const promotions = input.promotions.map(normalizePromotion).map(candidate => ({
        ...candidate,
        scopeSpecificity: scopeSpecificity(candidate)
    }));
    const campaigns = (input.campaigns || []).map(normalizeCampaign);
    const campaignIndex = buildCampaignIndex(campaigns);
    const eligiblePromotions = [];
    const rejectedPromotions = [];
    const resolutionTrace = [];

    promotions.forEach(candidate => {
        const reason = eligibilityCheck(candidate, normalizedInput.context, campaignIndex, warnings);
        if (reason) {
            const rejected = reject(candidate, reason);
            rejectedPromotions.push(rejected);
            resolutionTrace.push(freeze({ promotionId: candidate.id, code: candidate.code, status: "REJECTED", reasonCode: reason }));
            return;
        }
        const benefit = calculateBenefit(candidate, normalizedInput.originalPrice, normalizedInput.strategy, warnings);
        if (benefit.rejectedReason) {
            const rejected = reject(candidate, benefit.rejectedReason);
            rejectedPromotions.push(rejected);
            resolutionTrace.push(freeze({ promotionId: candidate.id, code: candidate.code, status: "REJECTED", reasonCode: benefit.rejectedReason }));
            return;
        }
        const eligible = publicCandidate(candidate, benefit);
        eligiblePromotions.push(eligible);
        resolutionTrace.push(freeze({ promotionId: candidate.id, code: candidate.code, status: "ELIGIBLE", reasonCode: REASON_CODES.ELIGIBLE, candidateFinalPrice: benefit.candidateFinalPrice }));
    });

    if (!eligiblePromotions.length) warnings.add(WARNING_CODES.NO_ELIGIBLE_PROMOTION);
    if (eligiblePromotions.length > 1) warnings.add(WARNING_CODES.MULTIPLE_ELIGIBLE_PROMOTIONS);

    const selectedPromotion = eligiblePromotions.length
        ? freeze({ ...sortEligiblePromotions(eligiblePromotions)[0], selectionReason: "BEST_PRICE" })
        : null;

    const selectedFinalPrice = selectedPromotion ? selectedPromotion.candidateFinalPrice : normalizedInput.originalPrice;
    const result = {
        resolverVersion: RESOLVER_VERSION,
        specificationVersion: SPECIFICATION_VERSION,
        strategy: freeze({ ...normalizedInput.strategy }),
        originalPrice: normalizedInput.originalPrice,
        currency: normalizedInput.currency,
        selectedPromotion,
        candidateFinalPrice: normalizeAmount(selectedFinalPrice, "candidateFinalPrice"),
        discountAmount: selectedPromotion ? selectedPromotion.discountAmount : 0,
        effectiveDiscountPercent: selectedPromotion ? selectedPromotion.effectiveDiscountPercent : 0,
        eligiblePromotions,
        rejectedPromotions,
        warnings: [...warnings].sort().map(code => freeze({ code })),
        resolutionTrace
    };

    return freeze(result);
}

module.exports = Object.freeze({
    resolvePromotion,
    PromotionResolverError,
    ERROR_CODES,
    REASON_CODES,
    WARNING_CODES,
    RESOLVER_VERSION,
    SPECIFICATION_VERSION
});
