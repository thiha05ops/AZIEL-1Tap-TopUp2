const Order = require("../models/Order");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { ACTIVE_FULFILLMENT_STATUSES, FULFILLMENT_STATUSES } = require("../models/FulfillmentAttempt");
const { ORDER_STATES, PAYMENT_STATES } = require("./orderStateService");

const FINANCIAL_OUTCOMES = Object.freeze({
    NONE: "",
    FULFILLMENT_SUCCEEDED: "FULFILLMENT_SUCCEEDED",
    REFUND_CREDITED: "REFUND_CREDITED"
});

class FinancialIntegrityError extends Error {
    constructor(code, message, statusCode = 409) {
        super(message);
        this.name = "FinancialIntegrityError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function isPaid(order = {}) {
    return String(order.paymentStatus || "") === PAYMENT_STATES.PAID;
}

function hasActiveFulfillment(attempts = []) {
    return attempts.some(attempt => ACTIVE_FULFILLMENT_STATUSES.includes(attempt.status));
}

function hasSucceededFulfillment(attempts = []) {
    return attempts.some(attempt => attempt.status === FULFILLMENT_STATUSES.SUCCEEDED);
}

function isRefundBlocking(order = {}) {
    return Boolean(
        order.refunded ||
        order.financialOutcome === FINANCIAL_OUTCOMES.REFUND_CREDITED ||
        [ORDER_STATES.REFUND_REQUESTED, ORDER_STATES.REFUND_PENDING, ORDER_STATES.REFUNDED].includes(String(order.status || ""))
    );
}

function refundStateLabel(order = {}) {
    if (order.financialOutcome === FINANCIAL_OUTCOMES.REFUND_CREDITED || order.refunded || order.status === ORDER_STATES.REFUNDED) {
        return "Refund credited";
    }
    if (order.status === ORDER_STATES.REFUND_REQUESTED || order.refundRequested) return "Refund requested";
    if (order.status === ORDER_STATES.REFUND_PENDING) return "Refund pending";
    return "";
}

async function listFinancialFulfillmentAttempts(orderId, options = {}) {
    if (!orderId) return [];
    return FulfillmentAttempt.find({ orderId })
        .sort({ createdAt: -1 })
        .session(options.session || null);
}

function projectFinancialActions(order = {}, attempts = []) {
    const active = hasActiveFulfillment(attempts);
    const succeeded = hasSucceededFulfillment(attempts) || order.financialOutcome === FINANCIAL_OUTCOMES.FULFILLMENT_SUCCEEDED;
    const refundBlocking = isRefundBlocking(order);
    const status = String(order.status || "");
    const paid = isPaid(order);

    let canStartFulfillment = [ORDER_STATES.PAID, ORDER_STATES.FAILED, ORDER_STATES.REFUND_REJECTED].includes(status) && paid;
    let startFulfillmentBlockedReason = null;

    if (!paid) {
        canStartFulfillment = false;
        startFulfillmentBlockedReason = "ORDER_NOT_PAID";
    } else if (refundBlocking) {
        canStartFulfillment = false;
        startFulfillmentBlockedReason = "REFUND_BLOCKS_FULFILLMENT";
    } else if (active) {
        canStartFulfillment = false;
        startFulfillmentBlockedReason = "FULFILLMENT_ACTIVE";
    } else if (succeeded) {
        canStartFulfillment = false;
        startFulfillmentBlockedReason = "FULFILLMENT_ALREADY_SUCCEEDED";
    } else if (!canStartFulfillment) {
        startFulfillmentBlockedReason = "ORDER_NOT_FULFILLMENT_ELIGIBLE";
    }

    let canRequestRefund = [ORDER_STATES.FAILED, ORDER_STATES.CANCELLED].includes(status) && paid;
    let refundBlockedReason = null;

    if (!paid) {
        canRequestRefund = false;
        refundBlockedReason = "ORDER_NOT_PAID";
    } else if (order.refunded || order.status === ORDER_STATES.REFUNDED || order.financialOutcome === FINANCIAL_OUTCOMES.REFUND_CREDITED) {
        canRequestRefund = false;
        refundBlockedReason = "REFUND_ALREADY_CREDITED";
    } else if (order.refundRequested || [ORDER_STATES.REFUND_REQUESTED, ORDER_STATES.REFUND_PENDING].includes(status)) {
        canRequestRefund = false;
        refundBlockedReason = "REFUND_ALREADY_REQUESTED";
    } else if (active) {
        canRequestRefund = false;
        refundBlockedReason = "FULFILLMENT_ACTIVE";
    } else if (succeeded || status === ORDER_STATES.COMPLETED) {
        canRequestRefund = false;
        refundBlockedReason = "FULFILLMENT_ALREADY_SUCCEEDED";
    } else if (!canRequestRefund) {
        refundBlockedReason = "ORDER_NOT_REFUND_ELIGIBLE";
    }

    let canApproveRefund = [ORDER_STATES.REFUND_REQUESTED, ORDER_STATES.REFUND_PENDING].includes(status) || Boolean(order.refundRequested);
    let approveRefundBlockedReason = null;

    if (!paid) {
        canApproveRefund = false;
        approveRefundBlockedReason = "ORDER_NOT_PAID";
    } else if (!canApproveRefund) {
        approveRefundBlockedReason = "ORDER_NOT_REFUND_ELIGIBLE";
    } else if (order.refunded || order.status === ORDER_STATES.REFUNDED || order.financialOutcome === FINANCIAL_OUTCOMES.REFUND_CREDITED) {
        canApproveRefund = false;
        approveRefundBlockedReason = "REFUND_ALREADY_CREDITED";
    } else if (active) {
        canApproveRefund = false;
        approveRefundBlockedReason = "FULFILLMENT_ACTIVE";
    } else if (succeeded || status === ORDER_STATES.COMPLETED) {
        canApproveRefund = false;
        approveRefundBlockedReason = "FULFILLMENT_ALREADY_SUCCEEDED";
    }

    return {
        canStartFulfillment,
        startFulfillmentBlockedReason,
        canRequestRefund,
        refundBlockedReason,
        canApproveRefund,
        approveRefundBlockedReason,
        refundState: refundStateLabel(order),
        hasActiveFulfillment: active,
        hasSucceededFulfillment: succeeded,
        financialOutcome: order.financialOutcome || FINANCIAL_OUTCOMES.NONE
    };
}

function assertRefundRequestAllowed(order = {}, attempts = []) {
    const actions = projectFinancialActions(order, attempts);
    if (!actions.canRequestRefund) {
        throw new FinancialIntegrityError(actions.refundBlockedReason || "ORDER_NOT_REFUND_ELIGIBLE", refundConflictMessage(actions.refundBlockedReason));
    }
    return actions;
}

function assertRefundApprovalAllowed(order = {}, attempts = []) {
    if (!order.refundRequested && order.status !== ORDER_STATES.REFUND_REQUESTED && order.status !== ORDER_STATES.REFUND_PENDING) {
        throw new FinancialIntegrityError("ORDER_NOT_REFUND_ELIGIBLE", "Customer has not requested refund yet.", 400);
    }
    if (order.refunded || order.status === ORDER_STATES.REFUNDED || order.financialOutcome === FINANCIAL_OUTCOMES.REFUND_CREDITED) {
        throw new FinancialIntegrityError("REFUND_ALREADY_CREDITED", "This order has already been refunded.");
    }
    if (hasActiveFulfillment(attempts)) {
        throw new FinancialIntegrityError("FULFILLMENT_ACTIVE", "Active fulfillment must be resolved before refund approval.");
    }
    if (hasSucceededFulfillment(attempts) || order.financialOutcome === FINANCIAL_OUTCOMES.FULFILLMENT_SUCCEEDED) {
        throw new FinancialIntegrityError("FULFILLMENT_ALREADY_SUCCEEDED", "Fulfilled orders cannot be refunded.");
    }
}

function assertFulfillmentStartAllowed(order = {}, attempts = []) {
    const actions = projectFinancialActions(order, attempts);
    if (!actions.canStartFulfillment) {
        throw new FinancialIntegrityError(actions.startFulfillmentBlockedReason || "ORDER_NOT_FULFILLMENT_ELIGIBLE", fulfillmentConflictMessage(actions.startFulfillmentBlockedReason));
    }
    return actions;
}

function assertFulfillmentSuccessAllowed(order = {}, attempts = []) {
    if (isRefundBlocking(order)) {
        throw new FinancialIntegrityError("REFUND_BLOCKS_FULFILLMENT", "Refund state blocks fulfillment completion.");
    }
    if (order.financialOutcome === FINANCIAL_OUTCOMES.REFUND_CREDITED) {
        throw new FinancialIntegrityError("REFUND_ALREADY_CREDITED", "Refunded orders cannot be fulfilled.");
    }
    const otherSucceeded = attempts.some(attempt => attempt.status === FULFILLMENT_STATUSES.SUCCEEDED);
    if (otherSucceeded || order.financialOutcome === FINANCIAL_OUTCOMES.FULFILLMENT_SUCCEEDED) {
        throw new FinancialIntegrityError("FULFILLMENT_ALREADY_SUCCEEDED", "Order already has successful fulfillment.");
    }
}

async function acquireFinancialOutcome(orderId, outcome, options = {}) {
    const now = new Date();
    const query = {
        _id: orderId,
        financialOutcome: { $in: [null, "", FINANCIAL_OUTCOMES.NONE] }
    };

    if (outcome === FINANCIAL_OUTCOMES.REFUND_CREDITED) {
        query.refunded = { $ne: true };
        query.status = { $nin: [ORDER_STATES.COMPLETED, ORDER_STATES.REFUNDED] };
    }

    if (outcome === FINANCIAL_OUTCOMES.FULFILLMENT_SUCCEEDED) {
        query.refunded = { $ne: true };
        query.status = { $nin: [ORDER_STATES.REFUND_REQUESTED, ORDER_STATES.REFUND_PENDING, ORDER_STATES.REFUNDED] };
    }

    const updated = await Order.findOneAndUpdate(
        query,
        { $set: { financialOutcome: outcome, financialOutcomeAt: now } },
        { returnDocument: "after", session: options.session || null }
    );

    if (!updated) {
        throw new FinancialIntegrityError(
            outcome === FINANCIAL_OUTCOMES.REFUND_CREDITED ? "FULFILLMENT_ALREADY_SUCCEEDED" : "REFUND_ALREADY_CREDITED",
            outcome === FINANCIAL_OUTCOMES.REFUND_CREDITED
                ? "Fulfillment already owns the terminal outcome."
                : "Refund already owns the terminal outcome."
        );
    }

    return updated;
}

function refundConflictMessage(code = "") {
    if (code === "FULFILLMENT_ACTIVE") return "Active fulfillment must finish before refund request.";
    if (code === "FULFILLMENT_ALREADY_SUCCEEDED") return "Completed orders cannot be refunded.";
    if (code === "REFUND_ALREADY_CREDITED") return "This order has already been refunded.";
    if (code === "REFUND_ALREADY_REQUESTED") return "Refund request already submitted.";
    if (code === "ORDER_NOT_PAID") return "Only paid orders can be refunded.";
    return "Order is not eligible for refund.";
}

function fulfillmentConflictMessage(code = "") {
    if (code === "REFUND_BLOCKS_FULFILLMENT") return "Refund request blocks fulfillment retry.";
    if (code === "FULFILLMENT_ACTIVE") return "Fulfillment is already active for this order.";
    if (code === "FULFILLMENT_ALREADY_SUCCEEDED") return "Order already has successful fulfillment.";
    if (code === "ORDER_NOT_PAID") return "Order payment is not confirmed.";
    return "Order is not eligible for fulfillment.";
}

module.exports = {
    FINANCIAL_OUTCOMES,
    FinancialIntegrityError,
    acquireFinancialOutcome,
    assertFulfillmentStartAllowed,
    assertFulfillmentSuccessAllowed,
    assertRefundApprovalAllowed,
    assertRefundRequestAllowed,
    listFinancialFulfillmentAttempts,
    projectFinancialActions
};
