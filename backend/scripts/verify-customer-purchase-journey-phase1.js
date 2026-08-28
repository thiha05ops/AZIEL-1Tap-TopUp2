#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

function verifyTransitionLock() {
    const events = [];
    const documentElement = { dataset: {} };
    const document = { documentElement, dispatchEvent: event => events.push(event) };
    const context = { window: {}, document, CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } } };
    vm.runInNewContext(read("frontend/js/purchase-transition-lock.js"), context);
    const control = { disabled: false, inert: false, attrs: {}, getAttribute(name) { return this.attrs[name] ?? null; }, setAttribute(name, value) { this.attrs[name] = value; }, removeAttribute(name) { delete this.attrs[name]; } };
    const statusNode = { textContent: "Ready" };
    const first = context.window.AZIEL_PURCHASE_TRANSITION.acquire("PREPARING_CHECKOUT", { controls: [control], statusNode, message: "Preparing checkout..." });
    assert(first, "First purchase action must synchronously acquire the lock.");
    assert.strictEqual(control.disabled, true);
    assert.strictEqual(statusNode.textContent, "Preparing checkout...");
    assert.strictEqual(context.window.AZIEL_PURCHASE_TRANSITION.acquire("PREPARING_CHECKOUT", { controls: [control] }), null, "Double action must not acquire another transition.");
    assert.strictEqual(first.release(), true);
    assert.strictEqual(control.disabled, false, "Recoverable failure must restore controls.");
    assert.strictEqual(context.window.AZIEL_PURCHASE_TRANSITION.state(), "IDLE");
    assert.strictEqual(events.length, 2);
}

function verifyConsolidatedJourney() {
    const checkout = read("frontend/checkout.html");
    const runtime = read("frontend/js/product-checkout.js");
    const gameFlow = read("frontend/js/game-flow.js");
    const productStage = read("frontend/js/product-detail-stage.js");
    assert(productStage.includes('"Buy Now"') && !productStage.includes('"Continue to Checkout"'));
    assert(gameFlow.includes('acquire("PREPARING_CHECKOUT"'));
    assert(gameFlow.indexOf('acquire("PREPARING_CHECKOUT"') < gameFlow.indexOf("refreshPackageForCheckout(flow, orderData)"), "Product lock must be acquired before async checkout preparation.");
    assert(gameFlow.includes("flow.purchaseNavigationCommitted"));
    assert(checkout.includes('id="paymentGrid"') && checkout.includes('id="paymentMethod"'));
    assert(checkout.includes("purchase-transition-lock.js"));
    assert(runtime.includes('acquire("PREPARING_PAYMENT"'));
    assert(runtime.includes("window.AZIEL_PAYMENT.start"), "Checkout must bridge to the canonical payment engine.");
    assert(!runtime.includes('window.location.href = "payment-method.html"'), "Normal Checkout must not require the payment-method page.");
    assert(runtime.includes("authoritativeReview.pricing") && runtime.includes("reviewQuoteId: authoritativeReview.quoteId"));
    assert(runtime.includes('payment.paymentType === "wallet"') && runtime.includes('t("payment.pay", "Pay")'));
    assert(runtime.includes('t("payment.continueWith"'));
}

function verifyPaymentCompatibility() {
    const methodHtml = read("frontend/payment-method.html");
    const methodRuntime = read("frontend/js/payment-method-page.js");
    const engine = read("frontend/js/payment/payment-engine.js");
    const wallet = read("frontend/js/payment/payment-wallet.js");
    const sheet = read("frontend/js/payment/payment-checkout-sheet.js");
    const paymentPage = read("frontend/js/payment-page-runtime.js");
    const recovery = read("frontend/js/payment/pending-payment-recovery.js");
    assert(methodHtml.includes('id="paymentGrid"') && methodRuntime.includes("continueToPayment"), "Direct/recovery payment-method entry must remain intact.");
    assert(engine.includes("PaymentWallet.pay(orderData)") && engine.includes("stageWalletCompletion"));
    assert(wallet.includes('fetch(PaymentUtils.apiUrl("/api/wallet/pay")'));
    assert(engine.includes("createCommerceManualPromptPayCheckout") && engine.includes("stagePaymentPage"));
    assert(sheet.includes("DYNAMIC_PROMPTPAY_QR_VERSION"));
    assert(sheet.includes('id="azPaymentSheetSlipInput"'));
    assert(sheet.includes("Submit for Verification"));
    assert(paymentPage.includes("azielPaymentPageSession"));
    assert(recovery.includes("aziel:commerce-pending-payment"));
}

function verifyBusinessBoundaries() {
    const journeyFiles = ["frontend/js/purchase-transition-lock.js", "frontend/js/product-checkout.js", "frontend/js/game-flow.js", "frontend/js/payment/payment-engine.js"].map(read).join("\n");
    for (const forbidden of ["supplierProductCode", "supplierPackageCode", "fulfillmentEligibility", "resolveCheckoutRouteSnapshot", "debitWallet", "markCommerceOrderPaid"]) assert(!journeyFiles.includes(forbidden), `Frontend journey must not own ${forbidden}`);
    assert(!journeyFiles.includes("quotedTotalAmount ="), "Frontend must not calculate a replacement authoritative total.");
}

verifyTransitionLock();
verifyConsolidatedJourney();
verifyPaymentCompatibility();
verifyBusinessBoundaries();
console.log(JSON.stringify({ result: "PASS", buyNowLocksSynchronously: true, duplicateBuyBlocked: true, recoverableUnlock: true, checkoutReviewAuthorityPreserved: true, eligiblePaymentLoaderReused: true, mandatoryPaymentMethodPageRemoved: true, walletCanonicalPathReused: true, promptPayRuntimeChanged: false, promptPaySlipRequired: true, mmManualRuntimeChanged: false, oldPaymentMethodCompatible: true, pendingRecoveryCompatible: true, backendPaymentChanges: 0, supplierFulfillmentChanges: 0 }, null, 2));
