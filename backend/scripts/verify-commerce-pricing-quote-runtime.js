const assert = require("assert");

const {
    createPricingQuote,
    canonicalSerialize,
    PricingQuoteRuntimeError,
    ERROR_CODES,
    WARNING_CODES,
    QUOTE_RUNTIME_VERSION,
    QUOTE_SPECIFICATION_VERSION,
    DEFAULT_PAYLOAD_VERSION
} = require("../services/commerce/pricingQuoteRuntime");

const ISSUED_AT = "2026-07-26T12:00:00.000Z";
const EXPIRES_AT = "2026-07-26T12:10:00.000Z";

function clone(value) {
    return structuredClone(value);
}

function assertError(fn, code, message) {
    let thrown = null;
    try {
        fn();
    } catch (error) {
        thrown = error;
    }
    assert(thrown instanceof PricingQuoteRuntimeError, message);
    assert.strictEqual(thrown.code, code, message);
}

function assertFrozenDeep(value, path = "value") {
    if (!value || typeof value !== "object") return;
    assert(Object.isFrozen(value), `${path} must be frozen.`);
    Object.keys(value).forEach(key => assertFrozenDeep(value[key], `${path}.${key}`));
}

function basePricingInput(overrides = {}) {
    return {
        supplierCost: 1000,
        supplierCurrency: "THB",
        targetCurrency: "THB",
        policy: {
            supplierFee: { enabled: true, type: "FIXED", value: 20 },
            businessCost: { enabled: true, type: "FIXED", value: 30 },
            profitRule: { type: "FIXED", value: 200 },
            gatewayFee: { enabled: true, type: "PERCENT", value: 2 },
            platformCost: { enabled: true, type: "FIXED", value: 10 },
            tax: { enabled: false, type: "FIXED", value: 0 },
            roundingRule: { enabled: false, mode: "NONE" }
        },
        ...overrides
    };
}

function packageInput(overrides = {}) {
    return {
        packageId: "MLBB-7740",
        packageCode: "MLBB_7740_1548",
        packageRef: "64f000000000000000000001",
        packageName: "7740+1548 Diamonds",
        gameId: "mlbb",
        gameCode: "MLBB",
        gameName: "Mobile Legends",
        categoryId: "mobile-games",
        categoryCode: "MOBILE",
        ...overrides
    };
}

function promotion(overrides = {}) {
    return {
        id: "promo-10",
        code: "SAVE10",
        status: "ACTIVE",
        promotionType: "PERCENTAGE_DISCOUNT",
        discountValue: 10,
        region: "TH",
        currency: "THB",
        priority: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        ...overrides
    };
}

function baseQuoteInput(overrides = {}) {
    return {
        quoteId: "AZQ_TEST_0001",
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
        owner: {
            userId: "user-1",
            sessionId: "session-1"
        },
        request: {
            region: "TH",
            currency: "THB",
            package: packageInput(),
            paymentMethodId: "promptpay",
            couponCode: ""
        },
        pricingInput: basePricingInput(),
        versionContext: {
            priceVersionId: "pv-1",
            priceVersionNumber: 7,
            branchKey: "main",
            parentVersionId: "pv-0"
        },
        integrity: {
            payloadVersion: DEFAULT_PAYLOAD_VERSION,
            algorithm: "canonical-json-sha256-deferred",
            keyId: "deferred"
        },
        trace: {
            traceId: "trace-1",
            issueSource: "unit-test"
        },
        ...overrides
    };
}

function withRequest(input, requestOverrides = {}) {
    const hasPackageOverride = Object.prototype.hasOwnProperty.call(requestOverrides, "package");
    return {
        ...input,
        request: {
            ...input.request,
            ...requestOverrides,
            package: hasPackageOverride
                ? requestOverrides.package
                : input.request.package
        }
    };
}

function hasWarning(quote, code) {
    return quote.warnings.some(warning => warning.code === code);
}

function verifyBasicQuoteNoPromotion() {
    const input = baseQuoteInput();
    const original = clone(input);
    const quote = createPricingQuote(input);
    assert.strictEqual(quote.quoteRuntimeVersion, QUOTE_RUNTIME_VERSION, "quote runtime version must be present.");
    assert.strictEqual(quote.quoteSpecificationVersion, QUOTE_SPECIFICATION_VERSION, "quote specification version must be present.");
    assert.strictEqual(quote.quoteId, "AZQ_TEST_0001", "quote id must be caller supplied.");
    assert.strictEqual(quote.status, "ISSUED", "quote status must start issued.");
    assert.strictEqual(quote.lifecycle.status, "ISSUED", "lifecycle status must start issued.");
    assert.strictEqual(quote.lifecycle.issuedAt, ISSUED_AT, "issuedAt must normalize to UTC ISO.");
    assert.strictEqual(quote.lifecycle.expiresAt, EXPIRES_AT, "expiresAt must normalize to UTC ISO.");
    assert.strictEqual(quote.promotionSnapshot, null, "no promotionInput should produce null promotion snapshot.");
    assert.strictEqual(quote.commercialSnapshot.originalPrice, quote.pricingSnapshot.result.originalPrice, "original price must come from pricing result.");
    assert.strictEqual(quote.commercialSnapshot.discountAmount, 0, "no promotion discount.");
    assert.strictEqual(quote.commercialSnapshot.quotedUnitPrice, quote.pricingSnapshot.result.originalPrice, "no promotion unit price equals original.");
    assert.strictEqual(quote.commercialSnapshot.quotedTotalAmount, quote.commercialSnapshot.quotedUnitPrice, "quantity 1 total equals unit.");
    assert(hasWarning(quote, WARNING_CODES.NO_PROMOTION_APPLIED), "no promotion warning must be emitted.");
    assert.deepStrictEqual(input, original, "createPricingQuote must not mutate input.");
    assertFrozenDeep(quote, "quote");
}

function verifyPromotionOrchestration() {
    const percentage = createPricingQuote(baseQuoteInput({
        promotionInput: {
            originalPrice: 999999,
            currency: "MMK",
            promotions: [promotion()],
            context: {
                evaluationTime: "2020-01-01T00:00:00.000Z",
                region: "MM",
                currency: "MMK"
            }
        }
    }));
    assert.strictEqual(percentage.promotionSnapshot.selectedPromotion.code, "SAVE10", "percentage promotion must be selected.");
    assert.strictEqual(percentage.promotionSnapshot.resolverVersion, "2.3.1", "resolver version must be snapshotted.");
    assert.strictEqual(percentage.promotionSnapshot.specificationVersion, "2.3.0", "promotion spec version must be snapshotted.");
    assert.strictEqual(percentage.promotionSnapshot.candidateFinalPrice, percentage.commercialSnapshot.quotedUnitPrice, "final price must come from resolver result.");
    assert.strictEqual(percentage.promotionSnapshot.discountAmount, percentage.commercialSnapshot.discountAmount, "discount must come from resolver result.");
    assert.strictEqual(percentage.promotionSnapshot.traceSummary[0].status, "ELIGIBLE", "resolution trace must be snapshotted.");

    const fixed = createPricingQuote(baseQuoteInput({
        promotionInput: {
            promotions: [promotion({ id: "fixed", code: "FIXED100", promotionType: "FIXED_DISCOUNT", discountValue: 100 })],
            context: {}
        }
    }));
    assert.strictEqual(fixed.commercialSnapshot.discountAmount, 100, "fixed promotion discount should be applied to unit price.");

    const override = createPricingQuote(baseQuoteInput({
        promotionInput: {
            promotions: [promotion({ id: "override", code: "OVERRIDE", promotionType: "OVERRIDE_PRICE", overridePrice: 999 })],
            strategy: { mode: "BEST_PRICE", allowPriceOverride: true },
            context: {}
        }
    }));
    assert.strictEqual(override.commercialSnapshot.quotedUnitPrice, 999, "price override should be reflected in quote.");

    const none = createPricingQuote(baseQuoteInput({
        promotionInput: {
            promotions: [promotion({ region: "MM" })],
            context: {}
        }
    }));
    assert.strictEqual(none.promotionSnapshot.selectedPromotion, null, "rejected promotions should not select a winner.");
    assert.strictEqual(none.commercialSnapshot.discountAmount, 0, "no selected promotion means zero discount.");
    assert(hasWarning(none, WARNING_CODES.PROMOTION_WARNINGS_PRESENT), "resolver warnings must be aggregated.");
}

function verifyTimeAndIdentity() {
    const validity = createPricingQuote(baseQuoteInput({ expiresAt: undefined, validitySeconds: 600 }));
    assert.strictEqual(validity.lifecycle.expiresAt, EXPIRES_AT, "validitySeconds must compute expiresAt.");

    assertError(() => createPricingQuote(baseQuoteInput({ issuedAt: "bad-date" })), ERROR_CODES.INVALID_ISSUED_AT, "invalid issuedAt rejected.");
    assertError(() => createPricingQuote(baseQuoteInput({ expiresAt: "bad-date" })), ERROR_CODES.INVALID_EXPIRES_AT, "invalid expiresAt rejected.");
    assertError(() => createPricingQuote(baseQuoteInput({ expiresAt: ISSUED_AT })), ERROR_CODES.INVALID_QUOTE_WINDOW, "equal issued/expires rejected.");
    assertError(() => createPricingQuote(baseQuoteInput({ expiresAt: "2026-07-26T11:59:59.000Z" })), ERROR_CODES.INVALID_QUOTE_WINDOW, "expires before issued rejected.");
    assertError(() => createPricingQuote(baseQuoteInput({ expiresAt: EXPIRES_AT, validitySeconds: 601 })), ERROR_CODES.INVALID_QUOTE_WINDOW, "contradictory expires/validity rejected.");
    assertError(() => createPricingQuote(baseQuoteInput({ expiresAt: undefined })), ERROR_CODES.INVALID_VALIDITY_DURATION, "finite expiry required.");
    assertError(() => createPricingQuote(baseQuoteInput({ quoteId: "bad id with spaces" })), ERROR_CODES.INVALID_QUOTE_ID, "public quote id validated.");
    assertError(() => createPricingQuote(baseQuoteInput({ owner: {} })), ERROR_CODES.INVALID_OWNER, "owner required.");

    const userOnly = createPricingQuote(baseQuoteInput({ owner: { userId: "user-1" } }));
    assert.strictEqual(userOnly.owner.userId, "user-1", "user-bound quote accepted.");

    const sessionOnly = createPricingQuote(baseQuoteInput({ owner: { sessionId: "session-1" } }));
    assert.strictEqual(sessionOnly.owner.sessionId, "session-1", "session-bound quote accepted.");
    assert(hasWarning(sessionOnly, WARNING_CODES.SESSION_BOUND_QUOTE), "session-bound warning emitted.");

    ["packageId", "packageCode", "packageRef"].forEach(field => {
        const pkg = { quantity: 1, [field]: `only-${field}` };
        const quote = createPricingQuote(withRequest(baseQuoteInput(), { package: pkg }));
        assert.strictEqual(quote.packageSnapshot[field], `only-${field}`, `${field} alone should satisfy package identity.`);
    });
    assertError(() => createPricingQuote(withRequest(baseQuoteInput(), { package: { quantity: 1 } })), ERROR_CODES.INVALID_PACKAGE_IDENTITY, "missing package identity rejected.");
}

function verifyQuantityAndTotals() {
    const defaultQuantity = createPricingQuote(baseQuoteInput());
    assert.strictEqual(defaultQuantity.commercialSnapshot.quantity, 1, "quantity defaults to one.");

    const quantityThree = createPricingQuote(withRequest(baseQuoteInput({
        promotionInput: {
            promotions: [promotion({ promotionType: "FIXED_DISCOUNT", discountValue: 100 })],
            context: {}
        }
    }), { package: packageInput({ quantity: 3 }) }));
    assert.strictEqual(quantityThree.commercialSnapshot.promotionAppliesTo, "UNIT_PRICE", "promotion unit policy must be explicit.");
    assert.strictEqual(quantityThree.commercialSnapshot.quotedTotalAmount, quantityThree.commercialSnapshot.quotedUnitPrice * 3, "total equals unit times quantity.");

    assertError(() => createPricingQuote(withRequest(baseQuoteInput(), { package: packageInput({ quantity: 0 }) })), ERROR_CODES.INVALID_QUANTITY, "zero quantity rejected.");
    assertError(() => createPricingQuote(withRequest(baseQuoteInput(), { package: packageInput({ quantity: 1.5 }) })), ERROR_CODES.INVALID_QUANTITY, "fractional quantity rejected.");
    assertError(() => createPricingQuote(withRequest(baseQuoteInput({ pricingInput: basePricingInput({ supplierCost: 999_999_999_999, policy: { profitRule: { type: "FIXED", value: 1 } } }) }), { package: packageInput({ quantity: 2 }) })), ERROR_CODES.QUOTE_AMOUNT_OVERFLOW, "total overflow rejected.");

    const zero = createPricingQuote(baseQuoteInput({ pricingInput: basePricingInput({ supplierCost: 0, policy: { profitRule: { type: "FIXED", value: 0 } } }) }));
    assert.strictEqual(zero.commercialSnapshot.quotedTotalAmount, 0, "zero quote supported for runtime snapshot.");
    assert(hasWarning(zero, WARNING_CODES.ZERO_PRICE_QUOTE), "zero quote warning emitted.");
}

function verifyPricingOrchestration() {
    const withWarning = createPricingQuote(baseQuoteInput({
        pricingInput: basePricingInput({
            supplierCost: 0,
            policy: { profitRule: { type: "FIXED", value: 0 } }
        })
    }));
    assert(hasWarning(withWarning, WARNING_CODES.PRICING_WARNINGS_PRESENT), "pricing warnings should be aggregated.");
    assert(Array.isArray(withWarning.pricingSnapshot.result.breakdown), "pricing breakdown snapshotted.");
    assert(withWarning.pricingSnapshot.result.breakdown.some(item => item.stageId === "SUPPLIER_COST"), "breakdown includes pricing engine stage.");
    assert.strictEqual(withWarning.pricingSnapshot.priceVersion.priceVersionId, "pv-1", "price version metadata preserved.");

    assertError(() => createPricingQuote(baseQuoteInput({
        request: { ...baseQuoteInput().request, currency: "MMK" }
    })), ERROR_CODES.PRICING_CURRENCY_MISMATCH, "pricing currency mismatch rejected.");

    assertError(() => createPricingQuote(baseQuoteInput({
        pricingInput: basePricingInput({ supplierCost: -1 })
    })), ERROR_CODES.PRICING_CALCULATION_FAILED, "pricing engine errors are wrapped.");
}

function verifyIntegrityPayload() {
    const quote = createPricingQuote(baseQuoteInput({
        promotionInput: {
            promotions: [promotion()],
            context: {}
        }
    }));
    assert.strictEqual(quote.integrityPayload.payloadVersion, DEFAULT_PAYLOAD_VERSION, "payload version preserved.");
    assert(quote.integrityPayload.canonicalSerialized.includes("\"currency\":\"THB\""), "canonical payload includes commercial data.");
    assert(!quote.integrityPayload.canonicalSerialized.includes("usedAt"), "mutable lifecycle fields must not be canonicalized.");
    assert.strictEqual(quote.integrityMetadata.canonicalHash, null, "hash generation is deferred.");
    assert.strictEqual(quote.integrityMetadata.signature, null, "signature generation is deferred.");
    assert(hasWarning(quote, WARNING_CODES.INTEGRITY_SIGNATURE_NOT_GENERATED), "deferred signature warning emitted.");

    const unorderedA = { b: 2, a: 1, nested: { z: 3, y: -0 } };
    const unorderedB = { nested: { y: 0, z: 3 }, a: 1, b: 2 };
    assert.strictEqual(canonicalSerialize(unorderedA), canonicalSerialize(unorderedB), "canonical serialization must be stable by key order and negative-zero normalization.");
    assertError(() => {
        const circular = {};
        circular.self = circular;
        canonicalSerialize(circular);
    }, ERROR_CODES.CANONICALISATION_FAILED, "circular canonical payload rejected.");

    const changed = createPricingQuote(baseQuoteInput({ quoteId: "AZQ_TEST_0002", validitySeconds: 600, expiresAt: undefined }));
    assert.notStrictEqual(quote.integrityPayload.canonicalSerialized, changed.integrityPayload.canonicalSerialized, "commercial/id changes alter canonical payload.");
}

function verifyDeterminismAndNoSharedReferences() {
    const input = baseQuoteInput({
        promotionInput: {
            promotions: [promotion()],
            context: {}
        }
    });
    const original = clone(input);
    const first = createPricingQuote(input);
    const second = createPricingQuote(input);
    assert.deepStrictEqual(first, second, "same deterministic input must produce deeply equal quote.");
    assert.deepStrictEqual(input, original, "input must not be mutated.");

    input.request.package.packageName = "Changed";
    assert.strictEqual(first.packageSnapshot.packageName, "7740+1548 Diamonds", "quote must not share package input references.");
    input.promotionInput.promotions[0].code = "CHANGED";
    assert.strictEqual(first.promotionSnapshot.selectedPromotion.code, "SAVE10", "quote must not share promotion input references.");
    assertFrozenDeep(first.pricingSnapshot.result.breakdown, "pricing breakdown");
    assertFrozenDeep(first.promotionSnapshot.traceSummary, "promotion trace");
}

function verifyOutputShapeAndWarnings() {
    const quote = createPricingQuote(baseQuoteInput({ versionContext: {} }));
    [
        "quoteRuntimeVersion",
        "quoteSpecificationVersion",
        "quoteId",
        "status",
        "payloadVersion",
        "owner",
        "packageSnapshot",
        "commercialSnapshot",
        "pricingSnapshot",
        "promotionSnapshot",
        "lifecycle",
        "integrityPayload",
        "integrityMetadata",
        "trace",
        "warnings"
    ].forEach(key => assert(Object.prototype.hasOwnProperty.call(quote, key), `quote output missing ${key}.`));
    assert(hasWarning(quote, WARNING_CODES.NO_PRICE_VERSION_REFERENCE), "missing price version warning emitted.");
    assert(!JSON.stringify(quote).match(/password|accessToken|refreshToken|secret/i), "quote output must not include obvious sensitive fields.");
}

function run() {
    verifyBasicQuoteNoPromotion();
    verifyPromotionOrchestration();
    verifyTimeAndIdentity();
    verifyQuantityAndTotals();
    verifyPricingOrchestration();
    verifyIntegrityPayload();
    verifyDeterminismAndNoSharedReferences();
    verifyOutputShapeAndWarnings();
    console.log("Commerce pricing quote runtime verification passed.");
}

run();
