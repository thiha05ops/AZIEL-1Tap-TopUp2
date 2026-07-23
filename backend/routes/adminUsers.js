const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Order = require("../models/Order");
const WalletTransaction = require("../models/WalletTransaction");
const SupportTicket = require("../models/SupportTicket");
const Notification = require("../models/Notification");
const CustomerNote = require("../models/CustomerNote");
const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const {
    applyCursorFilter,
    escapeRegex,
    normalizeSearch,
    pageResult,
    parseLimit,
    sendPaginationError
} = require("../services/paginationService");

const SALES_STATUSES = Object.freeze(["paid", "processing", "completed"]);
const FAILED_STATUSES = Object.freeze(["failed", "cancelled", "expired"]);
const REFUND_STATUSES = Object.freeze(["refund_requested", "refund_pending", "refunded"]);

function normalizeCurrency(currency) {
    return String(currency || "").toUpperCase() === "THB" ? "THB" : "MMK";
}

function emptyCurrencyTotals() {
    return { MMK: 0, THB: 0 };
}

function addCurrency(totals, currency, amount) {
    totals[normalizeCurrency(currency)] += Number(amount || 0);
    return totals;
}

function formatDate(value) {
    return value ? new Date(value) : null;
}

function summarizeOrders(orders = []) {
    const summary = {
        totalOrders: orders.length,
        completedOrders: 0,
        failedOrders: 0,
        refundCount: 0,
        totalSpend: emptyCurrencyTotals(),
        averageOrder: emptyCurrencyTotals(),
        lastPurchaseAt: null,
        favoriteGame: "None",
        favoritePaymentMethod: "None"
    };
    const salesCounts = emptyCurrencyTotals();
    const gameCounts = new Map();
    const paymentCounts = new Map();

    orders.forEach(order => {
        const status = String(order.status || "").toLowerCase();
        if (status === "completed") summary.completedOrders += 1;
        if (FAILED_STATUSES.includes(status)) summary.failedOrders += 1;
        if (REFUND_STATUSES.includes(status) || order.refunded) summary.refundCount += 1;

        if (SALES_STATUSES.includes(status) && !order.refunded) {
            addCurrency(summary.totalSpend, order.currency, order.amount);
            salesCounts[normalizeCurrency(order.currency)] += 1;
            const purchaseDate = formatDate(order.updatedAt || order.createdAt);
            if (purchaseDate && (!summary.lastPurchaseAt || purchaseDate > summary.lastPurchaseAt)) {
                summary.lastPurchaseAt = purchaseDate;
            }
        }

        const game = order.productName || order.game || order.productCode || "Unknown";
        gameCounts.set(game, (gameCounts.get(game) || 0) + 1);
        const method = order.paymentMethod || "Unknown";
        paymentCounts.set(method, (paymentCounts.get(method) || 0) + 1);
    });

    summary.averageOrder.MMK = salesCounts.MMK ? Number((summary.totalSpend.MMK / salesCounts.MMK).toFixed(2)) : 0;
    summary.averageOrder.THB = salesCounts.THB ? Number((summary.totalSpend.THB / salesCounts.THB).toFixed(2)) : 0;
    summary.favoriteGame = topMapValue(gameCounts) || "None";
    summary.favoritePaymentMethod = topMapValue(paymentCounts) || "None";
    summary.lifetimeValue = summary.totalSpend;
    return summary;
}

function topMapValue(map) {
    let best = "";
    let bestCount = 0;
    map.forEach((count, key) => {
        if (count > bestCount) {
            best = key;
            bestCount = count;
        }
    });
    return best;
}

function calculateTags({ user, summary, lastActivityAt }) {
    const createdAt = formatDate(user.createdAt);
    const now = Date.now();
    const ageDays = createdAt ? (now - createdAt.getTime()) / (24 * 60 * 60 * 1000) : 0;
    const recentDays = lastActivityAt ? (now - new Date(lastActivityAt).getTime()) / (24 * 60 * 60 * 1000) : Infinity;
    const totalSpend = Number(summary.totalSpend.MMK || 0) + Number(summary.totalSpend.THB || 0) * 100;
    const tags = [];

    if (totalSpend >= 100000 || summary.totalSpend.THB >= 1000) tags.push("High Value");
    if (summary.totalOrders >= 10) tags.push("Frequent Buyer");
    if (ageDays >= 180) tags.push("Early Supporter");
    if (recentDays <= 14) tags.push("Recently Active");
    if (recentDays > 90) tags.push("Inactive");
    if (totalSpend >= 250000 || summary.totalOrders >= 25) tags.push("VIP");
    if (isRewardEligible(summary, ageDays)) tags.push("Reward Eligible");
    return tags;
}

function isRewardEligible(summary, ageDays) {
    return summary.totalOrders >= 5 ||
        summary.totalSpend.MMK >= 50000 ||
        summary.totalSpend.THB >= 500 ||
        ageDays >= 180;
}

function rewardEligibility(user, summary) {
    const createdAt = formatDate(user.createdAt);
    const ageDays = createdAt ? (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000) : 0;
    const reasons = [];
    if (summary.totalSpend.MMK >= 50000 || summary.totalSpend.THB >= 500) reasons.push("Spent over threshold");
    if (summary.totalOrders >= 5) reasons.push("Frequent orders");
    if (ageDays >= 180) reasons.push("Long-term customer");
    if (!reasons.length) reasons.push("Needs more completed activity");
    return { eligible: isRewardEligible(summary, ageDays), reasons };
}

function lastActivity(user, orders = [], wallet = [], support = [], notifications = []) {
    return [user.lastActiveAt, user.sessionUpdatedAt, user.createdAt]
        .concat(orders.map(item => item.updatedAt || item.createdAt))
        .concat(wallet.map(item => item.updatedAt || item.createdAt))
        .concat(support.map(item => item.updatedAt || item.createdAt))
        .concat(notifications.map(item => item.createdAt))
        .map(formatDate)
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || null;
}

function formatOrder(order) {
    return {
        id: order._id,
        orderId: order.orderId,
        game: order.productName || order.game || "Unknown",
        packageName: order.packageName || "-",
        amount: Number(order.amount || 0),
        currency: normalizeCurrency(order.currency),
        status: order.status || "",
        date: order.createdAt
    };
}

function formatWalletTransaction(item) {
    return {
        id: item._id,
        transactionId: item.transactionId,
        type: item.type,
        direction: item.direction,
        amount: Number(item.amount || 0),
        currency: normalizeCurrency(item.currency),
        status: item.status,
        description: item.description || item.referenceType || "",
        date: item.createdAt
    };
}

function buildActivity({ user, orders, wallet, support, notifications }) {
    const rows = [{
        type: "registration",
        title: "Registered",
        description: user.email || user.username,
        date: user.createdAt
    }];

    orders.slice(0, 8).forEach(order => rows.push({
        type: "order",
        title: `Order ${order.orderId}`,
        description: `${order.productName || order.game || "Order"} · ${order.status}`,
        amount: order.amount,
        currency: normalizeCurrency(order.currency),
        date: order.updatedAt || order.createdAt
    }));
    wallet.slice(0, 8).forEach(item => rows.push({
        type: "wallet",
        title: item.type,
        description: item.description || item.status,
        amount: item.amount,
        currency: normalizeCurrency(item.currency),
        date: item.createdAt
    }));
    support.slice(0, 5).forEach(ticket => rows.push({
        type: "support",
        title: ticket.subject,
        description: ticket.status,
        date: ticket.updatedAt || ticket.createdAt
    }));
    notifications.slice(0, 5).forEach(item => rows.push({
        type: "notification",
        title: item.title,
        description: item.category || item.type,
        date: item.createdAt
    }));

    return rows.filter(item => item.date).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30);
}

function safeAdminName(admin = {}) {
    return admin.displayName || admin.username || admin.email || "Admin";
}

router.get("/admin/users", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_READ), async (req, res) => {
    try {
        const limit = parseLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 });
        const search = normalizeSearch(req.query.q || "", { maxLength: 80 });
        const region = String(req.query.region || "all").toUpperCase();
        const status = String(req.query.status || "all").toLowerCase();
        const sort = String(req.query.sort || "newest").toLowerCase();
        const query = {};

        if (search) {
            const escaped = escapeRegex(search);
            const orderMatches = await Order.find({ orderId: { $regex: escaped, $options: "i" } })
                .select("username")
                .limit(50)
                .lean();
            const orderUsernames = orderMatches.map(order => order.username).filter(Boolean);
            query.$or = [
                { username: { $regex: `^${escaped}`, $options: "i" } },
                { email: { $regex: `^${escaped}`, $options: "i" } },
                { username: { $in: orderUsernames } }
            ];
        }
        if (["MM", "TH"].includes(region)) query.region = region;
        if (status === "blocked") query.isBlocked = true;
        if (status === "active") query.isBlocked = { $ne: true };

        const usersRaw = await User.find(applyCursorFilter(query, req.query.cursor))
            .select("_id username email displayName photo region wallet isBlocked createdAt lastActiveAt lastLoginDevice sessionUpdatedAt")
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit + 1)
            .lean();
        const { page, pagination } = pageResult(usersRaw, limit);
        const usernames = page.map(user => user.username).filter(Boolean);
        const orderSummaries = usernames.length
            ? await Order.aggregate([
                { $match: { username: { $in: usernames } } },
                {
                    $addFields: {
                        normalizedStatus: { $toLower: { $ifNull: ["$status", ""] } },
                        normalizedCurrency: { $toUpper: { $ifNull: ["$currency", "MMK"] } }
                    }
                },
                {
                    $group: {
                        _id: "$username",
                        totalOrders: { $sum: 1 },
                        completedOrders: { $sum: { $cond: [{ $eq: ["$normalizedStatus", "completed"] }, 1, 0] } },
                        failedOrders: { $sum: { $cond: [{ $in: ["$normalizedStatus", FAILED_STATUSES] }, 1, 0] } },
                        totalSpendMMK: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $in: ["$normalizedStatus", SALES_STATUSES] },
                                            { $ne: ["$refunded", true] },
                                            { $eq: ["$normalizedCurrency", "MMK"] }
                                        ]
                                    },
                                    { $ifNull: ["$amount", 0] },
                                    0
                                ]
                            }
                        },
                        totalSpendTHB: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $in: ["$normalizedStatus", SALES_STATUSES] },
                                            { $ne: ["$refunded", true] },
                                            { $eq: ["$normalizedCurrency", "THB"] }
                                        ]
                                    },
                                    { $ifNull: ["$amount", 0] },
                                    0
                                ]
                            }
                        },
                        lastPurchaseAt: {
                            $max: {
                                $cond: [
                                    { $and: [{ $in: ["$normalizedStatus", SALES_STATUSES] }, { $ne: ["$refunded", true] }] },
                                    { $ifNull: ["$updatedAt", "$createdAt"] },
                                    null
                                ]
                            }
                        }
                    }
                }
            ])
            : [];
        const summaryByUsername = new Map(orderSummaries.map(item => [String(item._id || ""), item]));

        let formattedUsers = page.map(user => {
            const summary = summaryByUsername.get(user.username) || {};
            const normalizedSummary = {
                totalOrders: Number(summary.totalOrders || 0),
                completedOrders: Number(summary.completedOrders || 0),
                failedOrders: Number(summary.failedOrders || 0),
                totalSpend: {
                    MMK: Number(summary.totalSpendMMK || 0),
                    THB: Number(summary.totalSpendTHB || 0)
                },
                lastPurchaseAt: summary.lastPurchaseAt || null
            };
            const lastActivityAt = lastActivity(user, [], [], [], []);
            const tags = calculateTags({ user, summary: normalizedSummary, lastActivityAt });

            return {
                _id: user._id,
                username: user.username || user.email || "Unknown",
                email: user.email || "",
                displayName: user.displayName || user.username || "",
                avatar: user.photo || user.photoEvidence?.url || "",
                region: user.region || "MM",
                wallet: user.wallet || { MMK: 0, THB: 0 },
                totalOrders: normalizedSummary.totalOrders,
                completedOrders: normalizedSummary.completedOrders,
                failedOrders: normalizedSummary.failedOrders,
                totalSpend: normalizedSummary.totalSpend,
                lastPurchaseAt: normalizedSummary.lastPurchaseAt,
                lastActivityAt,
                tags,
                vip: tags.includes("VIP"),
                rewardEligible: tags.includes("Reward Eligible"),
                isBlocked: user.isBlocked || false,
                debugVersion: "ADMIN_USERS_CRM_V1",
                createdAt: user.createdAt
            };
        });

        if (status === "vip") formattedUsers = formattedUsers.filter(user => user.vip);
        if (status === "reward") formattedUsers = formattedUsers.filter(user => user.rewardEligible);

        const sorters = {
            highest_spend: (a, b) => ((b.totalSpend?.MMK || 0) + (b.totalSpend?.THB || 0) * 100) - ((a.totalSpend?.MMK || 0) + (a.totalSpend?.THB || 0) * 100),
            most_orders: (a, b) => Number(b.totalOrders || 0) - Number(a.totalOrders || 0),
            recently_active: (a, b) => new Date(b.lastActivityAt || b.createdAt) - new Date(a.lastActivityAt || a.createdAt),
            highest_wallet: (a, b) => ((b.wallet?.MMK || 0) + (b.wallet?.THB || 0) * 100) - ((a.wallet?.MMK || 0) + (a.wallet?.THB || 0) * 100),
            newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        };
        formattedUsers.sort(sorters[sort] || sorters.newest);

        return res.json({
            success: true,
            items: formattedUsers,
            users: formattedUsers,
            pagination
        });

    } catch (error) {
        console.log("Admin users error:", error);
        const paginationResponse = sendPaginationError(res, error);
        if (paginationResponse) return paginationResponse;

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.get("/admin/users/:id/crm", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_READ), async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select("_id username email displayName photo photoEvidence region wallet isBlocked createdAt lastActiveAt lastLoginDevice sessionUpdatedAt")
            .lean();

        if (!user) {
            return res.status(404).json({ success: false, message: "Customer not found" });
        }

        const [orders, wallet, support, notifications, notes] = await Promise.all([
            Order.find({ username: user.username })
                .sort({ createdAt: -1, _id: -1 })
                .limit(50)
                .select("orderId game productName productCode packageName amount currency status paymentMethod refunded refundAmount createdAt updatedAt")
                .lean(),
            WalletTransaction.find({ username: user.username })
                .sort({ createdAt: -1, _id: -1 })
                .limit(50)
                .select("transactionId type direction amount currency status description referenceType orderId topupId createdAt updatedAt")
                .lean(),
            SupportTicket.find({ username: user.username })
                .sort({ updatedAt: -1, _id: -1 })
                .limit(20)
                .select("ticketId subject status unreadByAdmin createdAt updatedAt")
                .lean(),
            Notification.find({ username: user.username })
                .sort({ createdAt: -1, _id: -1 })
                .limit(20)
                .select("title message type category orderId createdAt")
                .lean(),
            CustomerNote.find({ userId: user._id })
                .sort({ createdAt: -1, _id: -1 })
                .limit(50)
                .lean()
        ]);

        const summary = summarizeOrders(orders);
        const lastActivityAt = lastActivity(user, orders, wallet, support, notifications);
        const tags = calculateTags({ user, summary, lastActivityAt });

        return res.json({
            success: true,
            customer: {
                _id: user._id,
                username: user.username,
                email: user.email || "",
                displayName: user.displayName || user.username,
                avatar: user.photo || user.photoEvidence?.url || "",
                region: user.region || "MM",
                isBlocked: Boolean(user.isBlocked),
                wallet: user.wallet || { MMK: 0, THB: 0 },
                memberSince: user.createdAt,
                lastLogin: user.lastLoginDevice?.loginAt || user.sessionUpdatedAt || null,
                lastActivityAt,
                tags,
                reward: rewardEligibility(user, summary),
                summary
            },
            orders: orders.map(formatOrder),
            wallet: wallet.map(formatWalletTransaction),
            activity: buildActivity({ user, orders, wallet, support, notifications }),
            notes: notes.map(note => ({
                _id: note._id,
                body: note.body,
                adminName: note.createdByAdminName || "Admin",
                updatedByAdminName: note.updatedByAdminName || "",
                createdAt: note.createdAt,
                updatedAt: note.updatedAt
            }))
        });
    } catch (error) {
        console.log("Admin customer CRM error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

router.post("/admin/users/:id/notes", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
    try {
        const body = String(req.body?.body || "").trim();
        if (!body) return res.status(400).json({ success: false, message: "Note is required" });

        const user = await User.findById(req.params.id).select("_id").lean();
        if (!user) return res.status(404).json({ success: false, message: "Customer not found" });

        const note = await CustomerNote.create({
            userId: user._id,
            body,
            createdByAdminId: req.admin?._id || null,
            createdByAdminName: safeAdminName(req.admin)
        });

        return res.status(201).json({ success: true, note });
    } catch (error) {
        console.log("Admin customer note create error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

router.put("/admin/users/:id/notes/:noteId", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
    try {
        const body = String(req.body?.body || "").trim();
        if (!body) return res.status(400).json({ success: false, message: "Note is required" });

        const note = await CustomerNote.findOne({ _id: req.params.noteId, userId: req.params.id });
        if (!note) return res.status(404).json({ success: false, message: "Note not found" });

        note.body = body;
        note.updatedByAdminId = req.admin?._id || null;
        note.updatedByAdminName = safeAdminName(req.admin);
        await note.save();

        return res.json({ success: true, note });
    } catch (error) {
        console.log("Admin customer note update error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

router.delete("/admin/users/:id/notes/:noteId", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
    try {
        const note = await CustomerNote.findOne({ _id: req.params.noteId, userId: req.params.id });
        if (!note) return res.status(404).json({ success: false, message: "Note not found" });

        await note.deleteOne();
        return res.json({ success: true });
    } catch (error) {
        console.log("Admin customer note delete error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

router.put("/admin/users/:id/block", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        user.isBlocked = !user.isBlocked;
        await user.save();

        res.json({
            success: true,
            message: user.isBlocked ? "User blocked" : "User unblocked",
            user
        });

    } catch (error) {
        res.json({
            success: false,
            message: "Server error"
        });
    }
});

router.delete("/admin/users/:id", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        await user.deleteOne();

        res.json({
            success: true,
            message: "User deleted"
        });

    } catch (error) {
        res.json({
            success: false,
            message: "Server error"
        });
    }
});
router.get("/admin/users-debug-version", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_READ), (req, res) => {
    res.json({
        success: true,
        version: "ADMIN_USERS_V2_TOTALS",
        time: new Date()
    });
});
module.exports = router;
