const ORDER_SNAPSHOT_RUNTIME_VERSION = "2.5.2";
const ORDER_SNAPSHOT_SPECIFICATION_VERSION = "2.5.2";
const ORDER_SNAPSHOT_SCHEMA_VERSION = "commerce.order-snapshot.v1";

const MAX_ID_LENGTH = 200;
const MAX_FIELD_LENGTH = 500;
const MAX_METADATA_LENGTH = 240;
const MAX_CUSTOM_FIELDS = 30;

const ORDER_SNAPSHOT_ERROR_CODES = Object.freeze({
    INVALID_ORDER_SNAPSHOT_INPUT: "INVALID_ORDER_SNAPSHOT_INPUT",
    INVALID_ORDER_ID: "INVALID_ORDER_ID",
    INVALID_CHECKOUT_ID: "INVALID_CHECKOUT_ID",
    INVALID_CHECKOUT_TIME: "INVALID_CHECKOUT_TIME",
    INVALID_QUOTE: "INVALID_QUOTE",
    INVALID_QUOTE_ID: "INVALID_QUOTE_ID",
    INVALID_QUOTE_OWNER: "INVALID_QUOTE_OWNER",
    OWNER_MISMATCH: "OWNER_MISMATCH",
    INVALID_IDEMPOTENCY_KEY: "INVALID_IDEMPOTENCY_KEY",
    INVALID_REQUEST_FINGERPRINT: "INVALID_REQUEST_FINGERPRINT",
    INVALID_PACKAGE_SNAPSHOT: "INVALID_PACKAGE_SNAPSHOT",
    INVALID_COMMERCIAL_SNAPSHOT: "INVALID_COMMERCIAL_SNAPSHOT",
    INVALID_PRICING_SNAPSHOT: "INVALID_PRICING_SNAPSHOT",
    INVALID_PROMOTION_SNAPSHOT: "INVALID_PROMOTION_SNAPSHOT",
    INVALID_PAYMENT_SNAPSHOT: "INVALID_PAYMENT_SNAPSHOT",
    INVALID_FULFILMENT_INPUT: "INVALID_FULFILMENT_INPUT",
    INVALID_CONTACT_INPUT: "INVALID_CONTACT_INPUT",
    INVALID_REQUEST_METADATA: "INVALID_REQUEST_METADATA",
    INVALID_STATUS_POLICY: "INVALID_STATUS_POLICY",
    PROHIBITED_COMMERCIAL_OVERRIDE: "PROHIBITED_COMMERCIAL_OVERRIDE",
    AMBIGUOUS_MONEY_REPRESENTATION: "AMBIGUOUS_MONEY_REPRESENTATION",
    ZERO_PRICE_NOT_ALLOWED: "ZERO_PRICE_NOT_ALLOWED",
    POSITIVE_ORDER_CANNOT_BE_WAIVED: "POSITIVE_ORDER_CANNOT_BE_WAIVED",
    ORDER_SNAPSHOT_CREATION_FAILED: "ORDER_SNAPSHOT_CREATION_FAILED"
});

const PROHIBITED_COMMERCIAL_FIELDS = Object.freeze(new Set([
    "amount",
    "total",
    "totalamount",
    "currency",
    "quantity",
    "unitprice",
    "originalunitprice",
    "quotedunitprice",
    "discount",
    "discountamount",
    "promotion",
    "pricing",
    "packagesnapshot",
    "exchangerate",
    "fee",
    "tax",
    "suppliercost",
    "costprice",
    "saleprice"
]));

const PROHIBITED_METADATA_FIELDS = Object.freeze(new Set([
    "amount",
    "total",
    "totalamount",
    "currency",
    "quantity",
    "unitprice",
    "originalunitprice",
    "quotedunitprice",
    "discount",
    "discountamount",
    "exchangerate",
    "fee",
    "tax",
    "suppliercost",
    "costprice",
    "saleprice",
    "cardnumber",
    "cvv",
    "cvc",
    "password",
    "secret",
    "token",
    "credential"
]));

class OrderSnapshotRuntimeError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "OrderSnapshotRuntimeError";
        this.code = code;
        this.stage = normalizeString(options.stage);
        this.causeCode = normalizeString(options.causeCode);
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

function assertPlainObject(value, field, code = ORDER_SNAPSHOT_ERROR_CODES.INVALID_ORDER_SNAPSHOT_INPUT) {
    if (!isPlainObject(value)) {
        throw new OrderSnapshotRuntimeError(code, `${field} must be an object.`, {
            stage: "input",
            metadata: { field }
        });
    }
    return value;
}

function boundedString(value, field, code, maxLength = MAX_ID_LENGTH, required = false) {
    const normalized = normalizeString(value);
    if ((required && !normalized) || normalized.length > maxLength) {
        throw new OrderSnapshotRuntimeError(code, `${field} is invalid.`, {
            stage: "input",
            metadata: { field }
        });
    }
    return normalized;
}

function safeId(value, field, code, required = true) {
    const normalized = boundedString(value, field, code, MAX_ID_LENGTH, required);
    if (normalized && !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
        throw new OrderSnapshotRuntimeError(code, `${field} must be public-safe.`, {
            stage: "input",
            metadata: { field }
        });
    }
    return normalized;
}

function canonicalDate(value, field) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new OrderSnapshotRuntimeError(
            field === "checkoutTime" ? ORDER_SNAPSHOT_ERROR_CODES.INVALID_CHECKOUT_TIME : ORDER_SNAPSHOT_ERROR_CODES.INVALID_QUOTE,
            `${field} must be a valid timestamp.`,
            { stage: "input", metadata: { field } }
        );
    }
    return date.toISOString();
}

function finiteNonNegative(value, field) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.INVALID_COMMERCIAL_SNAPSHOT, `${field} must be finite and non-negative.`, {
            stage: "commercial",
            metadata: { field }
        });
    }
    return value;
}

function positiveInteger(value, field) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.INVALID_COMMERCIAL_SNAPSHOT, `${field} must be a positive integer.`, {
            stage: "commercial",
            metadata: { field }
        });
    }
    return numeric;
}

function rejectOverrideFields(value, path = "input", blocked = PROHIBITED_COMMERCIAL_FIELDS) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => rejectOverrideFields(item, `${path}[${index}]`, blocked));
        return;
    }
    Object.entries(value).forEach(([key, child]) => {
        if (blocked.has(normalizeLower(key))) {
            throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "Input contains a prohibited commercial override.", {
                stage: "input",
                metadata: { field: `${path}.${key}` }
            });
        }
        rejectOverrideFields(child, `${path}.${key}`, blocked);
    });
}

function normalizeOwner(owner = {}, field = "owner") {
    assertPlainObject(owner, field, ORDER_SNAPSHOT_ERROR_CODES.INVALID_QUOTE_OWNER);
    return {
        userId: safeId(owner.userId, `${field}.userId`, ORDER_SNAPSHOT_ERROR_CODES.INVALID_QUOTE_OWNER, false),
        sessionId: safeId(owner.sessionId, `${field}.sessionId`, ORDER_SNAPSHOT_ERROR_CODES.INVALID_QUOTE_OWNER, false)
    };
}

function ownerType(owner) {
    if (owner.userId) return "USER";
    if (owner.sessionId) return "SESSION";
    return "";
}

function validateOwnerBinding(quoteOwner, suppliedOwner) {
    if (!quoteOwner.userId && !quoteOwner.sessionId) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.INVALID_QUOTE_OWNER, "Quote owner is missing.", { stage: "owner" });
    }
    if (quoteOwner.userId) {
        if (suppliedOwner.userId !== quoteOwner.userId) {
            throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.OWNER_MISMATCH, "Supplied user owner does not match quote owner.", { stage: "owner" });
        }
        if (quoteOwner.sessionId && suppliedOwner.sessionId && suppliedOwner.sessionId !== quoteOwner.sessionId) {
            throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.OWNER_MISMATCH, "Supplied session owner conflicts with quote owner.", { stage: "owner" });
        }
        return;
    }
    if (suppliedOwner.userId) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.OWNER_MISMATCH, "Session-bound quote cannot become a user order.", { stage: "owner" });
    }
    if (suppliedOwner.sessionId !== quoteOwner.sessionId) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.OWNER_MISMATCH, "Supplied session owner does not match quote owner.", { stage: "owner" });
    }
}

function validateQuote(quote) {
    assertPlainObject(quote, "quote", ORDER_SNAPSHOT_ERROR_CODES.INVALID_QUOTE);
    const quoteId = safeId(quote.quoteId, "quote.quoteId", ORDER_SNAPSHOT_ERROR_CODES.INVALID_QUOTE_ID);
    const owner = normalizeOwner(quote.owner || {}, "quote.owner");
    const packageSnapshot = normalizePackageSnapshot(quote.packageSnapshot || {});
    const commercialSnapshot = normalizeCommercialSnapshot(quote.commercialSnapshot || {}, packageSnapshot);
    const pricingSnapshot = normalizePricingSnapshot(quote.pricingSnapshot);
    const promotionSnapshot = normalizePromotionSnapshot(quote.promotionSnapshot);
    const lifecycle = assertPlainObject(quote.lifecycle || {}, "quote.lifecycle", ORDER_SNAPSHOT_ERROR_CODES.INVALID_QUOTE);
    const issuedAt = canonicalDate(lifecycle.issuedAt, "quote.lifecycle.issuedAt");
    const expiresAt = canonicalDate(lifecycle.expiresAt, "quote.lifecycle.expiresAt");
    return {
        quoteId,
        owner,
        packageSnapshot,
        commercialSnapshot,
        pricingSnapshot,
        promotionSnapshot,
        lifecycle: { issuedAt, expiresAt },
        quoteRuntimeVersion: normalizeString(quote.quoteRuntimeVersion),
        quoteSpecificationVersion: normalizeString(quote.quoteSpecificationVersion),
        payloadVersion: normalizeString(quote.payloadVersion),
        integrityMetadata: isPlainObject(quote.integrityMetadata) ? clonePlain(quote.integrityMetadata) : {}
    };
}

function normalizePackageSnapshot(snapshot = {}) {
    assertPlainObject(snapshot, "quote.packageSnapshot", ORDER_SNAPSHOT_ERROR_CODES.INVALID_PACKAGE_SNAPSHOT);
    const packageId = normalizeString(snapshot.packageId);
    const packageCode = normalizeString(snapshot.packageCode);
    const packageRef = normalizeString(snapshot.packageRef);
    if (!packageId && !packageCode && !packageRef) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.INVALID_PACKAGE_SNAPSHOT, "Package snapshot requires stable identity.", { stage: "package" });
    }
    return {
        gameId: normalizeString(snapshot.gameId),
        gameCode: normalizeString(snapshot.gameCode),
        gameName: normalizeString(snapshot.gameName),
        packageId,
        packageCode,
        packageRef,
        packageName: normalizeString(snapshot.packageName),
        packageType: normalizeString(snapshot.packageType),
        category: normalizeString(snapshot.category || snapshot.categoryCode || snapshot.categoryId),
        categoryId: normalizeString(snapshot.categoryId),
        categoryCode: normalizeString(snapshot.categoryCode),
        fulfilmentSchemaVersion: normalizeString(snapshot.fulfilmentSchemaVersion),
        quantity: positiveInteger(snapshot.quantity || 1, "quote.packageSnapshot.quantity")
    };
}

function normalizeCommercialSnapshot(commercial = {}, packageSnapshot) {
    assertPlainObject(commercial, "quote.commercialSnapshot", ORDER_SNAPSHOT_ERROR_CODES.INVALID_COMMERCIAL_SNAPSHOT);
    if (Object.prototype.hasOwnProperty.call(commercial, "totalAmount") && Object.prototype.hasOwnProperty.call(commercial, "quotedTotalAmount") && Number(commercial.totalAmount) !== Number(commercial.quotedTotalAmount)) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.AMBIGUOUS_MONEY_REPRESENTATION, "Commercial snapshot has conflicting total representations.", { stage: "commercial" });
    }
    const quantity = positiveInteger(commercial.quantity || packageSnapshot.quantity, "quote.commercialSnapshot.quantity");
    if (quantity !== packageSnapshot.quantity) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.AMBIGUOUS_MONEY_REPRESENTATION, "Commercial quantity conflicts with package quantity.", { stage: "commercial" });
    }
    return {
        region: boundedString(commercial.region, "quote.commercialSnapshot.region", ORDER_SNAPSHOT_ERROR_CODES.INVALID_COMMERCIAL_SNAPSHOT, 20, true),
        currency: boundedString(commercial.currency, "quote.commercialSnapshot.currency", ORDER_SNAPSHOT_ERROR_CODES.INVALID_COMMERCIAL_SNAPSHOT, 20, true),
        quantity,
        originalUnitPrice: finiteNonNegative(commercial.originalPrice, "quote.commercialSnapshot.originalPrice"),
        discountAmount: finiteNonNegative(commercial.discountAmount, "quote.commercialSnapshot.discountAmount"),
        quotedUnitPrice: finiteNonNegative(commercial.quotedUnitPrice, "quote.commercialSnapshot.quotedUnitPrice"),
        subtotalAmount: commercial.subtotalAmount === undefined ? null : finiteNonNegative(commercial.subtotalAmount, "quote.commercialSnapshot.subtotalAmount"),
        totalAmount: finiteNonNegative(commercial.quotedTotalAmount ?? commercial.totalAmount, "quote.commercialSnapshot.quotedTotalAmount"),
        promotionAppliesTo: normalizeString(commercial.promotionAppliesTo || "UNIT_PRICE")
    };
}

function normalizePricingSnapshot(snapshot) {
    if (snapshot === undefined || snapshot === null) return {};
    if (!isPlainObject(snapshot)) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.INVALID_PRICING_SNAPSHOT, "Pricing snapshot must be an object.", { stage: "pricing" });
    }
    return clonePlain(snapshot);
}

function selectedPromotionSnapshot(promotionSnapshot) {
    return promotionSnapshot?.selectedPromotion || promotionSnapshot?.promotion || null;
}

function normalizePromotionSnapshot(snapshot) {
    if (snapshot === undefined || snapshot === null) return null;
    if (!isPlainObject(snapshot)) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.INVALID_PROMOTION_SNAPSHOT, "Promotion snapshot must be an object.", { stage: "promotion" });
    }
    return clonePlain(snapshot);
}

function normalizePaymentSnapshot(payment = {}, commercial, policy = {}) {
    assertPlainObject(payment, "paymentSnapshot", ORDER_SNAPSHOT_ERROR_CODES.INVALID_PAYMENT_SNAPSHOT);
    rejectOverrideFields(payment, "paymentSnapshot", PROHIBITED_METADATA_FIELDS);
    rejectOverrideFields(payment.metadata || {}, "paymentSnapshot.metadata", PROHIBITED_METADATA_FIELDS);
    const paymentMethodId = safeId(payment.paymentMethodId, "paymentSnapshot.paymentMethodId", ORDER_SNAPSHOT_ERROR_CODES.INVALID_PAYMENT_SNAPSHOT);
    const requestedStatus = normalizeString(policy.paymentStatus || payment.status);
    const total = Number(commercial.totalAmount);
    if (total > 0 && requestedStatus === "waived") {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.POSITIVE_ORDER_CANNOT_BE_WAIVED, "Positive-value order cannot be payment-waived.", { stage: "status" });
    }
    if (normalizeLower(payment.flowType) === "wallet" && requestedStatus === "paid" && policy.walletDebitCompleted !== true) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.INVALID_STATUS_POLICY, "Wallet payment cannot claim paid without specialised wallet completion policy.", { stage: "status" });
    }
    const defaultStatus = total === 0 ? "waived" : "unpaid";
    const status = requestedStatus || defaultStatus;
    return {
        paymentMethodId,
        paymentChannel: safeId(payment.paymentChannel, "paymentSnapshot.paymentChannel", ORDER_SNAPSHOT_ERROR_CODES.INVALID_PAYMENT_SNAPSHOT, false),
        provider: safeId(payment.provider, "paymentSnapshot.provider", ORDER_SNAPSHOT_ERROR_CODES.INVALID_PAYMENT_SNAPSHOT, false),
        flowType: safeId(payment.flowType, "paymentSnapshot.flowType", ORDER_SNAPSHOT_ERROR_CODES.INVALID_PAYMENT_SNAPSHOT, false),
        nextAction: safeId(payment.nextAction || (total === 0 ? "NO_PAYMENT_REQUIRED" : "OPEN_MANUAL_PAYMENT"), "paymentSnapshot.nextAction", ORDER_SNAPSHOT_ERROR_CODES.INVALID_PAYMENT_SNAPSHOT),
        status,
        paymentMethodBound: payment.paymentMethodBound === true,
        metadata: isPlainObject(payment.metadata) ? clonePlain(payment.metadata) : {}
    };
}

function normalizeScalarRecord(value = {}, field, code, blocked = PROHIBITED_METADATA_FIELDS) {
    if (value === undefined || value === null) return {};
    assertPlainObject(value, field, code);
    const keys = Object.keys(value);
    if (keys.length > MAX_CUSTOM_FIELDS) {
        throw new OrderSnapshotRuntimeError(code, `${field} has too many fields.`, { stage: "input" });
    }
    const normalized = {};
    keys.sort().forEach(key => {
        if (blocked.has(normalizeLower(key))) {
            throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.PROHIBITED_COMMERCIAL_OVERRIDE, "Input contains a prohibited commercial override.", {
                stage: "input",
                metadata: { field: `${field}.${key}` }
            });
        }
        const item = value[key];
        if (item !== null && typeof item === "object") {
            throw new OrderSnapshotRuntimeError(code, `${field}.${key} must be scalar.`, { stage: "input" });
        }
        normalized[boundedString(key, `${field} key`, code, 80, true)] = boundedString(item, `${field}.${key}`, code, MAX_FIELD_LENGTH);
    });
    return normalized;
}

function normalizeFulfilmentInput(input = {}) {
    if (input === undefined || input === null) input = {};
    assertPlainObject(input, "fulfilmentInput", ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT);
    rejectOverrideFields(input, "fulfilmentInput", PROHIBITED_METADATA_FIELDS);
    const accountFields = Array.isArray(input.accountFields)
        ? input.accountFields.slice(0, 20).map((field, index) => {
            assertPlainObject(field, `fulfilmentInput.accountFields.${index}`, ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT);
            return {
                key: boundedString(field.key, `fulfilmentInput.accountFields.${index}.key`, ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT, 80, true),
                label: boundedString(field.label || field.key, `fulfilmentInput.accountFields.${index}.label`, ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT, 120),
                value: boundedString(field.value, `fulfilmentInput.accountFields.${index}.value`, ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT, MAX_FIELD_LENGTH)
            };
        }).filter(field => field.key && field.value)
        : [];
    return {
        userId: boundedString(input.userId, "fulfilmentInput.userId", ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT, 120),
        serverId: boundedString(input.serverId, "fulfilmentInput.serverId", ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT, 120),
        zoneId: boundedString(input.zoneId, "fulfilmentInput.zoneId", ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT, 120),
        playerName: boundedString(input.playerName, "fulfilmentInput.playerName", ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT, 160),
        customFields: normalizeScalarRecord(input.customFields || {}, "fulfilmentInput.customFields", ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT),
        accountFields
    };
}

function normalizeContact(contact = {}) {
    if (contact === undefined || contact === null) return {};
    assertPlainObject(contact, "contact", ORDER_SNAPSHOT_ERROR_CODES.INVALID_CONTACT_INPUT);
    rejectOverrideFields(contact, "contact", PROHIBITED_METADATA_FIELDS);
    return {
        email: boundedString(contact.email, "contact.email", ORDER_SNAPSHOT_ERROR_CODES.INVALID_CONTACT_INPUT, 254).toLowerCase(),
        phone: boundedString(contact.phone, "contact.phone", ORDER_SNAPSHOT_ERROR_CODES.INVALID_CONTACT_INPUT, 80)
    };
}

function normalizeMetadata(metadata = {}) {
    if (metadata === undefined || metadata === null) return {};
    assertPlainObject(metadata, "requestMetadata", ORDER_SNAPSHOT_ERROR_CODES.INVALID_REQUEST_METADATA);
    rejectOverrideFields(metadata, "requestMetadata", PROHIBITED_METADATA_FIELDS);
    return {
        traceId: boundedString(metadata.traceId, "requestMetadata.traceId", ORDER_SNAPSHOT_ERROR_CODES.INVALID_REQUEST_METADATA, MAX_METADATA_LENGTH),
        source: boundedString(metadata.source, "requestMetadata.source", ORDER_SNAPSHOT_ERROR_CODES.INVALID_REQUEST_METADATA, MAX_METADATA_LENGTH),
        ipHash: boundedString(metadata.ipHash, "requestMetadata.ipHash", ORDER_SNAPSHOT_ERROR_CODES.INVALID_REQUEST_METADATA, MAX_METADATA_LENGTH),
        userAgentHash: boundedString(metadata.userAgentHash, "requestMetadata.userAgentHash", ORDER_SNAPSHOT_ERROR_CODES.INVALID_REQUEST_METADATA, MAX_METADATA_LENGTH)
    };
}

function normalizePolicy(policy = {}) {
    if (policy === undefined || policy === null) return {};
    assertPlainObject(policy, "policy", ORDER_SNAPSHOT_ERROR_CODES.INVALID_STATUS_POLICY);
    rejectOverrideFields(policy, "policy", PROHIBITED_METADATA_FIELDS);
    return {
        orderStatus: boundedString(policy.orderStatus, "policy.orderStatus", ORDER_SNAPSHOT_ERROR_CODES.INVALID_STATUS_POLICY, 80),
        paymentStatus: boundedString(policy.paymentStatus, "policy.paymentStatus", ORDER_SNAPSHOT_ERROR_CODES.INVALID_STATUS_POLICY, 80),
        fulfilmentStatus: boundedString(policy.fulfilmentStatus, "policy.fulfilmentStatus", ORDER_SNAPSHOT_ERROR_CODES.INVALID_STATUS_POLICY, 80),
        zeroPriceAllowed: policy.zeroPriceAllowed === true,
        walletDebitCompleted: policy.walletDebitCompleted === true
    };
}

function normalizeInput(input) {
    assertPlainObject(input, "input");
    rejectOverrideFields({
        extra: Object.fromEntries(Object.entries(input).filter(([key]) => ![
            "orderId",
            "checkoutId",
            "checkoutTime",
            "quote",
            "owner",
            "idempotencyKey",
            "requestFingerprint",
            "paymentSnapshot",
            "fulfilmentInput",
            "contact",
            "notes",
            "requestMetadata",
            "policy",
            "promotionRedemptionSnapshot",
            "idempotencyKeyHash"
        ].includes(key)))
    });
    const orderId = safeId(input.orderId, "orderId", ORDER_SNAPSHOT_ERROR_CODES.INVALID_ORDER_ID);
    const checkoutId = safeId(input.checkoutId, "checkoutId", ORDER_SNAPSHOT_ERROR_CODES.INVALID_CHECKOUT_ID);
    const checkoutTime = canonicalDate(input.checkoutTime, "checkoutTime");
    const idempotencyKey = boundedString(input.idempotencyKey || input.idempotencyKeyHash, "idempotencyKey", ORDER_SNAPSHOT_ERROR_CODES.INVALID_IDEMPOTENCY_KEY, 4000, true);
    const requestFingerprint = boundedString(input.requestFingerprint, "requestFingerprint", ORDER_SNAPSHOT_ERROR_CODES.INVALID_REQUEST_FINGERPRINT, 4000, true);
    const quote = validateQuote(input.quote);
    const owner = normalizeOwner(input.owner || {}, "owner");
    validateOwnerBinding(quote.owner, owner);
    const policy = normalizePolicy(input.policy || {});
    const commercial = quote.commercialSnapshot;
    if (Number(commercial.totalAmount) === 0 && policy.zeroPriceAllowed !== true) {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.ZERO_PRICE_NOT_ALLOWED, "Zero-price order requires explicit policy permission.", { stage: "status" });
    }
    return {
        orderId,
        checkoutId,
        checkoutTime,
        quote,
        owner,
        idempotencyKey,
        requestFingerprint,
        paymentSnapshot: normalizePaymentSnapshot(input.paymentSnapshot || {}, commercial, policy),
        fulfilmentInput: normalizeFulfilmentInput(input.fulfilmentInput || {}),
        contact: normalizeContact(input.contact || {}),
        notes: boundedString(input.notes, "notes", ORDER_SNAPSHOT_ERROR_CODES.INVALID_ORDER_SNAPSHOT_INPUT, MAX_FIELD_LENGTH),
        requestMetadata: normalizeMetadata(input.requestMetadata || {}),
        policy,
        promotionRedemptionSnapshot: input.promotionRedemptionSnapshot === undefined ? null : clonePlain(input.promotionRedemptionSnapshot)
    };
}

function validateOrderSnapshotInput(input) {
    return deepFreeze(normalizeInput(input));
}

function buildPromotion(promotionSnapshot) {
    const selected = selectedPromotionSnapshot(promotionSnapshot);
    if (!selected) return null;
    return {
        promotionId: normalizeString(selected.promotionId || selected.id || selected._id),
        code: normalizeString(selected.code),
        name: normalizeString(selected.name),
        promotionType: normalizeString(selected.promotionType || selected.type),
        benefitSnapshot: clonePlain(selected.benefitSnapshot || selected.benefit || {}),
        campaignId: normalizeString(selected.campaignId),
        eligibilityVersion: normalizeString(selected.eligibilityVersion),
        discountAmount: selected.discountAmount === undefined ? null : selected.discountAmount
    };
}

function buildPricing(pricingSnapshot) {
    const version = pricingSnapshot.versionContext || pricingSnapshot.priceVersion || {};
    return {
        calculationVersion: normalizeString(pricingSnapshot.calculationVersion || pricingSnapshot.engineVersion),
        priceVersionId: normalizeString(pricingSnapshot.priceVersionId || version.priceVersionId),
        priceVersionNumber: pricingSnapshot.priceVersionNumber || version.priceVersionNumber || null,
        branchKey: normalizeString(pricingSnapshot.branchKey || version.branchKey),
        pricingRuleSnapshot: clonePlain(pricingSnapshot.pricingRuleSnapshot || pricingSnapshot.appliedPricingRules || []),
        exchangeSnapshot: clonePlain(pricingSnapshot.exchangeSnapshot || pricingSnapshot.exchangeRate || null),
        feeSnapshot: clonePlain(pricingSnapshot.feeSnapshot || pricingSnapshot.fees || null),
        taxSnapshot: clonePlain(pricingSnapshot.taxSnapshot || pricingSnapshot.tax || null),
        roundingSnapshot: clonePlain(pricingSnapshot.roundingSnapshot || pricingSnapshot.rounding || null)
    };
}

function statusPolicy(commercial, policy, paymentSnapshot) {
    if (Number(commercial.totalAmount) === 0) {
        return {
            status: policy.orderStatus || "paid",
            paymentStatus: policy.paymentStatus || "waived",
            fulfilmentStatus: policy.fulfilmentStatus || "not_started",
            nextAction: "NO_PAYMENT_REQUIRED"
        };
    }
    if (paymentSnapshot.status === "paid") {
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.POSITIVE_ORDER_CANNOT_BE_WAIVED, "Positive-value order cannot start as paid.", { stage: "status" });
    }
    return {
        status: policy.orderStatus || "pending_payment",
        paymentStatus: policy.paymentStatus || paymentSnapshot.status || "unpaid",
        fulfilmentStatus: policy.fulfilmentStatus || "not_started",
        nextAction: paymentSnapshot.nextAction
    };
}

function createOrderSnapshot(input) {
    try {
        const normalized = normalizeInput(input);
        const quote = normalized.quote;
        const product = quote.packageSnapshot;
        const commercial = quote.commercialSnapshot;
        const pricing = buildPricing(quote.pricingSnapshot);
        const promotion = buildPromotion(quote.promotionSnapshot);
        const statuses = statusPolicy(commercial, normalized.policy, normalized.paymentSnapshot);
        const owner = {
            type: ownerType(quote.owner),
            userId: quote.owner.userId || undefined,
            sessionId: quote.owner.sessionId || undefined
        };
        const snapshot = {
            schemaVersion: ORDER_SNAPSHOT_SCHEMA_VERSION,
            runtimeVersion: ORDER_SNAPSHOT_RUNTIME_VERSION,
            specificationVersion: ORDER_SNAPSHOT_SPECIFICATION_VERSION,
            orderId: normalized.orderId,
            quoteId: quote.quoteId,
            checkoutId: normalized.checkoutId,
            commerce: {
                source: "QUOTE_CHECKOUT",
                version: ORDER_SNAPSHOT_RUNTIME_VERSION
            },
            owner,
            product: {
                gameId: product.gameId,
                gameCode: product.gameCode,
                gameName: product.gameName,
                packageId: product.packageId,
                packageCode: product.packageCode,
                packageRef: product.packageRef,
                packageName: product.packageName,
                packageType: product.packageType,
                category: product.category,
                categoryId: product.categoryId,
                categoryCode: product.categoryCode,
                region: commercial.region,
                quantity: commercial.quantity,
                fulfilmentSchemaVersion: product.fulfilmentSchemaVersion
            },
            fulfilment: {
                input: clonePlain(normalized.fulfilmentInput),
                status: statuses.fulfilmentStatus
            },
            customer: {
                contact: clonePlain(normalized.contact),
                notes: normalized.notes
            },
            commercial: {
                currency: commercial.currency,
                region: commercial.region,
                quantity: commercial.quantity,
                originalUnitPrice: commercial.originalUnitPrice,
                discountAmount: commercial.discountAmount,
                quotedUnitPrice: commercial.quotedUnitPrice,
                subtotalAmount: commercial.subtotalAmount,
                totalAmount: commercial.totalAmount,
                promotionAppliesTo: commercial.promotionAppliesTo
            },
            pricing,
            promotion,
            payment: {
                ...clonePlain(normalized.paymentSnapshot),
                status: statuses.paymentStatus,
                nextAction: statuses.nextAction
            },
            checkout: {
                idempotencyKeyHash: normalized.idempotencyKey,
                idempotencyKey: normalized.idempotencyKey,
                requestFingerprint: normalized.requestFingerprint,
                checkedOutAt: normalized.checkoutTime,
                traceId: normalized.requestMetadata.traceId,
                source: normalized.requestMetadata.source,
                ipHash: normalized.requestMetadata.ipHash,
                userAgentHash: normalized.requestMetadata.userAgentHash
            },
            quoteMetadata: {
                quoteRuntimeVersion: quote.quoteRuntimeVersion,
                quoteSpecificationVersion: quote.quoteSpecificationVersion,
                payloadVersion: quote.payloadVersion,
                pricingVersion: pricing.priceVersionId,
                promotionResolverVersion: normalizeString(quote.promotionSnapshot?.resolverVersion),
                issuedAt: quote.lifecycle.issuedAt,
                expiresAt: quote.lifecycle.expiresAt,
                integrityHash: normalizeString(quote.integrityMetadata?.canonicalHash),
                integrityAlgorithm: normalizeString(quote.integrityMetadata?.algorithm)
            },
            quoteSnapshot: {
                quoteId: quote.quoteId,
                quoteRuntimeVersion: quote.quoteRuntimeVersion,
                quoteSpecificationVersion: quote.quoteSpecificationVersion,
                payloadVersion: quote.payloadVersion,
                owner: clonePlain(quote.owner),
                packageSnapshot: clonePlain(quote.packageSnapshot),
                commercialSnapshot: clonePlain(input.quote.commercialSnapshot),
                pricingSnapshot: clonePlain(input.quote.pricingSnapshot || {}),
                promotionSnapshot: clonePlain(input.quote.promotionSnapshot || null),
                lifecycle: clonePlain(input.quote.lifecycle || {}),
                integrityMetadata: clonePlain(input.quote.integrityMetadata || {})
            },
            status: statuses.status,
            paymentStatus: statuses.paymentStatus,
            checkoutIdempotencyKeyHash: normalized.idempotencyKey,
            checkoutFingerprint: normalized.requestFingerprint,
            checkedOutAt: normalized.checkoutTime,
            createdAt: normalized.checkoutTime,
            updatedAt: normalized.checkoutTime,
            promotionRedemptionSnapshot: normalized.promotionRedemptionSnapshot,
            packageSnapshot: clonePlain(input.quote.packageSnapshot),
            commercialSnapshot: clonePlain(input.quote.commercialSnapshot),
            promotionSnapshot: clonePlain(input.quote.promotionSnapshot || null)
        };
        return deepFreeze(snapshot);
    } catch (error) {
        if (error instanceof OrderSnapshotRuntimeError) throw error;
        throw new OrderSnapshotRuntimeError(ORDER_SNAPSHOT_ERROR_CODES.ORDER_SNAPSHOT_CREATION_FAILED, "Order snapshot creation failed.", {
            stage: "snapshot",
            causeCode: error?.code || "",
            metadata: { message: error?.message || "" }
        });
    }
}

function toOrderSnapshotPayload(snapshot) {
    assertPlainObject(snapshot, "snapshot", ORDER_SNAPSHOT_ERROR_CODES.INVALID_ORDER_SNAPSHOT_INPUT);
    return clonePlain(snapshot);
}

module.exports = Object.freeze({
    createOrderSnapshot,
    validateOrderSnapshotInput,
    toOrderSnapshotPayload,
    OrderSnapshotRuntimeError,
    ORDER_SNAPSHOT_ERROR_CODES,
    ORDER_SNAPSHOT_RUNTIME_VERSION,
    ORDER_SNAPSHOT_SPECIFICATION_VERSION,
    ORDER_SNAPSHOT_SCHEMA_VERSION
});
