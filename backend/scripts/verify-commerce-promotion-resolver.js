const assert = require("assert");

const {
    resolvePromotion,
    PromotionResolverError,
    ERROR_CODES,
    REASON_CODES,
    WARNING_CODES,
    RESOLVER_VERSION,
    SPECIFICATION_VERSION
} = require("../services/commerce/promotionResolver");

const EVALUATION_TIME = "2026-07-26T12:00:00.000Z";

function clone(value) {
    return structuredClone(value);
}

function assertError(fn, code, message) {
    let thrown = null;
    try {
        fn();
    } catch (error) {
        thrown = error;
    }
    assert(thrown instanceof PromotionResolverError, message);
    assert.strictEqual(thrown.code, code, message);
}

function baseContext(overrides = {}) {
    return {
        evaluationTime: EVALUATION_TIME,
        region: "TH",
        currency: "THB",
        packageId: "MLBB-7740",
        packageCode: "MLBB_7740",
        gameId: "mlbb",
        categoryId: "mobile-games",
        userId: "user-1",
        userTier: "VIP",
        isFirstPurchase: false,
        orderSubtotal: 1490,
        usage: {
            promotionUsageTotal: {},
            userPromotionUsage: {}
        },
        ...overrides
    };
}

function promo(overrides = {}) {
    return {
        id: "promo-10",
        code: "PROMO10",
        name: "Ten percent",
        status: "ACTIVE",
        promotionType: "PERCENTAGE_DISCOUNT",
        discountValue: 10,
        region: "TH",
        currency: "THB",
        priority: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        ...overrides
    };
}

function resolve(overrides = {}) {
    return resolvePromotion({
        originalPrice: 1490,
        currency: "THB",
        promotions: [promo()],
        context: baseContext(),
        ...overrides
    });
}

function hasWarning(result, code) {
    return result.warnings.some(warning => warning.code === code);
}

function verifyBasicDiscounts() {
    const percentage = resolve();
    assert.strictEqual(percentage.resolverVersion, RESOLVER_VERSION, "resolver version must be present.");
    assert.strictEqual(percentage.specificationVersion, SPECIFICATION_VERSION, "spec version must be present.");
    assert.strictEqual(percentage.selectedPromotion.code, "PROMO10", "percentage promo must be selected.");
    assert.strictEqual(percentage.discountAmount, 149, "percentage discount should calculate from originalPrice.");
    assert.strictEqual(percentage.candidateFinalPrice, 1341, "percentage final price should be calculated.");

    const fixed = resolve({ promotions: [promo({ id: "fixed", code: "FIXED500", promotionType: "FIXED_DISCOUNT", discountValue: 500 })] });
    assert.strictEqual(fixed.discountAmount, 500, "fixed discount should subtract fixed amount.");
    assert.strictEqual(fixed.candidateFinalPrice, 990, "fixed discount final price.");

    const clamped = resolve({ promotions: [promo({ id: "fixed-big", code: "BIG", promotionType: "FIXED_DISCOUNT", discountValue: 5000 })] });
    assert.strictEqual(clamped.candidateFinalPrice, 0, "fixed discount must clamp at zero.");
    assert(hasWarning(clamped, WARNING_CODES.PRICE_CLAMPED_TO_ZERO), "clamp warning must be emitted.");

    const overrideRejected = resolve({ promotions: [promo({ id: "override", code: "OVERRIDE", promotionType: "OVERRIDE_PRICE", overridePrice: 999 })] });
    assert.strictEqual(overrideRejected.selectedPromotion, null, "price override must be disabled unless strategy allows it.");
    assert.strictEqual(overrideRejected.rejectedPromotions[0].reasonCode, REASON_CODES.PRICE_OVERRIDE_DISABLED, "override disabled reason.");

    const overrideAllowed = resolve({
        promotions: [promo({ id: "override", code: "OVERRIDE", promotionType: "OVERRIDE_PRICE", overridePrice: 999 })],
        strategy: { mode: "BEST_PRICE", allowPriceOverride: true }
    });
    assert.strictEqual(overrideAllowed.selectedPromotion.promotionType, "PRICE_OVERRIDE", "model alias OVERRIDE_PRICE should normalize.");
    assert.strictEqual(overrideAllowed.candidateFinalPrice, 999, "override price should set candidate final price.");
    assert(hasWarning(overrideAllowed, WARNING_CODES.PRICE_OVERRIDE_SELECTED), "override selected warning must be emitted.");
}

function verifyEligibilityRejections() {
    const cases = [
        [promo({ enabled: false }), REASON_CODES.PROMOTION_DISABLED],
        [promo({ status: "DRAFT" }), REASON_CODES.PROMOTION_NOT_ACTIVE],
        [promo({ status: "SCHEDULED" }), REASON_CODES.PROMOTION_NOT_STARTED],
        [promo({ status: "ENDED" }), REASON_CODES.PROMOTION_EXPIRED],
        [promo({ status: "ARCHIVED" }), REASON_CODES.PROMOTION_ARCHIVED],
        [promo({ effectiveFrom: "2026-08-01T00:00:00.000Z" }), REASON_CODES.PROMOTION_NOT_STARTED],
        [promo({ effectiveUntil: "2026-01-01T00:00:00.000Z" }), REASON_CODES.PROMOTION_EXPIRED],
        [promo({ region: "MM" }), REASON_CODES.REGION_NOT_ELIGIBLE],
        [promo({ currency: "MMK" }), REASON_CODES.CURRENCY_NOT_ELIGIBLE],
        [promo({ eligiblePackages: [{ packageId: "OTHER" }] }), REASON_CODES.PACKAGE_NOT_ELIGIBLE],
        [promo({ excludedPackages: [{ packageId: "MLBB-7740" }] }), REASON_CODES.PACKAGE_NOT_ELIGIBLE],
        [promo({ eligibleGameIds: ["pubg"] }), REASON_CODES.GAME_NOT_ELIGIBLE],
        [promo({ excludedGameIds: ["mlbb"] }), REASON_CODES.GAME_NOT_ELIGIBLE],
        [promo({ targeting: { categoryIds: ["gift-cards"] } }), REASON_CODES.CATEGORY_NOT_ELIGIBLE],
        [promo({ eligibleUserSegments: ["NEW"] }), REASON_CODES.USER_TIER_NOT_ELIGIBLE],
        [promo({ firstPurchaseOnly: true }), REASON_CODES.FIRST_PURCHASE_REQUIRED],
        [promo({ minimumOrderAmount: 2000 }), REASON_CODES.MINIMUM_SPEND_NOT_MET],
        [promo({ maximumOrderAmount: 1000 }), REASON_CODES.MAXIMUM_SPEND_EXCEEDED],
        [promo({ requiresCoupon: true, couponCode: "SAVE10" }), REASON_CODES.COUPON_REQUIRED],
        [promo({ requiresCoupon: true, couponCode: "SAVE10" }), REASON_CODES.COUPON_MISMATCH, baseContext({ couponCode: "WRONG" })],
        [promo({ promotionType: "FREE_ITEM" }), REASON_CODES.UNSUPPORTED_PROMOTION_TYPE]
    ];

    cases.forEach(([candidate, reasonCode, context = baseContext()], index) => {
        const result = resolvePromotion({ originalPrice: 1490, currency: "THB", promotions: [candidate], context });
        assert.strictEqual(result.selectedPromotion, null, `case ${index} must not select a promotion.`);
        assert.strictEqual(result.rejectedPromotions[0].reasonCode, reasonCode, `case ${index} rejection reason.`);
    });
}

function verifyCouponUsageAndCampaigns() {
    const coupon = resolve({
        promotions: [promo({ requiresCoupon: true, couponCode: "SAVE10" })],
        context: baseContext({ couponCode: "save10" })
    });
    assert.strictEqual(coupon.selectedPromotion.code, "PROMO10", "coupon comparison should be case-insensitive.");

    const totalLimit = resolve({
        promotions: [promo({ id: "limited", code: "LIMITED", usageLimitTotal: 2 })],
        context: baseContext({ usage: { promotionUsageTotal: { limited: 2, LIMITED: 2 }, userPromotionUsage: {} } })
    });
    assert.strictEqual(totalLimit.rejectedPromotions[0].reasonCode, REASON_CODES.TOTAL_USAGE_LIMIT_REACHED, "total usage limit must reject.");

    const perUserLimit = resolve({
        promotions: [promo({ id: "once", code: "ONCE", usageLimitPerUser: 1 })],
        context: baseContext({ usage: { promotionUsageTotal: {}, userPromotionUsage: { once: 1 } } })
    });
    assert.strictEqual(perUserLimit.rejectedPromotions[0].reasonCode, REASON_CODES.USER_USAGE_LIMIT_REACHED, "per-user usage limit must reject.");

    const missingUsage = resolve({
        promotions: [promo({ id: "needs-facts", code: "FACTS", usageLimitTotal: 10 })],
        context: baseContext({ usage: {} })
    });
    assert.strictEqual(missingUsage.rejectedPromotions[0].reasonCode, REASON_CODES.INVALID_PROMOTION_CONFIGURATION, "missing usage facts must fail safely.");
    assert(hasWarning(missingUsage, WARNING_CODES.USAGE_FACTS_MISSING), "missing usage warning must be emitted.");

    const campaignPromotion = promo({ id: "campaign-promo", code: "CAMPAIGN10", campaignId: "summer" });
    const active = resolvePromotion({
        originalPrice: 1490,
        currency: "THB",
        promotions: [campaignPromotion],
        campaigns: [{
            id: "summer",
            code: "SUMMER",
            status: "ACTIVE",
            startAt: "2026-07-01T00:00:00.000Z",
            endAt: "2026-08-01T00:00:00.000Z",
            targetRegions: ["TH"],
            targetGameIds: ["mlbb"],
            promotionRuleIds: ["campaign-promo"]
        }],
        context: baseContext()
    });
    assert.strictEqual(active.selectedPromotion.code, "CAMPAIGN10", "active campaign should allow promotion.");

    const missing = resolvePromotion({ originalPrice: 1490, currency: "THB", promotions: [campaignPromotion], campaigns: [], context: baseContext() });
    assert.strictEqual(missing.rejectedPromotions[0].reasonCode, REASON_CODES.CAMPAIGN_MISSING, "missing campaign must reject.");

    const mismatch = resolvePromotion({
        originalPrice: 1490,
        currency: "THB",
        promotions: [campaignPromotion],
        campaigns: [{ id: "summer", status: "ACTIVE", targetRegions: ["MM"], promotionRuleIds: ["campaign-promo"] }],
        context: baseContext()
    });
    assert.strictEqual(mismatch.rejectedPromotions[0].reasonCode, REASON_CODES.CAMPAIGN_TARGET_MISMATCH, "campaign target mismatch must reject.");
}

function verifyEligibilityTrees() {
    const tree = resolve({
        promotions: [promo({
            eligibility: {
                operator: "ALL",
                conditions: [
                    { field: "region", comparator: "EQUALS", value: "TH" },
                    { field: "orderSubtotal", comparator: "GREATER_THAN_OR_EQUAL", value: 1000 },
                    {
                        operator: "ANY",
                        conditions: [
                            { field: "userTier", comparator: "IN", values: ["VIP", "GOLD"] },
                            { field: "isFirstPurchase", comparator: "EQUALS", value: true }
                        ]
                    }
                ]
            }
        })]
    });
    assert.strictEqual(tree.selectedPromotion.code, "PROMO10", "valid eligibility tree should pass.");

    const failed = resolve({
        promotions: [promo({ eligibility: { field: "region", comparator: "EQUALS", value: "MM" } })]
    });
    assert.strictEqual(failed.rejectedPromotions[0].reasonCode, REASON_CODES.ELIGIBILITY_TREE_FAILED, "non-matching tree must reject.");

    assertError(() => resolve({
        promotions: [promo({ eligibility: { operator: "NOT", conditions: [] } })]
    }), ERROR_CODES.INVALID_ELIGIBILITY_TREE, "invalid NOT tree must throw.");

    assertError(() => resolve({
        promotions: [promo({
            eligibility: {
                operator: "ALL",
                conditions: [{
                    operator: "ALL",
                    conditions: [{
                        operator: "ALL",
                        conditions: [{
                            operator: "ALL",
                            conditions: [{
                                operator: "ALL",
                                conditions: [{ field: "region", comparator: "EQUALS", value: "TH" }]
                            }]
                        }]
                    }]
                }]
            }
        })]
    }), ERROR_CODES.ELIGIBILITY_TREE_DEPTH_EXCEEDED, "too-deep tree must throw.");
}

function verifyWinnerDeterminism() {
    const input = {
        originalPrice: 1490,
        currency: "THB",
        promotions: [
            promo({ id: "global", code: "GLOBAL", promotionType: "FIXED_DISCOUNT", discountValue: 100, scopes: [{ scopeType: "GLOBAL" }], priority: 1 }),
            promo({ id: "package", code: "PACKAGE", promotionType: "FIXED_DISCOUNT", discountValue: 100, scopes: [{ scopeType: "PACKAGE", scopeReference: "MLBB_7740" }], priority: 1 }),
            promo({ id: "best", code: "BEST", promotionType: "FIXED_DISCOUNT", discountValue: 200, scopes: [{ scopeType: "REGION", scopeReference: "TH" }], priority: 1 }),
            promo({ id: "later", code: "LATER", promotionType: "FIXED_DISCOUNT", discountValue: 100, scopes: [{ scopeType: "PACKAGE", scopeReference: "MLBB_7740" }], createdAt: "2026-02-01T00:00:00.000Z" })
        ],
        context: baseContext()
    };
    const original = clone(input);
    const first = resolvePromotion(input);
    const second = resolvePromotion(input);
    assert.strictEqual(first.selectedPromotion.code, "BEST", "best price must win before specificity tie-breaks.");
    assert(hasWarning(first, WARNING_CODES.MULTIPLE_ELIGIBLE_PROMOTIONS), "multiple eligible warning must be emitted.");
    assert.deepStrictEqual(first, second, "same input must produce deeply equal output.");
    assert.deepStrictEqual(input, original, "resolver must not mutate input.");

    const tie = resolvePromotion({
        ...input,
        promotions: [
            promo({ id: "global", code: "GLOBAL", promotionType: "FIXED_DISCOUNT", discountValue: 100, scopes: [{ scopeType: "GLOBAL" }] }),
            promo({ id: "package", code: "PACKAGE", promotionType: "FIXED_DISCOUNT", discountValue: 100, scopes: [{ scopeType: "PACKAGE", scopeReference: "MLBB_7740" }] })
        ]
    });
    assert.strictEqual(tie.selectedPromotion.code, "PACKAGE", "scope specificity must break equal-price ties.");
}

function verifyInputContracts() {
    assertError(() => resolvePromotion(null), ERROR_CODES.INVALID_INPUT, "null input must fail.");
    assertError(() => resolvePromotion({ originalPrice: -1, currency: "THB", promotions: [], context: baseContext() }), ERROR_CODES.INVALID_ORIGINAL_PRICE, "negative price must fail.");
    assertError(() => resolvePromotion({ originalPrice: 1, currency: "USD", promotions: [], context: baseContext() }), ERROR_CODES.UNSUPPORTED_CURRENCY, "unsupported currency must fail.");
    assertError(() => resolvePromotion({ originalPrice: 1, currency: "THB", promotions: [], context: {} }), ERROR_CODES.MISSING_EVALUATION_TIME, "missing evaluation time must fail.");
    assertError(() => resolvePromotion({ originalPrice: 1, currency: "THB", promotions: [], context: { evaluationTime: "not-a-date" } }), ERROR_CODES.INVALID_EVALUATION_TIME, "invalid evaluation time must fail.");
    assertError(() => resolvePromotion({ originalPrice: 1, currency: "THB", promotions: {}, context: baseContext() }), ERROR_CODES.INVALID_INPUT, "promotions must be an array.");
    assertError(() => resolvePromotion({ originalPrice: 1, currency: "THB", promotions: [null], context: baseContext() }), ERROR_CODES.INVALID_PROMOTION_CANDIDATE, "invalid promotion candidate must fail.");
    assertError(() => resolvePromotion({ originalPrice: 1, currency: "THB", promotions: [], campaigns: [null], context: baseContext() }), ERROR_CODES.INVALID_CAMPAIGN_CANDIDATE, "invalid campaign candidate must fail.");
    assertError(() => resolvePromotion({ originalPrice: 1, currency: "THB", promotions: [], context: baseContext(), strategy: { mode: "STACK" } }), ERROR_CODES.INVALID_STRATEGY, "invalid strategy must fail.");

    const none = resolvePromotion({ originalPrice: 1490, currency: "THB", promotions: [], context: baseContext() });
    assert.strictEqual(none.selectedPromotion, null, "empty promotion list should be valid.");
    assert(hasWarning(none, WARNING_CODES.NO_ELIGIBLE_PROMOTION), "empty promotion list should warn no eligible promotion.");
}

function run() {
    verifyBasicDiscounts();
    verifyEligibilityRejections();
    verifyCouponUsageAndCampaigns();
    verifyEligibilityTrees();
    verifyWinnerDeterminism();
    verifyInputContracts();
    console.log("Commerce promotion resolver verification passed.");
}

run();
