"use strict";

const assert = require("assert");
const { projectCommerceOrder } = require("../routes/order")._test;

function order(overrides = {}) {
    return {
        orderId: "AZL-ORDER-1",
        owner: { type: "USER", userId: "user-1", sessionId: "" },
        product: { gameCode: "mlbb", packageCode: "MLBB-1" },
        commercial: { totalAmount: 100, currency: "THB", region: "TH" },
        payment: { paymentMethodId: "promptpay", provider: "MANUAL_PROMPTPAY", status: "pending" },
        fulfilment: { input: {}, status: "not_started" },
        status: "pending_payment",
        paymentStatus: "pending",
        operationalReferences: [],
        ...overrides
    };
}

const awaitingPayment = projectCommerceOrder(order());
assert.strictEqual(awaitingPayment.status, "pending_payment");
assert.strictEqual(awaitingPayment.paymentStatus, "pending");
assert.strictEqual(awaitingPayment.receiptSubmitted, false);
assert.strictEqual(awaitingPayment.awaitingManualReview, false);
assert.strictEqual(awaitingPayment.awaitingPayment, true);
assert.strictEqual(awaitingPayment.paymentMessage, "Payment pending. Awaiting payment.");

const awaitingVerification = projectCommerceOrder(order({
    operationalReferences: [{
        type: "manual_payment_receipt",
        attemptId: "ATT-1",
        receiptId: "RCP-1",
        checksum: "internal-checksum-must-not-project"
    }]
}));
assert.strictEqual(awaitingVerification.status, "pending_payment");
assert.strictEqual(awaitingVerification.paymentStatus, "pending");
assert.strictEqual(awaitingVerification.receiptSubmitted, true);
assert.strictEqual(awaitingVerification.awaitingManualReview, true);
assert.strictEqual(awaitingVerification.awaitingPayment, false);
assert.strictEqual(awaitingVerification.paymentMessage, "Payment submitted. Awaiting verification.");
assert(!JSON.stringify(awaitingVerification).includes("internal-checksum-must-not-project"));
assert(!Object.prototype.hasOwnProperty.call(awaitingVerification, "operationalReferences"));

const paid = projectCommerceOrder(order({
    status: "paid",
    paymentStatus: "paid",
    payment: { paymentMethodId: "promptpay", provider: "MANUAL_PROMPTPAY", status: "paid" },
    operationalReferences: [{ type: "manual_payment_receipt", receiptId: "RCP-1" }]
}));
assert.strictEqual(paid.status, "paid");
assert.strictEqual(paid.paymentStatus, "paid");
assert.strictEqual(paid.awaitingManualReview, false);
assert.strictEqual(paid.awaitingPayment, false);
assert.strictEqual(paid.paymentMessage, "");

console.log("Commerce customer receipt projection verification passed.");
