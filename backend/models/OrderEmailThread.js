const mongoose = require("mongoose");

const orderEmailThreadSchema = new mongoose.Schema(
    {
        commerceOrderId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            maxlength: 120,
            immutable: true
        },
        rootMessageId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            maxlength: 200,
            immutable: true
        },
        rootDeliveryKey: {
            type: String,
            required: true,
            trim: true,
            maxlength: 240,
            immutable: true
        },
        recipientHash: {
            type: String,
            required: true,
            trim: true,
            maxlength: 64,
            immutable: true
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("OrderEmailThread", orderEmailThreadSchema);
