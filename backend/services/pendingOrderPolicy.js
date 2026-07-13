const Order = require("../models/Order");
const {
    ORDER_STATES,
    PAYMENT_STATES,
    transitionOrder
} = require("./orderStateService");

const DEFAULT_PENDING_ORDER_LIMIT = 8;
const STALE_PENDING_ORDER_MS = 15 * 60 * 1000;

function getPendingOrderLimit(env = process.env) {
    const configured = Number(env.MAX_PENDING_ORDERS_PER_USER);
    return Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_PENDING_ORDER_LIMIT;
}

function hasPaymentEvidence(order) {
    return Boolean(
        String(order.paymentSlip || "").trim() ||
        order.paymentEvidence?.url ||
        order.paymentEvidence?.storageKey
    );
}

function abandonedPendingQuery(username, cutoff = null) {
    const query = {
        username,
        status: ORDER_STATES.PENDING_PAYMENT,
        paymentMethod: { $ne: "wallet" },
        $and: [
            {
                $or: [
                    { paymentStatus: { $exists: false } },
                    { paymentStatus: "" },
                    { paymentStatus: PAYMENT_STATES.PENDING }
                ]
            },
            {
                $or: [
                    { paymentSlip: { $exists: false } },
                    { paymentSlip: "" },
                    { paymentSlip: null }
                ]
            },
            {
                $or: [
                    { "paymentEvidence.url": { $exists: false } },
                    { "paymentEvidence.url": "" },
                    { paymentEvidence: { $exists: false } },
                    { paymentEvidence: null }
                ]
            }
        ]
    };

    if (cutoff) {
        query.createdAt = { $gte: cutoff };
    }

    return query;
}

async function expireStalePendingOrders(username, options = {}) {
    const now = options.now || new Date();
    const staleBefore = new Date(now.getTime() - STALE_PENDING_ORDER_MS);

    const staleOrders = await Order.find({
        ...abandonedPendingQuery(username),
        createdAt: { $lt: staleBefore }
    }).sort({ createdAt: 1 });

    let expiredCount = 0;

    for (const order of staleOrders) {
        if (hasPaymentEvidence(order)) continue;

        const result = await transitionOrder(order, ORDER_STATES.EXPIRED, {
            source: "system",
            actorType: "system",
            actor: "pending_order_policy",
            reason: "Stale unpaid pending order expired before new order creation",
            paymentStatus: PAYMENT_STATES.EXPIRED,
            idempotencyKey: `pending-expire:${order.orderId}`
        });

        if (result.changed || result.idempotent) expiredCount++;
    }

    return {
        expiredCount,
        staleBefore
    };
}

async function getActivePendingOrderPolicy(username, options = {}) {
    const limit = getPendingOrderLimit(options.env || process.env);
    const expiry = await expireStalePendingOrders(username, options);
    const activePendingCount = await Order.countDocuments(
        abandonedPendingQuery(username, expiry.staleBefore)
    );

    return {
        activePendingCount,
        expiredCount: expiry.expiredCount,
        limit,
        stalePendingMinutes: STALE_PENDING_ORDER_MS / 60000
    };
}

module.exports = {
    DEFAULT_PENDING_ORDER_LIMIT,
    STALE_PENDING_ORDER_MS,
    abandonedPendingQuery,
    expireStalePendingOrders,
    getActivePendingOrderPolicy,
    getPendingOrderLimit,
    hasPaymentEvidence
};
