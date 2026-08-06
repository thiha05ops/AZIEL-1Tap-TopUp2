"use strict";

const assert = require("assert");
const {
    createPaymentOrchestrator
} = require("../services/commerce/paymentOrchestrator");
const paymentAttemptRepository = require("../services/commerce/paymentAttemptRepository");

const now = new Date("2026-08-01T08:00:00.000Z");
const expiresAt = "2026-08-01T08:15:00.000Z";
const owner = { type: "USER", userId: "user-1", sessionId: "" };
const order = {
    orderId: "AZL-ORDER-1",
    quoteId: "AZQ-1",
    owner,
    status: "pending_payment",
    paymentStatus: "unpaid",
    commercial: { totalAmount: 100, currency: "THB", region: "TH" },
    payment: {
        paymentMethodId: "promptpay",
        paymentChannel: "MANUAL_PROMPTPAY",
        provider: "promptpay",
        status: "unpaid"
    }
};
const providerResult = {
    provider: "promptpay",
    providerReference: "AZL-REF-1",
    providerTransactionId: "AZL-REF-1",
    rawProviderStatus: "pending",
    status: "PENDING",
    amount: 100,
    currency: "THB",
    expiresAt,
    qr: {
        image: "data:image/png;base64,QR",
        payload: "000201-provider-qr",
        mode: "aziel_promptpay_dynamic",
        encodedReference: "AZL-REF-1"
    },
    paymentInstructions: { title: "PromptPay QR" },
    safeMetadata: { orderId: order.orderId, rawPayload: "must-not-persist" }
};

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function matches(record, query) {
    return Object.entries(query).every(([key, expected]) => {
        const actual = key.split(".").reduce((value, part) => value?.[part], record);
        if (expected && Array.isArray(expected.$in)) return expected.$in.includes(actual);
        return actual === expected;
    });
}

function createModel() {
    const model = {
        records: [],
        findOne(query) {
            return { lean() { return this; }, exec: async () => clone(model.records.find(row => matches(row, query)) || null) };
        },
        findOneAndUpdate(query, update) {
            return {
                exec: async () => {
                    const record = model.records.find(row => matches(row, query));
                    if (!record) return null;
                    Object.assign(record, clone(update.$set || {}));
                    return clone(record);
                }
            };
        },
        async create(rows) {
            model.records.push(...rows.map(clone));
            return rows.map(clone);
        }
    };
    return model;
}

(async () => {
    const model = createModel();
    const attemptPort = {
        findAttemptByIdempotency: input => paymentAttemptRepository.findAttemptByIdempotency(input, { model }),
        findActiveAttemptForOrder: async () => null,
        createAttempt: input => paymentAttemptRepository.createAttempt(input, { model }),
        setProviderReference: input => paymentAttemptRepository.setProviderReference(input, { model }),
        updateAttemptStatus: input => paymentAttemptRepository.updateAttemptStatus(input, { model }),
        recordFailure: async () => null
    };
    const orchestrator = createPaymentOrchestrator({
        clock: () => now,
        idGenerator: kind => kind === "paymentIntent" ? "PI-1" : "ATT-1",
        transactionRunner: callback => callback({ mongoSession: null }),
        orderRepository: {
            findOwnedOrderById: async () => clone(order),
            updatePaymentStatus: async input => ({
                ...clone(order),
                paymentStatus: input.toStatus,
                payment: { ...order.payment, status: input.toStatus }
            })
        },
        paymentAttemptPort: attemptPort,
        providerResolver: async () => ({ createPayment: async () => clone(providerResult) })
    });

    assert(providerResult.qr.image && providerResult.expiresAt, "provider result must contain QR and expiry");
    const returned = await orchestrator.initiatePayment({
        orderId: order.orderId,
        owner,
        idempotencyKey: "idem-1"
    });
    const persisted = await paymentAttemptRepository.findAttemptById({ attemptId: returned.attemptId }, { model });

    assert.deepStrictEqual(persisted.qr, providerResult.qr, "persisted attempt must contain the provider QR");
    assert.strictEqual(new Date(persisted.expiresAt).toISOString(), expiresAt, "persisted attempt must contain provider expiry");
    assert.deepStrictEqual(returned.qr, persisted.qr, "returned and persisted QR must match");
    assert.strictEqual(new Date(returned.expiresAt).toISOString(), new Date(persisted.expiresAt).toISOString(), "returned and persisted expiry must match");
    assert.strictEqual(persisted.status, "PENDING", "existing status transition must remain PENDING");
    assert.strictEqual(persisted.safeMetadata.rawPayload, undefined, "raw provider payload must not persist");
    assert(persisted.qr.image && persisted.expiresAt, "recovery-shaped read must see QR and expiry");

    console.log("Commerce provider-result persistence verification passed.");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
