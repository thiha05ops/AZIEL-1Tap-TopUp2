const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const User = require("../models/User");
const realtime = require("./realtime");
const {
    applyCursorFilter,
    encodeCursor,
    pageResult,
    parseLimit
} = require("./paginationService");

const VALID_TYPES = new Set([
    "order",
    "wallet",
    "refund",
    "support",
    "order_completed",
    "topup_delayed",
    "announcement",
    "promo",
    "system",
    "general"
]);

const VALID_CATEGORIES = new Set([
    "orders",
    "payments",
    "wallet",
    "refunds",
    "support",
    "announcements",
    "promotions",
    "security",
    "system"
]);

function isObjectId(value) {
    return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function cleanText(value, fallback = "") {
    return String(value ?? fallback).trim();
}

function normalizeType(type) {
    const value = cleanText(type || "general").toLowerCase();
    return VALID_TYPES.has(value) ? value : "general";
}

function normalizeCategory(category, type = "") {
    const value = cleanText(category || "").toLowerCase();
    if (VALID_CATEGORIES.has(value)) return value;

    if (type === "order" || type === "order_completed" || type === "topup_delayed") return "orders";
    if (type === "wallet") return "wallet";
    if (type === "refund") return "refunds";
    if (type === "support") return "support";
    if (type === "promo") return "promotions";
    if (type === "announcement") return "announcements";

    return "system";
}

function sanitizeAction(action = null) {
    if (!action || typeof action !== "object") return null;

    const url = cleanText(action.url || "");

    if (url && !url.startsWith("/") && !/^[a-z0-9_-]+\.html/i.test(url)) {
        return null;
    }

    if (/^\s*javascript:/i.test(url)) return null;

    return {
        type: cleanText(action.type || "navigate"),
        label: cleanText(action.label || "Open"),
        url
    };
}

function sanitizeMetadata(metadata = {}) {
    if (!metadata || typeof metadata !== "object") return {};

    const safe = {};

    [
        "orderId",
        "ticketId",
        "walletTopupId",
        "topupId",
        "paymentId",
        "transactionId",
        "game",
        "currency",
        "amount"
    ].forEach(key => {
        if (metadata[key] !== undefined && metadata[key] !== null) {
            safe[key] = metadata[key];
        }
    });

    return safe;
}

function userContextFromAuth(user) {
    if (!user) return null;

    return {
        id: user.id || String(user._id || ""),
        _id: user._id || user.id,
        username: user.username || "",
        email: user.email || "",
        role: user.role || "user",
        region: user.region || "MM"
    };
}

async function resolveUserOwner(input = {}) {
    if (input.user) {
        const context = userContextFromAuth(input.user);
        if (context?.id && context?.username) return context;
    }

    if (input.userId && isObjectId(input.userId)) {
        const user = await User.findById(input.userId).select("_id username email role region");
        if (user) return userContextFromAuth(user);
    }

    if (input.username) {
        const user = await User.findOne({ username: String(input.username).trim() })
            .select("_id username email role region");
        if (user) return userContextFromAuth(user);

        return {
            id: "",
            _id: null,
            username: String(input.username).trim(),
            email: "",
            role: "user",
            region: "MM"
        };
    }

    return null;
}

function ownerFilter(user) {
    const context = userContextFromAuth(user);
    const filters = [];

    if (context?.id && isObjectId(context.id)) {
        filters.push({ userId: context.id });
    }

    if (context?.username) {
        filters.push({
            $and: [
                {
                    $or: [
                        { userId: { $exists: false } },
                        { userId: null }
                    ]
                },
                { username: context.username }
            ]
        });
    }

    return filters.length === 1 ? filters[0] : { $or: filters };
}

function activeFilter(user) {
    return {
        ...ownerFilter(user),
        deletedByUser: false
    };
}

function normalizeNotification(notification) {
    const item = typeof notification?.toObject === "function"
        ? notification.toObject()
        : notification || {};

    const type = normalizeType(item.type);
    const category = normalizeCategory(item.category, type);
    const metadata = sanitizeMetadata({
        ...(item.metadata || {}),
        ...(item.orderId ? { orderId: item.orderId } : {})
    });

    const action = sanitizeAction(item.action) ||
        (metadata.orderId
            ? {
                type: "navigate",
                label: "View Order",
                url: `/tracking.html?orderId=${encodeURIComponent(metadata.orderId)}`
            }
            : null);

    return {
        id: item._id ? String(item._id) : String(item.id || ""),
        _id: item._id ? String(item._id) : String(item.id || ""),
        userId: item.userId ? String(item.userId) : "",
        username: item.username || "",
        type,
        category,
        title: item.title || "Notification",
        message: item.message || "",
        status: item.status || "active",
        read: Boolean(item.isRead || item.read),
        isRead: Boolean(item.isRead || item.read),
        createdAt: item.createdAt || new Date(),
        updatedAt: item.updatedAt || item.createdAt || new Date(),
        action,
        metadata,
        orderId: metadata.orderId || item.orderId || ""
    };
}

async function getUnreadCount(user) {
    return Notification.countDocuments({
        ...activeFilter(user),
        isRead: false
    });
}

async function createUserNotification(input = {}) {
    const owner = await resolveUserOwner(input);

    if (!owner?.username) {
        throw new Error("Notification owner is required");
    }

    const title = cleanText(input.title);
    if (!title) {
        throw new Error("Notification title is required");
    }

    const type = normalizeType(input.type);
    const category = normalizeCategory(input.category, type);
    const metadata = sanitizeMetadata({
        ...(input.metadata || {}),
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(input.ticketId ? { ticketId: input.ticketId } : {}),
        ...(input.topupId ? { topupId: input.topupId, walletTopupId: input.topupId } : {})
    });

    const notification = await Notification.create({
        userId: owner.id && isObjectId(owner.id) ? owner.id : null,
        username: owner.username,
        title,
        message: cleanText(input.message),
        type,
        category,
        status: cleanText(input.status || "active"),
        orderId: metadata.orderId || "",
        action: sanitizeAction(input.action),
        metadata,
        source: cleanText(input.source || ""),
        deletedByUser: false,
        isRead: false
    });

    const normalized = normalizeNotification(notification);
    const unreadCount = await getUnreadCount(owner);

    await realtime.emitNotification(owner.username, normalized, { unreadCount });

    return {
        notification,
        normalized,
        unreadCount
    };
}

async function getUserNotifications(user, options = {}) {
    const limit = parseLimit(options.limit, { defaultLimit: 20, maxLimit: 50 });
    const cursor = cleanText(options.cursor || "");
    let filter = activeFilter(user);

    if (cursor && isObjectId(cursor)) {
        const cursorNotification = await Notification.findOne({
            _id: cursor,
            ...filter
        }).select("createdAt");

        if (cursorNotification?.createdAt) {
            filter = applyCursorFilter(filter, encodeCursor(cursorNotification));
        }
    } else {
        filter = applyCursorFilter(filter, cursor);
    }

    const raw = await Notification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();

    const { page, pagination } = pageResult(raw, limit);
    const unreadCount = await getUnreadCount(user);

    return {
        notifications: page.map(normalizeNotification),
        items: page.map(normalizeNotification),
        unreadCount,
        pagination
    };
}

async function markNotificationRead(user, id) {
    if (!isObjectId(id)) return null;

    const notification = await Notification.findOneAndUpdate(
        {
            _id: id,
            ...activeFilter(user)
        },
        { isRead: true },
        { new: true }
    );

    if (!notification) return null;

    const unreadCount = await getUnreadCount(user);
    await realtime.emitNotificationCount(user.username, unreadCount);

    return {
        notification,
        normalized: normalizeNotification(notification),
        unreadCount
    };
}

async function markAllNotificationsRead(user) {
    await Notification.updateMany(
        {
            ...activeFilter(user),
            isRead: false
        },
        { isRead: true }
    );

    const unreadCount = await getUnreadCount(user);
    await realtime.emitNotificationCount(user.username, unreadCount);

    return { unreadCount };
}

async function deleteNotification(user, id) {
    if (!isObjectId(id)) return null;

    const notification = await Notification.findOneAndUpdate(
        {
            _id: id,
            ...activeFilter(user)
        },
        {
            deletedByUser: true,
            isRead: true
        },
        { new: true }
    );

    if (!notification) return null;

    const unreadCount = await getUnreadCount(user);
    await realtime.emitNotificationCount(user.username, unreadCount);

    return { unreadCount };
}

async function createBroadcastNotifications(input = {}) {
    const usernames = Array.isArray(input.usernames)
        ? input.usernames.map(name => String(name || "").trim()).filter(Boolean)
        : [];

    const results = [];

    for (const username of usernames) {
        const result = await createUserNotification({
            username,
            title: input.title,
            message: input.message,
            type: input.type || "announcement",
            category: input.category || "announcements",
            action: input.action,
            metadata: input.metadata,
            source: "admin_broadcast"
        });

        results.push(result.normalized);
    }

    return {
        count: results.length,
        notifications: results
    };
}

module.exports = {
    createBroadcastNotifications,
    createUserNotification,
    deleteNotification,
    getUnreadCount,
    getUserNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    normalizeNotification,
    ownerFilter,
    resolveUserOwner
};
