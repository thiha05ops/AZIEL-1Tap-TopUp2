// backend/models/WalletTopup.js

const mongoose = require("mongoose");

const walletTopupSchema = new mongoose.Schema({

    topupId: {
        type: String,
        required: true,
        unique: true
    },

    username: {
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

    paymentMethod: {
        type: String,
        required: true
    },

    paymentSlip: {
        type: String,
        default: ""
    },

    status: {
        type: String,
        enum: [
            "pending",
            "paid",
            "completed",
            "approved",
            "rejected",
            "cancelled",
            "failed"
        ],
    },

    note: {
        type: String,
        default: "Waiting for approval"
    }

}, { timestamps: true });

module.exports = mongoose.model(
    "WalletTopup",
    walletTopupSchema
);