"use strict";

const orderRepository = require("./orderRepository");
const paymentAttemptRepository = require("./paymentAttemptRepository");

const SERVICE_VERSION = "commerce.payment-recovery.v1";
const MANUAL_PROMPTPAY_PROVIDER = "MANUAL_PROMPTPAY";
const MANUAL_ADMIN_PROVIDER = "MANUAL_ADMIN";
const MANUAL_PROMPTPAY_PROVIDER_ALIASES = Object.freeze(["promptpay", MANUAL_PROMPTPAY_PROVIDER, MANUAL_ADMIN_PROVIDER]);
const RECOVERABLE_STATUSES = Object.freeze(["PENDING"]);
const RECOVERABLE_ORDER_STATUSES = Object.freeze(new Set(["pending_payment"]));
const RECOVERABLE_ORDER_PAYMENT_STATUSES = Object.freeze(new Set(["pending", "unpaid"]));

class CommercePaymentRecoveryError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "CommercePaymentRecoveryError";
        this.code = code;
        this.httpStatus = options.httpStatus || 400;
        this.stage = String(options.stage || "");
    }
}

function text(value) {
    return String(value || "").trim();
}

function normalizeManualPromptPayProvider(value) {
    const provider = text(value).toUpperCase();
    return provider === "PROMPTPAY" || provider === MANUAL_PROMPTPAY_PROVIDER
        ? MANUAL_PROMPTPAY_PROVIDER
        : "";
}

function normalizeOwner(user = {}, sessionId = "") {
    const userId = text(user.id || user._id || user.userId);
    if (userId) return { type: "USER", userId, sessionId: "" };
    const session = text(sessionId);
    if (session) return { type: "SESSION", userId: "", sessionId: session };
    throw new CommercePaymentRecoveryError("UNAUTHENTICATED", "Authenticated customer is required.", {
        httpStatus: 401,
        stage: "auth"
    });
}

function sameOwner(left = {}, right = {}) {
    if (!left?.type || left.type !== right?.type) return false;
    if (left.type === "USER") return text(left.userId) && text(left.userId) === text(right.userId);
    if (left.type === "SESSION") return text(left.sessionId) && text(left.sessionId) === text(right.sessionId);
    return false;
}

function hasReceiptEvidence(attempt = {}) {
    return Boolean(
        attempt.safeMetadata?.receiptAttached === true ||
        attempt.safeMetadata?.receiptEvidence?.receiptId ||
        attempt.safeMetadata?.receiptEvidence?.fileReference
    );
}

function notExpired(attempt = {}, now = new Date()) {
    const expiresAt = attempt.expiresAt ? new Date(attempt.expiresAt) : null;
    return Boolean(expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt > now);
}

function orderRecoverable(order = {}) {
    const status = text(order.status).toLowerCase();
    const paymentStatus = text(order.paymentStatus || order.payment?.status).toLowerCase();
    return RECOVERABLE_ORDER_STATUSES.has(status) && RECOVERABLE_ORDER_PAYMENT_STATUSES.has(paymentStatus);
}

function attemptRecoverable(attempt = {}, order = {}, owner = {}, now = new Date()) {
    if (!attempt?.attemptId || !order?.orderId) return false;
    if (!sameOwner(owner, attempt.owner) || !sameOwner(owner, order.owner)) return false;
    const provider = text(attempt.provider).toUpperCase();
    if (!normalizeManualPromptPayProvider(provider) && provider !== MANUAL_ADMIN_PROVIDER) return false;
    if (!RECOVERABLE_STATUSES.includes(text(attempt.status).toUpperCase())) return false;
    if (!notExpired(attempt, now)) return false;
    if (!orderRecoverable(order)) return false;
    if (provider === MANUAL_ADMIN_PROVIDER) return true;
    if (hasReceiptEvidence(attempt)) return false;
    const qr = attempt.qr || {};
    return Boolean(qr.image && (qr.mode || "aziel_promptpay_dynamic") === "aziel_promptpay_dynamic");
}

function projectRecoverableManualAdminAttempt({ attempt = {}, order = {}, now = new Date() } = {}) {
    const product = order.product || {}, commercial = order.commercial || {}, instructions = attempt.paymentInstructions || {}, qr = attempt.qr || null;
    const receiptSubmitted = hasReceiptEvidence(attempt);
    const reference = instructions.reference || attempt.providerReference || attempt.attemptId;
    return {
        architecture: "commerce", commerce: true, commerceRecoveryVersion: SERVICE_VERSION,
        orderId: order.orderId || attempt.orderId || "", commerceOrderId: order.orderId || attempt.orderId || "", quoteId: order.quoteId || attempt.quoteId || "", attemptId: attempt.attemptId || "",
        reference, orderReference: reference, productCode: product.gameCode || product.gameId || "", productName: product.gameName || "", packageCode: product.packageCode || "", packageName: product.packageName || "",
        gameUserData: { userId: order.fulfilment?.input?.userId || "", zoneId: order.fulfilment?.input?.zoneId || "" }, amount: Number(attempt.amount ?? commercial.totalAmount ?? 0), currency: attempt.currency || commercial.currency || "", region: attempt.region || commercial.region || "",
        paymentMethod: attempt.paymentMethod || attempt.paymentMethodId || order.payment?.paymentMethodId || "", paymentType: "manual", provider: "MANUAL_ADMIN", paymentName: instructions.title || "Manual Payment",
        qrMode: qr?.mode || "none", qrImage: qr?.image || "", accountName: instructions.accountName || "", accountNumber: instructions.accountNumber || "", confirmationMode: "manual_admin",
        receiptUploadEnabled: instructions.receiptUploadEnabled !== false, slipRequired: instructions.slipRequired !== false, enableOpenApp: instructions.enableOpenApp === true, openAppMode: instructions.openAppMode || "disabled", deepLinkUrl: instructions.deepLinkUrl || "", appDisplayName: instructions.appDisplayName || "",
        instructions: cloneInstructions(instructions), createdAt: attempt.createdAt || order.createdAt || "", expiresAt: attempt.expiresAt || "", recoverableExpiresAt: attempt.expiresAt || "", remainingSeconds: remainingSeconds(attempt, now),
        receiptSubmitted, resumable: !receiptSubmitted,
        dynamicQr: qr?.image ? { orderReference: reference, encodedReference: qr.encodedReference || "", qrImage: qr.image, expiresAt: attempt.expiresAt || "" } : null
    };
}

function cloneInstructions(value) { return value && typeof value === "object" ? structuredClone(value) : {}; }

function remainingSeconds(attempt = {}, now = new Date()) {
    const expiresAt = attempt.expiresAt ? new Date(attempt.expiresAt) : null;
    if (!expiresAt || !Number.isFinite(expiresAt.getTime())) return 0;
    return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}

function projectRecoverableCommerceAttempt({ attempt = {}, order = {}, now = new Date() } = {}) {
    const product = order.product || {};
    const commercial = order.commercial || {};
    const qr = attempt.qr || {};
    const instructions = attempt.paymentInstructions || {};
    const orderReference = qr.encodedReference || attempt.providerReference || attempt.attemptId;
    return {
        architecture: "commerce",
        commerce: true,
        commerceRecoveryVersion: SERVICE_VERSION,
        orderId: order.orderId || attempt.orderId || "",
        commerceOrderId: order.orderId || attempt.orderId || "",
        quoteId: order.quoteId || attempt.quoteId || "",
        attemptId: attempt.attemptId || "",
        attemptReference: orderReference,
        reference: orderReference,
        orderReference,
        productCode: product.gameCode || product.gameId || "",
        gameCode: product.gameCode || product.gameId || "",
        productName: product.gameName || "",
        packageCode: product.packageCode || product.packageId || product.packageRef || "",
        packageName: product.packageName || "",
        gameUserData: {
            userId: order.fulfilment?.input?.userId || order.fulfilment?.input?.playerId || "",
            zoneId: order.fulfilment?.input?.zoneId || order.fulfilment?.input?.serverId || ""
        },
        amount: Number(attempt.amount ?? commercial.totalAmount ?? 0),
        originalAmount: Number(commercial.originalUnitPrice ?? commercial.totalAmount ?? attempt.amount ?? 0),
        discountAmount: Number(commercial.discountAmount || 0),
        finalAmount: Number(attempt.amount ?? commercial.totalAmount ?? 0),
        promoCode: order.promotion?.code || order.promotionSnapshot?.code || "",
        promoSnapshot: order.promotion || order.promotionSnapshot || null,
        currency: attempt.currency || commercial.currency || "",
        region: attempt.region || commercial.region || product.region || "",
        paymentMethod: attempt.paymentMethod || order.payment?.paymentMethodId || "promptpay",
        paymentType: "manual",
        provider: "promptpay",
        paymentName: instructions.title || "PromptPay QR",
        qrMode: qr.mode || "aziel_promptpay_dynamic",
        confirmationMode: attempt.confirmationMode || instructions.confirmationMode || "manual_admin",
        receiptUploadEnabled: true,
        slipRequired: true,
        checklistSteps: Array.isArray(instructions.steps) ? instructions.steps : [],
        instructions: {
            method: instructions.title || "PromptPay QR",
            key: attempt.paymentMethod || "promptpay",
            qrMode: qr.mode || "aziel_promptpay_dynamic",
            confirmationMode: attempt.confirmationMode || instructions.confirmationMode || "manual_admin",
            enableSaveQr: true,
            enableOpenApp: true,
            enableChecklist: true,
            dynamicQrSupported: true,
            amountPrefillSupported: true,
            referenceSupported: true,
            galleryScanSupported: true,
            receiptUploadEnabled: true,
            slipRequired: true,
            openAppMode: "bank_chooser",
            appLaunchMode: "APP_ONLY",
            appDisplayName: "PromptPay",
            bankLaunchers: []
        },
        createdAt: attempt.createdAt || order.createdAt || "",
        expiresAt: attempt.expiresAt || "",
        recoverableExpiresAt: attempt.expiresAt || "",
        remainingSeconds: remainingSeconds(attempt, now),
        receiptSubmitted: false,
        resumable: true,
        dynamicQr: {
            orderReference,
            encodedReference: qr.encodedReference || "",
            qrImage: qr.image || "",
            expiresAt: attempt.expiresAt || ""
        }
    };
}

function createCommercePaymentRecoveryService(dependencies = {}) {
    const deps = {
        paymentAttemptRepository:
            dependencies.paymentAttemptRepository ||
            paymentAttemptRepository,

        commerceOrderRepository:
            dependencies.commerceOrderRepository ||
            orderRepository,

        clock:
            dependencies.clock ||
            (() => new Date())
    };

    async function listRecoverablePayments(input = {}) {
        const owner = normalizeOwner(
            input.user || {},
            input.sessionId || ""
        );

        const now = deps.clock();

        const attemptGroups = await Promise.all(
            MANUAL_PROMPTPAY_PROVIDER_ALIASES.map(provider =>
                deps.paymentAttemptRepository.findAttemptsForOwner({
                    owner,
                    provider,
                    statuses: RECOVERABLE_STATUSES,
                    expiresAfter: now,
                    limit: input.limit || 25
                })
            )
        );

        const attempts = attemptGroups.flat();

        const safeAttempts = Array.from(
            new Map(
                (Array.isArray(attempts) ? attempts : [])
                    .filter(attempt => attempt?.attemptId)
                    .map(attempt => [attempt.attemptId, attempt])
            ).values()
        );

        const orderIds = Array.from(
            new Set(
                safeAttempts
                    .map(attempt => attempt?.orderId)
                    .filter(Boolean)
            )
        );

        let orders = [];

        if (
            orderIds.length > 0 &&
            typeof deps.commerceOrderRepository
                ?.findOwnedOrdersByIds === "function"
        ) {
            orders =
                await deps.commerceOrderRepository
                    .findOwnedOrdersByIds({
                        orderIds,
                        owner
                    });
        }

        const safeOrders = Array.isArray(orders)
            ? orders
            : [];

        const orderById = new Map(
            safeOrders.map(order => [
                order.orderId,
                order
            ])
        );

        const recoverable = [];

        for (const attempt of safeAttempts) {
            const order =
                orderById.get(attempt.orderId) ||
                null;

            if (
                !attemptRecoverable(
                    attempt,
                    order,
                    owner,
                    now
                )
            ) {
                continue;
            }

            recoverable.push(text(attempt.provider).toUpperCase() === MANUAL_ADMIN_PROVIDER
                ? projectRecoverableManualAdminAttempt({ attempt, order, now })
                : projectRecoverableCommerceAttempt({ attempt, order, now }));
        }

        return recoverable;
    }

    /*
     * ဒီ return က createCommercePaymentRecoveryService()
     * အတွင်းမှာရှိရမယ်။
     */
    return Object.freeze({
        listRecoverablePayments
    });
}

module.exports = Object.freeze({
    SERVICE_VERSION,
    RECOVERABLE_STATUSES,
    createCommercePaymentRecoveryService,
    projectRecoverableCommerceAttempt,
    projectRecoverableManualAdminAttempt,
    attemptRecoverable,
    CommercePaymentRecoveryError
});
