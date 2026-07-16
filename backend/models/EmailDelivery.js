const mongoose = require("mongoose");

const emailDeliverySchema = new mongoose.Schema(
    {
        deliveryKey: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        messageType: {
            type: String,
            required: true,
            trim: true
        },
        orderId: {
            type: String,
            trim: true,
            default: ""
        },
        recipientHash: {
            type: String,
            trim: true,
            default: ""
        },
        recipientMasked: {
            type: String,
            trim: true,
            default: ""
        },
        status: {
            type: String,
            enum: ["pending", "delivered", "failed"],
            default: "pending",
            index: true
        },
        attemptCount: {
            type: Number,
            default: 0
        },
        lastErrorCode: {
            type: String,
            trim: true,
            default: ""
        },
        lastAttemptAt: {
            type: Date,
            default: null
        },
        deliveredAt: {
            type: Date,
            default: null
        },
        providerMessageId: {
            type: String,
            trim: true,
            default: ""
        }
    },
    {
        timestamps: true
    }
);

emailDeliverySchema.index({ orderId: 1, messageType: 1 });
emailDeliverySchema.index({ status: 1, updatedAt: 1 });

module.exports = mongoose.model("EmailDelivery", emailDeliverySchema);
