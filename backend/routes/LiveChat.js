const express = require("express");
const router = express.Router();
const LiveChat = require("../models/LiveChat");

// USER SEND MESSAGE
router.post("/send", async (req, res) => {
    try {
        const { username, message } = req.body;

        if (!username || !message) {
            return res.status(400).json({
                success: false,
                message: "Username and message are required"
            });
        }

        let chat = await LiveChat.findOne({
            username,
            status: "active"
        });

        if (!chat) {
            chat = await LiveChat.create({
                chatId: "CHAT-" + Date.now(),
                username,
                messages: [
                    {
                        sender: "user",
                        text: message
                    }
                ],
                lastMessageAt: new Date()
            });
        } else {
            chat.messages.push({
                sender: "user",
                text: message
            });
            chat.lastMessageAt = new Date();
            await chat.save();
        }

        res.json({
            success: true,
            chat
        });
    } catch (error) {
        console.error("Live chat send error:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ADMIN GET ALL ACTIVE CHATS
router.get("/admin", async (req, res) => {
    try {
        const chats = await LiveChat.find({
            status: "active"
        }).sort({ lastMessageAt: -1 });

        res.json({
            success: true,
            chats
        });
    } catch (error) {
        console.error("Admin live chat fetch error:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ADMIN REPLY
router.post("/admin/reply/:chatId", async (req, res) => {
    try {
        const { message } = req.body;

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
            text: message
        });

        chat.lastMessageAt = new Date();
        await chat.save();

        res.json({
            success: true,
            chat
        });
    } catch (error) {
        console.error("Admin reply error:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// USER GET OWN CHAT
router.get("/user/:username", async (req, res) => {
    try {
        const chat = await LiveChat.findOne({
            username: req.params.username,
            status: "active"
        });

        res.json({
            success: true,
            chat
        });
    } catch (error) {
        console.error("User chat fetch error:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// MANUAL DELETE CHAT
router.delete("/admin/delete/:chatId", async (req, res) => {
    try {
        await LiveChat.findOneAndUpdate(
            { chatId: req.params.chatId },
            { status: "deleted" }
        );

        res.json({
            success: true,
            message: "Chat deleted"
        });
    } catch (error) {
        console.error("Delete chat error:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// AUTO DELETE 1 HOUR INACTIVE CHATS
router.delete("/auto-clean", async (req, res) => {
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        const result = await LiveChat.updateMany(
            {
                status: "active",
                lastMessageAt: { $lt: oneHourAgo }
            },
            {
                status: "deleted"
            }
        );

        res.json({
            success: true,
            deletedCount: result.modifiedCount
        });
    } catch (error) {
        console.error("Auto clean error:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;