"use strict";

const PaymentAttempt = require("../../models/PaymentAttempt");

const STATUS = Object.freeze({
    UNPAID: "UNPAID",
    INITIATING: "INITIATING",
    PENDING: "PENDING",
    PAID: "PAID",
    FAILED: "FAILED",
    EXPIRED: "EXPIRED",
    CANCELLED: "CANCELLED",
    WAIVED: "WAIVED",
    REFUNDED: "REFUNDED"
});

const ERROR_CODES = Object.freeze({
    INVALID_PAYMENT_ATTEMPT_RECORD: "INVALID_PAYMENT_ATTEMPT_RECORD",
    INVALID_PAYMENT_ATTEMPT_ID: "INVALID_PAYMENT_ATTEMPT_ID",
    INVALID_ORDER_ID: "INVALID_ORDER_ID",
    INVALID_OWNER: "INVALID_OWNER",
    INVALID_PROVIDER_REFERENCE: "INVALID_PROVIDER_REFERENCE",
    INVALID_PROVIDER_EVENT: "INVALID_PROVIDER_EVENT",
    PAYMENT_ATTEMPT_EXISTS: "PAYMENT_ATTEMPT_EXISTS",
    PAYMENT_ATTEMPT_NOT_FOUND: "PAYMENT_ATTEMPT_NOT_FOUND",
    PAYMENT_ATTEMPT_FORBIDDEN: "PAYMENT_ATTEMPT_FORBIDDEN",
    PAYMENT_PROVIDER_REFERENCE_EXISTS: "PAYMENT_PROVIDER_REFERENCE_EXISTS",
    PAYMENT_INVALID_TRANSITION: "PAYMENT_INVALID_TRANSITION",
    PAYMENT_DUPLICATE_EVENT: "PAYMENT_DUPLICATE_EVENT",
    PAYMENT_IDEMPOTENCY_CONFLICT: "PAYMENT_IDEMPOTENCY_CONFLICT",
    PAYMENT_PERSISTENCE_ERROR: "PAYMENT_PERSISTENCE_ERROR"
});

const TRANSITIONS = Object.freeze({
    [STATUS.UNPAID]: Object.freeze([STATUS.INITIATING, STATUS.WAIVED]),
    [STATUS.INITIATING]: Object.freeze([STATUS.PENDING, STATUS.PAID, STATUS.FAILED, STATUS.EXPIRED, STATUS.CANCELLED]),
    [STATUS.PENDING]: Object.freeze([STATUS.PAID, STATUS.FAILED, STATUS.EXPIRED, STATUS.CANCELLED]),
    [STATUS.FAILED]: Object.freeze([STATUS.INITIATING, STATUS.CANCELLED]),
    [STATUS.EXPIRED]: Object.freeze([]),
    [STATUS.CANCELLED]: Object.freeze([]),
    [STATUS.PAID]: Object.freeze([STATUS.REFUNDED]),
    [STATUS.WAIVED]: Object.freeze([]),
    [STATUS.REFUNDED]: Object.freeze([])
});

const ACTIVE_STATUSES = Object.freeze([STATUS.INITIATING, STATUS.PENDING]);
const EVIDENCE_ACCEPTING_STATUSES = Object.freeze([STATUS.PENDING]);

class PaymentAttemptRepositoryError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "PaymentAttemptRepositoryError";
        this.code = code;
        this.stage = normalizeString(options.stage);
        this.causeCode = normalizeString(options.causeCode);
        this.retryable = options.retryable === true;
        this.metadata = Object.freeze({ ...(options.metadata || {}) });
    }
}

function clonePlain(value) {
    if (value === undefined) return undefined;
    return structuredClone(value);
}

function normalizeString(value) {
    return String(value || "").trim();
}

function normalizeStatus(value) {
    const status = normalizeString(value).replace(/-/g, "_").toUpperCase();
    if (!STATUS[status]) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_INVALID_TRANSITION, "Invalid payment attempt status.", {
            stage: "status",
            metadata: { status: value }
        });
    }
    return status;
}

function assertId(value, field, code) {
    const normalized = normalizeString(value);
    if (!normalized || normalized.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
        throw new PaymentAttemptRepositoryError(code, `${field} is invalid.`, { stage: "input", metadata: { field } });
    }
    return normalized;
}

function normalizeOptionalId(value, field, maxLength = 240) {
    const normalized = normalizeString(value);
    if (normalized && (normalized.length > maxLength || !/^[A-Za-z0-9._:-]+$/.test(normalized))) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, `${field} is invalid.`, {
            stage: "input",
            metadata: { field }
        });
    }
    return normalized;
}

function normalizeOwner(owner = {}) {
    const type = normalizeString(owner.type).toUpperCase();
    const userId = normalizeString(owner.userId);
    const sessionId = normalizeString(owner.sessionId);
    if ((type === "USER" || (!type && userId)) && userId) return { type: "USER", userId, sessionId: "", ownerId: userId };
    if ((type === "SESSION" || (!type && !userId && sessionId)) && sessionId && !userId) return { type: "SESSION", userId: "", sessionId, ownerId: sessionId };
    throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_OWNER, "Valid USER or SESSION owner is required.", { stage: "input" });
}

function ownerQuery(owner) {
    const normalized = normalizeOwner(owner);
    return {
        ownerId: normalized.ownerId,
        "owner.type": normalized.type
    };
}

function normalizeOptions(options = {}) {
    const transactionContext = options.transactionContext || null;
    return {
        mongoSession: options.mongoSession || options.session || transactionContext?.mongoSession || transactionContext?.session || null,
        lean: options.lean !== false,
        model: options.model || PaymentAttempt
    };
}

function withSession(query, mongoSession) {
    return mongoSession && typeof query.session === "function" ? query.session(mongoSession) : query;
}

async function execQuery(query, { mongoSession = null, lean = true } = {}) {
    let request = withSession(query, mongoSession);
    if (lean && typeof request.lean === "function") request = request.lean();
    return request.exec ? request.exec() : request;
}

function plainRecord(record) {
    if (!record) return null;
    if (typeof record.toObject === "function") {
        return record.toObject({ depopulate: true, flattenMaps: true, versionKey: false });
    }
    return clonePlain(record);
}

function safeMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const clone = clonePlain(value);
    delete clone.rawPayload;
    delete clone.webhookSignature;
    delete clone.signature;
    delete clone.secret;
    delete clone.apiKey;
    delete clone.authorization;
    return clone;
}

function normalizeReceiptEvidence(evidence = {}) {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "Receipt evidence must be an object.", {
            stage: "receipt"
        });
    }
    const receiptId = normalizeOptionalId(evidence.receiptId || evidence.id, "receiptId", 200);
    const fileReference = normalizeString(evidence.fileReference || evidence.storageKey || evidence.key).slice(0, 500);
    const checksum = normalizeString(evidence.checksum || evidence.sha256).slice(0, 160);
    if (!receiptId || !fileReference) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "Receipt evidence requires receiptId and fileReference.", {
            stage: "receipt"
        });
    }
    const fileSize = Number(evidence.fileSize || evidence.size || 0);
    if (!Number.isFinite(fileSize) || fileSize < 0 || fileSize > 20 * 1024 * 1024) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "Receipt file size is invalid.", {
            stage: "receipt"
        });
    }
    const uploadedAt = evidence.uploadedAt ? new Date(evidence.uploadedAt) : new Date();
    if (!Number.isFinite(uploadedAt.getTime())) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "Receipt uploadedAt is invalid.", {
            stage: "receipt"
        });
    }
    return {
        receiptId,
        fileReference,
        mimeType: normalizeString(evidence.mimeType || evidence.contentType).slice(0, 120),
        fileSize,
        checksum,
        uploadedAt
    };
}

function attemptFingerprint(source = {}) {
    return normalizeString(source.requestFingerprint || source.fingerprint);
}

function sameIdempotentPayload(existing = {}, payload = {}) {
    return Boolean(
        existing.orderId === payload.orderId &&
        existing.ownerId === payload.ownerId &&
        existing.provider === payload.provider &&
        existing.paymentMethod === payload.paymentMethod &&
        existing.idempotencyKey === payload.idempotencyKey &&
        attemptFingerprint(existing) === attemptFingerprint(payload)
    );
}

function normalizeAttemptPayload(source = {}) {
    const owner = normalizeOwner(source.owner || {});
    const amount = Number(source.amount);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "amount must be non-negative.", {
            stage: "create",
            metadata: { field: "amount" }
        });
    }
    const currency = normalizeString(source.currency).toUpperCase();
    if (!currency || currency.length > 12) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "currency is required.", {
            stage: "create",
            metadata: { field: "currency" }
        });
    }
    const paymentMethod = normalizeOptionalId(source.paymentMethod || source.paymentMethodId, "paymentMethod", 160);
    if (!paymentMethod) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "paymentMethod is required.", {
            stage: "create",
            metadata: { field: "paymentMethod" }
        });
    }
    const now = source.createdAt ? new Date(source.createdAt) : new Date();
    if (!Number.isFinite(now.getTime())) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "createdAt must be valid.", { stage: "create" });
    }
    const expiresAt = source.expiresAt ? new Date(source.expiresAt) : null;
    if (expiresAt && !Number.isFinite(expiresAt.getTime())) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "expiresAt must be valid.", { stage: "create" });
    }
    const failure = normalizeFailure(source.failure || {});
    return {
        attemptId: assertId(source.attemptId, "attemptId", ERROR_CODES.INVALID_PAYMENT_ATTEMPT_ID),
        orderId: assertId(source.orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID),
        quoteId: normalizeOptionalId(source.quoteId, "quoteId"),
        ownerId: owner.ownerId,
        owner: {
            type: owner.type,
            userId: owner.userId,
            sessionId: owner.sessionId
        },
        provider: normalizeOptionalId(source.provider, "provider", 160) || "manual",
        providerType: normalizeOptionalId(source.providerType, "providerType", 160),
        paymentMethod,
        paymentMethodId: paymentMethod,
        paymentChannel: normalizeOptionalId(source.paymentChannel, "paymentChannel", 120),
        confirmationMode: normalizeOptionalId(source.confirmationMode, "confirmationMode", 120),
        amount,
        currency,
        region: normalizeString(source.region).toUpperCase(),
        status: normalizeStatus(source.status || STATUS.UNPAID),
        providerReference: normalizeString(source.providerReference),
        providerTransactionId: normalizeString(source.providerTransactionId),
        rawProviderStatus: normalizeString(source.rawProviderStatus),
        idempotencyKey: normalizeString(source.idempotencyKey),
        operation: normalizeOptionalId(source.operation || "initiatePayment", "operation", 120),
        requestFingerprint: attemptFingerprint(source),
        previousAttemptId: normalizeOptionalId(source.previousAttemptId, "previousAttemptId"),
        providerMetadata: safeMetadata(source.providerMetadata),
        safeMetadata: safeMetadata(source.safeMetadata),
        paymentInstructions: clonePlain(source.paymentInstructions || null),
        qr: clonePlain(source.qr || null),
        redirect: clonePlain(source.redirect || null),
        failure,
        failureCategory: failure.category,
        failureCode: failure.code,
        failureMessage: failure.message,
        eventHistory: [],
        createdAt: now,
        updatedAt: source.updatedAt ? new Date(source.updatedAt) : now,
        expiresAt,
        completedAt: source.completedAt || null,
        cancelledAt: source.cancelledAt || null,
        expiredAt: source.expiredAt || null
    };
}

function transitionAllowed(current, next) {
    if (current === next) return true;
    return Array.isArray(TRANSITIONS[current]) && TRANSITIONS[current].includes(next);
}

function assertTransition(current, next) {
    const from = normalizeStatus(current);
    const to = normalizeStatus(next);
    if (!transitionAllowed(from, to)) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_INVALID_TRANSITION, "Payment attempt transition is not allowed.", {
            stage: "update",
            metadata: { fromStatus: from, toStatus: to }
        });
    }
    return { from, to, idempotent: from === to };
}

function normalizeStatusUpdate(input = {}) {
    const attemptId = assertId(input.attemptId, "attemptId", ERROR_CODES.INVALID_PAYMENT_ATTEMPT_ID);
    const toStatus = normalizeStatus(input.toStatus || input.status);
    const fromStatuses = Array.isArray(input.fromStatuses) ? input.fromStatuses.map(normalizeStatus) : [];
    if (!fromStatuses.length) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_INVALID_TRANSITION, "Expected source status is required.", {
            stage: "update"
        });
    }
    fromStatuses.forEach(status => assertTransition(status, toStatus));
    const changedAt = input.changedAt ? new Date(input.changedAt) : new Date();
    if (!Number.isFinite(changedAt.getTime())) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_INVALID_TRANSITION, "changedAt must be valid.", { stage: "update" });
    }
    return {
        attemptId,
        toStatus,
        fromStatuses,
        changedAt,
        reason: normalizeString(input.reason)
    };
}

function lifecycleTimestamp(status) {
    if (status === STATUS.PAID || status === STATUS.WAIVED || status === STATUS.REFUNDED) return "completedAt";
    if (status === STATUS.CANCELLED) return "cancelledAt";
    if (status === STATUS.EXPIRED) return "expiredAt";
    return "";
}

async function findOne(model, query, options = {}) {
    return execQuery(model.findOne(query), options);
}

async function createAttempt(input = {}, options = {}) {
    const opts = normalizeOptions({ ...options, transactionContext: input.transactionContext || options.transactionContext });
    const payload = normalizeAttemptPayload(input);
    try {
        if (payload.idempotencyKey) {
            const existing = await findOne(opts.model, {
                provider: payload.provider,
                ownerId: payload.ownerId,
                idempotencyKey: payload.idempotencyKey,
                operation: payload.operation
            }, { mongoSession: opts.mongoSession, lean: true });
            if (existing) {
                const existingPlain = plainRecord(existing);
                if (sameIdempotentPayload(existingPlain, payload)) return existingPlain;
                throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_IDEMPOTENCY_CONFLICT, "Payment attempt idempotency key conflicts.", {
                    stage: "create",
                    metadata: { attemptId: existingPlain.attemptId }
                });
            }
        }
        const created = await opts.model.create([payload], { session: opts.mongoSession || undefined });
        return plainRecord(Array.isArray(created) ? created[0] : created);
    } catch (error) {
        if (error instanceof PaymentAttemptRepositoryError) throw error;
        throw classifyPersistenceError(error, payload, "create");
    }
}

async function findAttemptById(input = {}, options = {}) {
    const attemptId = assertId(input.attemptId, "attemptId", ERROR_CODES.INVALID_PAYMENT_ATTEMPT_ID);
    const opts = normalizeOptions(options);
    try {
        return plainRecord(await findOne(opts.model, { attemptId }, opts));
    } catch (error) {
        throw wrapError(error, ERROR_CODES.PAYMENT_PERSISTENCE_ERROR, "read");
    }
}

async function findAttemptByIdForOwner(input = {}, options = {}) {
    const attemptId = assertId(input.attemptId, "attemptId", ERROR_CODES.INVALID_PAYMENT_ATTEMPT_ID);
    const opts = normalizeOptions(options);
    try {
        return plainRecord(await findOne(opts.model, { attemptId, ...ownerQuery(input.owner || {}) }, opts));
    } catch (error) {
        if (error instanceof PaymentAttemptRepositoryError) throw error;
        throw wrapError(error, ERROR_CODES.PAYMENT_PERSISTENCE_ERROR, "read");
    }
}

async function findAttemptsForOrder(input = {}, options = {}) {
    const orderId = assertId(input.orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID);
    const opts = normalizeOptions(options);
    let query = opts.model.find({ orderId });
    query = withSession(query, opts.mongoSession);
    if (typeof query.sort === "function") query = query.sort({ createdAt: -1 });
    if (opts.lean && typeof query.lean === "function") query = query.lean();
    const result = query.exec ? await query.exec() : await query;
    return Array.isArray(result) ? result.map(plainRecord) : [];
}

async function findActiveAttemptForOrder(input = {}, options = {}) {
    const orderId = assertId(input.orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID);
    const opts = normalizeOptions(options);
    try {
        return plainRecord(await findOne(opts.model, {
            orderId,
            ...ownerQuery(input.owner || {}),
            status: { $in: ACTIVE_STATUSES }
        }, opts));
    } catch (error) {
        if (error instanceof PaymentAttemptRepositoryError) throw error;
        throw wrapError(error, ERROR_CODES.PAYMENT_PERSISTENCE_ERROR, "read");
    }
}

async function findAttemptsForOwner(input = {}, options = {}) {
    const opts = normalizeOptions(options);
    const query = {
        ...ownerQuery(input.owner || {})
    };
    if (Array.isArray(input.statuses) && input.statuses.length) {
        query.status = { $in: input.statuses.map(normalizeStatus) };
    }
    if (input.provider) query.provider = normalizeOptionalId(input.provider, "provider", 160);
    if (input.expiresAfter) {
        const expiresAfter = new Date(input.expiresAfter);
        if (Number.isFinite(expiresAfter.getTime())) query.expiresAt = { $gt: expiresAfter };
    }
    try {
        let request = opts.model.find(query);
        request = withSession(request, opts.mongoSession);
        if (typeof request.sort === "function") request = request.sort({ createdAt: -1 });
        if (Number.isInteger(Number(input.limit)) && Number(input.limit) > 0) {
            request = request.limit(Math.min(Number(input.limit), 50));
        }
        if (opts.lean && typeof request.lean === "function") request = request.lean();
        const result = request.exec ? await request.exec() : await request;
        return Array.isArray(result) ? result.map(plainRecord) : [];
    } catch (error) {
        if (error instanceof PaymentAttemptRepositoryError) throw error;
        throw wrapError(error, ERROR_CODES.PAYMENT_PERSISTENCE_ERROR, "read");
    }
}

async function findAttemptByProviderReference(input = {}, options = {}) {
    const providerReference = assertId(
        input.providerReference || input.providerTransactionId,
        "providerReference",
        ERROR_CODES.INVALID_PROVIDER_REFERENCE
    );
    const opts = normalizeOptions(options);
    try {
        return plainRecord(await findOne(opts.model, {
            $or: [
                { providerReference },
                { providerTransactionId: providerReference }
            ]
        }, opts));
    } catch (error) {
        throw wrapError(error, ERROR_CODES.PAYMENT_PERSISTENCE_ERROR, "read");
    }
}

async function findAttemptByIdempotency(input = {}, options = {}) {
    const owner = normalizeOwner(input.owner || {});
    const orderId = assertId(input.orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID);
    const idempotencyKey = normalizeString(input.idempotencyKey);
    if (!idempotencyKey) return null;
    const opts = normalizeOptions(options);
    return plainRecord(await findOne(opts.model, {
        orderId,
        ownerId: owner.ownerId,
        idempotencyKey,
        operation: normalizeString(input.operation || "initiatePayment")
    }, opts));
}

async function updateStatus(input = {}, options = {}) {
    const normalized = normalizeStatusUpdate(input);
    const opts = normalizeOptions({ ...options, transactionContext: input.transactionContext || options.transactionContext });
    const set = {
        status: normalized.toStatus,
        updatedAt: normalized.changedAt
    };
    const timestampPath = lifecycleTimestamp(normalized.toStatus);
    if (timestampPath) set[timestampPath] = normalized.changedAt;
    try {
        const request = opts.model.findOneAndUpdate(
            { attemptId: normalized.attemptId, status: { $in: normalized.fromStatuses } },
            { $set: set },
            { returnDocument: "after", runValidators: true, session: opts.mongoSession || undefined }
        );
        const updated = request.exec ? await request.exec() : await request;
        if (updated) return plainRecord(updated);
        const existing = await findAttemptById({ attemptId: normalized.attemptId }, { ...opts, lean: true });
        if (!existing) throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_ATTEMPT_NOT_FOUND, "Payment attempt was not found.", { stage: "update" });
        if (existing.status === normalized.toStatus) return plainRecord(existing);
        throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_INVALID_TRANSITION, "Payment attempt state no longer matches expected transition.", {
            stage: "update",
            metadata: { attemptId: normalized.attemptId, status: existing.status, toStatus: normalized.toStatus }
        });
    } catch (error) {
        if (error instanceof PaymentAttemptRepositoryError) throw error;
        throw wrapError(error, ERROR_CODES.PAYMENT_PERSISTENCE_ERROR, "update");
    }
}

function normalizeProviderEvent(event = {}) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PROVIDER_EVENT, "Provider event must be normalized object.", { stage: "event" });
    }
    const status = normalizeStatus(event.status || event.paymentStatus);
    const receivedAt = event.receivedAt ? new Date(event.receivedAt) : new Date();
    if (!Number.isFinite(receivedAt.getTime())) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PROVIDER_EVENT, "Provider event receivedAt must be valid.", { stage: "event" });
    }
    const occurredAt = event.occurredAt || event.eventTimestamp ? new Date(event.occurredAt || event.eventTimestamp) : null;
    if (occurredAt && !Number.isFinite(occurredAt.getTime())) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PROVIDER_EVENT, "Provider event occurredAt must be valid.", { stage: "event" });
    }
    return {
        providerEventId: normalizeString(event.providerEventId),
        provider: normalizeString(event.provider),
        providerReference: normalizeString(event.providerReference),
        providerTransactionId: normalizeString(event.providerTransactionId),
        eventType: normalizeString(event.eventType || event.type),
        status,
        amount: event.amount == null ? null : Number(event.amount),
        currency: normalizeString(event.currency).toUpperCase(),
        occurredAt,
        receivedAt,
        safeMetadata: safeMetadata(event.safeMetadata)
    };
}

async function appendProviderEvent(input = {}, options = {}) {
    const attemptId = assertId(input.attemptId, "attemptId", ERROR_CODES.INVALID_PAYMENT_ATTEMPT_ID);
    const providerEvent = normalizeProviderEvent(input.providerEvent || input.event || {});
    const opts = normalizeOptions({ ...options, transactionContext: input.transactionContext || options.transactionContext });
    const existing = await findAttemptById({ attemptId }, { ...opts, lean: true });
    if (!existing) throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_ATTEMPT_NOT_FOUND, "Payment attempt was not found.", { stage: "event" });
    if (providerEvent.providerEventId && (existing.eventHistory || []).some(event => event.providerEventId === providerEvent.providerEventId)) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_DUPLICATE_EVENT, "Provider event already exists for this attempt.", {
            stage: "event",
            metadata: { attemptId, providerEventId: providerEvent.providerEventId }
        });
    }
    const updateQuery = { attemptId };
    if (providerEvent.providerEventId) {
        updateQuery["eventHistory.providerEventId"] = { $ne: providerEvent.providerEventId };
    }
    const request = opts.model.findOneAndUpdate(
        updateQuery,
        {
            $push: { eventHistory: providerEvent },
            $set: { updatedAt: providerEvent.receivedAt }
        },
        { returnDocument: "after", runValidators: true, session: opts.mongoSession || undefined }
    );
    const updated = request.exec ? await request.exec() : await request;
    if (!updated) {
        const current = await findAttemptById({ attemptId }, { ...opts, lean: true });
        if (current && providerEvent.providerEventId && (current.eventHistory || []).some(event => event.providerEventId === providerEvent.providerEventId)) {
            throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_DUPLICATE_EVENT, "Provider event already exists for this attempt.", {
                stage: "event",
                metadata: { attemptId, providerEventId: providerEvent.providerEventId }
            });
        }
        throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_ATTEMPT_NOT_FOUND, "Payment attempt was not found.", { stage: "event" });
    }
    return plainRecord(updated);
}

async function attachReceiptEvidence(input = {}, options = {}) {
    const attemptId = assertId(input.attemptId, "attemptId", ERROR_CODES.INVALID_PAYMENT_ATTEMPT_ID);
    const orderId = input.orderId ? assertId(input.orderId, "orderId", ERROR_CODES.INVALID_ORDER_ID) : "";
    const evidence = normalizeReceiptEvidence(input.evidence || input.receiptEvidence || {});
    const changedAt = input.changedAt ? new Date(input.changedAt) : evidence.uploadedAt;
    if (!Number.isFinite(changedAt.getTime())) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "changedAt must be valid.", { stage: "receipt" });
    }
    const opts = normalizeOptions({ ...options, transactionContext: input.transactionContext || options.transactionContext });
    const existing = await findAttemptById({ attemptId }, { ...opts, lean: true });
    if (!existing) throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_ATTEMPT_NOT_FOUND, "Payment attempt was not found.", { stage: "receipt" });
    if (orderId && existing.orderId !== orderId) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "Receipt evidence order binding mismatch.", {
            stage: "receipt"
        });
    }
    const currentEvidence = existing.safeMetadata?.receiptEvidence || null;
    if (currentEvidence?.checksum && evidence.checksum && currentEvidence.checksum === evidence.checksum) return existing;
    if (!EVIDENCE_ACCEPTING_STATUSES.includes(existing.status)) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_INVALID_TRANSITION, "Receipt evidence cannot be attached to this payment state.", {
            stage: "receipt",
            metadata: { status: existing.status }
        });
    }
    const receiptEvent = {
        providerEventId: normalizeString(input.eventId || `receipt:${attemptId}:${evidence.receiptId}`),
        provider: normalizeString(existing.provider),
        providerReference: normalizeString(existing.providerReference),
        providerTransactionId: normalizeString(existing.providerTransactionId || existing.providerReference),
        eventType: "RECEIPT_EVIDENCE_ATTACHED",
        status: existing.status,
        amount: existing.amount,
        currency: existing.currency,
        occurredAt: evidence.uploadedAt,
        receivedAt: changedAt,
        safeMetadata: { receiptId: evidence.receiptId, checksum: evidence.checksum }
    };
    const request = opts.model.findOneAndUpdate(
        {
            attemptId,
            status: { $in: EVIDENCE_ACCEPTING_STATUSES },
            "eventHistory.providerEventId": { $ne: receiptEvent.providerEventId }
        },
        {
            $set: {
                "safeMetadata.receiptEvidence": evidence,
                "safeMetadata.receiptAttached": true,
                updatedAt: changedAt
            },
            $push: { eventHistory: receiptEvent }
        },
        { returnDocument: "after", runValidators: true, session: opts.mongoSession || undefined }
    );
    const updated = request.exec ? await request.exec() : await request;
    if (updated) return plainRecord(updated);
    const current = await findAttemptById({ attemptId }, { ...opts, lean: true });
    if (current?.safeMetadata?.receiptEvidence?.checksum && evidence.checksum && current.safeMetadata.receiptEvidence.checksum === evidence.checksum) {
        return current;
    }
    throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_INVALID_TRANSITION, "Receipt evidence could not be attached.", {
        stage: "receipt",
        metadata: { attemptId }
    });
}

function normalizeFailure(failure = {}) {
    return {
        category: normalizeString(failure.category || failure.failureCategory),
        code: normalizeString(failure.code || failure.failureCode),
        message: normalizeString(failure.safeMessage || failure.message || failure.failureMessage).slice(0, 500),
        recordedAt: failure.recordedAt ? new Date(failure.recordedAt) : null
    };
}

async function recordFailure(input = {}, options = {}) {
    const attemptId = assertId(input.attemptId, "attemptId", ERROR_CODES.INVALID_PAYMENT_ATTEMPT_ID);
    const failure = normalizeFailure(input.error || input.failure || input);
    const changedAt = input.changedAt ? new Date(input.changedAt) : new Date();
    if (!Number.isFinite(changedAt.getTime())) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "changedAt must be valid.", { stage: "failure" });
    }
    failure.recordedAt = failure.recordedAt || changedAt;
    const opts = normalizeOptions({ ...options, transactionContext: input.transactionContext || options.transactionContext });
    const request = opts.model.findOneAndUpdate(
        { attemptId },
        {
            $set: {
                status: normalizeStatus(input.status || STATUS.FAILED),
                failure,
                failureCategory: failure.category,
                failureCode: failure.code,
                failureMessage: failure.message,
                updatedAt: changedAt
            }
        },
        { returnDocument: "after", runValidators: true, session: opts.mongoSession || undefined }
    );
    const updated = request.exec ? await request.exec() : await request;
    if (!updated) throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_ATTEMPT_NOT_FOUND, "Payment attempt was not found.", { stage: "failure" });
    return plainRecord(updated);
}

async function setProviderReference(input = {}, options = {}) {
    const attemptId = assertId(input.attemptId, "attemptId", ERROR_CODES.INVALID_PAYMENT_ATTEMPT_ID);
    const providerReference = assertId(
        input.providerReference || input.providerTransactionId,
        "providerReference",
        ERROR_CODES.INVALID_PROVIDER_REFERENCE
    );
    const opts = normalizeOptions({ ...options, transactionContext: input.transactionContext || options.transactionContext });
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && !Number.isFinite(expiresAt.getTime())) {
        throw new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "expiresAt must be valid.", {
            stage: "reference",
            metadata: { field: "expiresAt" }
        });
    }
    try {
        const existingReference = await findAttemptByProviderReference({ providerReference }, { ...opts, lean: true })
            .catch(error => {
                if (error instanceof PaymentAttemptRepositoryError && error.code === ERROR_CODES.PAYMENT_PERSISTENCE_ERROR) throw error;
                return null;
            });
        if (existingReference && existingReference.attemptId !== attemptId) {
            throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_PROVIDER_REFERENCE_EXISTS, "Provider reference already exists.", {
                stage: "reference",
                metadata: { providerReference }
            });
        }
        const request = opts.model.findOneAndUpdate(
            { attemptId },
            {
                $set: {
                    providerReference,
                    providerTransactionId: normalizeString(input.providerTransactionId || providerReference),
                    rawProviderStatus: normalizeString(input.rawProviderStatus),
                    providerMetadata: safeMetadata(input.providerMetadata),
                    safeMetadata: safeMetadata(input.safeMetadata),
                    paymentInstructions: clonePlain(input.paymentInstructions || null),
                    qr: clonePlain(input.qr || null),
                    expiresAt,
                    updatedAt: input.changedAt ? new Date(input.changedAt) : new Date()
                }
            },
            { returnDocument: "after", runValidators: true, session: opts.mongoSession || undefined }
        );
        const updated = request.exec ? await request.exec() : await request;
        if (!updated) throw new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_ATTEMPT_NOT_FOUND, "Payment attempt was not found.", { stage: "reference" });
        return plainRecord(updated);
    } catch (error) {
        if (error instanceof PaymentAttemptRepositoryError) throw error;
        throw classifyPersistenceError(error, { attemptId, providerReference }, "reference");
    }
}

function markCompleted(input = {}, options = {}) {
    return updateStatus({ ...input, toStatus: input.toStatus || STATUS.PAID }, options);
}

function markCancelled(input = {}, options = {}) {
    return updateStatus({ ...input, toStatus: STATUS.CANCELLED }, options);
}

function markExpired(input = {}, options = {}) {
    return updateStatus({ ...input, toStatus: STATUS.EXPIRED }, options);
}

function classifyPersistenceError(error, payload = {}, stage = "persistence") {
    if (error?.code === 11000) {
        const keyPattern = error.keyPattern || {};
        if (keyPattern.attemptId) {
            return new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_ATTEMPT_EXISTS, "Payment attempt already exists.", {
                stage,
                metadata: { attemptId: payload.attemptId }
            });
        }
        if (keyPattern.providerReference) {
            return new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_PROVIDER_REFERENCE_EXISTS, "Provider reference already exists.", {
                stage,
                metadata: { providerReference: payload.providerReference }
            });
        }
        if (keyPattern.idempotencyKey || (keyPattern.provider && keyPattern.ownerId && keyPattern.idempotencyKey)) {
            return new PaymentAttemptRepositoryError(ERROR_CODES.PAYMENT_IDEMPOTENCY_CONFLICT, "Payment attempt idempotency key conflicts.", { stage });
        }
    }
    if (error?.name === "ValidationError") {
        return new PaymentAttemptRepositoryError(ERROR_CODES.INVALID_PAYMENT_ATTEMPT_RECORD, "Payment attempt validation failed.", {
            stage,
            causeCode: "ValidationError",
            metadata: { paths: Object.keys(error.errors || {}) }
        });
    }
    return wrapError(error, ERROR_CODES.PAYMENT_PERSISTENCE_ERROR, stage);
}

function wrapError(error, code, stage) {
    if (error instanceof PaymentAttemptRepositoryError) return error;
    const retryable = ["MongoNetworkError", "MongoServerSelectionError", "MongoTimeoutError"].includes(error?.name) ||
        ["ETIMEDOUT", "ECONNRESET", "WRITE_CONFLICT"].includes(error?.code);
    return new PaymentAttemptRepositoryError(code, "Payment attempt persistence failed.", {
        stage,
        causeCode: error?.code || error?.name || "",
        retryable,
        metadata: { message: error?.message || "" }
    });
}

module.exports = Object.freeze({
    createAttempt,
    findAttemptById,
    findAttemptByIdForOwner,
    findAttemptsForOrder,
    findActiveAttemptForOrder,
    findAttemptsForOwner,
    findAttemptByProviderReference,
    findAttemptByIdempotency,
    updateStatus,
    updateAttemptStatus: updateStatus,
    appendProviderEvent,
    attachReceiptEvidence,
    recordFailure,
    setProviderReference,
    markCompleted,
    markCancelled,
    markExpired,
    PaymentAttemptRepositoryError,
    ERROR_CODES,
    STATUS,
    TRANSITIONS,
    ACTIVE_STATUSES
});
