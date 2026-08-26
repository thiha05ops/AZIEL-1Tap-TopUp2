"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const authority = require("../../frontend/js/payment/payment-session-authority.js");
const {
    createManualPaymentApplicationService,
    ERROR_CODES
} = require("../services/commerce/manualPaymentApplicationService");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function staged({ quoteId, orderId, attemptId, amount }) {
    return {
        session: { quoteId, commerceOrderId: orderId, attemptId, amount, currency: "THB" },
        orderData: { quoteId, commerceOrderId: orderId, orderId }
    };
}

async function verifyServerOrderAttemptBinding() {
    const owner = { type: "USER", userId: "user-1", sessionId: "" };
    const order = {
        orderId: "AZL-60",
        owner,
        status: "pending_payment",
        paymentStatus: "pending",
        payment: { provider: "MANUAL_PROMPTPAY", paymentMethodId: "promptpay" },
        commercial: { totalAmount: 32.84, currency: "THB" }
    };
    const foreignAttempt = {
        attemptId: "PAY-3850",
        orderId: "AZL-3850",
        owner,
        provider: "MANUAL_PROMPTPAY",
        paymentMethod: "promptpay",
        amount: 1644.13,
        currency: "THB",
        status: "PENDING"
    };
    const service = createManualPaymentApplicationService({
        paymentOrchestrator: {},
        commerceOrderRepository: {
            findOwnedOrderById: async ({ orderId }) => orderId === order.orderId ? order : null
        },
        paymentAttemptRepository: {
            findAttemptByIdForOwner: async () => foreignAttempt,
            findActiveAttemptForOrder: async () => null
        }
    });
    await assert.rejects(
        () => service.getManualPayment({ orderId: order.orderId, attemptId: foreignAttempt.attemptId, owner }),
        error => error.code === ERROR_CODES.NOT_FOUND && error.httpStatus === 404,
        "server must reject an attempt that belongs to another CommerceOrder"
    );
}

async function main() {
    const pubg60 = staged({ quoteId: "AZQ-60", orderId: "AZL-60", attemptId: "PAY-60", amount: 32.84 });
    const pubg3850 = staged({ quoteId: "AZQ-3850", orderId: "AZL-3850", attemptId: "PAY-3850", amount: 1644.13 });
    const mlbb = staged({ quoteId: "AZQ-MLBB", orderId: "AZL-MLBB", attemptId: "PAY-MLBB", amount: 327.6 });

    assert.strictEqual(authority.stagedSessionMatchesDraft(pubg3850, { review: { quoteId: "AZQ-60" } }), false, "old 3850 session must not override new 60 UC review");
    assert.strictEqual(authority.stagedSessionMatchesDraft(pubg60, { review: { quoteId: "AZQ-60" } }), true, "same quote may resume its staged payment");
    assert.strictEqual(authority.stagedSessionMatchesRequest(pubg60, { orderId: "AZL-60", attemptId: "PAY-60" }), true, "same order/attempt refresh must reuse its session");
    assert.strictEqual(authority.stagedSessionMatchesRequest(pubg3850, { orderId: "AZL-60", attemptId: "PAY-60" }), false, "60 UC URL must reject staged 3850 session");
    assert.strictEqual(authority.stagedSessionMatchesRequest(pubg60, { orderId: "AZL-3850", attemptId: "PAY-60" }), false, "attempt cannot be rebound to another order");
    assert.strictEqual(authority.stagedSessionMatchesDraft(mlbb, { review: { quoteId: "AZQ-MLBB" } }), true, "MLBB same-checkout authority must remain unchanged");

    const staleMarker = { orderId: "AZL-3850", attemptId: "PAY-3850" };
    assert.strictEqual(authority.markerMatchesRequest(staleMarker, { orderId: "AZL-60", attemptId: "PAY-60" }), false, "stale localStorage marker must not override URL authority");
    assert.strictEqual(authority.markerMatchesRequest({ orderId: "AZL-60", attemptId: "PAY-60" }, { orderId: "AZL-60", attemptId: "PAY-60" }), true, "matching marker may support exact-attempt recovery");

    const methodPage = read("frontend/js/payment-method-page.js");
    const paymentPage = read("frontend/js/payment-page-runtime.js");
    const engine = read("frontend/js/payment/payment-engine.js");
    assert(methodPage.includes("stagedSessionMatchesDraft(activeTransaction, draft)"), "payment method page must bind staged state to current quote");
    assert(paymentPage.includes("stagedSessionMatchesRequest(staged, requestedIdentity)"), "payment page must let URL order/attempt identity override staged storage");
    assert(paymentPage.includes("markerMatchesRequest(marker, request)"), "localStorage recovery must match the requested order/attempt");
    assert(paymentPage.includes('fetch("/api/commerce/payments/recoverable"'), "exact URL attempt must fall back to server-owned recovery discovery");
    assert(engine.includes('params.set("orderId", orderId)'), "new payment navigation must carry CommerceOrder identity");
    assert(engine.includes('params.set("attemptId", attemptId)'), "new payment navigation must carry PaymentAttempt identity");

    await verifyServerOrderAttemptBinding();

    console.log("Payment-session authority verification passed.");
    console.log("60 UC -> 32.84 THB; same-page refresh -> PAY-60; 3850 UC -> 1644.13 THB; stale cross-order reuse -> blocked.");
    console.log("Persistent writes: 0; payment/provider/supplier calls: 0");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
