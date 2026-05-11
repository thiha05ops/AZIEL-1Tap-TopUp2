const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            index: true
        },

        title: {
            type: String,
            required: true
        },

        message: {
            type: String,
            required: true
        },

        type: {
            type: String,
            default: "order"
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

module.exports =
    mongoose.model(
        "Notification",
        notificationSchema
    );