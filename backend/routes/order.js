// backend/routes/order.js

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");

const Order = require("../models/Order");
const PaymentMethod = require("../models/PaymentMethod");
const CommerceOrder = require("../models/CommerceOrder");
const PaymentAttempt = require("../models/PaymentAttempt");

const upload = require("../middleware/orderUpload");
const authMiddleware = require("../middleware/authMiddleware");

const { sendTelegramMessage } = require("../services/telegram");

const createNotification = require("../services/createNotification");
const orderEmailService = require("../services/orderEmailService");
const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const realtime = require("../services/realtime");
const {
    NOTE_BY_STATUS,
    ORDER_STATES,
    PAYMENT_STATES,
    OrderStateError,
    emitCommittedTransition,
    getAllowedNextStatuses,
    projectOrderStatus,
    transitionOrder
} = require("../services/orderStateService");
const { CatalogError } = require("../services/catalogService");
const {
    PromoError,
    releasePromoRedemption,
    reservePromoUse,
    resolvePurchasePricing
} = require("../services/promoCodeService");
const { buildOrderCustomerSnapshot } = require("../services/orderCustomerSnapshotService");
const { WalletError, creditRefund } = require("../services/walletService");
const {
    FINANCIAL_OUTCOMES,
    FinancialIntegrityError,
    acquireFinancialOutcome,
    assertRefundApprovalAllowed,
    assertRefundRequestAllowed,
    listFinancialFulfillmentAttempts,
    projectFinancialActions
} = require("../services/financialIntegrityService");
const {
    applyCursorFilter,
    escapeRegex,
    normalizeSearch,
    pageResult,
    parseLimit,
    sendPaginationError
} = require("../services/paginationService");
const { getActivePendingOrderPolicy } = require("../services/pendingOrderPolicy");
const { normalizePaymentKey } = require("../services/manualPaymentAttemptService");
const { getOrderFulfillmentSummary } = require("../services/fulfillmentService");
const {
    StorageError,
    cleanupAfterFailedPersistence,
    logStorageError,
    uploadFile
} = require("../services/storageService");

const COMMERCE_MANUAL_PROVIDER = "MANUAL_PROMPTPAY";

function commerceCoreDisabledLegacyPayableResponse(res, legacyFlow) {
    return res.status(410).json({
        success: false,
        code: "LEGACY_PAYABLE_CREATION_DISABLED",
        message: "New payable checkout creation is handled by AZIEL Commerce Core.",
        legacyFlow,
        commerceAuthority: "CommerceOrder + PaymentAttempt"
    });
}

function getCurrencyKey(currency) {
    return String(currency || "").toUpperCase() === "THB" ? "THB" : "MMK";
}

const orderCreateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_ORDER_CREATE || 12),
    standardHeaders: true,
    legacyHeaders: false
});

function getRefundAllowedStatus(status) {
    return ["failed", "cancelled"].includes(String(status || "").toLowerCase());
}

function isManualPaymentType(value) {
    return ["manual", "deeplink"].includes(String(value || "").toLowerCase());
}

function getAuthenticatedUsername(req) {
    return req.user?.username || "";
}

function publicTrackingOrder(order, fulfillmentAttempts = []) {
    const actions = projectFinancialActions(order, fulfillmentAttempts);
    return {
        orderId: order.orderId,
        game: order.game,
        userId: order.userId,
        zoneId: order.zoneId || "",
        packageName: order.packageName,
        selectedPackage: order.packageName,
        amount: order.amount,
        currency: order.currency,
        region: order.region,
        paymentMethod: order.paymentMethod,
        status: order.status,
        paymentStatus: order.paymentStatus || (order.status === "paid" ? "paid" : "pending"),
        note: order.note,
        timeline: Array.isArray(order.timeline) ? order.timeline : [],
        refundRequested: order.refundRequested,
        refundRequestReason: order.refundRequestReason,
        refundRequestedAt: order.refundRequestedAt,
        refunded: order.refunded,
        refundAmount: order.refundAmount,
        refundReason: order.refundReason,
        refundRejectedReason: order.refundRejectedReason,
        refundMethod: order.refundMethod,
        refundedAt: order.refundedAt,
        actions,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
    };
}

function hasManualPaymentEvidence(order = {}) {
    return Boolean(
        order.paymentSlip ||
        order.paymentEvidence?.url ||
        order.paymentEvidence?.key ||
        order.paymentEvidence?.storageKey
    );
}

function hasCommercePaymentEvidence(attempt = {}) {
    return Boolean(attempt.safeMetadata?.receiptAttached && attempt.safeMetadata?.receiptEvidence?.fileReference);
}

function commerceAdminId(attempt = {}) {
    return `commerce:${attempt.attemptId || attempt._id || ""}`;
}

function commerceAttemptIdFromAdminId(value = "") {
    const id = String(value || "");
    return id.startsWith("commerce:") ? id.slice("commerce:".length) : "";
}

function commerceOrderIdFromAdminId(value = "") {
    const id = String(value || "");
    return id.startsWith("commerce-order:") ? id.slice("commerce-order:".length) : "";
}

function commerceOrderStatusForAttempt(attempt = {}, order = {}) {
    const status = String(attempt.status || "").toUpperCase();
    if (status === "PAID") return "paid";
    if (status === "FAILED") return "failed";
    if (status === "EXPIRED") return "expired";
    if (status === "CANCELLED") return "cancelled";
    return order.status || "pending_payment";
}

function commercePaymentStatusForAttempt(attempt = {}, order = {}) {
    const status = String(attempt.status || "").toUpperCase();
    if (status === "PAID") return "paid";
    if (status === "FAILED") return "failed";
    if (status === "EXPIRED") return "expired";
    if (status === "CANCELLED") return "cancelled";
    return order.paymentStatus || "pending";
}

function commercePaymentEvidence(attempt = {}) {
    const evidence = attempt.safeMetadata?.receiptEvidence || {};
    if (!evidence.fileReference && !evidence.storageKey) return {};
    return {
        url: evidence.fileReference || "",
        key: evidence.storageKey || evidence.fileReference || "",
        storageKey: evidence.storageKey || "",
        provider: evidence.storageProvider || "",
        mimeType: evidence.mimeType || "",
        size: Number(evidence.fileSize || 0),
        uploadedAt: evidence.uploadedAt || null,
        receiptId: evidence.receiptId || ""
    };
}

function projectCommerceManualAttempt(attempt = {}, order = {}, options = {}) {
    const product = order.product || {};
    const commercial = order.commercial || {};
    const status = commerceOrderStatusForAttempt(attempt, order);
    const paymentStatus = commercePaymentStatusForAttempt(attempt, order);
    const evidence = commercePaymentEvidence(attempt);

    return {
        _id: commerceAdminId(attempt),
        orderId: order.orderId || attempt.orderId || "",
        commerceOrderId: order.orderId || attempt.orderId || "",
        commercePaymentAttemptId: attempt.attemptId || "",
        isCommerceManualPayment: true,
        username: order.owner?.userId || order.customer?.contact?.email || attempt.ownerId || "customer",
        game: product.gameName || product.gameCode || "",
        productCode: product.gameCode || product.gameId || "",
        productName: product.gameName || product.gameCode || "",
        userId: order.owner?.userId || attempt.ownerId || "",
        zoneId: order.fulfilment?.input?.zoneId || order.fulfilment?.input?.serverId || "",
        packageName: product.packageName || product.packageCode || "",
        packageCode: product.packageCode || product.packageId || "",
        amount: Number(attempt.amount ?? commercial.totalAmount ?? 0),
        currency: attempt.currency || commercial.currency || "",
        region: attempt.region || product.region || commercial.region || "",
        paymentMethod: attempt.paymentMethod || order.payment?.paymentMethodId || "promptpay",
        paymentSlip: evidence.url || "",
        paymentEvidence: evidence,
        paymentStatus,
        paymentProvider: attempt.provider || order.payment?.provider || COMMERCE_MANUAL_PROVIDER,
        transactionId: attempt.providerReference || "",
        manualPaymentAttemptId: attempt.attemptId || "",
        note: order.customer?.notes || "",
        status,
        refundRequested: false,
        refunded: false,
        timeline: (attempt.eventHistory || []).map(event => ({
            status: String(event.status || "").toLowerCase(),
            paymentStatus: String(event.status || "").toLowerCase(),
            source: event.eventType || "commerce_manual_payment",
            actorType: "system",
            at: event.receivedAt || event.occurredAt || attempt.updatedAt
        })),
        allowedNextStatuses: status === "pending_payment" && hasCommercePaymentEvidence(attempt) ? ["paid", "failed"] : [],
        fulfillment: {
            status: String(order.fulfilment?.status || "not_started").toUpperCase(),
            source: "commerce"
        },
        fulfillmentAttempts: [],
        actions: {
            canApproveManualPayment: status === "pending_payment",
            canRejectManualPayment: status === "pending_payment"
        },
        hasPaymentEvidence: hasCommercePaymentEvidence(attempt),
        isSummary: options.summary === true,
        createdAt: attempt.createdAt || order.createdAt,
        updatedAt: attempt.updatedAt || order.updatedAt
    };
}

function projectCommerceOrder(order = {}, options = {}) {
    const product = order.product || {};
    const commercial = order.commercial || {};
    const payment = order.payment || {};
    const fulfilmentInput = order.fulfilment?.input || {};
    return {
        _id: options.admin ? `commerce-order:${order.orderId}` : order._id,
        orderId: order.orderId || "",
        commerceOrderId: order.orderId || "",
        isCommerceOrder: true,
        username: options.username || order.owner?.userId || order.customer?.contact?.email || "customer",
        game: product.gameName || product.gameCode || "",
        productCode: product.gameCode || product.gameId || "",
        productName: product.gameName || product.gameCode || "",
        userId: fulfilmentInput.gameAccount?.userId || fulfilmentInput.userId || order.owner?.userId || "",
        zoneId: fulfilmentInput.gameAccount?.zoneId || fulfilmentInput.zoneId || fulfilmentInput.serverId || "",
        packageName: product.packageName || product.packageCode || "",
        packageCode: product.packageCode || product.packageId || "",
        amount: Number(commercial.totalAmount || 0),
        originalAmount: Number(commercial.originalUnitPrice || 0),
        discountAmount: Number(commercial.discountAmount || 0),
        finalAmount: Number(commercial.totalAmount || 0),
        currency: commercial.currency || "",
        region: commercial.region || product.region || "",
        paymentMethod: payment.paymentMethodId || "",
        paymentStatus: order.paymentStatus || payment.status || "",
        paymentProvider: payment.provider || "",
        transactionId: "",
        note: order.customer?.notes || "",
        status: order.status || "",
        refundRequested: false,
        refunded: false,
        allowedNextStatuses: getAllowedNextStatuses(order.status),
        fulfillment: {
            status: String(order.fulfilment?.status || "not_started").toUpperCase(),
            source: "commerce"
        },
        fulfillmentAttempts: [],
        actions: {},
        hasPaymentEvidence: false,
        isSummary: options.summary === true,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
    };
}

async function listCommerceManualReviewOrders({ search = "", cursor = "", limit = 50 } = {}) {
    const query = {
        provider: COMMERCE_MANUAL_PROVIDER,
        status: "PENDING",
        "safeMetadata.receiptAttached": true,
        "safeMetadata.receiptEvidence.fileReference": { $type: "string", $ne: "" }
    };

    if (search) {
        const escaped = escapeRegex(search);
        query.$or = [
            { orderId: { $regex: `^${escaped}`, $options: "i" } },
            { ownerId: { $regex: `^${escaped}`, $options: "i" } },
            { attemptId: { $regex: `^${escaped}`, $options: "i" } }
        ];
    }

    const attempts = await PaymentAttempt.find(applyCursorFilter(query, cursor))
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();
    const { page, pagination } = pageResult(attempts, limit);
    const orderIds = [...new Set(page.map(attempt => attempt.orderId).filter(Boolean))];
    const orders = await CommerceOrder.find({ orderId: { $in: orderIds } }).lean();
    const orderById = new Map(orders.map(order => [order.orderId, order]));

    const items = page.map(attempt => projectCommerceManualAttempt(attempt, orderById.get(attempt.orderId) || {}, { summary: true }));

    return { items, pagination };
}

async function listCommerceOrdersForAdmin({ status = "", search = "", limit = 50 } = {}) {
    const query = {};
    if (status && [
        "pending_payment",
        "paid",
        "processing",
        "completed",
        "cancelled",
        "failed",
        "expired",
        "refund_pending",
        "refunded"
    ].includes(status)) {
        query.status = status;
    }
    if (search) {
        const escaped = escapeRegex(search);
        query.$or = [
            { orderId: { $regex: `^${escaped}`, $options: "i" } },
            { "owner.userId": { $regex: `^${escaped}`, $options: "i" } }
        ];
    }
    const orders = await CommerceOrder.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .lean();
    return orders.map(order => projectCommerceOrder(order, { admin: true, summary: true }));
}

async function getCommerceManualOrderForAdmin(id = "", options = {}) {
    const attemptId = commerceAttemptIdFromAdminId(id) || id;
    if (!attemptId) return null;
    const attempt = await PaymentAttempt.findOne({
        attemptId,
        provider: COMMERCE_MANUAL_PROVIDER
    }).lean();
    if (!attempt) return null;
    const order = await CommerceOrder.findOne({ orderId: attempt.orderId }).lean();
    return projectCommerceManualAttempt(attempt, order || {}, options);
}

async function getCommerceOrderForAdmin(id = "", options = {}) {
    const orderId = commerceOrderIdFromAdminId(id);
    if (!orderId) return null;
    const order = await CommerceOrder.findOne({ orderId }).lean();
    return order ? projectCommerceOrder(order, { admin: true, ...options }) : null;
}

function projectAdminOrder(order, fulfillmentAttempts = []) {
    const latestFulfillment = fulfillmentAttempts[0] || null;
    const actions = projectFinancialActions(order, fulfillmentAttempts);
    return {
        _id: order._id,
        orderId: order.orderId,
        username: order.username,
        game: order.game,
        productCode: order.productCode || "",
        productName: order.productName || order.game || "",
        userId: order.userId,
        zoneId: order.zoneId || "",
        packageName: order.packageName,
        packageCode: order.packageCode || "",
        amount: order.amount,
        currency: order.currency,
        region: order.region,
        paymentMethod: order.paymentMethod,
        paymentSlip: order.paymentSlip || "",
        paymentEvidence: order.paymentEvidence || {},
        paymentStatus: order.paymentStatus || "",
        paymentProvider: order.paymentProvider || "",
        transactionId: order.transactionId || "",
        manualPaymentAttemptId: order.manualPaymentAttemptId || "",
        note: order.note || "",
        status: order.status,
        refundRequested: Boolean(order.refundRequested),
        refundRequestReason: order.refundRequestReason || "",
        refundRequestedAt: order.refundRequestedAt || null,
        refunded: Boolean(order.refunded),
        refundAmount: order.refundAmount || 0,
        refundReason: order.refundReason || "",
        refundRejectedReason: order.refundRejectedReason || "",
        refundMethod: order.refundMethod || "",
        refundedAt: order.refundedAt || null,
        timeline: Array.isArray(order.timeline) ? order.timeline : [],
        allowedNextStatuses: getAllowedNextStatuses(order.status),
        fulfillment: latestFulfillment,
        fulfillmentAttempts,
        actions,
        hasPaymentEvidence: hasManualPaymentEvidence(order),
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
    };
}

function projectAdminOrderSummary(order, fulfillmentAttempts = []) {
    const latestFulfillment = fulfillmentAttempts[0] || null;
    const actions = projectFinancialActions(order, fulfillmentAttempts);
    return {
        _id: order._id,
        orderId: order.orderId,
        username: order.username,
        game: order.game,
        productCode: order.productCode || "",
        productName: order.productName || order.game || "",
        userId: order.userId,
        zoneId: order.zoneId || "",
        packageName: order.packageName,
        packageCode: order.packageCode || "",
        amount: order.amount,
        currency: order.currency,
        region: order.region,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus || "",
        paymentProvider: order.paymentProvider || "",
        transactionId: order.transactionId || "",
        note: order.note || "",
        status: order.status,
        refundRequested: Boolean(order.refundRequested),
        refunded: Boolean(order.refunded),
        allowedNextStatuses: getAllowedNextStatuses(order.status),
        fulfillment: latestFulfillment,
        actions,
        hasPaymentEvidence: hasManualPaymentEvidence(order),
        isSummary: true,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
    };
}

// CUSTOMER ORDER HISTORY
router.get("/history/:username", authMiddleware, async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req);
        const [legacyOrders, commerceOrders] = await Promise.all([
            Order.find({
                username
            }).sort({ createdAt: -1 }).lean(),
            CommerceOrder.find({
                "owner.type": "USER",
                "owner.userId": String(req.user?._id || req.user?.id || req.user?.userId || "")
            }).sort({ createdAt: -1 }).lean()
        ]);
        const orders = [
            ...legacyOrders,
            ...commerceOrders.map(order => projectCommerceOrder(order, { username }))
        ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        res.json({ success: true, orders });

    } catch (error) {
        console.log("History error:", error);
        res.json({ success: false, message: "Server error" });
    }
});

// CUSTOMER RECENT ORDERS
router.get("/order/user/:username", authMiddleware, async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req);
        const [legacyOrders, commerceOrders] = await Promise.all([
            Order.find({
                username
            }).sort({ createdAt: -1 }).lean(),
            CommerceOrder.find({
                "owner.type": "USER",
                "owner.userId": String(req.user?._id || req.user?.id || req.user?.userId || "")
            }).sort({ createdAt: -1 }).lean()
        ]);
        const orders = [
            ...legacyOrders,
            ...commerceOrders.map(order => projectCommerceOrder(order, { username }))
        ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        res.json({ success: true, orders });

    } catch (error) {
        console.log("User orders error:", error);
        res.json({ success: false, message: "Server error" });
    }
});

// TRACK SINGLE ORDER
router.get("/order/track/:orderId", async (req, res) => {
    try {
        let order = await Order.findOne({
            orderId: req.params.orderId
        });

        if (!order) {
            const commerceOrder = await CommerceOrder.findOne({ orderId: req.params.orderId }).lean();
            if (commerceOrder) {
                return res.json({
                    success: true,
                    order: projectCommerceOrder(commerceOrder)
                });
            }
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        const attempts = await listFinancialFulfillmentAttempts(order._id);

        res.json({
            success: true,
            order: publicTrackingOrder(order, attempts)
        });

    } catch (error) {
        console.log("Track error:", error);
        res.json({ success: false, message: "Server error" });
    }
});

// AUTHENTICATED CANONICAL ORDER STATUS
router.get("/order/status/:orderId", authMiddleware, async (req, res) => {
    try {
        const order = await Order.findOne({
            orderId: req.params.orderId,
            username: getAuthenticatedUsername(req)
        });

        if (!order) {
            const commerceOrder = await CommerceOrder.findOne({
                orderId: req.params.orderId,
                "owner.type": "USER",
                "owner.userId": String(req.user?._id || req.user?.id || req.user?.userId || "")
            }).lean();
            if (commerceOrder) {
                return res.json({
                    success: true,
                    order: projectCommerceOrder(commerceOrder),
                    allowedNextStatuses: getAllowedNextStatuses(commerceOrder.status)
                });
            }
            return res.status(404).json({
                success: false,
                code: "ORDER_NOT_FOUND",
                message: "Order not found"
            });
        }

        return res.json({
            success: true,
            order: projectOrderStatus(order),
            allowedNextStatuses: getAllowedNextStatuses(order.status)
        });
    } catch (error) {
        console.log("Order status error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// CUSTOMER REQUEST REFUND
// POST /api/order/:orderId/refund-request
router.post("/order/:orderId/refund-request", authMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;
        const username = getAuthenticatedUsername(req);

        if (!reason || !String(reason).trim()) {
            return res.json({
                success: false,
                message: "Refund reason is required"
            });
        }

        let order = await Order.findOne({
            orderId: req.params.orderId,
            username
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        const attempts = await listFinancialFulfillmentAttempts(order._id);
        assertRefundRequestAllowed(order, attempts);

        order.refundRequested = true;
        order.refundRequestReason = String(reason).trim();
        order.refundRequestedAt = new Date();
        const transition = await transitionOrder(order, ORDER_STATES.REFUND_REQUESTED, {
            source: "user",
            actorType: "user",
            actor: username,
            reason: "Customer refund request",
            idempotencyKey: `refund:request:${order.orderId}`
        });
        order = transition.order;

        const notification = await createNotification({
            username: order.username,
            title: "Refund Request Submitted",
            message: `Your refund request for ${order.game} - ${order.packageName} has been submitted.`,
            type: "refund",
            category: "refunds",
            orderId: order.orderId
        });

        realtime.emitAdminOrderUpdate({
            type: "refund_requested",
            orderId: order.orderId,
            username: order.username,
            amount: order.amount,
            currency: order.currency
        });

        await sendTelegramMessage(
            `💸 REFUND REQUESTED

📦 Order:
${order.orderId}

🎮 Game:
${order.game}

📦 Package:
${order.packageName}

👤 User:
${order.username}

💰 Amount:
${order.amount} ${order.currency}

📝 Reason:
${order.refundRequestReason}`
        );

        res.json({
            success: true,
            message: "Refund request submitted",
            order
        });

    } catch (error) {
        console.log("Refund request error:", error);

        if (error instanceof FinancialIntegrityError) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ADMIN GET ALL ORDERS
router.get("/admin/orders", adminMiddleware, requireAdminPermission(PERMISSIONS.ORDERS_READ), async (req, res) => {
    try {
        const query = {};
        const status = String(req.query.status || "").trim();
        const filter = String(req.query.filter || "").trim();
        const search = normalizeSearch(req.query.q || "", { maxLength: 80 });
        const limit = parseLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 });

        if (filter === "manual_review") {
            const { items, pagination } = await listCommerceManualReviewOrders({
                search,
                cursor: req.query.cursor,
                limit
            });

            return res.json({
                success: true,
                items,
                orders: items,
                pagination
            });
        } else if ([
            "pending_payment",
            "paid",
            "processing",
            "completed",
            "cancelled",
            "failed",
            "expired",
            "refund_requested",
            "refund_pending",
            "refund_rejected",
            "refunded"
        ].includes(status)) {
            query.status = status;
        }

        if (search) {
            const escaped = escapeRegex(search);
            const searchOr = [
                { orderId: { $regex: `^${escaped}`, $options: "i" } },
                { username: { $regex: `^${escaped}`, $options: "i" } }
            ];

            if (query.$or) {
                query.$and = [{ $or: query.$or }, { $or: searchOr }];
                delete query.$or;
            } else {
                query.$or = searchOr;
            }
        }

        const pagedQuery = applyCursorFilter(query, req.query.cursor);
        const orders = await Order.find(pagedQuery)
            .select("_id orderId username game productCode productName userId zoneId packageName packageCode amount currency region paymentMethod paymentStatus paymentProvider transactionId note status refundRequested refunded createdAt updatedAt paymentSlip paymentEvidence financialOutcome")
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit + 1)
            .lean();
        const { page, pagination } = pageResult(orders, limit);
        const fulfillmentByOrder = await getOrderFulfillmentSummary(page.map(order => order._id));
        const legacyItems = page.map(order => projectAdminOrderSummary(order, fulfillmentByOrder.get(String(order._id)) || []));
        const commerceItems = await listCommerceOrdersForAdmin({ status, search, limit });
        const items = [...legacyItems, ...commerceItems]
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .slice(0, limit);

        res.json({
            success: true,
            items,
            orders: items,
            pagination
        });

    } catch (error) {
        console.log("Admin orders error:", error);
        const paginationResponse = sendPaginationError(res, error);
        if (paginationResponse) return paginationResponse;
        res.json({ success: false, message: "Server error" });
    }
});

router.get("/admin/orders/:id", adminMiddleware, requireAdminPermission(PERMISSIONS.ORDERS_READ), async (req, res) => {
    try {
        const commerceOrderDetail = await getCommerceOrderForAdmin(req.params.id);
        if (commerceOrderDetail) {
            return res.json({
                success: true,
                order: commerceOrderDetail
            });
        }

        const commerceOrder = await getCommerceManualOrderForAdmin(req.params.id);
        if (commerceOrder) {
            return res.json({
                success: true,
                order: commerceOrder
            });
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        const fulfillmentByOrder = await getOrderFulfillmentSummary([order._id]);
        const attempts = fulfillmentByOrder.get(String(order._id)) || [];

        return res.json({
            success: true,
            order: projectAdminOrder(order, attempts)
        });
    } catch (error) {
        console.log("Admin order detail error:", error);
        return res.json({ success: false, message: "Server error" });
    }
});

// ADMIN UPDATE ORDER STATUS
router.put("/admin/orders/:id/status", adminMiddleware, requireAdminPermission(PERMISSIONS.ORDERS_MANAGE), async (req, res) => {
    try {
        const { status } = req.body;
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        if (status === ORDER_STATES.COMPLETED) {
            const fulfillmentByOrder = await getOrderFulfillmentSummary([order._id]);
            const attempts = fulfillmentByOrder.get(String(order._id)) || [];
            const activeAttempt = attempts.find(attempt => ["PENDING", "IN_PROGRESS"].includes(attempt.status));
            if (activeAttempt) {
                return res.status(409).json({
                    success: false,
                    code: "FULFILLMENT_ACTIVE",
                    message: "Active fulfillment must be resolved before completing this Order."
                });
            }
        }

        const previousStatus = order.status;
        const transition = await transitionOrder(order, status, {
            source: "admin",
            actorType: "admin",
            actor: req.admin?.username || req.user?.username || "admin",
            reason: "Admin status update",
            paymentStatus: status === ORDER_STATES.PAID ? PAYMENT_STATES.PAID : undefined,
            idempotencyKey: `admin:status:${order.orderId}:${status}`
        });

        if (!transition.changed) {
            return res.json({
                success: true,
                order: transition.order,
                allowedNextStatuses: getAllowedNextStatuses(transition.order.status)
            });
        }

        const updatedOrder = transition.order;
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.ORDER_STATUS_CHANGED,
            resourceType: "Order",
            resourceId: updatedOrder.orderId || String(updatedOrder._id),
            metadata: {
                fromStatus: previousStatus,
                toStatus: updatedOrder.status
            }
        }).catch(error => console.log("Admin audit failed:", error.message));

        const notification = await createNotification({
            username: updatedOrder.username,
            title: "Order Status Updated",
            message: `${updatedOrder.game} - ${updatedOrder.packageName} is now ${formatStatusText(updatedOrder.status)}`,
            type: "order",
            category: "orders",
            orderId: updatedOrder.orderId
        });

        await sendTelegramMessage(
            `📦 ORDER STATUS UPDATED

🎮 Game:
${updatedOrder.game}

📦 Package:
${updatedOrder.packageName}

👤 User:
${updatedOrder.username}

📌 Status:
${updatedOrder.status}`
        );

        res.json({
            success: true,
            order: updatedOrder,
            allowedNextStatuses: getAllowedNextStatuses(updatedOrder.status)
        });

    } catch (error) {
        console.log("Update status error:", error);

        res.status(error instanceof OrderStateError ? error.status : 500).json({
            success: false,
            code: error.code || "ORDER_STATUS_UPDATE_FAILED",
            message: error instanceof OrderStateError ? error.message : "Server error"
        });
    }
});

// ADMIN APPROVE REFUND TO WALLET
// POST /api/admin/orders/:id/refund/approve
router.post("/admin/orders/:id/refund/approve", adminMiddleware, requireAdminPermission(PERMISSIONS.ORDERS_MANAGE), async (req, res) => {
    const session = await mongoose.startSession();
    let updatedOrder = null;
    let walletResult = null;
    let timelineEntry = null;
    let refundAmount = 0;
    let currencyKey = "MMK";

    try {
        const { reason } = req.body;

        await session.withTransaction(async () => {
            const order = await Order.findById(req.params.id).session(session);

            if (!order) {
                throw new FinancialIntegrityError("ORDER_NOT_FOUND", "Order not found", 404);
            }

            const attempts = await listFinancialFulfillmentAttempts(order._id, { session });
            assertRefundApprovalAllowed(order, attempts);

            refundAmount = Number(order.amount || 0);
            currencyKey = getCurrencyKey(order.currency);

            if (refundAmount <= 0) {
                throw new FinancialIntegrityError("INVALID_REFUND_AMOUNT", "Invalid refund amount", 400);
            }

            const lockedOrder = await acquireFinancialOutcome(order._id, FINANCIAL_OUTCOMES.REFUND_CREDITED, { session });

            order.financialOutcome = lockedOrder.financialOutcome;
            order.financialOutcomeAt = lockedOrder.financialOutcomeAt;
            order.refunded = true;
            order.refundAmount = refundAmount;
            order.refundReason =
                String(reason || "").trim() ||
                order.refundRequestReason ||
                "Refund approved by admin";
            order.refundMethod = "wallet";
            order.refundedBy = "admin";
            order.refundedAt = new Date();

            walletResult = await creditRefund(order, {
                performedBy: req.admin?.username || req.user?.username || "admin",
                session
            });

            const transition = await transitionOrder(order, ORDER_STATES.REFUNDED, {
                source: "admin",
                actorType: "admin",
                actor: req.admin?.username || req.user?.username || "admin",
                reason: order.refundReason,
                paymentStatus: PAYMENT_STATES.REFUNDED,
                note: `Refunded to wallet. Reason: ${order.refundReason}`,
                idempotencyKey: `refund:approve:${order.orderId}`,
                session,
                emit: false
            });

            updatedOrder = transition.order;
            timelineEntry = transition.timelineEntry || null;
        });

        if (timelineEntry) {
            await emitCommittedTransition(updatedOrder, timelineEntry);
        }

        if (!walletResult.duplicate) {
            await createNotification({
                username: updatedOrder.username,
                title: "Refund Completed",
                message: `${refundAmount.toLocaleString()} ${currencyKey} has been returned to your AZIEL Wallet.`,
                type: "refund",
                category: "refunds",
                orderId: updatedOrder.orderId
            });
        }

        await realtime.emitWalletUpdate(updatedOrder.username, {
            amount: walletResult.balance,
            balance: walletResult.balance,
            currency: currencyKey,
            status: "refund",
            latestTransaction: {
                type: walletResult.transaction?.type || "",
                direction: walletResult.transaction?.direction || "",
                amount: Number(walletResult.transaction?.amount || 0),
                balanceAfter: Number(walletResult.transaction?.balanceAfter ?? walletResult.balance),
                referenceType: walletResult.transaction?.referenceType || "",
                referenceId: walletResult.transaction?.referenceId || updatedOrder.orderId,
                createdAt: walletResult.transaction?.createdAt || new Date()
            }
        });

        realtime.emitAdminOrderUpdate({
            type: "order_refunded",
            orderId: updatedOrder.orderId,
            username: updatedOrder.username,
            amount: refundAmount,
            currency: currencyKey
        });

        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.REFUND_APPROVED,
            resourceType: "Order",
            resourceId: updatedOrder.orderId || String(updatedOrder._id),
            metadata: {
                financialOutcome: updatedOrder.financialOutcome,
                refundAmount,
                currency: currencyKey,
                walletTransactionId: walletResult.transaction?.transactionId || "",
                duplicate: Boolean(walletResult.duplicate)
            }
        }).catch(error => console.log("Admin audit failed:", error.message));

        await sendTelegramMessage(
            `✅ REFUND APPROVED TO WALLET

📦 Order:
${updatedOrder.orderId}

🎮 Game:
${updatedOrder.game}

📦 Package:
${updatedOrder.packageName}

👤 User:
${updatedOrder.username}

💰 Refund:
${refundAmount} ${currencyKey}

📝 Reason:
${updatedOrder.refundReason}`
        );

        res.json({
            success: true,
            message: "Refund approved and returned to wallet",
            order: updatedOrder,
            balance: walletResult.balance,
            transaction: walletResult.transaction,
            duplicate: Boolean(walletResult.duplicate)
        });

    } catch (error) {
        console.log("Approve refund error:", error);

        if (error instanceof FinancialIntegrityError) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        if (error instanceof WalletError) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    } finally {
        await session.endSession();
    }
});

// ADMIN REJECT REFUND
// POST /api/admin/orders/:id/refund/reject
router.post("/admin/orders/:id/refund/reject", adminMiddleware, requireAdminPermission(PERMISSIONS.ORDERS_MANAGE), async (req, res) => {
    try {
        const { reason } = req.body;

        if (!reason || !String(reason).trim()) {
            return res.json({
                success: false,
                message: "Reject reason is required"
            });
        }

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        if (!order.refundRequested && order.status !== "refund_requested") {
            return res.json({
                success: false,
                message: "No refund request to reject"
            });
        }

        if (order.refunded || order.status === "refunded") {
            return res.json({
                success: false,
                message: "This order has already been refunded"
            });
        }

        order.refundRejectedReason = String(reason).trim();
        const transition = await transitionOrder(order, ORDER_STATES.REFUND_REJECTED, {
            source: "admin",
            actorType: "admin",
            actor: req.admin?.username || req.user?.username || "admin",
            reason: order.refundRejectedReason,
            note: `Refund rejected. Reason: ${order.refundRejectedReason}`,
            idempotencyKey: `refund:reject:${order.orderId}`
        });
        const updatedOrder = transition.order;

        const notification = await createNotification({
            username: updatedOrder.username,
            title: "Refund Request Rejected",
            message: updatedOrder.refundRejectedReason,
            type: "refund",
            category: "refunds",
            orderId: updatedOrder.orderId
        });

        realtime.emitAdminOrderUpdate({
            type: "refund_rejected",
            orderId: updatedOrder.orderId,
            username: updatedOrder.username
        });

        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.REFUND_REJECTED,
            resourceType: "Order",
            resourceId: updatedOrder.orderId || String(updatedOrder._id),
            metadata: {
                reason: updatedOrder.refundRejectedReason,
                nextAllowedStatuses: getAllowedNextStatuses(updatedOrder.status)
            }
        }).catch(error => console.log("Admin audit failed:", error.message));

        await sendTelegramMessage(
            `❌ REFUND REJECTED

📦 Order:
${updatedOrder.orderId}

👤 User:
${updatedOrder.username}

📝 Reason:
${updatedOrder.refundRejectedReason}`
        );

        res.json({
            success: true,
            message: "Refund request rejected",
            order: updatedOrder
        });

    } catch (error) {
        console.log("Reject refund error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// LEGACY DIRECT ADMIN REFUND - Optional compatibility
// POST /api/admin/orders/:id/refund
router.post("/admin/orders/:id/refund", adminMiddleware, requireAdminPermission(PERMISSIONS.ORDERS_MANAGE), async (req, res) => {
    try {
        const { reason } = req.body;

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        if (!order.refundRequested && order.status !== "refund_requested") {
            return res.json({
                success: false,
                message: "Customer has not requested refund yet"
            });
        }

        req.url = `/admin/orders/${req.params.id}/refund/approve`;
        return router.handle(req, res);

    } catch (error) {
        console.log("Legacy refund error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// LEGACY / MANUAL ORDER CREATE
router.post("/orders", authMiddleware, orderCreateLimiter, upload.single("paymentSlip"), async (req, res) => {
    if (process.env.AZIEL_ALLOW_LEGACY_PAYABLE_CREATION !== "true") {
        return commerceCoreDisabledLegacyPayableResponse(res, "legacy_orders_create");
    }

    let evidence = null;
    let evidencePersisted = false;
    let reservedRedemption = null;

    try {
        const username = getAuthenticatedUsername(req);

        if (!req.body.orderId || !req.body.paymentMethod || !req.body.userId) {
            return res.status(400).json({
                success: false,
                message: "Missing order data"
            });
        }

        const pricing = await resolvePurchasePricing({
            payload: req.body,
            user: req.user,
            verifyUserLimit: true
        });
        const catalogItem = pricing.catalogItem;
        const methodKey = normalizePaymentKey(req.body.paymentMethod);
        const configuredMethods = await PaymentMethod.find({
            region: catalogItem.region,
            enabled: true
        });
        const configuredMethod = configuredMethods.find(method => normalizePaymentKey(method.key) === methodKey);

        if (configuredMethod && isManualPaymentType(configuredMethod.paymentType) && !req.file) {
            return res.status(409).json({
                success: false,
                code: "USE_MANUAL_PAYMENT_ATTEMPT",
                message: "Manual payment orders are created after payment slip submission."
            });
        }

        const pendingPolicy = await getActivePendingOrderPolicy(username);

        if (pendingPolicy.activePendingCount >= pendingPolicy.limit) {
            return res.status(429).json({
                success: false,
                code: "TOO_MANY_PENDING_ORDERS",
                title: "You have several unfinished orders.",
                message: "Complete or wait for an older order to expire before creating another.",
                activePendingCount: pendingPolicy.activePendingCount,
                limit: pendingPolicy.limit
            });
        }

        const existingOrder = await Order.findOne({ orderId: req.body.orderId });
        if (existingOrder) {
            return res.status(409).json({
                success: false,
                code: "DUPLICATE_ORDER_ID",
                message: "Order already exists"
            });
        }

        if (req.file) {
            evidence = await uploadFile({
                file: req.file,
                category: "paymentSlip",
                ownerReference: req.body.orderId
            });
        }

        reservedRedemption = await reservePromoUse({
            pricing,
            user: req.user,
            orderId: req.body.orderId
        });

        const order = await Order.create({
            orderId: req.body.orderId,
            username,
            ...buildOrderCustomerSnapshot(req.user),
            game: catalogItem.productName,
            productCode: catalogItem.productCode,
            productName: catalogItem.productName,
            userId: req.body.userId,
            zoneId: req.body.zoneId || "",
            packageName: catalogItem.packageName,
            packageCode: catalogItem.packageCode,
            amount: pricing.finalAmount,
            originalAmount: pricing.originalAmount,
            discountAmount: pricing.discountAmount,
            finalAmount: pricing.finalAmount,
            promoCode: pricing.promoCode,
            promoSnapshot: pricing.promoSnapshot,
            promoRedemptionId: reservedRedemption?._id || null,
            currency: pricing.currency,
            region: catalogItem.region,
            paymentMethod: req.body.paymentMethod,
            paymentSlip: evidence?.url || "",
            paymentEvidence: evidence || undefined,
            status: ORDER_STATES.PENDING_PAYMENT,
            paymentStatus: PAYMENT_STATES.PENDING,
            timeline: [{
                status: ORDER_STATES.PENDING_PAYMENT,
                previousStatus: "",
                paymentStatus: PAYMENT_STATES.PENDING,
                source: "user",
                actorType: "user",
                actor: username,
                reason: "Order created",
                idempotencyKey: `order:create:${req.body.orderId}`,
                at: new Date()
            }]
        });
        reservedRedemption = null;
        evidencePersisted = true;

        if (order.paymentSlip || order.paymentEvidence?.url) {
            orderEmailService.notifyManualPaymentSubmitted(order).catch(error => {
                console.log("Manual order email dispatch failed:", {
                    orderId: order.orderId,
                    code: error?.code || "PAYMENT_SLIP_EMAIL_FAILED"
                });
            });
        }

        res.json({
            success: true,
            order
        });

    } catch (error) {
        console.log("Create order error:", error);

        if (evidence && !evidencePersisted) {
            await cleanupAfterFailedPersistence(evidence);
        }

        await releasePromoRedemption(reservedRedemption?._id);

        if (error instanceof CatalogError || error instanceof PromoError) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        if (error instanceof StorageError) {
            logStorageError(error.code, {
                provider: error.provider,
                category: "paymentSlip",
                orderId: req.body?.orderId
            });

            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: "Create order failed"
        });
    }
});

function formatStatusText(status) {
    return String(status || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = router;
module.exports._test = {
    commerceAdminId,
    commerceAttemptIdFromAdminId,
    commerceOrderIdFromAdminId,
    commercePaymentEvidence,
    commerceOrderStatusForAttempt,
    commercePaymentStatusForAttempt,
    hasCommercePaymentEvidence,
    projectCommerceOrder,
    projectCommerceManualAttempt
};
