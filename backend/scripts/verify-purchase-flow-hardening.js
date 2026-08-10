"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    assertReviewQuoteMatchesCheckout,
    reviewCustomerCheckout,
    CustomerManualPromptPayCheckoutError
} = require("../services/commerce/customerManualPromptPayCheckoutService");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

async function verifyAuthoritativeReview() {
    const calls = { quote: 0, checkout: 0, payment: 0 };
    const input = {
        checkoutKey: "AZL-STABLE-1",
        orderId: "AZL-STABLE-1",
        productCode: "pubg",
        packageCode: "PUBG_60_UC",
        region: "TH",
        currency: "THB",
        promoCode: "SAVE10",
        amount: 1
    };
    const dependencies = {
        assertFulfillmentReady: async () => true,
        loadCatalogPackage: async () => ({
            pkg: { _id: "pkg-1", name: "60 UC" },
            price: { amount: 30.31, currency: "THB" },
            region: "TH",
            currency: "THB",
            productCode: "pubg",
            packageCode: "PUBG_60_UC"
        }),
        buildPricingContext: async () => ({
            packageContext: {
                packageId: "pkg-1",
                packageCode: "PUBG_60_UC",
                packageName: "60 UC",
                gameId: "pubg",
                gameCode: "pubg",
                gameName: "PUBG Mobile"
            },
            pricing: {
                pricingInput: {
                    supplierCost: 30.31,
                    supplierCurrency: "THB",
                    targetCurrency: "THB",
                    policy: {}
                }
            }
        }),
        loadPromotionContext: async () => ({ promotions: [], campaigns: [], context: {}, strategy: {} }),
        createAndPersistPricingQuote: async request => {
            calls.quote += 1;
            assert.strictEqual(request.idempotencyKey, "review-quote:AZL-STABLE-1", "review retry key must be stable.");
            assert.strictEqual(request.request.currency, "THB", "server catalog currency must own review.");
            assert.strictEqual(request.request.packageIdentity.packageCode, "PUBG_60_UC", "server package must own review.");
            assert.strictEqual(request.request.paymentMethodId, "", "review must not select payment prematurely.");
            assert.strictEqual(request.trustedContext.pricing.pricingInput.supplierCost, 30.31, "trusted pricing context must be server supplied.");
            return {
                publicQuote: {
                    quoteId: "AZQ-REVIEW-1",
                    status: "ISSUED",
                    package: { packageCode: "PUBG_60_UC", packageName: "60 UC", gameName: "PUBG Mobile" },
                    pricing: { originalPrice: 30.31, discountAmount: 0, quotedTotalAmount: 30.31, currency: "THB" },
                    promotion: null,
                    expiresAt: "2026-08-08T12:30:00.000Z"
                },
                metadata: { idempotentReuse: false }
            };
        },
        checkoutFromQuote: async () => { calls.checkout += 1; },
        initiateManualPayment: async () => { calls.payment += 1; }
    };

    const result = await reviewCustomerCheckout(input, { user: { id: "user-1" } }, dependencies);
    assert.strictEqual(result.review.pricing.quotedTotalAmount, 30.31, "review returns authoritative total.");
    assert.strictEqual(result.metadata.transactionCreated, false, "review explicitly creates no transaction.");
    assert.deepStrictEqual(calls, { quote: 1, checkout: 0, payment: 0 }, "review must not create order or payment attempt.");

    await assert.rejects(
        () => reviewCustomerCheckout({ ...input, checkoutKey: "", orderId: "" }, { user: { id: "user-1" } }, dependencies),
        error => error instanceof CustomerManualPromptPayCheckoutError && error.code === "INVALID_CHECKOUT_INPUT",
        "review must reject a missing stable checkout key."
    );
}

function verifyReviewBinding() {
    const catalog = { packageCode: "PUBG_60_UC", currency: "THB" };
    const review = {
        quoteId: "AZQ-REVIEW-1",
        status: "ISSUED",
        package: { packageCode: catalog.packageCode },
        pricing: { currency: catalog.currency, quotedTotalAmount: 30.31 },
        promotion: { code: "SAVE10" },
        expiresAt: "2999-01-01T00:00:00.000Z"
    };
    assert.strictEqual(
        assertReviewQuoteMatchesCheckout(review, catalog, { promoCode: "save10" }),
        review,
        "matching owner-loaded review must be accepted."
    );
    [
        [{ ...review, expiresAt: "2000-01-01T00:00:00.000Z" }, catalog, { promoCode: "SAVE10" }],
        [{ ...review, package: { packageCode: "OTHER" } }, catalog, { promoCode: "SAVE10" }],
        [{ ...review, pricing: { ...review.pricing, currency: "MMK" } }, catalog, { promoCode: "SAVE10" }],
        [{ ...review, promotion: { code: "OTHER" } }, catalog, { promoCode: "SAVE10" }]
    ].forEach(args => {
        assert.throws(
            () => assertReviewQuoteMatchesCheckout(...args),
            error => error instanceof CustomerManualPromptPayCheckoutError && error.statusCode === 409,
            "expired or mismatched review must be rejected before order creation."
        );
    });
}

function verifyStaticFlowHardening() {
    const routes = read("backend/routes/commerceManualPaymentRoutes.js");
    const checkout = read("frontend/js/product-checkout.js");
    const recovery = read("frontend/js/payment/pending-payment-recovery.js");
    const engine = read("frontend/js/payment/payment-engine.js");
    const customerService = read("backend/services/commerce/customerManualPromptPayCheckoutService.js");
    const manualService = read("backend/services/commerce/manualPaymentApplicationService.js");
    const orderRoutes = read("backend/routes/order.js");
    const tracking = read("frontend/js/tracking.js");

    assert(routes.includes('"/commerce/checkout/review"') && routes.includes("authMiddleware"), "authoritative review route must require authentication.");
    assert(checkout.includes("paymentSubmitting") && checkout.includes("if (paymentSubmitting"), "Pay must reject double submission.");
    assert(checkout.includes("authoritativeReview?.quoteId") && checkout.includes('"/api/commerce/checkout/review"'), "Checkout must wait for authoritative review.");
    assert(!checkout.slice(checkout.indexOf('body: JSON.stringify({'), checkout.indexOf('body: JSON.stringify({') + 700).includes("amount:"), "review request must not submit a client total.");
    assert(recovery.includes('page === "checkout.html"'), "Checkout refresh must load pending-payment recovery.");
    assert(read("frontend/checkout.html").includes("pending-payment-recovery.js"), "Checkout must include recovery runtime.");
    assert(engine.includes('"aziel:commerce-pending-payment"'), "payment creation must retain a server-recovery marker.");
    assert(customerService.includes("review-quote:${idempotencySeed}"), "review quote retries must be idempotent.");
    assert(customerService.includes("checkout:${idempotencySeed}"), "CommerceOrder creation must remain idempotent.");
    assert(customerService.includes("manual:${idempotencySeed}"), "PaymentAttempt creation must remain idempotent.");
    assert(manualService.includes("resumeOrRetryManualPayment") && manualService.includes("findActiveAttemptForOrder"), "expired-session retry must reuse an active attempt before creating another.");
    assert(manualService.includes("findAttemptsForOrder") && manualService.includes("orchestrator.retryPayment"), "expired-session retry must create a new attempt from the latest retryable attempt.");
    assert(orderRoutes.includes('router.get("/order/track/:orderId", authMiddleware') && orderRoutes.includes("username: getAuthenticatedUsername(req)"), "legacy tracking lookup must require and enforce owner identity.");
    assert(orderRoutes.includes('"owner.userId": String(req.user?._id'), "Commerce tracking lookup must enforce owner identity.");
    assert(tracking.includes("{ headers: getTrackingAuthHeaders() }"), "Tracking client must authenticate order reads.");
}

(async () => {
    await verifyAuthoritativeReview();
    verifyReviewBinding();
    verifyStaticFlowHardening();
    console.log("Purchase flow hardening verification passed.");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
