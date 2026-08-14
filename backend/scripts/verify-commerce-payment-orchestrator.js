"use strict";

const assert = require("assert");
const {
    createPaymentOrchestrator,
    PaymentOrchestratorError,
    ERROR_CODES,
    PAYMENT_STATES
} = require("../services/commerce/paymentOrchestrator");

const NOW = new Date("2026-07-26T12:00:00.000Z");

function clone(value) {
    return structuredClone(value);
}

function owner(overrides = {}) {
    return { userId: "user-1", sessionId: "", ...overrides };
}

function order(overrides = {}) {
    const status = overrides.paymentStatus || overrides.payment?.status || "unpaid";
    return {
        orderId: "AZL-ORDER-0001",
        quoteId: "AZQ-0001",
        status: "pending_payment",
        paymentStatus: status,
        owner: owner(),
        commercial: {
            totalAmount: 1490,
            currency: "THB",
            region: "TH"
        },
        payment: {
            paymentMethodId: "promptpay",
            paymentChannel: "manual",
            provider: "manual_promptpay",
            providerType: "manual_promptpay",
            confirmationMode: "manual_admin",
            status
        },
        fulfilment: { status: "not_started" },
        ...overrides
    };
}

function paymentResult(overrides = {}) {
    return {
        provider: "manual_promptpay",
        providerReference: "PREF-1",
        providerTransactionId: "PREF-1",
        status: PAYMENT_STATES.PENDING,
        amount: 1490,
        currency: "THB",
        expiresAt: "2026-07-26T12:15:00.000Z",
        qr: { image: "data:image/png;base64,QR", payload: "000201" },
        paymentInstructions: { title: "PromptPay QR" },
        safeMetadata: { orderId: "AZL-ORDER-0001" },
        rawProviderStatus: "pending",
        ...overrides
    };
}

function matchesOwner(recordOwner = {}, expected = {}) {
    if (expected.userId) return recordOwner.userId === expected.userId;
    if (expected.sessionId) return recordOwner.sessionId === expected.sessionId;
    return false;
}

function createStore(options = {}) {
    return {
        orders: [order(options.order || {})],
        attempts: (options.attempts || []).map(clone),
        providerEvents: [],
        calls: {
            createPayment: 0,
            refreshPayment: 0,
            cancelPayment: 0,
            expirePayment: 0,
            createAttempt: 0,
            updateAttemptStatus: 0,
            updatePaymentStatus: 0,
            updateOrderStatus: 0,
            appendProviderEvent: 0,
            recordFailure: 0,
            transactions: 0
        },
        txContexts: [],
        providerInputs: [],
        options
    };
}

function currentPaymentStatus(orderRecord) {
    return String(orderRecord.paymentStatus || orderRecord.payment?.status || "unpaid");
}

function createDeps(store, overrides = {}) {
    const providerAdapter = overrides.adapter || {
        providerType: "manual_promptpay",
        providerKey: "manual_promptpay",
        async createPayment(input) {
            store.calls.createPayment += 1;
            store.providerInputs.push(clone(input));
            if (store.options.providerThrows) throw Object.assign(new Error("provider down"), { code: "PROVIDER_DOWN", retryable: true });
            return paymentResult(store.options.providerResult || {});
        },
        async refreshPayment(input) {
            store.calls.refreshPayment += 1;
            store.providerInputs.push(clone(input));
            return paymentResult(store.options.refreshResult || { status: PAYMENT_STATES.PAID, rawProviderStatus: "paid" });
        },
        async cancelPayment(input) {
            store.calls.cancelPayment += 1;
            store.providerInputs.push(clone(input));
            return paymentResult({ status: PAYMENT_STATES.CANCELLED });
        },
        async expirePayment(input) {
            store.calls.expirePayment += 1;
            store.providerInputs.push(clone(input));
            return paymentResult({ status: PAYMENT_STATES.EXPIRED });
        }
    };

    const deps = {
        clock: () => new Date(NOW.getTime()),
        idGenerator(kind) {
            const count = store.attempts.length + 1;
            return kind === "paymentIntent" ? `PI-${count}` : `ATT-${count}`;
        },
        logger: { info() {}, warn() {}, error() {} },
        async transactionRunner(callback) {
            store.calls.transactions += 1;
            const transactionContext = { mongoSession: `session-${store.calls.transactions}`, txId: `tx-${store.calls.transactions}` };
            store.txContexts.push(transactionContext);
            const ordersBefore = clone(store.orders);
            const attemptsBefore = clone(store.attempts);
            try {
                return await callback(transactionContext);
            } catch (error) {
                store.orders.splice(0, store.orders.length, ...ordersBefore);
                store.attempts.splice(0, store.attempts.length, ...attemptsBefore);
                throw error;
            }
        },
        providerResolver({ intent }) {
            assert.strictEqual(intent.amount, 1490, "provider resolver receives order amount.");
            assert.strictEqual(intent.currency, "THB", "provider resolver receives order currency.");
            return providerAdapter;
        },
        orderRepository: {
            async findOwnedOrderById({ orderId, owner: requestedOwner }) {
                return clone(store.orders.find(item => item.orderId === orderId && matchesOwner(item.owner, requestedOwner)) || null);
            },
            async findOrderById(orderId, options = {}) {
                assert.strictEqual(typeof orderId, "string", "operational order lookup receives the scalar business order id.");
                if (options.transactionContext) {
                    assert.strictEqual(options.session, options.transactionContext.session, "operational lookup propagates transaction session.");
                    assert.strictEqual(options.mongoSession, options.transactionContext.mongoSession, "operational lookup propagates mongo session.");
                }
                return clone(store.orders.find(item => item.orderId === orderId) || null);
            },
            async updatePaymentStatus({ orderId, fromStatuses, toStatus }, { transactionContext } = {}) {
                assert(transactionContext, "order payment update receives transaction context.");
                store.calls.updatePaymentStatus += 1;
                if (store.options.failOrderPaymentUpdate) throw Object.assign(new Error("controlled order update failure"), { code: "ORDER_UPDATE_FAILED" });
                const item = store.orders.find(candidate => candidate.orderId === orderId);
                assert(item, "order exists for status update.");
                assert(fromStatuses.includes(currentPaymentStatus(item)), "order status update is conditional.");
                item.paymentStatus = toStatus;
                item.payment = { ...(item.payment || {}), status: toStatus };
                item.updatedAt = NOW.toISOString();
                return clone(item);
            },
            async updateOrderStatus({ orderId, fromStatuses, toStatus }, { transactionContext } = {}) {
                assert(transactionContext, "top-level order update receives transaction context.");
                store.calls.updateOrderStatus += 1;
                const item = store.orders.find(candidate => candidate.orderId === orderId);
                assert(item && fromStatuses.includes(item.status), "top-level order transition is conditional.");
                item.status = toStatus;
                item.updatedAt = NOW.toISOString();
                return clone(item);
            }
        },
        paymentAttemptPort: {
            async findActiveAttemptForOrder({ orderId, owner: requestedOwner }) {
                return clone(store.attempts.find(item => (
                    item.orderId === orderId &&
                    matchesOwner(item.owner, requestedOwner) &&
                    ["INITIATING", "PENDING"].includes(item.status)
                )) || null);
            },
            async findAttemptByIdempotency({ orderId, owner: requestedOwner, idempotencyKey, operation }) {
                return clone(store.attempts.find(item => (
                    item.orderId === orderId &&
                    item.idempotencyKey === idempotencyKey &&
                    item.operation === operation &&
                    matchesOwner(item.owner, requestedOwner)
                )) || null);
            },
            async findAttemptByIdForOwner({ attemptId, owner: requestedOwner }) {
                return clone(store.attempts.find(item => item.attemptId === attemptId && matchesOwner(item.owner, requestedOwner)) || null);
            },
            async findAttemptByProviderReference({ providerReference }) {
                return clone(store.attempts.find(item => item.providerReference === providerReference || item.providerTransactionId === providerReference) || null);
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
            async updateAttemptStatus({ attemptId, fromStatuses, toStatus, transactionContext }) {
                assert(transactionContext, "attempt status update receives transaction context.");
                store.calls.updateAttemptStatus += 1;
                if (store.options.failStatusUpdate) throw Object.assign(new Error("write conflict"), { code: "WRITE_CONFLICT" });
                const attempt = store.attempts.find(item => item.attemptId === attemptId);
                assert(attempt, "attempt exists for status update.");
                assert(fromStatuses.includes(attempt.status), "attempt status update is conditional.");
                attempt.status = toStatus;
                attempt.updatedAt = NOW.toISOString();
                return clone(attempt);
            },
            async setProviderReference({ attemptId, providerReference, providerTransactionId, rawProviderStatus, transactionContext }) {
                assert(transactionContext, "provider reference update receives transaction context.");
                const attempt = store.attempts.find(item => item.attemptId === attemptId);
                attempt.providerReference = providerReference;
                attempt.providerTransactionId = providerTransactionId;
                attempt.rawProviderStatus = rawProviderStatus;
                return clone(attempt);
            },
            async appendProviderEvent({ attemptId, providerEvent, transactionContext }) {
                assert(transactionContext, "provider event append receives transaction context.");
                store.calls.appendProviderEvent += 1;
                const attempt = store.attempts.find(item => item.attemptId === attemptId);
                attempt.webhookEvents = [...(attempt.webhookEvents || []), clone(providerEvent)];
                return clone(attempt);
            },
            async recordFailure({ attemptId, error }) {
                store.calls.recordFailure += 1;
                const attempt = store.attempts.find(item => item.attemptId === attemptId);
                if (attempt) {
                    attempt.failure = clone(error);
                    attempt.status = PAYMENT_STATES.FAILED;
                }
            },
            async listAttemptsForOrder({ orderId }) {
                return clone(store.attempts.filter(item => item.orderId === orderId));
            }
        },
        ...overrides
    };
    return deps;
}

function createOrchestrator(store, overrides = {}) {
    return createPaymentOrchestrator(createDeps(store, overrides));
}

async function assertPaymentError(fn, code, message) {
    await Promise.resolve()
        .then(fn)
        .then(() => {
            throw new Error(`Expected ${code}: ${message}`);
        })
        .catch(error => {
            assert(error instanceof PaymentOrchestratorError, `${message}: got ${error.name || "Error"} ${error.code || ""}`);
            assert.strictEqual(error.code, code, message);
        });
}

function initiateInput(overrides = {}) {
    return {
        orderId: "AZL-ORDER-0001",
        owner: owner(),
        idempotencyKey: "idem-1",
        amount: 1,
        currency: "MMK",
        discount: 9999,
        ...overrides
    };
}

async function testSuccessfulPendingInitiation() {
    const store = createStore();
    const result = await createOrchestrator(store).initiatePayment(initiateInput());
    assert.strictEqual(result.paymentStatus, "pending", "initiation returns pending.");
    assert.strictEqual(store.attempts[0].status, PAYMENT_STATES.PENDING, "attempt moved INITIATING -> PENDING.");
    assert.strictEqual(store.orders[0].paymentStatus, "pending", "order payment status is pending.");
    assert.strictEqual(store.orders[0].fulfilment.status, "not_started", "fulfilment remains not_started.");
}

async function testImmediatePayment() {
    const store = createStore({ providerResult: { status: PAYMENT_STATES.PAID, rawProviderStatus: "paid" } });
    const result = await createOrchestrator(store).initiatePayment(initiateInput());
    assert.strictEqual(result.paymentStatus, "paid", "immediate paid result returned.");
    assert.strictEqual(store.orders[0].paymentStatus, "paid", "order payment paid.");
    assert.strictEqual(store.orders[0].fulfilment.status, "not_started", "payment success does not complete fulfilment.");
}

async function testProviderFailureResult() {
    const store = createStore({ providerResult: { status: PAYMENT_STATES.FAILED, failure: { code: "DECLINED" } } });
    const result = await createOrchestrator(store).initiatePayment(initiateInput());
    assert.strictEqual(result.paymentStatus, "failed", "failed provider result is applied.");
    assert.strictEqual(store.attempts[0].status, PAYMENT_STATES.FAILED, "attempt moved INITIATING -> FAILED.");
}

async function testCanonicalAmountAndCurrency() {
    const store = createStore();
    await createOrchestrator(store).initiatePayment(initiateInput({ amount: 1, currency: "MMK" }));
    assert.strictEqual(store.providerInputs[0].intent.amount, 1490, "canonical amount comes from order.");
    assert.strictEqual(store.providerInputs[0].intent.currency, "THB", "canonical currency comes from order.");
    assert(!JSON.stringify(store.providerInputs[0].intent).includes("9999"), "provider receives no client-controlled discount.");
}

async function testIdempotentInitiation() {
    const store = createStore();
    const orchestrator = createOrchestrator(store);
    const first = await orchestrator.initiatePayment(initiateInput());
    const second = await orchestrator.initiatePayment(initiateInput());
    assert.strictEqual(first.attemptId, second.attemptId, "same active attempt reused.");
    assert.strictEqual(store.calls.createPayment, 1, "duplicate initiation does not call provider twice.");
}

async function testConflictingIdempotency() {
    const store = createStore();
    const orchestrator = createOrchestrator(store);
    await orchestrator.initiatePayment(initiateInput());
    store.attempts[0].status = PAYMENT_STATES.FAILED;
    store.attempts[0].requestFingerprint = "different-fingerprint";
    await assertPaymentError(
        () => orchestrator.initiatePayment(initiateInput({ orderId: "AZL-ORDER-0001", idempotencyKey: "idem-1" })),
        ERROR_CODES.PAYMENT_IDEMPOTENCY_CONFLICT,
        "conflicting idempotency fingerprint rejected"
    );
}

async function testExistingActiveAttemptPreventsDuplicateCharge() {
    const store = createStore({
        attempts: [{
            attemptId: "ATT-ACTIVE",
            orderId: "AZL-ORDER-0001",
            owner: owner(),
            status: PAYMENT_STATES.PENDING,
            amount: 1490,
            currency: "THB"
        }]
    });
    const result = await createOrchestrator(store).initiatePayment(initiateInput({ idempotencyKey: "other-key" }));
    assert.strictEqual(result.attemptId, "ATT-ACTIVE", "active attempt returned.");
    assert.strictEqual(store.calls.createPayment, 0, "provider not called for duplicate active attempt.");
}

async function testRetryRules() {
    const failedAttempt = {
        attemptId: "ATT-FAILED",
        orderId: "AZL-ORDER-0001",
        owner: owner(),
        status: PAYMENT_STATES.FAILED,
        amount: 1490,
        currency: "THB"
    };
    const store = createStore({ order: { paymentStatus: "failed", payment: { ...order().payment, status: "failed" } }, attempts: [failedAttempt] });
    const result = await createOrchestrator(store).retryPayment({ attemptId: "ATT-FAILED", owner: owner(), idempotencyKey: "retry-1" });
    assert.notStrictEqual(result.attemptId, "ATT-FAILED", "retry creates a new attempt.");
    assert.strictEqual(result.paymentStatus, "pending", "retry can re-enter pending.");

    const paidStore = createStore({ attempts: [{ ...failedAttempt, attemptId: "ATT-PAID", status: PAYMENT_STATES.PAID }] });
    await assertPaymentError(
        () => createOrchestrator(paidStore).retryPayment({ attemptId: "ATT-PAID", owner: owner() }),
        ERROR_CODES.PAYMENT_RETRY_NOT_ALLOWED,
        "paid retry rejected"
    );
}

async function testRefreshRules() {
    const attempt = {
        attemptId: "ATT-REFRESH",
        orderId: "AZL-ORDER-0001",
        owner: owner(),
        status: PAYMENT_STATES.PENDING,
        providerReference: "PREF-1",
        amount: 1490,
        currency: "THB"
    };
    const store = createStore({ order: { paymentStatus: "pending", payment: { ...order().payment, status: "pending" } }, attempts: [attempt] });
    const result = await createOrchestrator(store).refreshPayment({ attemptId: "ATT-REFRESH", owner: owner() });
    assert.strictEqual(result.paymentStatus, "paid", "refresh applies PENDING -> PAID.");

    const regressing = createStore({
        order: { paymentStatus: "paid", payment: { ...order().payment, status: "paid" } },
        attempts: [{ ...attempt, status: PAYMENT_STATES.PAID }]
    });
    await assertPaymentError(
        () => createOrchestrator(regressing, { adapter: { refreshPayment: async () => paymentResult({ status: PAYMENT_STATES.PENDING }) } }).refreshPayment({ attemptId: "ATT-REFRESH", owner: owner() }),
        ERROR_CODES.PAYMENT_INVALID_TRANSITION,
        "paid cannot regress to pending"
    );
}

async function testCancelAndExpireIdempotency() {
    const baseAttempt = {
        attemptId: "ATT-STATE",
        orderId: "AZL-ORDER-0001",
        owner: owner(),
        status: PAYMENT_STATES.PENDING,
        amount: 1490,
        currency: "THB"
    };
    const cancelStore = createStore({ order: { paymentStatus: "pending", payment: { ...order().payment, status: "pending" } }, attempts: [baseAttempt] });
    const cancelled = await createOrchestrator(cancelStore).cancelPayment({ attemptId: "ATT-STATE", owner: owner() });
    const cancelledAgain = await createOrchestrator(cancelStore).cancelPayment({ attemptId: "ATT-STATE", owner: owner() });
    assert.strictEqual(cancelled.paymentStatus, "cancelled", "cancel applies.");
    assert.strictEqual(cancelledAgain.idempotent, true, "cancel is idempotent.");

    const expireStore = createStore({ order: { paymentStatus: "pending", payment: { ...order().payment, status: "pending" } }, attempts: [{ ...baseAttempt, attemptId: "ATT-EXP" }] });
    const expired = await createOrchestrator(expireStore).expirePayment({ attemptId: "ATT-EXP", owner: owner() });
    const expiredAgain = await createOrchestrator(expireStore).expirePayment({ attemptId: "ATT-EXP", owner: owner() });
    assert.strictEqual(expired.paymentStatus, "expired", "expire applies.");
    assert.strictEqual(expiredAgain.idempotent, true, "expire is idempotent.");
}

async function testInvalidTransitions() {
    const orchestrator = createOrchestrator(createStore());
    assert.throws(() => orchestrator.assertTransition(PAYMENT_STATES.PAID, PAYMENT_STATES.FAILED), PaymentOrchestratorError, "PAID cannot become FAILED.");
    assert.throws(() => orchestrator.assertTransition(PAYMENT_STATES.REFUNDED, PAYMENT_STATES.PAID), PaymentOrchestratorError, "REFUNDED cannot become PAID.");
    assert.throws(() => orchestrator.assertTransition(PAYMENT_STATES.CANCELLED, PAYMENT_STATES.PENDING), PaymentOrchestratorError, "CANCELLED cannot become PENDING.");
    assert.throws(() => orchestrator.assertTransition(PAYMENT_STATES.EXPIRED, PAYMENT_STATES.PAID), PaymentOrchestratorError, "EXPIRED cannot become PAID without policy.");
}

async function testProviderEvents() {
    const baseAttempt = {
        attemptId: "ATT-EVENT",
        orderId: "AZL-ORDER-0001",
        owner: owner(),
        status: PAYMENT_STATES.PENDING,
        provider: "manual_promptpay",
        providerReference: "PREF-EVENT",
        amount: 1490,
        currency: "THB",
        webhookEvents: []
    };
    const store = createStore({ order: { paymentStatus: "pending", payment: { ...order().payment, status: "pending" } }, attempts: [baseAttempt] });
    const result = await createOrchestrator(store).handleProviderEvent({
        providerEvent: {
            provider: "manual_promptpay",
            providerReference: "PREF-EVENT",
            providerEventId: "evt-1",
            eventType: "MANUAL_PAYMENT_APPROVED",
            status: PAYMENT_STATES.PAID,
            amount: 1490,
            currency: "THB",
            orderId: "AZL-ORDER-0001"
        }
    });
    assert.strictEqual(result.paymentStatus, "paid", "provider event applies.");
    assert.strictEqual(store.attempts[0].status, PAYMENT_STATES.PAID, "provider event persists the PaymentAttempt PAID enum.");
    assert.strictEqual(store.orders[0].paymentStatus, "paid", "provider event persists the CommerceOrder payment status.");
    assert.strictEqual(store.orders[0].status, "paid", "payment approval advances the CommerceOrder top-level status without waiting for fulfilment.");
    assert.notStrictEqual(
        `${store.orders[0].status}:${store.orders[0].paymentStatus}`,
        "pending_payment:paid",
        "payment approval never exposes pending_payment with a paid payment"
    );
    assert.strictEqual(store.calls.updateOrderStatus, 1, "payment approval performs exactly one top-level paid transition.");
    assert.strictEqual(store.attempts[0].webhookEvents.length, 1, "approval history persists exactly once.");
    assert.strictEqual(store.attempts[0].webhookEvents[0].eventType, "MANUAL_PAYMENT_APPROVED", "approval history preserves event type.");
    const duplicate = await createOrchestrator(store).handleProviderEvent({
        providerEvent: {
            provider: "manual_promptpay",
            providerReference: "PREF-EVENT",
            providerEventId: "evt-1",
            eventType: "MANUAL_PAYMENT_APPROVED",
            status: PAYMENT_STATES.PAID,
            amount: 1490,
            currency: "THB",
            orderId: "AZL-ORDER-0001"
        }
    });
    assert.strictEqual(duplicate.idempotent, true, "duplicate provider event ignored safely.");
    assert.strictEqual(store.attempts[0].webhookEvents.length, 1, "duplicate approval does not append history twice.");
    assert.strictEqual(store.orders[0].status, "paid", "duplicate approval preserves the paid top-level state.");
    assert.strictEqual(store.calls.updateOrderStatus, 1, "duplicate approval does not repeat the top-level transition.");
}

async function testProviderEventAtomicRollback() {
    const attempt = {
        attemptId: "ATT-ROLLBACK",
        orderId: "AZL-ORDER-0001",
        owner: owner(),
        status: PAYMENT_STATES.PENDING,
        provider: "manual_promptpay",
        providerReference: "PREF-ROLLBACK",
        amount: 1490,
        currency: "THB",
        webhookEvents: []
    };
    const store = createStore({
        order: { paymentStatus: "pending", payment: { ...order().payment, status: "pending" } },
        attempts: [attempt],
        failOrderPaymentUpdate: true
    });
    await assert.rejects(() => createOrchestrator(store).handleProviderEvent({
        providerEvent: {
            provider: "manual_promptpay",
            providerReference: "PREF-ROLLBACK",
            providerEventId: "evt-rollback",
            status: PAYMENT_STATES.PAID,
            amount: 1490,
            currency: "THB",
            orderId: "AZL-ORDER-0001"
        }
    }));
    assert.strictEqual(store.attempts[0].status, PAYMENT_STATES.PENDING, "attempt PAID write rolls back when order update fails.");
    assert.strictEqual(store.orders[0].paymentStatus, "pending", "order remains pending after rollback.");
    assert.strictEqual(store.attempts[0].webhookEvents.length, 0, "approval event append rolls back with the transaction.");
}

async function testProviderEventSafetyFailures() {
    const attempt = {
        attemptId: "ATT-EVENT",
        orderId: "AZL-ORDER-0001",
        owner: owner(),
        status: PAYMENT_STATES.PENDING,
        provider: "manual_promptpay",
        providerReference: "PREF-EVENT",
        amount: 1490,
        currency: "THB",
        webhookEvents: []
    };
    await assertPaymentError(
        () => createOrchestrator(createStore({ attempts: [] })).handleProviderEvent({
            providerEvent: { providerReference: "UNKNOWN", providerEventId: "evt-x", status: PAYMENT_STATES.PAID }
        }),
        ERROR_CODES.PAYMENT_EVENT_NOT_FOUND,
        "unknown provider reference rejects"
    );
    await assertPaymentError(
        () => createOrchestrator(createStore({ attempts: [attempt] })).handleProviderEvent({
            providerEvent: { providerReference: "PREF-EVENT", providerEventId: "evt-2", status: PAYMENT_STATES.PAID, amount: 1491, currency: "THB", orderId: "AZL-ORDER-0001" }
        }),
        ERROR_CODES.PAYMENT_AMOUNT_MISMATCH,
        "provider amount mismatch fails closed"
    );
    await assertPaymentError(
        () => createOrchestrator(createStore({ attempts: [attempt] })).handleProviderEvent({
            providerEvent: { providerReference: "PREF-EVENT", providerEventId: "evt-3", status: PAYMENT_STATES.PAID, amount: 1490, currency: "MMK", orderId: "AZL-ORDER-0001" }
        }),
        ERROR_CODES.PAYMENT_CURRENCY_MISMATCH,
        "provider currency mismatch fails closed"
    );
    await assertPaymentError(
        () => createOrchestrator(createStore({ attempts: [attempt] })).handleProviderEvent({
            providerEvent: { providerReference: "PREF-EVENT", providerEventId: "evt-4", status: PAYMENT_STATES.PAID, amount: 1490, currency: "THB", orderId: "OTHER" }
        }),
        ERROR_CODES.PAYMENT_ORDER_BINDING_MISMATCH,
        "provider order binding mismatch fails closed"
    );
}

async function testPublicRedactionAndDetach() {
    const store = createStore({
        providerResult: {
            status: PAYMENT_STATES.PENDING,
            safeMetadata: {
                orderId: "AZL-ORDER-0001",
                secretKey: "sk_live_bad"
            },
            rawPayload: { secret: "never" }
        }
    });
    const result = await createOrchestrator(store).initiatePayment(initiateInput());
    const text = JSON.stringify(result);
    assert(!text.includes("sk_live_bad"), "public result redacts provider metadata.");
    assert(!text.includes("rawPayload"), "public result redacts raw provider payload.");
    assert(Object.isFrozen(result), "public result is frozen.");
    assert.throws(() => {
        result.qr.image = "mutated";
    }, "public result is deeply detached/frozen.");
}

async function testTransactionAndUnknownOutcome() {
    const store = createStore({ failStatusUpdate: true });
    const orchestrator = createOrchestrator(store);
    await assertPaymentError(
        () => orchestrator.initiatePayment(initiateInput()),
        ERROR_CODES.PAYMENT_OUTCOME_UNKNOWN,
        "provider success followed by persistence failure is explicit unknown"
    );
    assert.strictEqual(store.calls.createPayment, 1, "provider was called once.");
    assert.strictEqual(store.calls.recordFailure, 1, "ambiguous persistence failure recorded.");
    assert.strictEqual(store.calls.transactions >= 2, true, "mutation boundaries use transaction runner.");
    const existing = await orchestrator.initiatePayment(initiateInput());
    assert.strictEqual(existing.attemptId, store.attempts[0].attemptId, "unknown outcome retry returns existing attempt.");
    assert.strictEqual(store.calls.createPayment, 1, "unknown outcome retry does not create a second provider charge.");
}

async function testMalformedProviderResult() {
    const store = createStore();
    await assertPaymentError(
        () => createOrchestrator(store, { adapter: { createPayment: async () => ({ status: "wat" }) } }).initiatePayment(initiateInput()),
        ERROR_CODES.PAYMENT_PROVIDER_RESULT_INVALID,
        "malformed provider result rejected"
    );
}

async function run() {
    await testSuccessfulPendingInitiation();
    await testImmediatePayment();
    await testProviderFailureResult();
    await testCanonicalAmountAndCurrency();
    await testIdempotentInitiation();
    await testConflictingIdempotency();
    await testExistingActiveAttemptPreventsDuplicateCharge();
    await testRetryRules();
    await testRefreshRules();
    await testCancelAndExpireIdempotency();
    await testInvalidTransitions();
    await testProviderEvents();
    await testProviderEventAtomicRollback();
    await testProviderEventSafetyFailures();
    await testPublicRedactionAndDetach();
    await testTransactionAndUnknownOutcome();
    await testMalformedProviderResult();

    console.log("Commerce payment orchestrator runtime verification passed.");
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
