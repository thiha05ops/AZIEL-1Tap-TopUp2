"use strict";

const { createPayableSubjectRegistry, UnsupportedPayableSubjectError, SUBJECT_TYPES } = require("./payableSubjectRegistry");
const { createCommerceOrderPayableSubjectAdapter } = require("./commerceOrderPayableSubjectAdapter");
const { createWalletTopupPayableSubjectAdapter } = require("./walletTopupPayableSubjectAdapter");
const { reconcileCommercePromotionForPayment } = require("./commercePromotionBridgeService");

const PAYMENT_ORCHESTRATOR_VERSION = "2.6.1";
const MAX_ID_LENGTH = 200;

const PAYMENT_STATES = Object.freeze({
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

const ORDER_PAYMENT_STATUS = Object.freeze({
    UNPAID: "unpaid",
    PENDING: "pending",
    PAID: "paid",
    FAILED: "failed",
    EXPIRED: "expired",
    CANCELLED: "cancelled",
    WAIVED: "waived",
    REFUNDED: "refunded"
});

const ACTIVE_ATTEMPT_STATES = Object.freeze(new Set([
    PAYMENT_STATES.INITIATING,
    PAYMENT_STATES.PENDING
]));

const TERMINAL_ATTEMPT_STATES = Object.freeze(new Set([
    PAYMENT_STATES.PAID,
    PAYMENT_STATES.FAILED,
    PAYMENT_STATES.EXPIRED,
    PAYMENT_STATES.CANCELLED,
    PAYMENT_STATES.WAIVED,
    PAYMENT_STATES.REFUNDED
]));

const TRANSITIONS = Object.freeze({
    [PAYMENT_STATES.UNPAID]: Object.freeze([PAYMENT_STATES.INITIATING, PAYMENT_STATES.WAIVED]),
    [PAYMENT_STATES.INITIATING]: Object.freeze([
        PAYMENT_STATES.PENDING,
        PAYMENT_STATES.PAID,
        PAYMENT_STATES.FAILED,
        PAYMENT_STATES.EXPIRED,
        PAYMENT_STATES.CANCELLED
    ]),
    [PAYMENT_STATES.PENDING]: Object.freeze([
        PAYMENT_STATES.PAID,
        PAYMENT_STATES.FAILED,
        PAYMENT_STATES.EXPIRED,
        PAYMENT_STATES.CANCELLED
    ]),
    [PAYMENT_STATES.FAILED]: Object.freeze([PAYMENT_STATES.INITIATING, PAYMENT_STATES.CANCELLED]),
    [PAYMENT_STATES.EXPIRED]: Object.freeze([]),
    [PAYMENT_STATES.CANCELLED]: Object.freeze([]),
    [PAYMENT_STATES.PAID]: Object.freeze([PAYMENT_STATES.REFUNDED]),
    [PAYMENT_STATES.WAIVED]: Object.freeze([]),
    [PAYMENT_STATES.REFUNDED]: Object.freeze([])
});

const ERROR_CODES = Object.freeze({
    PAYMENT_VALIDATION_ERROR: "PAYMENT_VALIDATION_ERROR",
    PAYMENT_ORDER_NOT_FOUND: "PAYMENT_ORDER_NOT_FOUND",
    PAYMENT_FORBIDDEN: "PAYMENT_FORBIDDEN",
    PAYMENT_NOT_PAYABLE: "PAYMENT_NOT_PAYABLE",
    PAYMENT_PROVIDER_UNAVAILABLE: "PAYMENT_PROVIDER_UNAVAILABLE",
    PAYMENT_PROVIDER_UNSUPPORTED: "PAYMENT_PROVIDER_UNSUPPORTED",
    PAYMENT_PROVIDER_ERROR: "PAYMENT_PROVIDER_ERROR",
    PAYMENT_PROVIDER_RESULT_INVALID: "PAYMENT_PROVIDER_RESULT_INVALID",
    PAYMENT_AMOUNT_MISMATCH: "PAYMENT_AMOUNT_MISMATCH",
    PAYMENT_CURRENCY_MISMATCH: "PAYMENT_CURRENCY_MISMATCH",
    PAYMENT_ORDER_BINDING_MISMATCH: "PAYMENT_ORDER_BINDING_MISMATCH",
    PAYMENT_INVALID_TRANSITION: "PAYMENT_INVALID_TRANSITION",
    PAYMENT_IDEMPOTENCY_CONFLICT: "PAYMENT_IDEMPOTENCY_CONFLICT",
    PAYMENT_ATTEMPT_CONFLICT: "PAYMENT_ATTEMPT_CONFLICT",
    PAYMENT_RETRY_NOT_ALLOWED: "PAYMENT_RETRY_NOT_ALLOWED",
    PAYMENT_EVENT_DUPLICATE: "PAYMENT_EVENT_DUPLICATE",
    PAYMENT_EVENT_NOT_FOUND: "PAYMENT_EVENT_NOT_FOUND",
    PAYMENT_OUTCOME_UNKNOWN: "PAYMENT_OUTCOME_UNKNOWN",
    PAYMENT_PERSISTENCE_ERROR: "PAYMENT_PERSISTENCE_ERROR",
    PAYMENT_SUBJECT_UNSUPPORTED: "PAYMENT_SUBJECT_UNSUPPORTED",
    PAYMENT_SUBJECT_NOT_FOUND: "PAYMENT_SUBJECT_NOT_FOUND"
});

class PaymentOrchestratorError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "PaymentOrchestratorError";
        this.code = code;
        this.stage = normalizeString(options.stage);
        this.retryable = options.retryable === true;
        this.causeCode = normalizeString(options.causeCode);
        this.metadata = deepFreeze(clonePlain(options.metadata || {}));
    }
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}

function clonePlain(value) {
    if (value === undefined) return undefined;
    return structuredClone(value);
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return value;
}

function normalizeString(value) {
    return String(value || "").trim();
}

function textOwnerId(value) {
    return normalizeString(value?._id || value);
}

function assertPlainObject(value, field) {
    if (!isPlainObject(value)) {
        throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_VALIDATION_ERROR, `${field} must be an object.`, {
            stage: "input",
            metadata: { field }
        });
    }
    return value;
}

function normalizeId(value, field, required = true) {
    const normalized = normalizeString(value);
    if ((required && !normalized) || normalized.length > MAX_ID_LENGTH || (normalized && !/^[A-Za-z0-9._:-]+$/.test(normalized))) {
        throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_VALIDATION_ERROR, `${field} is invalid.`, {
            stage: "input",
            metadata: { field }
        });
    }
    return normalized;
}

function normalizeOwner(owner = {}, required = true) {
    assertPlainObject(owner, "owner");
    const userId = normalizeId(owner.userId, "owner.userId", false);
    const sessionId = normalizeId(owner.sessionId, "owner.sessionId", false);
    if (required && !userId && !sessionId) {
        throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_FORBIDDEN, "Owner identity is required.", { stage: "input" });
    }
    return { userId, sessionId, type: userId ? "USER" : "SESSION" };
}

function normalizeSubjectReference(source = {}) {
    const explicitType = normalizeString(source.subjectType).toUpperCase();
    const subjectType = explicitType || SUBJECT_TYPES.COMMERCE_ORDER;
    const orderId = normalizeId(source.orderId, "orderId", false);
    const subjectId = normalizeId(source.subjectId || orderId, "subjectId", true);
    if (subjectType === SUBJECT_TYPES.COMMERCE_ORDER && orderId && subjectId !== orderId) {
        throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_VALIDATION_ERROR, "Commerce order subjectId must match orderId.", {
            stage: "input",
            metadata: { subjectType, subjectId, orderId }
        });
    }
    return { subjectType, subjectId, orderId: subjectType === SUBJECT_TYPES.COMMERCE_ORDER ? (orderId || subjectId) : orderId };
}

function normalizeState(value, fallback = PAYMENT_STATES.UNPAID) {
    const raw = normalizeString(value || fallback).replace(/-/g, "_").toUpperCase();
    return PAYMENT_STATES[raw] || fallback;
}

function toOrderPaymentStatus(state) {
    return ORDER_PAYMENT_STATUS[normalizeState(state)] || ORDER_PAYMENT_STATUS.UNPAID;
}

function amountFromOrder(order = {}) {
    return Number(order.commercial?.totalAmount ?? order.commercialSnapshot?.totalAmount ?? order.pricing?.totalAmount ?? 0);
}

function currencyFromOrder(order = {}) {
    return normalizeString(order.commercial?.currency || order.commercialSnapshot?.currency || order.pricing?.currency).toUpperCase();
}

function paymentSnapshotFromOrder(order = {}) {
    return clonePlain(order.payment || order.paymentSnapshot || {});
}

function paymentStateOfOrder(order = {}) {
    return normalizeState(order.paymentStatus || order.payment?.status || PAYMENT_STATES.UNPAID);
}

function assertTransition(fromState, toState, options = {}) {
    const from = normalizeState(fromState);
    const to = normalizeState(toState);
    if (from === to) return { from, to, idempotent: true };
    if (Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to)) {
        return { from, to, idempotent: false };
    }
    if (options.allowLatePaymentReconciliation === true && from === PAYMENT_STATES.EXPIRED && to === PAYMENT_STATES.PAID) {
        return { from, to, idempotent: false, lateReconciliation: true };
    }
    throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_INVALID_TRANSITION, "Payment state transition is not allowed.", {
        stage: "state",
        metadata: { fromState: from, toState: to }
    });
}

function assertProviderFunction(provider, label) {
    if (typeof provider !== "function") {
        throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_VALIDATION_ERROR, `${label} dependency is required.`, {
            stage: "dependencies",
            metadata: { dependency: label }
        });
    }
    return provider;
}

function assertPortFunction(port, name) {
    if (!port || typeof port[name] !== "function") {
        throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_VALIDATION_ERROR, `paymentAttemptPort.${name} is required.`, {
            stage: "dependencies",
            metadata: { dependency: `paymentAttemptPort.${name}` }
        });
    }
    return port[name].bind(port);
}

function normalizeProviderResult(result = {}, context = {}) {
    assertPlainObject(result, "providerResult");
    const status = normalizeState(result.status || result.paymentStatus || result.providerStatus, "");
    if (!Object.values(PAYMENT_STATES).includes(status) || status === PAYMENT_STATES.UNPAID || status === PAYMENT_STATES.INITIATING) {
        throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_PROVIDER_RESULT_INVALID, "Provider returned an invalid payment status.", {
            stage: "provider",
            metadata: { status: result.status || result.paymentStatus || result.providerStatus || "" }
        });
    }
    const amount = result.amount == null ? null : Number(result.amount);
    const providerPayableAmountSatang = result.providerPayableAmountSatang == null ? null : Number(result.providerPayableAmountSatang);
    const providerPayableAmount = result.providerPayableAmount == null ? null : Number(result.providerPayableAmount);
    const currency = result.currency == null ? "" : normalizeString(result.currency).toUpperCase();
    const orderId = normalizeString(result.orderId || result.orderBinding?.orderId || result.safeMetadata?.orderId);
    if (amount != null && Number.isFinite(context.amount) && amount !== Number(context.amount)) {
        throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_AMOUNT_MISMATCH, "Provider amount does not match order amount.", { stage: "provider" });
    }
    if (currency && context.currency && currency !== context.currency) {
        throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_CURRENCY_MISMATCH, "Provider currency does not match order currency.", { stage: "provider" });
    }
    if (orderId && context.orderId && orderId !== context.orderId) {
        throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_ORDER_BINDING_MISMATCH, "Provider order binding does not match order.", { stage: "provider" });
    }
    if ((providerPayableAmountSatang == null) !== (providerPayableAmount == null) ||
        (providerPayableAmountSatang != null && (!Number.isSafeInteger(providerPayableAmountSatang) || providerPayableAmountSatang <= 0 || !Number.isFinite(providerPayableAmount) || providerPayableAmount !== providerPayableAmountSatang / 100))) {
        throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_PROVIDER_RESULT_INVALID, "Provider returned an invalid payable amount.", { stage: "provider" });
    }
    return deepFreeze({
        provider: normalizeString(result.provider || context.provider),
        providerReference: normalizeString(result.providerReference || result.providerTransactionId || ""),
        providerTransactionId: normalizeString(result.providerTransactionId || result.providerReference || ""),
        status,
        amount,
        providerPayableAmountSatang,
        providerPayableAmount,
        currency,
        expiresAt: result.expiresAt || null,
        paymentInstructions: clonePlain(result.paymentInstructions || result.customerInstructions || null),
        redirect: clonePlain(result.redirect || null),
        qr: clonePlain(result.qr || null),
        failure: clonePlain(result.failure || null),
        safeMetadata: clonePlain(result.safeMetadata || {}),
        rawProviderStatus: normalizeString(result.rawProviderStatus || result.providerStatus)
    });
}

function fingerprintIntent(intent) {
    return JSON.stringify({
        orderId: intent.orderId,
        quoteId: intent.quoteId,
        amount: intent.amount,
        currency: intent.currency,
        paymentMethodId: intent.paymentMethodId,
        paymentChannel: intent.paymentChannel,
        provider: intent.provider,
        providerType: intent.providerType
    });
}

function detachAttempt(value) {
    return value ? clonePlain(value) : null;
}

function publicStatus(value) {
    return normalizeState(value || PAYMENT_STATES.UNPAID).toLowerCase();
}

function buildPublicResult(value = {}) {
    const attempt = value.attempt || value;
    const order = value.order || {};
    const amount = Number(attempt.amount ?? amountFromOrder(order));
    const currency = normalizeString(attempt.currency || currencyFromOrder(order)).toUpperCase();
    return deepFreeze({
        paymentOrchestratorVersion: PAYMENT_ORCHESTRATOR_VERSION,
        subjectType: normalizeString(attempt.subjectType || value.subjectType || (attempt.orderId || order.orderId ? SUBJECT_TYPES.COMMERCE_ORDER : "")),
        subjectId: normalizeString(attempt.subjectId || value.subjectId || attempt.orderId || order.orderId),
        orderId: normalizeString(attempt.orderId || order.orderId),
        attemptId: normalizeString(attempt.attemptId),
        paymentStatus: publicStatus(attempt.status || attempt.paymentStatus || order.paymentStatus),
        provider: normalizeString(attempt.providerDisplay || attempt.provider || order.payment?.provider || ""),
        amount,
        commerceAmount: amount,
        providerPayableAmountSatang: attempt.providerPayableAmountSatang ?? null,
        providerPayableAmount: attempt.providerPayableAmount ?? null,
        currency,
        expiresAt: attempt.expiresAt || null,
        paymentInstructions: clonePlain(attempt.paymentInstructions || attempt.customerInstructions || null),
        qr: clonePlain(attempt.qr || null),
        redirect: clonePlain(attempt.redirect || null),
        retryEligible: Boolean(value.retryEligible),
        idempotent: value.idempotent === true,
        failure: attempt.failure ? {
            code: normalizeString(attempt.failure.code || ERROR_CODES.PAYMENT_PROVIDER_ERROR),
            message: normalizeString(attempt.failure.safeMessage || attempt.failure.message || "Payment could not be completed.")
        } : null,
        createdAt: attempt.createdAt || null,
        updatedAt: attempt.updatedAt || null,
        metadata: {
            outcome: normalizeString(value.outcome || ""),
            duplicate: value.duplicate === true
        }
    });
}

function attemptHasProviderEvent(attempt = {}, eventId = "") {
    const id = normalizeString(eventId);
    if (!id) return false;
    const legacyEvents = Array.isArray(attempt.webhookEvents) ? attempt.webhookEvents : [];
    const providerEvents = Array.isArray(attempt.eventHistory) ? attempt.eventHistory : [];
    return [...legacyEvents, ...providerEvents].some(event => normalizeString(event.providerEventId) === id);
}

function createPaymentOrchestrator(dependencies = {}) {
    const deps = {
        orderRepository: dependencies.orderRepository || {},
        paymentAttemptPort: dependencies.paymentAttemptPort || {},
        providerResolver: dependencies.providerResolver,
        transactionRunner: dependencies.transactionRunner || (async callback => callback({})),
        clock: dependencies.clock || (() => new Date()),
        idGenerator: dependencies.idGenerator || (() => `PAY_${Date.now()}_${Math.random().toString(16).slice(2)}`),
        logger: dependencies.logger || console,
        paidFulfillmentHandler: dependencies.paidFulfillmentHandler || null,
        paidFulfillmentFailureRecorder: dependencies.paidFulfillmentFailureRecorder || null,
        paidSettlementHandler: dependencies.paidSettlementHandler || null,
        walletTopupSettlementHandler: dependencies.walletTopupSettlementHandler || null,
        couponReconciliationHandler: dependencies.couponReconciliationHandler || reconcileCommercePromotionForPayment,
        allowLatePaymentReconciliation: dependencies.allowLatePaymentReconciliation === true
    };
    assertProviderFunction(deps.providerResolver, "providerResolver");
    assertProviderFunction(deps.transactionRunner, "transactionRunner");

    const commerceOrderAdapter = createCommerceOrderPayableSubjectAdapter({
        orderRepository: deps.orderRepository,
        clock: deps.clock,
        paymentStateOf: paymentStateOfOrder,
        toOrderPaymentStatus,
        paymentStates: PAYMENT_STATES,
        error: (code, message, options) => new PaymentOrchestratorError(code, message, options)
    });
    const walletTopupAdapter = createWalletTopupPayableSubjectAdapter({
        model: dependencies.walletTopupModel,
        clock: deps.clock,
        error: (code, message, options) => new PaymentOrchestratorError(code, message, options)
    });
    const subjectRegistry = dependencies.payableSubjectRegistry || createPayableSubjectRegistry({
        [SUBJECT_TYPES.COMMERCE_ORDER]: commerceOrderAdapter,
        [SUBJECT_TYPES.WALLET_TOPUP]: walletTopupAdapter
    });

    function resolveSubjectAdapter(subjectType) {
        try {
            return subjectRegistry.get(subjectType);
        } catch (error) {
            if (!(error instanceof UnsupportedPayableSubjectError) && error?.code !== ERROR_CODES.PAYMENT_SUBJECT_UNSUPPORTED) throw error;
            throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_SUBJECT_UNSUPPORTED, "Payable subject type is not supported.", {
                stage: "subject",
                metadata: { subjectType }
            });
        }
    }

    async function runTransaction(callback, existingContext = null) {
        if (existingContext) return callback(existingContext);
        return deps.transactionRunner(callback);
    }

    async function loadOwnedSubject({ subjectReference, owner, transactionContext = null }) {
        const adapter = resolveSubjectAdapter(subjectReference.subjectType);
        const subject = await adapter.loadOwnedSubject({ subjectId: subjectReference.subjectId, owner, session: transactionContext });
        return { adapter, subject, subjectReference };
    }

    async function loadOperationalSubject({ subjectReference, transactionContext = null }) {
        const adapter = resolveSubjectAdapter(subjectReference.subjectType);
        const subject = await adapter.loadOperationalSubject({ subjectId: subjectReference.subjectId, session: transactionContext });
        return { adapter, subject, subjectReference };
    }

    async function runPostCommitPaidFulfillment(applied = {}) {
        if (typeof deps.paidFulfillmentHandler !== "function") return null;
        if (normalizeState(applied.attempt?.status) !== PAYMENT_STATES.PAID) return null;
        const orderId = normalizeString(applied.order?.orderId || applied.attempt?.orderId);
        if (!orderId) return null;

        let committedOrder;
        let result;
        try {
            ({ subject: committedOrder } = await loadOperationalSubject({
                subjectReference: { subjectType: SUBJECT_TYPES.COMMERCE_ORDER, subjectId: orderId, orderId }
            }));
            if (normalizeString(committedOrder.status).toLowerCase() !== "paid" || paymentStateOfOrder(committedOrder) !== PAYMENT_STATES.PAID) {
                result = { created: false, reason: "POST_COMMIT_ORDER_NOT_PAID", errorCode: "POST_COMMIT_ORDER_NOT_PAID" };
            } else {
                result = await deps.paidFulfillmentHandler(committedOrder);
            }
        } catch (error) {
            result = {
                created: false,
                reason: "PAID_FULFILLMENT_POST_COMMIT_FAILED",
                errorCode: normalizeString(error?.code || error?.name || "PAID_FULFILLMENT_POST_COMMIT_FAILED")
            };
        }

        const failed = result?.reason === "SUPPLIER_FULFILLMENT_START_FAILED" || result?.reason === "NO_AUTHORIZED_FULFILLMENT_ROUTE" || result?.reason === "PAID_FULFILLMENT_POST_COMMIT_FAILED" || result?.reason === "POST_COMMIT_ORDER_NOT_PAID";
        if (failed) {
            deps.logger.error?.("Paid fulfillment post-commit start failed.", {
                orderId,
                reason: result.reason,
                errorCode: normalizeString(result.errorCode)
            });
            if (typeof deps.paidFulfillmentFailureRecorder === "function") {
                await Promise.resolve(deps.paidFulfillmentFailureRecorder({
                    order: committedOrder || applied.order,
                    orderId,
                    reason: result.reason,
                    errorCode: normalizeString(result.errorCode),
                    changedAt: deps.clock()
                })).catch(error => deps.logger.error?.("Paid fulfillment failure recording failed.", {
                    orderId,
                    errorCode: normalizeString(error?.code || error?.name)
                }));
            }
        }
        return result;
    }

    async function runPostCommitPaidSettlement(applied = {}) {
        if (typeof deps.paidSettlementHandler !== "function") return null;
        if (normalizeState(applied.attempt?.status) !== PAYMENT_STATES.PAID) return null;
        const orderId = normalizeString(applied.order?.orderId || applied.attempt?.orderId);
        if (!orderId) return null;
        try {
            const { subject: committedOrder } = await loadOperationalSubject({
                subjectReference: { subjectType: SUBJECT_TYPES.COMMERCE_ORDER, subjectId: orderId, orderId }
            });
            return await deps.paidSettlementHandler(committedOrder);
        } catch (error) {
            deps.logger.error?.("Paid payment settlement post-commit failed.", {
                orderId,
                errorCode: normalizeString(error?.code || error?.name || "PAID_SETTLEMENT_FAILED")
            });
            return { settled: false, reason: "PAID_SETTLEMENT_FAILED" };
        }
    }

    async function runPostCommitPaidEffects(applied = {}) {
        if (normalizeState(applied.attempt?.status) !== PAYMENT_STATES.PAID) return null;
        const subjectType = normalizeString(applied.attempt?.subjectType || (applied.attempt?.orderId ? SUBJECT_TYPES.COMMERCE_ORDER : "")).toUpperCase();
        switch (subjectType) {
            case SUBJECT_TYPES.COMMERCE_ORDER:
                await runPostCommitPaidFulfillment(applied);
                return runPostCommitPaidSettlement(applied);
            case SUBJECT_TYPES.WALLET_TOPUP:
                if (typeof deps.walletTopupSettlementHandler !== "function") return null;
                return deps.walletTopupSettlementHandler({ attemptId: applied.attempt.attemptId, topupId: applied.attempt.subjectId });
            default:
                throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_SUBJECT_UNSUPPORTED, "Paid subject type is not supported.", { stage: "paid_effects", metadata: { subjectType } });
        }
    }

    async function runPostCommitCouponReconciliation(applied = {}) {
        const status = normalizeState(applied.attempt?.status);
        if (![PAYMENT_STATES.PAID, PAYMENT_STATES.FAILED, PAYMENT_STATES.CANCELLED, PAYMENT_STATES.EXPIRED].includes(status)) return null;
        const subjectType = normalizeString(applied.attempt?.subjectType || (applied.attempt?.orderId ? SUBJECT_TYPES.COMMERCE_ORDER : "")).toUpperCase();
        if (subjectType !== SUBJECT_TYPES.COMMERCE_ORDER || typeof deps.couponReconciliationHandler !== "function") return null;
        try {
            const orderId = normalizeString(applied.order?.orderId || applied.attempt?.orderId);
            let committedOrder = applied.order;
            if (orderId) ({ subject: committedOrder } = await loadOperationalSubject({ subjectReference: { subjectType, subjectId: orderId, orderId } }));
            return await deps.couponReconciliationHandler({ order: committedOrder, attempt: applied.attempt, toStatus: status, now: deps.clock() });
        } catch (error) {
            deps.logger.error?.("Coupon payment reconciliation dispatch failed.", {
                orderId: applied.order?.orderId || applied.attempt?.orderId || "",
                status,
                errorCode: error?.code || error?.name || "UNKNOWN"
            });
            return { required: true, status: "FAILED", retryable: true, errorCode: error?.code || error?.name || "COUPON_RECONCILIATION_DISPATCH_FAILED" };
        }
    }

    async function runPostCommitTerminalEffects(applied = {}) {
        await runPostCommitCouponReconciliation(applied);
        return runPostCommitPaidEffects(applied);
    }

    function buildIntent(order, input = {}, subjectAdapter = commerceOrderAdapter, subjectReference = null) {
        const reference = subjectReference || normalizeSubjectReference({ orderId: order.orderId });
        const amount = subjectAdapter.getAuthoritativeAmount(order);
        const currency = subjectAdapter.getCurrency(order);
        if (!Number.isFinite(amount) || amount < 0 || !currency) {
            throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_NOT_PAYABLE, "Order has no payable commercial amount.", {
                stage: "order",
                metadata: { orderId: order.orderId }
            });
        }
        const payment = subjectAdapter.getPaymentSnapshot(order);
        const providerType = normalizeString(payment.providerType || payment.flowType || payment.paymentType || payment.paymentChannel || "manual");
        const provider = normalizeString(payment.provider || payment.providerKey || payment.paymentMethodId || payment.paymentMethod);
        return deepFreeze({
            paymentIntentId: normalizeId(input.paymentIntentId || deps.idGenerator("paymentIntent"), "paymentIntentId"),
            subjectType: reference.subjectType,
            subjectId: reference.subjectId,
            ...(reference.subjectType === SUBJECT_TYPES.COMMERCE_ORDER ? {
                orderId: normalizeString(order.orderId),
                commerceOrderId: normalizeString(order.commerceOrderId || order.orderId),
                quoteId: normalizeString(order.quoteId),
                commercialSnapshot: clonePlain(order.commercial || order.commercialSnapshot || {})
            } : {}),
            owner: clonePlain(order.owner || { type: "USER", userId: textOwnerId(order.customerUserId) }),
            amount,
            currency,
            region: subjectAdapter.getRegion(order),
            paymentMethodId: normalizeString(payment.paymentMethodId || payment.methodKey || payment.paymentMethod || payment.key),
            paymentChannel: normalizeString(payment.paymentChannel || payment.flowType || ""),
            provider,
            providerType,
            confirmationMode: normalizeString(payment.confirmationMode || payment.metadata?.confirmationMode || ""),
            paymentSnapshot: payment,
            customer: {
                phone: normalizeString(order.customer?.contact?.phone || order.fulfilment?.input?.customFields?.customerPhone),
                name: normalizeString(order.fulfilment?.input?.customFields?.customerName || order.customer?.notes || "AZIEL Customer")
            },
            items: [{
                name: normalizeString(order.product?.packageName || order.product?.productName || order.product?.packageCode || "AZIEL top-up"),
                amount,
                quantity: Number(order.commercial?.quantity || order.product?.quantity || 1)
            }],
            idempotencyKey: normalizeString(input.idempotencyKey),
            traceId: normalizeString(input.traceId || input.requestMetadata?.traceId),
            clientIp: normalizeString(input.clientIp || input.requestMetadata?.clientIp)
        });
    }

    async function resolveAdapter(intent, operation) {
        const adapter = await deps.providerResolver({ intent, operation });
        if (!adapter || typeof adapter !== "object") {
            throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE, "Payment provider is unavailable.", {
                stage: "provider",
                metadata: { provider: intent.provider, providerType: intent.providerType }
            });
        }
        return adapter;
    }

    async function applyPaymentStatus({ order, subjectAdapter = commerceOrderAdapter, attempt, toStatus, reason, transactionContext }) {
        const transition = assertTransition(attempt.status, toStatus, {
            allowLatePaymentReconciliation: deps.allowLatePaymentReconciliation
        });
        const updateAttemptStatus = assertPortFunction(deps.paymentAttemptPort, "updateAttemptStatus");
        const updatedAttempt = await updateAttemptStatus({
            attemptId: attempt.attemptId,
            fromStatuses: [transition.from],
            toStatus: transition.to,
            reason,
            changedAt: deps.clock(),
            transactionContext
        });
        const updatedOrder = await subjectAdapter.applyPaymentTransition({
            subject: order,
            transition,
            attempt: updatedAttempt || attempt,
            reason,
            session: transactionContext
        });
        return { attempt: detachAttempt(updatedAttempt || { ...attempt, status: transition.to }), order: updatedOrder || order };
    }

    async function initiatePayment(input = {}) {
        const source = assertPlainObject(input, "input");
        const owner = normalizeOwner(source.owner || {});
        const subjectReference = normalizeSubjectReference(source);
        const orderId = subjectReference.orderId;
        const idempotencyKey = normalizeId(source.idempotencyKey, "idempotencyKey", false);
        const { subject: order, adapter: subjectAdapter } = await loadOwnedSubject({ subjectReference, owner });
        subjectAdapter.assertPayable(order, { operation: "initiatePayment" });
        const intent = buildIntent(order, { ...source, idempotencyKey }, subjectAdapter, subjectReference);
        const fingerprint = fingerprintIntent(intent);

        if (idempotencyKey && typeof deps.paymentAttemptPort.findAttemptByIdempotency === "function") {
            const existing = await deps.paymentAttemptPort.findAttemptByIdempotency({ ...subjectReference, owner, idempotencyKey, operation: "initiatePayment" });
            if (existing) {
                if (existing.requestFingerprint !== fingerprint) {
                    throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_IDEMPOTENCY_CONFLICT, "Payment idempotency key conflicts with another request.", {
                        stage: "idempotency",
                        metadata: { orderId }
                    });
                }
                return buildPublicResult({ attempt: existing, order, idempotent: true, outcome: "idempotent_reuse" });
            }
        }

        const activeFinder = subjectReference.subjectType === SUBJECT_TYPES.COMMERCE_ORDER
            ? assertPortFunction(deps.paymentAttemptPort, "findActiveAttemptForOrder")
            : assertPortFunction(deps.paymentAttemptPort, "findActiveAttemptForSubject");
        const active = await activeFinder({ ...subjectReference, owner, transactionContext: null });
        if (active && ACTIVE_ATTEMPT_STATES.has(normalizeState(active.status))) {
            return buildPublicResult({ attempt: active, order, idempotent: true, duplicate: true, outcome: "active_attempt_reused" });
        }

        const adapter = await resolveAdapter(intent, "createPayment");
        if (typeof adapter.createPayment !== "function") {
            throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_PROVIDER_UNSUPPORTED, "Provider does not support payment creation.", { stage: "provider" });
        }
        const attemptId = normalizeId(source.attemptId || deps.idGenerator("paymentAttempt"), "attemptId");
        const createAttempt = assertPortFunction(deps.paymentAttemptPort, "createAttempt");
        const initiatingAttempt = await runTransaction(transactionContext => createAttempt({
            attemptId,
            subjectType: subjectReference.subjectType,
            subjectId: subjectReference.subjectId,
            orderId: subjectReference.subjectType === SUBJECT_TYPES.COMMERCE_ORDER ? orderId : "",
            quoteId: intent.quoteId,
            owner,
            status: PAYMENT_STATES.INITIATING,
            provider: intent.provider,
            providerType: intent.providerType,
            paymentMethodId: intent.paymentMethodId,
            paymentChannel: intent.paymentChannel,
            amount: intent.amount,
            currency: intent.currency,
            region: intent.region,
            confirmationMode: intent.confirmationMode,
            idempotencyKey,
            operation: "initiatePayment",
            requestFingerprint: fingerprint,
            createdAt: deps.clock(),
            transactionContext
        }));

        let providerResult;
        let checkpointedAttempt = initiatingAttempt;
        try {
            const providerContext = {
                intent,
                attempt: detachAttempt(initiatingAttempt)
            };
            providerResult = normalizeProviderResult(await adapter.createPayment(providerContext), intent);
        } catch (error) {
            if (error instanceof PaymentOrchestratorError) throw error;

            deps.logger.error?.("Payment provider operation failed.", {
                provider: intent.provider || "",
                orderId,
                attemptId,
                errorName: error?.name || "",
                errorCode: error?.code || "",
                errorStage: error?.stage || "",
                diagnostic: error?.metadata?.diagnostic || "",
                httpStatus: Number.isInteger(error?.statusCode) ? error.statusCode : null,
                retryable: error?.retryable === true,
                submissionUncertain: error?.submissionUncertain === true
            });

            throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_PROVIDER_ERROR, "Payment provider failed.", {
                stage: "provider",
                causeCode: error?.code || "",
                retryable: error?.retryable === true,
                metadata: { message: error?.message || "", attemptId, providerReferencePresent: Boolean(checkpointedAttempt?.providerReference), diagnostic: error?.metadata?.diagnostic || "", expectedAmountCheckSatang: error?.metadata?.expectedAmountCheckSatang, returnedAmountCheck: error?.metadata?.returnedAmountCheck }
            });
        }

        try {
            const applied = await runTransaction(async transactionContext => {
                let currentAttempt = checkpointedAttempt;
                if (providerResult.providerReference && typeof deps.paymentAttemptPort.setProviderReference === "function") {
                    currentAttempt = await deps.paymentAttemptPort.setProviderReference({
                        attemptId,
                        providerReference: providerResult.providerReference,
                        providerTransactionId: providerResult.providerTransactionId,
                        rawProviderStatus: providerResult.rawProviderStatus,
                        qr: providerResult.qr,
                        redirect: providerResult.redirect,
                        expiresAt: providerResult.expiresAt,
                        paymentInstructions: providerResult.paymentInstructions,
                        safeMetadata: providerResult.safeMetadata,
                        providerPayableAmountSatang: providerResult.providerPayableAmountSatang,
                        providerPayableAmount: providerResult.providerPayableAmount,
                        transactionContext
                    }) || currentAttempt;
                }
                currentAttempt = {
                    ...currentAttempt,
                    providerReference: providerResult.providerReference,
                    providerTransactionId: providerResult.providerTransactionId,
                    rawProviderStatus: providerResult.rawProviderStatus,
                    paymentInstructions: providerResult.paymentInstructions,
                    qr: providerResult.qr,
                    redirect: providerResult.redirect,
                    expiresAt: providerResult.expiresAt,
                    providerPayableAmountSatang: providerResult.providerPayableAmountSatang,
                    providerPayableAmount: providerResult.providerPayableAmount
                };
                const applied = await applyPaymentStatus({
                    order,
                    subjectAdapter,
                    attempt: currentAttempt,
                    toStatus: providerResult.status,
                    reason: "Payment initiated",
                    transactionContext
                });
                return {
                    attempt: { ...applied.attempt, ...currentAttempt, status: providerResult.status },
                    order: applied.order
                };
            });
            await runPostCommitTerminalEffects(applied);
            return buildPublicResult({ attempt: applied.attempt, order: applied.order, outcome: "created" });
        } catch (error) {
            if (typeof deps.paymentAttemptPort.recordFailure === "function") {
                await deps.paymentAttemptPort.recordFailure({
                    attemptId,
                    status: PAYMENT_STATES.FAILED,
                    error: {
                        code: ERROR_CODES.PAYMENT_OUTCOME_UNKNOWN,
                        safeMessage: "Payment provider responded but local persistence did not complete."
                    },
                    changedAt: deps.clock()
                }).catch(() => null);
            }
            throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_OUTCOME_UNKNOWN, "Provider result could not be durably applied.", {
                stage: "persistence",
                retryable: false,
                causeCode: error?.code || "",
                metadata: { orderId, attemptId }
            });
        }
    }

    async function loadAttemptForOwner(input, operation) {
        const source = assertPlainObject(input, "input");
        const owner = normalizeOwner(source.owner || {});
        const attemptId = normalizeId(source.attemptId, "attemptId");
        const finder = assertPortFunction(deps.paymentAttemptPort, "findAttemptByIdForOwner");
        const attempt = await finder({ attemptId, owner, operation });
        if (!attempt) {
            throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_EVENT_NOT_FOUND, "Payment attempt was not found.", { stage: "attempt" });
        }
        const subjectReference = normalizeSubjectReference(attempt);
        const { subject: order, adapter: subjectAdapter } = await loadOwnedSubject({ subjectReference, owner });
        return { owner, attempt: detachAttempt(attempt), order, subjectAdapter, subjectReference };
    }

    async function loadOwnedPaymentSubject(input = {}) {
        const owner = normalizeOwner(input.owner || {});
        const attempt = input.attempt || await assertPortFunction(deps.paymentAttemptPort, "findAttemptByIdForOwner")({ attemptId: normalizeId(input.attemptId, "attemptId"), owner });
        if (!attempt) throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_EVENT_NOT_FOUND, "Payment attempt was not found.", { stage: "attempt" });
        const subjectReference = normalizeSubjectReference(attempt);
        const loaded = await loadOwnedSubject({ subjectReference, owner, transactionContext: input.transactionContext || null });
        return { attempt: detachAttempt(attempt), subject: loaded.subject, subjectAdapter: loaded.adapter, subjectReference };
    }

    async function retryPayment(input = {}) {
        const { owner, attempt, order, subjectReference } = await loadAttemptForOwner(input, "retryPayment");
        const from = normalizeState(attempt.status);
        if (![PAYMENT_STATES.FAILED, PAYMENT_STATES.EXPIRED].includes(from)) {
            throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_RETRY_NOT_ALLOWED, "Payment attempt cannot be retried from its current state.", {
                stage: "retry",
                metadata: { attemptId: attempt.attemptId, status: from }
            });
        }
        const retryInput = {
            subjectType: subjectReference.subjectType,
            subjectId: subjectReference.subjectId,
            orderId: subjectReference.subjectType === SUBJECT_TYPES.COMMERCE_ORDER ? order.orderId : "",
            owner,
            idempotencyKey: normalizeString(input.idempotencyKey || `${attempt.attemptId}:retry`),
            traceId: input.traceId
        };
        return initiatePayment(retryInput);
    }

    async function refreshPayment(input = {}) {
        const { attempt, order, subjectAdapter, subjectReference } = await loadAttemptForOwner(input, "refreshPayment");
        const intent = buildIntent(order, input, subjectAdapter, subjectReference);
        const adapter = await resolveAdapter(intent, "refreshPayment");
        const query = adapter.refreshPayment || adapter.queryPayment;
        if (typeof query !== "function") {
            throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_PROVIDER_UNSUPPORTED, "Provider does not support payment refresh.", { stage: "provider" });
        }
        const result = normalizeProviderResult(await query.call(adapter, { attempt: detachAttempt(attempt), intent }), intent);
        const currentState = normalizeState(attempt.status);
        if (currentState === result.status) {
            const refreshedAttempt = await runTransaction(async transactionContext => {
                if (!result.providerReference || typeof deps.paymentAttemptPort.setProviderReference !== "function") return attempt;
                return await deps.paymentAttemptPort.setProviderReference({
                    attemptId: attempt.attemptId, providerReference: result.providerReference,
                    providerTransactionId: result.providerTransactionId, rawProviderStatus: result.rawProviderStatus,
                    qr: result.qr, expiresAt: result.expiresAt, paymentInstructions: result.paymentInstructions,
                    safeMetadata: result.safeMetadata,
                    providerPayableAmountSatang: result.providerPayableAmountSatang,
                    providerPayableAmount: result.providerPayableAmount,
                    transactionContext
                }) || attempt;
            });
            return buildPublicResult({ attempt: refreshedAttempt, order, idempotent: true, outcome: "no_change" });
        }
        assertTransition(currentState, result.status, { allowLatePaymentReconciliation: deps.allowLatePaymentReconciliation });
        const applied = await runTransaction(async transactionContext => {
            let refreshedAttempt = attempt;
            if (result.providerReference && typeof deps.paymentAttemptPort.setProviderReference === "function") {
                refreshedAttempt = await deps.paymentAttemptPort.setProviderReference({
                    attemptId: attempt.attemptId, providerReference: result.providerReference,
                    providerTransactionId: result.providerTransactionId, rawProviderStatus: result.rawProviderStatus,
                    qr: result.qr, expiresAt: result.expiresAt, paymentInstructions: result.paymentInstructions,
                    safeMetadata: result.safeMetadata,
                    providerPayableAmountSatang: result.providerPayableAmountSatang,
                    providerPayableAmount: result.providerPayableAmount,
                    transactionContext
                }) || attempt;
            }
            return applyPaymentStatus({ order, subjectAdapter, attempt: refreshedAttempt, toStatus: result.status, reason: "Payment refreshed", transactionContext });
        });
        await runPostCommitTerminalEffects(applied);
        return buildPublicResult({ attempt: applied.attempt, order: applied.order, outcome: "refreshed" });
    }

    async function cancelPayment(input = {}) {
        const { attempt, order, subjectAdapter, subjectReference } = await loadAttemptForOwner(input, "cancelPayment");
        const current = normalizeState(attempt.status);
        if (current === PAYMENT_STATES.CANCELLED) return buildPublicResult({ attempt, order, idempotent: true, outcome: "already_cancelled" });
        assertTransition(current, PAYMENT_STATES.CANCELLED);
        const intent = buildIntent(order, input, subjectAdapter, subjectReference);
        const adapter = await resolveAdapter(intent, "cancelPayment");
        if (typeof adapter.cancelPayment === "function") {
            await adapter.cancelPayment({ attempt: detachAttempt(attempt), intent });
        }
        const applied = await runTransaction(transactionContext => applyPaymentStatus({
            order,
            subjectAdapter,
            attempt,
            toStatus: PAYMENT_STATES.CANCELLED,
            reason: "Payment cancelled",
            transactionContext
        }));
        await runPostCommitTerminalEffects(applied);
        return buildPublicResult({ attempt: applied.attempt, order: applied.order, outcome: "cancelled" });
    }

    async function expirePayment(input = {}) {
        const { attempt, order, subjectAdapter, subjectReference } = await loadAttemptForOwner(input, "expirePayment");
        const current = normalizeState(attempt.status);
        if (current === PAYMENT_STATES.EXPIRED) return buildPublicResult({ attempt, order, idempotent: true, outcome: "already_expired" });
        assertTransition(current, PAYMENT_STATES.EXPIRED);
        const intent = buildIntent(order, input, subjectAdapter, subjectReference);
        const adapter = await resolveAdapter(intent, "expirePayment");
        if (typeof adapter.expirePayment === "function") {
            await adapter.expirePayment({ attempt: detachAttempt(attempt), intent });
        }
        const applied = await runTransaction(transactionContext => applyPaymentStatus({
            order,
            subjectAdapter,
            attempt,
            toStatus: PAYMENT_STATES.EXPIRED,
            reason: "Payment expired",
            transactionContext
        }));
        await runPostCommitTerminalEffects(applied);
        return buildPublicResult({ attempt: applied.attempt, order: applied.order, outcome: "expired" });
    }

    async function handleProviderEvent(input = {}) {
        const source = assertPlainObject(input, "input");
        const trustedEvent = source.providerEvent || source.event;
        assertPlainObject(trustedEvent, "providerEvent");
        const providerReference = normalizeId(trustedEvent.providerReference || trustedEvent.providerTransactionId, "providerReference");
        const eventId = normalizeId(trustedEvent.providerEventId, "providerEventId", false);
        const findAttempt = assertPortFunction(deps.paymentAttemptPort, "findAttemptByProviderReference");
        const attempt = await findAttempt({ providerReference, providerEventId: eventId });
        if (!attempt) {
            throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_EVENT_NOT_FOUND, "Provider event does not match a known payment attempt.", {
                stage: "provider_event",
                metadata: { providerReference }
            });
        }
        const subjectReference = normalizeSubjectReference(attempt);
        if (attemptHasProviderEvent(attempt, eventId)) {
            const { subject: order } = await loadOperationalSubject({ subjectReference });
            return buildPublicResult({ attempt, order, idempotent: true, duplicate: true, outcome: "duplicate_event" });
        }
        const { subject: order, adapter: subjectAdapter } = await loadOperationalSubject({ subjectReference });
        const intent = buildIntent(order, source, subjectAdapter, subjectReference);
        const adapter = await resolveAdapter(intent, "handleProviderEvent");
        let providerEventResult = trustedEvent;
        if (
            adapter &&
            typeof adapter.handleProviderEvent === "function" &&
            typeof adapter.supportsCapability === "function" &&
            (adapter.supportsCapability("MANUAL_APPROVAL") || adapter.supportsCapability("WEBHOOK"))
        ) {
            try {
                providerEventResult = await adapter.handleProviderEvent({
                    providerEvent: trustedEvent,
                    event: trustedEvent,
                    attempt: detachAttempt(attempt),
                    intent,
                    trusted: source.trusted === true || source.trustedOperational === true,
                    trustedOperational: source.trustedOperational === true,
                    receipt: source.receipt,
                    verifier: source.verifier
                });
            } catch (error) {
                throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_PROVIDER_ERROR, "Payment provider event validation failed.", {
                    stage: "provider_event",
                    causeCode: error?.code || "",
                    retryable: error?.retryable === true,
                    metadata: { message: error?.message || "" }
                });
            }
        }
        const result = normalizeProviderResult({
            ...providerEventResult,
            status: providerEventResult.status || providerEventResult.paymentStatus
        }, intent);
        if (normalizeString(result.provider || trustedEvent.provider) && normalizeString(result.provider || trustedEvent.provider) !== normalizeString(attempt.provider || intent.provider)) {
            throw new PaymentOrchestratorError(ERROR_CODES.PAYMENT_ORDER_BINDING_MISMATCH, "Provider event does not match attempt provider.", { stage: "provider_event" });
        }
        const current = normalizeState(attempt.status);
        if (current === result.status) {
            if (typeof deps.paymentAttemptPort.appendProviderEvent === "function") {
                await deps.paymentAttemptPort.appendProviderEvent({
                    attemptId: attempt.attemptId,
                    providerEvent: {
                        providerEventId: eventId,
                        provider: result.provider || trustedEvent.provider,
                        providerReference,
                        providerTransactionId: result.providerTransactionId || trustedEvent.providerTransactionId || providerReference,
                        eventType: providerEventResult.eventType || trustedEvent.eventType || trustedEvent.type,
                        status: result.status,
                        amount: result.amount,
                        currency: result.currency,
                        occurredAt: providerEventResult.occurredAt || trustedEvent.occurredAt || null,
                        receivedAt: deps.clock(),
                        safeMetadata: result.safeMetadata
                    }
                });
            }
            if (result.status === PAYMENT_STATES.PAID) {
                await runPostCommitTerminalEffects({ attempt, order });
            }
            return buildPublicResult({ attempt, order, idempotent: true, outcome: "event_no_change" });
        }
        assertTransition(current, result.status, { allowLatePaymentReconciliation: deps.allowLatePaymentReconciliation });
        const applied = await runTransaction(async transactionContext => {
            if (source.verifiedTransactionRef) {
                const bindVerifiedTransactionRef = assertPortFunction(deps.paymentAttemptPort, "bindVerifiedTransactionRef");
                await bindVerifiedTransactionRef({
                    attemptId: attempt.attemptId,
                    verifiedTransactionRef: normalizeString(source.verifiedTransactionRef),
                    changedAt: deps.clock(),
                    transactionContext
                });
            }
            if (typeof deps.paymentAttemptPort.appendProviderEvent === "function") {
                await deps.paymentAttemptPort.appendProviderEvent({
                    attemptId: attempt.attemptId,
                    providerEvent: {
                        providerEventId: eventId,
                        provider: result.provider || trustedEvent.provider,
                        providerReference,
                        providerTransactionId: result.providerTransactionId || trustedEvent.providerTransactionId || providerReference,
                        eventType: providerEventResult.eventType || trustedEvent.eventType || trustedEvent.type,
                        status: result.status,
                        amount: result.amount,
                        currency: result.currency,
                        occurredAt: providerEventResult.occurredAt || trustedEvent.occurredAt || null,
                        receivedAt: deps.clock(),
                        safeMetadata: result.safeMetadata
                    },
                    transactionContext
                });
            }
            return applyPaymentStatus({
                order,
                subjectAdapter,
                attempt,
                toStatus: result.status,
                reason: "Provider event applied",
                transactionContext
            });
        });
        await runPostCommitTerminalEffects(applied);
        return buildPublicResult({ attempt: applied.attempt, order: applied.order, outcome: "provider_event_applied" });
    }

    async function getPaymentResult(input = {}) {
        const { attempt, order } = await loadAttemptForOwner(input, "getPaymentResult");
        return buildPublicResult({ attempt, order });
    }

    return deepFreeze({
        initiatePayment,
        retryPayment,
        refreshPayment,
        cancelPayment,
        expirePayment,
        handleProviderEvent,
        getPaymentResult,
        loadOwnedPaymentSubject,
        toPublicPaymentResult: value => buildPublicResult(value),
        assertTransition,
        normalizeProviderResult
    });
}

module.exports = Object.freeze({
    createPaymentOrchestrator,
    PaymentOrchestratorError,
    ERROR_CODES,
    PAYMENT_STATES,
    PAYMENT_ORCHESTRATOR_VERSION,
    TRANSITIONS,
    toOrderPaymentStatus
});
