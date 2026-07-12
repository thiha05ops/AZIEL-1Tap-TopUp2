// backend/routes/support.js

const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const SupportTicket = require("../models/SupportTicket");
const Order = require("../models/Order");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const realtime = require("../services/realtime");
const notificationService = require("../services/notificationService");

// UPLOAD SETUP

const uploadDir = path.join(__dirname, "../uploads/support");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

function safeFileName(name) {
    return String(name || "screenshot")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${safeFileName(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/webp"];

        if (!allowed.includes(file.mimetype)) {
            return cb(new Error("Only JPG, PNG and WEBP images are allowed"));
        }

        cb(null, true);
    }
});

// CREATE TICKET
// POST /api/support/ticket

router.post("/support/ticket", authMiddleware, upload.single("screenshot"), async (req, res) => {
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

        const ticket = await SupportTicket.create({
            ticketId: "SUP-" + Date.now(),
            username,
            type: type || "general",
            subject,
            message,
            orderId: orderId || "",
            screenshot: req.file ? req.file.filename : "",
            status: "open"
        });

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

        res.json({
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
        const tickets = await SupportTicket.find().sort({
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
