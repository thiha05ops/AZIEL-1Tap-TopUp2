const PricingQuote = require("../../models/PricingQuote");

const STATUS = Object.freeze({
    ISSUED: "ISSUED",
    USED: "USED",
    EXPIRED: "EXPIRED",
    INVALIDATED: "INVALIDATED",
    CANCELLED: "CANCELLED"
});

const ERROR_CODES = Object.freeze({
    INVALID_QUOTE_RECORD: "INVALID_QUOTE_RECORD",
    INVALID_QUOTE_STATUS: "INVALID_QUOTE_STATUS",
    INVALID_OWNER: "INVALID_OWNER",
    INVALID_IDEMPOTENCY_KEY: "INVALID_IDEMPOTENCY_KEY",
    QUOTE_ALREADY_EXISTS: "QUOTE_ALREADY_EXISTS",
    IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
    QUOTE_NOT_FOUND: "QUOTE_NOT_FOUND",
    QUOTE_OWNERSHIP_MISMATCH: "QUOTE_OWNERSHIP_MISMATCH",
    QUOTE_ALREADY_USED: "QUOTE_ALREADY_USED",
    QUOTE_EXPIRED: "QUOTE_EXPIRED",
    QUOTE_TERMINAL: "QUOTE_TERMINAL",
    QUOTE_CONSUMPTION_CONFLICT: "QUOTE_CONSUMPTION_CONFLICT",
    INVALID_ORDER_REFERENCE: "INVALID_ORDER_REFERENCE",
    INVALID_TRANSITION: "INVALID_TRANSITION",
    PERSISTENCE_FAILURE: "PERSISTENCE_FAILURE"
});

class PricingQuotePersistenceError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "PricingQuotePersistenceError";
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

function normalizeString(value) {
    return String(value || "").trim();
}

function normalizeDate(value, field) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new PricingQuotePersistenceError(ERROR_CODES.INVALID_TRANSITION, "Invalid lifecycle timestamp.", { field });
    }
    return date;
}

function assertQuoteId(quoteId) {
    const normalized = normalizeString(quoteId);
    if (!normalized) {
        throw new PricingQuotePersistenceError(ERROR_CODES.INVALID_QUOTE_RECORD, "quoteId is required.", { field: "quoteId" });
    }
    return normalized;
}

function normalizeOwner({ userId = "", sessionId = "" } = {}) {
    const owner = {
        userId: normalizeString(userId),
        sessionId: normalizeString(sessionId)
    };
    if (!owner.userId && !owner.sessionId) {
        throw new PricingQuotePersistenceError(ERROR_CODES.INVALID_OWNER, "userId or sessionId is required.");
    }
    return owner;
}

function ownerQuery({ userId = "", sessionId = "" } = {}) {
    const owner = normalizeOwner({ userId, sessionId });
    const clauses = [];
    if (owner.userId) clauses.push({ "owner.userId": owner.userId });
    if (owner.sessionId) clauses.push({ "owner.sessionId": owner.sessionId });
    return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

function assertIdempotencyKey(idempotencyKey) {
    const normalized = normalizeString(idempotencyKey);
    if (!normalized || normalized.length > 200) {
        throw new PricingQuotePersistenceError(ERROR_CODES.INVALID_IDEMPOTENCY_KEY, "idempotencyKey must be a non-empty bounded string.");
    }
    return normalized;
}

function assertOrderReference(consumedOrderId) {
    const normalized = normalizeString(consumedOrderId);
    if (!normalized || normalized.length > 160) {
        throw new PricingQuotePersistenceError(ERROR_CODES.INVALID_ORDER_REFERENCE, "consumedOrderId must be a non-empty bounded string.");
    }
    return normalized;
}

function plainRecord(record) {
    if (!record) return null;
    if (typeof record.toObject === "function") {
        return record.toObject({ depopulate: true, flattenMaps: true, versionKey: false });
    }
    return record;
}

function quoteFingerprint(recordOrQuote) {
    return normalizeString(recordOrQuote?.integrityPayload?.canonicalSerialized);
}

function ownerMatches(record, owner) {
    const persisted = record?.owner || {};
    return Boolean(
        (owner.userId && persisted.userId === owner.userId) ||
        (owner.sessionId && persisted.sessionId === owner.sessionId)
    );
}

function assertRuntimeQuote(quote) {
    if (!quote || typeof quote !== "object") {
        throw new PricingQuotePersistenceError(ERROR_CODES.INVALID_QUOTE_RECORD, "quote must be a runtime quote object.");
    }
    if (!Object.isFrozen(quote)) {
        throw new PricingQuotePersistenceError(ERROR_CODES.INVALID_QUOTE_RECORD, "quote must be a frozen runtime snapshot.");
    }
    if (quote.status !== STATUS.ISSUED || quote.lifecycle?.status !== STATUS.ISSUED) {
        throw new PricingQuotePersistenceError(ERROR_CODES.INVALID_QUOTE_STATUS, "Only ISSUED quotes can be persisted.");
    }
    assertQuoteId(quote.quoteId);
    normalizeOwner(quote.owner);
    if (!quote.packageSnapshot?.packageId && !quote.packageSnapshot?.packageCode && !quote.packageSnapshot?.packageRef) {
        throw new PricingQuotePersistenceError(ERROR_CODES.INVALID_QUOTE_RECORD, "quote package snapshot requires stable identity.");
    }
    if (!quoteFingerprint(quote)) {
        throw new PricingQuotePersistenceError(ERROR_CODES.INVALID_QUOTE_RECORD, "quote requires canonical integrity payload.");
    }
}

function buildRecordPayload({ quote, idempotencyKey = "" }) {
    const normalizedIdempotencyKey = idempotencyKey ? assertIdempotencyKey(idempotencyKey) : "";
    return {
        quoteId: quote.quoteId,
        status: STATUS.ISSUED,
        quoteRuntimeVersion: quote.quoteRuntimeVersion,
        quoteSpecificationVersion: quote.quoteSpecificationVersion,
        payloadVersion: quote.payloadVersion,
        owner: { ...quote.owner },
        packageSnapshot: { ...quote.packageSnapshot },
        commercialSnapshot: { ...quote.commercialSnapshot },
        pricingSnapshot: quote.pricingSnapshot,
        promotionSnapshot: quote.promotionSnapshot,
        lifecycle: {
            ...quote.lifecycle,
            issuedAt: new Date(quote.lifecycle.issuedAt),
            expiresAt: new Date(quote.lifecycle.expiresAt),
            status: STATUS.ISSUED
        },
        integrityPayload: quote.integrityPayload,
        integrityMetadata: quote.integrityMetadata,
        trace: quote.trace,
        warnings: quote.warnings,
        idempotencyKey: normalizedIdempotencyKey,
        createdBySource: quote.trace?.issueSource || "pricing-quote-runtime"
    };
}

function withSession(query, mongoSession) {
    return mongoSession ? query.session(mongoSession) : query;
}

async function findOne(model, query, { mongoSession = null, lean = false } = {}) {
    let request = model.findOne(query);
    request = withSession(request, mongoSession);
    if (lean && typeof request.lean === "function") request = request.lean();
    return request.exec ? request.exec() : request;
}

async function createQuoteRecord({ quote, idempotencyKey = "", mongoSession = null, model = PricingQuote } = {}) {
    try {
        assertRuntimeQuote(quote);
        const payload = buildRecordPayload({ quote, idempotencyKey });

        if (payload.idempotencyKey) {
            const existing = await findOne(model, {
                ...ownerQuery(payload.owner),
                idempotencyKey: payload.idempotencyKey
            }, { mongoSession, lean: false });
            if (existing) {
                const existingPlain = plainRecord(existing);
                if (quoteFingerprint(existingPlain) === quoteFingerprint(payload)) {
                    return existing;
                }
                throw new PricingQuotePersistenceError(ERROR_CODES.IDEMPOTENCY_CONFLICT, "Idempotency key was reused for a different quote payload.", {
                    quoteId: quote.quoteId
                });
            }
        }

        const created = await model.create([payload], { session: mongoSession || undefined });
        return Array.isArray(created) ? created[0] : created;
    } catch (error) {
        if (error instanceof PricingQuotePersistenceError) throw error;
        if (error?.code === 11000) {
            throw new PricingQuotePersistenceError(ERROR_CODES.QUOTE_ALREADY_EXISTS, "Pricing quote already exists.", { quoteId: quote?.quoteId });
        }
        throw new PricingQuotePersistenceError(ERROR_CODES.PERSISTENCE_FAILURE, "Could not persist pricing quote.", { message: error.message });
    }
}

async function findQuoteById({ quoteId, mongoSession = null, lean = true, model = PricingQuote } = {}) {
    return findOne(model, { quoteId: assertQuoteId(quoteId) }, { mongoSession, lean });
}

async function findOwnedQuote({ quoteId, userId = "", sessionId = "", mongoSession = null, lean = true, model = PricingQuote } = {}) {
    const owner = normalizeOwner({ userId, sessionId });
    return findOne(model, { quoteId: assertQuoteId(quoteId), ...ownerQuery(owner) }, { mongoSession, lean });
}

async function classifyTerminalQuote({ quoteId, owner = null, usedAt = null, consumedOrderId = "", model = PricingQuote, mongoSession = null }) {
    const record = await findQuoteById({ quoteId, model, mongoSession, lean: true });
    if (!record) return ERROR_CODES.QUOTE_NOT_FOUND;
    if (owner && !ownerMatches(record, owner)) return ERROR_CODES.QUOTE_OWNERSHIP_MISMATCH;
    if (record.status === STATUS.USED) {
        if (consumedOrderId && record.consumedOrderId === consumedOrderId) return "IDEMPOTENT_USED";
        return record.consumedOrderId ? ERROR_CODES.QUOTE_CONSUMPTION_CONFLICT : ERROR_CODES.QUOTE_ALREADY_USED;
    }
    if (record.status === STATUS.ISSUED && usedAt && new Date(record.lifecycle.expiresAt).getTime() <= usedAt.getTime()) {
        return ERROR_CODES.QUOTE_EXPIRED;
    }
    if (record.status !== STATUS.ISSUED) return ERROR_CODES.QUOTE_TERMINAL;
    return ERROR_CODES.QUOTE_NOT_FOUND;
}

async function markQuoteUsed({ quoteId, userId = "", sessionId = "", consumedOrderId, usedAt, mongoSession = null, model = PricingQuote } = {}) {
    const owner = normalizeOwner({ userId, sessionId });
    const normalizedQuoteId = assertQuoteId(quoteId);
    const orderId = assertOrderReference(consumedOrderId);
    const usedDate = normalizeDate(usedAt, "usedAt");
    const query = {
        quoteId: normalizedQuoteId,
        ...ownerQuery(owner),
        status: STATUS.ISSUED,
        "lifecycle.status": STATUS.ISSUED,
        "lifecycle.expiresAt": { $gt: usedDate }
    };
    const update = {
        $set: {
            status: STATUS.USED,
            "lifecycle.status": STATUS.USED,
            "lifecycle.usedAt": usedDate,
            consumedOrderId: orderId
        }
    };
    let request = model.findOneAndUpdate(query, update, { returnDocument: "after", session: mongoSession || undefined, runValidators: true });
    const updated = request.exec ? await request.exec() : await request;
    if (updated) return { outcome: "success", quote: updated };

    const outcome = await classifyTerminalQuote({ quoteId: normalizedQuoteId, owner, usedAt: usedDate, consumedOrderId: orderId, model, mongoSession });
    if (outcome === "IDEMPOTENT_USED") {
        const existing = await findQuoteById({ quoteId: normalizedQuoteId, model, mongoSession, lean: false });
        return { outcome: "idempotent", quote: existing };
    }
    throw new PricingQuotePersistenceError(outcome, "Quote could not be marked used.", { quoteId: normalizedQuoteId });
}

async function markQuoteExpired({ quoteId, expiredAt, mongoSession = null, model = PricingQuote } = {}) {
    const normalizedQuoteId = assertQuoteId(quoteId);
    const expiredDate = normalizeDate(expiredAt, "expiredAt");
    const update = {
        $set: {
            status: STATUS.EXPIRED,
            "lifecycle.status": STATUS.EXPIRED,
            "lifecycle.expiredAt": expiredDate
        }
    };
    let request = model.findOneAndUpdate(
        { quoteId: normalizedQuoteId, status: STATUS.ISSUED, "lifecycle.status": STATUS.ISSUED, "lifecycle.expiresAt": { $lte: expiredDate } },
        update,
        { returnDocument: "after", session: mongoSession || undefined, runValidators: true }
    );
    const updated = request.exec ? await request.exec() : await request;
    if (updated) return { outcome: "success", quote: updated };
    const existing = await findQuoteById({ quoteId: normalizedQuoteId, model, mongoSession, lean: false });
    if (existing?.status === STATUS.EXPIRED) return { outcome: "idempotent", quote: existing };
    if (!existing) throw new PricingQuotePersistenceError(ERROR_CODES.QUOTE_NOT_FOUND, "Quote not found.", { quoteId: normalizedQuoteId });
    throw new PricingQuotePersistenceError(ERROR_CODES.QUOTE_TERMINAL, "Only expirable ISSUED quotes may be marked expired.", { quoteId: normalizedQuoteId, status: existing.status });
}

async function invalidateQuote({ quoteId, reason, invalidatedAt, mongoSession = null, model = PricingQuote } = {}) {
    const normalizedQuoteId = assertQuoteId(quoteId);
    const invalidatedDate = normalizeDate(invalidatedAt, "invalidatedAt");
    const normalizedReason = normalizeString(reason);
    if (!normalizedReason) {
        throw new PricingQuotePersistenceError(ERROR_CODES.INVALID_TRANSITION, "Invalidation reason is required.");
    }
    let request = model.findOneAndUpdate(
        { quoteId: normalizedQuoteId, status: STATUS.ISSUED, "lifecycle.status": STATUS.ISSUED },
        {
            $set: {
                status: STATUS.INVALIDATED,
                "lifecycle.status": STATUS.INVALIDATED,
                "lifecycle.invalidatedAt": invalidatedDate,
                invalidationReason: normalizedReason
            }
        },
        { returnDocument: "after", session: mongoSession || undefined, runValidators: true }
    );
    const updated = request.exec ? await request.exec() : await request;
    if (updated) return { outcome: "success", quote: updated };
    throw new PricingQuotePersistenceError(ERROR_CODES.QUOTE_TERMINAL, "Only ISSUED quotes may be invalidated.", { quoteId: normalizedQuoteId });
}

async function cancelQuote({ quoteId, cancelledAt, reason = "", mongoSession = null, model = PricingQuote } = {}) {
    const normalizedQuoteId = assertQuoteId(quoteId);
    const cancelledDate = normalizeDate(cancelledAt, "cancelledAt");
    let request = model.findOneAndUpdate(
        { quoteId: normalizedQuoteId, status: STATUS.ISSUED, "lifecycle.status": STATUS.ISSUED },
        {
            $set: {
                status: STATUS.CANCELLED,
                "lifecycle.status": STATUS.CANCELLED,
                "lifecycle.cancelledAt": cancelledDate,
                invalidationReason: normalizeString(reason)
            }
        },
        { returnDocument: "after", session: mongoSession || undefined, runValidators: true }
    );
    const updated = request.exec ? await request.exec() : await request;
    if (updated) return { outcome: "success", quote: updated };
    throw new PricingQuotePersistenceError(ERROR_CODES.QUOTE_TERMINAL, "Only ISSUED quotes may be cancelled.", { quoteId: normalizedQuoteId });
}

async function findExpirableQuotes({ before, limit = 100, mongoSession = null, model = PricingQuote } = {}) {
    const beforeDate = normalizeDate(before, "before");
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    let request = model
        .find({ status: STATUS.ISSUED, "lifecycle.status": STATUS.ISSUED, "lifecycle.expiresAt": { $lte: beforeDate } })
        .sort({ "lifecycle.expiresAt": 1 })
        .limit(boundedLimit);
    request = withSession(request, mongoSession);
    if (typeof request.lean === "function") request = request.lean();
    return request.exec ? request.exec() : request;
}

module.exports = Object.freeze({
    createQuoteRecord,
    findQuoteById,
    findOwnedQuote,
    markQuoteUsed,
    markQuoteExpired,
    invalidateQuote,
    cancelQuote,
    findExpirableQuotes,
    PricingQuotePersistenceError,
    ERROR_CODES,
    STATUS
});
