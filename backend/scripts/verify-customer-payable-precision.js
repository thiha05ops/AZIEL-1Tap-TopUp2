"use strict";

const assert = require("assert");
const { createPricingQuote } = require("../services/commerce/pricingQuoteRuntime");
const {
    finalizeCustomerPayableAmount,
    finalizePublishedCustomerAmount
} = require("../services/commerce/customerPayableAmountService");
const {
    createManualPromptPayAdapter
} = require("../services/commerce/providers/manualPromptPayAdapter");

function pricingInput(amount, currency) {
    return {
        supplierCost: amount,
        supplierCurrency: currency,
        targetCurrency: currency,
        policy: {
            supplierFee: { enabled: false, type: "FIXED", value: 0 },
            businessCost: { enabled: false, type: "FIXED", value: 0 },
            profitRule: { enabled: true, type: "FIXED", value: 0 },
            gatewayFee: { enabled: false, type: "FIXED", value: 0 },
            platformCost: { enabled: false, type: "FIXED", value: 0 },
            tax: { enabled: false, type: "FIXED", value: 0 },
            roundingRule: { enabled: false, mode: "NONE", increment: 0 }
        },
        appliedPricingRules: [],
        context: {
            evaluationTime: "2026-08-26T00:00:00.000Z",
            region: currency === "THB" ? "TH" : "MM",
            currency,
            packageCode: "PRECISION_TEST"
        }
    };
}

function quote(amount, currency, quantity = 1) {
    return createPricingQuote({
        quoteId: `AZQ-PRECISION-${currency}-${quantity}`,
        owner: { userId: "precision-test-user" },
        request: {
            region: currency === "THB" ? "TH" : "MM",
            currency,
            package: {
                packageId: "precision-test-package",
                packageCode: "PRECISION_TEST",
                packageRef: "precision-test-package",
                packageName: "Precision Test",
                gameId: "precision-test",
                gameCode: "precision-test",
                gameName: "Precision Test",
                quantity
            }
        },
        pricingInput: pricingInput(amount, currency),
        versionContext: {},
        issuedAt: "2026-08-26T00:00:00.000Z",
        expiresAt: "2026-08-26T00:15:00.000Z"
    });
}

async function main() {
    for (const [input, expected] of [[52.01, 53], [52.37, 53], [52.5, 53], [52.99, 53], [53, 53], [53.25, 54]]) {
        assert.strictEqual(finalizePublishedCustomerAmount(input, "THB"), expected, `${input} THB must publish as ${expected}`);
    }
    assert.strictEqual(finalizeCustomerPayableAmount(52.37, "THB"), 52.37, "ordinary THB normalization must retain decimal precision");
    assert.strictEqual(finalizeCustomerPayableAmount(14.1, "THB"), 14.1, "internal pricing values must not be ceiled");
    assert.strictEqual(finalizeCustomerPayableAmount(4319.5, "MMK"), 4320);

    const pubg = quote(33.9255, "THB");
    assert.strictEqual(pubg.pricingSnapshot.result.regularPrice, 33.9255, "pricing snapshot retains internal precision");
    assert.strictEqual(pubg.commercialSnapshot.originalPrice, 34, "customer-facing original price is whole THB");
    assert.strictEqual(pubg.commercialSnapshot.quotedUnitPrice, 34, "customer-facing unit price is whole THB");
    assert.strictEqual(pubg.commercialSnapshot.quotedTotalAmount, 34, "THB payable finalizes upward at quote issuance");

    const mlbb = quote(327.6, "THB");
    assert.strictEqual(mlbb.commercialSnapshot.quotedTotalAmount, 328, "decimal THB payable rounds upward");

    const mmk = quote(4319.5, "MMK");
    assert.strictEqual(mmk.commercialSnapshot.quotedTotalAmount, 4320, "MMK payable must follow its zero-decimal settlement policy");

    let qrRequest = null;
    const adapter = createManualPromptPayAdapter({
        configuration: {
            enabled: true,
            recipientType: "PHONE",
            recipientValue: "0812345678",
            environment: "test",
            defaultExpiryMinutes: 15
        },
        qrService: async request => {
            qrRequest = request;
            return {
                qrImage: "data:image/png;base64,test",
                qrPayload: "test-payload",
                encodedAmount: request.amount.toFixed(2),
                encodedReference: request.orderReference,
                qrImagePayloadMatches: true,
                expiresAt: "2026-08-26T00:15:00.000Z"
            };
        },
        clock: () => new Date("2026-08-26T00:00:00.000Z")
    });
    const payment = await adapter.createPayment({
        intent: {
            orderId: "AZL-PUBG-60",
            quoteId: pubg.quoteId,
            amount: pubg.commercialSnapshot.quotedTotalAmount,
            currency: "THB"
        },
        attempt: { attemptId: "PAY-PUBG-60" }
    });
    assert.strictEqual(qrRequest.amount, 34, "PromptPay QR must receive the quote-finalized amount");
    assert.strictEqual(payment.amount, 34, "PaymentAttempt/provider result must retain the identical payable amount");
    assert.strictEqual(payment.qr.encodedAmount, "34.00", "PromptPay payload must encode the identical payable amount");

    console.log("Customer payable precision verification passed.");
    console.log("PUBG_60_UC: 33.9255 internal -> 34 THB quote/order/attempt/QR/display");
    console.log("MLBB control: 327.6 -> 328 THB");
    console.log("MMK control: 4319.5 -> 4320 MMK");
    console.log("Persistent writes: 0; real payments: 0; provider calls: 0");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
