"use strict";

const assert = require("assert");
const { createPricingQuote } = require("../services/commerce/pricingQuoteRuntime");
const {
    finalizeCustomerPayableAmount
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
    assert.strictEqual(finalizeCustomerPayableAmount(33.9255, "THB"), 33.93);
    assert.strictEqual(finalizeCustomerPayableAmount(327.6, "THB"), 327.6);
    assert.strictEqual(finalizeCustomerPayableAmount(4319.5, "MMK"), 4320);

    const pubg = quote(33.9255, "THB");
    assert.strictEqual(pubg.commercialSnapshot.originalPrice, 33.9255, "internal pricing precision must be retained");
    assert.strictEqual(pubg.commercialSnapshot.quotedUnitPrice, 33.9255, "unit economics must retain internal precision");
    assert.strictEqual(pubg.commercialSnapshot.quotedTotalAmount, 33.93, "THB payable must finalize once at quote issuance");

    const mlbb = quote(327.6, "THB");
    assert.strictEqual(mlbb.commercialSnapshot.quotedTotalAmount, 327.6, "existing valid THB payable must remain unchanged");

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
    assert.strictEqual(qrRequest.amount, 33.93, "PromptPay QR must receive the quote-finalized amount");
    assert.strictEqual(payment.amount, 33.93, "PaymentAttempt/provider result must retain the identical payable amount");
    assert.strictEqual(payment.qr.encodedAmount, "33.93", "PromptPay payload must encode the identical payable amount");

    console.log("Customer payable precision verification passed.");
    console.log("PUBG_60_UC: 33.9255 internal -> 33.93 THB quote/order/attempt/QR/display");
    console.log("MLBB control: 327.6 -> 327.6 THB");
    console.log("MMK control: 4319.5 -> 4320 MMK");
    console.log("Persistent writes: 0; real payments: 0; provider calls: 0");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
