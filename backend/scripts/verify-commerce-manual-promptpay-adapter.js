"use strict";

const assert = require("assert");
const { createProviderRegistry } = require("../services/commerce/providerRegistry");
const { createManualPromptPayProvider } = require("../services/commerce/manualPromptPayProviderFactory");
const {
    createPaymentOrchestrator,
    PaymentOrchestratorError,
    PAYMENT_STATES
} = require("../services/commerce/paymentOrchestrator");

const NOW = new Date("2026-07-26T12:00:00.000Z");

function clone(value) {
    return structuredClone(value);
}

function owner() {
    return { userId: "user-1", sessionId: "", type: "USER" };
}

function baseOrder(overrides = {}) {
    return {
        orderId: "AZL-ORDER-0001",
        quoteId: "AZQ-0001",
        status: "pending_payment",
        paymentStatus: "unpaid",
        owner: owner(),
        commercial: {
            totalAmount: 1490,
            currency: "THB",
            region: "TH"
        },
        payment: {
            paymentMethodId: "promptpay",
            paymentChannel: "manual",
            provider: "MANUAL_PROMPTPAY",
            providerType: "manual_promptpay",
            confirmationMode: "manual_admin",
            status: "unpaid"
        },
        fulfilment: { status: "not_started" },
        ...overrides
    };
}

function createQrService(calls) {
    return async function fakeQrService({ method, amount, currency, orderReference }) {
        calls.push({ method: clone(method), amount, currency, orderReference });
        assert.strictEqual(method.promptPayRecipientType, "PHONE", "QR recipient type is server-owned.");
        assert.strictEqual(method.promptPayRecipientValue, "0812345678", "QR recipient value is server-owned.");
        assert.strictEqual(currency, "THB", "QR utility receives THB.");
        assert.strictEqual(Number(amount), 1490, "QR utility receives canonical order amount.");
        assert(orderReference.startsWith("AZL-AZL-ORDER-0001-ATT-"), "QR reference is bound to order and attempt.");
        return {
            paymentMethodKey: "commerce_manual_promptpay",
            amount,
            currency: "THB",
            orderReference,
            encodedReference: orderReference,
            qrPayload: `PROMPTPAY|${amount.toFixed ? amount.toFixed(2) : Number(amount).toFixed(2)}|${orderReference}`,
            encodedAmount: Number(amount).toFixed(2),
            decodedPayload: { amountText: Number(amount).toFixed(2), currency: "764", country: "TH" },
            qrImagePayloadMatches: true,
            qrImage: `data:image/png;base64,${Buffer.from(`PNG:${orderReference}:${amount}`).toString("base64")}`,
            expiresAt: "2026-07-26T12:15:00.000Z"
        };
    };
}

function matchesOwner(recordOwner = {}, expected = {}) {
    return expected.userId ? recordOwner.userId === expected.userId : recordOwner.sessionId === expected.sessionId;
}

function createStore(overrides = {}) {
    return {
        orders: [baseOrder(overrides.order || {})],
        attempts: (overrides.attempts || []).map(clone),
        calls: {
            createAttempt: 0,
            setProviderReference: 0,
            updateAttemptStatus: 0,
            updatePaymentStatus: 0,
            appendProviderEvent: 0,
            transactions: 0
        },
        txContexts: [],
        qrCalls: [],
        options: overrides
    };
}

function currentOrderPaymentStatus(order) {
    return String(order.paymentStatus || order.payment?.status || "unpaid");
}

function createAttemptPort(store) {
    return {
        async findActiveAttemptForOrder({ orderId, owner: requestedOwner }) {
            return clone(store.attempts.find(attempt => (
                attempt.orderId === orderId &&
                matchesOwner(attempt.owner, requestedOwner) &&
                ["INITIATING", "PENDING"].includes(attempt.status)
            )) || null);
        },
        async findAttemptByIdempotency({ orderId, owner: requestedOwner, idempotencyKey, operation }) {
            return clone(store.attempts.find(attempt => (
                attempt.orderId === orderId &&
                attempt.idempotencyKey === idempotencyKey &&
                attempt.operation === operation &&
                matchesOwner(attempt.owner, requestedOwner)
            )) || null);
        },
        async findAttemptByIdForOwner({ attemptId, owner: requestedOwner }) {
            return clone(store.attempts.find(attempt => attempt.attemptId === attemptId && matchesOwner(attempt.owner, requestedOwner)) || null);
        },
        async findAttemptByProviderReference({ providerReference }) {
            return clone(store.attempts.find(attempt => attempt.providerReference === providerReference) || null);
        },
        async createAttempt(payload) {
            assert(payload.transactionContext, "attempt create receives transaction context.");
            store.calls.createAttempt += 1;
            const attempt = {
                ...clone(payload),
                webhookEvents: [],
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString()
            };
            delete attempt.transactionContext;
            store.attempts.push(attempt);
            return clone(attempt);
        },
        async setProviderReference({ attemptId, providerReference, providerTransactionId, rawProviderStatus, transactionContext }) {
            assert(transactionContext, "provider reference write receives transaction context.");
            store.calls.setProviderReference += 1;
            const attempt = store.attempts.find(item => item.attemptId === attemptId);
            attempt.providerReference = providerReference;
            attempt.providerTransactionId = providerTransactionId;
            attempt.rawProviderStatus = rawProviderStatus;
            return clone(attempt);
        },
        async updateAttemptStatus({ attemptId, fromStatuses, toStatus, transactionContext }) {
            assert(transactionContext, "attempt status update receives transaction context.");
            store.calls.updateAttemptStatus += 1;
            const attempt = store.attempts.find(item => item.attemptId === attemptId);
            assert(fromStatuses.includes(attempt.status), "attempt transition is conditional.");
            attempt.status = toStatus;
            attempt.updatedAt = NOW.toISOString();
            return clone(attempt);
        },
        async appendProviderEvent({ attemptId, providerEvent, transactionContext }) {
            assert(transactionContext, "provider event append receives transaction context.");
            store.calls.appendProviderEvent += 1;
            const attempt = store.attempts.find(item => item.attemptId === attemptId);
            attempt.webhookEvents = [...(attempt.webhookEvents || []), clone(providerEvent)];
            return clone(attempt);
        },
        async recordFailure() {}
    };
}

function createHarness(overrides = {}) {
    const store = createStore(overrides);
    const registry = createProviderRegistry();
    const provider = createManualPromptPayProvider({
        configuration: {
            enabled: true,
            recipientType: "PHONE",
            recipientValue: "0812345678",
            recipientDisplayName: "AZIEL PromptPay",
            defaultExpiryMinutes: 15,
            environment: "test",
            referencePrefix: "AZL"
        },
        qrService: createQrService(store.qrCalls),
        clock: () => new Date(NOW.getTime())
    });
    registry.registerProvider(provider);
    const orchestrator = createPaymentOrchestrator({
        clock: () => new Date(NOW.getTime()),
        idGenerator(kind) {
            const next = store.attempts.length + 1;
            return kind === "paymentIntent" ? `PI-${next}` : `ATT-${next}`;
        },
        logger: { info() {}, warn() {}, error() {} },
        async transactionRunner(callback) {
            store.calls.transactions += 1;
            const transactionContext = { mongoSession: `session-${store.calls.transactions}` };
            store.txContexts.push(transactionContext);
            return callback(transactionContext);
        },
        providerResolver({ intent }) {
            return registry.resolveProvider({ intent });
        },
        orderRepository: {
            async findOwnedOrderById({ orderId, owner: requestedOwner }) {
                return clone(store.orders.find(order => order.orderId === orderId && matchesOwner(order.owner, requestedOwner)) || null);
            },
            async findOrderById({ orderId }) {
                return clone(store.orders.find(order => order.orderId === orderId) || null);
            },
            async updatePaymentStatus({ orderId, fromStatuses, toStatus }, { transactionContext } = {}) {
                assert(transactionContext, "order status update receives transaction context.");
                store.calls.updatePaymentStatus += 1;
                const order = store.orders.find(item => item.orderId === orderId);
                assert(fromStatuses.includes(currentOrderPaymentStatus(order)), "order transition is conditional.");
                order.paymentStatus = toStatus;
                order.payment = { ...(order.payment || {}), status: toStatus };
                return clone(order);
            }
        },
        paymentAttemptPort: createAttemptPort(store)
    });
    return { store, registry, provider, orchestrator };
}

async function expectPaymentError(fn, code, label) {
    await Promise.resolve()
        .then(fn)
        .then(() => {
            throw new Error(`Expected ${code}: ${label}`);
        })
        .catch(error => {
            assert(error instanceof PaymentOrchestratorError, `${label}: expected orchestrator error.`);
            assert.strictEqual(error.code, code, label);
        });
}

async function testAdapterRegistrationAndCapabilities() {
    const { registry, provider } = createHarness();
    assert.strictEqual(provider.providerId, "MANUAL_PROMPTPAY", "provider identity is canonical.");
    assert(provider.supportsCapability("CREATE_PAYMENT"), "provider creates payments.");
    assert(provider.supportsCapability("QR_CODE"), "provider supports QR code.");
    assert(provider.supportsCapability("MANUAL_APPROVAL"), "provider supports manual approval.");
    assert(!provider.supportsCapability("WEBHOOK"), "provider does not claim webhook automation.");
    assert(!provider.supportsCapability("REFUND"), "provider does not claim refund.");
    assert(!provider.supportsCapability("CANCEL_PAYMENT"), "local cancel is not advertised as external bank cancellation.");
    assert.strictEqual(registry.resolveProvider({ paymentMethodId: "promptpay" }).providerId, "MANUAL_PROMPTPAY", "registry resolves by payment method.");
    assert.strictEqual(registry.resolveProvider({ providerId: "MANUAL_PROMPTPAY" }).providerId, "MANUAL_PROMPTPAY", "registry resolves by provider.");
}

async function testPendingPaymentCreation() {
    const { store, orchestrator } = createHarness();
    const result = await orchestrator.initiatePayment({
        orderId: "AZL-ORDER-0001",
        owner: owner(),
        idempotencyKey: "manual-1",
        amount: 1,
        currency: "MMK",
        recipientValue: "0999999999"
    });
    assert.strictEqual(result.paymentStatus, "pending", "QR initiation returns pending only.");
    assert.strictEqual(store.orders[0].paymentStatus, "pending", "order enters pending payment.");
    assert.strictEqual(store.orders[0].fulfilment.status, "not_started", "fulfilment is untouched.");
    assert.strictEqual(store.qrCalls.length, 1, "QR is generated once.");
    assert.strictEqual(result.qr.sourceType, "dynamic_response", "response uses generated dynamic QR.");
    assert.strictEqual(result.qr.encodedAmount, "1490.00", "QR encodes exact amount.");
    assert(result.qr.encodedReference.includes("AZL-ORDER-0001"), "QR reference binds order.");
    assert(!JSON.stringify(result).includes("0812345678"), "raw recipient is not exposed.");
    assert(result.metadata.outcome === "created", "public result records created outcome.");
}

async function testClientRecipientOverrideRejectedByAdapter() {
    const { provider } = createHarness();
    await assert.rejects(
        () => provider.createPayment({
            input: { promptPayRecipientValue: "0999999999" },
            intent: {
                orderId: "AZL-ORDER-0001",
                quoteId: "AZQ-0001",
                amount: 1490,
                currency: "THB"
            },
            attempt: {
                attemptId: "ATT-DIRECT",
                orderId: "AZL-ORDER-0001",
                amount: 1490,
                currency: "THB"
            }
        }),
        /server-owned/,
        "client recipient override rejected before QR generation"
    );
}

async function testUnsupportedInputsFailClosed() {
    assert.throws(() => createManualPromptPayProvider({
        configuration: {
            enabled: false,
            recipientType: "PHONE",
            recipientValue: "0812345678",
            environment: "test"
        }
    }), /disabled/, "disabled configuration fails.");
    assert.throws(() => createManualPromptPayProvider({
        configuration: {
            enabled: true,
            recipientType: "PHONE",
            recipientValue: "abc",
            environment: "test"
        }
    }), /recipient/, "invalid recipient fails.");
    const { orchestrator } = createHarness({ order: { commercial: { totalAmount: 1490, currency: "MMK", region: "MM" } } });
    await expectPaymentError(
        () => orchestrator.initiatePayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "bad-currency" }),
        "PAYMENT_PROVIDER_ERROR",
        "non-THB order fails closed"
    );
}

async function testRefreshExpireCancelBoundaries() {
    const { store, orchestrator } = createHarness();
    const pending = await orchestrator.initiatePayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "state-1" });
    const duplicate = await orchestrator.initiatePayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "state-2" });
    assert.strictEqual(duplicate.attemptId, pending.attemptId, "existing active attempt prevents duplicate QR/payment.");
    assert.strictEqual(store.qrCalls.length, 1, "duplicate active attempt does not generate a second QR.");

    const refreshed = await orchestrator.refreshPayment({ attemptId: pending.attemptId, owner: owner() });
    assert.strictEqual(refreshed.paymentStatus, "pending", "refresh does not infer paid from bank state.");

    const expiredHarness = createHarness();
    const expiring = await expiredHarness.orchestrator.initiatePayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "expire-1" });
    const expired = await expiredHarness.orchestrator.expirePayment({ attemptId: expiring.attemptId, owner: owner() });
    const expiredAgain = await expiredHarness.orchestrator.expirePayment({ attemptId: expiring.attemptId, owner: owner() });
    assert.strictEqual(expired.paymentStatus, "expired", "pending attempt expires.");
    assert.strictEqual(expiredAgain.idempotent, true, "expiry is idempotent.");

    const cancelledHarness = createHarness();
    const active = await cancelledHarness.orchestrator.initiatePayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "cancel-1" });
    const cancelled = await cancelledHarness.orchestrator.cancelPayment({ attemptId: active.attemptId, owner: owner() });
    assert.strictEqual(cancelled.paymentStatus, "cancelled", "manual local cancellation is normalized.");
}

async function testManualApprovalAndRejectionEvents() {
    const { store, orchestrator } = createHarness();
    const pending = await orchestrator.initiatePayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "approve-1" });
    const providerReference = store.attempts[0].providerReference;
    await expectPaymentError(
        () => orchestrator.handleProviderEvent({
            providerEvent: {
                provider: "MANUAL_PROMPTPAY",
                providerReference,
                providerEventId: "evt-untrusted",
                eventType: "MANUAL_PAYMENT_APPROVED",
                amount: 1490,
                currency: "THB",
                metadata: { receiptId: "receipt-1" }
            }
        }),
        "PAYMENT_PROVIDER_ERROR",
        "untrusted manual approval rejected"
    );
    const approved = await orchestrator.handleProviderEvent({
        trustedOperational: true,
        providerEvent: {
            provider: "MANUAL_PROMPTPAY",
            providerReference,
            providerEventId: "evt-approve-1",
            eventType: "MANUAL_PAYMENT_APPROVED",
            amount: 1490,
            currency: "THB",
            metadata: {
                receiptId: "receipt-1",
                verifiedBy: "owner-1",
                verificationMethod: "admin_manual"
            }
        }
    });
    assert.strictEqual(approved.paymentStatus, "paid", "trusted manual approval marks payment paid.");
    assert.strictEqual(store.orders[0].fulfilment.status, "not_started", "paid payment does not complete fulfilment.");
    const duplicate = await orchestrator.handleProviderEvent({
        trustedOperational: true,
        providerEvent: {
            provider: "MANUAL_PROMPTPAY",
            providerReference,
            providerEventId: "evt-approve-1",
            eventType: "MANUAL_PAYMENT_APPROVED",
            amount: 1490,
            currency: "THB",
            metadata: { receiptId: "receipt-1" }
        }
    });
    assert.strictEqual(duplicate.idempotent, true, "duplicate manual approval is idempotent.");

    const rejectedHarness = createHarness();
    const rejectedPending = await rejectedHarness.orchestrator.initiatePayment({
        orderId: "AZL-ORDER-0001",
        owner: owner(),
        idempotencyKey: "reject-1"
    });
    const rejected = await rejectedHarness.orchestrator.handleProviderEvent({
        trustedOperational: true,
        providerEvent: {
            provider: "MANUAL_PROMPTPAY",
            providerReference: rejectedHarness.store.attempts[0].providerReference,
            providerEventId: "evt-reject-1",
            eventType: "MANUAL_PAYMENT_REJECTED",
            amount: 1490,
            currency: "THB",
            metadata: { verifiedBy: "owner-1", note: "Slip mismatch" }
        }
    });
    assert.strictEqual(rejectedPending.paymentStatus, "pending", "rejection starts from pending.");
    assert.strictEqual(rejected.paymentStatus, "failed", "manual rejection maps to FAILED.");
}

async function testApprovalSafetyFailures() {
    const mismatchHarness = createHarness();
    await mismatchHarness.orchestrator.initiatePayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "mismatch" });
    const ref = mismatchHarness.store.attempts[0].providerReference;
    await expectPaymentError(
        () => mismatchHarness.orchestrator.handleProviderEvent({
            trustedOperational: true,
            providerEvent: {
                provider: "MANUAL_PROMPTPAY",
                providerReference: ref,
                providerEventId: "evt-bad-amount",
                eventType: "MANUAL_PAYMENT_APPROVED",
                amount: 1491,
                currency: "THB",
                metadata: { receiptId: "receipt-1" }
            }
        }),
        "PAYMENT_PROVIDER_ERROR",
        "amount mismatch rejected"
    );
    await expectPaymentError(
        () => mismatchHarness.orchestrator.handleProviderEvent({
            trustedOperational: true,
            providerEvent: {
                provider: "MANUAL_PROMPTPAY",
                providerReference: ref,
                providerEventId: "evt-bad-currency",
                eventType: "MANUAL_PAYMENT_APPROVED",
                amount: 1490,
                currency: "MMK",
                metadata: { receiptId: "receipt-1" }
            }
        }),
        "PAYMENT_PROVIDER_ERROR",
        "currency mismatch rejected"
    );
    await expectPaymentError(
        () => mismatchHarness.orchestrator.handleProviderEvent({
            trustedOperational: true,
            providerEvent: {
                provider: "MANUAL_PROMPTPAY",
                providerReference: ref,
                providerEventId: "evt-no-receipt",
                eventType: "MANUAL_PAYMENT_APPROVED",
                amount: 1490,
                currency: "THB"
            }
        }),
        "PAYMENT_PROVIDER_ERROR",
        "approval without receipt rejected"
    );

    const expiredHarness = createHarness();
    const pending = await expiredHarness.orchestrator.initiatePayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "expired-approve" });
    const expiredRef = expiredHarness.store.attempts[0].providerReference;
    await expiredHarness.orchestrator.expirePayment({ attemptId: pending.attemptId, owner: owner() });
    await expectPaymentError(
        () => expiredHarness.orchestrator.handleProviderEvent({
            trustedOperational: true,
            providerEvent: {
                provider: "MANUAL_PROMPTPAY",
                providerReference: expiredRef,
                providerEventId: "evt-expired-approve",
                eventType: "MANUAL_PAYMENT_APPROVED",
                amount: 1490,
                currency: "THB",
                metadata: { receiptId: "receipt-1" }
            }
        }),
        "PAYMENT_PROVIDER_ERROR",
        "expired attempt approval rejected"
    );
}

async function testReceiptMetadataIsEvidenceOnly() {
    const { provider } = createHarness();
    const receipt = require("../services/commerce/providers/manualPromptPayAdapter")
        .normalizeManualPromptPayReceiptMetadata({
            receiptId: "receipt-1",
            fileName: "slip.png",
            contentType: "image/png",
            rawPayload: "not copied"
        });
    assert.deepStrictEqual(receipt, {
        receiptId: "receipt-1",
        uploadedAt: "",
        fileName: "slip.png",
        contentType: "image/png"
    }, "receipt metadata is compact evidence only.");
    assert(provider.supportsCapability("MANUAL_APPROVAL"), "receipt upload still requires manual approval capability.");
}

async function run() {
    await testAdapterRegistrationAndCapabilities();
    await testPendingPaymentCreation();
    await testClientRecipientOverrideRejectedByAdapter();
    await testUnsupportedInputsFailClosed();
    await testRefreshExpireCancelBoundaries();
    await testManualApprovalAndRejectionEvents();
    await testApprovalSafetyFailures();
    await testReceiptMetadataIsEvidenceOnly();

    console.log("Commerce Manual PromptPay adapter verification passed.");
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
