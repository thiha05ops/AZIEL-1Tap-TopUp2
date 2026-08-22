const assert = require("assert");
const mongoose = require("mongoose");

const CommerceOrder = require("../models/CommerceOrder");
const orderEmailService = require("../services/orderEmailService");
const { createOrderSnapshot } = require("../services/commerce/orderSnapshotRuntime");
const { createPricingQuote } = require("../services/commerce/pricingQuoteRuntime");
const {
    createOrderRecord,
    findOrderById,
    findOwnedOrderById,
    findOrderByQuoteId,
    findOwnedOrderByQuoteId,
    findOrderByCheckoutId,
    findOwnedOrderByCheckoutIdempotency,
    updateOrderStatus,
    updatePaymentStatus,
    updateFulfilmentStatus,
    appendOperationalReference,
    OrderRepositoryError,
    ERROR_CODES
} = require("../services/commerce/orderRepository");

const lifecycleEmails = [];
orderEmailService.notifyOrderTransition = async (order, transition) => {
    lifecycleEmails.push({ order: clone(order), transition: clone(transition) });
    return { delivered: true };
};

const CHECKOUT_TIME = "2026-07-26T12:05:00.000Z";

function clone(value) {
    return structuredClone(JSON.parse(JSON.stringify(value)));
}

function getPath(object, dottedPath) {
    return dottedPath.split(".").reduce((current, key) => (current == null ? undefined : current[key]), object);
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

function matches(record, query = {}) {
    return Object.entries(query).every(([key, expected]) => {
        const actual = getPath(record, key);
        if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
            if (Object.prototype.hasOwnProperty.call(expected, "$in")) return expected.$in.includes(actual);
        }
        return actual === expected;
    });
}

class FakeQuery {
    constructor(executor, model) {
        this.executor = executor;
        this.model = model;
        this.sessionValue = null;
        this.leanValue = false;
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

    async exec() {
        return clone(await this.executor());
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
                const doc = new CommerceOrder(model.records[index]);
                await doc.validate();
                model.records[index] = clone(doc.toObject({ depopulate: true, flattenMaps: true, versionKey: false }));
                return model.records[index];
            }, model);
        },
        async create(payloads, options = {}) {
            if (options.session) model.sessions.push(options.session);
            const created = [];
            for (const payload of payloads) {
                if (model.records.some(record => record.orderId === payload.orderId)) throw duplicateError({ orderId: 1 });
                if (model.records.some(record => record.quoteId === payload.quoteId)) throw duplicateError({ quoteId: 1 });
                if (model.records.some(record => record.checkoutId === payload.checkoutId)) throw duplicateError({ checkoutId: 1 });
                if (model.records.some(record => (
                    record.owner.type === payload.owner.type &&
                    record.owner.userId === payload.owner.userId &&
                    record.owner.sessionId === payload.owner.sessionId &&
                    record.checkout.idempotencyKeyHash === payload.checkout.idempotencyKeyHash &&
                    record.commerce.source === payload.commerce.source
                ))) {
                    throw duplicateError({ "checkout.idempotencyKeyHash": 1 });
                }
                const doc = new CommerceOrder(payload);
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

function quote(overrides = {}) {
    const runtimeQuote = createPricingQuote({
        quoteId: overrides.quoteId || "AZQ_ORDER_0001",
        issuedAt: "2026-07-26T12:00:00.000Z",
        expiresAt: "2026-07-26T12:10:00.000Z",
        owner: overrides.owner || { userId: "user-1", sessionId: "session-1" },
        request: {
            region: "TH",
            currency: "THB",
            package: {
                packageId: "MLBB-7740",
                packageCode: "MLBB_7740",
                packageName: "7740+1548 Diamonds",
                gameId: "mlbb",
                gameName: "Mobile Legends",
                categoryId: "mobile-games",
                quantity: 1
            },
            couponCode: "SAVE10"
        },
        pricingInput: {
            supplierCost: 1000,
            supplierCurrency: "THB",
            targetCurrency: "THB",
            policy: {
                profitRule: { type: "FIXED", value: 200 },
                gatewayFee: { enabled: false, type: "FIXED", value: 0 },
                roundingRule: { enabled: false, mode: "NONE" }
            }
        },
        promotionInput: {
            promotions: [{
                id: "promo-1",
                code: "SAVE10",
                name: "Save 10",
                status: "ACTIVE",
                promotionType: "PERCENTAGE_DISCOUNT",
                discountValue: 10,
                region: "TH",
                currency: "THB"
            }],
            campaigns: [],
            context: { region: "TH", currency: "THB", evaluationTime: "2026-07-26T12:00:00.000Z" },
            strategy: {}
        },
        versionContext: { priceVersionId: "pv-1", priceVersionNumber: 1, branchKey: "main" },
        trace: { traceId: "trace-quote", issueSource: "order-persistence-verifier" }
    });
    return clone(runtimeQuote);
}

function snapshot(overrides = {}) {
    const checkoutQuote = overrides.quote || quote({ quoteId: overrides.quoteId });
    return createOrderSnapshot({
        orderId: overrides.orderId || "AZL-ORDER-0001",
        checkoutId: overrides.checkoutId || "CHK-0001",
        checkoutTime: CHECKOUT_TIME,
        quote: checkoutQuote,
        owner: overrides.owner || { userId: checkoutQuote.owner.userId, sessionId: checkoutQuote.owner.sessionId },
        idempotencyKey: overrides.idempotencyKey || "hash:user-1:idem-1",
        requestFingerprint: overrides.requestFingerprint || "fingerprint-1",
        paymentSnapshot: {
            paymentMethodId: "promptpay",
            paymentChannel: "manual",
            nextAction: "OPEN_MANUAL_PAYMENT"
        },
        fulfilmentInput: { userId: "123456", zoneId: "1001" },
        contact: { email: "user@example.com" },
        requestMetadata: { traceId: "trace-checkout" }
    });
}

async function assertRepoError(fn, code, message) {
    try {
        await fn();
        throw new Error(`Expected ${code}: ${message}`);
    } catch (error) {
        assert(error instanceof OrderRepositoryError, `${message}: got ${error.name || "Error"} ${error.code || ""}`);
        assert.strictEqual(error.code, code, message);
    }
}

async function verifyModelStructure() {
    const doc = new CommerceOrder(snapshot());
    await doc.validate();
    assert.strictEqual(CommerceOrder.schema.options.strict, "throw", "schema is strict and rejects unknown fields.");
    assert.strictEqual(CommerceOrder.schema.options.minimize, false, "schema preserves empty snapshot objects.");
    assert.strictEqual(CommerceOrder.schema.options.timestamps, false, "canonical timestamps are caller-owned.");
    assert.throws(() => new CommerceOrder({ ...snapshot(), unexpected: true }), /not in schema/, "strict schema rejects unknown fields.");
    const indexes = CommerceOrder.schema.indexes();
    assert(indexes.some(([fields, options]) => fields.orderId === 1 && options.unique), "unique orderId index declared.");
    assert(indexes.some(([fields, options]) => fields.quoteId === 1 && options.unique), "unique quoteId index declared.");
    assert(indexes.some(([fields, options]) => fields.checkoutId === 1 && options.unique), "unique checkoutId index declared.");
    assert(indexes.some(([fields, options]) => fields["checkout.idempotencyKeyHash"] === 1 && options.unique && options.partialFilterExpression), "owner idempotency unique index declared.");
    assert(!indexes.some(([, options]) => options.expireAfterSeconds !== undefined), "orders must not have TTL indexes.");
}

async function verifyCreateAndFidelity() {
    const model = createFakeModel();
    const session = { id: "session-1" };
    const source = snapshot();
    const created = await createOrderRecord(source, { model, session });
    assert.strictEqual(created.orderId, source.orderId, "order id preserved.");
    assert.strictEqual(created.quoteId, source.quoteId, "quote id preserved.");
    assert.strictEqual(created.checkoutId, source.checkoutId, "checkout id preserved.");
    assert.strictEqual(created.commercial.totalAmount, source.commercial.totalAmount, "commercial total preserved.");
    assert.deepStrictEqual(created.pricing.pricingRuleSnapshot, source.pricing.pricingRuleSnapshot, "pricing snapshot preserved.");
    assert.deepStrictEqual(created.promotion, source.promotion, "promotion snapshot preserved.");
    assert.deepStrictEqual(created.product, source.product, "product snapshot preserved.");
    assert.strictEqual(new Date(created.createdAt).toISOString(), CHECKOUT_TIME, "created timestamp preserved.");
    assert(model.sessions.includes(session), "session passed to create/read.");
    source.product.packageName = "Changed";
    assert.strictEqual(created.product.packageName, "7740+1548 Diamonds", "result detached from caller snapshot.");
}

async function verifyValidation() {
    const model = createFakeModel();
    await assertRepoError(() => createOrderRecord({ ...snapshot(), orderId: "" }, { model }), ERROR_CODES.INVALID_ORDER_ID, "missing orderId rejected.");
    await assertRepoError(() => createOrderRecord({ ...snapshot(), quoteId: "" }, { model }), ERROR_CODES.INVALID_QUOTE_ID, "missing quoteId rejected.");
    await assertRepoError(() => createOrderRecord({ ...snapshot(), checkoutId: "" }, { model }), ERROR_CODES.INVALID_CHECKOUT_ID, "missing checkoutId rejected.");
    await assertRepoError(() => createOrderRecord({ ...snapshot(), owner: {} }, { model }), ERROR_CODES.INVALID_OWNER, "invalid owner rejected.");
    const missingFingerprint = clone(snapshot());
    missingFingerprint.checkoutFingerprint = "";
    missingFingerprint.checkout.requestFingerprint = "";
    await assertRepoError(() => createOrderRecord(missingFingerprint, { model }), ERROR_CODES.INVALID_REQUEST_FINGERPRINT, "invalid fingerprint rejected.");
    await assertRepoError(() => createOrderRecord({ ...snapshot(), commercial: undefined }, { model }), ERROR_CODES.INVALID_ORDER_RECORD, "commercial missing rejected.");
}

async function verifyUniquenessAndIdempotency() {
    const model = createFakeModel();
    const first = await createOrderRecord(snapshot(), { model });
    const again = await createOrderRecord(snapshot(), { model });
    assert.strictEqual(again.__commerceOrderPersistenceOutcome, "idempotent", "same owner/key/fingerprint/quote returns existing.");
    assert.strictEqual(model.records.length, 1, "idempotent create creates no second record.");

    await assertRepoError(() => createOrderRecord(snapshot({ orderId: "AZL-ORDER-0001", quoteId: "AZQ_ORDER_0002", checkoutId: "CHK-0002", idempotencyKey: "hash:user-1:idem-2", requestFingerprint: "fingerprint-2" }), { model }), ERROR_CODES.ORDER_ID_CONFLICT, "duplicate orderId detected.");
    await assertRepoError(() => createOrderRecord(snapshot({ orderId: "AZL-ORDER-0002", checkoutId: "CHK-0003", idempotencyKey: "hash:user-1:idem-3", requestFingerprint: "fingerprint-3" }), { model }), ERROR_CODES.ORDER_ALREADY_EXISTS_FOR_QUOTE, "same quote different key rejected.");
    await assertRepoError(() => createOrderRecord(snapshot({ orderId: "AZL-ORDER-0003", quoteId: "AZQ_ORDER_0003", checkoutId: "CHK-0004", requestFingerprint: "different" }), { model }), ERROR_CODES.CHECKOUT_IDEMPOTENCY_CONFLICT, "same owner key conflicting fingerprint rejected.");

    await createOrderRecord(snapshot({
        orderId: "AZL-ORDER-USER2",
        checkoutId: "CHK-USER2",
        quote: quote({ quoteId: "AZQ_ORDER_USER2", owner: { userId: "user-2" } }),
        owner: { userId: "user-2" },
        idempotencyKey: "hash:user-1:idem-1",
        requestFingerprint: "fingerprint-user2"
    }), { model });
    assert.strictEqual(model.records.length, 2, "different owners may reuse same idempotency identity.");
    assert(first, "first result exists.");
}

async function verifyOwnerSafeRetrieval() {
    const model = createFakeModel();
    await createOrderRecord(snapshot(), { model });
    assert(await findOrderById("AZL-ORDER-0001", { model }), "internal order lookup works.");
    assert(await findOrderByQuoteId("AZQ_ORDER_0001", { model }), "internal quote lookup works.");
    assert(await findOrderByCheckoutId("CHK-0001", { model }), "internal checkout lookup works.");
    assert(await findOwnedOrderById({ orderId: "AZL-ORDER-0001", owner: { type: "USER", userId: "user-1" } }, { model }), "correct user lookup works.");
    assert.strictEqual(await findOwnedOrderById({ orderId: "AZL-ORDER-0001", owner: { type: "USER", userId: "wrong" } }, { model }), null, "wrong user returns null.");
    assert(await findOwnedOrderByQuoteId({ quoteId: "AZQ_ORDER_0001", owner: { type: "USER", userId: "user-1" } }, { model }), "owned quote lookup works.");
    assert(await findOwnedOrderByCheckoutIdempotency({ owner: { type: "USER", userId: "user-1" }, idempotencyKeyHash: "hash:user-1:idem-1" }, { model }), "owned idempotency lookup works.");

    const sessionModel = createFakeModel();
    await createOrderRecord(snapshot({
        orderId: "AZL-SESSION",
        checkoutId: "CHK-SESSION",
        quote: quote({ quoteId: "AZQ_SESSION", owner: { sessionId: "session-only" } }),
        owner: { sessionId: "session-only" },
        idempotencyKey: "hash:session:idem",
        requestFingerprint: "fp-session"
    }), { model: sessionModel });
    assert(await findOwnedOrderById({ orderId: "AZL-SESSION", owner: { type: "SESSION", sessionId: "session-only" } }, { model: sessionModel }), "correct session lookup works.");
    assert.strictEqual(await findOwnedOrderById({ orderId: "AZL-SESSION", owner: { type: "SESSION", sessionId: "wrong" } }, { model: sessionModel }), null, "wrong session returns null.");
    assert.strictEqual(await findOwnedOrderById({ orderId: "AZL-SESSION", owner: { type: "USER", userId: "user-1" } }, { model: sessionModel }), null, "user cannot substitute session identity.");
    assert.strictEqual(await findOwnedOrderById({ orderId: "AZL-ORDER-0001", owner: { type: "SESSION", sessionId: "session-1" } }, { model }), null, "session cannot substitute user identity.");
}

async function verifyStatusMutations() {
    const model = createFakeModel();
    const emailCountBefore = lifecycleEmails.length;
    const created = await createOrderRecord(snapshot(), { model });
    assert.strictEqual(lifecycleEmails.length, emailCountBefore + 1, "order creation emits one canonical lifecycle email.");
    assert.strictEqual(lifecycleEmails.at(-1).transition.status, "pending_payment", "creation email uses persisted order status.");
    const beforeCommercial = clone(created.commercial);
    const paid = await updatePaymentStatus({
        orderId: "AZL-ORDER-0001",
        owner: { type: "USER", userId: "user-1" },
        fromStatuses: ["unpaid"],
        toStatus: "pending",
        changedAt: "2026-07-26T12:06:00.000Z",
        reason: "payment opened"
    }, { model });
    assert.strictEqual(paid.paymentStatus, "pending", "payment transition succeeds.");
    assert.strictEqual(lifecycleEmails.length, emailCountBefore + 1, "payment status must not compete with order lifecycle email authority.");
    assert.deepStrictEqual(paid.commercial, beforeCommercial, "commercial unchanged by payment update.");
    await assertRepoError(() => updatePaymentStatus({ orderId: "AZL-ORDER-0001", fromStatuses: ["pending"], toStatus: "waived", changedAt: "2026-07-26T12:06:01.000Z" }, { model }), ERROR_CODES.INVALID_PAYMENT_STATUS_TRANSITION, "invalid payment transition rejected.");
    await assertRepoError(() => updateOrderStatus({ orderId: "AZL-ORDER-0001", fromStatuses: ["paid"], toStatus: "processing", changedAt: "2026-07-26T12:06:02.000Z" }, { model }), ERROR_CODES.ORDER_STATE_CONFLICT, "stale order transition conflicts.");
    const orderPaid = await updateOrderStatus({ orderId: "AZL-ORDER-0001", fromStatuses: ["pending_payment"], toStatus: "paid", changedAt: "2026-07-26T12:06:03.000Z" }, { model });
    assert.strictEqual(orderPaid.status, "paid", "order transition succeeds.");
    assert.strictEqual(lifecycleEmails.length, emailCountBefore + 2, "canonical order status transition emits lifecycle email.");
    assert.strictEqual(lifecycleEmails.at(-1).order.status, "paid", "lifecycle email receives the persisted post-transition order snapshot.");
    assert.strictEqual(lifecycleEmails.at(-1).transition.status, "paid", "lifecycle event derives from persisted order status.");
    const queued = await updateFulfilmentStatus({ orderId: "AZL-ORDER-0001", fromStatuses: ["not_started"], toStatus: "queued", changedAt: "2026-07-26T12:06:04.000Z" }, { model });
    assert.strictEqual(queued.fulfilment.status, "queued", "fulfilment transition succeeds.");
    assert.strictEqual(lifecycleEmails.length, emailCountBefore + 2, "fulfilment status must not compete with order lifecycle email authority.");
    await updateOrderStatus({ orderId: "AZL-ORDER-0001", fromStatuses: ["paid"], toStatus: "processing", changedAt: "2026-07-26T12:06:05.000Z" }, { model });
    const completed = await updateOrderStatus({ orderId: "AZL-ORDER-0001", fromStatuses: ["processing"], toStatus: "completed", changedAt: "2026-07-26T12:06:06.000Z" }, { model });
    assert.strictEqual(completed.status, "completed", "completed order transition persists canonically.");
    assert.strictEqual(lifecycleEmails.at(-1).order.status, "completed", "completed lifecycle email receives the persisted completed snapshot.");
    assert.strictEqual(lifecycleEmails.at(-1).transition.status, "completed", "completed lifecycle event derives from canonical order status.");
    const referenced = await appendOperationalReference({ orderId: "AZL-ORDER-0001", reference: { type: "manual-payment-attempt", id: "mpa-1" }, changedAt: "2026-07-26T12:06:05.000Z" }, { model });
    assert.strictEqual(referenced.operationalReferences.length, 1, "operational reference appended.");
}

async function verifyErrorMapping() {
    const brokenModel = createFakeModel();
    brokenModel.create = async () => {
        const error = new Error("network");
        error.name = "MongoNetworkError";
        throw error;
    };
    await assertRepoError(() => createOrderRecord(snapshot(), { model: brokenModel }), ERROR_CODES.ORDER_CREATE_FAILED, "transient create error wrapped.");
    try {
        await createOrderRecord(snapshot(), { model: brokenModel });
    } catch (error) {
        assert.strictEqual(error.retryable, true, "transient database error is retryable.");
    }
}

function verifyNoRecalculationSource() {
    const source = require("fs").readFileSync("backend/services/commerce/orderRepository.js", "utf8");
    assert(!source.includes("calculateBasePrice"), "repository must not call pricing engine.");
    assert(!source.includes("resolvePromotion"), "repository must not call promotion resolver.");
    assert(!source.includes("Order.create"), "repository must not write legacy Order.");
}

async function run() {
    await verifyModelStructure();
    await verifyCreateAndFidelity();
    await verifyValidation();
    await verifyUniquenessAndIdempotency();
    await verifyOwnerSafeRetrieval();
    await verifyStatusMutations();
    await verifyErrorMapping();
    verifyNoRecalculationSource();
    console.log("Commerce order persistence checks passed.");
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
