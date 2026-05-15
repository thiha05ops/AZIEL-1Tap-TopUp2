const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const SupportTicket =
    require("../models/SupportTicket");

const adminMiddleware =
    require("../middleware/adminMiddleware");

// ======================
// UPLOAD SETUP
// ======================

const uploadDir =
    path.join(__dirname, "../uploads/support");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, {
        recursive: true
    });
}

const storage =
    multer.diskStorage({

        destination: (req, file, cb) => {
            cb(null, uploadDir);
        },

        filename: (req, file, cb) => {

            cb(
                null,
                Date.now() +
                "-" +
                file.originalname
            );

        }

    });

const upload =
    multer({ storage });


// ======================
// CREATE TICKET
// POST /api/support/ticket
// ======================

router.post(
    "/support/ticket",
    upload.single("screenshot"),

    async (req, res) => {

        try {

            const {
                username,
                type,
                subject,
                message
            } = req.body;

            if (
                !username ||
                !subject ||
                !message
            ) {

                return res.json({
                    success: false,
                    message:
                        "Missing required fields"
                });

            }

            const ticket =
                await SupportTicket.create({

                    ticketId:
                        "SUP-" +
                        Date.now(),

                    username,

                    type:
                        type || "general",

                    subject,

                    message,

                    screenshot:
                        req.file
                            ? req.file.filename
                            : "",

                    status: "open"

                });

            const io =
                req.app.get("io");

            if (io) {

                io.to("admins").emit(
                    "adminNewUpdate",
                    {
                        type: "support_ticket",
                        ticketId:
                            ticket.ticketId,

                        username,

                        subject
                    }
                );

            }

            res.json({
                success: true,
                message:
                    "Support ticket submitted",
                ticket
            });

        } catch (error) {

            console.log(
                "Create support ticket error:",
                error
            );

            res.json({
                success: false,
                message:
                    "Server error"
            });

        }

    }
);


// ======================
// GET USER TICKETS
// GET /api/support/my/:username
// ======================

router.get(
    "/support/my/:username",

    async (req, res) => {

        try {

            const tickets =
                await SupportTicket.find({

                    username:
                        req.params.username

                }).sort({
                    createdAt: -1
                });

            res.json({
                success: true,
                tickets
            });

        } catch (error) {

            console.log(
                "Load support tickets error:",
                error
            );

            res.json({
                success: false,
                message:
                    "Server error"
            });

        }

    }
);


// ======================
// ADMIN GET ALL TICKETS
// GET /api/admin/support/tickets
// ======================

router.get(
    "/admin/support/tickets",
    adminMiddleware,

    async (req, res) => {

        try {

            const tickets =
                await SupportTicket.find()
                    .sort({
                        createdAt: -1
                    });

            res.json({
                success: true,
                tickets
            });

        } catch (error) {

            console.log(
                "Admin support tickets error:",
                error
            );

            res.json({
                success: false,
                message:
                    "Server error"
            });

        }

    }
);


// ======================
// ADMIN REPLY
// PUT /api/admin/support/tickets/:id/reply
// ======================

router.put(
    "/admin/support/tickets/:id/reply",
    adminMiddleware,

    async (req, res) => {

        try {

            const {
                reply,
                status
            } = req.body;

            const ticket =
                await SupportTicket.findById(
                    req.params.id
                );

            if (!ticket) {

                return res.json({
                    success: false,
                    message:
                        "Ticket not found"
                });

            }

            ticket.adminReply =
                reply || "";

            if (status) {
                ticket.status = status;
            }

            await ticket.save();

            const io =
                req.app.get("io");

            if (io) {

                io.to(ticket.username)
                    .emit(
                        "newNotification",
                        {
                            title:
                                "Support Reply",

                            message:
                                `Admin replied to your support ticket: ${ticket.subject}`,

                            isRead: false
                        }
                    );

            }

            res.json({
                success: true,
                ticket
            });

        } catch (error) {

            console.log(
                "Support reply error:",
                error
            );

            res.json({
                success: false,
                message:
                    "Server error"
            });

        }

    }
);

module.exports = router;