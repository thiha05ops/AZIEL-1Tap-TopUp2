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
                "refund",
                "wallet.topup",
                "wallet.payment",
                "wallet.refund",
                "wallet.reversal",
                "wallet.adjustment",
                "wallet.migration"
            ],
            required: true
        },

        direction: {
            type: String,
            enum: ["credit", "debit", ""],
            default: ""
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
            enum: ["completed", "committed", "reversed", "failed", "pending"],
            default: "completed"
        },

        balanceBefore: {
            type: Number,
            default: null
        },

        balanceAfter: {
            type: Number,
            default: null
        },

        source: {
            type: String,
            default: "legacy"
        },

        referenceId: {
            type: String,
            default: ""
        },

        topupId: {
            type: String,
            default: ""
        },

        idempotencyKey: {
            type: String,
            index: {
                unique: true,
                sparse: true
            }
        },

        reversalOf: {
            type: String,
            default: ""
        },

        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
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
                "bonus",
                "adjustment",
                "reversal",
                "wallet_migration",
                "admin_adjustment"
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

walletTransactionSchema.index({ username: 1, createdAt: -1 });
walletTransactionSchema.index({ orderId: 1 });
walletTransactionSchema.index({ topupId: 1 });
walletTransactionSchema.index({ referenceType: 1, referenceId: 1 });
walletTransactionSchema.index({ type: 1, currency: 1, createdAt: -1 });

module.exports =
    mongoose.model(
        "WalletTransaction",
        walletTransactionSchema
    );
