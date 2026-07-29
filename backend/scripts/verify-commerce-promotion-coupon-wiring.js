"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");

function read(file) {
    return fs.readFileSync(path.join(root, file), "utf8");
}

function includes(file, needle, message) {
    assert(read(file).includes(needle), message);
}

function notIncludes(file, needle, message) {
    assert(!read(file).includes(needle), message);
}

function includesAll(file, needles, message) {
    const source = read(file);
    needles.forEach(needle => assert(source.includes(needle), `${message}: missing ${needle}`));
}

function verifyBridgeUsesExistingPromoArchitecture() {
    includesAll(
        "backend/services/commerce/commercePromotionBridgeService.js",
        [
            "require(\"../promoCodeService\")",
            "resolvePromoPricing",
            "reservePromoUse",
            "consumePromoRedemption",
            "releasePromoRedemption",
            "PromoRedemption",
            "PromoUsageState"
        ],
        "Commerce promotion bridge must reuse the existing PromoCode/PromoRedemption architecture"
    );
    notIncludes(
        "backend/services/commerce/commercePromotionBridgeService.js",
        "PromotionRule",
        "Commerce coupon wiring must not introduce a second admin promotion authority"
    );
}

function verifyQuoteWiring(file) {
    includesAll(
        file,
        [
            "loadCommercePromotionContext",
            "suppliedCouponCode",
            "loadPromotionContext",
            "reserveCommercePromotion",
            "validatePromotionRedemption",
            "releaseCommercePromotion"
        ],
        `${file} must load promotion context and reserve/release redemptions through checkout validation`
    );
}

function verifyManualPromptPayFlow() {
    verifyQuoteWiring("backend/services/commerce/customerManualPromptPayCheckoutService.js");
    includes(
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        "manualService.initiateManualPayment",
        "Manual PromptPay checkout must still initiate the existing manual payment application service"
    );
    includes(
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        "toCheckoutSession({ checkout: checkoutResult.checkout, payment, method, catalog })",
        "Manual PromptPay session must still render from the Commerce checkout/payment result"
    );
}

function verifyWalletFlow() {
    verifyQuoteWiring("backend/services/commerce/customerWalletCheckoutService.js");
    includesAll(
        "backend/services/commerce/customerWalletCheckoutService.js",
        [
            "const orderAmount = Number(checkoutResult.checkout?.pricing?.totalAmount || 0)",
            "debitWallet",
            "consumeCommercePromotion",
            "promotionOrder?.promotionRedemptionSnapshot?.redemptionId",
            "releaseReservationOnFailure = false"
        ],
        "Wallet checkout must debit the discounted Commerce amount and consume the promo after success"
    );
}

function verifyCheckoutReservationOrdering() {
    includesAll(
        "backend/services/commerce/checkoutApplicationService.js",
        [
            "findExistingOrders",
            "validatePromotionRedemption",
            "orderId: context.orderId",
            "promotionRedemptionSnapshot: promotionValidation.promotionRedemptionSnapshot"
        ],
        "Checkout service must check idempotent reuse before reservation and snapshot redemption into the CommerceOrder"
    );
}

function verifyManualAdminLifecycle() {
    includesAll(
        "backend/services/commerce/manualPaymentApplicationService.js",
        [
            "consumeCommercePromotion",
            "releaseCommercePromotion",
            "COMMERCE_MANUAL_PAYMENT_APPROVED",
            "COMMERCE_MANUAL_PAYMENT_REJECTED",
            "expirePayment",
            "cancelPayment"
        ],
        "Manual admin approval/reject/cancel/expire lifecycle must confirm or release Commerce promo redemptions"
    );
}

function verifyOrderSnapshotHook() {
    includesAll(
        "backend/services/commerce/orderRepository.js",
        [
            "setPromotionRedemptionSnapshot",
            "promotionRedemptionSnapshot",
            "runValidators: true"
        ],
        "CommerceOrder repository must expose a narrow mutable promotion redemption snapshot update"
    );
}

function verifyFocusedLifecycleAssertions() {
    includesAll(
        "backend/services/commerce/commercePromotionBridgeService.js",
        [
            "resolvePromoPricing",
            "verifyUserLimit: true",
            "usageFactsFor",
            "maximumDiscountAmount",
            "minimumOrderAmount",
            "usageLimitTotal",
            "usageLimitPerUser",
            "findExistingRedemption",
            "status: { $in: [\"RESERVED\", \"CONSUMED\"] }"
        ],
        "Bridge must preserve legacy validation, usage limits, idempotent redemption reuse, caps, and minimums"
    );
    includesAll(
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        [
            "toCheckoutSession",
            "payment.amount"
        ],
        "Manual PromptPay must render from the PaymentAttempt amount generated from CommerceOrder"
    );
    includes(
        "backend/services/commerce/customerWalletCheckoutService.js",
        "const orderAmount = Number(checkoutResult.checkout?.pricing?.totalAmount || 0)",
        "Wallet debit must use the locked Commerce checkout total"
    );
}

function verifyQuoteRuntimeStillOwnsDiscountMath() {
    includesAll(
        "backend/services/commerce/pricingQuoteRuntime.js",
        [
            "resolvePromotion",
            "promotionResult.discountAmount",
            "promotionResult.candidateFinalPrice",
            "quotedTotalAmount"
        ],
        "PricingQuote runtime must remain the owner of Commerce discount and final amount calculation"
    );
}

function main() {
    verifyBridgeUsesExistingPromoArchitecture();
    verifyManualPromptPayFlow();
    verifyWalletFlow();
    verifyCheckoutReservationOrdering();
    verifyManualAdminLifecycle();
    verifyOrderSnapshotHook();
    verifyFocusedLifecycleAssertions();
    verifyQuoteRuntimeStillOwnsDiscountMath();
    console.log("Commerce promotion and coupon wiring verifier passed.");
}

main();
