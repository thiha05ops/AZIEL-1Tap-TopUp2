const assert = require("assert");
const mongoose = require("mongoose");

const PricingQuote = require("../models/PricingQuote");
const { createPricingQuote } = require("../services/commerce/pricingQuoteRuntime");
const {
    createQuoteRecord,
    findQuoteById,
    findOwnedQuote,
    markQuoteUsed,
    markQuoteExpired,
    invalidateQuote,
    cancelQuote,
    findExpirableQuotes,
    PricingQuotePersistenceError,
    ERROR_CODES
} = require("../services/commerce/pricingQuoteRepository");

const ISSUED_AT = "2026-07-26T12:00:00.000Z";
const EXPIRES_AT = "2026-07-26T12:10:00.000Z";

function clone(value) {
    return structuredClone(JSON.parse(JSON.stringify(value)));
}

function assertError(fn, code, message) {
    return Promise.resolve()
        .then(fn)
        .then(() => {
            throw new Error(`Expected ${code}: ${message}`);
        })
        .catch(error => {
            assert(error instanceof PricingQuotePersistenceError, message);
            assert.strictEqual(error.code, code, message);
        });
}

function pricingInput(overrides = {}) {
    return {
        supplierCost: 1000,
        supplierCurrency: "THB",
        targetCurrency: "THB",
        policy: {
            profitRule: { type: "FIXED", value: 200 },
            gatewayFee: { enabled: true, type: "PERCENT", value: 2 },
            roundingRule: { enabled: false, mode: "NONE" }
        },
        ...overrides
    };
}

function quoteInput(overrides = {}) {
    return {
        quoteId: "AZQ_PERSIST_0001",
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
        owner: {
            userId: "user-1",
            sessionId: "session-1"
        },
        request: {
            region: "TH",
            currency: "THB",
            package: {
                packageId: "MLBB-7740",
                packageCode: "MLBB_7740",
                packageRef: "64f000000000000000000001",
                packageName: "7740+1548 Diamonds",
                gameId: "mlbb",
                categoryId: "mobile-games"
            },
            couponCode: ""
        },
        pricingInput: pricingInput(),
        versionContext: {
            priceVersionId: "pv-1",
            priceVersionNumber: 1,
            branchKey: "main"
        },
        trace: {
            traceId: "trace-1",
            issueSource: "persistence-verifier"
        },
        ...overrides
    };
}

function quote(overrides = {}) {
    return createPricingQuote(quoteInput(overrides));
}

function pathImmutable(pathName) {
    return PricingQuote.schema.path(pathName)?.options?.immutable === true;
}

async function expectInvalid(docFactory, pathName, message) {
    let error = null;
    try {
        const doc = docFactory();
        await doc.validate();
    } catch (validationError) {
        error = validationError;
    }
    assert(error?.errors?.[pathName], message);
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
    target[last] = value;
}

function matches(record, query = {}) {
    return Object.entries(query).every(([key, expected]) => {
        if (key === "$or") return expected.some(clause => matches(record, clause));
        const actual = getPath(record, key);
        if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
            if (Object.prototype.hasOwnProperty.call(expected, "$gt")) return new Date(actual).getTime() > new Date(expected.$gt).getTime();
            if (Object.prototype.hasOwnProperty.call(expected, "$lte")) return new Date(actual).getTime() <= new Date(expected.$lte).getTime();
        }
        return actual === expected;
    });
}

class FakeQuery {
    constructor(executor) {
        this.executor = executor;
        this.limitValue = null;
        this.sortSpec = null;
    }

    session() {
        return this;
    }

    lean() {
        return this;
    }

    sort(spec) {
        this.sortSpec = spec;
        return this;
    }

    limit(value) {
        this.limitValue = value;
        return this;
    }

    async exec() {
        let result = await this.executor();
        if (Array.isArray(result) && this.sortSpec) {
            const [[field, direction]] = Object.entries(this.sortSpec);
            result = [...result].sort((a, b) => {
                const diff = new Date(getPath(a, field)).getTime() - new Date(getPath(b, field)).getTime();
                return direction >= 0 ? diff : -diff;
            });
        }
        if (Array.isArray(result) && this.limitValue !== null) {
            result = result.slice(0, this.limitValue);
        }
        return clone(result);
    }
}

function createFakeModel() {
    const records = [];
    return {
        records,
        findOne(query) {
            return new FakeQuery(async () => records.find(record => matches(record, query)) || null);
        },
        find(query) {
            return new FakeQuery(async () => records.filter(record => matches(record, query)));
        },
        findOneAndUpdate(query, update) {
            return new FakeQuery(async () => {
                const index = records.findIndex(record => matches(record, query));
                if (index === -1) return null;
                Object.entries(update.$set || {}).forEach(([pathName, value]) => setPath(records[index], pathName, value instanceof Date ? value.toISOString() : value));
                return records[index];
            });
        },
        async create(payloads) {
            const created = [];
            for (const payload of payloads) {
                if (records.some(record => record.quoteId === payload.quoteId)) {
                    const error = new Error("duplicate key");
                    error.code = 11000;
                    throw error;
                }
                const doc = new PricingQuote(payload);
                await doc.validate();
                const plain = clone(doc.toObject({ depopulate: true, flattenMaps: true, versionKey: false }));
                records.push(plain);
                created.push(plain);
            }
            return created;
        }
    };
}

async function verifyModel() {
    const validQuote = quote();
    const doc = new PricingQuote({
        ...validQuote,
        lifecycle: {
            ...validQuote.lifecycle,
            issuedAt: new Date(validQuote.lifecycle.issuedAt),
            expiresAt: new Date(validQuote.lifecycle.expiresAt)
        }
    });
    await doc.validate();

    assert(pathImmutable("quoteId"), "quoteId must be immutable.");
    assert(pathImmutable("owner"), "owner must be immutable.");
    assert(pathImmutable("packageSnapshot"), "packageSnapshot must be immutable.");
    assert(pathImmutable("commercialSnapshot"), "commercialSnapshot must be immutable.");
    assert(pathImmutable("pricingSnapshot"), "pricingSnapshot must be immutable.");
    assert(pathImmutable("promotionSnapshot"), "promotionSnapshot must be immutable.");
    assert(pathImmutable("integrityPayload"), "integrityPayload must be immutable.");

    await expectInvalid(() => new PricingQuote({ ...validQuote, quoteId: "" }), "quoteId", "missing quoteId rejected.");
    await expectInvalid(() => new PricingQuote({ ...validQuote, owner: {} }), "owner", "invalid owner rejected.");
    await expectInvalid(() => new PricingQuote({ ...validQuote, packageSnapshot: { quantity: 1 } }), "packageSnapshot", "missing package identity rejected.");
    await expectInvalid(() => new PricingQuote({ ...validQuote, commercialSnapshot: { ...validQuote.commercialSnapshot, originalPrice: -1 } }), "commercialSnapshot.originalPrice", "invalid amount rejected.");
    await expectInvalid(() => new PricingQuote({ ...validQuote, lifecycle: { ...validQuote.lifecycle, expiresAt: validQuote.lifecycle.issuedAt } }), "lifecycle", "invalid time window rejected.");

    assert.throws(() => new PricingQuote({ ...validQuote, unexpected: true }), /not in schema/, "unknown fields rejected.");

    const indexes = PricingQuote.schema.indexes();
    assert(indexes.some(([fields, options]) => fields.quoteId === 1 && options.unique), "unique quoteId index required.");
    assert(indexes.some(([fields]) => fields["owner.userId"] === 1 && fields.status === 1), "owner.userId + status index required.");
    assert(indexes.some(([fields]) => fields["owner.sessionId"] === 1 && fields.status === 1), "owner.sessionId + status index required.");
    assert(indexes.some(([fields]) => fields["lifecycle.expiresAt"] === 1 && fields.status === 1), "expiry/status index required.");
    assert(indexes.some(([fields, options]) => fields["owner.userId"] === 1 && fields.idempotencyKey === 1 && options.unique && options.partialFilterExpression), "user scoped idempotency partial unique index required.");
    assert(indexes.some(([fields, options]) => fields["owner.sessionId"] === 1 && fields.idempotencyKey === 1 && options.unique && options.partialFilterExpression), "session scoped idempotency partial unique index required.");
    assert(indexes.some(([fields, options]) => fields.cleanupAt === 1 && options.expireAfterSeconds === 0), "cleanupAt TTL index required.");
}

async function verifyCreateLoadAndIdempotency() {
    const model = createFakeModel();
    const firstQuote = quote();
    const created = await createQuoteRecord({ quote: firstQuote, idempotencyKey: "idem-1", model });
    assert.strictEqual(created.quoteId, firstQuote.quoteId, "valid quote persists.");

    const byId = await findQuoteById({ quoteId: firstQuote.quoteId, model });
    assert.strictEqual(byId.quoteId, firstQuote.quoteId, "find by quoteId works.");

    const ownedByUser = await findOwnedQuote({ quoteId: firstQuote.quoteId, userId: "user-1", model });
    assert.strictEqual(ownedByUser.quoteId, firstQuote.quoteId, "user-owned quote loads.");

    const ownedBySession = await findOwnedQuote({ quoteId: firstQuote.quoteId, sessionId: "session-1", model });
    assert.strictEqual(ownedBySession.quoteId, firstQuote.quoteId, "session-owned quote loads.");

    const wrongOwner = await findOwnedQuote({ quoteId: firstQuote.quoteId, userId: "other", model });
    assert.strictEqual(wrongOwner, null, "wrong owner returns null.");

    assert.strictEqual(await findQuoteById({ quoteId: "missing", model }), null, "missing quote returns null.");

    const retry = await createQuoteRecord({ quote: firstQuote, idempotencyKey: "idem-1", model });
    assert.strictEqual(retry.quoteId, firstQuote.quoteId, "same idempotency and payload returns existing record.");

    const sameKeyDifferentPayload = quote({ quoteId: "AZQ_PERSIST_0002", request: { ...quoteInput().request, package: { ...quoteInput().request.package, packageCode: "OTHER" } } });
    await assertError(() => createQuoteRecord({ quote: sameKeyDifferentPayload, idempotencyKey: "idem-1", model }), ERROR_CODES.IDEMPOTENCY_CONFLICT, "conflicting idempotency payload rejected.");

    const otherOwnerSameKey = quote({ quoteId: "AZQ_PERSIST_0003", owner: { userId: "user-2" } });
    const createdOtherOwner = await createQuoteRecord({ quote: otherOwnerSameKey, idempotencyKey: "idem-1", model });
    assert.strictEqual(createdOtherOwner.quoteId, "AZQ_PERSIST_0003", "different owner may reuse same idempotency key.");

    await assertError(() => createQuoteRecord({ quote: firstQuote, model }), ERROR_CODES.QUOTE_ALREADY_EXISTS, "duplicate quoteId rejected.");
    await assertError(() => createQuoteRecord({ quote: { ...firstQuote }, model }), ERROR_CODES.INVALID_QUOTE_RECORD, "non-frozen quote rejected.");
}

async function verifyConsumptionAndExpiry() {
    const model = createFakeModel();
    const active = quote({ quoteId: "AZQ_USE_0001" });
    await createQuoteRecord({ quote: active, model });

    const used = await markQuoteUsed({
        quoteId: active.quoteId,
        userId: "user-1",
        consumedOrderId: "ORD-1",
        usedAt: "2026-07-26T12:05:00.000Z",
        model
    });
    assert.strictEqual(used.outcome, "success", "ISSUED quote marked USED.");
    assert.strictEqual(used.quote.status, "USED", "used status stored.");
    assert.strictEqual(used.quote.consumedOrderId, "ORD-1", "consumed order stored.");

    const retry = await markQuoteUsed({
        quoteId: active.quoteId,
        userId: "user-1",
        consumedOrderId: "ORD-1",
        usedAt: "2026-07-26T12:05:10.000Z",
        model
    });
    assert.strictEqual(retry.outcome, "idempotent", "same order retry is idempotent.");

    await assertError(() => markQuoteUsed({
        quoteId: active.quoteId,
        userId: "user-1",
        consumedOrderId: "ORD-2",
        usedAt: "2026-07-26T12:05:20.000Z",
        model
    }), ERROR_CODES.QUOTE_CONSUMPTION_CONFLICT, "different-order retry conflicts.");

    const expiredBoundary = quote({ quoteId: "AZQ_USE_0002" });
    await createQuoteRecord({ quote: expiredBoundary, model });
    await assertError(() => markQuoteUsed({
        quoteId: expiredBoundary.quoteId,
        userId: "user-1",
        consumedOrderId: "ORD-EXPIRED",
        usedAt: EXPIRES_AT,
        model
    }), ERROR_CODES.QUOTE_EXPIRED, "usedAt equal to expiresAt rejected.");

    const expirable = await findExpirableQuotes({ before: EXPIRES_AT, model });
    assert(expirable.some(item => item.quoteId === expiredBoundary.quoteId), "find expirable ISSUED quote.");

    const expired = await markQuoteExpired({ quoteId: expiredBoundary.quoteId, expiredAt: EXPIRES_AT, model });
    assert.strictEqual(expired.outcome, "success", "mark expired succeeds.");

    const expiredAgain = await markQuoteExpired({ quoteId: expiredBoundary.quoteId, expiredAt: EXPIRES_AT, model });
    assert.strictEqual(expiredAgain.outcome, "idempotent", "mark expired is idempotent.");

    await assertError(() => markQuoteExpired({ quoteId: active.quoteId, expiredAt: EXPIRES_AT, model }), ERROR_CODES.QUOTE_TERMINAL, "used quote not marked expired.");
}

async function verifyInvalidationAndCancellation() {
    const model = createFakeModel();
    const invalid = quote({ quoteId: "AZQ_INVALIDATE_1" });
    const cancel = quote({ quoteId: "AZQ_CANCEL_1" });
    await createQuoteRecord({ quote: invalid, model });
    await createQuoteRecord({ quote: cancel, model });

    const invalidated = await invalidateQuote({
        quoteId: invalid.quoteId,
        reason: "critical pricing defect",
        invalidatedAt: "2026-07-26T12:02:00.000Z",
        model
    });
    assert.strictEqual(invalidated.quote.status, "INVALIDATED", "issued quote invalidated.");
    assert.strictEqual(invalidated.quote.invalidationReason, "critical pricing defect", "invalidation reason stored.");

    const cancelled = await cancelQuote({
        quoteId: cancel.quoteId,
        cancelledAt: "2026-07-26T12:03:00.000Z",
        reason: "customer cancelled",
        model
    });
    assert.strictEqual(cancelled.quote.status, "CANCELLED", "issued quote cancelled.");

    await assertError(() => invalidateQuote({
        quoteId: invalid.quoteId,
        reason: "again",
        invalidatedAt: "2026-07-26T12:04:00.000Z",
        model
    }), ERROR_CODES.QUOTE_TERMINAL, "terminal invalidation rejected.");

    await assertError(() => cancelQuote({
        quoteId: invalid.quoteId,
        cancelledAt: "2026-07-26T12:04:00.000Z",
        model
    }), ERROR_CODES.QUOTE_TERMINAL, "terminal cancellation rejected.");
}

async function verifySnapshotPreservation() {
    const model = createFakeModel();
    const promoQuote = quote({
        quoteId: "AZQ_SNAPSHOT_1",
        promotionInput: {
            promotions: [{
                id: "promo-1",
                code: "SAVE10",
                status: "ACTIVE",
                promotionType: "PERCENTAGE_DISCOUNT",
                discountValue: 10,
                region: "TH",
                currency: "THB"
            }],
            context: {}
        }
    });
    const original = clone(promoQuote);
    const record = await createQuoteRecord({ quote: promoQuote, idempotencyKey: "snapshot", model });
    assert.deepStrictEqual(record.commercialSnapshot, original.commercialSnapshot, "commercial snapshot persists exactly.");
    assert.deepStrictEqual(record.integrityPayload, original.integrityPayload, "canonical integrity payload persists exactly.");
    assert.deepStrictEqual(record.warnings, original.warnings, "warnings persist exactly.");
    assert.strictEqual(record.promotionSnapshot.selectedPromotion.code, "SAVE10", "promotion snapshot preserved.");
    assert.strictEqual(record.pricingSnapshot.engineVersion, original.pricingSnapshot.engineVersion, "pricing engine version preserved.");
    assert.deepStrictEqual(promoQuote, original, "repository must not mutate runtime quote.");
}

async function run() {
    await verifyModel();
    await verifyCreateLoadAndIdempotency();
    await verifyConsumptionAndExpiry();
    await verifyInvalidationAndCancellation();
    await verifySnapshotPreservation();
    await mongoose.connection.close(false);
    console.log("Commerce pricing quote persistence verification passed.");
}

run().catch(async error => {
    await mongoose.connection.close(false).catch(() => {});
    console.error(error);
    process.exit(1);
});
