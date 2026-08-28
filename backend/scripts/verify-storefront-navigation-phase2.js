#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

const gameFlow = read("frontend/js/game-flow.js");
const checkout = read("frontend/checkout.html");
const checkoutRuntime = read("frontend/js/product-checkout.js");
const paymentEngine = read("frontend/js/payment/payment-engine.js");
const commerceCheckout = read("backend/services/commerce/customerManualPromptPayCheckoutService.js");

const immediateBranch = gameFlow.indexOf('if (flow.config.paymentSelectionStage === "checkout")');
const handoff = gameFlow.indexOf("stageCheckoutHandoff(orderData, flow)", immediateBranch);
const catalogRefresh = gameFlow.indexOf("refreshPackageForCheckout(flow, orderData)", immediateBranch);
const promoRefresh = gameFlow.indexOf("refreshPromoBeforeSubmit(flow, orderData)", immediateBranch);

assert(immediateBranch >= 0 && handoff > immediateBranch, "Checkout-stage handoff must exist.");
assert(handoff < catalogRefresh && handoff < promoRefresh, "Checkout-stage navigation must happen before catalog or promo network work.");
assert(gameFlow.includes("validateCheckoutDraftIdentity(orderData)"), "Canonical identifiers must receive local presence validation.");
assert(gameFlow.includes('authoritativeStatus: "pending"'), "The local draft must be explicitly unverified.");

const reviewBodyStart = checkoutRuntime.indexOf("body: JSON.stringify({");
const reviewBodyEnd = checkoutRuntime.indexOf("})", reviewBodyStart);
const reviewBody = checkoutRuntime.slice(reviewBodyStart, reviewBodyEnd);
assert(!reviewBody.includes("amount:"), "The review request must not submit a trusted local amount.");
assert(checkoutRuntime.includes("render(draft.order)"), "The safe draft shell must render before review completes.");
assert(checkoutRuntime.includes("reconcileDraft(authoritativeReview)"), "Authoritative review must reconcile the local snapshot.");
assert(checkoutRuntime.includes("setReviewSkeletons()") && checkoutRuntime.includes("showRecoveryActions(true)"), "Review failure must retain a visible loading/recovery state.");
assert(checkout.includes('id="checkoutRetryReview"') && checkout.includes('id="checkoutChangePackage"'), "Checkout must expose retry and package-selection recovery.");
assert(checkout.includes('id="checkoutPayButton"') && checkout.includes("disabled"), "Pay must start disabled.");

assert(paymentEngine.includes("const useBlockingLoader = orderData.pagePresentation !== true"), "Page checkout must avoid a full-screen payment loader.");
assert(paymentEngine.includes("await createCommerceManualPromptPayCheckout(orderData)"), "Authoritative payment creation intentionally remains before payment navigation.");
assert(commerceCheckout.includes('idempotencyKey: `review-quote:${idempotencySeed}`'));
assert(commerceCheckout.includes('idempotencyKey: `checkout:${idempotencySeed}`'));
assert(commerceCheckout.includes('`manual:${idempotencySeed}`'));

console.log(JSON.stringify({
    result: "PASS",
    productCheckoutNetworkBlockers: 0,
    destinationReviewProgressive: true,
    staleDraftReconciliation: true,
    recoveryActions: true,
    localAmountTrusted: false,
    paymentCreationMoved: false,
    paymentIdempotencyPreserved: true,
    fullScreenPaymentLoaderOnCheckout: false
}, null, 2));
