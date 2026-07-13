const mongoose = require("mongoose");

const supportMessageSchema =
    new mongoose.Schema({

        sender: {
            type: String,
            enum: [
                "user",
                "admin",
                "bot"
            ],
            default: "user"
        },

        text: {
            type: String,
            default: ""
        },

        createdAt: {
            type: Date,
            default: Date.now
        }

    });

const supportTicketSchema =
    new mongoose.Schema(

        {

            ticketId: {
                type: String,
                required: true,
                unique: true
            },

            username: {
                type: String,
                required: true
            },

            type: {
                type: String,
                default: "general"
            },

            subject: {
                type: String,
                required: true
            },

            message: {
                type: String,
                required: true
            },

            screenshot: {
                type: String,
                default: ""
            },

            screenshotEvidence: {
                provider: { type: String, default: "" },
                key: { type: String, default: "" },
                url: { type: String, default: "" },
                mimeType: { type: String, default: "" },
                size: { type: Number, default: 0 },
                originalName: { type: String, default: "" },
                uploadedAt: { type: Date, default: null }
            },

            status: {
                type: String,
                default: "open"
            },

            adminReply: {
                type: String,
                default: ""
            },

            // =================================
            // LIVE CHAT THREAD
            // =================================

            messages: [
                supportMessageSchema
            ],

            // =================================
            // LIVE STATUS
            // =================================

            unreadByAdmin: {
                type: Boolean,
                default: true
            },

            unreadByUser: {
                type: Boolean,
                default: false
            },

            userOnline: {
                type: Boolean,
                default: false
            },

            adminOnline: {
                type: Boolean,
                default: false
            },

            lastMessageAt: {
                type: Date,
                default: Date.now
            },

            // =================================
            // AI SUPPORT
            // =================================

            aiHandled: {
                type: Boolean,
                default: false
            },

            aiReplyCount: {
                type: Number,
                default: 0
            }

        },

        {
            timestamps: true
        }

    );

module.exports =
    mongoose.model(
        "SupportTicket",
        supportTicketSchema
    );
