"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const PaymentMethod = require("../models/PaymentMethod");
const {
    loadPromptPayMethod,
    startCustomerManualPromptPayCheckout,
    ERROR_CODES
} = require("../services/commerce/customerManualPromptPayCheckoutService");

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
        "findCatalogPackageByIdentity",
        "customer checkout bridge must load server-owned canonical package/alias context."
    );
    includes(
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        "PaymentMethod.findOne",
        "customer checkout bridge must load server-owned PaymentMethod configuration."
    );
    includes(
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        'region !== "TH" || requestedKey !== "promptpay"',
        "Manual PromptPay checkout must reject non-TH or non-PromptPay method identities before payment creation."
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

async function verifyPaymentMethodAuthority() {
    const originalFindOne = PaymentMethod.findOne;
    let lookupCount = 0;
    PaymentMethod.findOne = query => {
        lookupCount += 1;
        return {
            lean: async () => query.enabled === true && query.region === "TH" && query.key === "promptpay"
                ? {
                    key: "promptpay",
                    method: "PromptPay QR",
                    region: "TH",
                    enabled: true,
                    provider: "promptpay",
                    paymentType: "manual",
                    qrMode: "aziel_promptpay_dynamic",
                    dynamicQrSupported: true,
                    amountPrefillSupported: true,
                    promptPayRecipientType: "PHONE",
                    promptPayRecipientValue: "0000000000",
                    receiptUploadEnabled: true,
                    slipRequired: true,
                    confirmationMode: "manual_admin"
                }
                : null
        };
    };

    try {
        await assert.rejects(
            () => loadPromptPayMethod({ paymentMethod: "ayapay" }, "MM"),
            error => error.code === ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE && !/PromptPay QR/i.test(error.message),
            "AYA Pay must fail as an unavailable method without resolving to PromptPay."
        );
        assert.strictEqual(lookupCount, 0, "Rejected AYA Pay must not be normalized into a PromptPay database lookup.");

        const promptPay = await loadPromptPayMethod({ paymentMethod: "promptpay" }, "TH");
        assert.strictEqual(promptPay.key, "promptpay", "Thailand PromptPay must remain available when enabled and ready.");

        let quoteCreates = 0;
        let checkoutCreates = 0;
        let attemptCreates = 0;
        await assert.rejects(
            () => startCustomerManualPromptPayCheckout(
                {
                    productCode: "mlbb",
                    packageCode: "PKG-MM-TEST",
                    region: "MM",
                    currency: "MMK",
                    paymentMethod: "ayapay",
                    checkoutKey: "forged-disabled-aya"
                },
                { user: { id: "synthetic-customer" } },
                {
                    loadCatalogPackage: async () => ({
                        pkg: { _id: "64f000000000000000000099", name: "Synthetic Package", metadata: {} },
                        price: { amount: 1000, currency: "MMK", enabled: true },
                        region: "MM",
                        currency: "MMK",
                        productCode: "mlbb",
                        packageCode: "PKG-MM-TEST"
                    }),
                    assertFulfillmentReady: async () => ({ fulfillmentAvailable: true }),
                    createAndPersistPricingQuote: async () => { quoteCreates += 1; },
                    checkoutFromQuote: async () => { checkoutCreates += 1; },
                    manualPaymentService: { initiateManualPayment: async () => { attemptCreates += 1; } }
                }
            ),
            error => error.code === ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE,
            "A forged Myanmar AYA Pay checkout must fail closed."
        );
        assert.deepStrictEqual(
            { quoteCreates, checkoutCreates, attemptCreates },
            { quoteCreates: 0, checkoutCreates: 0, attemptCreates: 0 },
            "Rejected payment methods must not create quotes, CommerceOrders, or PaymentAttempts."
        );
    } finally {
        PaymentMethod.findOne = originalFindOne;
    }
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

async function main() {
    verifyBackendBridge();
    verifyFrontendHandoff();
    await verifyPaymentMethodAuthority();
    console.log("Commerce customer checkout integration verifier passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
