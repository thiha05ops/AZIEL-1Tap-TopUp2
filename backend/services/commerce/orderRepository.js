const CommerceOrder = require("../../models/CommerceOrder");
const { ensurePaidOrderFulfillmentWork } = require("../paidFulfillmentRoutingService");
const orderEmailService = require("../orderEmailService");
const {
    toOrderSnapshotPayload
} = require("./orderSnapshotRuntime");

const ERROR_CODES = Object.freeze({
    INVALID_ORDER_RECORD: "INVALID_ORDER_RECORD",
    INVALID_ORDER_ID: "INVALID_ORDER_ID",
    INVALID_QUOTE_ID: "INVALID_QUOTE_ID",
    INVALID_CHECKOUT_ID: "INVALID_CHECKOUT_ID",
    INVALID_OWNER: "INVALID_OWNER",
    INVALID_IDEMPOTENCY_IDENTITY: "INVALID_IDEMPOTENCY_IDENTITY",
    INVALID_REQUEST_FINGERPRINT: "INVALID_REQUEST_FINGERPRINT",
    ORDER_ID_CONFLICT: "ORDER_ID_CONFLICT",
    ORDER_ALREADY_EXISTS_FOR_QUOTE: "ORDER_ALREADY_EXISTS_FOR_QUOTE",
    CHECKOUT_ID_CONFLICT: "CHECKOUT_ID_CONFLICT",
    CHECKOUT_IDEMPOTENCY_CONFLICT: "CHECKOUT_IDEMPOTENCY_CONFLICT",
    ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
    ORDER_OWNERSHIP_MISMATCH: "ORDER_OWNERSHIP_MISMATCH",
    INVALID_ORDER_STATUS_TRANSITION: "INVALID_ORDER_STATUS_TRANSITION",
    INVALID_PAYMENT_STATUS_TRANSITION: "INVALID_PAYMENT_STATUS_TRANSITION",
    INVALID_FULFILMENT_STATUS_TRANSITION: "INVALID_FULFILMENT_STATUS_TRANSITION",
    ORDER_STATE_CONFLICT: "ORDER_STATE_CONFLICT",
    ORDER_CREATE_FAILED: "ORDER_CREATE_FAILED",
    ORDER_READ_FAILED: "ORDER_READ_FAILED",
    ORDER_UPDATE_FAILED: "ORDER_UPDATE_FAILED",
    ORDER_PERSISTENCE_FAILED: "ORDER_PERSISTENCE_FAILED"
});

const ORDER_TRANSITIONS = Object.freeze({
    pending_payment: ["paid", "cancelled", "payment_failed", "expired"],
    paid: ["processing", "cancelled", "refund_pending"],
    processing: ["completed", "failed", "refund_pending"],
    payment_failed: [],
    expired: [],
    cancelled: [],
    completed: ["refund_pending"],
    failed: ["refund_pending"],
    refund_pending: ["refunded", "cancelled"],
    refunded: []
});

const PAYMENT_TRANSITIONS = Object.freeze({
    unpaid: ["pending", "paid", "failed", "expired", "waived"],
    pending: ["paid", "failed", "expired", "cancelled"],
    paid: ["refunded"],
    failed: [],
    expired: [],
    cancelled: [],
    waived: [],
    refunded: []
});

const FULFILMENT_TRANSITIONS = Object.freeze({
    not_started: ["queued", "processing", "cancelled"],
    queued: ["processing", "cancelled"],
    processing: ["completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: []
});

class OrderRepositoryError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "OrderRepositoryError";
        this.code = code;
        this.stage = normalizeString(options.stage);
        this.causeCode = normalizeString(options.causeCode);
        this.retryable = options.retryable === true;
        this.metadata = Object.freeze({ ...(options.metadata || {}) });
    }
}

function normalizeString(value) {
    return String(value || "").trim();
}

function assertId(value, field, code) {
    const normalized = normalizeString(value);
    if (!normalized || normalized.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
        throw new OrderRepositoryError(code, `${field} is invalid.`, { stage: "input", metadata: { field } });
    }
    return normalized;
}

function normalizeOwner(owner = {}) {
    const type = normalizeString(owner.type).toUpperCase();
    const userId = normalizeString(owner.userId);
    const sessionId = normalizeString(owner.sessionId);
    if (type === "USER" && userId) return { type, userId, sessionId: "" };
    if (type === "SESSION" && sessionId && !userId) return { type, userId: "", sessionId };
    throw new OrderRepositoryError(ERROR_CODES.INVALID_OWNER, "Valid USER or SESSION owner is required.", { stage: "input" });
}

function ownerQuery(owner) {
    const normalized = normalizeOwner(owner);
    if (normalized.type === "USER") {
        return { "owner.type": "USER", "owner.userId": normalized.userId };
    }
    return { "owner.type": "SESSION", "owner.sessionId": normalized.sessionId };
}

function normalizeOptions(options = {}) {
    return {
        session: options.session || options.mongoSession || null,
        lean: options.lean !== false,
        model: options.model || CommerceOrder
    };
}

function withSession(query, session) {
    return session && typeof query.session === "function" ? query.session(session) : query;
}

async function execQuery(query, { session = null, lean = true } = {}) {
    let request = withSession(query, session);
    if (lean && typeof request.lean === "function") request = request.lean();
    return request.exec ? request.exec() : request;
}

function plainRecord(record) {
    if (!record) return null;
    if (typeof record.toObject === "function") {
        return record.toObject({ depopulate: true, flattenMaps: true, versionKey: false });
    }
    const cloned = structuredClone(record);
    // structuredClone does not preserve BSON ObjectId prototypes. Keep the
    // canonical identity castable for downstream transactional references.
    if (record._id != null) cloned._id = String(record._id);
    return cloned;
}

function dispatchLifecycleEmail(order) {
    const status = normalizeString(order?.status);
    if (!order || !status) return;
    orderEmailService.notifyOrderTransition(order, { status }).catch(error => {
        console.log("Commerce order lifecycle email dispatch failed:", {
            orderId: order.orderId,
            status,
            code: error?.code || "ORDER_EMAIL_DISPATCH_FAILED"
        });
    });
}

function normalizeCheckoutIdentity(snapshot) {
    const payload = toOrderSnapshotPayload(snapshot);
    payload.checkout = payload.checkout || {};
    payload.checkout.idempotencyKeyHash = normalizeString(
        payload.checkout.idempotencyKeyHash ||
        payload.checkoutIdempotencyKeyHash ||
        payload.checkout.idempotencyKey
    );
    payload.checkout.requestFingerprint = normalizeString(
        payload.checkout.requestFingerprint ||
        payload.checkoutFingerprint ||
        payload.requestFingerprint
    );
    payload.status = normalizeString(payload.status || "pending_payment");
    payload.paymentStatus = normalizeString(payload.paymentStatus || payload.payment?.status || "unpaid");
    payload.payment = {
        ...(payload.payment || {}),
        status: payload.paymentStatus
    };
    payload.fulfilment = {
        input: {},
        ...(payload.fulfilment || {}),
        status: payload.fulfilment?.status || "not_started"
    };
    if (!payload.checkout.idempotencyKeyHash) {
        throw new OrderRepositoryError(ERROR_CODES.INVALID_IDEMPOTENCY_IDENTITY, "Checkout idempotency identity is required.", { stage: "create" });
    }
    if (!payload.checkout.requestFingerprint) {
        throw new OrderRepositoryError(ERROR_CODES.INVALID_REQUEST_FINGERPRINT, "Checkout request fingerprint is required.", { stage: "create" });
    }
    return payload;
}

function sameIdempotentPayload(existing, payload) {
    return Boolean(
        existing &&
        existing.quoteId === payload.quoteId &&
        existing.checkout?.idempotencyKeyHash === payload.checkout?.idempotencyKeyHash &&
        existing.checkout?.requestFingerprint === payload.checkout?.requestFingerprint
    );
}

async function findOne(model, query, options = {}) {
    return execQuery(model.findOne(query), options);
}

async function findOrderById(orderId, options = {}) {
    const normalized = assertId(orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID);
    const opts = normalizeOptions(options);
    try {
        return plainRecord(await findOne(opts.model, { orderId: normalized }, opts));
    } catch (error) {
        throw wrapError(error, ERROR_CODES.ORDER_READ_FAILED, "read");
    }
}

async function findOrderByQuoteId(quoteId, options = {}) {
    const normalized = assertId(quoteId, "quoteId", ERROR_CODES.INVALID_QUOTE_ID);
    const opts = normalizeOptions(options);
    try {
        return plainRecord(await findOne(opts.model, { quoteId: normalized }, opts));
    } catch (error) {
        throw wrapError(error, ERROR_CODES.ORDER_READ_FAILED, "read");
    }
}

async function findOrderByCheckoutId(checkoutId, options = {}) {
    const normalized = assertId(checkoutId, "checkoutId", ERROR_CODES.INVALID_CHECKOUT_ID);
    const opts = normalizeOptions(options);
    try {
        return plainRecord(await findOne(opts.model, { checkoutId: normalized }, opts));
    } catch (error) {
        throw wrapError(error, ERROR_CODES.ORDER_READ_FAILED, "read");
    }
}

async function findOwnedOrderById(input, options = {}) {
    const source = input || {};
    const orderId = assertId(source.orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID);
    const opts = normalizeOptions(options);
    try {
        return plainRecord(await findOne(opts.model, { orderId, ...ownerQuery(source.owner || {}) }, opts));
    } catch (error) {
        throw wrapError(error, ERROR_CODES.ORDER_READ_FAILED, "read");
    }
}

async function findOwnedOrdersByIds(input, options = {}) {
    const source = input || {};
    const orderIds = Array.from(new Set((Array.isArray(source.orderIds) ? source.orderIds : [])
        .map(orderId => assertId(orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID))));
    if (!orderIds.length) return [];
    const opts = normalizeOptions(options);
    try {
        let query = opts.model.find({
            orderId: { $in: orderIds },
            ...ownerQuery(source.owner || {})
        });
        query = withSession(query, opts.session);
        if (opts.lean && typeof query.lean === "function") query = query.lean();
        const result = query.exec ? await query.exec() : await query;
        return Array.isArray(result) ? result.map(plainRecord) : [];
    } catch (error) {
        throw wrapError(error, ERROR_CODES.ORDER_READ_FAILED, "read");
    }
}

async function findOwnedOrderByQuoteId(input, options = {}) {
    const source = input || {};
    const quoteId = assertId(source.quoteId, "quoteId", ERROR_CODES.INVALID_QUOTE_ID);
    const opts = normalizeOptions(options);
    try {
        return plainRecord(await findOne(opts.model, { quoteId, ...ownerQuery(source.owner || {}) }, opts));
    } catch (error) {
        throw wrapError(error, ERROR_CODES.ORDER_READ_FAILED, "read");
    }
}

async function findOwnedOrderByCheckoutIdempotency(input, options = {}) {
    const source = input || {};
    const idempotencyKeyHash = normalizeString(source.idempotencyKeyHash || source.idempotencyKey);
    if (!idempotencyKeyHash || idempotencyKeyHash.length > 4000) {
        throw new OrderRepositoryError(ERROR_CODES.INVALID_IDEMPOTENCY_IDENTITY, "Checkout idempotency identity is required.", { stage: "input" });
    }
    const opts = normalizeOptions(options);
    try {
        return plainRecord(await findOne(opts.model, {
            ...ownerQuery(source.owner || {}),
            "checkout.idempotencyKeyHash": idempotencyKeyHash,
            "commerce.source": "QUOTE_CHECKOUT"
        }, opts));
    } catch (error) {
        throw wrapError(error, ERROR_CODES.ORDER_READ_FAILED, "read");
    }
}

async function createOrderRecord(snapshot, options = {}) {
    const opts = normalizeOptions(options);
    const payload = normalizeCheckoutIdentity(snapshot);
    assertId(payload.orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID);
    assertId(payload.quoteId, "quoteId", ERROR_CODES.INVALID_QUOTE_ID);
    assertId(payload.checkoutId, "checkoutId", ERROR_CODES.INVALID_CHECKOUT_ID);
    normalizeOwner(payload.owner || {});

    try {
        const existingByIdem = await findOwnedOrderByCheckoutIdempotency({
            owner: payload.owner,
            idempotencyKeyHash: payload.checkout.idempotencyKeyHash
        }, opts);
        if (existingByIdem) {
            if (sameIdempotentPayload(existingByIdem, payload)) {
                return { ...existingByIdem, __commerceOrderPersistenceOutcome: "idempotent" };
            }
            throw new OrderRepositoryError(ERROR_CODES.CHECKOUT_IDEMPOTENCY_CONFLICT, "Checkout idempotency identity conflicts with an existing order.", {
                stage: "create",
                metadata: { orderId: existingByIdem.orderId }
            });
        }

        const existingByQuote = await findOrderByQuoteId(payload.quoteId, opts);
        if (existingByQuote) {
            if (sameIdempotentPayload(existingByQuote, payload)) {
                return { ...existingByQuote, __commerceOrderPersistenceOutcome: "idempotent" };
            }
            throw new OrderRepositoryError(ERROR_CODES.ORDER_ALREADY_EXISTS_FOR_QUOTE, "An order already exists for this quote.", {
                stage: "create",
                metadata: { quoteId: payload.quoteId }
            });
        }

        const created = plainRecord((await opts.model.create([payload], { session: opts.session || undefined }))[0]);
        dispatchLifecycleEmail(created);
        return created;
    } catch (error) {
        if (error instanceof OrderRepositoryError) throw error;
        throw classifyPersistenceError(error, payload);
    }
}

function transitionAllowed(map, current, next) {
    return Array.isArray(map[current]) && map[current].includes(next);
}

function normalizeStatusUpdate(input = {}, statusField, transitionMap, invalidCode) {
    const orderId = assertId(input.orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID);
    const toStatus = normalizeString(input.toStatus);
    if (!toStatus) {
        throw new OrderRepositoryError(invalidCode, "Target status is required.", { stage: "update" });
    }
    const fromStatuses = Array.isArray(input.fromStatuses) ? input.fromStatuses.map(normalizeString).filter(Boolean) : [];
    if (!fromStatuses.length) {
        throw new OrderRepositoryError(invalidCode, "Expected source statuses are required.", { stage: "update" });
    }
    fromStatuses.forEach(status => {
        if (!transitionAllowed(transitionMap, status, toStatus)) {
            throw new OrderRepositoryError(invalidCode, "Status transition is not allowed.", {
                stage: "update",
                metadata: { fromStatus: status, toStatus }
            });
        }
    });
    const changedAt = input.changedAt ? new Date(input.changedAt) : null;
    if (!changedAt || !Number.isFinite(changedAt.getTime())) {
        throw new OrderRepositoryError(invalidCode, "changedAt must be a valid timestamp.", { stage: "update" });
    }
    return {
        orderId,
        toStatus,
        fromStatuses,
        changedAt,
        reason: normalizeString(input.reason),
        owner: input.owner || null
    };
}

async function updateStatusField(input, options, config) {
    const normalized = normalizeStatusUpdate(input, config.publicField, config.transitions, config.invalidCode);
    const opts = normalizeOptions(options);
    const query = {
        orderId: normalized.orderId,
        [config.queryField]: { $in: normalized.fromStatuses }
    };
    if (normalized.owner) Object.assign(query, ownerQuery(normalized.owner));
    const update = {
        $set: {
            [config.queryField]: normalized.toStatus,
            updatedAt: normalized.changedAt
        },
        $push: {
            statusHistory: {
                field: config.publicField,
                fromStatuses: normalized.fromStatuses,
                toStatus: normalized.toStatus,
                reason: normalized.reason,
                changedAt: normalized.changedAt
            }
        }
    };
    if (config.nestedField) {
        update.$set[config.nestedField] = normalized.toStatus;
    }
    try {
        const updated = await execQuery(opts.model.findOneAndUpdate(query, update, { returnDocument: "after", runValidators: true }), opts);
        if (!updated) {
            throw new OrderRepositoryError(ERROR_CODES.ORDER_STATE_CONFLICT, "Order state no longer matches expected transition.", {
                stage: "update",
                metadata: { orderId: normalized.orderId, toStatus: normalized.toStatus }
            });
        }
        const projected = plainRecord(updated);
        // Lifecycle email authority belongs to the canonical CommerceOrder
        // status transition. Payment and fulfilment updates can carry values
        // such as "paid" or "completed" while order.status intentionally
        // remains at its prior lifecycle state.
        if (config.dispatchLifecycleEmail === true) dispatchLifecycleEmail(projected);
        return projected;
    } catch (error) {
        if (error instanceof OrderRepositoryError) throw error;
        throw wrapError(error, ERROR_CODES.ORDER_UPDATE_FAILED, "update");
    }
}

async function updateOrderStatus(input, options = {}) {
    const order = await updateStatusField(input, options, {
        publicField: "orderStatus",
        queryField: "status",
        dispatchLifecycleEmail: true,
        transitions: ORDER_TRANSITIONS,
        invalidCode: ERROR_CODES.INVALID_ORDER_STATUS_TRANSITION
    });
    if (normalizeString(input.toStatus) === "paid") {
        try {
            await ensurePaidOrderFulfillmentWork(order, { session: options.session || options.mongoSession || null });
        } catch (error) {
            throw new OrderRepositoryError(ERROR_CODES.ORDER_UPDATE_FAILED, "Commerce order persistence failed.", {
                stage: "fulfillment_work",
                causeCode: error?.code || error?.name || "",
                retryable: error?.retryable === true
            });
        }
    }
    return order;
}

async function updatePaymentStatus(input, options = {}) {
    const order = await updateStatusField(input, options, {
        publicField: "paymentStatus",
        queryField: "paymentStatus",
        nestedField: "payment.status",
        transitions: PAYMENT_TRANSITIONS,
        invalidCode: ERROR_CODES.INVALID_PAYMENT_STATUS_TRANSITION
    });
    if (normalizeString(input.toStatus) === "paid") {
        try {
            await ensurePaidOrderFulfillmentWork(order, { session: options.session || options.mongoSession || null });
        } catch (error) {
            throw new OrderRepositoryError(ERROR_CODES.ORDER_UPDATE_FAILED, "Commerce order persistence failed.", {
                stage: "fulfillment_work",
                causeCode: error?.code || error?.name || "",
                retryable: error?.retryable === true
            });
        }
    }
    return order;
}

function updateFulfilmentStatus(input, options = {}) {
    return updateStatusField(input, options, {
        publicField: "fulfilmentStatus",
        queryField: "fulfilment.status",
        transitions: FULFILMENT_TRANSITIONS,
        invalidCode: ERROR_CODES.INVALID_FULFILMENT_STATUS_TRANSITION
    });
}

async function appendOperationalReference(input = {}, options = {}) {
    const orderId = assertId(input.orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID);
    const reference = input.reference;
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
        throw new OrderRepositoryError(ERROR_CODES.INVALID_ORDER_RECORD, "Operational reference must be an object.", { stage: "update" });
    }
    const changedAt = input.changedAt ? new Date(input.changedAt) : null;
    if (!changedAt || !Number.isFinite(changedAt.getTime())) {
        throw new OrderRepositoryError(ERROR_CODES.INVALID_ORDER_RECORD, "changedAt must be supplied for operational reference updates.", { stage: "update" });
    }
    const opts = normalizeOptions(options);
    const query = { orderId };
    if (input.owner) Object.assign(query, ownerQuery(input.owner));
    try {
        const updated = await execQuery(opts.model.findOneAndUpdate(
            query,
            {
                $push: { operationalReferences: structuredClone(reference) },
                $set: { updatedAt: changedAt }
            },
            { returnDocument: "after", runValidators: true }
        ), opts);
        if (!updated) throw new OrderRepositoryError(ERROR_CODES.ORDER_NOT_FOUND, "Order not found.", { stage: "update" });
        return plainRecord(updated);
    } catch (error) {
        if (error instanceof OrderRepositoryError) throw error;
        throw wrapError(error, ERROR_CODES.ORDER_UPDATE_FAILED, "update");
    }
}

async function setPromotionRedemptionSnapshot(input = {}, options = {}) {
    const orderId = assertId(input.orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID);
    const snapshot = input.promotionRedemptionSnapshot || null;
    const changedAt = input.changedAt ? new Date(input.changedAt) : null;
    if (!changedAt || !Number.isFinite(changedAt.getTime())) {
        throw new OrderRepositoryError(ERROR_CODES.INVALID_ORDER_RECORD, "changedAt must be supplied for promotion redemption updates.", { stage: "update" });
    }
    const opts = normalizeOptions(options);
    const query = { orderId };
    if (input.owner) Object.assign(query, ownerQuery(input.owner));
    try {
        const updated = await execQuery(opts.model.findOneAndUpdate(
            query,
            {
                $set: {
                    promotionRedemptionSnapshot: snapshot ? structuredClone(snapshot) : null,
                    updatedAt: changedAt
                }
            },
            { returnDocument: "after", runValidators: true }
        ), opts);
        if (!updated) throw new OrderRepositoryError(ERROR_CODES.ORDER_NOT_FOUND, "Order not found.", { stage: "update" });
        return plainRecord(updated);
    } catch (error) {
        if (error instanceof OrderRepositoryError) throw error;
        throw wrapError(error, ERROR_CODES.ORDER_UPDATE_FAILED, "update");
    }
}

function classifyPersistenceError(error, payload = {}) {
    if (error?.code === 11000) {
        const keyPattern = error.keyPattern || {};
        if (keyPattern.orderId) return new OrderRepositoryError(ERROR_CODES.ORDER_ID_CONFLICT, "Order id already exists.", { stage: "create", metadata: { orderId: payload.orderId } });
        if (keyPattern.quoteId) return new OrderRepositoryError(ERROR_CODES.ORDER_ALREADY_EXISTS_FOR_QUOTE, "Quote already has an order.", { stage: "create", metadata: { quoteId: payload.quoteId } });
        if (keyPattern.checkoutId) return new OrderRepositoryError(ERROR_CODES.CHECKOUT_ID_CONFLICT, "Checkout id already exists.", { stage: "create", metadata: { checkoutId: payload.checkoutId } });
        if (keyPattern["checkout.idempotencyKeyHash"]) return new OrderRepositoryError(ERROR_CODES.CHECKOUT_IDEMPOTENCY_CONFLICT, "Checkout idempotency identity conflicts.", { stage: "create" });
        return new OrderRepositoryError(ERROR_CODES.ORDER_PERSISTENCE_FAILED, "Duplicate order constraint failed.", { stage: "create", causeCode: "11000" });
    }
    if (error?.name === "ValidationError") {
        return new OrderRepositoryError(ERROR_CODES.INVALID_ORDER_RECORD, "Order record validation failed.", {
            stage: "create",
            causeCode: "ValidationError",
            metadata: { paths: Object.keys(error.errors || {}) }
        });
    }
    return wrapError(error, ERROR_CODES.ORDER_CREATE_FAILED, "create");
}

function wrapError(error, code, stage) {
    if (error instanceof OrderRepositoryError) return error;
    const retryable = ["MongoNetworkError", "MongoServerSelectionError", "MongoTimeoutError"].includes(error?.name) ||
        ["ETIMEDOUT", "ECONNRESET", "WRITE_CONFLICT"].includes(error?.code);
    return new OrderRepositoryError(code, "Commerce order persistence failed.", {
        stage,
        causeCode: error?.code || error?.name || "",
        retryable,
        metadata: { message: error?.message || "" }
    });
}

module.exports = Object.freeze({
    createOrderRecord,
    findOrderById,
    findOwnedOrderById,
    findOwnedOrdersByIds,
    findOrderByQuoteId,
    findOwnedOrderByQuoteId,
    findOrderByCheckoutId,
    findOwnedOrderByCheckoutIdempotency,
    updateOrderStatus,
    updatePaymentStatus,
    updateFulfilmentStatus,
    appendOperationalReference,
    setPromotionRedemptionSnapshot,
    OrderRepositoryError,
    ERROR_CODES,
    ORDER_TRANSITIONS,
    PAYMENT_TRANSITIONS,
    FULFILMENT_TRANSITIONS
});
