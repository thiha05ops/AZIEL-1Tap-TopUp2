const assert = require("assert");
const fs = require("fs");

const {
    createOrderSnapshot,
    validateOrderSnapshotInput,
    toOrderSnapshotPayload,
    OrderSnapshotRuntimeError,
    ORDER_SNAPSHOT_ERROR_CODES,
    ORDER_SNAPSHOT_RUNTIME_VERSION,
    ORDER_SNAPSHOT_SCHEMA_VERSION
} = require("../services/commerce/orderSnapshotRuntime");
const { createPricingQuote } = require("../services/commerce/pricingQuoteRuntime");
const {
    checkoutFromQuote,
    createOrderSnapshot: checkoutCreateOrderSnapshot
} = require("../services/commerce/checkoutApplicationService");

const CHECKOUT_TIME = "2026-07-26T12:05:00.000Z";

function clone(value) {
    return structuredClone(value);
}

function assertError(fn, code, message) {
    try {
        fn();
        throw new Error(`Expected ${code}: ${message}`);
    } catch (error) {
        assert(error instanceof OrderSnapshotRuntimeError, `${message}: got ${error.name || "Error"} ${error.code || ""}`);
        assert.strictEqual(error.code, code, message);
    }
}

function pricingInput(overrides = {}) {
    return {
        supplierCost: 1000.125,
        supplierCurrency: "THB",
        targetCurrency: "THB",
        policy: {
            profitRule: { type: "FIXED", value: 200.005 },
            gatewayFee: { enabled: true, type: "FIXED", value: 12.345 },
            roundingRule: { enabled: false, mode: "NONE" }
        },
        ...overrides
    };
}

function quote(overrides = {}) {
    const runtimeQuote = createPricingQuote({
        quoteId: overrides.quoteId || "AZQ_SNAPSHOT_0001",
        issuedAt: overrides.issuedAt || "2026-07-26T12:00:00.000Z",
        expiresAt: overrides.expiresAt || "2026-07-26T12:10:00.000Z",
        owner: overrides.owner || { userId: "user-1", sessionId: "session-1" },
        request: {
            region: "TH",
            currency: "THB",
            package: {
                packageId: "MLBB-7740",
                packageCode: "MLBB_7740",
                packageName: "7740+1548 Diamonds",
                gameId: "mlbb",
                gameCode: "mlbb",
                gameName: "Mobile Legends",
                categoryId: "mobile-games",
                categoryCode: "mobile",
                quantity: overrides.quantity || 1
            },
            couponCode: overrides.noPromotion ? "" : "SAVE10"
        },
        pricingInput: pricingInput(overrides.pricingInput || {}),
        promotionInput: overrides.noPromotion ? null : {
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
        versionContext: {
            priceVersionId: "pv-1",
            priceVersionNumber: 1,
            branchKey: "main"
        },
        trace: { traceId: "trace-quote", issueSource: "snapshot-verifier" }
    });
    const mutable = clone(runtimeQuote);
    Object.entries(overrides).forEach(([key, value]) => {
        if (!["quoteId", "issuedAt", "expiresAt", "owner", "quantity", "pricingInput", "noPromotion"].includes(key)) {
            mutable[key] = value;
        }
    });
    mutable.integrityMetadata = {
        algorithm: "canonical-json-sha256-deferred",
        canonicalHash: "hash-1"
    };
    return mutable;
}

function input(overrides = {}) {
    return {
        orderId: "AZL-ORDER-0001",
        checkoutId: "CHK-0001",
        checkoutTime: CHECKOUT_TIME,
        quote: quote(),
        owner: { userId: "user-1", sessionId: "session-1" },
        idempotencyKey: "idem-1",
        requestFingerprint: "fingerprint-1",
        paymentSnapshot: {
            paymentMethodId: "promptpay",
            paymentChannel: "manual",
            provider: "manual",
            flowType: "manual",
            nextAction: "OPEN_MANUAL_PAYMENT",
            paymentMethodBound: true,
            metadata: { displayName: "PromptPay" }
        },
        fulfilmentInput: {
            userId: "123456",
            zoneId: "1001",
            playerName: "Tester",
            customFields: { server: "TH" }
        },
        contact: { email: "USER@EXAMPLE.COM", phone: "+6612345678" },
        notes: "Customer note",
        requestMetadata: {
            traceId: "trace-checkout",
            source: "verifier",
            ipHash: "ip-hash",
            userAgentHash: "ua-hash"
        },
        ...overrides
    };
}

function assertCommercialFidelity(snapshot, sourceQuote) {
    const commercial = sourceQuote.commercialSnapshot;
    assert.strictEqual(snapshot.commercial.currency, commercial.currency, "currency copied exactly.");
    assert.strictEqual(snapshot.commercial.quantity, commercial.quantity, "quantity copied exactly.");
    assert.strictEqual(snapshot.commercial.originalUnitPrice, commercial.originalPrice, "original unit price copied exactly.");
    assert.strictEqual(snapshot.commercial.discountAmount, commercial.discountAmount, "discount copied exactly.");
    assert.strictEqual(snapshot.commercial.quotedUnitPrice, commercial.quotedUnitPrice, "quoted unit copied exactly.");
    assert.strictEqual(snapshot.commercial.totalAmount, commercial.quotedTotalAmount, "total copied exactly.");
    assert.deepStrictEqual(snapshot.quoteSnapshot.commercialSnapshot, commercial, "raw quote commercial snapshot preserved.");
}

function verifyBasicConstruction() {
    const source = input();
    const snapshot = createOrderSnapshot(source);
    assert.strictEqual(snapshot.schemaVersion, ORDER_SNAPSHOT_SCHEMA_VERSION, "schema version set.");
    assert.strictEqual(snapshot.runtimeVersion, ORDER_SNAPSHOT_RUNTIME_VERSION, "runtime version set.");
    assert.strictEqual(snapshot.orderId, source.orderId, "order id preserved.");
    assert.strictEqual(snapshot.checkoutId, source.checkoutId, "checkout id preserved.");
    assert.strictEqual(snapshot.checkout.checkedOutAt, CHECKOUT_TIME, "checkout time preserved.");
    assert.strictEqual(snapshot.status, "pending_payment", "order status initialised.");
    assert.strictEqual(snapshot.payment.status, "unpaid", "payment status initialised.");
    assert.strictEqual(snapshot.fulfilment.status, "not_started", "fulfilment status initialised.");
    assert.strictEqual(snapshot.product.gameName, "Mobile Legends", "product copied.");
    assert.strictEqual(snapshot.payment.paymentMethodId, "promptpay", "payment copied.");
    assert.strictEqual(snapshot.fulfilment.input.userId, "123456", "fulfilment copied.");
    assertCommercialFidelity(snapshot, source.quote);
}

function verifyPromotionMapping() {
    const withPromotion = createOrderSnapshot(input());
    assert.strictEqual(withPromotion.promotion.code, "SAVE10", "selected promotion copied.");
    const noPromotionQuote = quote({ noPromotion: true });
    const noPromotion = createOrderSnapshot(input({ quote: noPromotionQuote }));
    assert.strictEqual(noPromotion.promotion, null, "no promotion maps to null.");
}

function verifyNoRecalculationAndSourceSafety() {
    const sourceQuote = quote();
    sourceQuote.commercialSnapshot.quotedTotalAmount = 1234.56789;
    sourceQuote.commercialSnapshot.quotedUnitPrice = 1234.56789;
    sourceQuote.commercialSnapshot.originalPrice = 1234.56789;
    const snapshot = createOrderSnapshot(input({ quote: sourceQuote }));
    assert.strictEqual(snapshot.commercial.totalAmount, 1234.56789, "decimal total not recomputed.");
    assert.strictEqual(snapshot.commercial.quotedUnitPrice, 1234.56789, "quoted unit not rounded again.");
    assert.strictEqual(snapshot.commercial.originalUnitPrice, 1234.56789, "original price not rounded again.");
}

function verifyProhibitedOverrides() {
    assertError(() => createOrderSnapshot(input({ amount: 1 })), ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "top-level amount rejected.");
    assertError(() => createOrderSnapshot(input({ extra: { total: 1 } })), ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "nested total rejected.");
    assertError(() => createOrderSnapshot(input({ currency: "MMK" })), ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "currency override rejected.");
    assertError(() => createOrderSnapshot(input({ paymentSnapshot: { paymentMethodId: "promptpay", metadata: { amount: 1 } } })), ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "payment metadata amount rejected.");
    assertError(() => createOrderSnapshot(input({ paymentSnapshot: { paymentMethodId: "promptpay", amount: 1 } })), ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "payment snapshot amount rejected.");
    assertError(() => createOrderSnapshot(input({ fulfilmentInput: { customFields: { supplierCost: 1 } } })), ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "fulfilment commercial override rejected.");
    assertError(() => createOrderSnapshot(input({ contact: { email: "user@example.com", currency: "THB" } })), ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "contact commercial override rejected.");
    assertError(() => createOrderSnapshot(input({ packageSnapshot: {} })), ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "package snapshot override rejected.");
    assertError(() => createOrderSnapshot(input({ supplierCost: 1 })), ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "supplier cost override rejected.");
}

function verifyOwnership() {
    createOrderSnapshot(input({ owner: { userId: "user-1" } }));
    assertError(() => createOrderSnapshot(input({ owner: { userId: "wrong" } })), ORDER_SNAPSHOT_ERROR_CODES.OWNER_MISMATCH, "wrong user fails.");
    const sessionQuote = quote({ owner: { sessionId: "session-only" } });
    createOrderSnapshot(input({ quote: sessionQuote, owner: { sessionId: "session-only" } }));
    assertError(() => createOrderSnapshot(input({ quote: sessionQuote, owner: { sessionId: "wrong" } })), ORDER_SNAPSHOT_ERROR_CODES.OWNER_MISMATCH, "wrong session fails.");
    assertError(() => createOrderSnapshot(input({ quote: sessionQuote, owner: { userId: "user-1", sessionId: "session-only" } })), ORDER_SNAPSHOT_ERROR_CODES.OWNER_MISMATCH, "session quote cannot become user order.");
    assertError(() => createOrderSnapshot(input({ quote: { ...quote(), owner: {} }, owner: { userId: "user-1" } })), ORDER_SNAPSHOT_ERROR_CODES.INVALID_QUOTE_OWNER, "ambiguous missing quote owner fails.");
    assertError(() => createOrderSnapshot(input({ owner: { sessionId: "session-1" } })), ORDER_SNAPSHOT_ERROR_CODES.OWNER_MISMATCH, "user quote cannot become session order.");
}

function verifyStatusPolicy() {
    const positive = createOrderSnapshot(input());
    assert.strictEqual(positive.status, "pending_payment", "positive paid-later order starts pending.");
    assert.strictEqual(positive.payment.status, "unpaid", "positive paid-later payment starts unpaid.");
    assert.strictEqual(positive.fulfilment.status, "not_started", "fulfilment not started.");

    const zeroQuote = quote();
    zeroQuote.commercialSnapshot.originalPrice = 0;
    zeroQuote.commercialSnapshot.discountAmount = 0;
    zeroQuote.commercialSnapshot.quotedUnitPrice = 0;
    zeroQuote.commercialSnapshot.quotedTotalAmount = 0;
    assertError(() => createOrderSnapshot(input({ quote: zeroQuote })), ORDER_SNAPSHOT_ERROR_CODES.ZERO_PRICE_NOT_ALLOWED, "zero price requires policy.");
    const zero = createOrderSnapshot(input({ quote: zeroQuote, policy: { zeroPriceAllowed: true } }));
    assert.strictEqual(zero.status, "paid", "zero price defaults paid.");
    assert.strictEqual(zero.payment.status, "waived", "zero price payment waived.");
    assert.strictEqual(zero.payment.nextAction, "NO_PAYMENT_REQUIRED", "zero price no payment action.");

    assertError(() => createOrderSnapshot(input({ policy: { paymentStatus: "waived" } })), ORDER_SNAPSHOT_ERROR_CODES.POSITIVE_ORDER_CANNOT_BE_WAIVED, "positive order cannot be waived.");
    assertError(() => createOrderSnapshot(input({ paymentSnapshot: { paymentMethodId: "wallet", flowType: "wallet", status: "paid" } })), ORDER_SNAPSHOT_ERROR_CODES.INVALID_STATUS_POLICY, "wallet cannot claim paid.");
}

function verifyTimestampIdentityAndStructure() {
    const snapshot = createOrderSnapshot(input());
    assert.strictEqual(snapshot.createdAt, CHECKOUT_TIME, "createdAt uses checkout time.");
    assert.strictEqual(snapshot.updatedAt, CHECKOUT_TIME, "updatedAt uses checkout time.");
    assert.strictEqual(snapshot.checkout.checkedOutAt, CHECKOUT_TIME, "checkout timestamp uses checkout time.");
    assertError(() => createOrderSnapshot(input({ checkoutTime: "not-a-date" })), ORDER_SNAPSHOT_ERROR_CODES.INVALID_CHECKOUT_TIME, "invalid time rejected.");
    assertError(() => createOrderSnapshot(input({ orderId: "" })), ORDER_SNAPSHOT_ERROR_CODES.INVALID_ORDER_ID, "missing order id rejected.");
    assertError(() => createOrderSnapshot(input({ checkoutId: "" })), ORDER_SNAPSHOT_ERROR_CODES.INVALID_CHECKOUT_ID, "missing checkout id rejected.");
    assertError(() => createOrderSnapshot(input({ requestFingerprint: "" })), ORDER_SNAPSHOT_ERROR_CODES.INVALID_REQUEST_FINGERPRINT, "missing fingerprint rejected.");
    assertError(() => createOrderSnapshot(input({ quote: { ...quote(), packageSnapshot: {} } })), ORDER_SNAPSHOT_ERROR_CODES.INVALID_PACKAGE_SNAPSHOT, "missing package rejected.");
    assertError(() => createOrderSnapshot(input({ quote: { ...quote(), commercialSnapshot: {} } })), ORDER_SNAPSHOT_ERROR_CODES.INVALID_COMMERCIAL_SNAPSHOT, "missing commercial rejected.");
    const ambiguous = quote();
    ambiguous.commercialSnapshot.totalAmount = ambiguous.commercialSnapshot.quotedTotalAmount + 1;
    assertError(() => createOrderSnapshot(input({ quote: ambiguous })), ORDER_SNAPSHOT_ERROR_CODES.AMBIGUOUS_MONEY_REPRESENTATION, "ambiguous money rejected.");
    assertError(() => createOrderSnapshot(input({ paymentSnapshot: {} })), ORDER_SNAPSHOT_ERROR_CODES.INVALID_PAYMENT_SNAPSHOT, "malformed payment rejected.");
    assertError(() => createOrderSnapshot(input({ fulfilmentInput: "bad" })), ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT, "malformed fulfilment rejected.");
    assertError(() => createOrderSnapshot(input({ requestMetadata: { token: "secret" } })), ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "unsafe metadata rejected.");
}

function verifyImmutabilityAndDeterminism() {
    const source = input();
    const original = clone(source);
    const snapshot = createOrderSnapshot(source);
    assert.deepStrictEqual(source, original, "input not mutated.");
    assert(Object.isFrozen(snapshot), "snapshot is frozen.");
    assert(Object.isFrozen(snapshot.commercial), "nested snapshot is frozen.");
    source.quote.packageSnapshot.packageName = "Changed";
    source.paymentSnapshot.metadata.displayName = "Changed";
    assert.strictEqual(snapshot.product.packageName, "7740+1548 Diamonds", "snapshot detached from quote.");
    assert.strictEqual(snapshot.payment.metadata.displayName, "PromptPay", "snapshot detached from payment input.");
    const again = createOrderSnapshot(input());
    assert.deepStrictEqual(again, createOrderSnapshot(input()), "same input is deterministic.");
    assert.deepStrictEqual(toOrderSnapshotPayload(snapshot), JSON.parse(JSON.stringify(snapshot)), "payload mapper returns plain clone.");
    assert(validateOrderSnapshotInput(input()), "input validator returns normalized frozen data.");
}

async function verifyCheckoutIntegration() {
    const store = {
        quote: quote({ quoteId: "AZQ_CHECKOUT_0001" }),
        orders: [],
        calls: { customSnapshot: 0 }
    };
    const deps = {
        getCheckoutTime: () => CHECKOUT_TIME,
        generateCheckoutId: () => "CHK-0001",
        generateOrderId: () => "AZL-ORDER-0001",
        transactionRunner: callback => callback({ mongoSession: "tx" }),
        findOwnedQuote: () => clone(store.quote),
        findOrderByQuoteId: () => null,
        findOrderByCheckoutIdempotency: () => null,
        validateOperationalPackageState: () => ({ allowed: true }),
        validateFulfilmentInput: ({ customerInput }) => ({ valid: true, normalisedFulfilmentInput: customerInput.gameAccount }),
        validatePaymentMethod: ({ paymentSelection }) => ({ valid: true, paymentSnapshot: paymentSelection, nextAction: "OPEN_MANUAL_PAYMENT" }),
        createOrderRecord: ({ orderSnapshot }) => {
            store.orders.push(orderSnapshot);
            return orderSnapshot;
        },
        markQuoteUsed: () => ({ outcome: "success" })
    };
    const result = await checkoutFromQuote({
        quoteId: "AZQ_CHECKOUT_0001",
        owner: { userId: "user-1", sessionId: "session-1" },
        idempotencyKey: "idem-1",
        paymentSelection: { paymentMethodId: "promptpay", paymentChannel: "manual" },
        customerInput: { gameAccount: { userId: "123", zoneId: "456" } },
        requestMetadata: { traceId: "trace" }
    }, deps);
    assert.strictEqual(store.orders[0].schemaVersion, ORDER_SNAPSHOT_SCHEMA_VERSION, "checkout defaults to order snapshot runtime.");
    assert.strictEqual(result.checkout.orderId, "AZL-ORDER-0001", "checkout public result still works.");
    assert(!JSON.stringify(result.checkout).includes("requestFingerprint"), "public redaction still excludes fingerprint.");

    const custom = checkoutCreateOrderSnapshot({
        orderId: "AZL-CUSTOM",
        checkoutId: "CHK-CUSTOM",
        checkoutTime: new Date(CHECKOUT_TIME),
        quote: quote(),
        owner: { userId: "user-1" },
        idempotencyKeyHash: "hash-1",
        requestFingerprint: "fp-1",
        paymentSnapshot: { paymentMethodId: "promptpay" },
        fulfilmentInput: { gameAccount: { userId: "1" } }
    });
    assert.strictEqual(custom.schemaVersion, ORDER_SNAPSHOT_SCHEMA_VERSION, "checkout exported mapper delegates to runtime.");
}

function verifyNoRuntimeSideEffects() {
    const source = fs.readFileSync("backend/services/commerce/orderSnapshotRuntime.js", "utf8");
    assert(!source.includes("calculateBasePrice"), "runtime must not call pricing engine.");
    assert(!source.includes("resolvePromotion"), "runtime must not call promotion resolver.");
    assert(!source.includes("Date.now("), "runtime must not call Date.now.");
    assert(!source.includes("Math.random("), "runtime must not call Math.random.");
    assert(!source.includes("randomUUID("), "runtime must not call randomUUID.");
    assert(!source.includes("require(\"mongoose\")"), "runtime must not require Mongoose.");
}

async function run() {
    verifyBasicConstruction();
    verifyPromotionMapping();
    verifyNoRecalculationAndSourceSafety();
    verifyProhibitedOverrides();
    verifyOwnership();
    verifyStatusPolicy();
    verifyTimestampIdentityAndStructure();
    verifyImmutabilityAndDeterminism();
    await verifyCheckoutIntegration();
    verifyNoRuntimeSideEffects();
    console.log("Commerce order snapshot runtime checks passed.");
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
