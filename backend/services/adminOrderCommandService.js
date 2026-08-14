const mongoose = require("mongoose");

class AdminOrderCommandError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message);
        this.name = "AdminOrderCommandError";
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

function text(value) {
    return String(value || "").trim();
}

function createAdminOrderCommandService(dependencies = {}) {
    const LegacyOrder = dependencies.LegacyOrder;
    const CommerceOrder = dependencies.CommerceOrder;
    const PaymentAttempt = dependencies.PaymentAttempt;
    const transitionLegacyOrder = dependencies.transitionLegacyOrder;

    async function findLegacy(query) {
        return query ? LegacyOrder.findOne(query) : null;
    }

    async function findCommerce(query) {
        return query ? CommerceOrder.findOne(query) : null;
    }

    async function resolve(identifier) {
        const value = text(identifier);
        if (!value) {
            throw new AdminOrderCommandError("ORDER_NOT_FOUND", "Order not found.", 404);
        }

        if (value.startsWith("commerce-order:")) {
            const orderId = text(value.slice("commerce-order:".length));
            const order = await findCommerce({ orderId });
            if (!order) throw new AdminOrderCommandError("ORDER_NOT_FOUND", "Order not found.", 404);
            return { orderType: "commerce", order };
        }

        if (value.startsWith("commerce:")) {
            const attemptId = text(value.slice("commerce:".length));
            const attempt = await PaymentAttempt.findOne({ attemptId });
            const order = attempt ? await findCommerce({ orderId: attempt.orderId }) : null;
            if (!attempt || !order) throw new AdminOrderCommandError("ORDER_NOT_FOUND", "Order not found.", 404);
            return { orderType: "commerce", order, paymentAttempt: attempt };
        }

        const objectId = mongoose.isValidObjectId(value) ? value : null;
        const [legacy, commerce] = await Promise.all([
            findLegacy(objectId ? { $or: [{ _id: objectId }, { orderId: value }] } : { orderId: value }),
            findCommerce(objectId ? { $or: [{ _id: objectId }, { orderId: value }] } : { orderId: value })
        ]);

        if (legacy && commerce) {
            throw new AdminOrderCommandError(
                "ORDER_IDENTIFIER_AMBIGUOUS",
                "Order identifier matches more than one record type.",
                409,
                { identifier: value }
            );
        }
        if (commerce) return { orderType: "commerce", order: commerce };
        if (legacy) return { orderType: "legacy", order: legacy };
        throw new AdminOrderCommandError("ORDER_NOT_FOUND", "Order not found.", 404);
    }

    async function loadPaymentAttempt(order, supplied = null) {
        if (supplied) return supplied;
        return PaymentAttempt.findOne({ orderId: order.orderId }).sort({ createdAt: -1 });
    }

    async function getAdminDetail(identifier) {
        const resolved = await resolve(identifier);
        if (resolved.orderType === "commerce") {
            resolved.paymentAttempt = await loadPaymentAttempt(resolved.order, resolved.paymentAttempt);
        }
        return resolved;
    }

    async function transitionStatus({ identifier, status, options = {} }) {
        const resolved = await resolve(identifier);
        if (resolved.orderType === "commerce") {
            throw new AdminOrderCommandError(
                "INVALID_ORDER_TRANSITION",
                "Commerce order state is controlled by payment and fulfillment commands.",
                409,
                { requestedStatus: text(status), orderType: "commerce" }
            );
        }
        if (typeof transitionLegacyOrder !== "function") {
            throw new AdminOrderCommandError("ORDER_TYPE_UNSUPPORTED", "Legacy order command is unavailable.", 500);
        }
        return transitionLegacyOrder(resolved.order, status, options);
    }

    return Object.freeze({ getAdminDetail, resolve, transitionStatus });
}

module.exports = {
    AdminOrderCommandError,
    createAdminOrderCommandService
};
