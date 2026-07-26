const assert = require("assert");

const {
    checkoutFromQuote,
    getCheckoutResult,
    CheckoutApplicationError,
    ERROR_CODES
} = require("../services/commerce/checkoutApplicationService");
const {
    OrderRepositoryError,
    ERROR_CODES: ORDER_REPOSITORY_ERROR_CODES
} = require("../services/commerce/orderRepository");
const { createPricingQuote } = require("../services/commerce/pricingQuoteRuntime");

const CHECKOUT_TIME = "2026-07-26T12:05:00.000Z";
const EXPIRES_AT = "2026-07-26T12:10:00.000Z";

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
            assert(error instanceof CheckoutApplicationError, `${message}: got ${error.name || "Error"} ${error.code || ""} ${error.message || ""}`);
            assert.strictEqual(error.code, code, message);
        });
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

function quote(overrides = {}) {
    const runtimeQuote = createPricingQuote({
        quoteId: overrides.quoteId || "AZQ_CHECKOUT_0001",
        issuedAt: overrides.issuedAt || "2026-07-26T12:00:00.000Z",
        expiresAt: overrides.expiresAt || EXPIRES_AT,
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
                quantity: overrides.quantity || 1
            },
            couponCode: "SAVE10"
        },
        pricingInput: pricingInput(),
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
        versionContext: {
            priceVersionId: "pv-1",
            priceVersionNumber: 1,
            branchKey: "main"
        },
        trace: { traceId: "trace-1", issueSource: "checkout-verifier" }
    });
    const mutable = clone(runtimeQuote);
    Object.entries(overrides).forEach(([key, value]) => {
        if (!["quoteId", "issuedAt", "expiresAt", "owner", "quantity"].includes(key)) {
            mutable[key] = value;
        }
    });
    return mutable;
}

function checkoutInput(overrides = {}) {
    return {
        quoteId: "AZQ_CHECKOUT_0001",
        owner: { userId: "user-1", sessionId: "session-1" },
        idempotencyKey: "idem-checkout-1",
        paymentSelection: { paymentMethodId: "promptpay", paymentChannel: "manual" },
        customerInput: {
            gameAccount: { userId: "123456", zoneId: "1001", playerName: "Tester" },
            contact: { email: "USER@EXAMPLE.COM" },
            notes: " deliver fast ",
            customFields: { server: "TH" }
        },
        requestMetadata: { traceId: "trace-checkout", source: "verifier" },
        ...overrides
    };
}

function createStore(initialQuotes = [quote()], options = {}) {
    return {
        quotes: initialQuotes.map(clone),
        orders: [],
        calls: {
            findOwnedQuote: 0,
            findOrderByQuoteId: 0,
            findOrderByCheckoutIdempotency: 0,
            validateOperationalPackageState: 0,
            validateFulfilmentInput: 0,
            validatePaymentMethod: 0,
            validatePromotionRedemption: 0,
            createOrderSnapshot: 0,
            createOrderRecord: 0,
            markQuoteUsed: 0,
            transactionRunner: 0
        },
        options
    };
}

function matchesOwner(recordOwner = {}, owner = {}) {
    if (recordOwner.userId) return recordOwner.userId === owner.userId;
    if (recordOwner.sessionId) return recordOwner.sessionId === owner.sessionId;
    return false;
}

function createDeps(store, overrides = {}) {
    const deps = {
        getCheckoutTime: () => CHECKOUT_TIME,
        generateCheckoutId: () => "CHK-0001",
        generateOrderId: () => "AZL-ORDER-0001",
        fingerprintCheckoutRequest({ normalized }) {
            return JSON.stringify({
                quoteId: normalized.quoteId,
                owner: normalized.owner,
                paymentSelection: normalized.paymentSelection,
                customerInput: normalized.customerInput
            });
        },
        hashCheckoutIdempotencyKey({ idempotencyKey, owner }) {
            return `hash:${owner.userId || owner.sessionId}:${idempotencyKey}`;
        },
        async transactionRunner(callback) {
            store.calls.transactionRunner += 1;
            const before = { quotes: clone(store.quotes), orders: clone(store.orders) };
            try {
                return await callback({ mongoSession: "fake-session", txId: `tx-${store.calls.transactionRunner}` });
            } catch (error) {
                store.quotes = before.quotes;
                store.orders = before.orders;
                throw error;
            }
        },
        async findOwnedQuote({ quoteId, userId, sessionId, transactionContext }) {
            store.calls.findOwnedQuote += 1;
            assert(transactionContext == null, "quote lookup occurs before transaction.");
            return clone(store.quotes.find(item => item.quoteId === quoteId && matchesOwner(item.owner, { userId, sessionId })) || null);
        },
        async findOrderByQuoteId({ quoteId, owner, transactionContext }) {
            store.calls.findOrderByQuoteId += 1;
            assert(transactionContext == null, "existing order by quote lookup occurs before transaction.");
            return clone(store.orders.find(order => order.quoteId === quoteId && (!owner || matchesOwner(order.owner, owner))) || null);
        },
        async findOrderByCheckoutIdempotency({ idempotencyKeyHash, owner, transactionContext }) {
            store.calls.findOrderByCheckoutIdempotency += 1;
            assert(transactionContext == null, "existing order by idempotency lookup occurs before transaction.");
            return clone(store.orders.find(order => (
                order.checkoutIdempotencyKeyHash === idempotencyKeyHash &&
                matchesOwner(order.owner, owner)
            )) || null);
        },
        async findOrderById({ orderId, owner }) {
            return clone(store.orders.find(order => order.orderId === orderId && matchesOwner(order.owner, owner)) || null);
        },
        async validateOperationalPackageState({ transactionContext }) {
            store.calls.validateOperationalPackageState += 1;
            assert.strictEqual(transactionContext, null, "package validation occurs before transaction.");
            return store.options.packageResult || { allowed: true };
        },
        async validateFulfilmentInput({ customerInput, transactionContext }) {
            store.calls.validateFulfilmentInput += 1;
            assert.strictEqual(transactionContext, null, "fulfilment validation occurs before transaction.");
            if (store.options.fulfilmentResult) return store.options.fulfilmentResult;
            return {
                valid: true,
                normalisedFulfilmentInput: { ...customerInput, normalisedBy: "server" }
            };
        },
        async validatePaymentMethod({ quote: checkoutQuote, paymentSelection, transactionContext }) {
            store.calls.validatePaymentMethod += 1;
            assert.strictEqual(transactionContext, null, "payment validation occurs before transaction.");
            if (store.options.paymentResult) return store.options.paymentResult;
            assert.strictEqual(checkoutQuote.commercialSnapshot.currency, "THB", "payment validator receives quote commercial truth.");
            return {
                valid: true,
                paymentSnapshot: {
                    paymentMethodId: paymentSelection.paymentMethodId,
                    paymentChannel: paymentSelection.paymentChannel,
                    displayName: "PromptPay"
                },
                nextAction: "OPEN_MANUAL_PAYMENT"
            };
        },
        async validatePromotionRedemption({ transactionContext }) {
            store.calls.validatePromotionRedemption += 1;
            assert.strictEqual(transactionContext, null, "promotion validation occurs before transaction.");
            return store.options.promotionResult || { valid: true };
        },
        createOrderSnapshot(args) {
            store.calls.createOrderSnapshot += 1;
            return require("../services/commerce/checkoutApplicationService").createOrderSnapshot(args);
        },
        async createOrderRecord({ orderSnapshot, transactionContext }) {
            store.calls.createOrderRecord += 1;
            assert.strictEqual(transactionContext?.mongoSession, "fake-session", "order create uses transaction context.");
            if (store.options.createOrderError) throw Object.assign(new Error("order create failed"), { code: "ORDER_DB_DOWN" });
            const order = {
                ...clone(orderSnapshot),
                createdAt: CHECKOUT_TIME
            };
            store.orders.push(order);
            return clone(order);
        },
        async markQuoteUsed({ quoteId, consumedOrderId, usedAt, transactionContext }) {
            store.calls.markQuoteUsed += 1;
            assert.strictEqual(transactionContext?.mongoSession, "fake-session", "quote consume uses transaction context.");
            if (store.options.consumeError) throw Object.assign(new Error("consume failed"), { code: "QUOTE_RACE" });
            const index = store.quotes.findIndex(item => item.quoteId === quoteId);
            if (index === -1) {
                const error = new Error("missing quote");
                error.name = "PricingQuotePersistenceError";
                error.code = "QUOTE_NOT_FOUND";
                throw error;
            }
            if (store.quotes[index].status !== "ISSUED") {
                const error = new Error("already used");
                error.name = "PricingQuotePersistenceError";
                error.code = "QUOTE_ALREADY_USED";
                throw error;
            }
            if (new Date(store.quotes[index].lifecycle.expiresAt).getTime() <= usedAt.getTime()) {
                const error = new Error("expired");
                error.name = "PricingQuotePersistenceError";
                error.code = "QUOTE_EXPIRED";
                throw error;
            }
            store.quotes[index].status = "USED";
            store.quotes[index].lifecycle.status = "USED";
            store.quotes[index].lifecycle.usedAt = usedAt.toISOString();
            store.quotes[index].consumedOrderId = consumedOrderId;
            return { outcome: "success", quote: clone(store.quotes[index]) };
        }
    };
    return { ...deps, ...overrides };
}

function assertPublicSafe(result) {
    const text = JSON.stringify(result);
    assert(!Object.prototype.hasOwnProperty.call(result, "order"), "checkout response does not expose persisted order internals.");
    assert(!text.includes("supplierCost"), "public result redacts supplier cost.");
    assert(!text.includes("appliedPricingRules"), "public result redacts pricing internals.");
    assert(!text.includes("integrityPayload"), "public result redacts integrity payload.");
    assert(!text.includes("checkoutFingerprint"), "public result redacts request fingerprint.");
    assert(!text.includes("requestFingerprint"), "public result redacts request fingerprint metadata.");
    assert(!text.includes("idempotencyKey"), "public result redacts idempotency identity.");
    assert(!text.includes("eligibilityTrace"), "public result redacts eligibility trace.");
}

async function verifyBasicSuccess() {
    const store = createStore();
    const input = checkoutInput();
    const original = clone(input);
    const result = await checkoutFromQuote(input, createDeps(store));
    assert.strictEqual(result.checkout.orderId, "AZL-ORDER-0001", "injected order id used.");
    assert.strictEqual(result.checkout.quoteId, "AZQ_CHECKOUT_0001", "quote id returned.");
    assert.strictEqual(result.checkout.pricing.totalAmount, 1080, "quote total copied exactly.");
    assert.strictEqual(result.checkout.pricing.currency, "THB", "quote currency copied exactly.");
    assert.strictEqual(result.checkout.product.quantity, 1, "quote quantity copied exactly.");
    assert.strictEqual(result.checkout.promotion.code, "SAVE10", "quote promotion copied exactly.");
    assert.strictEqual(store.orders.length, 1, "order created once.");
    assert.strictEqual(store.calls.markQuoteUsed, 1, "quote consumed once.");
    assert.strictEqual(store.calls.transactionRunner, 1, "transaction opened only for persistence boundary.");
    assert.deepStrictEqual(input, original, "input was not mutated.");
    assert(Object.isFrozen(result.checkout), "public checkout result is frozen.");
    assertPublicSafe(result);
}

async function verifyValidation() {
    await assertError(() => checkoutFromQuote(checkoutInput({ quoteId: "" }), createDeps(createStore())), ERROR_CODES.INVALID_QUOTE_ID, "missing quoteId rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput({ owner: {} }), createDeps(createStore())), ERROR_CODES.INVALID_OWNER, "missing owner rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput({ idempotencyKey: "" }), createDeps(createStore())), ERROR_CODES.INVALID_CHECKOUT_IDEMPOTENCY_KEY, "missing idempotency rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput({ paymentSelection: {} }), createDeps(createStore())), ERROR_CODES.INVALID_PAYMENT_SELECTION, "invalid payment selection rejected.");
    await assertError(() => checkoutFromQuote({ ...checkoutInput(), amount: 1 }, createDeps(createStore())), ERROR_CODES.PROHIBITED_COMMERCIAL_INPUT, "client amount rejected.");
    await assertError(() => checkoutFromQuote({ ...checkoutInput(), customerInput: { customFields: { currency: "THB" } } }, createDeps(createStore())), ERROR_CODES.PROHIBITED_COMMERCIAL_INPUT, "client currency override rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput({ customerInput: { notes: "x".repeat(501) } }), createDeps(createStore())), ERROR_CODES.INVALID_CHECKOUT_INPUT, "long notes rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput({ customerInput: { customFields: { nested: { bad: true } } } }), createDeps(createStore())), ERROR_CODES.INVALID_CHECKOUT_INPUT, "nested custom field rejected.");
}

async function verifyDeterministicProvidersRequired() {
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore(), { getCheckoutTime: undefined })), ERROR_CODES.INVALID_CHECKOUT_INPUT, "checkout time provider required.");
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore(), { generateOrderId: undefined })), ERROR_CODES.INVALID_CHECKOUT_INPUT, "order id provider required.");
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore(), { generateCheckoutId: undefined })), ERROR_CODES.INVALID_CHECKOUT_INPUT, "checkout id provider required.");
}

async function verifyQuoteStates() {
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore([quote({ expiresAt: CHECKOUT_TIME })]))), ERROR_CODES.QUOTE_EXPIRED, "boundary expiry rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore([quote({ expiresAt: "2026-07-26T12:04:59.000Z" })]))), ERROR_CODES.QUOTE_EXPIRED, "expired quote rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore([{ ...quote(), status: "USED", lifecycle: { ...quote().lifecycle, status: "USED" } }]))), ERROR_CODES.QUOTE_ALREADY_USED, "used quote rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore([{ ...quote(), status: "INVALIDATED", lifecycle: { ...quote().lifecycle, status: "INVALIDATED" } }]))), ERROR_CODES.QUOTE_INVALIDATED, "invalidated quote rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore([{ ...quote(), status: "CANCELLED", lifecycle: { ...quote().lifecycle, status: "CANCELLED" } }]))), ERROR_CODES.QUOTE_CANCELLED, "cancelled quote rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput({ quoteId: "AZQ_MISSING" }), createDeps(createStore())), ERROR_CODES.QUOTE_NOT_AVAILABLE, "missing quote ownership-safe rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput({ owner: { userId: "wrong-user" } }), createDeps(createStore())), ERROR_CODES.QUOTE_NOT_AVAILABLE, "wrong owner ownership-safe rejected.");
}

async function verifyOperationalFailures() {
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore([quote()], { packageResult: { allowed: false, reasonCode: ERROR_CODES.PACKAGE_UNAVAILABLE } }))), ERROR_CODES.PACKAGE_UNAVAILABLE, "package unavailable rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore([quote()], { packageResult: { allowed: false, reasonCode: ERROR_CODES.REGION_UNAVAILABLE } }))), ERROR_CODES.REGION_UNAVAILABLE, "region unavailable rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore([quote()], { fulfilmentResult: { valid: false, reasonCode: ERROR_CODES.INVALID_FULFILMENT_INPUT } }))), ERROR_CODES.INVALID_FULFILMENT_INPUT, "invalid fulfilment rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore([quote()], { paymentResult: { valid: false, reasonCode: ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE } }))), ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "payment unavailable rejected.");
    const bound = quote({ pricingSnapshot: { paymentMethodId: "wallet" } });
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore([bound]))), ERROR_CODES.PAYMENT_METHOD_INCOMPATIBLE, "payment-bound quote mismatch rejected.");
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore([quote()], { promotionResult: { valid: false, reasonCode: ERROR_CODES.PROMOTION_REDEMPTION_UNAVAILABLE } }))), ERROR_CODES.PROMOTION_REDEMPTION_UNAVAILABLE, "promotion redemption unavailable rejected.");
}

async function verifyIdempotency() {
    const store = createStore();
    const deps = createDeps(store);
    const first = await checkoutFromQuote(checkoutInput(), deps);
    const second = await checkoutFromQuote(checkoutInput(), deps);
    assert.strictEqual(second.checkout.orderId, first.checkout.orderId, "same key and fingerprint returns existing order.");
    assert.strictEqual(store.orders.length, 1, "idempotent retry does not create a second order.");
    assert.strictEqual(store.calls.markQuoteUsed, 1, "idempotent retry does not consume quote twice.");
    assert.strictEqual(store.calls.transactionRunner, 1, "idempotent retry is resolved before opening a new transaction.");

    await assertError(() => checkoutFromQuote(checkoutInput({ customerInput: { gameAccount: { userId: "changed" } } }), deps), ERROR_CODES.CHECKOUT_IDEMPOTENCY_CONFLICT, "same key with different fingerprint rejects.");
    await assertError(() => checkoutFromQuote(checkoutInput({ idempotencyKey: "idem-checkout-2" }), deps), ERROR_CODES.ORDER_ALREADY_EXISTS_FOR_QUOTE, "same quote with different idempotency key rejects second order.");

    const otherOwnerStore = createStore([quote({ quoteId: "AZQ_OWNER_TWO", owner: { userId: "user-2" } })]);
    const otherResult = await checkoutFromQuote(checkoutInput({
        quoteId: "AZQ_OWNER_TWO",
        owner: { userId: "user-2" },
        idempotencyKey: "idem-checkout-1"
    }), createDeps(otherOwnerStore, {
        generateOrderId: () => "AZL-ORDER-0002"
    }));
    assert.strictEqual(otherResult.checkout.orderId, "AZL-ORDER-0002", "different owners may reuse idempotency key.");
}

async function verifyTransactionSemantics() {
    const createFailStore = createStore([quote()], { createOrderError: true });
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createFailStore)), ERROR_CODES.ORDER_CREATION_FAILED, "order create failure mapped.");
    assert.strictEqual(createFailStore.orders.length, 0, "order create failure leaves no order.");
    assert.strictEqual(createFailStore.quotes[0].status, "ISSUED", "order create failure leaves quote issued.");

    const consumeFailStore = createStore([quote()], { consumeError: true });
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(consumeFailStore)), ERROR_CODES.QUOTE_CONSUMPTION_FAILED, "quote consumption failure mapped.");
    assert.strictEqual(consumeFailStore.orders.length, 0, "quote consumption failure aborts order.");
    assert.strictEqual(consumeFailStore.quotes[0].status, "ISSUED", "quote consumption failure leaves quote issued.");

    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore(), {
        transactionRunner: async () => {
            throw Object.assign(new Error("write conflict"), { code: "WRITE_CONFLICT" });
        }
    })), ERROR_CODES.CHECKOUT_TRANSACTION_FAILED, "transaction conflict mapped.");
}

async function verifyRepositoryErrorMapping() {
    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore(), {
        async createOrderRecord() {
            throw new OrderRepositoryError(
                ORDER_REPOSITORY_ERROR_CODES.CHECKOUT_IDEMPOTENCY_CONFLICT,
                "conflict",
                { stage: "create" }
            );
        }
    })), ERROR_CODES.CHECKOUT_IDEMPOTENCY_CONFLICT, "order repository idempotency conflict maps to checkout conflict.");

    await assertError(() => checkoutFromQuote(checkoutInput(), createDeps(createStore(), {
        async createOrderRecord() {
            throw new OrderRepositoryError(
                ORDER_REPOSITORY_ERROR_CODES.ORDER_ALREADY_EXISTS_FOR_QUOTE,
                "duplicate quote",
                { stage: "create" }
            );
        }
    })), ERROR_CODES.ORDER_ALREADY_EXISTS_FOR_QUOTE, "order repository duplicate quote maps to checkout duplicate quote.");
}

async function verifyConcurrencySimulation() {
    const store = createStore();
    const deps = createDeps(store);
    const first = await checkoutFromQuote(checkoutInput(), deps);
    const loser = await checkoutFromQuote(checkoutInput(), deps);
    assert.strictEqual(first.checkout.orderId, loser.checkout.orderId, "same-quote loser receives existing order.");
    assert.strictEqual(store.orders.length, 1, "concurrency simulation leaves one order.");
}

async function verifyRetrieval() {
    const store = createStore();
    const deps = createDeps(store);
    const created = await checkoutFromQuote(checkoutInput(), deps);
    const byOrder = await getCheckoutResult({ owner: { userId: "user-1" }, orderId: created.checkout.orderId }, deps);
    assert.strictEqual(byOrder.orderId, created.checkout.orderId, "lookup by owner + orderId works.");
    const byQuote = await getCheckoutResult({ owner: { userId: "user-1" }, quoteId: "AZQ_CHECKOUT_0001" }, deps);
    assert.strictEqual(byQuote.orderId, created.checkout.orderId, "lookup by owner + quoteId works.");
    const byIdem = await getCheckoutResult({ owner: { userId: "user-1" }, idempotencyKey: "idem-checkout-1" }, deps);
    assert.strictEqual(byIdem.orderId, created.checkout.orderId, "lookup by owner + idempotency works.");
    const wrongOwner = await getCheckoutResult({ owner: { userId: "wrong" }, quoteId: "AZQ_CHECKOUT_0001" }, deps);
    assert.strictEqual(wrongOwner, null, "wrong owner unavailable.");
    await assertError(() => getCheckoutResult({ owner: { userId: "user-1" } }, deps), ERROR_CODES.INVALID_CHECKOUT_INPUT, "missing lookup identity rejected.");
}

async function verifyImmutabilityAndRedaction() {
    const sourceQuote = quote();
    const store = createStore([sourceQuote]);
    const result = await checkoutFromQuote(checkoutInput(), createDeps(store));
    result.checkout.product.gameName = "mutated";
    assert.notStrictEqual(result.checkout.product.gameName, "mutated", "deep frozen public output resists mutation.");
    assert.deepStrictEqual(sourceQuote.status, "ISSUED", "caller quote object was not mutated.");
    assertPublicSafe(result);
}

async function verifyNoRuntimePricingOrPromotionCalls() {
    const source = require("fs").readFileSync("backend/services/commerce/checkoutApplicationService.js", "utf8");
    assert(!source.includes("calculateBasePrice"), "checkout service must not call pricing engine.");
    assert(!source.includes("resolvePromotion"), "checkout service must not call promotion resolver.");
    assert(!source.includes("Date.now("), "checkout service must not call Date.now.");
    assert(!source.includes("Math.random("), "checkout service must not call Math.random.");
    assert(!source.includes("randomUUID("), "checkout service must not call crypto.randomUUID.");
    assert(!source.includes("session.withTransaction(async () => createOrderRecord"), "repository must not own transaction creation.");
}

async function run() {
    await verifyBasicSuccess();
    await verifyValidation();
    await verifyDeterministicProvidersRequired();
    await verifyQuoteStates();
    await verifyOperationalFailures();
    await verifyIdempotency();
    await verifyTransactionSemantics();
    await verifyRepositoryErrorMapping();
    await verifyConcurrencySimulation();
    await verifyRetrieval();
    await verifyImmutabilityAndRedaction();
    await verifyNoRuntimePricingOrPromotionCalls();
    console.log("Commerce checkout application service checks passed.");
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
