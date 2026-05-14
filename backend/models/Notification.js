const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true
        },

        title: {
            type: String,
            required: true
        },

        message: {
            type: String,
            default: ""
        },

        type: {
            type: String,
            default: "general"
        },

        orderId: {
            type: String,
            default: ""
        },

        isRead: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model(
    "Notification",
    notificationSchema
);