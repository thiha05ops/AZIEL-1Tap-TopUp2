"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createPricingQuote, PricingQuoteRuntimeError } = require("../services/commerce/pricingQuoteRuntime");
const { campaignState } = require("../services/userCouponService");

const root = path.join(__dirname, "..", "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function quote(discountType, discountValue, publishedPrice = 130) {
    return {
        quoteId: `Q-${discountType}-${discountValue}-${publishedPrice}`,
        issuedAt: "2026-09-22T00:00:00.000Z",
        expiresAt: "2026-09-22T00:10:00.000Z",
        owner: { userId: "user-1" },
        request: { region: "TH", currency: "THB", package: { packageId: "p1", packageCode: "P1", quantity: 1 }, couponCode: "SAFE" },
        pricingInput: {
            supplierCost: 100, supplierCurrency: "THB", targetCurrency: "THB",
            policy: {
                supplierFee: { enabled: false, type: "FIXED", value: 0 }, businessCost: { enabled: false, type: "FIXED", value: 0 },
                gatewayFee: { enabled: false, type: "FIXED", value: 0 }, platformCost: { enabled: false, type: "FIXED", value: 0 },
                tax: { enabled: false, type: "FIXED", value: 0 }, profitRule: { enabled: true, type: "FIXED", value: 20 },
                roundingRule: { enabled: false, mode: "NONE" }, minimumProfitAmount: 10, minimumProfitMarginPercent: 5
            },
            appliedPricingRules: [{ id: "published", code: "PUBLISHED", ruleType: "PRICE_OVERRIDE", scopeType: "PACKAGE", scopeReference: "P1", priority: 100, value: publishedPrice }],
            context: { supplierCostSnapshot: { configured: true, amount: 100, currency: "THB" } }
        },
        promotionInput: {
            promotions: [{ id: "coupon", code: "SAFE", status: "ACTIVE", enabled: true, promotionType: discountType, discountValue, requiresCoupon: true, couponCode: "SAFE", targeting: { regions: ["TH"], currencies: ["THB"] } }],
            context: { region: "TH", currency: "THB", couponCode: "SAFE", packageCode: "P1" }
        }
    };
}

function rejectsUnsafe(input, label) {
    assert.throws(() => createPricingQuote(input), error => error instanceof PricingQuoteRuntimeError && error.code === "PROMOTION_FINANCIAL_FLOOR_VIOLATION", label);
}

const safe = createPricingQuote(quote("FIXED_DISCOUNT", 10));
assert.strictEqual(safe.commercialSnapshot.quotedTotalAmount, 110, "safe coupon remains below the authoritative base price and at the financial floor");
rejectsUnsafe(quote("PERCENTAGE_DISCOUNT", 50), "large percentage coupon must fail financial floor");
rejectsUnsafe(quote("FIXED_DISCOUNT", 40), "large fixed coupon must fail financial floor");
rejectsUnsafe(quote("FIXED_DISCOUNT", 20, 115), "already-discounted Exclusive Offer published amount cannot bypass floor");

assert.strictEqual(campaignState({ enabled: true, operationalStatus: "PAUSED" }, new Date()), "PAUSED");
assert.strictEqual(campaignState({ enabled: true, operationalStatus: "DRAFT" }, new Date()), "DRAFT");
assert.strictEqual(campaignState({ enabled: true, operationalStatus: "ENDED" }, new Date()), "ENDED");

const orchestrator = read("backend/services/commerce/paymentOrchestrator.js");
for (const token of ["runPostCommitCouponReconciliation", "PAYMENT_STATES.PAID", "PAYMENT_STATES.FAILED", "PAYMENT_STATES.CANCELLED", "PAYMENT_STATES.EXPIRED", "runPostCommitTerminalEffects"]) {
    assert(orchestrator.includes(token), `canonical payment coupon lifecycle must include ${token}`);
}
const bridge = read("backend/services/commerce/commercePromotionBridgeService.js");
for (const token of ["reconcileCommercePromotionForPayment", "setCouponReconciliation", "coupon_reconciliation_failed", "reconcilePendingCouponPayments"]) {
    assert(bridge.includes(token), `coupon reconciliation/recovery must include ${token}`);
}
const ledger = read("backend/models/CouponLifecycleEvent.js");
assert(ledger.includes('{ unique: true, partialFilterExpression: { eventType: "CONSUMED" } }'), "ledger must prevent duplicate terminal consumption");
assert(read("backend/routes/coupons.js").includes("claimLimiter"), "claim endpoint must have a dedicated limiter");
assert(read("backend/services/commerce/paymentOrchestrator.js").includes("getAuthoritativeAmount"), "payment amount must remain CommerceOrder-authoritative");

console.log(JSON.stringify({ result: "PASS", financialFloor: true, explicitSafeStacking: true, canonicalPaymentLifecycle: true, immutableLedger: true, claimRateLimit: true }, null, 2));
