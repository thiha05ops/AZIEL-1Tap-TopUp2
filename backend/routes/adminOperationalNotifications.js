"use strict";

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const AdminOperationalNotification = require("../models/AdminOperationalNotification");
const adminMiddleware = require("../middleware/adminMiddleware");
const {
    PERMISSIONS,
    getPermissionsForRole,
    requireAdminPermission
} = require("../services/adminAuthorizationService");

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

function boundedLimit(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_LIMIT);
}

function permissionFilter(admin) {
    const permissions = getPermissionsForRole(admin?.role);

    return {
        requiredPermission: {
            $in: ["", ...permissions]
        }
    };
}

function unreadFilter(adminId) {
    return {
        "readBy.adminId": {
            $ne: new mongoose.Types.ObjectId(adminId)
        }
    };
}

function visibleFilter(admin) {
    return permissionFilter(admin);
}

function projectNotification(notification, adminId) {
    const item = notification?.toObject
        ? notification.toObject()
        : notification || {};

    const currentAdminId = String(adminId || "");
    const readReceipt = Array.isArray(item.readBy)
        ? item.readBy.find(entry => String(entry?.adminId || "") === currentAdminId)
        : null;

    return {
        id: item._id ? String(item._id) : "",
        type: item.type || "operational_update",
        category: item.category || "system",
        severity: item.severity || "info",
        title: item.title || "Operational update",
        message: item.message || "",
        resourceType: item.resourceType || "",
        resourceId: item.resourceId || "",
        action: item.action || null,
        source: item.source || "",
        isRead: Boolean(readReceipt),
        readAt: readReceipt?.readAt || null,
        createdAt: item.createdAt || null,
        updatedAt: item.updatedAt || item.createdAt || null
    };
}

router.get(
    "/admin/operational-notifications",
    adminMiddleware,
    requireAdminPermission(PERMISSIONS.ADMIN_NOTIFICATIONS_READ),
    async (req, res) => {
        try {
            const adminId = String(req.admin?.adminId || "");
            if (!mongoose.Types.ObjectId.isValid(adminId)) {
                return res.status(401).json({
                    success: false,
                    code: "ADMIN_SESSION_INVALID",
                    message: "Admin session expired."
                });
            }

            const limit = boundedLimit(req.query.limit);
            const unreadOnly = String(req.query.unread || "").toLowerCase() === "true";

            const baseFilter = visibleFilter(req.admin);
            const listFilter = unreadOnly
                ? {
                    ...baseFilter,
                    ...unreadFilter(adminId)
                }
                : baseFilter;

            const [notifications, unreadCount] = await Promise.all([
                AdminOperationalNotification.find(listFilter)
                    .sort({ createdAt: -1, _id: -1 })
                    .limit(limit)
                    .lean(),
                AdminOperationalNotification.countDocuments({
                    ...baseFilter,
                    ...unreadFilter(adminId)
                })
            ]);

            return res.json({
                success: true,
                notifications: notifications.map(item =>
                    projectNotification(item, adminId)
                ),
                unreadCount,
                limit
            });
        } catch (error) {
            console.error("Admin operational notifications error:", error);

            return res.status(500).json({
                success: false,
                code: "ADMIN_OPERATIONAL_NOTIFICATIONS_FAILED",
                message: "Unable to load operational notifications."
            });
        }
    }
);

router.get(
    "/admin/operational-notifications/unread-count",
    adminMiddleware,
    requireAdminPermission(PERMISSIONS.ADMIN_NOTIFICATIONS_READ),
    async (req, res) => {
        try {
            const adminId = String(req.admin?.adminId || "");
            if (!mongoose.Types.ObjectId.isValid(adminId)) {
                return res.status(401).json({
                    success: false,
                    code: "ADMIN_SESSION_INVALID",
                    message: "Admin session expired."
                });
            }

            const unreadCount = await AdminOperationalNotification.countDocuments({
                ...visibleFilter(req.admin),
                ...unreadFilter(adminId)
            });

            return res.json({
                success: true,
                unreadCount
            });
        } catch (error) {
            console.error("Admin operational unread count error:", error);

            return res.status(500).json({
                success: false,
                code: "ADMIN_OPERATIONAL_NOTIFICATION_COUNT_FAILED",
                message: "Unable to load unread notification count."
            });
        }
    }
);

router.patch(
    "/admin/operational-notifications/:id/read",
    adminMiddleware,
    requireAdminPermission(PERMISSIONS.ADMIN_NOTIFICATIONS_READ),
    async (req, res) => {
        try {
            const adminId = String(req.admin?.adminId || "");
            const notificationId = String(req.params.id || "");

            if (
                !mongoose.Types.ObjectId.isValid(adminId) ||
                !mongoose.Types.ObjectId.isValid(notificationId)
            ) {
                return res.status(400).json({
                    success: false,
                    code: "ADMIN_OPERATIONAL_NOTIFICATION_INVALID",
                    message: "Invalid notification."
                });
            }

            const visibility = visibleFilter(req.admin);

            await AdminOperationalNotification.updateOne(
                {
                    _id: notificationId,
                    ...visibility,
                    ...unreadFilter(adminId)
                },
                {
                    $push: {
                        readBy: {
                            adminId: new mongoose.Types.ObjectId(adminId),
                            readAt: new Date()
                        }
                    }
                }
            );

            const notification = await AdminOperationalNotification.findOne({
                _id: notificationId,
                ...visibility
            }).lean();

            if (!notification) {
                return res.status(404).json({
                    success: false,
                    code: "ADMIN_OPERATIONAL_NOTIFICATION_NOT_FOUND",
                    message: "Notification not found."
                });
            }

            const unreadCount = await AdminOperationalNotification.countDocuments({
                ...visibility,
                ...unreadFilter(adminId)
            });

            return res.json({
                success: true,
                notification: projectNotification(notification, adminId),
                unreadCount
            });
        } catch (error) {
            console.error("Admin operational notification read error:", error);

            return res.status(500).json({
                success: false,
                code: "ADMIN_OPERATIONAL_NOTIFICATION_READ_FAILED",
                message: "Unable to mark notification as read."
            });
        }
    }
);

router.post(
    "/admin/operational-notifications/read-all",
    adminMiddleware,
    requireAdminPermission(PERMISSIONS.ADMIN_NOTIFICATIONS_READ),
    async (req, res) => {
        try {
            const adminId = String(req.admin?.adminId || "");
            if (!mongoose.Types.ObjectId.isValid(adminId)) {
                return res.status(401).json({
                    success: false,
                    code: "ADMIN_SESSION_INVALID",
                    message: "Admin session expired."
                });
            }

            const result = await AdminOperationalNotification.updateMany(
                {
                    ...visibleFilter(req.admin),
                    ...unreadFilter(adminId)
                },
                {
                    $push: {
                        readBy: {
                            adminId: new mongoose.Types.ObjectId(adminId),
                            readAt: new Date()
                        }
                    }
                }
            );

            return res.json({
                success: true,
                modifiedCount: Number(result.modifiedCount || 0),
                unreadCount: 0
            });
        } catch (error) {
            console.error("Admin operational notifications read-all error:", error);

            return res.status(500).json({
                success: false,
                code: "ADMIN_OPERATIONAL_NOTIFICATIONS_READ_ALL_FAILED",
                message: "Unable to mark notifications as read."
            });
        }
    }
);

module.exports = router;
