const assert = require("assert");

const {
    createAndPersistPricingQuote,
    getOwnedPricingQuote,
    PricingQuoteApplicationError,
    ERROR_CODES,
    WARNING_CODES
} = require("../services/commerce/pricingQuoteApplicationService");
const { createPricingQuote } = require("../services/commerce/pricingQuoteRuntime");
const {
    PricingQuotePersistenceError,
    ERROR_CODES: PERSISTENCE_ERROR_CODES
} = require("../services/commerce/pricingQuoteRepository");

const ISSUED_AT = "2026-07-26T12:00:00.000Z";

function clone(value) {
    return structuredClone(value);
}

function assertError(fn, code, message) {
    return Promise.resolve()
        .then(fn)
        .then(() => {
            throw new Error(`Expected ${code}: ${message}`);
        })
        .catch(error => {
            assert(error instanceof PricingQuoteApplicationError, message);
            assert.strictEqual(error.code, code, message);
        });
}

function baseInput(overrides = {}) {
    return {
        owner: {
            userId: "user-1",
            sessionId: "session-1"
        },
        request: {
            region: "TH",
            currency: "THB",
            packageIdentity: {
                packageId: "MLBB-7740",
                packageCode: "MLBB_7740",
                packageRef: "64f000000000000000000001"
            },
            paymentMethodId: "promptpay",
            couponCode: "save10",
            quantity: 1
        },
        idempotencyKey: "idem-1",
        validitySeconds: 600,
        trace: {
            issueSource: "verifier"
        },
        trustedContext: trustedContext(),
        ...overrides
    };
}

function pricingInput() {
    return {
        supplierCost: 1000,
        supplierCurrency: "THB",
        targetCurrency: "THB",
        policy: {
            profitRule: { type: "FIXED", value: 200 },
            gatewayFee: { enabled: false, type: "FIXED", value: 0 },
            roundingRule: { enabled: false, mode: "NONE" }
        }
    };
}

function trustedContext(overrides = {}) {
    return {
        package: {
            packageId: "SERVER-PACKAGE",
            packageCode: "SERVER_CODE",
            packageName: "Server Package",
            gameId: "mlbb",
            gameName: "Mobile Legends",
            categoryId: "mobile-games"
        },
        pricingInput: pricingInput(),
        versionContext: {
            priceVersionId: "pv-1",
            priceVersionNumber: 1,
            branchKey: "main"
        },
        promotionCandidates: [{
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
        promotionContextData: {
            evaluationTime: "2000-01-01T00:00:00.000Z",
            region: "MM",
            currency: "MMK",
            orderSubtotal: 1
        },
        ...overrides
    };
}

function deterministicDeps(overrides = {}) {
    const calls = {
        createPricingQuote: 0,
        createQuoteRecord: 0,
        findOwnedQuote: 0,
        runtimeInputs: []
    };
    const records = new Map();
    const deps = {
        calls,
        getIssuedAt: () => ISSUED_AT,
        generateQuoteId: ({ owner, idempotencyKey }) => `AZQ_${owner.userId || owner.sessionId}_${idempotencyKey || "NOIDEM"}`,
        generateTraceId: () => "trace-generated",
        createPricingQuote(runtimeInput) {
            calls.createPricingQuote += 1;
            calls.runtimeInputs.push(clone(runtimeInput));
            return createPricingQuote(runtimeInput);
        },
        async createQuoteRecord({ quote, idempotencyKey }) {
            calls.createQuoteRecord += 1;
            const key = `${quote.owner.userId || ""}:${quote.owner.sessionId || ""}:${idempotencyKey || ""}`;
            const existing = records.get(key);
            if (existing) {
                if (existing.integrityPayload.canonicalSerialized !== quote.integrityPayload.canonicalSerialized) {
                    throw new PricingQuotePersistenceError(PERSISTENCE_ERROR_CODES.IDEMPOTENCY_CONFLICT, "conflict");
                }
                return { ...clone(existing), __pricingQuotePersistenceOutcome: "idempotent" };
            }
            const stored = clone(quote);
            stored.createdAt = "2026-07-26T12:00:01.000Z";
            records.set(key, stored);
            return stored;
        },
        async findOwnedQuote({ quoteId, userId, sessionId }) {
            calls.findOwnedQuote += 1;
            return [...records.values()].find(record => (
                record.quoteId === quoteId &&
                ((userId && record.owner.userId === userId) || (sessionId && record.owner.sessionId === sessionId))
            )) || null;
        },
        ...overrides
    };
    return deps;
}

function assertPublicSafe(publicQuote) {
    const text = JSON.stringify(publicQuote);
    assert(!text.includes("supplierCost"), "public quote must not expose supplier cost.");
    assert(!text.includes("breakdown"), "public quote must not expose pricing breakdown.");
    assert(!text.includes("traceSummary"), "public quote must not expose eligibility trace.");
    assert(!text.includes("integrityPayload"), "public quote must not expose integrity payload.");
    assert(!text.match(/secret|password|token/i), "public quote must not expose sensitive fields.");
}

function hasWarning(publicQuote, code) {
    return publicQuote.warnings.some(warning => warning.code === code);
}

async function verifyBasicOrchestration() {
    const deps = deterministicDeps();
    const input = baseInput();
    const original = clone(input);
    const result = await createAndPersistPricingQuote(input, deps);
    assert.strictEqual(deps.calls.createPricingQuote, 1, "quote runtime called once.");
    assert.strictEqual(deps.calls.createQuoteRecord, 1, "persistence called once.");
    assert.strictEqual(result.publicQuote.quoteId, "AZQ_user-1_idem-1", "injected quote id used.");
    assert.strictEqual(result.publicQuote.issuedAt, ISSUED_AT, "injected issuedAt used.");
    assert.strictEqual(result.metadata.traceId, "trace-generated", "injected trace id used.");
    assert.strictEqual(result.publicQuote.package.packageId, "SERVER-PACKAGE", "server package context used.");
    assert.strictEqual(result.publicQuote.pricing.currency, "THB", "public pricing maps currency.");
    assert(result.publicQuote.pricing.quotedTotalAmount > 0, "public result includes final amount.");
    assertPublicSafe(result.publicQuote);
    assert.deepStrictEqual(input, original, "application service must not mutate input.");
    assert(Object.isFrozen(result.publicQuote), "public result must be frozen.");
}

async function verifyLoaderBasedContext() {
    const deps = deterministicDeps({
        async loadPackageContext({ packageIdentity }) {
            return { ...packageIdentity, packageName: "Loaded Package", gameName: "Loaded Game" };
        },
        async loadPricingContext() {
            return { pricingInput: pricingInput(), versionContext: { priceVersionId: "pv-loaded", branchKey: "main" } };
        },
        async loadPromotionContext() {
            return {
                promotions: [],
                campaigns: [],
                context: {},
                strategy: {}
            };
        }
    });
    const input = baseInput({ trustedContext: {} });
    const result = await createAndPersistPricingQuote(input, deps);
    assert.strictEqual(result.publicQuote.package.packageName, "Loaded Package", "loader package context used.");
    assert(hasWarning(result.publicQuote, WARNING_CODES.NO_PROMOTION_APPLIED), "mapped no promotion warning.");
}

async function verifyValidation() {
    await assertError(() => createAndPersistPricingQuote(baseInput({ owner: {} }), deterministicDeps()), ERROR_CODES.INVALID_OWNER, "missing owner rejected.");
    await assertError(() => createAndPersistPricingQuote(baseInput({ request: { ...baseInput().request, packageIdentity: {} } }), deterministicDeps()), ERROR_CODES.INVALID_PACKAGE_IDENTITY, "missing package identity rejected.");
    await assertError(() => createAndPersistPricingQuote(baseInput({ request: { ...baseInput().request, region: "EU" } }), deterministicDeps()), ERROR_CODES.INVALID_REGION, "invalid region rejected.");
    await assertError(() => createAndPersistPricingQuote(baseInput({ request: { ...baseInput().request, currency: "USD" } }), deterministicDeps()), ERROR_CODES.UNSUPPORTED_CURRENCY, "unsupported currency rejected.");
    await assertError(() => createAndPersistPricingQuote(baseInput({ request: { ...baseInput().request, quantity: 1.5 } }), deterministicDeps()), ERROR_CODES.INVALID_QUANTITY, "fractional quantity rejected.");
    await assertError(() => createAndPersistPricingQuote(baseInput({ validitySeconds: 0 }), deterministicDeps()), ERROR_CODES.INVALID_VALIDITY_DURATION, "invalid validity rejected.");
    await assertError(() => createAndPersistPricingQuote(baseInput({ idempotencyKey: "x".repeat(201) }), deterministicDeps()), ERROR_CODES.INVALID_IDEMPOTENCY_KEY, "invalid idempotency rejected.");
    await assertError(() => createAndPersistPricingQuote(baseInput({ trustedContext: {} }), deterministicDeps()), ERROR_CODES.TRUSTED_CONTEXT_REQUIRED, "missing context and loaders rejected.");
    await assertError(() => createAndPersistPricingQuote(baseInput(), deterministicDeps({ getIssuedAt: undefined })), ERROR_CODES.INVALID_APPLICATION_INPUT, "clock provider required.");
    await assertError(() => createAndPersistPricingQuote(baseInput(), deterministicDeps({ generateQuoteId: undefined })), ERROR_CODES.INVALID_APPLICATION_INPUT, "quote id provider required.");
}

async function verifyTrustedContextProtection() {
    const deps = deterministicDeps();
    const result = await createAndPersistPricingQuote(baseInput(), deps);
    const runtimeInput = deps.calls.runtimeInputs[0];
    assert.strictEqual(runtimeInput.promotionInput.originalPrice, undefined, "application service should not pass client promotion totals.");
    assert.strictEqual(runtimeInput.promotionInput.currency, undefined, "application service should not pass client promotion currency.");
    assert.strictEqual(runtimeInput.promotionInput.context.region, "MM", "preloaded eligibility context may be supplied to runtime.");
    assert.strictEqual(result.publicQuote.package.packageCode, "SERVER_CODE", "server package projection overrides request identity for display snapshot.");
    assert.strictEqual(result.publicQuote.promotion.code, "SAVE10", "server promotion candidates used.");
    assert.strictEqual(deps.calls.runtimeInputs[0].request.couponCode, "SAVE10", "coupon code normalized as request, not eligibility proof.");
    assert.strictEqual(result.publicQuote.pricing.currency, "THB", "client-conflicting promotion currency cannot affect quote currency.");
}

async function verifyIdempotency() {
    const deps = deterministicDeps();
    const first = await createAndPersistPricingQuote(baseInput(), deps);
    const retry = await createAndPersistPricingQuote(baseInput(), deps);
    assert.strictEqual(retry.publicQuote.quoteId, first.publicQuote.quoteId, "same owner/key returns original quote.");
    assert(hasWarning(retry.publicQuote, WARNING_CODES.EXISTING_QUOTE_REUSED), "idempotency reuse warning mapped.");
    assert.strictEqual(retry.metadata.idempotentReuse, true, "metadata marks idempotent reuse.");

    await assertError(() => createAndPersistPricingQuote(baseInput({
        trustedContext: trustedContext({
            package: { ...trustedContext().package, packageCode: "DIFFERENT" }
        })
    }), deps), ERROR_CODES.IDEMPOTENCY_CONFLICT, "idempotency conflict propagates.");

    const other = await createAndPersistPricingQuote(baseInput({ owner: { userId: "user-2" } }), deps);
    assert.notStrictEqual(other.publicQuote.quoteId, first.publicQuote.quoteId, "different owners can reuse idempotency key.");
}

async function verifyRetrieval() {
    const deps = deterministicDeps();
    const created = await createAndPersistPricingQuote(baseInput(), deps);
    const fetched = await getOwnedPricingQuote({ quoteId: created.publicQuote.quoteId, owner: { userId: "user-1" } }, deps);
    assert.deepStrictEqual(fetched, created.publicQuote, "correct owner retrieves customer-safe quote.");
    const wrong = await getOwnedPricingQuote({ quoteId: created.publicQuote.quoteId, owner: { userId: "other" } }, deps);
    assert.strictEqual(wrong, null, "wrong owner returns null.");
    const missing = await getOwnedPricingQuote({ quoteId: "missing", owner: { userId: "user-1" } }, deps);
    assert.strictEqual(missing, null, "missing quote returns null.");
    assert.strictEqual(deps.calls.findOwnedQuote, 3, "retrieval uses repository ownership lookup.");
}

async function verifyErrorMapping() {
    await assertError(() => createAndPersistPricingQuote(baseInput({ trustedContext: {} }), deterministicDeps({
        async loadPackageContext() {
            throw Object.assign(new Error("package boom"), { code: "PACKAGE_BOOM" });
        },
        async loadPricingContext() {
            return { pricingInput: pricingInput() };
        }
    })), ERROR_CODES.PACKAGE_CONTEXT_LOAD_FAILED, "package loader failure mapped.");

    await assertError(() => createAndPersistPricingQuote(baseInput({
        trustedContext: { package: trustedContext().package }
    }), deterministicDeps({
        async loadPricingContext() {
            throw Object.assign(new Error("pricing boom"), { code: "PRICING_BOOM" });
        }
    })), ERROR_CODES.PRICING_CONTEXT_LOAD_FAILED, "pricing loader failure mapped.");

    await assertError(() => createAndPersistPricingQuote(baseInput({
        trustedContext: { package: trustedContext().package, pricingInput: pricingInput() }
    }), deterministicDeps({
        async loadPromotionContext() {
            throw Object.assign(new Error("promotion boom"), { code: "PROMOTION_BOOM" });
        }
    })), ERROR_CODES.PROMOTION_CONTEXT_LOAD_FAILED, "promotion loader failure mapped.");

    await assertError(() => createAndPersistPricingQuote(baseInput(), deterministicDeps({
        createPricingQuote() {
            const error = new Error("runtime failed");
            error.name = "PricingQuoteRuntimeError";
            error.code = "INVALID_QUOTE_ID";
            throw error;
        }
    })), ERROR_CODES.QUOTE_RUNTIME_FAILED, "runtime failure mapped.");

    await assertError(() => createAndPersistPricingQuote(baseInput(), deterministicDeps({
        async createQuoteRecord() {
            throw new PricingQuotePersistenceError(PERSISTENCE_ERROR_CODES.PERSISTENCE_FAILURE, "db failed");
        }
    })), ERROR_CODES.QUOTE_PERSISTENCE_FAILED, "persistence failure mapped.");
}

async function verifyImmutability() {
    const trusted = trustedContext();
    const input = baseInput({ trustedContext: trusted });
    const originalInput = clone(input);
    const originalTrusted = clone(trusted);
    const result = await createAndPersistPricingQuote(input, deterministicDeps());
    assert.deepStrictEqual(input, originalInput, "input not mutated.");
    assert.deepStrictEqual(trusted, originalTrusted, "trusted context not mutated.");
    assert(Object.isFrozen(result), "application result frozen.");
    assert(Object.isFrozen(result.publicQuote.pricing), "public pricing frozen.");
    const before = clone(result.publicQuote);
    result.publicQuote.package.packageName = "mutated";
    assert.deepStrictEqual(result.publicQuote, before, "frozen output not mutable.");
}

async function run() {
    await verifyBasicOrchestration();
    await verifyLoaderBasedContext();
    await verifyValidation();
    await verifyTrustedContextProtection();
    await verifyIdempotency();
    await verifyRetrieval();
    await verifyErrorMapping();
    await verifyImmutability();
    console.log("Commerce pricing quote application service verification passed.");
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
