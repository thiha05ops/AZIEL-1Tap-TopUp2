const express = require("express");
const router = express.Router();

const Notification =
    require("../models/Notification");

// Get user notifications
router.get("/notifications/:username", async (req, res) => {
    try {
        const notifications =
            await Notification.find({
                username: req.params.username
            })
                .sort({ createdAt: -1 })
                .limit(50);

        const unreadCount =
            await Notification.countDocuments({
                username: req.params.username,
                isRead: false
            });

        res.json({
            success: true,
            notifications,
            unreadCount
        });

    } catch (error) {
        console.log("Notification get error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// Mark all as read
router.put("/notifications/:username/read", async (req, res) => {
    try {
        await Notification.updateMany(
            {
                username: req.params.username,
                isRead: false
            },
            {
                isRead: true
            }
        );

        res.json({
            success: true
        });

    } catch (error) {
        console.log("Notification read error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;