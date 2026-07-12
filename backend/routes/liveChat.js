const express = require("express");
const router = express.Router();
const LiveChat = require("../models/LiveChat");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

function makeChatId() {
    return "CHAT-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
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
router.get("/admin", adminMiddleware, async (req, res) => {
    try {
        const chats = await LiveChat.find({ status: "active" }).sort({
            lastMessageAt: -1
        });

        res.json({ success: true, chats });
    } catch (error) {
        console.error("Admin live chat fetch error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ADMIN REPLY
router.post("/admin/reply/:chatId", adminMiddleware, async (req, res) => {
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

        res.json({ success: true, chat });
    } catch (error) {
        console.error("Admin reply error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ADMIN MARK USER MESSAGES AS READ
router.put("/admin/read/:chatId", adminMiddleware, async (req, res) => {
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
router.delete("/admin/delete/:chatId", adminMiddleware, async (req, res) => {
    try {
        const chat = await LiveChat.findOneAndUpdate(
            { chatId: req.params.chatId },
            { status: "deleted" },
            { new: true }
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
router.delete("/auto-clean", adminMiddleware, async (req, res) => {
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
