// backend/routes/notification.js

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const notificationService = require("../services/notificationService");
const promotionNotificationService = require("../services/promotionNotificationService");
const broadcastEmailService = require("../services/broadcastEmailService");
const { sendPaginationError } = require("../services/paginationService");

function sendPromotionError(res, error) {
    if (error instanceof promotionNotificationService.PromotionNotificationError) {
        return res.status(error.statusCode || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    console.log("Promotion notification error:", error);
    return res.status(500).json({
        success: false,
        code: "PROMOTION_NOTIFICATION_ERROR",
        message: "Promotion notification request failed"
    });
}

// CANONICAL: GET /api/notifications
router.get("/notifications", authMiddleware, async (req, res) => {
    try {
        const result = await notificationService.getUserNotifications(req.user, {
            limit: req.query.limit,
            cursor: req.query.cursor,
            category: req.query.category,
            unread: req.query.unread
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

// PUBLIC: GET /api/notifications/promotions/active
router.get("/notifications/promotions/active", optionalAuthMiddleware, async (req, res) => {
    try {
        const result = await promotionNotificationService.listActivePromotionPreview({
            user: req.user || null,
            region: req.query.region,
            limit: req.query.limit
        });

        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        return sendPromotionError(res, error);
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
        const recipients = await broadcastEmailService.resolveBroadcastAudience({
            usernames: req.body.usernames,
            audience: req.body.audience
        });
        const result = await notificationService.createBroadcastNotifications({
            usernames: recipients.map(user => user.username),
            title: req.body.title,
            message: req.body.message,
            type: req.body.type || "announcement",
            category: req.body.category || "announcements",
            action: req.body.action,
            metadata: req.body.metadata
        });
        const emailResult = await broadcastEmailService.deliverAdminBroadcastEmails({
            usernames: recipients.map(user => user.username),
            title: req.body.title,
            message: req.body.message,
            type: req.body.type || "announcement"
        });

        res.json({
            success: true,
            count: result.count,
            email: emailResult.summary
        });
    } catch (error) {
        console.log("Broadcast notification error:", error);
        res.status(400).json({
            success: false,
            message: error.message || "Server error"
        });
    }
});

router.get("/admin/promotion-notifications", adminMiddleware, requireAdminPermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        const result = await promotionNotificationService.listAdminPromotionNotifications();
        return res.json({ success: true, ...result });
    } catch (error) {
        return sendPromotionError(res, error);
    }
});

router.post("/admin/promotion-notifications", adminMiddleware, requireAdminPermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        const promotion = await promotionNotificationService.createPromotionNotification({
            patch: req.body || {},
            actor: req.admin?.username || "admin"
        });

        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PROMOTION_NOTIFICATION_CREATED,
            resourceType: "PromotionNotification",
            resourceId: promotion.id,
            metadata: { title: promotion.title, enabled: promotion.enabled }
        }).catch(error => console.log("Admin audit failed:", error.message));

        return res.status(201).json({ success: true, promotion });
    } catch (error) {
        return sendPromotionError(res, error);
    }
});

router.patch("/admin/promotion-notifications/:id", adminMiddleware, requireAdminPermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        const promotion = await promotionNotificationService.updatePromotionNotification({
            promotionId: req.params.id,
            patch: req.body || {},
            actor: req.admin?.username || "admin"
        });

        await writeAdminAudit({
            actor: req.admin,
            req,
            action: promotion.enabled
                ? ADMIN_AUDIT_ACTIONS.PROMOTION_NOTIFICATION_UPDATED
                : ADMIN_AUDIT_ACTIONS.PROMOTION_NOTIFICATION_DISABLED,
            resourceType: "PromotionNotification",
            resourceId: promotion.id,
            metadata: { title: promotion.title, enabled: promotion.enabled }
        }).catch(error => console.log("Admin audit failed:", error.message));

        return res.json({ success: true, promotion });
    } catch (error) {
        return sendPromotionError(res, error);
    }
});

router.post("/admin/promotion-notifications/:id/publish", adminMiddleware, requireAdminPermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        const result = await promotionNotificationService.publishPromotionNotification({
            promotionId: req.params.id,
            actor: req.admin?.username || "admin"
        });

        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PROMOTION_NOTIFICATION_PUBLISHED,
            resourceType: "PromotionNotification",
            resourceId: result.promotion.id,
            metadata: { delivered: result.delivered.count }
        }).catch(error => console.log("Admin audit failed:", error.message));

        return res.json({ success: true, ...result });
    } catch (error) {
        return sendPromotionError(res, error);
    }
});

router.post("/admin/promotion-notifications/:id/disable", adminMiddleware, requireAdminPermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    try {
        const promotion = await promotionNotificationService.disablePromotionNotification({
            promotionId: req.params.id,
            actor: req.admin?.username || "admin"
        });

        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PROMOTION_NOTIFICATION_DISABLED,
            resourceType: "PromotionNotification",
            resourceId: promotion.id
        }).catch(error => console.log("Admin audit failed:", error.message));

        return res.json({ success: true, promotion });
    } catch (error) {
        return sendPromotionError(res, error);
    }
});

module.exports = router;
