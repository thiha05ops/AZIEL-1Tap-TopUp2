// backend/routes/adminStats.js

const express = require("express");
const router = express.Router();

const Order = require("../models/Order");
const User = require("../models/User");
const WalletTopup = require("../models/WalletTopup");
const SupportTicket = require("../models/SupportTicket");
const LiveChat = require("../models/LiveChat");

const adminMiddleware = require("../middleware/adminMiddleware");

const DASHBOARD_TIMEZONE = "Asia/Bangkok";

function getBangkokTodayBounds(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: DASHBOARD_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(now);

    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const year = Number(byType.year);
    const month = Number(byType.month);
    const day = Number(byType.day);

    return {
        start: new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000),
        end: new Date(Date.UTC(year, month - 1, day + 1) - 7 * 60 * 60 * 1000)
    };
}

function manualPaymentReviewQuery() {
    return {
        status: "pending_payment",
        $or: [
            { paymentSlip: { $type: "string", $ne: "" } },
            { "paymentEvidence.url": { $type: "string", $ne: "" } },
            { "paymentEvidence.key": { $type: "string", $ne: "" } },
            { "paymentEvidence.storageKey": { $type: "string", $ne: "" } }
        ]
    };
}

function normalizeCurrency(currency) {
    return String(currency || "MMK").toUpperCase() === "THB" ? "THB" : "MMK";
}

function emptyCurrencyTotals() {
    return { MMK: 0, THB: 0 };
}

function mergeCurrencyAggregation(rows = []) {
    const totals = emptyCurrencyTotals();

    rows.forEach(row => {
        const currency = normalizeCurrency(row._id);
        totals[currency] += Number(row.total || 0);
    });

    return totals;
}

function actionTarget(section, params = {}) {
    return { section, params };
}

// ============================
// ADMIN DASHBOARD STATS
// GET /api/admin/stats
// ============================

router.get("/admin/stats", adminMiddleware, async (req, res) => {
    try {
        const { start, end } = getBangkokTodayBounds();
        const todayRange = { $gte: start, $lt: end };

        const totalOrders = await Order.countDocuments();

        const [
            pendingOrders,
            processingOrders,
            completedOrders,
            cancelledOrders,
            paidOrders,
            totalUsers,
            manualPaymentReviews,
            walletTopupsPending,
            supportUnread,
            supportOpen,
            liveChatUnread,
            refundRequests,
            ordersToday,
            completedToday,
            failedToday,
            newUsersToday,
            completedValueRows,
            recentOrders
        ] = await Promise.all([
            Order.countDocuments({ status: { $in: ["pending", "pending_payment"] } }),
            Order.countDocuments({ status: "processing" }),
            Order.countDocuments({ status: "completed" }),
            Order.countDocuments({ status: { $in: ["cancelled", "failed"] } }),
            Order.countDocuments({ status: "paid" }),
            User.countDocuments(),
            Order.countDocuments(manualPaymentReviewQuery()),
            WalletTopup.countDocuments({ status: "pending" }),
            SupportTicket.countDocuments({
                unreadByAdmin: true,
                status: { $nin: ["solved", "closed"] }
            }),
            SupportTicket.countDocuments({ status: "open" }),
            LiveChat.countDocuments({
                status: "active",
                messages: {
                    $elemMatch: {
                        sender: "user",
                        readByAdmin: false
                    }
                }
            }),
            Order.countDocuments({ status: "refund_requested" }),
            Order.countDocuments({ createdAt: todayRange }),
            Order.countDocuments({ status: "completed", updatedAt: todayRange }),
            Order.countDocuments({ status: "failed", updatedAt: todayRange }),
            User.countDocuments({ createdAt: todayRange }),
            Order.aggregate([
                {
                    $match: {
                        status: "completed",
                        refunded: { $ne: true },
                        updatedAt: todayRange
                    }
                },
                {
                    $group: {
                        _id: "$currency",
                        total: { $sum: "$amount" }
                    }
                }
            ]),
            Order.find({
                status: {
                    $in: [
                        "paid",
                        "processing",
                        "completed",
                        "failed",
                        "refund_requested"
                    ]
                }
            })
                .sort({ updatedAt: -1 })
                .limit(6)
                .select("orderId username status game packageName currency amount updatedAt")
                .lean()
        ]);

        const completedOrderValue = mergeCurrencyAggregation(completedValueRows);
        const supportActionCount = supportUnread || supportOpen;
        const supportMode = supportUnread ? "unreadByAdmin" : "open";

        const dashboard = {
            actionRequired: {
                manualPaymentReviews: {
                    count: manualPaymentReviews,
                    target: actionTarget("orders", { filter: "manual_review" }),
                    severity: "warning"
                },
                paidOrders: {
                    count: paidOrders,
                    target: actionTarget("orders", { status: "paid" }),
                    severity: "info"
                },
                walletTopups: {
                    count: walletTopupsPending,
                    target: actionTarget("wallet", { status: "pending" }),
                    severity: "warning"
                },
                support: {
                    count: supportActionCount,
                    target: actionTarget("support", { filter: supportMode }),
                    severity: "info",
                    mode: supportMode
                },
                liveChat: {
                    count: liveChatUnread,
                    target: actionTarget("chat", { filter: "unread" }),
                    severity: "info"
                },
                refunds: {
                    count: refundRequests,
                    target: actionTarget("orders", { status: "refund_requested" }),
                    severity: "danger"
                }
            },
            today: {
                orders: ordersToday,
                completedOrders: completedToday,
                failedOrders: failedToday,
                newUsers: newUsersToday,
                completedOrderValue
            },
            recentOperations: recentOrders.map(order => ({
                type: "order",
                orderId: order.orderId,
                username: order.username,
                status: order.status,
                game: order.game,
                packageName: order.packageName,
                amount: order.amount,
                currency: normalizeCurrency(order.currency),
                updatedAt: order.updatedAt
            })),
            timezone: DASHBOARD_TIMEZONE,
            updatedAt: new Date()
        };

        res.json({
            success: true,
            dashboard,
            totalOrders,
            pendingOrders,
            processingOrders,
            completedOrders,
            cancelledOrders,
            paidOrders,
            totalUsers,
            revenueByCurrency: completedOrderValue,
            revenueMMK: completedOrderValue.MMK,
            revenueTHB: completedOrderValue.THB
        });

    } catch (error) {
        console.log("Admin stats error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router._adminDashboardInternals = {
    DASHBOARD_TIMEZONE,
    getBangkokTodayBounds,
    manualPaymentReviewQuery,
    normalizeCurrency
};

module.exports = router;
