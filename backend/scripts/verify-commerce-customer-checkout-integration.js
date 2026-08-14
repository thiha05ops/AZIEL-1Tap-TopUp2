"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..", "..");

function read(file) {
    return fs.readFileSync(path.join(root, file), "utf8");
}

function includes(file, needle, message) {
    assert(read(file).includes(needle), message);
}

function notIncludesNear(file, marker, forbidden, message) {
    const source = read(file);
    const index = source.indexOf(marker);
    assert(index >= 0, `${message}: marker missing`);
    const window = source.slice(index, index + 900);
    assert(!window.includes(forbidden), message);
}

function verifyBackendBridge() {
    includes(
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        "createAndPersistPricingQuote",
        "customer checkout bridge must create and persist a Commerce quote."
    );
    includes(
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        "checkoutFromQuote",
        "customer checkout bridge must create a CommerceOrder from the locked quote."
    );
    includes(
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        "initiateManualPayment",
        "customer checkout bridge must initiate the Manual PromptPay application service."
    );
    includes(
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        "CatalogPackage.findOne",
        "customer checkout bridge must load server-owned catalog package context."
    );
    includes(
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        "PaymentMethod.findOne",
        "customer checkout bridge must load server-owned PaymentMethod configuration."
    );
    includes(
        "backend/routes/commerceManualPaymentRoutes.js",
        '"/commerce/checkout/manual-promptpay"',
        "Commerce customer checkout route must be registered."
    );
    includes(
        "backend/routes/commerceManualPaymentRoutes.js",
        'upload.single("slip")',
        "Commerce receipt route must accept the existing checkout slip upload field."
    );
    includes(
        "backend/controllers/commerceManualPaymentController.js",
        "uploadFile({",
        "Commerce receipt controller must persist the receipt image before binding evidence."
    );
    includes(
        "backend/controllers/commerceManualPaymentController.js",
        "attachReceiptEvidence",
        "Commerce receipt controller must bind receipt evidence to PaymentAttempt."
    );
}

function verifyFrontendHandoff() {
    includes(
        "frontend/js/product-checkout.js",
        "validateReviewForHandoff(authoritativeReview)",
        "Review must hand off the valid server-issued PricingQuote without a contradictory raw-catalog price comparison."
    );
    includes(
        "frontend/js/payment.js",
        'sessionStorage.getItem("azielProductCheckoutDraft")',
        "Payment-method readiness must use the transaction region carried by the checkout draft."
    );
    includes(
        "frontend/js/payment/payment-engine.js",
        '"/api/commerce/checkout/manual-promptpay"',
        "Payment engine must call Commerce customer checkout instead of legacy manual creation."
    );
    includes(
        "frontend/js/payment/payment-engine.js",
        "createCommerceManualPromptPayCheckout(orderData)",
        "Payment engine must expose a Commerce checkout creation function."
    );
    notIncludesNear(
        "frontend/js/payment/payment-engine.js",
        'if (type === "manual" || type === "deeplink")',
        "createManualAttempt(orderData)",
        "Manual/deeplink customer checkout branch must not create legacy ManualPaymentAttempt records."
    );
    includes(
        "frontend/js/payment/payment-manual.js",
        "/api/commerce/orders/",
        "Manual sheet submit must upload receipts to the Commerce PaymentAttempt endpoint."
    );
    includes(
        "frontend/js/payment/payment-deeplink.js",
        "/api/commerce/orders/",
        "Deeplink sheet submit must upload receipts to the Commerce PaymentAttempt endpoint."
    );
    includes(
        "frontend/js/payment/payment-engine.js",
        '"aziel:commerce-pending-payment"',
        "Commerce checkout must store a refresh recovery marker."
    );
    includes(
        "frontend/js/payment/pending-payment-recovery.js",
        "/api/commerce/orders/",
        "Recovery overlay must restore Commerce PaymentAttempt state after refresh."
    );
    includes(
        "frontend/js/payment/payment-checkout-sheet.js",
        "options.commerce === true",
        "Recovered receipt submit must branch to Commerce when recovery is Commerce-owned."
    );
}

function main() {
    verifyBackendBridge();
    verifyFrontendHandoff();
    console.log("Commerce customer checkout integration verifier passed.");
}

main();
