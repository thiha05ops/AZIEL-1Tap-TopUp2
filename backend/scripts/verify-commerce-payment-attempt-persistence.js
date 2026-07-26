"use strict";

const assert = require("assert");

const PaymentAttempt = require("../models/PaymentAttempt");
const {
    createPaymentOrchestrator
} = require("../services/commerce/paymentOrchestrator");
const {
    createAttempt,
    findAttemptById,
    findAttemptByIdForOwner,
    findAttemptsForOrder,
    findActiveAttemptForOrder,
    findAttemptByProviderReference,
    findAttemptByIdempotency,
    updateStatus,
    appendProviderEvent,
    recordFailure,
    setProviderReference,
    markCompleted,
    markCancelled,
    markExpired,
    PaymentAttemptRepositoryError,
    ERROR_CODES,
    STATUS
} = require("../services/commerce/paymentAttemptRepository");

const NOW = "2026-07-26T12:00:00.000Z";

function clone(value) {
    return structuredClone(JSON.parse(JSON.stringify(value)));
}

function getPath(object, dottedPath) {
    return dottedPath.split(".").reduce((current, key) => {
        if (current == null) return undefined;
        if (Array.isArray(current)) return current.map(item => getPath(item, key));
        return current[key];
    }, object);
}

function setPath(object, dottedPath, value) {
    const parts = dottedPath.split(".");
    const last = parts.pop();
    const target = parts.reduce((current, key) => {
        if (!current[key] || typeof current[key] !== "object") current[key] = {};
        return current[key];
    }, object);
    target[last] = value instanceof Date ? value.toISOString() : value;
}

function matchesValue(actual, expected) {
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
        if (Object.prototype.hasOwnProperty.call(expected, "$in")) return expected.$in.includes(actual);
        if (Object.prototype.hasOwnProperty.call(expected, "$ne")) {
            if (Array.isArray(actual)) return !actual.includes(expected.$ne);
            return actual !== expected.$ne;
        }
    }
    if (Array.isArray(actual)) return actual.includes(expected);
    return actual === expected;
}

function matches(record, query = {}) {
    return Object.entries(query).every(([key, expected]) => {
        if (key === "$or") return expected.some(clause => matches(record, clause));
        return matchesValue(getPath(record, key), expected);
    });
}

class FakeQuery {
    constructor(executor, model) {
        this.executor = executor;
        this.model = model;
        this.sessionValue = null;
        this.leanValue = false;
        this.sortValue = null;
    }

    session(session) {
        this.sessionValue = session;
        this.model.sessions.push(session);
        return this;
    }

    lean() {
        this.leanValue = true;
        return this;
    }

    sort(sortValue) {
        this.sortValue = sortValue;
        return this;
    }

    async exec() {
        const result = await this.executor();
        if (Array.isArray(result) && this.sortValue) {
            const [[field, direction]] = Object.entries(this.sortValue);
            result.sort((a, b) => {
                const left = getPath(a, field);
                const right = getPath(b, field);
                if (left === right) return 0;
                return left > right ? direction : -direction;
            });
        }
        return clone(result);
    }
}

function duplicateError(keyPattern) {
    const error = new Error("duplicate key");
    error.code = 11000;
    error.keyPattern = keyPattern;
    return error;
}

function createFakeModel() {
    const model = {
        records: [],
        sessions: [],
        findOne(query) {
            return new FakeQuery(async () => model.records.find(record => matches(record, query)) || null, model);
        },
        find(query) {
            return new FakeQuery(async () => model.records.filter(record => matches(record, query)), model);
        },
        findOneAndUpdate(query, update) {
            return new FakeQuery(async () => {
                const index = model.records.findIndex(record => matches(record, query));
                if (index === -1) return null;
                Object.entries(update.$set || {}).forEach(([pathName, value]) => setPath(model.records[index], pathName, value));
                Object.entries(update.$push || {}).forEach(([pathName, value]) => {
                    const current = getPath(model.records[index], pathName);
                    if (!Array.isArray(current)) setPath(model.records[index], pathName, []);
                    getPath(model.records[index], pathName).push(value instanceof Date ? value.toISOString() : clone(value));
                });
                const doc = new PaymentAttempt(model.records[index]);
                await doc.validate();
                model.records[index] = clone(doc.toObject({ depopulate: true, flattenMaps: true, versionKey: false }));
                return model.records[index];
            }, model);
        },
        async create(payloads, options = {}) {
            if (options.session) model.sessions.push(options.session);
            const created = [];
            for (const payload of payloads) {
                if (model.records.some(record => record.attemptId === payload.attemptId)) throw duplicateError({ attemptId: 1 });
                if (payload.providerReference && model.records.some(record => record.providerReference === payload.providerReference)) {
                    throw duplicateError({ providerReference: 1 });
                }
                if (payload.idempotencyKey && model.records.some(record => (
                    record.provider === payload.provider &&
                    record.ownerId === payload.ownerId &&
                    record.idempotencyKey === payload.idempotencyKey &&
                    record.operation === payload.operation
                ))) {
                    throw duplicateError({ provider: 1, ownerId: 1, idempotencyKey: 1, operation: 1 });
                }
                const doc = new PaymentAttempt(payload);
                await doc.validate();
                const plain = clone(doc.toObject({ depopulate: true, flattenMaps: true, versionKey: false }));
                model.records.push(plain);
                created.push(plain);
            }
            return created;
        }
    };
    return model;
}

function attempt(overrides = {}) {
    return {
        attemptId: "ATT-0001",
        orderId: "AZL-ORDER-0001",
        quoteId: "AZQ-0001",
        ownerId: "user-1",
        owner: { type: "USER", userId: "user-1" },
        provider: "manual_promptpay",
        providerType: "manual_promptpay",
        paymentMethod: "promptpay",
        paymentMethodId: "promptpay",
        paymentChannel: "manual",
        confirmationMode: "manual_admin",
        amount: 1490,
        currency: "THB",
        region: "TH",
        status: STATUS.INITIATING,
        idempotencyKey: "idem-1",
        operation: "initiatePayment",
        requestFingerprint: "fp-1",
        createdAt: NOW,
        updatedAt: NOW,
        expiresAt: "2026-07-26T12:15:00.000Z",
        ...overrides
    };
}

async function assertRepoError(fn, code, message) {
    try {
        await fn();
        throw new Error(`Expected ${code}: ${message}`);
    } catch (error) {
        assert(error instanceof PaymentAttemptRepositoryError, `${message}: got ${error.name || "Error"} ${error.code || ""}`);
        assert.strictEqual(error.code, code, message);
    }
}

async function verifyModelStructure() {
    const doc = new PaymentAttempt(attempt());
    await doc.validate();
    assert.strictEqual(PaymentAttempt.schema.options.strict, "throw", "schema is strict.");
    assert.strictEqual(PaymentAttempt.schema.options.minimize, false, "schema preserves empty objects.");
    assert.strictEqual(PaymentAttempt.schema.options.timestamps, false, "repository owns timestamps.");
    assert.throws(() => new PaymentAttempt({ ...attempt(), unexpected: true }), /not in schema/, "unknown fields rejected.");
    const immutablePaths = [
        "attemptId",
        "orderId",
        "ownerId",
        "owner",
        "amount",
        "currency",
        "provider",
        "paymentMethod",
        "idempotencyKey"
    ];
    immutablePaths.forEach(pathName => {
        assert(PaymentAttempt.schema.path(pathName)?.options?.immutable, `${pathName} is immutable.`);
    });
    const indexes = PaymentAttempt.schema.indexes();
    assert(indexes.some(([fields, options]) => fields.attemptId === 1 && options.unique), "unique attemptId index declared.");
    assert(indexes.some(([fields, options]) => fields.providerReference === 1 && options.unique && options.partialFilterExpression), "sparse providerReference unique index declared.");
    assert(indexes.some(([fields, options]) => fields.provider === 1 && fields.ownerId === 1 && fields.idempotencyKey === 1 && options.unique), "provider/owner idempotency unique index declared.");
    assert(indexes.some(([fields]) => fields.ownerId === 1 && fields.orderId === 1), "ownerId + orderId index declared.");
    assert(indexes.some(([fields]) => fields.orderId === 1 && fields.createdAt === -1), "orderId + createdAt index declared.");
    assert(indexes.some(([fields]) => fields.status === 1), "status index declared.");
    assert(indexes.some(([fields]) => fields.expiresAt === 1), "expiresAt index declared.");
}

async function verifyCreateAndLookup() {
    const model = createFakeModel();
    const session = { id: "mongo-session-1" };
    const created = await createAttempt(attempt({ transactionContext: { mongoSession: session } }), { model });
    assert.strictEqual(created.attemptId, "ATT-0001", "attempt created.");
    assert.strictEqual(created.ownerId, "user-1", "ownerId derived from owner.");
    assert.strictEqual(created.amount, 1490, "amount preserved.");
    assert.strictEqual(created.currency, "THB", "currency preserved.");
    assert(model.sessions.includes(session), "Mongo session propagated to create.");
    assert(await findAttemptById({ attemptId: "ATT-0001" }, { model }), "find by id works.");
    assert(await findAttemptByIdForOwner({ attemptId: "ATT-0001", owner: { userId: "user-1" } }, { model }), "owner-safe lookup works.");
    assert.strictEqual(await findAttemptByIdForOwner({ attemptId: "ATT-0001", owner: { userId: "user-2" } }, { model }), null, "wrong owner cannot read attempt.");
    assert.strictEqual((await findAttemptsForOrder({ orderId: "AZL-ORDER-0001" }, { model })).length, 1, "find attempts for order works.");
    assert(await findActiveAttemptForOrder({ orderId: "AZL-ORDER-0001", owner: { userId: "user-1" } }, { model }), "active attempt lookup works.");
}

async function verifyIdempotency() {
    const model = createFakeModel();
    const first = await createAttempt(attempt(), { model });
    const retry = await createAttempt({ ...attempt(), attemptId: "ATT-DIFFERENT" }, { model });
    assert.strictEqual(retry.attemptId, first.attemptId, "same idempotency + fingerprint returns existing attempt.");
    await assertRepoError(
        () => createAttempt({ ...attempt(), attemptId: "ATT-CONFLICT", requestFingerprint: "fp-2" }, { model }),
        ERROR_CODES.PAYMENT_IDEMPOTENCY_CONFLICT,
        "conflicting idempotency fingerprint rejected"
    );
}

async function verifyProviderReference() {
    const model = createFakeModel();
    await createAttempt(attempt(), { model });
    const updated = await setProviderReference({
        attemptId: "ATT-0001",
        providerReference: "PREF-0001",
        providerTransactionId: "PTX-0001",
        rawProviderStatus: "pending",
        providerMetadata: { authorization: "secret", providerMode: "test" },
        safeMetadata: { rawPayload: "nope", source: "verifier" },
        transactionContext: { mongoSession: "session-ref" }
    }, { model });
    assert.strictEqual(updated.providerReference, "PREF-0001", "provider reference set.");
    assert.strictEqual(updated.providerMetadata.authorization, undefined, "provider metadata redacted.");
    assert.strictEqual(updated.safeMetadata.rawPayload, undefined, "safe metadata strips raw payload.");
    assert(await findAttemptByProviderReference({ providerReference: "PREF-0001" }, { model }), "provider reference lookup works.");
    await createAttempt(attempt({ attemptId: "ATT-0002", orderId: "AZL-ORDER-0002", idempotencyKey: "idem-2", requestFingerprint: "fp-2" }), { model });
    await assertRepoError(
        () => setProviderReference({ attemptId: "ATT-0002", providerReference: "PREF-0001" }, { model }),
        ERROR_CODES.PAYMENT_PROVIDER_REFERENCE_EXISTS,
        "sparse provider reference uniqueness enforced"
    );
}

async function verifyEventsAndFailure() {
    const model = createFakeModel();
    await createAttempt(attempt(), { model });
    const event = await appendProviderEvent({
        attemptId: "ATT-0001",
        providerEvent: {
            providerEventId: "evt-1",
            provider: "manual_promptpay",
            providerReference: "PREF-1",
            status: STATUS.PENDING,
            amount: 1490,
            currency: "THB",
            receivedAt: NOW,
            safeMetadata: { signature: "secret", ok: true }
        },
        transactionContext: { mongoSession: "session-event" }
    }, { model });
    assert.strictEqual(event.eventHistory.length, 1, "event appended.");
    assert.strictEqual(event.eventHistory[0].safeMetadata.signature, undefined, "event metadata redacted.");
    await assertRepoError(
        () => appendProviderEvent({
            attemptId: "ATT-0001",
            providerEvent: { providerEventId: "evt-1", status: STATUS.PENDING, receivedAt: NOW }
        }, { model }),
        ERROR_CODES.PAYMENT_DUPLICATE_EVENT,
        "duplicate provider event rejected"
    );
    await assertRepoError(
        () => appendProviderEvent({ attemptId: "ATT-0001", providerEvent: { providerEventId: "evt-2" } }, { model }),
        ERROR_CODES.PAYMENT_INVALID_TRANSITION,
        "malformed event rejected"
    );
    const failed = await recordFailure({
        attemptId: "ATT-0001",
        failure: {
            category: "PAYMENT_PROVIDER_ERROR",
            code: "PROVIDER_DOWN",
            message: "Provider unavailable"
        },
        changedAt: NOW
    }, { model });
    assert.strictEqual(failed.status, STATUS.FAILED, "failure records failed status.");
    assert.strictEqual(failed.failureCode, "PROVIDER_DOWN", "failure code mirrored.");
}

async function verifyStatusTransitions() {
    const model = createFakeModel();
    await createAttempt(attempt(), { model });
    const pending = await updateStatus({
        attemptId: "ATT-0001",
        fromStatuses: [STATUS.INITIATING],
        toStatus: STATUS.PENDING,
        changedAt: NOW,
        transactionContext: { mongoSession: "session-status" }
    }, { model });
    assert.strictEqual(pending.status, STATUS.PENDING, "conditional transition applies.");
    await assertRepoError(
        () => updateStatus({ attemptId: "ATT-0001", fromStatuses: [STATUS.PAID], toStatus: STATUS.FAILED, changedAt: NOW }, { model }),
        ERROR_CODES.PAYMENT_INVALID_TRANSITION,
        "invalid transition rejected"
    );
    const completed = await markCompleted({ attemptId: "ATT-0001", fromStatuses: [STATUS.PENDING], changedAt: NOW }, { model });
    assert.strictEqual(completed.status, STATUS.PAID, "markCompleted sets PAID.");
    assert.strictEqual(new Date(completed.completedAt).toISOString(), NOW, "completedAt set.");

    await createAttempt(attempt({ attemptId: "ATT-CANCEL", orderId: "AZL-ORDER-C", idempotencyKey: "idem-c", requestFingerprint: "fp-c", status: STATUS.PENDING }), { model });
    const cancelled = await markCancelled({ attemptId: "ATT-CANCEL", fromStatuses: [STATUS.PENDING], changedAt: NOW }, { model });
    assert.strictEqual(cancelled.status, STATUS.CANCELLED, "markCancelled sets CANCELLED.");
    assert.strictEqual(new Date(cancelled.cancelledAt).toISOString(), NOW, "cancelledAt set.");

    await createAttempt(attempt({ attemptId: "ATT-EXPIRE", orderId: "AZL-ORDER-E", idempotencyKey: "idem-e", requestFingerprint: "fp-e", status: STATUS.PENDING }), { model });
    const expired = await markExpired({ attemptId: "ATT-EXPIRE", fromStatuses: [STATUS.PENDING], changedAt: NOW }, { model });
    assert.strictEqual(expired.status, STATUS.EXPIRED, "markExpired sets EXPIRED.");
    assert.strictEqual(new Date(expired.expiredAt).toISOString(), NOW, "expiredAt set.");
}

async function verifyOrchestratorCompatibility() {
    const model = createFakeModel();
    const order = {
        orderId: "AZL-ORDER-0001",
        quoteId: "AZQ-0001",
        status: "pending_payment",
        paymentStatus: "unpaid",
        owner: { type: "USER", userId: "user-1", sessionId: "" },
        commercial: { totalAmount: 1490, currency: "THB", region: "TH" },
        payment: {
            paymentMethodId: "promptpay",
            paymentChannel: "manual",
            provider: "manual_promptpay",
            providerType: "manual_promptpay",
            confirmationMode: "manual_admin",
            status: "unpaid"
        },
        fulfilment: { status: "not_started" }
    };
    const orderRepository = {
        async findOwnedOrderById({ orderId, owner }) {
            if (orderId === order.orderId && owner.userId === order.owner.userId) return clone(order);
            return null;
        },
        async findOrderById({ orderId }) {
            return orderId === order.orderId ? clone(order) : null;
        },
        async updatePaymentStatus({ fromStatuses, toStatus }, { mongoSession }) {
            assert(mongoSession, "orchestrator passes mongoSession to order repository.");
            assert(fromStatuses.includes(order.paymentStatus), "order update is conditional.");
            order.paymentStatus = toStatus;
            order.payment.status = toStatus;
            return clone(order);
        }
    };
    const attemptPort = {
        findActiveAttemptForOrder: input => findActiveAttemptForOrder(input, { model }),
        findAttemptByIdempotency: input => findAttemptByIdempotency(input, { model }),
        findAttemptByIdForOwner: input => findAttemptByIdForOwner(input, { model }),
        findAttemptByProviderReference: input => findAttemptByProviderReference(input, { model }),
        createAttempt: input => createAttempt(input, { model }),
        updateAttemptStatus: input => updateStatus(input, { model }),
        setProviderReference: input => setProviderReference(input, { model }),
        appendProviderEvent: input => appendProviderEvent(input, { model }),
        recordFailure: input => recordFailure(input, { model }),
        listAttemptsForOrder: input => findAttemptsForOrder(input, { model })
    };
    const orchestrator = createPaymentOrchestrator({
        orderRepository,
        paymentAttemptPort: attemptPort,
        providerResolver: () => ({
            createPayment: async () => ({
                provider: "manual_promptpay",
                providerReference: "PREF-COMPAT",
                status: "PENDING",
                amount: 1490,
                currency: "THB",
                safeMetadata: { orderId: "AZL-ORDER-0001" }
            })
        }),
        transactionRunner: callback => callback({ mongoSession: "compat-session" }),
        clock: () => new Date(NOW),
        idGenerator: kind => (kind === "paymentIntent" ? "PI-COMPAT" : "ATT-COMPAT"),
        logger: { info() {}, warn() {}, error() {} }
    });
    const result = await orchestrator.initiatePayment({
        orderId: "AZL-ORDER-0001",
        owner: { userId: "user-1" },
        idempotencyKey: "idem-compatible",
        amount: 1,
        currency: "MMK"
    });
    assert.strictEqual(result.paymentStatus, "pending", "repository is compatible with orchestrator runtime.");
    assert.strictEqual(model.records[0].amount, 1490, "attempt stores order amount.");
    assert.strictEqual(model.records[0].currency, "THB", "attempt stores order currency.");
}

async function run() {
    await verifyModelStructure();
    await verifyCreateAndLookup();
    await verifyIdempotency();
    await verifyProviderReference();
    await verifyEventsAndFailure();
    await verifyStatusTransitions();
    await verifyOrchestratorCompatibility();

    console.log("Commerce payment attempt persistence verification passed.");
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
