const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
    orderId: {
        type: String,
        required: true,
        unique: true
    },

    username: {
        type: String,
        default: "guest"
    },

    game: {
        type: String,
        required: true
    },

    userId: {
        type: String,
        required: true
    },

    zoneId: {
        type: String,
        default: ""
    },

    packageName: {
        type: String,
        required: true
    },

    amount: {
        type: Number,
        required: true
    },

    currency: {
        type: String,
        default: "MMK"
    },

    region: {
        type: String,
        default: "MM"
    },

    paymentMethod: {
        type: String,
        required: true
    },

    paymentSlip: {
        type: String,
        default: ""
    },

    note: {
        type: String,
        default: "Waiting for payment confirmation."
    },

    status: {
        type: String,
        enum: [
            "pending_payment",
            "paid",
            "processing",
            "completed",
            "failed",
            "refund_pending",
            "refunded"
        ],
        default: "pending_payment"
    },
    refunded: {
        type: Boolean,
        default: false
    },

    refundAmount: {
        type: Number,
        default: 0
    },

    refundReason: {
        type: String,
        default: ""
    },

    refundMethod: {
        type: String,
        enum: ["wallet", "bank", ""],
        default: ""
    },

    refundedBy: {
        type: String,
        default: ""
    },

    refundedAt: {
        type: Date,
        default: null
    },

}, {
    timestamps: true
});

module.exports =
    mongoose.model(
        "Order",
        orderSchema
    );