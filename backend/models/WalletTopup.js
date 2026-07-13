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

    region: {
        type: String,
        default: "MM"
    },

    paymentMethod: {
        type: String,
        required: true
    },

    paymentProvider: {
        type: String,
        default: ""
    },

    transactionId: {
        type: String,
        default: ""
    },

    qrImage: {
        type: String,
        default: ""
    },

    paymentSlip: {
        type: String,
        default: ""
    },

    paymentEvidence: {
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
        enum: [
            "pending",
            "paid",
            "completed",
            "approved",
            "rejected",
            "cancelled",
            "failed"
        ],
        default: "pending"
    },

    note: {
        type: String,
        default: "Waiting for approval"
    },

    paidAt: {
        type: Date,
        default: null
    }

}, { timestamps: true });

module.exports = mongoose.model(
    "WalletTopup",
    walletTopupSchema
);
