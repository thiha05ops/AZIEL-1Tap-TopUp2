"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function loadCheckoutContract() {
    const listeners = {};
    const document = {
        readyState: "loading",
        addEventListener(name, handler) { listeners[name] = handler; },
        getElementById() { return null; }
    };
    const window = { document, AZIEL_LOCALE: { t(_key, fallback) { return fallback; } } };
    vm.runInNewContext(read("frontend/js/product-checkout.js"), {
        window,
        document,
        Date,
        Number,
        String,
        Boolean,
        JSON,
        sessionStorage: { getItem() { return null; }, setItem() {} }
    });
    return window.AZIEL_PRODUCT_CHECKOUT;
}

function sourceContracts() {
    const detail = read("frontend/js/game-flow.js");
    const review = read("frontend/js/product-checkout.js");
    const payment = read("frontend/js/payment/payment-engine.js");
    const receipt = read("frontend/js/payment/payment-manual.js");
    const recovery = read("frontend/js/payment/pending-payment-recovery.js");
    const service = read("backend/services/commerce/customerManualPromptPayCheckoutService.js");

    assert(detail.includes('sessionStorage.setItem("azielProductCheckoutDraft"'), "Game Detail must stage the review draft.");
    assert(review.includes('"/api/commerce/checkout/review"'), "Review must obtain a persisted authoritative quote.");
    assert(review.includes("window.AZIEL_PAYMENT.start"), "Valid inline review must hand the authoritative quote to the selected payment method.");
    assert(review.includes('document.addEventListener("paymentChanged", updatePaymentReady)'), "Inline payment selection must refresh checkout readiness.");
    assert(!review.includes("validateCatalog(draft.order)"), "Review must not compare its quote against a raw catalog amount.");
    assert(review.includes("if (paymentSubmitting || paymentCommitted"), "Inline payment submit must reject double click and committed replay.");
    assert(review.includes("reviewQuoteId: authoritativeReview.quoteId"), "Payment creation must retain the authoritative quote identifier.");
    assert(payment.includes('"/api/commerce/checkout/manual-promptpay"'), "Manual PromptPay must use Commerce checkout.");
    assert(receipt.includes("/api/commerce/orders/"), "Receipt must bind through the Commerce endpoint.");
    assert(recovery.includes('"/api/commerce/payments/recoverable"'), "Refresh recovery must be server-backed.");
    assert(service.includes("review-quote:${idempotencySeed}"), "Quote retries must be idempotent.");
    assert(service.includes("checkout:${idempotencySeed}"), "CommerceOrder creation must be idempotent.");
    assert(service.includes("manual:${idempotencySeed}"), "PaymentAttempt creation must be idempotent.");
}

function main() {
    const contract = loadCheckoutContract();
    const valid = {
        quoteId: "AZQ_TEST",
        status: "ISSUED",
        expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
    assert.strictEqual(contract.validateReviewForHandoff(valid), valid, "valid authoritative quote must hand off.");
    assert.throws(() => contract.validateReviewForHandoff({}), /could not be verified/i, "missing quote must be actionable.");
    assert.throws(() => contract.validateReviewForHandoff({ ...valid, expiresAt: new Date(Date.now() - 1).toISOString() }), /expired/i, "expired quote must be actionable.");
    sourceContracts();
    console.log("Public order-flow review, handoff, idempotency, receipt, and recovery contracts passed.");
}

main();
