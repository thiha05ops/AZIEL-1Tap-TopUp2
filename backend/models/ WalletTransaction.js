// backend/models/WalletTransaction.js

const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema({

    transactionId: {
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
        enum: ["topup", "payment", "refund"],
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

    status: {
        type: String,
        default: "completed"
    },

    description: {
        type: String,
        default: ""
    }

}, { timestamps: true });

module.exports = mongoose.model(
    "WalletTransaction",
    walletTransactionSchema
);