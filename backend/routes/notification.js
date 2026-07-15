// backend/routes/notification.js

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const notificationService = require("../services/notificationService");
const { sendPaginationError } = require("../services/paginationService");

// CANONICAL: GET /api/notifications
router.get("/notifications", authMiddleware, async (req, res) => {
    try {
        const result = await notificationService.getUserNotifications(req.user, {
            limit: req.query.limit,
            cursor: req.query.cursor
        });

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.log("Notification load error:", error);
        const paginationResponse = sendPaginationError(res, error);
        if (paginationResponse) return paginationResponse;

        res.status(500).json({ success: false, message: "Server error" });
    }
});

// CANONICAL: GET /api/notifications/unread-count
router.get("/notifications/unread-count", authMiddleware, async (req, res) => {
    try {
        const unreadCount = await notificationService.getUnreadCount(req.user);
        res.json({ success: true, unreadCount });
    } catch (error) {
        console.log("Unread count error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// CANONICAL: PATCH /api/notifications/read-all
router.patch("/notifications/read-all", authMiddleware, async (req, res) => {
    try {
        const result = await notificationService.markAllNotificationsRead(req.user);
        res.json({
            success: true,
            message: "All notifications marked as read",
            ...result
        });
    } catch (error) {
        console.log("Mark all read error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// CANONICAL: PATCH /api/notifications/:id/read
router.patch("/notifications/:id/read", authMiddleware, async (req, res) => {
    try {
        const result = await notificationService.markNotificationRead(req.user, req.params.id);

        if (!result) {
            return res.status(404).json({
                success: false,
                message: "Notification not found"
            });
        }

        res.json({
            success: true,
            notification: result.normalized,
            unreadCount: result.unreadCount
        });
    } catch (error) {
        console.log("Mark read error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// COMPATIBILITY: GET /api/notifications/:username
router.get("/notifications/:username", authMiddleware, async (req, res) => {
    try {
        const result = await notificationService.getUserNotifications(req.user, {
            limit: req.query.limit || 50,
            cursor: req.query.cursor
        });

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.log("Legacy notification load error:", error);
        const paginationResponse = sendPaginationError(res, error);
        if (paginationResponse) return paginationResponse;

        res.status(500).json({ success: false, message: "Server error" });
    }
});

// COMPATIBILITY: PUT /api/notifications/:id/read
router.put("/notifications/:id/read", authMiddleware, async (req, res) => {
    try {
        const result = await notificationService.markNotificationRead(req.user, req.params.id);

        if (!result) {
            return res.status(404).json({
                success: false,
                message: "Notification not found"
            });
        }

        res.json({
            success: true,
            notification: result.normalized,
            unreadCount: result.unreadCount
        });
    } catch (error) {
        console.log("Legacy mark read error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// COMPATIBILITY: PUT /api/notifications/:username/read-all
router.put("/notifications/:username/read-all", authMiddleware, async (req, res) => {
    try {
        const result = await notificationService.markAllNotificationsRead(req.user);
        res.json({
            success: true,
            message: "All notifications marked as read",
            ...result
        });
    } catch (error) {
        console.log("Legacy mark all read error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// COMPATIBILITY: DELETE /api/notifications/:id
router.delete("/notifications/:id", authMiddleware, async (req, res) => {
    try {
        const result = await notificationService.deleteNotification(req.user, req.params.id);

        if (!result) {
            return res.status(404).json({
                success: false,
                message: "Notification not found"
            });
        }

        res.json({
            success: true,
            message: "Notification deleted",
            unreadCount: result.unreadCount
        });
    } catch (error) {
        console.log("Notification delete error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// COMPATIBILITY: DELETE /api/notifications/:username/read
router.delete("/notifications/:username/read", authMiddleware, async (req, res) => {
    try {
        const result = await notificationService.markAllNotificationsRead(req.user);
        res.json({
            success: true,
            message: "Read notifications cleared",
            ...result
        });
    } catch (error) {
        console.log("Clear read error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// ADMIN: POST /api/notifications/create
router.post("/notifications/create", adminMiddleware, requireAdminPermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        const result = await notificationService.createUserNotification({
            username: req.body.username,
            title: req.body.title,
            message: req.body.message || "",
            type: req.body.type || "general",
            category: req.body.category || "system",
            orderId: req.body.orderId || "",
            action: req.body.action,
            metadata: req.body.metadata,
            source: "admin_create"
        });

        res.json({
            success: true,
            notification: result.normalized,
            unreadCount: result.unreadCount
        });
    } catch (error) {
        console.log("Create notification error:", error);
        res.status(400).json({
            success: false,
            message: error.message || "Server error"
        });
    }
});

// ADMIN: POST /api/notifications/broadcast
router.post("/notifications/broadcast", adminMiddleware, requireAdminPermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        const result = await notificationService.createBroadcastNotifications({
            usernames: req.body.usernames,
            title: req.body.title,
            message: req.body.message,
            type: req.body.type || "announcement",
            category: req.body.category || "announcements",
            action: req.body.action,
            metadata: req.body.metadata
        });

        res.json({
            success: true,
            count: result.count
        });
    } catch (error) {
        console.log("Broadcast notification error:", error);
        res.status(400).json({
            success: false,
            message: error.message || "Server error"
        });
    }
});

module.exports = router;
