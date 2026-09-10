"use strict";

const assert = require("assert");
const {
    createCommercePaymentRecoveryService,
    attemptRecoverable
} = require("../services/commerce/commercePaymentRecoveryService");

const now = new Date("2026-08-01T00:00:00.000Z");
const owner = { type: "USER", userId: "user-1", sessionId: "" };
const order = {
    orderId: "CO-1",
    owner,
    status: "pending_payment",
    paymentStatus: "pending"
};

function createAttempt(provider, attemptId) {
    return {
        attemptId,
        orderId: order.orderId,
        owner,
        provider,
        status: "PENDING",
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        safeMetadata: {},
        qr: {
            image: "data:image/png;base64,abc",
            mode: "aziel_promptpay_dynamic"
        }
    };
}

(async () => {
    const promptpayAttempt = createAttempt("promptpay", "PAY-1");
    const legacyAttempt = createAttempt("MANUAL_PROMPTPAY", "PAY-2");
    const unrelatedAttempt = createAttempt("stripe", "PAY-3");
    const tmwCheckpointedAttempt = { ...createAttempt("TMW", "PAY-TMW-1"), status: "INITIATING", expiresAt: null, providerReference: "754399", qr: null };
    const queriedProviders = [];
    const recoveryQueries = [];

    const service = createCommercePaymentRecoveryService({
        clock: () => now,
        paymentAttemptRepository: {
            findAttemptsForOwner: async input => {
                queriedProviders.push(input.provider);
                recoveryQueries.push(input);
                if (input.provider === "promptpay") return [promptpayAttempt];
                if (input.provider === "MANUAL_PROMPTPAY") return [legacyAttempt];
                if (input.provider === "TMW") return [tmwCheckpointedAttempt];
                return [];
            }
        },
        commerceOrderRepository: {
            findOwnedOrdersByIds: async () => [order]
        }
    });

    const recovered = await service.listRecoverablePayments({ user: { id: owner.userId } });

    assert.deepStrictEqual(
        queriedProviders.sort(),
        ["MANUAL_ADMIN", "MANUAL_PROMPTPAY", "TMW", "promptpay"].sort(),
        "recovery must query Manual PromptPay aliases and TMW"
    );
    assert.deepStrictEqual(
        recovered.map(item => item.attemptId).sort(),
        [promptpayAttempt.attemptId, legacyAttempt.attemptId, tmwCheckpointedAttempt.attemptId].sort(),
        "Manual PromptPay aliases and a checkpointed INITIATING TMW attempt must be recovered"
    );
    assert.strictEqual(Object.hasOwn(recoveryQueries.find(item => item.provider === "TMW"), "expiresAfter"), false, "checkpointed TMW attempts without a QR expiry must remain discoverable");
    assert.strictEqual(
        attemptRecoverable(unrelatedAttempt, order, owner, now),
        false,
        "an unrelated provider must not be recovered"
    );

    console.log("Commerce payment recovery provider alias tests passed.");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
