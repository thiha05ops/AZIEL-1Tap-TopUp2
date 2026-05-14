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
// PUT /api/notifications/:id/read
router.put("/notifications/:id/read", async (req, res) => {
    try {
        const notification =
            await Notification.findByIdAndUpdate(
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

module.exports = router;