"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notIncludes(file, snippet, message) {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
}

async function verifyServiceBehavior() {
    const {
        createCommercePaymentRecoveryService,
        attemptRecoverable,
        projectRecoverableCommerceAttempt
    } = require("../services/commerce/commercePaymentRecoveryService");

    const now = new Date("2026-07-29T10:00:00.000Z");
    const owner = { type: "USER", userId: "user-1", sessionId: "" };
    const order = {
        orderId: "CO-1",
        quoteId: "Q-1",
        owner,
        status: "pending_payment",
        paymentStatus: "pending",
        product: {
            gameCode: "mlbb",
            gameName: "Mobile Legends",
            packageCode: "wp",
            packageName: "Weekly Pass",
            region: "TH"
        },
        commercial: {
            currency: "THB",
            region: "TH",
            totalAmount: 149
        },
        fulfilment: { input: { userId: "123", zoneId: "456" } }
    };
    const attempt = {
        attemptId: "PAY-1",
        orderId: order.orderId,
        quoteId: order.quoteId,
        owner,
        ownerId: owner.userId,
        provider: "MANUAL_PROMPTPAY",
        paymentMethod: "promptpay",
        confirmationMode: "manual_admin",
        amount: 149,
        currency: "THB",
        region: "TH",
        status: "PENDING",
        providerReference: "AZL-REF-1",
        qr: {
            mode: "aziel_promptpay_dynamic",
            sourceType: "dynamic_response",
            image: "data:image/png;base64,abc",
            encodedReference: "AZL-REF-1"
        },
        paymentInstructions: {
            title: "PromptPay QR",
            steps: ["Save QR", "Open banking app"]
        },
        safeMetadata: {},
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString()
    };

    assert.strictEqual(attemptRecoverable(attempt, order, owner, now), true, "active Commerce attempt must be recoverable.");
    assert.strictEqual(attemptRecoverable({ ...attempt, status: "PAID" }, order, owner, now), false, "paid attempt must not recover.");
    assert.strictEqual(attemptRecoverable({ ...attempt, status: "FAILED" }, order, owner, now), false, "failed attempt must not recover.");
    assert.strictEqual(attemptRecoverable({ ...attempt, status: "CANCELLED" }, order, owner, now), false, "cancelled attempt must not recover.");
    assert.strictEqual(attemptRecoverable({ ...attempt, status: "EXPIRED" }, order, owner, now), false, "expired attempt must not recover.");
    assert.strictEqual(attemptRecoverable({ ...attempt, safeMetadata: { receiptAttached: true } }, order, owner, now), false, "receipt-submitted attempt must not recover.");
    assert.strictEqual(attemptRecoverable(attempt, { ...order, paymentStatus: "paid" }, owner, now), false, "paid order must not recover.");
    assert.strictEqual(attemptRecoverable(attempt, order, { type: "USER", userId: "other", sessionId: "" }, now), false, "different owner must not recover.");

    const dto = projectRecoverableCommerceAttempt({ attempt, order, now });
    assert.strictEqual(dto.commerce, true, "DTO must be marked as Commerce.");
    assert.strictEqual(dto.architecture, "commerce", "DTO must expose architecture.");
    assert.strictEqual(dto.attemptId, attempt.attemptId, "DTO must include attemptId.");
    assert.strictEqual(dto.dynamicQr.qrImage, attempt.qr.image, "DTO must include current dynamic QR image.");
    assert.strictEqual(dto.receiptSubmitted, false, "DTO must indicate receipt is not submitted.");

    let ownerSeen = null;
    let orderLookupCount = 0;
    const service = createCommercePaymentRecoveryService({
        clock: () => now,
        paymentAttemptRepository: {
            findAttemptsForOwner: async input => {
                ownerSeen = input.owner;
                return [attempt, { ...attempt, attemptId: "PAY-2", owner: { type: "USER", userId: "other", sessionId: "" }, ownerId: "other" }];
            }
        },
        commerceOrderRepository: {
            findOwnedOrdersByIds: async input => {
                orderLookupCount += 1;
                assert.deepStrictEqual(input.orderIds, [order.orderId], "service must bulk lookup unique order IDs from attempts.");
                return input.owner.userId === owner.userId ? [order] : [];
            }
        }
    });
    const recovered = await service.listRecoverablePayments({ user: { id: owner.userId } });
    assert.deepStrictEqual(ownerSeen, owner, "service must derive owner from authenticated user.");
    assert.strictEqual(orderLookupCount, 1, "service must avoid per-attempt order lookup.");
    assert.strictEqual(recovered.length, 1, "service must filter non-owned attempts.");
    assert.strictEqual(recovered[0].attemptId, attempt.attemptId, "service must return owned recoverable attempt.");
}

function verifyStaticIntegration() {
    includes("backend/routes/commerceManualPaymentRoutes.js", '"/commerce/payments/recoverable"', "Commerce recoverable route must exist.");
    includes("backend/routes/commerceManualPaymentRoutes.js", "authMiddleware", "Commerce recoverable route must require auth.");
    includes("backend/controllers/commerceManualPaymentController.js", "listRecoverable", "Commerce controller must expose recovery action.");
    includes("backend/controllers/commerceManualPaymentController.js", "req.user", "Recovery controller must use authenticated user.");
    includes("backend/services/commerce/commercePaymentRecoveryService.js", "findAttemptsForOwner", "Recovery service must query attempts by owner.");
    includes("backend/services/commerce/commercePaymentRecoveryService.js", "findOwnedOrdersByIds", "Recovery service must bulk-load owner-scoped orders.");
    includes("backend/services/commerce/orderRepository.js", "findOwnedOrdersByIds", "Commerce order repository must expose bulk owner-scoped lookup.");
    includes("backend/services/commerce/commercePaymentRecoveryService.js", "safeMetadata?.receiptEvidence", "Recovery service must exclude receipt-submitted attempts.");
    includes("backend/models/PaymentAttempt.js", 'ownerId: 1, "owner.type": 1, provider: 1, status: 1, expiresAt: 1, createdAt: -1', "PaymentAttempt must index owner-scoped recovery discovery.");
    includes("frontend/js/payment/pending-payment-recovery.js", "/api/commerce/payments/recoverable", "Frontend must fetch server-discoverable Commerce attempts.");
    includes("frontend/js/payment/pending-payment-recovery.js", "mergeRecoverableAttempts", "Frontend must merge Commerce and legacy attempts.");
    includes("frontend/js/payment/pending-payment-recovery.js", "architecture: \"commerce\"", "Frontend must tag Commerce attempts.");
    includes("frontend/js/payment/pending-payment-recovery.js", "architecture: \"legacy\"", "Frontend must tag legacy attempts.");
    includes("frontend/js/payment/pending-payment-recovery.js", "clearCommerceMarker()", "Frontend must clear stale Commerce markers.");
    includes("frontend/js/payment/pending-payment-recovery.js", "selected || null", "Commerce resume must not require the localStorage marker.");
    includes("frontend/js/payment/pending-payment-recovery.js", "/api/payment/manual/recoverable", "Legacy recovery endpoint must remain used.");
    notIncludes("frontend/js/payment/pending-payment-recovery.js", "createPromptPayQr", "Recovery must not create new QR codes.");
}

(async () => {
    await verifyServiceBehavior();
    verifyStaticIntegration();
    console.log("Commerce pending payment recovery verifier passed.");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
