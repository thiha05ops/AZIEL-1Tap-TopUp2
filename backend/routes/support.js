// backend/routes/support.js

const express = require("express");
const router = express.Router();

const SupportTicket = require("../models/SupportTicket");
const Order = require("../models/Order");
const upload = require("../middleware/imageMemoryUpload");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const realtime = require("../services/realtime");
const notificationService = require("../services/notificationService");
const {
    StorageError,
    cleanupAfterFailedPersistence,
    logStorageError,
    uploadFile
} = require("../services/storageService");

// CREATE TICKET
// POST /api/support/ticket

router.post("/support/ticket", authMiddleware, upload.single("screenshot"), async (req, res) => {
    let evidence = null;
    let evidencePersisted = false;

    try {
        const { type, subject, message, orderId } = req.body;
        const username = req.user.username;

        if (!subject || !message) {
            return res.json({
                success: false,
                message: "Missing required fields"
            });
        }

        if (orderId) {
            const ownedOrder = await Order.findOne({
                orderId,
                username
            }).select("_id");

            if (!ownedOrder) {
                return res.status(404).json({
                    success: false,
                    message: "Order not found"
                });
            }
        }

        const ticketId = "SUP-" + Date.now();

        if (req.file) {
            evidence = await uploadFile({
                file: req.file,
                category: "supportEvidence",
                ownerReference: ticketId
            });
        }

        const ticket = await SupportTicket.create({
            ticketId,
            username,
            type: type || "general",
            subject,
            message,
            orderId: orderId || "",
            screenshot: evidence?.url || "",
            screenshotEvidence: evidence || undefined,
            status: "open"
        });
        evidencePersisted = true;

        realtime.emitAdminUpdate({
            type: "support_ticket",
            ticketId: ticket.ticketId,
            username,
            subject
        });

        res.json({
            success: true,
            message: "Support ticket submitted",
            ticket
        });
    } catch (error) {
        console.log("Create support ticket error:", error);

        if (evidence && !evidencePersisted) {
            await cleanupAfterFailedPersistence(evidence);
        }

        if (error instanceof StorageError) {
            logStorageError(error.code, {
                provider: error.provider,
                category: "supportEvidence"
            });

            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: error.message || "Server error"
        });
    }
});

// GET USER TICKETS
// GET /api/support/my/:username

router.get("/support/my/:username", authMiddleware, async (req, res) => {
    try {
        const tickets = await SupportTicket.find({
            username: req.user.username
        }).sort({ createdAt: -1 });

        res.json({
            success: true,
            tickets
        });
    } catch (error) {
        console.log("Load support tickets error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// ADMIN GET ALL TICKETS
// GET /api/admin/support/tickets

router.get("/admin/support/tickets", adminMiddleware, async (req, res) => {
    try {
        const filter = String(req.query.filter || "").trim();
        const status = String(req.query.status || "").trim();
        const query = {};

        if (filter === "unreadByAdmin") {
            query.unreadByAdmin = true;
            query.status = { $nin: ["solved", "closed"] };
        } else if (filter === "open") {
            query.status = "open";
        } else if (status) {
            query.status = status;
        }

        const tickets = await SupportTicket.find(query).sort({
            createdAt: -1
        });

        res.json({
            success: true,
            tickets
        });
    } catch (error) {
        console.log("Admin support tickets error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// ADMIN REPLY
// PUT /api/admin/support/tickets/:id/reply

router.put("/admin/support/tickets/:id/reply", adminMiddleware, async (req, res) => {
    try {
        const { reply, status } = req.body;

        const ticket = await SupportTicket.findById(req.params.id);

        if (!ticket) {
            return res.json({
                success: false,
                message: "Ticket not found"
            });
        }

        ticket.adminReply = reply || "";

        if (status) {
            ticket.status = status;
        }

        await ticket.save();

        const payload = {
            title: "Support Reply",
            message: `Admin replied to your support ticket: ${ticket.subject}`,
            type: "support",
            category: "support",
            ticketId: ticket.ticketId,
            metadata: {
                ticketId: ticket.ticketId
            },
            action: {
                type: "navigate",
                label: "View Support",
                url: "/support.html"
            },
            source: "support_reply"
        };

        await notificationService.createUserNotification({
            username: ticket.username,
            ...payload
        });
        await realtime.emitSupportUpdate(ticket.username, {
            message: payload.message,
            ticketId: ticket.ticketId,
            status: ticket.status
        });

        res.json({
            success: true,
            ticket
        });
    } catch (error) {
        console.log("Support reply error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;
