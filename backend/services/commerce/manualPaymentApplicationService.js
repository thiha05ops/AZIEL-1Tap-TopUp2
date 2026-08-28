"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const orderRepository = require("./orderRepository");
const paymentAttemptRepository = require("./paymentAttemptRepository");
const { createPaymentOrchestrator, PaymentOrchestratorError } = require("./paymentOrchestrator");
const { createProviderRegistry } = require("./providerRegistry");
const { createManualPromptPayProvider } = require("./manualPromptPayProviderFactory");
const { createManualAdminAdapter, MANUAL_ADMIN_PROVIDER_ID } = require("./providers/manualAdminAdapter");
const { paymentMethodCapabilityState } = require("../paymentProviderRegistry");
const PaymentMethod = require("../../models/PaymentMethod");
const {
    consumeCommercePromotion,
    releaseCommercePromotion
} = require("./commercePromotionBridgeService");

const SERVICE_VERSION = "commerce.manual-payment-application.v1";
const MANUAL_PROVIDER_ID = "MANUAL_PROMPTPAY";
const MANUAL_PROVIDER_IDS = Object.freeze(new Set([MANUAL_PROVIDER_ID, MANUAL_ADMIN_PROVIDER_ID]));
const ERROR_CODES = Object.freeze({
    VALIDATION_ERROR: "VALIDATION_ERROR",
    UNAUTHENTICATED: "UNAUTHENTICATED",
    FORBIDDEN: "FORBIDDEN",
    NOT_FOUND: "NOT_FOUND",
    UNSUPPORTED_PAYMENT_METHOD: "UNSUPPORTED_PAYMENT_METHOD",
    INVALID_STATE: "INVALID_STATE",
    IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
    PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
    RECEIPT_BINDING_FAILED: "RECEIPT_BINDING_FAILED",
    PERSISTENCE_ERROR: "PERSISTENCE_ERROR"
});
const ACTIVE_EVIDENCE_STATUSES = Object.freeze(new Set(["PENDING"]));

class ManualPaymentApplicationError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "ManualPaymentApplicationError";
        this.code = code;
        this.httpStatus = options.httpStatus || 400;
        this.stage = String(options.stage || "");
        this.causeCode = String(options.causeCode || "");
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

function normalizeUpper(value) {
    return normalizeString(value).replace(/-/g, "_").toUpperCase();
}

function assertId(value, field) {
    const id = normalizeString(value);
    if (!id || id.length > 220 || !/^[A-Za-z0-9._:-]+$/.test(id)) {
        throw appError(ERROR_CODES.VALIDATION_ERROR, `${field} is invalid.`, 400, "input", { field });
    }
    return id;
}

function normalizeOwner(owner = {}) {
    const userId = normalizeString(owner.userId || owner.id || owner._id);
    const sessionId = normalizeString(owner.sessionId);
    if (userId) return { type: "USER", userId, sessionId: "" };
    if (sessionId) return { type: "SESSION", userId: "", sessionId };
    throw appError(ERROR_CODES.UNAUTHENTICATED, "Authenticated owner is required.", 401, "auth");
}

function normalizeAdmin(admin = {}) {
    const adminId = normalizeString(admin.adminId || admin.id || admin._id);
    if (!adminId) throw appError(ERROR_CODES.UNAUTHENTICATED, "Authenticated admin is required.", 401, "admin_auth");
    return {
        adminId,
        username: normalizeString(admin.username),
        role: normalizeString(admin.role),
        permissions: Array.isArray(admin.permissions) ? admin.permissions : []
    };
}

function appError(code, message, httpStatus, stage, metadata = {}, options = {}) {
    return new ManualPaymentApplicationError(code, message, {
        httpStatus,
        stage,
        metadata,
        causeCode: options.causeCode,
        retryable: options.retryable
    });
}

function paymentProviderOf(order = {}) {
    return normalizeUpper(order.payment?.provider || order.payment?.providerKey || order.payment?.paymentMethodId || order.payment?.paymentMethod);
}

function isManualPromptPayOrder(order = {}) {
    const provider = paymentProviderOf(order);
    const method = normalizeString(order.payment?.paymentMethodId || order.payment?.methodKey).toLowerCase();
    return provider === MANUAL_PROVIDER_ID || provider === "MANUAL_PROMPTPAY" || method === "promptpay" || method === "aziel_promptpay_dynamic";
}

function isManualAdminOrder(order = {}) {
    return paymentProviderOf(order) === MANUAL_ADMIN_PROVIDER_ID;
}

function isSupportedManualOrder(order = {}) {
    return isManualPromptPayOrder(order) || isManualAdminOrder(order);
}

function fingerprint(input = {}) {
    return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function defaultTransactionRunner(callback) {
    return mongoose.startSession().then(async session => {
        try {
            let result;
            await session.withTransaction(async () => {
                result = await callback({ mongoSession: session, session });
            });
            return result;
        } finally {
            await session.endSession();
        }
    });
}

async function defaultManualPromptPayConfigurationProvider() {
    const method = await PaymentMethod.findOne({
        $or: [{ key: "promptpay" }, { provider: "promptpay" }, { qrMode: "aziel_promptpay_dynamic" }],
        enabled: true
    }).sort({ routingPriority: -1, updatedAt: -1 }).lean();
    if (!method) throw appError(ERROR_CODES.PROVIDER_UNAVAILABLE, "Manual PromptPay is not configured.", 503, "provider");
    return {
        enabled: true,
        recipientType: method.promptPayRecipientType,
        recipientValue: method.promptPayRecipientValue,
        recipientDisplayName: method.method || method.appDisplayName || "AZIEL PromptPay",
        defaultExpiryMinutes: method.dynamicQrExpiryMinutes || 15,
        environment: String(method.providerEnvironment || process.env.NODE_ENV || "production").toLowerCase(),
        referencePrefix: "AZL",
        receiptRequired: method.slipRequired !== false
    };
}

async function defaultManualAdminConfigurationProvider({ intent } = {}) {
    const methodKey = normalizeString(intent?.paymentMethodId).toLowerCase();
    const region = normalizeUpper(intent?.region);
    const method = await PaymentMethod.findOne({ key: methodKey, region, enabled: true }).lean();
    const capability = method ? paymentMethodCapabilityState(method) : null;
    if (!method || capability?.customerVisible !== true || !["manual", "deeplink"].includes(normalizeString(method.paymentType).toLowerCase()) || method.confirmationMode !== "manual_admin") {
        throw appError(ERROR_CODES.PROVIDER_UNAVAILABLE, "Manual payment method is unavailable.", 503, "provider");
    }
    return {
        methodKey: method.key,
        methodName: method.method,
        region: method.region,
        currency: intent.currency,
        accountName: method.accountName,
        accountNumber: method.accountNumber,
        qrImage: method.uploadedQrImage || method.qrImageUrl || "",
        qrMode: method.qrMode,
        referenceInstructions: method.referenceInstructions,
        receiptUploadEnabled: method.receiptUploadEnabled !== false,
        slipRequired: method.slipRequired !== false,
        enableOpenApp: method.enableOpenApp === true,
        openAppMode: method.openAppMode,
        deepLinkUrl: method.deepLinkUrl,
        appDisplayName: method.appDisplayName,
        confirmationMode: method.confirmationMode
    };
}

function createProviderResolver(configProvider, providerOptions = {}, manualAdminConfigProvider = defaultManualAdminConfigurationProvider) {
    let cached = null;
    let cachedSignature = "";
    return async function providerResolver({ intent }) {
        if (normalizeUpper(intent?.provider) === MANUAL_ADMIN_PROVIDER_ID) {
            const config = await manualAdminConfigProvider({ intent });
            return createManualAdminAdapter({ configuration: config, ...providerOptions });
        }
        if (!isManualPromptPayOrder({ payment: intent.paymentSnapshot || { provider: intent.provider, paymentMethodId: intent.paymentMethodId } })) {
            throw appError(ERROR_CODES.UNSUPPORTED_PAYMENT_METHOD, "Commerce order is not configured for Manual PromptPay.", 422, "provider");
        }
        const config = await configProvider({ intent });
        const signature = JSON.stringify(config);
        if (!cached || cachedSignature !== signature) {
            const registry = createProviderRegistry();
            const adapter = createManualPromptPayProvider({ configuration: config, ...providerOptions });
            registry.registerProvider(adapter);
            cached = registry;
            cachedSignature = signature;
        }
        return cached.resolveProvider({ providerId: MANUAL_PROVIDER_ID });
    };
}

function mapPaymentError(error, stage) {
    if (error instanceof ManualPaymentApplicationError) return error;
    if (error instanceof PaymentOrchestratorError) {
        const map = {
            PAYMENT_FORBIDDEN: [ERROR_CODES.FORBIDDEN, 403],
            PAYMENT_ORDER_NOT_FOUND: [ERROR_CODES.NOT_FOUND, 404],
            PAYMENT_NOT_PAYABLE: [ERROR_CODES.INVALID_STATE, 409],
            PAYMENT_PROVIDER_UNSUPPORTED: [ERROR_CODES.UNSUPPORTED_PAYMENT_METHOD, 422],
            PAYMENT_PROVIDER_UNAVAILABLE: [ERROR_CODES.PROVIDER_UNAVAILABLE, 503],
            PAYMENT_PROVIDER_ERROR: [ERROR_CODES.PROVIDER_UNAVAILABLE, 503],
            PAYMENT_IDEMPOTENCY_CONFLICT: [ERROR_CODES.IDEMPOTENCY_CONFLICT, 409],
            PAYMENT_ATTEMPT_CONFLICT: [ERROR_CODES.IDEMPOTENCY_CONFLICT, 409],
            PAYMENT_INVALID_TRANSITION: [ERROR_CODES.INVALID_STATE, 409],
            PAYMENT_EVENT_NOT_FOUND: [ERROR_CODES.NOT_FOUND, 404],
            PAYMENT_AMOUNT_MISMATCH: [ERROR_CODES.INVALID_STATE, 409],
            PAYMENT_CURRENCY_MISMATCH: [ERROR_CODES.INVALID_STATE, 409],
            PAYMENT_ORDER_BINDING_MISMATCH: [ERROR_CODES.INVALID_STATE, 409]
        };
        const mapped = map[error.code] || [ERROR_CODES.PERSISTENCE_ERROR, 500];
        return appError(mapped[0], "Manual payment operation failed.", mapped[1], stage, {}, {
            causeCode: error.code,
            retryable: error.retryable
        });
    }
    return appError(ERROR_CODES.PERSISTENCE_ERROR, "Manual payment operation failed.", 500, stage, {}, {
        causeCode: error?.code || error?.name || "",
        retryable: error?.retryable === true
    });
}

function safeFailure(attempt = {}) {
    if (!attempt.failure && !attempt.failureCode && !attempt.failureMessage) return null;
    return {
        code: normalizeString(attempt.failure?.code || attempt.failureCode),
        message: normalizeString(attempt.failure?.message || attempt.failureMessage || "Payment could not be completed.")
    };
}

function receiptView(attempt = {}) {
    const evidence = attempt.safeMetadata?.receiptEvidence || null;
    if (!evidence) return { attached: false };
    return {
        attached: true,
        receiptId: evidence.receiptId || "",
        mimeType: evidence.mimeType || "",
        fileSize: Number(evidence.fileSize || 0),
        checksum: evidence.checksum || "",
        uploadedAt: evidence.uploadedAt || ""
    };
}

function toSafePaymentView({ order = {}, attempt = {}, paymentResult = null, admin = false } = {}) {
    const source = paymentResult || attempt || {};
    const qr = source.qr || attempt.qr || null;
    const instructions = source.paymentInstructions || attempt.paymentInstructions || null;
    return {
        manualPaymentApplicationVersion: SERVICE_VERSION,
        orderId: order.orderId || source.orderId || attempt.orderId || "",
        attemptId: source.attemptId || attempt.attemptId || "",
        paymentStatus: normalizeString(source.paymentStatus || attempt.status || order.paymentStatus).toLowerCase(),
        provider: normalizeString(attempt.provider || order.payment?.provider || source.provider),
        paymentMethod: normalizeString(attempt.paymentMethod || attempt.paymentMethodId || order.payment?.paymentMethodId),
        region: normalizeString(attempt.region || order.commercial?.region).toUpperCase(),
        amount: Number(source.amount ?? attempt.amount ?? order.commercial?.totalAmount ?? 0),
        currency: normalizeString(source.currency || attempt.currency || order.commercial?.currency).toUpperCase(),
        qr: qr ? {
            type: qr.type || "PROMPTPAY_EMV_QR",
            mode: qr.mode || "aziel_promptpay_dynamic",
            sourceType: qr.sourceType || "dynamic_response",
            image: qr.image || "",
            payload: qr.payload || "",
            encodedAmount: qr.encodedAmount || "",
            encodedReference: qr.encodedReference || ""
        } : null,
        paymentInstructions: instructions ? clonePlain(instructions) : null,
        expiresAt: source.expiresAt || attempt.expiresAt || null,
        receiptEvidence: receiptView(attempt),
        retryEligible: ["failed", "expired"].includes(normalizeString(source.paymentStatus || attempt.status).toLowerCase()),
        failure: safeFailure(attempt),
        ...(admin ? {
            providerReference: attempt.providerReference || "",
            rawProviderStatus: attempt.rawProviderStatus || ""
        } : {})
    };
}

function normalizeReceiptEvidence(input = {}) {
    const receiptId = assertId(input.receiptId || input.id, "receiptId");
    const fileReference = normalizeString(input.fileReference || input.storageKey || input.key).slice(0, 500);
    if (!fileReference) throw appError(ERROR_CODES.VALIDATION_ERROR, "fileReference is required.", 400, "receipt");
    const mimeType = normalizeString(input.mimeType || input.contentType);
    if (mimeType && !/^image\/(png|jpe?g|webp|heic|heif)$/i.test(mimeType)) {
        throw appError(ERROR_CODES.VALIDATION_ERROR, "Receipt MIME type is not supported.", 400, "receipt");
    }
    const fileSize = Number(input.fileSize || input.size || 0);
    if (!Number.isFinite(fileSize) || fileSize < 0 || fileSize > 20 * 1024 * 1024) {
        throw appError(ERROR_CODES.VALIDATION_ERROR, "Receipt file size is invalid.", 400, "receipt");
    }
    const checksum = normalizeString(input.checksum || input.sha256);
    return {
        receiptId,
        fileReference,
        mimeType,
        fileSize,
        checksum,
        uploadedAt: input.uploadedAt || new Date().toISOString()
    };
}

function createManualPaymentApplicationService(dependencies = {}) {
    const deps = {
        paymentOrchestrator: dependencies.paymentOrchestrator || null,
        paymentAttemptRepository: dependencies.paymentAttemptRepository || paymentAttemptRepository,
        commerceOrderRepository: dependencies.commerceOrderRepository || orderRepository,
        receiptEvidenceService: dependencies.receiptEvidenceService || null,
        transactionRunner: dependencies.transactionRunner || defaultTransactionRunner,
        auditLogger: dependencies.auditLogger || { write: async () => null },
        notificationPort: dependencies.notificationPort || { publish: async () => null },
        manualPromptPayConfigurationProvider: dependencies.manualPromptPayConfigurationProvider || defaultManualPromptPayConfigurationProvider,
        manualAdminConfigurationProvider: dependencies.manualAdminConfigurationProvider || defaultManualAdminConfigurationProvider,
        providerOptions: dependencies.providerOptions || {},
        clock: dependencies.clock || (() => new Date()),
        idGenerator: dependencies.idGenerator || ((prefix = "ID") => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`),
        logger: dependencies.logger || console
    };
    const orchestrator = deps.paymentOrchestrator || createPaymentOrchestrator({
        orderRepository: deps.commerceOrderRepository,
        paymentAttemptPort: deps.paymentAttemptRepository,
        providerResolver: createProviderResolver(deps.manualPromptPayConfigurationProvider, deps.providerOptions, deps.manualAdminConfigurationProvider),
        transactionRunner: deps.transactionRunner,
        clock: deps.clock,
        idGenerator: deps.idGenerator,
        logger: deps.logger
    });

    async function loadOwnedManualOrder(orderId, owner) {
        const order = await deps.commerceOrderRepository.findOwnedOrderById({ orderId, owner });
        if (!order) throw appError(ERROR_CODES.NOT_FOUND, "Commerce order was not found.", 404, "order");
        if (!isSupportedManualOrder(order)) {
            throw appError(ERROR_CODES.UNSUPPORTED_PAYMENT_METHOD, "Commerce order is not configured for manual payment.", 422, "payment");
        }
        return order;
    }

    async function loadOperationalAttempt(attemptId) {
        const attempt = await deps.paymentAttemptRepository.findAttemptById({ attemptId });
        if (!attempt) throw appError(ERROR_CODES.NOT_FOUND, "Payment attempt was not found.", 404, "attempt");
        if (!MANUAL_PROVIDER_IDS.has(normalizeUpper(attempt.provider))) {
            throw appError(ERROR_CODES.UNSUPPORTED_PAYMENT_METHOD, "Payment attempt is not a supported manual payment.", 422, "attempt");
        }
        const order = await deps.commerceOrderRepository.findOrderById(attempt.orderId);
        if (!order) throw appError(ERROR_CODES.NOT_FOUND, "Commerce order was not found.", 404, "order");
        return { attempt, order };
    }

    async function audit(action, input = {}) {
        try {
            if (typeof deps.auditLogger.write === "function") return await deps.auditLogger.write({ action, ...input });
            if (typeof deps.auditLogger === "function") return await deps.auditLogger({ action, ...input });
        } catch (error) {
            deps.logger?.warn?.("Commerce manual payment audit failed:", error?.message || error);
        }
        return null;
    }

    async function notify(event, payload) {
        try {
            if (typeof deps.notificationPort.publish === "function") await deps.notificationPort.publish(event, payload);
            else if (typeof deps.notificationPort === "function") await deps.notificationPort(event, payload);
        } catch (error) {
            deps.logger?.warn?.("Commerce manual payment notification failed:", error?.message || error);
        }
    }

    async function updatePromotionRedemptionSnapshot(order, snapshot) {
        if (!order?.orderId || !snapshot || typeof deps.commerceOrderRepository.setPromotionRedemptionSnapshot !== "function") {
            return order;
        }
        return deps.commerceOrderRepository.setPromotionRedemptionSnapshot({
            orderId: order.orderId,
            promotionRedemptionSnapshot: snapshot,
            changedAt: deps.clock()
        });
    }

    async function reconcilePromotionAfterPayment({ order, transition }) {
        try {
            const snapshot = transition === "approved"
                ? await consumeCommercePromotion(order)
                : await releaseCommercePromotion(order);
            return await updatePromotionRedemptionSnapshot(order, snapshot);
        } catch (error) {
            // The trusted payment event is already persisted. Secondary reconciliation
            // must not make a successful payment transition look like a failure.
            deps.logger?.warn?.("Commerce promotion reconciliation failed after manual payment transition:", {
                orderId: order?.orderId || "",
                transition,
                code: error?.code || error?.name || "UNKNOWN"
            });
            return order;
        }
    }

    async function initiateManualPayment(input = {}) {
        try {
            const owner = normalizeOwner(input.owner || {});
            const orderId = assertId(input.orderId, "orderId");
            const order = await loadOwnedManualOrder(orderId, owner);
            const idempotencyKey = normalizeString(input.idempotencyKey || `manual:${orderId}`);
            const result = await orchestrator.initiatePayment({ orderId, owner, idempotencyKey, traceId: input.traceId });
            const attempt = await deps.paymentAttemptRepository.findAttemptById({ attemptId: result.attemptId });
            await audit("COMMERCE_MANUAL_PAYMENT_INITIATED", { actor: input.actor || owner, resourceId: result.attemptId, metadata: { orderId } });
            return toSafePaymentView({ order, attempt, paymentResult: result });
        } catch (error) {
            throw mapPaymentError(error, "initiate");
        }
    }

    async function getManualPayment(input = {}) {
        try {
            const owner = normalizeOwner(input.owner || {});
            const orderId = assertId(input.orderId, "orderId");
            const order = await loadOwnedManualOrder(orderId, owner);
            const attempt = input.attemptId
                ? await deps.paymentAttemptRepository.findAttemptByIdForOwner({ attemptId: assertId(input.attemptId, "attemptId"), owner })
                : await deps.paymentAttemptRepository.findActiveAttemptForOrder({ orderId, owner });
            if (!attempt || normalizeString(attempt.orderId) !== orderId) {
                throw appError(ERROR_CODES.NOT_FOUND, "Payment attempt was not found.", 404, "attempt");
            }
            return toSafePaymentView({ order, attempt });
        } catch (error) {
            throw mapPaymentError(error, "read");
        }
    }

    async function resumeOrRetryManualPayment(input = {}) {
        try {
            const owner = normalizeOwner(input.owner || {});
            const orderId = assertId(input.orderId, "orderId");
            const order = await loadOwnedManualOrder(orderId, owner);
            const active = await deps.paymentAttemptRepository.findActiveAttemptForOrder({ orderId, owner });
            if (active) return toSafePaymentView({ order, attempt: active });

            const attempts = await deps.paymentAttemptRepository.findAttemptsForOrder({ orderId });
            const retryable = attempts.find(attempt =>
                ["FAILED", "EXPIRED"].includes(normalizeUpper(attempt.status))
            );
            if (!retryable) {
                throw appError(ERROR_CODES.INVALID_STATE, "No retryable payment attempt is available.", 409, "retry");
            }
            const result = await orchestrator.retryPayment({
                attemptId: retryable.attemptId,
                owner,
                idempotencyKey: `${retryable.attemptId}:retry`,
                traceId: input.traceId
            });
            const attempt = await deps.paymentAttemptRepository.findAttemptById({ attemptId: result.attemptId });
            await audit("COMMERCE_MANUAL_PAYMENT_RETRIED", {
                actor: input.actor || owner,
                resourceId: result.attemptId,
                metadata: { orderId, previousAttemptId: retryable.attemptId }
            });
            return toSafePaymentView({ order, attempt, paymentResult: result });
        } catch (error) {
            throw mapPaymentError(error, "retry");
        }
    }

    async function attachReceiptEvidence(input = {}) {
        try {
            const owner = normalizeOwner(input.owner || {});
            const orderId = assertId(input.orderId, "orderId");
            const attemptId = assertId(input.attemptId, "attemptId");
            const order = await loadOwnedManualOrder(orderId, owner);
            const attempt = await deps.paymentAttemptRepository.findAttemptByIdForOwner({ attemptId, owner });
            if (!attempt || attempt.orderId !== orderId) throw appError(ERROR_CODES.NOT_FOUND, "Payment attempt was not found.", 404, "attempt");
            if (!MANUAL_PROVIDER_IDS.has(normalizeUpper(attempt.provider))) {
                throw appError(ERROR_CODES.UNSUPPORTED_PAYMENT_METHOD, "Receipt attempt is not a supported manual payment.", 422, "receipt");
            }
            if (!ACTIVE_EVIDENCE_STATUSES.has(normalizeUpper(attempt.status))) {
                throw appError(ERROR_CODES.INVALID_STATE, "Receipt cannot be attached to this payment state.", 409, "receipt");
            }
            const evidence = normalizeReceiptEvidence(input.receiptEvidence || input.evidence || {});
            const changedAt = deps.clock();
            const updatedAttempt = await deps.transactionRunner(async transactionContext => {
                const boundAttempt = await deps.paymentAttemptRepository.attachReceiptEvidence({
                    attemptId,
                    orderId,
                    evidence,
                    changedAt,
                    transactionContext
                });
                if (typeof deps.commerceOrderRepository.appendOperationalReference === "function") {
                    await deps.commerceOrderRepository.appendOperationalReference({
                        orderId,
                        owner,
                        changedAt,
                        reference: {
                            type: "manual_payment_receipt",
                            attemptId,
                            receiptId: evidence.receiptId,
                            checksum: evidence.checksum
                        }
                    }, { transactionContext });
                }
                return boundAttempt;
            });
            await audit("COMMERCE_MANUAL_PAYMENT_RECEIPT_ATTACHED", { actor: input.actor || owner, resourceId: attemptId, metadata: { orderId, receiptId: evidence.receiptId } });
            await notify("commerce.manualPayment.receiptAttached", { orderId, attemptId, receiptId: evidence.receiptId });
            return toSafePaymentView({ order, attempt: updatedAttempt });
        } catch (error) {
            if (input.storageCommitted === true && !error.recoverableEvidenceBinding) error.recoverableEvidenceBinding = true;
            throw mapPaymentError(error, "receipt");
        }
    }

    async function approveManualPayment(input = {}) {
        try {
            const admin = normalizeAdmin(input.admin || {});
            const attemptId = assertId(input.attemptId, "attemptId");
            const { attempt, order } = await loadOperationalAttempt(attemptId);
            const receipt = attempt.safeMetadata?.receiptEvidence || null;
            if (attempt.safeMetadata?.receiptRequired !== false && !receipt?.receiptId) throw appError(ERROR_CODES.INVALID_STATE, "Manual payment approval requires receipt evidence.", 409, "approval");
            const providerEventId = normalizeString(input.providerEventId || deps.idGenerator("manual-approval"));
            const result = await orchestrator.handleProviderEvent({
                trustedOperational: true,
                providerEvent: {
                    provider: normalizeUpper(attempt.provider),
                    providerReference: attempt.providerReference,
                    providerEventId,
                    eventType: "MANUAL_PAYMENT_APPROVED",
                    amount: attempt.amount,
                    currency: attempt.currency,
                    occurredAt: deps.clock().toISOString(),
                    metadata: {
                        receiptId: receipt.receiptId,
                        verifiedBy: admin.adminId,
                        verificationMethod: "admin_manual",
                        note: normalizeString(input.note)
                    }
                }
            });
            const updatedAttempt = await deps.paymentAttemptRepository.findAttemptById({ attemptId });
            let updatedOrder = await deps.commerceOrderRepository.findOrderById(order.orderId);
            updatedOrder = await reconcilePromotionAfterPayment({ order: updatedOrder, transition: "approved" });
            await audit("COMMERCE_MANUAL_PAYMENT_APPROVED", { actor: admin, resourceId: attemptId, metadata: { orderId: order.orderId } });
            await notify("commerce.manualPayment.approved", { orderId: order.orderId, attemptId });
            return toSafePaymentView({ order: updatedOrder, attempt: updatedAttempt, paymentResult: result, admin: true });
        } catch (error) {
            deps.logger?.error?.("Commerce manual payment approval failed", {
                stage: error?.stage || "approval",
                code: error?.code || error?.name || "UNKNOWN",
                causeCode: error?.causeCode || "",
                retryable: error?.retryable === true
            });
            throw mapPaymentError(error, "approval");
        }
    }

    async function rejectManualPayment(input = {}) {
        try {
            const admin = normalizeAdmin(input.admin || {});
            const reason = normalizeString(input.reason || input.note);
            if (!reason) throw appError(ERROR_CODES.VALIDATION_ERROR, "Rejection reason is required.", 400, "rejection");
            const attemptId = assertId(input.attemptId, "attemptId");
            const { attempt, order } = await loadOperationalAttempt(attemptId);
            const providerEventId = normalizeString(input.providerEventId || deps.idGenerator("manual-rejection"));
            const result = await orchestrator.handleProviderEvent({
                trustedOperational: true,
                providerEvent: {
                    provider: normalizeUpper(attempt.provider),
                    providerReference: attempt.providerReference,
                    providerEventId,
                    eventType: "MANUAL_PAYMENT_REJECTED",
                    amount: attempt.amount,
                    currency: attempt.currency,
                    occurredAt: deps.clock().toISOString(),
                    metadata: {
                        verifiedBy: admin.adminId,
                        verificationMethod: "admin_manual",
                        note: reason
                    }
                }
            });
            const updatedAttempt = await deps.paymentAttemptRepository.findAttemptById({ attemptId });
            let updatedOrder = await deps.commerceOrderRepository.findOrderById(order.orderId);
            updatedOrder = await reconcilePromotionAfterPayment({ order: updatedOrder, transition: "rejected" });
            await audit("COMMERCE_MANUAL_PAYMENT_REJECTED", { actor: admin, resourceId: attemptId, metadata: { orderId: order.orderId, reason } });
            await notify("commerce.manualPayment.rejected", { orderId: order.orderId, attemptId });
            return toSafePaymentView({ order: updatedOrder, attempt: updatedAttempt, paymentResult: result, admin: true });
        } catch (error) {
            throw mapPaymentError(error, "rejection");
        }
    }

    async function expireManualPayment(input = {}) {
        try {
            const owner = input.admin ? null : normalizeOwner(input.owner || {});
            const attemptId = assertId(input.attemptId, "attemptId");
            const result = owner
                ? await orchestrator.expirePayment({ attemptId, owner })
                : await orchestrator.expirePayment({ attemptId, owner: normalizeOwner(input.owner || {}) });
            const updatedAttempt = await deps.paymentAttemptRepository.findAttemptById({ attemptId });
            if (updatedAttempt?.orderId) {
                const updatedOrder = await deps.commerceOrderRepository.findOrderById(updatedAttempt.orderId);
                const releasedRedemption = await releaseCommercePromotion(updatedOrder);
                await updatePromotionRedemptionSnapshot(updatedOrder, releasedRedemption);
            }
            return toSafePaymentView({ paymentResult: result });
        } catch (error) {
            throw mapPaymentError(error, "expiry");
        }
    }

    async function cancelManualPayment(input = {}) {
        try {
            const owner = normalizeOwner(input.owner || {});
            const attemptId = assertId(input.attemptId, "attemptId");
            const result = await orchestrator.cancelPayment({ attemptId, owner });
            const updatedAttempt = await deps.paymentAttemptRepository.findAttemptById({ attemptId });
            if (updatedAttempt?.orderId) {
                const updatedOrder = await deps.commerceOrderRepository.findOrderById(updatedAttempt.orderId);
                const releasedRedemption = await releaseCommercePromotion(updatedOrder);
                await updatePromotionRedemptionSnapshot(updatedOrder, releasedRedemption);
            }
            return toSafePaymentView({ paymentResult: result });
        } catch (error) {
            throw mapPaymentError(error, "cancel");
        }
    }

    return Object.freeze({
        initiateManualPayment,
        getManualPayment,
        resumeOrRetryManualPayment,
        attachReceiptEvidence,
        approveManualPayment,
        rejectManualPayment,
        expireManualPayment,
        cancelManualPayment,
        toSafePaymentView
    });
}

module.exports = Object.freeze({
    createManualPaymentApplicationService,
    ManualPaymentApplicationError,
    ERROR_CODES,
    SERVICE_VERSION
});
