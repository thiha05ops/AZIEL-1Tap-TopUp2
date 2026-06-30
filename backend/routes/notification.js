// backend/routes/notification.js

const express = require("express");
const router = express.Router();

const Notification = require("../models/Notification");

// GET /api/notifications/:username
router.get("/notifications/:username", async (req, res) => {
    try {
        const username = req.params.username;

        const activeFilter = {
            username,
            deletedByUser: false,
            $or: [
                { expiresAt: { $exists: false } },
                { expiresAt: null },
                { expiresAt: { $gt: new Date() } }
            ]
        };

        const notifications = await Notification.find(activeFilter)
            .sort({ isRead: 1, createdAt: -1 });

        const unreadCount = await Notification.countDocuments({
            ...activeFilter,
            isRead: false
        });

        res.json({
            success: true,
            notifications,
            unreadCount
        });
    } catch (error) {
        console.log("Notification load error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// PUT /api/notifications/:id/read
router.put("/notifications/:id/read", async (req, res) => {
    try {
        const notification = await Notification.findByIdAndUpdate(
            req.params.id,
            { isRead: true },
            { new: true }
        );

        if (!notification) {
            return res.json({
                success: false,
                message: "Notification not found"
            });
        }

        res.json({
            success: true,
            notification
        });
    } catch (error) {
        console.log("Mark read error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// PUT /api/notifications/:username/read-all
router.put("/notifications/:username/read-all", async (req, res) => {
    try {
        await Notification.updateMany(
            {
                username: req.params.username,
                deletedByUser: false
            },
            {
                isRead: true
            }
        );

        res.json({
            success: true,
            message: "All notifications marked as read"
        });
    } catch (error) {
        console.log("Mark all read error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// DELETE /api/notifications/:id
router.delete("/notifications/:id", async (req, res) => {
    try {
        const notification = await Notification.findByIdAndUpdate(
            req.params.id,
            {
                deletedByUser: true,
                isRead: true
            },
            { new: true }
        );

        if (!notification) {
            return res.json({
                success: false,
                message: "Notification not found"
            });
        }

        res.json({
            success: true,
            message: "Notification deleted"
        });
    } catch (error) {
        console.log("Notification delete error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// DELETE /api/notifications/:username/read
router.delete("/notifications/:username/read", async (req, res) => {
    try {
        await Notification.updateMany(
            {
                username: req.params.username,
                isRead: true
            },
            {
                deletedByUser: true
            }
        );

        res.json({
            success: true,
            message: "Read notifications cleared"
        });
    } catch (error) {
        console.log("Clear read error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// POST /api/notifications/create
router.post("/notifications/create", async (req, res) => {
    try {
        const {
            username,
            title,
            message,
            type,
            category,
            orderId
        } = req.body;

        if (!username || !title) {
            return res.json({
                success: false,
                message: "Username and title are required"
            });
        }

        const notification = await Notification.create({
            username,
            title,
            message: message || "",
            type: type || "general",
            category: category || "system",
            orderId: orderId || "",
            deletedByUser: false,
            isRead: false
        });

        const io = req.app.get("io");

        if (io) {
            io.to(String(username)).emit("newNotification", notification);
        }

        res.json({
            success: true,
            notification
        });
    } catch (error) {
        console.log("Create notification error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// POST /api/notifications/broadcast
router.post("/notifications/broadcast", async (req, res) => {
    try {
        const {
            usernames,
            title,
            message,
            type,
            category
        } = req.body;

        if (!Array.isArray(usernames) || !usernames.length) {
            return res.json({
                success: false,
                message: "Usernames are required"
            });
        }

        if (!title || !message) {
            return res.json({
                success: false,
                message: "Title and message are required"
            });
        }

        const notifications = await Notification.insertMany(
            usernames.map(username => ({
                username,
                title,
                message,
                type: type || "announcement",
                category: category || "announcements",
                deletedByUser: false,
                isRead: false
            }))
        );

        const io = req.app.get("io");

        if (io) {
            notifications.forEach(noti => {
                io.to(String(noti.username)).emit("newNotification", noti);
            });
        }

        res.json({
            success: true,
            count: notifications.length
        });
    } catch (error) {
        console.log("Broadcast notification error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;