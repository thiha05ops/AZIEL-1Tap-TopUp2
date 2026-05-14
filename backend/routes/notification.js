const express = require("express");
const router = express.Router();

const Notification =
    require("../models/Notification");

// GET /api/notifications/:username
router.get("/notifications/:username", async (req, res) => {
    try {
        const notifications =
            await Notification.find({
                username: req.params.username
            }).sort({ createdAt: -1 });

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
        console.log("Notification load error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;