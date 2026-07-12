const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "aziel_jwt_secret";

let ioInstance = null;

const ROOMS = {
    admin: "admin",
    legacyAdmin: "admins",
    user: id => `user:${id}`,
    username: username => `username:${String(username || "").toLowerCase()}`,
    wallet: id => `wallet:${id}`,
    order: orderId => `order:${orderId}`
};

function asObject(value) {
    if (!value) return {};
    if (typeof value.toObject === "function") return value.toObject();
    return value;
}

function projectNotification(notification) {
    const item = asObject(notification);

    return {
        id: item.id || (item._id ? String(item._id) : undefined),
        _id: item._id ? String(item._id) : undefined,
        userId: item.userId ? String(item.userId) : "",
        username: item.username || "",
        title: item.title || "Notification",
        message: item.message || "",
        type: item.type || "general",
        category: item.category || "system",
        status: item.status || "active",
        orderId: item.orderId || "",
        read: Boolean(item.read || item.isRead),
        isRead: Boolean(item.read || item.isRead),
        createdAt: item.createdAt || new Date(),
        updatedAt: item.updatedAt || item.createdAt || new Date(),
        action: item.action || null,
        metadata: item.metadata || {}
    };
}

function projectWallet(payload = {}) {
    return {
        amount: Number(payload.amount || payload.balance || 0),
        balance: Number(payload.balance || payload.amount || 0),
        currency: payload.currency || "MMK",
        status: payload.status || "",
        topupId: payload.topupId || "",
        updatedAt: new Date()
    };
}

function projectOrder(payload = {}) {
    return {
        orderId: payload.orderId || "",
        status: payload.status || "",
        game: payload.game || "",
        packageName: payload.packageName || "",
        updatedAt: new Date()
    };
}

async function findUserByUsername(username) {
    const normalized = String(username || "").trim();
    if (!normalized) return null;

    return User.findOne({ username: normalized }).select(
        "_id username email role region currentSessionToken lastActiveAt updatedAt createdAt"
    );
}

async function findSocketUser(decoded) {
    if (!decoded?.id || decoded.role === "admin") return null;

    const user = await User.findById(decoded.id).select(
        "_id username email role region currentSessionToken lastActiveAt updatedAt createdAt"
    );

    if (!user) return null;

    if (
        !decoded.sessionToken ||
        !user.currentSessionToken ||
        decoded.sessionToken !== user.currentSessionToken
    ) {
        return null;
    }

    const now = new Date();
    const lastActive = user.lastActiveAt || user.updatedAt || user.createdAt;
    const inactiveDays =
        (now.getTime() - new Date(lastActive).getTime()) /
        (1000 * 60 * 60 * 24);

    if (inactiveDays >= 15) return null;

    return user;
}

function getAuthToken(socket) {
    return (
        socket.handshake?.auth?.token ||
        socket.handshake?.auth?.adminToken ||
        socket.handshake?.query?.token ||
        ""
    );
}

async function authenticateSocket(socket, next) {
    try {
        const token = getAuthToken(socket);

        if (!token) {
            socket.data.authenticated = false;
            return next();
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        if (decoded.role === "admin") {
            socket.data.authenticated = true;
            socket.data.admin = {
                role: "admin",
                username: decoded.username || "admin"
            };
            return next();
        }

        const user = await findSocketUser(decoded);

        if (!user) {
            return next(new Error("Invalid or expired token"));
        }

        socket.data.authenticated = true;
        socket.data.user = {
            id: String(user._id),
            username: user.username,
            email: user.email,
            role: user.role || "user",
            region: user.region || "MM"
        };

        return next();
    } catch (error) {
        return next(new Error("Invalid or expired token"));
    }
}

function joinAuthenticatedRooms(socket) {
    const user = socket.data.user;
    const admin = socket.data.admin;

    if (user?.id) {
        socket.join(ROOMS.user(user.id));
        socket.join(ROOMS.wallet(user.id));
        socket.join(ROOMS.username(user.username));
    }

    if (admin?.role === "admin") {
        socket.join(ROOMS.admin);
        socket.join(ROOMS.legacyAdmin);
    }
}

function configureSocketServer(io) {
    ioInstance = io;

    io.use(authenticateSocket);

    io.on("connection", socket => {
        joinAuthenticatedRooms(socket);

        socket.on("joinAdmin", () => {
            if (socket.data.admin?.role === "admin") {
                socket.join(ROOMS.admin);
                socket.join(ROOMS.legacyAdmin);
            }
        });

        socket.on("joinAdminRoom", () => {
            if (socket.data.admin?.role === "admin") {
                socket.join(ROOMS.admin);
                socket.join(ROOMS.legacyAdmin);
            }
        });

        socket.on("joinUser", () => {
            if (socket.data.user?.id) {
                joinAuthenticatedRooms(socket);
            }
        });

        socket.on("joinUserRoom", () => {
            if (socket.data.user?.id) {
                joinAuthenticatedRooms(socket);
            }
        });

        socket.on("liveChatMessage", data => {
            const user = socket.data.user;
            if (!user?.username) return;

            emitToAdmin("liveChatMessage", {
                username: user.username,
                message: data?.message || data?.text || "",
                createdAt: new Date()
            });
        });

        socket.on("adminLiveReply", data => {
            if (socket.data.admin?.role !== "admin" || !data?.username) return;

            emitToUsername(data.username, "adminLiveReply", {
                username: data.username,
                message: data.message || data.text || "",
                createdAt: new Date()
            });
        });
    });
}

function emitToAdmin(eventName, payload = {}) {
    if (!ioInstance) return;

    ioInstance.to(ROOMS.admin).to(ROOMS.legacyAdmin).emit(eventName, payload);
}

async function emitToUsername(username, eventName, payload = {}) {
    if (!ioInstance || !username) return;

    const user = await findUserByUsername(username);

    if (!user) return;

    ioInstance
        .to(ROOMS.user(String(user._id)))
        .to(ROOMS.username(user.username))
        .emit(eventName, payload);
}

async function emitNotification(username, notification, options = {}) {
    const payload = projectNotification(notification);
    const unreadCount = Number(options.unreadCount || 0);

    await emitToUsername(username, "notification:new", {
        notification: payload,
        unreadCount
    });
    await emitToUsername(username, "newNotification", payload);
    await emitToUsername(username, "notification:count-changed", {
        unreadCount,
        updatedAt: new Date()
    });
}

async function emitNotificationCount(username, unreadCount) {
    await emitToUsername(username, "notification:count-changed", {
        unreadCount: Number(unreadCount || 0),
        updatedAt: new Date()
    });
}

async function emitWalletUpdate(username, payload) {
    const wallet = projectWallet(payload);

    await emitToUsername(username, "wallet:updated", wallet);
    await emitToUsername(username, "wallet:balance-changed", wallet);
    await emitToUsername(username, "walletUpdated", wallet);
}

async function emitWalletTopupUpdate(username, payload) {
    const topup = {
        topupId: payload?.topupId || "",
        status: payload?.status || "",
        amount: Number(payload?.amount || 0),
        currency: payload?.currency || "MMK",
        paymentMethod: payload?.paymentMethod || "",
        updatedAt: new Date()
    };

    await emitToUsername(username, "wallet:topup-updated", topup);
}

async function emitOrderUpdate(username, payload) {
    const order = projectOrder(payload);

    await emitToUsername(username, "order:updated", order);
    await emitToUsername(username, "order:status-changed", order);
    await emitToUsername(username, "userOrderUpdate", order);
}

async function emitSupportUpdate(username, payload) {
    await emitToUsername(username, "supportUpdated", {
        message: payload?.message || "",
        ticketId: payload?.ticketId || "",
        status: payload?.status || "",
        updatedAt: new Date()
    });
}

function emitAdminUpdate(payload = {}) {
    emitToAdmin("admin:notification", {
        ...payload,
        createdAt: payload.createdAt || new Date()
    });

    emitToAdmin("adminNewUpdate", payload);
}

function emitAdminOrderUpdate(payload = {}) {
    emitToAdmin("admin:order-updated", {
        ...payload,
        updatedAt: new Date()
    });

    emitAdminUpdate(payload);
}

function emitAdminWalletUpdate(payload = {}) {
    emitToAdmin("admin:wallet-updated", {
        ...payload,
        updatedAt: new Date()
    });

    emitAdminUpdate(payload);
}

module.exports = {
    ROOMS,
    configureSocketServer,
    emitAdminOrderUpdate,
    emitAdminUpdate,
    emitAdminWalletUpdate,
    emitNotification,
    emitNotificationCount,
    emitOrderUpdate,
    emitSupportUpdate,
    emitToAdmin,
    emitToUsername,
    emitWalletTopupUpdate,
    emitWalletUpdate
};
