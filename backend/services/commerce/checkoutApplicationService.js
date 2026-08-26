const mongoose = require("mongoose");
const {
    findOwnedQuote,
    markQuoteUsed,
    PricingQuotePersistenceError,
    ERROR_CODES: QUOTE_PERSISTENCE_ERROR_CODES,
    STATUS: QUOTE_STATUS
} = require("./pricingQuoteRepository");
const {
    createOrderRecord,
    findOwnedOrderById,
    findOwnedOrderByQuoteId,
    findOwnedOrderByCheckoutIdempotency,
    OrderRepositoryError,
    ERROR_CODES: ORDER_REPOSITORY_ERROR_CODES
} = require("./orderRepository");
const {
    createOrderSnapshot: createRuntimeOrderSnapshot
} = require("./orderSnapshotRuntime");
const { inputContractForProduct, gameFamilyForProduct } = require("./canonicalGameInputContract");

const CHECKOUT_APPLICATION_SERVICE_VERSION = "2.5.4";
const MAX_ID_LENGTH = 200;
const MAX_NOTE_LENGTH = 500;
const MAX_METADATA_LENGTH = 240;
const MAX_CUSTOM_FIELD_KEYS = 30;
const MAX_CUSTOM_FIELD_VALUE_LENGTH = 500;

const ERROR_CODES = Object.freeze({
    INVALID_CHECKOUT_INPUT: "INVALID_CHECKOUT_INPUT",
    INVALID_OWNER: "INVALID_OWNER",
    INVALID_QUOTE_ID: "INVALID_QUOTE_ID",
    INVALID_CHECKOUT_IDEMPOTENCY_KEY: "INVALID_CHECKOUT_IDEMPOTENCY_KEY",
    INVALID_PAYMENT_SELECTION: "INVALID_PAYMENT_SELECTION",
    PROHIBITED_COMMERCIAL_INPUT: "PROHIBITED_COMMERCIAL_INPUT",
    QUOTE_NOT_AVAILABLE: "QUOTE_NOT_AVAILABLE",
    QUOTE_NOT_FOUND: "QUOTE_NOT_FOUND",
    QUOTE_OWNERSHIP_MISMATCH: "QUOTE_OWNERSHIP_MISMATCH",
    QUOTE_EXPIRED: "QUOTE_EXPIRED",
    QUOTE_ALREADY_USED: "QUOTE_ALREADY_USED",
    QUOTE_INVALIDATED: "QUOTE_INVALIDATED",
    QUOTE_CANCELLED: "QUOTE_CANCELLED",
    PACKAGE_UNAVAILABLE: "PACKAGE_UNAVAILABLE",
    REGION_UNAVAILABLE: "REGION_UNAVAILABLE",
    CURRENCY_MISMATCH: "CURRENCY_MISMATCH",
    PAYMENT_METHOD_REQUIRED: "PAYMENT_METHOD_REQUIRED",
    PAYMENT_METHOD_UNAVAILABLE: "PAYMENT_METHOD_UNAVAILABLE",
    PAYMENT_METHOD_INCOMPATIBLE: "PAYMENT_METHOD_INCOMPATIBLE",
    INVALID_FULFILMENT_INPUT: "INVALID_FULFILMENT_INPUT",
    PROMOTION_REDEMPTION_UNAVAILABLE: "PROMOTION_REDEMPTION_UNAVAILABLE",
    CHECKOUT_IDEMPOTENCY_CONFLICT: "CHECKOUT_IDEMPOTENCY_CONFLICT",
    ORDER_ALREADY_EXISTS_FOR_QUOTE: "ORDER_ALREADY_EXISTS_FOR_QUOTE",
    ORDER_CREATION_FAILED: "ORDER_CREATION_FAILED",
    QUOTE_CONSUMPTION_FAILED: "QUOTE_CONSUMPTION_FAILED",
    CHECKOUT_TRANSACTION_CONFLICT: "CHECKOUT_TRANSACTION_CONFLICT",
    CHECKOUT_TRANSACTION_FAILED: "CHECKOUT_TRANSACTION_FAILED",
    CHECKOUT_ORCHESTRATION_FAILED: "CHECKOUT_ORCHESTRATION_FAILED",
    CHECKOUT_RESULT_NOT_FOUND: "CHECKOUT_RESULT_NOT_FOUND"
});

const WARNING_CODES = Object.freeze({
    EXISTING_CHECKOUT_REUSED: "EXISTING_CHECKOUT_REUSED",
    SESSION_BOUND_ORDER: "SESSION_BOUND_ORDER",
    NO_PROMOTION_APPLIED: "NO_PROMOTION_APPLIED",
    ZERO_PRICE_ORDER: "ZERO_PRICE_ORDER",
    PAYMENT_INITIATION_REQUIRED: "PAYMENT_INITIATION_REQUIRED",
    PAYMENT_METHOD_MAINTENANCE_RISK: "PAYMENT_METHOD_MAINTENANCE_RISK",
    PACKAGE_TEMPORARILY_DEGRADED: "PACKAGE_TEMPORARILY_DEGRADED"
});

const PROHIBITED_COMMERCIAL_FIELDS = Object.freeze(new Set([
    "amount",
    "total",
    "unitprice",
    "discount",
    "currency",
    "promotion",
    "exchangerate",
    "suppliercost",
    "tax",
    "fee",
    "paid",
    "orderstatus",
    "packagesnapshot"
]));

class CheckoutApplicationError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "CheckoutApplicationError";
        this.code = code;
        this.stage = normalizeString(options.stage);
        this.causeCode = normalizeString(options.causeCode);
        this.retryable = options.retryable === true;
        this.metadata = Object.freeze(clonePlain(options.metadata || {}));
    }
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return value;
}

function clonePlain(value) {
    if (value === undefined) return undefined;
    return structuredClone(value);
}

function normalizeString(value) {
    return String(value || "").trim();
}

function normalizeLower(value) {
    return normalizeString(value).toLowerCase();
}

function normalizeBoundedString(value, field, maxLength = MAX_ID_LENGTH, required = false) {
    const normalized = normalizeString(value);
    if (required && !normalized) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_CHECKOUT_INPUT, `${field} is required.`, { stage: "input", metadata: { field } });
    }
    if (normalized.length > maxLength) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_CHECKOUT_INPUT, `${field} is too long.`, { stage: "input", metadata: { field } });
    }
    return normalized;
}

function assertPlainObject(value, field) {
    if (!isPlainObject(value)) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_CHECKOUT_INPUT, `${field} must be an object.`, { stage: "input", metadata: { field } });
    }
    return value;
}

function assertProvider(provider, label) {
    if (typeof provider !== "function") {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_CHECKOUT_INPUT, `${label} dependency is required.`, {
            stage: "dependencies",
            metadata: { dependency: label }
        });
    }
    return provider;
}

function toDate(value, field) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_CHECKOUT_INPUT, `${field} must be a valid timestamp.`, {
            stage: "input",
            metadata: { field }
        });
    }
    return date;
}

function toIso(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function rejectProhibitedCommercialFields(value, path = "input") {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => rejectProhibitedCommercialFields(item, `${path}[${index}]`));
        return;
    }
    Object.entries(value).forEach(([key, child]) => {
        if (PROHIBITED_COMMERCIAL_FIELDS.has(normalizeLower(key))) {
            throw new CheckoutApplicationError(ERROR_CODES.PROHIBITED_COMMERCIAL_INPUT, "Checkout request contains prohibited commercial input.", {
                stage: "input",
                metadata: { field: `${path}.${key}` }
            });
        }
        rejectProhibitedCommercialFields(child, `${path}.${key}`);
    });
}

function normalizeOwner(owner = {}) {
    assertPlainObject(owner, "owner");
    const normalized = {
        userId: normalizeBoundedString(owner.userId, "owner.userId", MAX_ID_LENGTH),
        sessionId: normalizeBoundedString(owner.sessionId, "owner.sessionId", MAX_ID_LENGTH)
    };
    if (!normalized.userId && !normalized.sessionId) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_OWNER, "Authenticated userId or sessionId ownership is required.", { stage: "input" });
    }
    return normalized;
}

function normalizeQuoteId(value) {
    const quoteId = normalizeString(value);
    if (!quoteId || quoteId.length > 128) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_QUOTE_ID, "quoteId must be a bounded public-safe identifier.", { stage: "input" });
    }
    if (!/^[A-Za-z0-9._:-]+$/.test(quoteId)) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_QUOTE_ID, "quoteId must be a public-safe identifier.", { stage: "input" });
    }
    return quoteId;
}

function normalizeIdempotencyKey(value) {
    const idempotencyKey = normalizeString(value);
    if (!idempotencyKey || idempotencyKey.length > MAX_ID_LENGTH) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_CHECKOUT_IDEMPOTENCY_KEY, "idempotencyKey must be a bounded non-empty string.", { stage: "input" });
    }
    if (!/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_CHECKOUT_IDEMPOTENCY_KEY, "idempotencyKey must be public-safe.", { stage: "input" });
    }
    return idempotencyKey;
}

function normalizePaymentSelection(paymentSelection = {}) {
    assertPlainObject(paymentSelection, "paymentSelection");
    const paymentMethodId = normalizeString(paymentSelection.paymentMethodId);
    if (!paymentMethodId || paymentMethodId.length > 120) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_PAYMENT_SELECTION, "paymentMethodId is required.", { stage: "input" });
    }
    if (!/^[A-Za-z0-9._:-]+$/.test(paymentMethodId)) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_PAYMENT_SELECTION, "paymentMethodId is invalid.", { stage: "input" });
    }
    const paymentChannel = normalizeBoundedString(paymentSelection.paymentChannel, "paymentSelection.paymentChannel", 80);
    if (paymentChannel && !/^[A-Za-z0-9._:-]+$/.test(paymentChannel)) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_PAYMENT_SELECTION, "paymentChannel is invalid.", { stage: "input" });
    }
    return { paymentMethodId, paymentChannel };
}

function normalizeContact(contact = {}) {
    if (contact === undefined || contact === null) return {};
    assertPlainObject(contact, "customerInput.contact");
    return {
        email: normalizeBoundedString(contact.email, "customerInput.contact.email", 254).toLowerCase(),
        phone: normalizeBoundedString(contact.phone, "customerInput.contact.phone", 80)
    };
}

function normalizeGameAccount(gameAccount = {}) {
    if (gameAccount === undefined || gameAccount === null) return {};
    assertPlainObject(gameAccount, "customerInput.gameAccount");
    const accountFields = Array.isArray(gameAccount.accountFields)
        ? gameAccount.accountFields.slice(0, 20).map((field, index) => {
            assertPlainObject(field, `customerInput.gameAccount.accountFields.${index}`);
            return {
                key: normalizeBoundedString(field.key, `customerInput.gameAccount.accountFields.${index}.key`, 80, true),
                label: normalizeBoundedString(field.label || field.key, `customerInput.gameAccount.accountFields.${index}.label`, 120),
                value: normalizeBoundedString(field.value, `customerInput.gameAccount.accountFields.${index}.value`, MAX_CUSTOM_FIELD_VALUE_LENGTH)
            };
        }).filter(field => field.key && field.value)
        : [];
    return {
        userId: normalizeBoundedString(gameAccount.userId, "customerInput.gameAccount.userId", 120),
        serverId: normalizeBoundedString(gameAccount.serverId, "customerInput.gameAccount.serverId", 120),
        zoneId: normalizeBoundedString(gameAccount.zoneId, "customerInput.gameAccount.zoneId", 120),
        playerName: normalizeBoundedString(gameAccount.playerName, "customerInput.gameAccount.playerName", 160),
        accountFields
    };
}

function normalizeCustomFields(customFields = {}) {
    if (customFields === undefined || customFields === null) return {};
    assertPlainObject(customFields, "customerInput.customFields");
    const keys = Object.keys(customFields);
    if (keys.length > MAX_CUSTOM_FIELD_KEYS) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_CHECKOUT_INPUT, "Too many custom fields.", { stage: "input" });
    }
    const normalized = {};
    keys.sort().forEach(key => {
        const normalizedKey = normalizeBoundedString(key, "customerInput.customFields key", 80, true);
        const value = customFields[key];
        if (value !== null && typeof value === "object") {
            throw new CheckoutApplicationError(ERROR_CODES.INVALID_CHECKOUT_INPUT, "Custom field values must be scalar.", {
                stage: "input",
                metadata: { field: `customerInput.customFields.${normalizedKey}` }
            });
        }
        normalized[normalizedKey] = normalizeBoundedString(value, `customerInput.customFields.${normalizedKey}`, MAX_CUSTOM_FIELD_VALUE_LENGTH);
    });
    return normalized;
}

function normalizeCustomerInput(customerInput = {}) {
    if (customerInput === undefined || customerInput === null) return { gameAccount: {}, contact: {}, notes: "", customFields: {} };
    assertPlainObject(customerInput, "customerInput");
    return {
        gameAccount: normalizeGameAccount(customerInput.gameAccount || {}),
        contact: normalizeContact(customerInput.contact || {}),
        notes: normalizeBoundedString(customerInput.notes, "customerInput.notes", MAX_NOTE_LENGTH),
        customFields: normalizeCustomFields(customerInput.customFields || {})
    };
}

function normalizeRequestMetadata(requestMetadata = {}) {
    if (requestMetadata === undefined || requestMetadata === null) return {};
    assertPlainObject(requestMetadata, "requestMetadata");
    return {
        traceId: normalizeBoundedString(requestMetadata.traceId, "requestMetadata.traceId", MAX_METADATA_LENGTH),
        source: normalizeBoundedString(requestMetadata.source, "requestMetadata.source", MAX_METADATA_LENGTH),
        ipHash: normalizeBoundedString(requestMetadata.ipHash, "requestMetadata.ipHash", MAX_METADATA_LENGTH),
        userAgentHash: normalizeBoundedString(requestMetadata.userAgentHash, "requestMetadata.userAgentHash", MAX_METADATA_LENGTH)
    };
}

function normalizeCheckoutInput(input) {
    assertPlainObject(input, "input");
    rejectProhibitedCommercialFields(input);
    return {
        quoteId: normalizeQuoteId(input.quoteId),
        owner: normalizeOwner(input.owner || {}),
        idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
        paymentSelection: normalizePaymentSelection(input.paymentSelection || {}),
        customerInput: normalizeCustomerInput(input.customerInput || {}),
        requestMetadata: normalizeRequestMetadata(input.requestMetadata || {})
    };
}

function stableCanonicalize(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(stableCanonicalize);
    const normalized = {};
    Object.keys(value).sort().forEach(key => {
        if (value[key] !== undefined) normalized[key] = stableCanonicalize(value[key]);
    });
    return normalized;
}

function defaultFingerprintCheckoutRequest({ normalized }) {
    return JSON.stringify(stableCanonicalize({
        quoteId: normalized.quoteId,
        owner: normalized.owner,
        paymentSelection: normalized.paymentSelection,
        customerInput: normalized.customerInput
    }));
}

function normalizeDependencies(dependencies = {}) {
    return {
        findOwnedQuote: dependencies.findOwnedQuote || findOwnedQuote,
        findOrderByQuoteId: dependencies.findOrderByQuoteId || defaultFindOrderByQuoteId,
        findOrderByCheckoutIdempotency: dependencies.findOrderByCheckoutIdempotency || defaultFindOrderByCheckoutIdempotency,
        findOrderById: dependencies.findOrderById || defaultFindOrderById,
        validateOperationalPackageState: dependencies.validateOperationalPackageState,
        validateFulfilmentInput: dependencies.validateFulfilmentInput,
        validatePaymentMethod: dependencies.validatePaymentMethod,
        validatePromotionRedemption: dependencies.validatePromotionRedemption,
        createOrderSnapshot: dependencies.createOrderSnapshot || createOrderSnapshot,
        createOrderRecord: dependencies.createOrderRecord || defaultCreateOrderRecord,
        markQuoteUsed: dependencies.markQuoteUsed || markQuoteUsed,
        transactionRunner: dependencies.transactionRunner || defaultTransactionRunner,
        getCheckoutTime: dependencies.getCheckoutTime,
        generateOrderId: dependencies.generateOrderId,
        generateCheckoutId: dependencies.generateCheckoutId,
        hashCheckoutIdempotencyKey: dependencies.hashCheckoutIdempotencyKey,
        fingerprintCheckoutRequest: dependencies.fingerprintCheckoutRequest || defaultFingerprintCheckoutRequest
    };
}

function toRepositoryOwner(owner = {}) {
    if (normalizeString(owner.userId)) return { type: "USER", userId: normalizeString(owner.userId) };
    return { type: "SESSION", sessionId: normalizeString(owner.sessionId) };
}

function mongoSessionFrom(transactionContext = {}) {
    return transactionContext?.mongoSession || transactionContext?.session || null;
}

async function defaultTransactionRunner(callback) {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await callback({ mongoSession: session });
        });
        return result;
    } finally {
        await session.endSession();
    }
}

function defaultFindOrderByQuoteId({ quoteId, owner, transactionContext } = {}) {
    return findOwnedOrderByQuoteId(
        { quoteId, owner: toRepositoryOwner(owner) },
        { mongoSession: mongoSessionFrom(transactionContext) }
    );
}

function defaultFindOrderByCheckoutIdempotency({ owner, idempotencyKeyHash, transactionContext } = {}) {
    return findOwnedOrderByCheckoutIdempotency(
        { owner: toRepositoryOwner(owner), idempotencyKeyHash },
        { mongoSession: mongoSessionFrom(transactionContext) }
    );
}

function defaultFindOrderById({ orderId, owner, transactionContext } = {}) {
    return findOwnedOrderById(
        { orderId, owner: toRepositoryOwner(owner) },
        { mongoSession: mongoSessionFrom(transactionContext) }
    );
}

function defaultCreateOrderRecord({ orderSnapshot, transactionContext } = {}) {
    return createOrderRecord(orderSnapshot, { mongoSession: mongoSessionFrom(transactionContext) });
}

async function resolveCheckoutTime(normalized, deps) {
    const provider = assertProvider(deps.getCheckoutTime, "getCheckoutTime");
    return toDate(await provider({ owner: normalized.owner, quoteId: normalized.quoteId }), "checkoutTime");
}

async function resolveGeneratedValue(provider, label, args) {
    assertProvider(provider, label);
    const value = normalizeBoundedString(await provider(args), label, MAX_ID_LENGTH, true);
    return value;
}

async function resolveFingerprint(normalized, deps) {
    const fingerprint = await deps.fingerprintCheckoutRequest({ normalized });
    return normalizeBoundedString(fingerprint, "requestFingerprint", 4000, true);
}

async function resolveIdempotencyKeyHash(normalized, deps) {
    if (typeof deps.hashCheckoutIdempotencyKey !== "function") return normalized.idempotencyKey;
    return normalizeBoundedString(await deps.hashCheckoutIdempotencyKey({
        idempotencyKey: normalized.idempotencyKey,
        owner: normalized.owner,
        quoteId: normalized.quoteId
    }), "checkoutIdempotencyKeyHash", 4000, true);
}

function ensureQuoteOwnership(quote, owner) {
    const quoteOwner = quote?.owner || {};
    if (quoteOwner.userId && quoteOwner.userId !== owner.userId) {
        throw new CheckoutApplicationError(ERROR_CODES.QUOTE_NOT_AVAILABLE, "Quote is not available for checkout.", {
            stage: "quote",
            causeCode: ERROR_CODES.QUOTE_OWNERSHIP_MISMATCH
        });
    }
    if (!quoteOwner.userId && quoteOwner.sessionId && quoteOwner.sessionId !== owner.sessionId) {
        throw new CheckoutApplicationError(ERROR_CODES.QUOTE_NOT_AVAILABLE, "Quote is not available for checkout.", {
            stage: "quote",
            causeCode: ERROR_CODES.QUOTE_OWNERSHIP_MISMATCH
        });
    }
}

function quoteStatus(quote) {
    return normalizeString(quote?.status || quote?.lifecycle?.status || "").toUpperCase();
}

function mapTerminalQuoteStatus(status) {
    if (status === QUOTE_STATUS.EXPIRED) return ERROR_CODES.QUOTE_EXPIRED;
    if (status === QUOTE_STATUS.INVALIDATED) return ERROR_CODES.QUOTE_INVALIDATED;
    if (status === QUOTE_STATUS.CANCELLED) return ERROR_CODES.QUOTE_CANCELLED;
    if (status === QUOTE_STATUS.USED) return ERROR_CODES.QUOTE_ALREADY_USED;
    return ERROR_CODES.QUOTE_NOT_AVAILABLE;
}

function validateQuoteForCheckout(quote, checkoutTime) {
    const status = quoteStatus(quote);
    if (status !== QUOTE_STATUS.ISSUED) {
        throw new CheckoutApplicationError(mapTerminalQuoteStatus(status), "Quote cannot be used for checkout.", {
            stage: "quote",
            causeCode: status
        });
    }
    const expiresAt = toDate(quote?.lifecycle?.expiresAt, "quote.lifecycle.expiresAt");
    if (checkoutTime.getTime() >= expiresAt.getTime()) {
        throw new CheckoutApplicationError(ERROR_CODES.QUOTE_EXPIRED, "Quote has expired.", { stage: "quote" });
    }
}

function sameFingerprint(order, requestFingerprint) {
    return Boolean(order && normalizeString(order.checkoutFingerprint || order.checkoutFingerprintHash || order.requestFingerprint) === requestFingerprint);
}

function sameIdempotency(order, idempotencyKeyHash) {
    return Boolean(order && normalizeString(order.checkoutIdempotencyKeyHash || order.checkoutIdempotencyKey || order.idempotencyKey) === idempotencyKeyHash);
}

function orderIdOf(order) {
    return normalizeString(order?.orderId || order?.id || order?._id);
}

function assertIdempotentOrder(order, normalized, requestFingerprint, idempotencyKeyHash) {
    if (!order) return false;
    if (sameFingerprint(order, requestFingerprint) && sameIdempotency(order, idempotencyKeyHash)) return true;
    throw new CheckoutApplicationError(ERROR_CODES.CHECKOUT_IDEMPOTENCY_CONFLICT, "Checkout idempotency key was reused for a different request.", {
        stage: "idempotency",
        metadata: { quoteId: normalized.quoteId }
    });
}

function validationResultAllowed(result, unavailableCode, stage) {
    if (result === undefined || result === null) return {};
    if (result.allowed === false || result.valid === false) {
        throw new CheckoutApplicationError(result.reasonCode || unavailableCode, `${stage} validation failed.`, {
            stage,
            causeCode: result.reasonCode || unavailableCode
        });
    }
    return result;
}

async function validatePackage(quote, context, deps) {
    const validator = assertProvider(deps.validateOperationalPackageState, "validateOperationalPackageState");
    return validationResultAllowed(await validator({
        quote,
        checkoutTime: context.checkoutTime,
        owner: context.normalized.owner,
        transactionContext: context.transactionContext
    }), ERROR_CODES.PACKAGE_UNAVAILABLE, "package");
}

async function validateFulfilment(quote, context, deps) {
    const validator = assertProvider(deps.validateFulfilmentInput, "validateFulfilmentInput");
    const result = validationResultAllowed(await validator({
        quote,
        customerInput: context.normalized.customerInput,
        transactionContext: context.transactionContext
    }), ERROR_CODES.INVALID_FULFILMENT_INPUT, "fulfilment");
    const normalized = result.normalisedFulfilmentInput || result.normalizedFulfilmentInput || result.fulfilmentInput || context.normalized.customerInput;
    const gameAccount = normalized.gameAccount || normalized;
    const productCode = quote?.packageSnapshot?.gameCode || quote?.packageSnapshot?.productCode || quote?.request?.productCode || "";
    const contract = inputContractForProduct(productCode);
    if (contract) {
        const accountFields = Array.isArray(gameAccount.accountFields) ? gameAccount.accountFields : [];
        const value = key => normalizeString(gameAccount[key] || accountFields.find(field => normalizeString(field?.key) === key)?.value);
        for (const key of contract.required) {
            if (!value(key)) throw new CheckoutApplicationError(ERROR_CODES.INVALID_FULFILMENT_INPUT, `${key} is required for ${contract.family}.`, { stage: "fulfilment", metadata: { productCode, field: key } });
        }
        const family = gameFamilyForProduct(productCode);
        if (family === "MLBB" && (!/^\d+$/.test(value("userId")) || !/^\d+$/.test(value("zoneId")))) {
            throw new CheckoutApplicationError(ERROR_CODES.INVALID_FULFILMENT_INPUT, "MLBB User ID and Zone ID must be numeric.", { stage: "fulfilment", metadata: { productCode } });
        }
        if (family === "PUBG" && !/^\d{5,32}$/.test(value("userId"))) {
            throw new CheckoutApplicationError(ERROR_CODES.INVALID_FULFILMENT_INPUT, "PUBG Player ID must be numeric.", { stage: "fulfilment", metadata: { productCode } });
        }
    }
    return normalized;
}

function quoteBoundPaymentMethod(quote) {
    return normalizeString(
        quote?.request?.paymentMethodId ||
        quote?.pricingSnapshot?.paymentMethodId ||
        quote?.commercialSnapshot?.paymentMethodId ||
        quote?.integrityPayload?.canonicalCommercialData?.request?.paymentMethodId
    );
}

async function validatePayment(quote, context, deps) {
    const boundMethod = quoteBoundPaymentMethod(quote);
    if (boundMethod && boundMethod !== context.normalized.paymentSelection.paymentMethodId) {
        throw new CheckoutApplicationError(ERROR_CODES.PAYMENT_METHOD_INCOMPATIBLE, "Selected payment method does not match quote-bound method.", {
            stage: "payment",
            metadata: { paymentMethodId: context.normalized.paymentSelection.paymentMethodId }
        });
    }
    const validator = assertProvider(deps.validatePaymentMethod, "validatePaymentMethod");
    const result = validationResultAllowed(await validator({
        quote,
        paymentSelection: context.normalized.paymentSelection,
        owner: context.normalized.owner,
        checkoutTime: context.checkoutTime,
        transactionContext: context.transactionContext
    }), ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "payment");
    return {
        paymentSnapshot: result.paymentSnapshot || {
            paymentMethodId: context.normalized.paymentSelection.paymentMethodId,
            paymentChannel: context.normalized.paymentSelection.paymentChannel
        },
        nextAction: normalizeString(result.nextAction || "OPEN_MANUAL_PAYMENT"),
        warnings: Array.isArray(result.warnings) ? result.warnings : []
    };
}

async function validatePromotion(quote, context, deps) {
    if (typeof deps.validatePromotionRedemption !== "function") return { warnings: [] };
    const result = validationResultAllowed(await deps.validatePromotionRedemption({
        quote,
        owner: context.normalized.owner,
        orderId: context.orderId,
        checkoutTime: context.checkoutTime,
        transactionContext: context.transactionContext
    }), ERROR_CODES.PROMOTION_REDEMPTION_UNAVAILABLE, "promotion");
    return {
        promotionRedemptionSnapshot: result.promotionRedemptionSnapshot || null,
        warnings: Array.isArray(result.warnings) ? result.warnings : []
    };
}

function selectedPromotion(quote) {
    return quote?.promotionSnapshot?.selectedPromotion || null;
}

function createOrderSnapshot(args) {
    return createRuntimeOrderSnapshot({
        ...args,
        idempotencyKey: args.idempotencyKeyHash || args.idempotencyKey,
        contact: args.fulfilmentInput?.contact,
        notes: args.fulfilmentInput?.notes,
        fulfilmentInput: args.fulfilmentInput?.gameAccount || args.fulfilmentInput,
        policy: args.policy || {}
    });
}

function mapWarnings({ paymentValidation = {}, promotionValidation = {}, idempotentReuse = false, quote = null } = {}) {
    const warningSet = new Set();
    if (idempotentReuse) warningSet.add(WARNING_CODES.EXISTING_CHECKOUT_REUSED);
    if (quote?.owner?.sessionId && !quote?.owner?.userId) warningSet.add(WARNING_CODES.SESSION_BOUND_ORDER);
    if (!selectedPromotion(quote)) warningSet.add(WARNING_CODES.NO_PROMOTION_APPLIED);
    if (Number(quote?.commercialSnapshot?.quotedTotalAmount || 0) === 0) warningSet.add(WARNING_CODES.ZERO_PRICE_ORDER);
    if (paymentValidation.nextAction && paymentValidation.nextAction !== "NO_PAYMENT_REQUIRED") warningSet.add(WARNING_CODES.PAYMENT_INITIATION_REQUIRED);
    [...(paymentValidation.warnings || []), ...(promotionValidation.warnings || [])].forEach(warning => {
        const code = normalizeString(warning?.code || warning);
        if (Object.values(WARNING_CODES).includes(code)) warningSet.add(code);
    });
    return [...warningSet].sort().map(code => ({ code }));
}

function toPublicCheckoutResult(orderOrResult, options = {}) {
    if (!orderOrResult) return null;
    const source = orderOrResult.order || orderOrResult;
    const quote = options.quote || source.quoteSnapshot || null;
    const commercial = source.commercial || source.commercialSnapshot || source.pricing || quote?.commercialSnapshot || {};
    const packageSnapshot = source.product || source.packageSnapshot || quote?.packageSnapshot || {};
    const promotionSource = source.promotion || selectedPromotion(source) || selectedPromotion(quote);
    const paymentSource = source.payment || source.paymentSnapshot || {};
    return deepFreeze({
        checkoutApplicationServiceVersion: CHECKOUT_APPLICATION_SERVICE_VERSION,
        orderId: orderIdOf(source),
        quoteId: source.quoteId || quote?.quoteId || options.quoteId || "",
        status: source.status || "pending_payment",
        paymentStatus: source.paymentStatus || "unpaid",
        product: {
            gameName: packageSnapshot.gameName || source.gameName || "",
            packageName: packageSnapshot.packageName || source.packageName || "",
            quantity: Number(commercial.quantity || packageSnapshot.quantity || 1)
        },
        pricing: {
            currency: commercial.currency || "",
            originalPrice: Number(commercial.originalPrice || commercial.originalUnitPrice || 0),
            discountAmount: Number(commercial.discountAmount || 0),
            totalAmount: Number(commercial.totalAmount || commercial.quotedTotalAmount || 0)
        },
        promotion: promotionSource ? {
            code: promotionSource.code || "",
            name: promotionSource.name || ""
        } : null,
        payment: {
            paymentMethodId: paymentSource.paymentMethodId || paymentSource.methodKey || source.paymentMethod || "",
            paymentChannel: paymentSource.paymentChannel || "",
            nextAction: options.nextAction || paymentSource.nextAction || "NONE"
        },
        createdAt: toIso(source.createdAt || source.checkedOutAt) || source.checkedOutAt || "",
        warnings: Array.isArray(options.warnings) ? clonePlain(options.warnings) : []
    });
}

function mapQuotePersistenceError(error, stage) {
    if (!(error instanceof PricingQuotePersistenceError)) return null;
    if (error.code === QUOTE_PERSISTENCE_ERROR_CODES.QUOTE_EXPIRED) return ERROR_CODES.QUOTE_EXPIRED;
    if (error.code === QUOTE_PERSISTENCE_ERROR_CODES.QUOTE_ALREADY_USED) return ERROR_CODES.QUOTE_ALREADY_USED;
    if (error.code === QUOTE_PERSISTENCE_ERROR_CODES.QUOTE_CONSUMPTION_CONFLICT) return ERROR_CODES.ORDER_ALREADY_EXISTS_FOR_QUOTE;
    if (error.code === QUOTE_PERSISTENCE_ERROR_CODES.QUOTE_NOT_FOUND) return ERROR_CODES.QUOTE_NOT_AVAILABLE;
    if (error.code === QUOTE_PERSISTENCE_ERROR_CODES.QUOTE_OWNERSHIP_MISMATCH) return ERROR_CODES.QUOTE_NOT_AVAILABLE;
    if (stage === "consume") return ERROR_CODES.QUOTE_CONSUMPTION_FAILED;
    return ERROR_CODES.QUOTE_NOT_AVAILABLE;
}

function mapOrderRepositoryError(error) {
    if (!(error instanceof OrderRepositoryError)) return null;
    if (error.code === ORDER_REPOSITORY_ERROR_CODES.CHECKOUT_IDEMPOTENCY_CONFLICT) return ERROR_CODES.CHECKOUT_IDEMPOTENCY_CONFLICT;
    if (error.code === ORDER_REPOSITORY_ERROR_CODES.ORDER_ALREADY_EXISTS_FOR_QUOTE) return ERROR_CODES.ORDER_ALREADY_EXISTS_FOR_QUOTE;
    return ERROR_CODES.ORDER_CREATION_FAILED;
}

function wrapUnknownError(error, fallbackCode, stage, retryable = false) {
    if (error instanceof CheckoutApplicationError) return error;
    const mappedQuoteError = mapQuotePersistenceError(error, stage);
    if (mappedQuoteError) {
        return new CheckoutApplicationError(mappedQuoteError, "Quote checkout persistence failed.", {
            stage,
            causeCode: error.code,
            retryable,
            metadata: error.details || {}
        });
    }
    const mappedOrderError = mapOrderRepositoryError(error);
    if (mappedOrderError) {
        return new CheckoutApplicationError(mappedOrderError, "Order checkout persistence failed.", {
            stage,
            causeCode: error.code,
            retryable: error.retryable === true,
            metadata: error.metadata || {}
        });
    }
    return new CheckoutApplicationError(fallbackCode, "Checkout orchestration failed.", {
        stage,
        causeCode: error?.code || "",
        retryable,
        metadata: { message: error?.message || "" }
    });
}

async function createOrderRecordSafely(snapshot, context, deps) {
    const creator = assertProvider(deps.createOrderRecord, "createOrderRecord");
    try {
        return await creator({
            orderSnapshot: snapshot,
            transactionContext: context.transactionContext
        });
    } catch (error) {
        throw wrapUnknownError(error, ERROR_CODES.ORDER_CREATION_FAILED, "order");
    }
}

async function markQuoteUsedSafely(quote, order, context, deps) {
    try {
        return await deps.markQuoteUsed({
            quoteId: quote.quoteId,
            ...context.normalized.owner,
            consumedOrderId: orderIdOf(order),
            usedAt: context.checkoutTime,
            mongoSession: context.transactionContext?.mongoSession,
            transactionContext: context.transactionContext
        });
    } catch (error) {
        throw wrapUnknownError(error, ERROR_CODES.QUOTE_CONSUMPTION_FAILED, "consume");
    }
}

async function findExistingOrders(normalized, requestFingerprint, idempotencyKeyHash, context, deps) {
    const existingByQuote = typeof deps.findOrderByQuoteId === "function"
        ? await deps.findOrderByQuoteId({
            quoteId: normalized.quoteId,
            owner: normalized.owner,
            transactionContext: context.transactionContext
        })
        : null;
    if (existingByQuote) {
        if (sameFingerprint(existingByQuote, requestFingerprint) && sameIdempotency(existingByQuote, idempotencyKeyHash)) {
            return { order: existingByQuote, idempotentReuse: true };
        }
        const sameKey = normalizeString(existingByQuote.checkoutIdempotencyKeyHash || existingByQuote.checkoutIdempotencyKey || existingByQuote.idempotencyKey) === idempotencyKeyHash;
        throw new CheckoutApplicationError(
            sameKey ? ERROR_CODES.CHECKOUT_IDEMPOTENCY_CONFLICT : ERROR_CODES.ORDER_ALREADY_EXISTS_FOR_QUOTE,
            sameKey ? "Checkout idempotency key was reused for a different request." : "An order already exists for this quote.",
            {
            stage: "idempotency",
            metadata: { quoteId: normalized.quoteId }
            }
        );
    }

    const existingByIdempotency = typeof deps.findOrderByCheckoutIdempotency === "function"
        ? await deps.findOrderByCheckoutIdempotency({
            owner: normalized.owner,
            idempotencyKeyHash,
            idempotencyKey: normalized.idempotencyKey,
            transactionContext: context.transactionContext
        })
        : null;
    if (existingByIdempotency) {
        assertIdempotentOrder(existingByIdempotency, normalized, requestFingerprint, idempotencyKeyHash);
        return { order: existingByIdempotency, idempotentReuse: true };
    }
    return null;
}

async function loadOwnedQuote(normalized, context, deps) {
    try {
        const quote = await deps.findOwnedQuote({
            quoteId: normalized.quoteId,
            ...normalized.owner,
            mongoSession: context.transactionContext?.mongoSession,
            transactionContext: context.transactionContext
        });
        if (!quote) {
            throw new CheckoutApplicationError(ERROR_CODES.QUOTE_NOT_AVAILABLE, "Quote is not available for checkout.", {
                stage: "quote",
                causeCode: ERROR_CODES.QUOTE_NOT_FOUND
            });
        }
        ensureQuoteOwnership(quote, normalized.owner);
        return quote;
    } catch (error) {
        throw wrapUnknownError(error, ERROR_CODES.QUOTE_NOT_AVAILABLE, "quote");
    }
}

async function executeCheckoutTransaction(context, deps) {
    const normalized = context.normalized;
    const preflightContext = { ...context, transactionContext: null };
    const quote = await loadOwnedQuote(normalized, preflightContext, deps);
    const existing = await findExistingOrders(normalized, context.requestFingerprint, context.idempotencyKeyHash, preflightContext, deps);
    if (existing) {
        const warnings = mapWarnings({ idempotentReuse: true, quote });
        return {
            order: existing.order,
            quote,
            paymentValidation: { nextAction: existing.order?.payment?.nextAction || "NONE" },
            warnings,
            metadata: {
                outcome: "idempotent_reuse",
                idempotentReuse: true
            }
        };
    }

    validateQuoteForCheckout(quote, context.checkoutTime);
    const packageValidation = await validatePackage(quote, preflightContext, deps);
    const fulfilmentInput = await validateFulfilment(quote, preflightContext, deps);
    const paymentValidation = await validatePayment(quote, preflightContext, deps);
    const promotionValidation = await validatePromotion(quote, preflightContext, deps);
    const orderSnapshot = deps.createOrderSnapshot({
        orderId: context.orderId,
        checkoutId: context.checkoutId,
        checkoutTime: context.checkoutTime,
        quote,
        owner: normalized.owner,
        idempotencyKey: normalized.idempotencyKey,
        idempotencyKeyHash: context.idempotencyKeyHash,
        requestFingerprint: context.requestFingerprint,
        paymentSnapshot: {
            ...paymentValidation.paymentSnapshot,
            nextAction: paymentValidation.nextAction
        },
        fulfilmentInput,
        supplierRouteSnapshot: packageValidation.supplierRouteSnapshot || null,
        requestMetadata: normalized.requestMetadata,
        promotionRedemptionSnapshot: promotionValidation.promotionRedemptionSnapshot
    });
    return deps.transactionRunner(async transactionContext => {
        const txContext = { ...context, transactionContext };
        const order = await createOrderRecordSafely(orderSnapshot, txContext, deps);
        await markQuoteUsedSafely(quote, order, txContext, deps);
        const warnings = mapWarnings({ paymentValidation, promotionValidation, quote });
        return {
            order,
            quote,
            orderSnapshot,
            paymentValidation,
            warnings,
            metadata: {
                outcome: "created",
                idempotentReuse: false
            }
        };
    });
}

async function checkoutFromQuote(input, dependencies = {}) {
    const originalInput = clonePlain(input);
    const normalized = normalizeCheckoutInput(input);
    const deps = normalizeDependencies(dependencies);
    const checkoutTime = await resolveCheckoutTime(normalized, deps);
    const checkoutId = await resolveGeneratedValue(deps.generateCheckoutId, "generateCheckoutId", { normalized, checkoutTime });
    const orderId = await resolveGeneratedValue(deps.generateOrderId, "generateOrderId", { normalized, checkoutTime, checkoutId });
    const requestFingerprint = await resolveFingerprint(normalized, deps);
    const idempotencyKeyHash = await resolveIdempotencyKeyHash(normalized, deps);
    assertProvider(deps.transactionRunner, "transactionRunner");

    try {
        const transactionResult = await executeCheckoutTransaction({
            normalized,
            checkoutTime,
            checkoutId,
            orderId,
            requestFingerprint,
            idempotencyKeyHash
        }, deps);
        if (input && typeof input === "object" && JSON.stringify(input) !== JSON.stringify(originalInput)) {
            throw new CheckoutApplicationError(ERROR_CODES.CHECKOUT_ORCHESTRATION_FAILED, "Checkout service mutated caller input.", { stage: "immutability" });
        }
        return deepFreeze({
            checkout: toPublicCheckoutResult(transactionResult.order, {
                quote: transactionResult.quote,
                nextAction: transactionResult.paymentValidation?.nextAction,
                warnings: transactionResult.warnings
            }),
            metadata: {
                checkoutApplicationServiceVersion: CHECKOUT_APPLICATION_SERVICE_VERSION,
                checkoutId,
                traceId: normalized.requestMetadata.traceId,
                quoteId: normalized.quoteId,
                orderId: orderIdOf(transactionResult.order),
                ownerType: normalized.owner.userId ? "user" : "session",
                idempotentReuse: transactionResult.metadata?.idempotentReuse === true,
                outcome: transactionResult.metadata?.outcome || "unknown"
            }
        });
    } catch (error) {
        if (error instanceof CheckoutApplicationError) throw error;
        throw wrapUnknownError(error, ERROR_CODES.CHECKOUT_TRANSACTION_FAILED, "transaction", true);
    }
}

async function getCheckoutResult(input, dependencies = {}) {
    const source = assertPlainObject(input, "input");
    const owner = normalizeOwner(source.owner || {});
    const quoteId = source.quoteId ? normalizeQuoteId(source.quoteId) : "";
    const orderId = source.orderId ? normalizeBoundedString(source.orderId, "orderId", MAX_ID_LENGTH, true) : "";
    const idempotencyKey = source.idempotencyKey ? normalizeIdempotencyKey(source.idempotencyKey) : "";
    if (!quoteId && !orderId && !idempotencyKey) {
        throw new CheckoutApplicationError(ERROR_CODES.INVALID_CHECKOUT_INPUT, "At least one checkout result lookup identity is required.", {
            stage: "input"
        });
    }
    const deps = normalizeDependencies(dependencies);
    let order = null;
    if (orderId && typeof deps.findOrderById === "function") {
        order = await deps.findOrderById({ orderId, owner });
    }
    if (!order && idempotencyKey && typeof deps.findOrderByCheckoutIdempotency === "function") {
        const idempotencyKeyHash = await resolveIdempotencyKeyHash({ idempotencyKey, owner, quoteId }, deps);
        order = await deps.findOrderByCheckoutIdempotency({ owner, idempotencyKeyHash, idempotencyKey });
    }
    if (!order && quoteId && typeof deps.findOrderByQuoteId === "function") {
        order = await deps.findOrderByQuoteId({ quoteId, owner });
    }
    if (!order) return null;
    return toPublicCheckoutResult(order, { quoteId });
}

module.exports = Object.freeze({
    checkoutFromQuote,
    getCheckoutResult,
    toPublicCheckoutResult,
    createOrderSnapshot,
    CheckoutApplicationError,
    ERROR_CODES,
    WARNING_CODES,
    CHECKOUT_APPLICATION_SERVICE_VERSION
});
