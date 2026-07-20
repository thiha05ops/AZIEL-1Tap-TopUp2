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

    customerEmail: {
        type: String,
        default: "",
        trim: true,
        lowercase: true
    },

    customerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
    },

    game: {
        type: String,
        required: true
    },

    productCode: {
        type: String,
        default: ""
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

    packageCode: {
        type: String,
        default: ""
    },

    productName: {
        type: String,
        default: ""
    },

    amount: {
        type: Number,
        required: true
    },

    originalAmount: {
        type: Number,
        default: 0
    },

    discountAmount: {
        type: Number,
        default: 0
    },

    finalAmount: {
        type: Number,
        default: 0
    },

    promoCode: {
        type: String,
        trim: true,
        uppercase: true,
        default: ""
    },

    promoSnapshot: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },

    promoRedemptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PromoRedemption",
        default: null
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

    paymentEvidence: {
        provider: { type: String, default: "" },
        key: { type: String, default: "" },
        url: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        originalName: { type: String, default: "" },
        uploadedAt: { type: Date, default: null }
    },

    paymentStatus: {
        type: String,
        enum: [
            "pending",
            "paid",
            "failed",
            "expired",
            "cancelled",
            "refunded"
        ],
        default: "pending"
    },

    paymentProvider: {
        type: String,
        default: ""
    },

    transactionId: {
        type: String,
        default: ""
    },

    processedPaymentEvents: {
        type: [String],
        default: []
    },

    manualPaymentAttemptId: {
        type: String,
        default: ""
    },

    manualPaymentQr: {
        orderReference: { type: String, default: "" },
        encodedReference: { type: String, default: "" },
        qrPayload: { type: String, default: "" },
        expiresAt: { type: Date, default: null }
    },

    timeline: [
        {
            status: {
                type: String,
                default: ""
            },
            previousStatus: {
                type: String,
                default: ""
            },
            paymentStatus: {
                type: String,
                default: ""
            },
            source: {
                type: String,
                default: "system"
            },
            actorType: {
                type: String,
                default: "system"
            },
            actor: {
                type: String,
                default: ""
            },
            reason: {
                type: String,
                default: ""
            },
            idempotencyKey: {
                type: String,
                default: ""
            },
            at: {
                type: Date,
                default: Date.now
            }
        }
    ],

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
            "cancelled",
            "failed",
            "expired",
            "refund_requested",
            "refund_pending",
            "refund_rejected",
            "refunded"
        ],
        default: "pending_payment"
    },

    refundRequested: {
        type: Boolean,
        default: false
    },

    refundRequestReason: {
        type: String,
        default: ""
    },

    refundRequestedAt: {
        type: Date,
        default: null
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

    refundRejectedReason: {
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

    financialOutcome: {
        type: String,
        enum: ["", "FULFILLMENT_SUCCEEDED", "REFUND_CREDITED"],
        default: "",
        index: true
    },

    financialOutcomeAt: {
        type: Date,
        default: null
    }

}, {
    timestamps: true
});

orderSchema.index(
    { manualPaymentAttemptId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            manualPaymentAttemptId: { $type: "string", $gt: "" }
        }
    }
);
orderSchema.index({ createdAt: -1, _id: -1 });
orderSchema.index({ status: 1, createdAt: -1, _id: -1 });
orderSchema.index({ username: 1, createdAt: -1, _id: -1 });
orderSchema.index({ orderId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("Order", orderSchema);
