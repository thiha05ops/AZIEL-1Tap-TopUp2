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

    customerEmail: {
        type: String,
        trim: true,
        lowercase: true,
        default: ""
    },

    customerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
        immutable: true
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

    paymentAttemptId: { type: String, trim: true, default: "" },
    paymentStatus: {
        type: String,
        enum: ["unpaid", "initiating", "pending", "paid", "failed", "expired", "cancelled"],
        default: "unpaid"
    },
    settlementStatus: {
        type: String,
        enum: ["not_ready", "pending", "credited", "failed"],
        default: "not_ready"
    },
    walletTransactionId: { type: String, trim: true, default: "" },
    creditedAt: { type: Date, default: null },
    settlementError: {
        code: { type: String, default: "" },
        message: { type: String, default: "" },
        recordedAt: { type: Date, default: null }
    },
    creationIdempotencyKey: { type: String, trim: true, default: "", immutable: true },
    creationFingerprint: { type: String, trim: true, default: "", immutable: true },

    topupIntentId: {
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

    paymentSnapshot: {
        method: { type: String, default: "" },
        key: { type: String, default: "" },
        region: { type: String, default: "" },
        paymentType: { type: String, default: "" },
        provider: { type: String, default: "" },
        providerType: { type: String, default: "" },
        paymentChannel: { type: String, default: "" },
        confirmationMode: { type: String, default: "" },
        paymentMethodId: { type: String, default: "" },
        accountName: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
        qrImage: { type: String, default: "" },
        qrMode: { type: String, default: "" },
        dynamicQr: {
            orderReference: { type: String, default: "" },
            encodedReference: { type: String, default: "" },
            qrPayload: { type: String, default: "" },
            qrImage: { type: String, default: "" },
            expiresAt: { type: Date, default: null }
        }
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

walletTopupSchema.index({ status: 1, createdAt: -1, _id: -1 });
walletTopupSchema.index({ username: 1, createdAt: -1, _id: -1 });
walletTopupSchema.index({ createdAt: -1, _id: -1 });
walletTopupSchema.index(
    { topupIntentId: 1 },
    {
        unique: true,
        partialFilterExpression: { topupIntentId: { $type: "string", $gt: "" } }
    }
);
walletTopupSchema.index({ paymentAttemptId: 1 }, { unique: true, partialFilterExpression: { paymentAttemptId: { $type: "string", $gt: "" } } });
walletTopupSchema.index({ walletTransactionId: 1 }, { unique: true, partialFilterExpression: { walletTransactionId: { $type: "string", $gt: "" } } });
walletTopupSchema.index(
    { customerUserId: 1, creationIdempotencyKey: 1 },
    { unique: true, partialFilterExpression: { customerUserId: { $type: "objectId" }, creationIdempotencyKey: { $type: "string", $gt: "" } } }
);
walletTopupSchema.index({ paymentStatus: 1, settlementStatus: 1, updatedAt: 1 });

module.exports = mongoose.model(
    "WalletTopup",
    walletTopupSchema
);
