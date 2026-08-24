// backend/routes/adminStats.js

const express = require("express");
const router = express.Router();

const CommerceOrder = require("../models/CommerceOrder");
const PaymentAttempt = require("../models/PaymentAttempt");
const User = require("../models/User");
const WalletTopup = require("../models/WalletTopup");
const SupportTicket = require("../models/SupportTicket");
const LiveChat = require("../models/LiveChat");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");

const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission, hasPermission } = require("../services/adminAuthorizationService");
const { formatPaymentDisplayName } = require("../services/paymentDisplayNameService");

const DASHBOARD_TIMEZONE = "Asia/Bangkok";
const MAX_DASHBOARD_RANGE_DAYS = 93;
const REGIONS = Object.freeze(["MM", "TH"]);
const CURRENCIES = Object.freeze(["MMK", "THB"]);
const ORDER_STATUSES = Object.freeze([
    "pending_payment",
    "paid",
    "processing",
    "completed",
    "cancelled",
    "payment_failed",
    "failed",
    "expired",
    "refund_pending",
    "refunded"
]);
const SALES_STATUSES = Object.freeze(["paid", "processing", "completed"]);
const FAILED_STATUSES = Object.freeze(["payment_failed", "failed", "cancelled", "expired"]);
const REFUND_STATUSES = Object.freeze(["refund_pending"]);

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

function getBangkokParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: DASHBOARD_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date);

    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
        year: Number(byType.year),
        month: Number(byType.month),
        day: Number(byType.day),
        hour: Number(byType.hour),
        minute: Number(byType.minute),
        second: Number(byType.second)
    };
}

function makeBangkokDate(year, month, day, hour = 0, minute = 0, second = 0) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - 7 * 60 * 60 * 1000);
}

function addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfBangkokDay(date = new Date()) {
    const parts = getBangkokParts(date);
    return makeBangkokDate(parts.year, parts.month, parts.day);
}

function endOfBangkokDay(date = new Date()) {
    return addDays(startOfBangkokDay(date), 1);
}

function startOfBangkokMonth(date = new Date()) {
    const parts = getBangkokParts(date);
    return makeBangkokDate(parts.year, parts.month, 1);
}

function parseIsoDateOnly(value) {
    const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3])
    };
}

function buildRangeFromRequest(query = {}, now = new Date()) {
    const preset = String(query.preset || "today").trim().toLowerCase();
    let start;
    let end;
    let label = "Today";

    if (preset === "custom") {
        const startParts = parseIsoDateOnly(query.start);
        const endParts = parseIsoDateOnly(query.end);
        if (!startParts || !endParts) {
            const error = new Error("Custom start and end dates are required.");
            error.status = 400;
            error.code = "DASHBOARD_DATE_RANGE_INVALID";
            throw error;
        }

        start = makeBangkokDate(startParts.year, startParts.month, startParts.day);
        end = addDays(makeBangkokDate(endParts.year, endParts.month, endParts.day), 1);
        label = "Custom Range";
    } else if (preset === "yesterday") {
        end = startOfBangkokDay(now);
        start = addDays(end, -1);
        label = "Yesterday";
    } else if (preset === "last_7_days") {
        end = endOfBangkokDay(now);
        start = addDays(end, -7);
        label = "Last 7 Days";
    } else if (preset === "last_30_days") {
        end = endOfBangkokDay(now);
        start = addDays(end, -30);
        label = "Last 30 Days";
    } else if (preset === "this_month") {
        start = startOfBangkokMonth(now);
        end = endOfBangkokDay(now);
        label = "This Month";
    } else if (preset === "last_month") {
        const parts = getBangkokParts(now);
        const thisMonthStart = makeBangkokDate(parts.year, parts.month, 1);
        const previousMonthParts = getBangkokParts(addDays(thisMonthStart, -1));
        start = makeBangkokDate(previousMonthParts.year, previousMonthParts.month, 1);
        end = thisMonthStart;
        label = "Last Month";
    } else {
        start = startOfBangkokDay(now);
        end = addDays(start, 1);
    }

    if (!(start instanceof Date) || !(end instanceof Date) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
        const error = new Error("Invalid dashboard date range.");
        error.status = 400;
        error.code = "DASHBOARD_DATE_RANGE_INVALID";
        throw error;
    }

    const durationMs = end.getTime() - start.getTime();
    const rangeDays = durationMs / (24 * 60 * 60 * 1000);
    if (rangeDays > MAX_DASHBOARD_RANGE_DAYS) {
        const error = new Error(`Dashboard range cannot exceed ${MAX_DASHBOARD_RANGE_DAYS} days.`);
        error.status = 400;
        error.code = "DASHBOARD_DATE_RANGE_TOO_LARGE";
        throw error;
    }

    return {
        preset,
        label,
        timezone: DASHBOARD_TIMEZONE,
        start,
        end,
        rangeDays,
        grouping: rangeDays <= 2 ? "hour" : rangeDays > 45 ? "week" : "day",
        comparison: {
            start: new Date(start.getTime() - durationMs),
            end: new Date(start.getTime())
        },
        comparisonRule: "Previous equivalent duration immediately before the selected range."
    };
}

function manualPaymentReviewQuery() {
    return {
        provider: "MANUAL_PROMPTPAY",
        status: "PENDING",
        "safeMetadata.receiptAttached": true,
        "safeMetadata.receiptEvidence.fileReference": { $type: "string", $ne: "" }
    };
}

function normalizeCurrency(currency) {
    return String(currency || "MMK").toUpperCase() === "THB" ? "THB" : "MMK";
}

function normalizeRegion(region) {
    const value = String(region || "").toUpperCase();
    if (value === "TH") return "TH";
    if (value === "MM") return "MM";
    return "UNKNOWN";
}

function normalizeFilterRegion(region) {
    const value = String(region || "ALL").toUpperCase();
    return REGIONS.includes(value) ? value : "ALL";
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

function orderRegionQuery(region) {
    if (REGIONS.includes(region)) return { "commercial.region": region };
    return {};
}

function dateMatch(field, range, region = "ALL", extra = {}) {
    return {
        ...extra,
        ...orderRegionQuery(region),
        [field]: { $gte: range.start, $lt: range.end }
    };
}

function currencyTotals(rows = []) {
    const totals = { MMK: 0, THB: 0 };
    rows.forEach(row => {
        const currency = normalizeCurrency(row._id?.currency || row._id || row.currency);
        totals[currency] += Number(row.total || 0);
    });
    return totals;
}

function currencyCounts(rows = []) {
    const totals = { MMK: 0, THB: 0 };
    rows.forEach(row => {
        const currency = normalizeCurrency(row._id?.currency || row._id || row.currency);
        totals[currency] += Number(row.count || 0);
    });
    return totals;
}

function percentChange(current, previous) {
    const currentValue = Number(current || 0);
    const previousValue = Number(previous || 0);
    if (previousValue === 0) return currentValue === 0 ? 0 : null;
    return Number((((currentValue - previousValue) / Math.abs(previousValue)) * 100).toFixed(1));
}

function compareNumber(current, previous) {
    return {
        current: Number(current || 0),
        previous: Number(previous || 0),
        change: percentChange(current, previous)
    };
}

function compareCurrency(current = {}, previous = {}) {
    return {
        MMK: compareNumber(current.MMK, previous.MMK),
        THB: compareNumber(current.THB, previous.THB)
    };
}

function formatAmount(value) {
    return Number(Number(value || 0).toFixed(2));
}

function sumPendingAttention(queues = {}) {
    return Object.values(queues).reduce((sum, value) => sum + Number(value || 0), 0);
}

function bucketKey(date, grouping) {
    const parts = getBangkokParts(date);
    if (grouping === "hour") {
        return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${String(parts.hour).padStart(2, "0")}:00`;
    }
    if (grouping === "week") {
        const start = startOfBangkokDay(date);
        const daysSinceEpoch = Math.floor(start.getTime() / (24 * 60 * 60 * 1000));
        const weekStart = addDays(start, -(daysSinceEpoch + 4) % 7);
        const weekParts = getBangkokParts(weekStart);
        return `${weekParts.year}-${String(weekParts.month).padStart(2, "0")}-${String(weekParts.day).padStart(2, "0")}`;
    }
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function makeBuckets(range) {
    const buckets = [];
    const stepMs = range.grouping === "hour"
        ? 60 * 60 * 1000
        : range.grouping === "week"
            ? 7 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
    for (let cursor = new Date(range.start); cursor < range.end; cursor = new Date(cursor.getTime() + stepMs)) {
        buckets.push({
            key: bucketKey(cursor, range.grouping),
            label: bucketKey(cursor, range.grouping),
            orders: 0,
            MMK: 0,
            THB: 0
        });
    }
    return buckets;
}

function stableProductName(order = {}) {
    return order.product?.gameName || order.product?.gameCode || order.product?.gameId || "Unknown Product";
}

function buildOrderStatusGroups(rows = []) {
    const raw = Object.fromEntries(ORDER_STATUSES.map(status => [status, 0]));
    rows.forEach(row => {
        raw[String(row._id || "unknown")] = Number(row.count || 0);
    });
    return [
        { key: "awaiting_payment", label: "Awaiting Payment", statuses: ["pending_payment"], count: raw.pending_payment || 0, target: actionTarget("orders", { status: "pending_payment" }) },
        { key: "paid", label: "Paid", statuses: ["paid"], count: raw.paid || 0, target: actionTarget("orders", { status: "paid" }) },
        { key: "processing", label: "Processing", statuses: ["processing"], count: raw.processing || 0, target: actionTarget("orders", { status: "processing" }) },
        { key: "completed", label: "Completed", statuses: ["completed"], count: raw.completed || 0, target: actionTarget("orders", { status: "completed" }) },
        { key: "failed_cancelled", label: "Failed / Cancelled", statuses: FAILED_STATUSES, count: FAILED_STATUSES.reduce((sum, status) => sum + (raw[status] || 0), 0), target: actionTarget("orders", { status: "failed" }) },
        { key: "refunds", label: "Refunds", statuses: ["refund_pending", "refunded"], count: (raw.refund_pending || 0) + (raw.refunded || 0), target: actionTarget("orders", { status: "refund_pending" }) }
    ];
}

function buildPaymentDistribution(paymentRows = [], eligibleOrderCount = 0) {
    return paymentRows.map(row => {
        const storedMethod = row._id?.method || "";
        const safeKey = storedMethod || "unknown";
        return {
            key: safeKey,
            storedValue: storedMethod,
            displayName: formatPaymentDisplayName(storedMethod || "unknown", storedMethod || "Unknown"),
            region: normalizeRegion(row._id?.region),
            currency: normalizeCurrency(row._id?.currency),
            orders: Number(row.orders || 0),
            paidCompleted: Number(row.paidCompleted || row.orders || 0),
            failed: Number(row.failed || 0),
            sales: formatAmount(row.sales || 0),
            share: eligibleOrderCount ? Number(((Number(row.orders || 0) / eligibleOrderCount) * 100).toFixed(1)) : 0,
            target: actionTarget("orders", storedMethod ? { paymentMethod: storedMethod } : {})
        };
    });
}

async function aggregateCurrencyAmount(match) {
    return currencyTotals(await CommerceOrder.aggregate([
        { $match: match },
        { $group: { _id: "$commercial.currency", total: { $sum: "$commercial.totalAmount" } } }
    ]));
}

async function aggregateCurrencyCount(match) {
    return currencyCounts(await CommerceOrder.aggregate([
        { $match: match },
        { $group: { _id: "$commercial.currency", count: { $sum: 1 } } }
    ]));
}

async function buildCommandCenterDashboard(query = {}, now = new Date(), admin = null) {
    const range = buildRangeFromRequest(query, now);
    const region = normalizeFilterRegion(query.region);
    const orderRegion = orderRegionQuery(region);
    const salesMatch = dateMatch("updatedAt", range, region, {
        status: { $in: SALES_STATUSES }
    });
    const previousSalesMatch = dateMatch("updatedAt", range.comparison, region, {
        status: { $in: SALES_STATUSES }
    });
    const orderCreatedMatch = dateMatch("createdAt", range, region);
    const previousOrderCreatedMatch = dateMatch("createdAt", range.comparison, region);
    const manualReview = manualPaymentReviewQuery();
    const processingTooLongCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
        grossSales,
        previousGrossSales,
        salesOrderCounts,
        previousSalesOrderCounts,
        orderCount,
        previousOrderCount,
        completedCount,
        previousCompletedCount,
        failedCancelledCount,
        previousFailedCancelledCount,
        refundCount,
        previousRefundCount,
        refundAmount,
        previousRefundAmount,
        newCustomers,
        previousNewCustomers,
        statusRows,
        statusAllRows,
        salesOrders,
        createdOrders,
        regionRows,
        paymentRows,
        walletTopupsPending,
        supportUnread,
        supportOpen,
        liveChatUnread,
        failedFulfillment,
        recentOrders,
        recentTopups,
        recentUsers,
        recentSupport
    ] = await Promise.all([
        aggregateCurrencyAmount(salesMatch),
        aggregateCurrencyAmount(previousSalesMatch),
        aggregateCurrencyCount(salesMatch),
        aggregateCurrencyCount(previousSalesMatch),
        CommerceOrder.countDocuments(orderCreatedMatch),
        CommerceOrder.countDocuments(previousOrderCreatedMatch),
        CommerceOrder.countDocuments(dateMatch("createdAt", range, region, { status: "completed" })),
        CommerceOrder.countDocuments(dateMatch("createdAt", range.comparison, region, { status: "completed" })),
        CommerceOrder.countDocuments(dateMatch("createdAt", range, region, { status: { $in: FAILED_STATUSES } })),
        CommerceOrder.countDocuments(dateMatch("createdAt", range.comparison, region, { status: { $in: FAILED_STATUSES } })),
        Promise.resolve(0),
        Promise.resolve(0),
        Promise.resolve(emptyCurrencyTotals()),
        Promise.resolve(emptyCurrencyTotals()),
        User.countDocuments({ createdAt: { $gte: range.start, $lt: range.end }, ...(region === "ALL" ? {} : { region }) }),
        User.countDocuments({ createdAt: { $gte: range.comparison.start, $lt: range.comparison.end }, ...(region === "ALL" ? {} : { region }) }),
        CommerceOrder.aggregate([
            { $match: orderCreatedMatch },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]),
        CommerceOrder.aggregate([
            { $match: orderRegion },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]),
        CommerceOrder.find(salesMatch).select("commercial product createdAt updatedAt payment status").lean(),
        CommerceOrder.find(orderCreatedMatch).select("commercial product createdAt updatedAt payment status").lean(),
        CommerceOrder.aggregate([
            { $match: orderCreatedMatch },
            {
                $group: {
                    _id: "$commercial.region",
                    orders: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
                    pendingAttention: { $sum: { $cond: [{ $in: ["$status", ["pending_payment", "paid", "refund_pending"]] }, 1, 0] } },
                    failed: { $sum: { $cond: [{ $in: ["$status", FAILED_STATUSES] }, 1, 0] } }
                }
            }
        ]),
        CommerceOrder.aggregate([
            { $match: salesMatch },
            {
                $group: {
                    _id: { method: "$payment.paymentMethodId", region: "$commercial.region", currency: "$commercial.currency" },
                    orders: { $sum: 1 },
                    paidCompleted: { $sum: 1 },
                    failed: { $sum: 0 },
                    sales: { $sum: "$commercial.totalAmount" }
                }
            },
            { $sort: { orders: -1 } }
        ]),
        WalletTopup.countDocuments({ status: "pending", ...(region === "ALL" ? {} : { region }) }),
        SupportTicket.countDocuments({ unreadByAdmin: true, status: { $nin: ["solved", "closed"] } }),
        SupportTicket.countDocuments({ status: "open" }),
        LiveChat.countDocuments({
            status: "active",
            messages: { $elemMatch: { sender: "user", readByAdmin: false } }
        }),
        FulfillmentAttempt.countDocuments({ status: "FAILED", createdAt: { $gte: range.start, $lt: range.end } }),
        CommerceOrder.find(orderRegion).sort({ updatedAt: -1 }).limit(8).select("orderId owner status product commercial updatedAt").lean(),
        WalletTopup.find(region === "ALL" ? {} : { region }).sort({ updatedAt: -1 }).limit(5).select("topupId username status amount currency updatedAt").lean(),
        User.find(region === "ALL" ? {} : { region }).sort({ createdAt: -1 }).limit(5).select("username displayName region createdAt").lean(),
        SupportTicket.find({ status: { $nin: ["solved", "closed"] } }).sort({ updatedAt: -1 }).limit(5).select("ticketId username subject status updatedAt unreadByAdmin").lean()
    ]);

    const pendingAttention = {
        manualPaymentReviews: await PaymentAttempt.countDocuments({ ...manualReview, ...(region === "ALL" ? {} : { region }) }),
        paidOrders: await CommerceOrder.countDocuments({ status: "paid", ...orderRegion }),
        processingTooLong: await CommerceOrder.countDocuments({ status: "processing", updatedAt: { $lt: processingTooLongCutoff }, ...orderRegion }),
        walletTopups: walletTopupsPending,
        support: supportUnread || supportOpen,
        liveChat: liveChatUnread,
        refunds: await CommerceOrder.countDocuments({ status: { $in: REFUND_STATUSES }, ...orderRegion }),
        failedFulfillment
    };

    const buckets = makeBuckets(range);
    const bucketByKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
    createdOrders.forEach(order => {
        const key = bucketKey(order.createdAt, range.grouping);
        const bucket = bucketByKey.get(key);
        if (bucket) bucket.orders += 1;
    });
    salesOrders.forEach(order => {
        const key = bucketKey(order.updatedAt || order.createdAt, range.grouping);
        const bucket = bucketByKey.get(key);
        if (bucket) bucket[normalizeCurrency(order.commercial?.currency)] += Number(order.commercial?.totalAmount || 0);
    });

    const topGameMap = new Map();
    salesOrders.forEach(order => {
        const key = order.product?.gameCode || order.product?.gameId || stableProductName(order);
        const current = topGameMap.get(key) || {
            key,
            name: stableProductName(order),
            orders: 0,
            sales: emptyCurrencyTotals()
        };
        current.orders += 1;
        current.sales[normalizeCurrency(order.commercial?.currency)] += Number(order.commercial?.totalAmount || 0);
        topGameMap.set(key, current);
    });
    const totalEligibleOrders = salesOrders.length || 0;
    const topGames = [...topGameMap.values()]
        .map(item => ({
            ...item,
            sales: { MMK: formatAmount(item.sales.MMK), THB: formatAmount(item.sales.THB) },
            share: totalEligibleOrders ? Number(((item.orders / totalEligibleOrders) * 100).toFixed(1)) : 0,
            target: actionTarget("orders", { productCode: item.key })
        }))
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 5);

    const regionPerformance = ["MM", "TH", "UNKNOWN"].map(regionKey => {
        const row = regionRows.find(item => normalizeRegion(item._id) === regionKey) || {};
        const regionSales = salesOrders
            .filter(order => normalizeRegion(order.commercial?.region) === regionKey)
            .reduce((totals, order) => {
                totals[normalizeCurrency(order.commercial?.currency)] += Number(order.commercial?.totalAmount || 0);
                return totals;
            }, emptyCurrencyTotals());
        const regionSalesCounts = salesOrders
            .filter(order => normalizeRegion(order.commercial?.region) === regionKey)
            .reduce((totals, order) => {
                totals[normalizeCurrency(order.commercial?.currency)] += 1;
                return totals;
            }, emptyCurrencyTotals());
        return {
            region: regionKey,
            label: regionKey === "MM" ? "Myanmar" : regionKey === "TH" ? "Thailand" : "Unknown",
            orders: Number(row.orders || 0),
            completed: Number(row.completed || 0),
            pendingAttention: Number(row.pendingAttention || 0),
            failed: Number(row.failed || 0),
            grossSales: { MMK: formatAmount(regionSales.MMK), THB: formatAmount(regionSales.THB) },
            averageOrderValue: {
                MMK: regionSalesCounts.MMK ? formatAmount(regionSales.MMK / regionSalesCounts.MMK) : 0,
                THB: regionSalesCounts.THB ? formatAmount(regionSales.THB / regionSalesCounts.THB) : 0
            }
        };
    }).filter(item => item.orders || item.region !== "UNKNOWN");

    const paymentDistribution = buildPaymentDistribution(paymentRows, totalEligibleOrders);

    const refundAmounts = {
        current: refundAmount,
        previous: previousRefundAmount
    };
    const aovCurrent = {
        MMK: salesOrderCounts.MMK ? grossSales.MMK / salesOrderCounts.MMK : 0,
        THB: salesOrderCounts.THB ? grossSales.THB / salesOrderCounts.THB : 0
    };
    const aovPrevious = {
        MMK: previousSalesOrderCounts.MMK ? previousGrossSales.MMK / previousSalesOrderCounts.MMK : 0,
        THB: previousSalesOrderCounts.THB ? previousGrossSales.THB / previousSalesOrderCounts.THB : 0
    };

    const supportActionCount = supportUnread || supportOpen;
    const supportMode = supportUnread ? "unreadByAdmin" : "open";

    const quickActions = [
        { key: "pendingOrders", label: "View Pending Orders", section: "orders", params: { filter: "manual_review" }, permission: PERMISSIONS.ORDERS_READ },
        { key: "walletTopups", label: "Review Wallet Top-ups", section: "wallet", params: { status: "pending" }, permission: PERMISSIONS.WALLET_READ },
        { key: "catalog", label: "Open Catalog", section: "catalog", params: {}, permission: PERMISSIONS.CATALOG_READ },
        { key: "homeBanner", label: "Create Home Banner", section: "home-banners", params: {}, permission: PERMISSIONS.SITE_CONTENT_MANAGE },
        { key: "broadcast", label: "Send Broadcast", section: "broadcast", params: {}, permission: PERMISSIONS.SITE_CONTENT_MANAGE },
        { key: "payments", label: "Open Payment Methods", section: "payment-methods", params: {}, permission: PERMISSIONS.PAYMENT_METHODS_READ }
    ].filter(item => !admin || hasPermission(admin, item.permission));

    return {
        range: {
            preset: range.preset,
            label: range.label,
            start: range.start,
            end: range.end,
            timezone: range.timezone,
            grouping: range.grouping,
            comparisonStart: range.comparison.start,
            comparisonEnd: range.comparison.end,
            comparisonRule: range.comparisonRule,
            maxRangeDays: MAX_DASHBOARD_RANGE_DAYS
        },
        filters: { region },
        definitions: {
            salesDateField: "updatedAt",
            orderVolumeDateField: "createdAt",
            salesStatuses: SALES_STATUSES,
            pendingAttentionScope: "Current global operational backlog; not restricted to the selected analytics date range, except failed fulfillment attempts.",
            pendingAttentionStatuses: ["pending manual payment evidence", "paid", "processing older than 24h", "refund_pending"],
            refundMetrics: "unsupported: CommerceOrder has no authoritative refund amount and refund timestamp fields",
            currencyRule: "MMK and THB are always reported separately. No FX conversion is applied."
        },
        kpis: {
            grossSales: { current: grossSales, previous: previousGrossSales, comparison: compareCurrency(grossSales, previousGrossSales) },
            orders: compareNumber(orderCount, previousOrderCount),
            completedOrders: compareNumber(completedCount, previousCompletedCount),
            pendingAttention: compareNumber(sumPendingAttention(pendingAttention), 0),
            failedCancelled: compareNumber(failedCancelledCount, previousFailedCancelledCount),
            refunds: { count: compareNumber(refundCount, previousRefundCount), amount: compareCurrency(refundAmounts.current, refundAmounts.previous) },
            averageOrderValue: {
                current: { MMK: formatAmount(aovCurrent.MMK), THB: formatAmount(aovCurrent.THB) },
                previous: { MMK: formatAmount(aovPrevious.MMK), THB: formatAmount(aovPrevious.THB) },
                comparison: compareCurrency(aovCurrent, aovPrevious)
            },
            newCustomers: compareNumber(newCustomers, previousNewCustomers)
        },
        series: buckets.map(bucket => ({
            ...bucket,
            MMK: formatAmount(bucket.MMK),
            THB: formatAmount(bucket.THB)
        })),
        orderStatus: buildOrderStatusGroups(statusRows),
        orderStatusAll: buildOrderStatusGroups(statusAllRows),
        topGames,
        regionPerformance,
        paymentDistribution,
        attention: [
            { key: "manualPaymentReviews", label: "Payment verification", count: pendingAttention.manualPaymentReviews, severity: "warning", oldestWaitingAt: null, target: actionTarget("orders", { filter: "manual_review" }) },
            { key: "paidOrders", label: "Paid orders awaiting fulfillment", count: pendingAttention.paidOrders, severity: "info", oldestWaitingAt: null, target: actionTarget("orders", { status: "paid" }) },
            { key: "processingTooLong", label: "Processing longer than 24h", count: pendingAttention.processingTooLong, severity: "danger", oldestWaitingAt: null, target: actionTarget("orders", { status: "processing" }) },
            { key: "walletTopups", label: "Pending wallet top-ups", count: pendingAttention.walletTopups, severity: "warning", oldestWaitingAt: null, target: actionTarget("wallet", { status: "pending" }) },
            { key: "support", label: "Support needs attention", count: pendingAttention.support, severity: "info", oldestWaitingAt: null, target: actionTarget("support", { filter: supportMode }) },
            { key: "liveChat", label: "Unread live chat", count: pendingAttention.liveChat, severity: "info", oldestWaitingAt: null, target: actionTarget("chat", { filter: "unread" }) },
            { key: "refunds", label: "Refund review", count: pendingAttention.refunds, severity: "danger", oldestWaitingAt: null, target: actionTarget("orders", { status: "refund_pending" }) },
            { key: "failedFulfillment", label: "Failed fulfillment attempts", count: pendingAttention.failedFulfillment, severity: "danger", oldestWaitingAt: null, target: actionTarget("fulfillment", { status: "FAILED" }) }
        ],
        recentActivity: {
            orders: recentOrders.map(order => ({
                type: "order",
                id: order.orderId,
                title: order.orderId,
                subtitle: `${order.product?.gameName || order.product?.gameCode || "Order"} · ${order.product?.packageCode || "-"}`,
                amount: order.commercial?.totalAmount,
                currency: normalizeCurrency(order.commercial?.currency),
                status: order.status,
                at: order.updatedAt,
                target: actionTarget("orders", { status: order.status })
            })),
            wallet: recentTopups.map(topup => ({
                type: "wallet",
                id: topup.topupId,
                title: topup.topupId,
                subtitle: topup.username,
                amount: topup.amount,
                currency: normalizeCurrency(topup.currency),
                status: topup.status,
                at: topup.updatedAt,
                target: actionTarget("wallet", { status: topup.status })
            })),
            customers: recentUsers.map(user => ({
                type: "customer",
                id: user.username,
                title: user.displayName || user.username,
                subtitle: normalizeRegion(user.region),
                status: "new",
                at: user.createdAt,
                target: actionTarget("users", { search: user.username })
            })),
            support: recentSupport.map(ticket => ({
                type: "support",
                id: ticket.ticketId,
                title: ticket.subject,
                subtitle: ticket.username,
                status: ticket.unreadByAdmin ? "unread" : ticket.status,
                at: ticket.updatedAt,
                target: actionTarget("support", { filter: ticket.unreadByAdmin ? "unreadByAdmin" : "open" })
            }))
        },
        quickActions,
        actionRequired: {
            manualPaymentReviews: { count: pendingAttention.manualPaymentReviews, target: actionTarget("orders", { filter: "manual_review" }), severity: "warning" },
            paidOrders: { count: pendingAttention.paidOrders, target: actionTarget("orders", { status: "paid" }), severity: "info" },
            walletTopups: { count: pendingAttention.walletTopups, target: actionTarget("wallet", { status: "pending" }), severity: "warning" },
            support: { count: supportActionCount, target: actionTarget("support", { filter: supportMode }), severity: "info", mode: supportMode },
            liveChat: { count: pendingAttention.liveChat, target: actionTarget("chat", { filter: "unread" }), severity: "info" },
            refunds: { count: pendingAttention.refunds, target: actionTarget("orders", { status: "refund_pending" }), severity: "danger" }
        },
        today: {
            orders: orderCount,
            completedOrders: completedCount,
            failedOrders: failedCancelledCount,
            newUsers: newCustomers,
            completedOrderValue: grossSales
        },
        recentOperations: recentOrders.map(order => ({
            type: "order",
            orderId: order.orderId,
            username: "",
            status: order.status,
            game: order.product?.gameName || order.product?.gameCode || "",
            packageName: order.product?.packageCode || "",
            amount: order.commercial?.totalAmount,
            currency: normalizeCurrency(order.commercial?.currency),
            updatedAt: order.updatedAt
        })),
        timezone: DASHBOARD_TIMEZONE,
        updatedAt: new Date()
    };
}

// ============================
// ADMIN DASHBOARD STATS
// GET /api/admin/stats
// ============================

router.get("/admin/dashboard/command-center", adminMiddleware, requireAdminPermission(PERMISSIONS.DASHBOARD_READ), async (req, res) => {
    try {
        const dashboard = await buildCommandCenterDashboard(req.query, new Date(), req.admin);
        res.json({ success: true, dashboard });
    } catch (error) {
        console.log("Admin command center error:", error);
        res.status(error.status || 500).json({
            success: false,
            code: error.code || "DASHBOARD_COMMAND_CENTER_FAILED",
            message: error.message || "Server error"
        });
    }
});

router.get("/admin/stats", adminMiddleware, requireAdminPermission(PERMISSIONS.DASHBOARD_READ), async (req, res) => {
    try {
        const dashboard = await buildCommandCenterDashboard({ preset: "today", region: "ALL" }, new Date(), req.admin);
        const totalOrders = await CommerceOrder.countDocuments();
        const [pendingOrders, processingOrders, completedOrders, cancelledOrders, paidOrders, totalUsers] = await Promise.all([
            CommerceOrder.countDocuments({ status: "pending_payment" }),
            CommerceOrder.countDocuments({ status: "processing" }),
            CommerceOrder.countDocuments({ status: "completed" }),
            CommerceOrder.countDocuments({ status: { $in: FAILED_STATUSES } }),
            CommerceOrder.countDocuments({ status: "paid" }),
            User.countDocuments()
        ]);
        const completedOrderValue = dashboard.today.completedOrderValue || emptyCurrencyTotals();

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
    MAX_DASHBOARD_RANGE_DAYS,
    getBangkokTodayBounds,
    buildRangeFromRequest,
    buildCommandCenterDashboard,
    buildPaymentDistribution,
    manualPaymentReviewQuery,
    orderRegionQuery,
    dateMatch,
    sumPendingAttention,
    normalizeCurrency,
    normalizeRegion,
    SALES_STATUSES,
    FAILED_STATUSES,
    ORDER_STATUSES
};

module.exports = router;
