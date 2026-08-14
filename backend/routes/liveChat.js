const express = require("express");
const router = express.Router();
const LiveChat = require("../models/LiveChat");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const realtime = require("../services/realtime");
const {
    PaginationError,
    parseLimit,
    sendPaginationError
} = require("../services/paginationService");

function makeChatId() {
    return "CHAT-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
}

function encodeLiveChatCursor(chat = {}) {
    const lastMessageAt = chat.lastMessageAt ? new Date(chat.lastMessageAt) : null;
    if (!lastMessageAt || Number.isNaN(lastMessageAt.getTime()) || !chat._id) return "";
    return Buffer.from(JSON.stringify({
        lastMessageAt: lastMessageAt.toISOString(),
        id: String(chat._id)
    })).toString("base64url");
}

function decodeLiveChatCursor(cursor = "") {
    const value = String(cursor || "").trim();
    if (!value) return null;
    try {
        const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
        const lastMessageAt = new Date(parsed.lastMessageAt);
        if (Number.isNaN(lastMessageAt.getTime()) || !parsed.id) {
            throw new Error("Invalid cursor");
        }
        return {
            lastMessageAt,
            id: parsed.id
        };
    } catch (error) {
        throw new PaginationError("INVALID_CURSOR", "Invalid pagination cursor.");
    }
}

function projectChatMessages(chat, options = {}) {
    const limit = parseLimit(options.limit, { defaultLimit: 50, maxLimit: 100 });
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const before = String(options.before || "").trim();
    let end = messages.length;

    if (before) {
        const index = messages.findIndex(message => String(message._id) === before);
        if (index < 0) {
            throw new PaginationError("INVALID_CURSOR", "Invalid pagination cursor.");
        }
        end = index;
    }

    const start = Math.max(0, end - limit);
    const page = messages.slice(start, end);

    return {
        messages: page,
        pagination: {
            limit,
            hasMore: start > 0,
            nextCursor: start > 0 ? String(page[0]?._id || "") : ""
        }
    };
}

// USER SEND MESSAGE
router.post("/send", authMiddleware, async (req, res) => {
    try {
        const username = req.user.username;
        const message = (req.body.message || "").trim();

        if (!message) {
            return res.status(400).json({
                success: false,
                message: "Message is required"
            });
        }

        let chat = await LiveChat.findOne({ username, status: "active" });

        if (!chat) {
            chat = await LiveChat.create({
                chatId: makeChatId(),
                username,
                messages: [
                    {
                        sender: "user",
                        text: message,
                        readByUser: true,
                        readByAdmin: false
                    }
                ],
                lastMessageAt: new Date()
            });
        } else {
            chat.messages.push({
                sender: "user",
                text: message,
                readByUser: true,
                readByAdmin: false
            });

            chat.lastMessageAt = new Date();
            await chat.save();
        }

        realtime.emitAdminUpdate({
            type: "live_chat",
            username,
            message,
            chatId: chat.chatId
        });

        res.json({ success: true, chat });
    } catch (error) {
        console.error("Live chat send error:", error);
        res.status(500).json({
            success: false,
            message: "Live chat server error"
        });
    }
});

// USER GET OWN CHAT
router.get("/user/:username", authMiddleware, async (req, res) => {
    try {
        const chat = await LiveChat.findOne({
            username: req.user.username,
            status: "active"
        });

        res.json({ success: true, chat });
    } catch (error) {
        console.error("User chat fetch error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// USER UNREAD COUNT
router.get("/user/:username/unread", authMiddleware, async (req, res) => {
    try {
        const chat = await LiveChat.findOne({
            username: req.user.username,
            status: "active"
        });

        if (!chat) {
            return res.json({ success: true, unread: 0 });
        }

        const unread = chat.messages.filter(
            msg => msg.sender === "admin" && !msg.readByUser
        ).length;

        res.json({ success: true, unread });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// USER MARK ADMIN MESSAGES AS READ
router.put("/user/:username/read", authMiddleware, async (req, res) => {
    try {
        const chat = await LiveChat.findOne({
            username: req.user.username,
            status: "active"
        });

        if (!chat) {
            return res.json({ success: true });
        }

        chat.messages.forEach(msg => {
            if (msg.sender === "admin") msg.readByUser = true;
        });

        await chat.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ADMIN GET ALL ACTIVE CHATS
router.get("/admin", adminMiddleware, requireAdminPermission(PERMISSIONS.LIVE_CHAT_READ), async (req, res) => {
    try {
        const limit = parseLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 });
        const query = { status: "active" };
        const cursor = decodeLiveChatCursor(req.query.cursor);
        if (cursor) {
            query.$or = [
                { lastMessageAt: { $lt: cursor.lastMessageAt } },
                { lastMessageAt: cursor.lastMessageAt, _id: { $lt: cursor.id } }
            ];
        }
        const raw = await LiveChat.find(query)
            .sort({ lastMessageAt: -1, _id: -1 })
            .limit(limit + 1)
            .lean();
        const hasMore = raw.length > limit;
        const page = (hasMore ? raw.slice(0, limit) : raw).map(chat => ({
            ...chat,
            messagesTotal: Array.isArray(chat.messages) ? chat.messages.length : 0,
            messages: Array.isArray(chat.messages) ? chat.messages.slice(-50) : []
        }));

        res.json({
            success: true,
            items: page,
            chats: page,
            pagination: {
                limit,
                hasMore,
                nextCursor: hasMore ? encodeLiveChatCursor(page[page.length - 1]) : ""
            }
        });
    } catch (error) {
        console.error("Admin live chat fetch error:", error);
        const paginationResponse = sendPaginationError(res, error);
        if (paginationResponse) return paginationResponse;

        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ADMIN GET BOUNDED CHAT MESSAGES
router.get("/admin/:chatId/messages", adminMiddleware, requireAdminPermission(PERMISSIONS.LIVE_CHAT_READ), async (req, res) => {
    try {
        const chat = await LiveChat.findOne({
            chatId: req.params.chatId,
            status: "active"
        }).select("chatId username messages");

        if (!chat) {
            return res.status(404).json({
                success: false,
                message: "Chat not found"
            });
        }

        const result = projectChatMessages(chat, {
            before: req.query.before,
            limit: req.query.limit
        });

        res.json({
            success: true,
            chatId: chat.chatId,
            username: chat.username,
            ...result
        });
    } catch (error) {
        const paginationResponse = sendPaginationError(res, error);
        if (paginationResponse) return paginationResponse;

        console.error("Admin live chat messages fetch error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ADMIN REPLY
router.post("/admin/reply/:chatId", adminMiddleware, requireAdminPermission(PERMISSIONS.LIVE_CHAT_MANAGE), async (req, res) => {
    try {
        const message = (req.body.message || "").trim();

        if (!message) {
            return res.status(400).json({
                success: false,
                message: "Reply message is required"
            });
        }

        const chat = await LiveChat.findOne({
            chatId: req.params.chatId,
            status: "active"
        });

        if (!chat) {
            return res.status(404).json({
                success: false,
                message: "Chat not found"
            });
        }

        chat.messages.push({
            sender: "admin",
            text: message,
            readByUser: false,
            readByAdmin: true
        });

        chat.lastMessageAt = new Date();
        await chat.save();

        await realtime.emitToUsername(chat.username, "adminLiveReply", {
            username: chat.username,
            message,
            chatId: chat.chatId,
            createdAt: new Date()
        });

        res.json({ success: true, chat });
    } catch (error) {
        console.error("Admin reply error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ADMIN MARK USER MESSAGES AS READ
router.put("/admin/read/:chatId", adminMiddleware, requireAdminPermission(PERMISSIONS.LIVE_CHAT_MANAGE), async (req, res) => {
    try {
        const chat = await LiveChat.findOne({
            chatId: req.params.chatId,
            status: "active"
        });

        if (!chat) {
            return res.status(404).json({
                success: false,
                message: "Chat not found"
            });
        }

        chat.messages.forEach(msg => {
            if (msg.sender === "user") msg.readByAdmin = true;
        });

        await chat.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ADMIN DELETE
router.delete("/admin/delete/:chatId", adminMiddleware, requireAdminPermission(PERMISSIONS.LIVE_CHAT_MANAGE), async (req, res) => {
    try {
        const chat = await LiveChat.findOneAndUpdate(
            { chatId: req.params.chatId },
            { status: "deleted" },
            { returnDocument: "after" }
        );

        if (!chat) {
            return res.status(404).json({
                success: false,
                message: "Chat not found"
            });
        }

        res.json({ success: true, message: "Chat deleted" });
    } catch (error) {
        console.error("Delete chat error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// AUTO CLEAN 1 HOUR
router.delete("/auto-clean", adminMiddleware, requireAdminPermission(PERMISSIONS.LIVE_CHAT_MANAGE), async (req, res) => {
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        const result = await LiveChat.updateMany(
            {
                status: "active",
                lastMessageAt: { $lt: oneHourAgo }
            },
            { status: "deleted" }
        );

        res.json({
            success: true,
            deletedCount: result.modifiedCount
        });
    } catch (error) {
        console.error("Auto clean error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// FUTURE AI READY ROUTE
router.post("/ai", async (req, res) => {
    res.json({
        success: true,
        reply: "AI assistant is not connected yet."
    });
});

module.exports = router;
