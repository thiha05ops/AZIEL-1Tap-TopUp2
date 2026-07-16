const Order = require("../models/Order");
const realtime = require("./realtime");
const orderEmailService = require("./orderEmailService");

const ORDER_STATES = Object.freeze({
    PENDING_PAYMENT: "pending_payment",
    PAID: "paid",
    PROCESSING: "processing",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
    FAILED: "failed",
    EXPIRED: "expired",
    REFUND_REQUESTED: "refund_requested",
    REFUND_PENDING: "refund_pending",
    REFUND_REJECTED: "refund_rejected",
    REFUNDED: "refunded"
});

const PAYMENT_STATES = Object.freeze({
    PENDING: "pending",
    PAID: "paid",
    FAILED: "failed",
    EXPIRED: "expired",
    CANCELLED: "cancelled",
    REFUNDED: "refunded"
});

const ALLOWED_TRANSITIONS = Object.freeze({
    [ORDER_STATES.PENDING_PAYMENT]: [
        ORDER_STATES.PAID,
        ORDER_STATES.CANCELLED,
        ORDER_STATES.EXPIRED
    ].filter(Boolean),
    [ORDER_STATES.PAID]: [
        ORDER_STATES.PROCESSING,
        ORDER_STATES.CANCELLED,
        ORDER_STATES.FAILED
    ],
    [ORDER_STATES.PROCESSING]: [
        ORDER_STATES.COMPLETED,
        ORDER_STATES.FAILED,
        ORDER_STATES.CANCELLED
    ],
    [ORDER_STATES.FAILED]: [
        ORDER_STATES.PROCESSING,
        ORDER_STATES.REFUND_REQUESTED
    ],
    [ORDER_STATES.CANCELLED]: [
        ORDER_STATES.REFUND_REQUESTED
    ],
    [ORDER_STATES.REFUND_REQUESTED]: [
        ORDER_STATES.REFUND_PENDING,
        ORDER_STATES.REFUND_REJECTED,
        ORDER_STATES.REFUNDED
    ],
    [ORDER_STATES.REFUND_PENDING]: [
        ORDER_STATES.REFUND_REJECTED,
        ORDER_STATES.REFUNDED
    ],
    [ORDER_STATES.REFUND_REJECTED]: [
        ORDER_STATES.PROCESSING
    ],
    [ORDER_STATES.COMPLETED]: [],
    [ORDER_STATES.REFUNDED]: []
});

const NOTE_BY_STATUS = Object.freeze({
    pending_payment: "Waiting for payment confirmation.",
    paid: "Payment received. Waiting for admin processing.",
    processing: "Your order is processing.",
    completed: "✅ Your order has been completed.",
    cancelled: "❌ Your order has been cancelled.",
    failed: "❌ Your order failed. You may request a wallet refund.",
    expired: "Payment session expired.",
    refund_requested: "Refund request submitted. Admin will review your request.",
    refund_pending: "Refund is being reviewed.",
    refund_rejected: "Refund request was rejected.",
    refunded: "✅ This order has been refunded to your wallet."
});

class OrderStateError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.name = "OrderStateError";
        this.code = code;
        this.status = status;
    }
}

function normalizeOrderStatus(status) {
    const value = String(status || "").toLowerCase().trim();
    if (value === "pending" || value === "") return ORDER_STATES.PENDING_PAYMENT;
    if (value === "canceled") return ORDER_STATES.CANCELLED;
    return value;
}

function normalizePaymentStatus(status) {
    const value = String(status || "").toLowerCase().trim();
    if (value === "successful" || value === "success" || value === "completed") return PAYMENT_STATES.PAID;
    if (value === "pending_payment" || value === "") return PAYMENT_STATES.PENDING;
    if (value === "canceled") return PAYMENT_STATES.CANCELLED;
    return value;
}

function getAllowedNextStatuses(status) {
    return ALLOWED_TRANSITIONS[normalizeOrderStatus(status)] || [];
}

function assertKnownStatus(status) {
    if (!Object.values(ORDER_STATES).includes(status)) {
        throw new OrderStateError(
            "INVALID_ORDER_STATUS",
            "Invalid order status"
        );
    }
}

function assertTransitionAllowed(fromStatus, toStatus) {
    assertKnownStatus(toStatus);
    if (fromStatus === toStatus) return;

    const allowed = getAllowedNextStatuses(fromStatus);
    if (!allowed.includes(toStatus)) {
        throw new OrderStateError(
            "INVALID_ORDER_TRANSITION",
            `Cannot transition order from ${fromStatus} to ${toStatus}`
        );
    }
}

function makeTimelineEntry(order, previousStatus, nextStatus, options = {}) {
    return {
        status: nextStatus,
        previousStatus,
        paymentStatus: order.paymentStatus || "",
        source: options.source || "system",
        actorType: options.actorType || "system",
        actor: options.actor || "",
        reason: options.reason || "",
        idempotencyKey: options.idempotencyKey || "",
        at: new Date()
    };
}

function hasTimelineKey(order, key) {
    if (!key) return false;
    return (order.timeline || []).some(item => item.idempotencyKey === key);
}

async function emitCommittedTransition(order, entry) {
    await realtime.emitOrderUpdate(order.username, {
        orderId: order.orderId,
        status: order.status,
        paymentStatus: order.paymentStatus,
        game: order.game,
        packageName: order.packageName,
        latestTimelineEntry: entry || null
    });

    realtime.emitAdminOrderUpdate({
        type: "order_status",
        orderId: order.orderId,
        username: order.username,
        status: order.status,
        paymentStatus: order.paymentStatus,
        game: order.game,
        packageName: order.packageName,
        latestTimelineEntry: entry || null
    });

    orderEmailService.notifyOrderTransition(order, entry).catch(error => {
        console.log("Order lifecycle email dispatch failed:", {
            orderId: order.orderId,
            status: order.status,
            code: error?.code || "ORDER_EMAIL_DISPATCH_FAILED"
        });
    });
}

async function transitionOrder(orderOrId, nextStatusInput, options = {}) {
    const order = typeof orderOrId === "string"
        ? await Order.findById(orderOrId)
        : orderOrId;

    if (!order) {
        throw new OrderStateError("ORDER_NOT_FOUND", "Order not found", 404);
    }

    const previousStatus = normalizeOrderStatus(order.status);
    const nextStatus = normalizeOrderStatus(nextStatusInput);
    const idempotencyKey = options.idempotencyKey || "";

    if (idempotencyKey && hasTimelineKey(order, idempotencyKey)) {
        return {
            success: true,
            changed: false,
            idempotent: true,
            order
        };
    }

    assertTransitionAllowed(previousStatus, nextStatus);

    if (previousStatus === nextStatus) {
        return {
            success: true,
            changed: false,
            idempotent: true,
            order
        };
    }

    order.status = nextStatus;
    order.note = options.note || NOTE_BY_STATUS[nextStatus] || order.note || "";

    if (options.paymentStatus) {
        order.paymentStatus = normalizePaymentStatus(options.paymentStatus);
    }

    if (nextStatus === ORDER_STATES.PAID) {
        order.paymentStatus = PAYMENT_STATES.PAID;
        order.paidAt = order.paidAt || new Date();
    }

    if (nextStatus === ORDER_STATES.REFUNDED) {
        order.paymentStatus = PAYMENT_STATES.REFUNDED;
    }

    const entry = makeTimelineEntry(order, previousStatus, nextStatus, options);
    order.timeline = [...(order.timeline || []), entry].slice(-50);

    if (options.processedPaymentEventId) {
        const existing = new Set(order.processedPaymentEvents || []);
        existing.add(String(options.processedPaymentEventId));
        order.processedPaymentEvents = [...existing].slice(-50);
    }

    await order.save({ session: options.session || null });
    if (options.emit !== false) {
        await emitCommittedTransition(order, entry);
    }

    return {
        success: true,
        changed: true,
        idempotent: false,
        order,
        timelineEntry: entry
    };
}

function projectOrderStatus(order) {
    const timeline = Array.isArray(order.timeline) ? order.timeline : [];

    return {
        orderId: order.orderId,
        status: normalizeOrderStatus(order.status),
        paymentStatus: normalizePaymentStatus(order.paymentStatus || (order.status === "paid" ? "paid" : "pending")),
        amount: order.amount,
        currency: order.currency,
        game: order.game,
        packageName: order.packageName,
        paymentMethod: order.paymentMethod,
        updatedAt: order.updatedAt,
        timeline
    };
}

module.exports = {
    ALLOWED_TRANSITIONS,
    NOTE_BY_STATUS,
    ORDER_STATES,
    PAYMENT_STATES,
    OrderStateError,
    getAllowedNextStatuses,
    normalizeOrderStatus,
    normalizePaymentStatus,
    projectOrderStatus,
    emitCommittedTransition,
    transitionOrder
};
