const Order = require("../models/Order");
const {
    ORDER_STATES,
    PAYMENT_STATES,
    OrderStateError,
    normalizePaymentStatus,
    transitionOrder
} = require("./orderStateService");

function mapOmiseChargeStatus(eventKey, charge = {}) {
    const status = String(charge.status || "").toLowerCase();

    if (eventKey === "charge.complete" && status === "successful") {
        return PAYMENT_STATES.PAID;
    }

    if (["failed", "expired", "cancelled", "canceled"].includes(status)) {
        return normalizePaymentStatus(status);
    }

    return PAYMENT_STATES.PENDING;
}

function assertPaymentMatchesOrder(order, payment = {}) {
    if (!order) {
        throw new OrderStateError("ORDER_NOT_FOUND", "Order not found", 404);
    }

    if (payment.orderId && String(payment.orderId) !== String(order.orderId)) {
        throw new OrderStateError(
            "PAYMENT_REFERENCE_MISMATCH",
            "Payment reference does not match order"
        );
    }

    if (payment.transactionId && order.transactionId && String(payment.transactionId) !== String(order.transactionId)) {
        throw new OrderStateError(
            "PAYMENT_REFERENCE_MISMATCH",
            "Payment transaction does not match order"
        );
    }

    if (payment.amount != null && Number(payment.amount) !== Number(order.amount)) {
        throw new OrderStateError(
            "PAYMENT_AMOUNT_MISMATCH",
            "Payment amount does not match order"
        );
    }

    if (
        payment.currency &&
        String(payment.currency).toUpperCase() !== String(order.currency || "").toUpperCase()
    ) {
        throw new OrderStateError(
            "PAYMENT_CURRENCY_MISMATCH",
            "Payment currency does not match order"
        );
    }
}

async function applyPaymentToOrder(orderOrQuery, payment = {}, options = {}) {
    const order = typeof orderOrQuery === "object" && orderOrQuery.orderId && typeof orderOrQuery.save !== "function"
        ? await Order.findOne(orderOrQuery)
        : orderOrQuery;

    assertPaymentMatchesOrder(order, payment);

    const eventId = payment.eventId || payment.transactionId || options.idempotencyKey || "";

    if (eventId && (order.processedPaymentEvents || []).includes(String(eventId))) {
        return {
            success: true,
            changed: false,
            idempotent: true,
            order
        };
    }

    const paymentStatus = normalizePaymentStatus(payment.status);

    if (paymentStatus === PAYMENT_STATES.PAID) {
        return transitionOrder(order, ORDER_STATES.PAID, {
            source: options.source || "payment_provider",
            actorType: options.actorType || "system",
            actor: options.actor || "",
            reason: options.reason || "Payment confirmed",
            idempotencyKey: eventId ? `payment:${eventId}` : "",
            processedPaymentEventId: eventId,
            paymentStatus: PAYMENT_STATES.PAID,
            note: "Payment received. Waiting for admin processing."
        });
    }

    order.paymentStatus = paymentStatus;

    if (eventId) {
        const existing = new Set(order.processedPaymentEvents || []);
        existing.add(String(eventId));
        order.processedPaymentEvents = [...existing].slice(-50);
    }

    await order.save();

    return {
        success: true,
        changed: false,
        idempotent: Boolean(eventId),
        order
    };
}

module.exports = {
    applyPaymentToOrder,
    assertPaymentMatchesOrder,
    mapOmiseChargeStatus
};
