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
const { replacePaymentDisplayNames } = require("./paymentDisplayNameService");

const VALID_TYPES = new Set([
    "order",
    "wallet",
    "refund",
    "support",
    "order_completed",
    "topup_delayed",
    "announcement",
    "promo",
    "payment_recovery",
    "system",
    "general"
]);

const PAYMENT_RECOVERY_TYPE = "payment_recovery";
const PAYMENT_RECOVERY_SOURCE = "manual_payment_recovery";
const PAYMENT_RECOVERY_ACTION_TYPE = "resume_manual_payment";
const PAYMENT_RECOVERY_I18N = Object.freeze({
    title: "pendingPaymentNotificationTitle",
    message: "pendingPaymentNotificationMessage",
    action: "pendingPaymentNotificationAction"
});

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
    if (type === PAYMENT_RECOVERY_TYPE) return "payments";
    if (type === "refund") return "refunds";
    if (type === "support") return "support";
    if (type === "promo") return "promotions";
    if (type === "announcement") return "announcements";

    return "system";
}

function sanitizeAction(action = null) {
    if (!action || typeof action !== "object") return null;

    const url = cleanText(action.url || "");

    if (url && !url.startsWith("/") && !/^[a-z0-9_-]+\.html/i.test(url) && !/^https?:\/\//i.test(url)) {
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
        "amount",
        "promotionNotificationId",
        "promoCode",
        "campaignCode",
        "startsAt",
        "endsAt",
        "imageUrl",
        "manualPaymentAttemptId",
        "attemptReference",
        "packageName",
        "recoverableExpiresAt",
        "notificationActionType",
        "i18nTitleKey",
        "i18nMessageKey",
        "i18nActionKey"
    ].forEach(key => {
        if (metadata[key] !== undefined && metadata[key] !== null) {
            safe[key] = metadata[key];
        }
    });

    return safe;
}

function buildPaymentRecoveryMessage(game) {
    const name = cleanText(game || "your order", "your order");
    return `Your ${name} payment is waiting to be completed.`;
}

function buildPaymentRecoveryMetadata(attempt = {}, recovery = {}) {
    return sanitizeMetadata({
        manualPaymentAttemptId: attempt.attemptId || recovery.attemptId,
        attemptReference: attempt.reference || recovery.attemptReference || recovery.reference,
        game: attempt.productName || recovery.productName || recovery.game || "your order",
        packageName: attempt.packageName || recovery.packageName || "",
        amount: attempt.finalAmount || attempt.canonicalAmount || recovery.finalAmount || recovery.amount,
        currency: attempt.canonicalCurrency || recovery.currency,
        recoverableExpiresAt: recovery.recoverableExpiresAt || attempt.recoverableExpiresAt || attempt.expiresAt,
        notificationActionType: PAYMENT_RECOVERY_ACTION_TYPE,
        i18nTitleKey: PAYMENT_RECOVERY_I18N.title,
        i18nMessageKey: PAYMENT_RECOVERY_I18N.message,
        i18nActionKey: PAYMENT_RECOVERY_I18N.action
    });
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
        title: replacePaymentDisplayNames(item.title || "Notification"),
        message: replacePaymentDisplayNames(item.message || ""),
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

async function ensurePaymentRecoveryNotification(input = {}) {
    const owner = await resolveUserOwner(input);
    const attempt = input.attempt || {};
    const recovery = input.recovery || {};
    const metadata = buildPaymentRecoveryMetadata(attempt, recovery);
    const attemptId = cleanText(metadata.manualPaymentAttemptId);

    if (!owner?.username || !owner?.id || !isObjectId(owner.id) || !attemptId) {
        return { notification: null, normalized: null, unreadCount: 0, created: false };
    }

    const title = "Payment Not Completed";
    const message = buildPaymentRecoveryMessage(metadata.game);
    const expiresAt = metadata.recoverableExpiresAt ? new Date(metadata.recoverableExpiresAt) : null;
    const action = sanitizeAction({
        type: PAYMENT_RECOVERY_ACTION_TYPE,
        label: "Continue Payment",
        url: "notifications.html"
    });
    const filter = {
        userId: owner.id,
        type: PAYMENT_RECOVERY_TYPE,
        source: PAYMENT_RECOVERY_SOURCE,
        "metadata.manualPaymentAttemptId": attemptId
    };

    const result = await Notification.updateOne(
        filter,
        {
            $setOnInsert: {
                userId: owner.id,
                username: owner.username,
                title,
                message,
                type: PAYMENT_RECOVERY_TYPE,
                category: "payments",
                source: PAYMENT_RECOVERY_SOURCE,
                action,
                isRead: false,
                deletedByUser: false,
                createdAt: new Date()
            },
            $set: {
                status: "active",
                expiresAt,
                metadata,
                updatedAt: new Date()
            }
        },
        { upsert: true }
    );

    const notification = await Notification.findOne(filter);
    const normalized = notification ? normalizeNotification(notification) : null;
    const unreadCount = await getUnreadCount(owner);

    if (result.upsertedCount > 0 && normalized) {
        await realtime.emitNotification(owner.username, normalized, { unreadCount });
    } else {
        await realtime.emitNotificationCount(owner.username, unreadCount);
    }

    return {
        notification,
        normalized,
        unreadCount,
        created: result.upsertedCount > 0
    };
}

async function expirePaymentRecoveryNotifications(user) {
    const filter = {
        ...activeFilter(user),
        type: PAYMENT_RECOVERY_TYPE,
        source: PAYMENT_RECOVERY_SOURCE,
        status: "active",
        expiresAt: { $lte: new Date() }
    };

    const result = await Notification.updateMany(filter, {
        status: "expired",
        isRead: true
    });

    if (result.modifiedCount > 0) {
        const unreadCount = await getUnreadCount(user);
        await realtime.emitNotificationCount(user.username, unreadCount);
    }

    return result;
}

async function resolvePaymentRecoveryNotification(input = {}) {
    const owner = await resolveUserOwner(input);
    const attemptId = cleanText(input.attemptId || input.attempt?.attemptId || "");

    if (!owner?.username || !attemptId) {
        return { notification: null, unreadCount: owner ? await getUnreadCount(owner) : 0 };
    }

    const notification = await Notification.findOneAndUpdate(
        {
            ...ownerFilter(owner),
            type: PAYMENT_RECOVERY_TYPE,
            source: PAYMENT_RECOVERY_SOURCE,
            "metadata.manualPaymentAttemptId": attemptId
        },
        {
            status: cleanText(input.status || "resolved", "resolved"),
            isRead: true
        },
        { returnDocument: "after" }
    );

    const unreadCount = await getUnreadCount(owner);
    await realtime.emitNotificationCount(owner.username, unreadCount);

    return {
        notification,
        normalized: notification ? normalizeNotification(notification) : null,
        unreadCount
    };
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
    const category = cleanText(options.category || "").toLowerCase();
    let filter = activeFilter(user);

    if (category && VALID_CATEGORIES.has(category)) {
        filter.category = category;
    }

    if (options.unread === true || String(options.unread || "").toLowerCase() === "true") {
        filter.isRead = false;
    }

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
        { returnDocument: "after" }
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
        { returnDocument: "after" }
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
    ensurePaymentRecoveryNotification,
    expirePaymentRecoveryNotifications,
    getUnreadCount,
    getUserNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    normalizeNotification,
    ownerFilter,
    resolvePaymentRecoveryNotification,
    resolveUserOwner
};
