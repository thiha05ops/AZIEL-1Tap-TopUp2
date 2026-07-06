// backend/models/WalletTransaction.js

const mongoose = require("mongoose");

const walletTransactionSchema =
    new mongoose.Schema({

        transactionId: {
            type: String,
            required: true,
            unique: true
        },

        username: {
            type: String,
            required: true
        },

        orderId: {
            type: String,
            default: ""
        },

        type: {
            type: String,
            enum: [
                "topup",
                "payment",
                "refund"
            ],
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
        },

        referenceType: {
            type: String,
            enum: [
                "topup",
                "order",
                "refund",
                "bonus"
            ],
            default: "order"
        },

        performedBy: {
            type: String,
            default: "system"
        }

    }, {
        timestamps: true
    });

module.exports =
    mongoose.model(
        "WalletTransaction",
        walletTransactionSchema
    );