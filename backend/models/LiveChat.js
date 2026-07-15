const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
    {
        sender: {
            type: String,
            enum: ["user", "admin", "bot"],
            required: true
        },
        text: {
            type: String,
            required: true,
            trim: true
        },
        readByUser: {
            type: Boolean,
            default: false
        },
        readByAdmin: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

const liveChatSchema = new mongoose.Schema(
    {
        chatId: {
            type: String,
            required: true,
            unique: true
        },
        username: {
            type: String,
            required: true,
            index: true
        },
        messages: [messageSchema],
        status: {
            type: String,
            enum: ["active", "closed", "deleted"],
            default: "active"
        },
        lastMessageAt: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

liveChatSchema.index({ status: 1, lastMessageAt: -1, _id: -1 });
liveChatSchema.index({ username: 1, status: 1, lastMessageAt: -1 });

module.exports = mongoose.model("LiveChat", liveChatSchema);
