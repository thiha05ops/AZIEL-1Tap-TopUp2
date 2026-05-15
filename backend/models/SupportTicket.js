const mongoose = require("mongoose");

const supportTicketSchema = new mongoose.Schema(
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

        status: {
            type: String,
            default: "open"
        },

        adminReply: {
            type: String,
            default: ""
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model(
    "SupportTicket",
    supportTicketSchema
);