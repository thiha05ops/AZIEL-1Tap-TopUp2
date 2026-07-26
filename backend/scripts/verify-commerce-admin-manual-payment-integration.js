"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
    commerceAdminId,
    commerceAttemptIdFromAdminId,
    projectCommerceManualAttempt
} = require("../routes/order")._test;

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notIncludes(file, snippet, message) {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
}

function sampleAttempt(overrides = {}) {
    return {
        _id: "64a000000000000000000001",
        attemptId: "AZP-ATTEMPT-0001",
        orderId: "AZL-ORDER-0001",
        provider: "MANUAL_PROMPTPAY",
        paymentMethod: "promptpay",
        amount: 1490,
        currency: "THB",
        region: "TH",
        status: "PENDING",
        providerReference: "AZL-ORDER-0001",
        ownerId: "user-1",
        safeMetadata: {
            receiptAttached: true,
            receiptEvidence: {
                receiptId: "RCP-0001",
                fileReference: "https://res.cloudinary.com/aziel/image/upload/slip.png",
                storageKey: "payment-slips/slip.png",
                storageProvider: "cloudinary",
                mimeType: "image/png",
                fileSize: 12345,
                uploadedAt: "2026-07-26T12:00:00.000Z"
            }
        },
        eventHistory: [
            {
                eventType: "RECEIPT_EVIDENCE_ATTACHED",
                status: "PENDING",
                receivedAt: "2026-07-26T12:00:00.000Z"
            }
        ],
        createdAt: "2026-07-26T11:50:00.000Z",
        updatedAt: "2026-07-26T12:00:00.000Z",
        ...overrides
    };
}

function sampleOrder(overrides = {}) {
    return {
        orderId: "AZL-ORDER-0001",
        owner: { type: "USER", userId: "user-1" },
        product: {
            gameName: "Mobile Legends",
            gameCode: "mlbb",
            packageName: "7740+1548 Diamonds",
            packageCode: "mlbb-7740"
        },
        commercial: {
            totalAmount: 1490,
            currency: "THB",
            region: "TH"
        },
        payment: {
            paymentMethodId: "promptpay",
            provider: "MANUAL_PROMPTPAY",
            status: "pending"
        },
        fulfilment: { status: "not_started", input: { zoneId: "1234" } },
        status: "pending_payment",
        paymentStatus: "pending",
        createdAt: "2026-07-26T11:50:00.000Z",
        updatedAt: "2026-07-26T12:00:00.000Z",
        ...overrides
    };
}

function verifyProjectionContract() {
    const projected = projectCommerceManualAttempt(sampleAttempt(), sampleOrder(), { summary: true });

    assert.strictEqual(projected._id, "commerce:AZP-ATTEMPT-0001");
    assert.strictEqual(commerceAttemptIdFromAdminId(projected._id), "AZP-ATTEMPT-0001");
    assert.strictEqual(commerceAdminId(sampleAttempt()), projected._id);
    assert.strictEqual(projected.isCommerceManualPayment, true);
    assert.strictEqual(projected.commercePaymentAttemptId, "AZP-ATTEMPT-0001");
    assert.strictEqual(projected.orderId, "AZL-ORDER-0001");
    assert.strictEqual(projected.status, "pending_payment");
    assert.strictEqual(projected.paymentStatus, "pending");
    assert.strictEqual(projected.hasPaymentEvidence, true);
    assert.strictEqual(projected.paymentEvidence.url, "https://res.cloudinary.com/aziel/image/upload/slip.png");
    assert.deepStrictEqual(projected.allowedNextStatuses, ["paid", "failed"]);
    assert.strictEqual(projected.fulfillment.status, "NOT_STARTED");
}

function verifyPaidProjection() {
    const projected = projectCommerceManualAttempt(sampleAttempt({ status: "PAID" }), sampleOrder({ paymentStatus: "paid" }));
    assert.strictEqual(projected.status, "paid");
    assert.strictEqual(projected.paymentStatus, "paid");
    assert.deepStrictEqual(projected.allowedNextStatuses, []);
}

function verifyRouteSourceOwnership() {
    const route = read("backend/routes/order.js");
    const manualReviewBlock = route.slice(route.indexOf('if (filter === "manual_review")'), route.indexOf('} else if ([', route.indexOf('if (filter === "manual_review")')));

    assert(manualReviewBlock.includes("listCommerceManualReviewOrders"), "manual review route must read Commerce PaymentAttempt projection.");
    assert(!manualReviewBlock.includes("paymentSlip"), "manual review route must not filter legacy Order.paymentSlip.");
    assert(!manualReviewBlock.includes("paymentEvidence.url"), "manual review route must not use legacy Order.paymentEvidence.");
    includes("backend/routes/order.js", "const PaymentAttempt = require(\"../models/PaymentAttempt\")", "admin manual review must read PaymentAttempt.");
    includes("backend/routes/order.js", "const CommerceOrder = require(\"../models/CommerceOrder\")", "admin manual review must join CommerceOrder.");
    includes("backend/routes/order.js", "provider: COMMERCE_MANUAL_PROVIDER", "manual review must be limited to Manual PromptPay attempts.");
    includes("backend/routes/order.js", "status: \"PENDING\"", "manual review must show pending attempts.");
    includes("backend/routes/order.js", "\"safeMetadata.receiptAttached\": true", "manual review must require submitted receipt evidence.");
}

function verifyFrontendActionOwnership() {
    includes("frontend/js/admin-orders.js", "order.isCommerceManualPayment", "frontend must branch on Commerce manual payment rows.");
    includes("frontend/js/admin-orders.js", "approveCommerceManualPayment", "existing Confirm Paid action must call Commerce approval for Commerce rows.");
    includes("frontend/js/admin-orders.js", "/api/admin/commerce/payments/${encodeURIComponent(attemptId)}/approve", "approve must call Commerce manual payment endpoint.");
    includes("frontend/js/admin-orders.js", "/api/admin/commerce/payments/${encodeURIComponent(attemptId)}/reject", "reject must call Commerce manual payment endpoint.");
    notIncludes("frontend/js/admin-orders.js", "create duplicate payment", "admin integration must not create duplicate payment records.");
}

verifyProjectionContract();
verifyPaidProjection();
verifyRouteSourceOwnership();
verifyFrontendActionOwnership();

console.log("Commerce Admin manual payment integration verification passed.");
