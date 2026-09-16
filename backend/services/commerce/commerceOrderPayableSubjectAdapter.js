"use strict";

function text(value) {
    return String(value || "").trim();
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function createCommerceOrderPayableSubjectAdapter(dependencies = {}) {
    const orderRepository = dependencies.orderRepository || {};
    const clock = dependencies.clock || (() => new Date());
    const paymentStateOf = dependencies.paymentStateOf;
    const toOrderPaymentStatus = dependencies.toOrderPaymentStatus;
    const states = dependencies.paymentStates || {};
    const error = dependencies.error || ((code, message, options = {}) => Object.assign(new Error(message), { code, ...options }));

    async function loadOwnedSubject({ subjectId, owner, session = null }) {
        const finder = orderRepository.findOwnedOrderById || orderRepository.findOwnedOrder;
        if (typeof finder !== "function") throw error("PAYMENT_VALIDATION_ERROR", "orderRepository.findOwnedOrderById is required.", { stage: "dependencies" });
        const subject = await finder.call(orderRepository, { orderId: subjectId, owner, transactionContext: session });
        if (!subject) throw error("PAYMENT_ORDER_NOT_FOUND", "Commerce order was not found for this owner.", { stage: "order", metadata: { orderId: subjectId } });
        return clone(subject);
    }

    async function loadOperationalSubject({ subjectId, session = null }) {
        const finder = orderRepository.findOrderById || orderRepository.findOperationalOrderById;
        if (typeof finder !== "function") throw error("PAYMENT_VALIDATION_ERROR", "orderRepository.findOrderById is required.", { stage: "dependencies" });
        const subject = await finder.call(orderRepository, subjectId, {
            transactionContext: session,
            mongoSession: session?.mongoSession,
            session: session?.session
        });
        if (!subject) throw error("PAYMENT_ORDER_NOT_FOUND", "Commerce order was not found.", { stage: "order", metadata: { orderId: subjectId } });
        return clone(subject);
    }

    function getSubjectId(subject = {}) {
        return text(subject.orderId);
    }

    function getAuthoritativeAmount(subject = {}) {
        return Number(subject.commercial?.totalAmount ?? subject.commercialSnapshot?.totalAmount ?? subject.pricing?.totalAmount ?? 0);
    }

    function getCurrency(subject = {}) {
        return text(subject.commercial?.currency || subject.commercialSnapshot?.currency || subject.pricing?.currency).toUpperCase();
    }

    function getRegion(subject = {}) {
        return text(subject.commercial?.region || subject.product?.region || subject.commercialSnapshot?.region).toUpperCase();
    }

    function getPaymentSnapshot(subject = {}) {
        return clone(subject.payment || subject.paymentSnapshot || {});
    }

    function assertPayable(subject = {}) {
        const orderStatus = text(subject.status);
        const paymentState = paymentStateOf(subject);
        if ([states.PAID, states.WAIVED, states.REFUNDED].includes(paymentState)) {
            throw error("PAYMENT_NOT_PAYABLE", "Order is not payable.", { stage: "order", metadata: { orderId: subject.orderId, paymentStatus: paymentState } });
        }
        if (["completed", "cancelled", "refunded"].includes(orderStatus)) {
            throw error("PAYMENT_NOT_PAYABLE", "Order status is not payable.", { stage: "order", metadata: { orderId: subject.orderId, orderStatus } });
        }
    }

    async function applyPaymentTransition({ subject, transition, reason, session = null }) {
        let updatedSubject = subject;
        const targetStatus = toOrderPaymentStatus(transition.to);
        const fromState = paymentStateOf(subject);
        if (targetStatus !== toOrderPaymentStatus(fromState) && typeof orderRepository.updatePaymentStatus === "function") {
            const repositoryOptions = { transactionContext: session, mongoSession: session?.mongoSession, session: session?.session };
            updatedSubject = await orderRepository.updatePaymentStatus({
                orderId: subject.orderId,
                fromStatuses: [toOrderPaymentStatus(fromState)],
                toStatus: targetStatus,
                changedAt: clock(),
                reason,
                owner: subject.owner
            }, repositoryOptions);
            if (targetStatus === "paid" && text(updatedSubject?.status || subject.status) === "pending_payment" && typeof orderRepository.updateOrderStatus === "function") {
                updatedSubject = await orderRepository.updateOrderStatus({
                    orderId: subject.orderId,
                    fromStatuses: ["pending_payment"],
                    toStatus: "paid",
                    changedAt: clock(),
                    reason,
                    owner: subject.owner
                }, repositoryOptions);
            }
        }
        return updatedSubject || subject;
    }

    return Object.freeze({
        loadOwnedSubject,
        loadOperationalSubject,
        getSubjectId,
        getAuthoritativeAmount,
        getCurrency,
        getRegion,
        getPaymentSnapshot,
        assertPayable,
        applyPaymentTransition
    });
}

module.exports = Object.freeze({ createCommerceOrderPayableSubjectAdapter });
