"use strict";

const mongoose = require("mongoose");

const PAYMENT_ATTEMPT_STATUSES = Object.freeze([
    "UNPAID",
    "INITIATING",
    "PENDING",
    "PAID",
    "FAILED",
    "EXPIRED",
    "CANCELLED",
    "WAIVED",
    "REFUNDED"
]);

const OWNER_TYPES = Object.freeze(["USER", "SESSION"]);

function finiteNonNegative(value) {
    return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function hasOwner(owner = {}) {
    if (owner.type === "USER") return Boolean(String(owner.userId || "").trim());
    if (owner.type === "SESSION") return Boolean(String(owner.sessionId || "").trim()) && !String(owner.userId || "").trim();
    return false;
}

const ownerSchema = new mongoose.Schema(
    {
        type: { type: String, enum: OWNER_TYPES, required: true, immutable: true },
        userId: { type: String, trim: true, default: "", immutable: true },
        sessionId: { type: String, trim: true, default: "", immutable: true }
    },
    { _id: false }
);

const providerEventSchema = new mongoose.Schema(
    {
        providerEventId: { type: String, trim: true, default: "" },
        provider: { type: String, trim: true, default: "" },
        providerReference: { type: String, trim: true, default: "" },
        providerTransactionId: { type: String, trim: true, default: "" },
        eventType: { type: String, trim: true, default: "" },
        status: { type: String, enum: PAYMENT_ATTEMPT_STATUSES, required: true },
        amount: { type: Number, default: null, validate: { validator: value => value === null || finiteNonNegative(value), message: "event amount must be non-negative." } },
        currency: { type: String, trim: true, uppercase: true, default: "" },
        occurredAt: { type: Date, default: null },
        receivedAt: { type: Date, required: true },
        safeMetadata: { type: mongoose.Schema.Types.Mixed, default: {} }
    },
    { _id: false, minimize: false }
);

const failureSchema = new mongoose.Schema(
    {
        category: { type: String, trim: true, default: "" },
        code: { type: String, trim: true, default: "" },
        message: { type: String, trim: true, default: "" },
        recordedAt: { type: Date, default: null }
    },
    { _id: false }
);

const paymentAttemptSchema = new mongoose.Schema(
    {
        attemptId: { type: String, trim: true, required: true, immutable: true },
        orderId: { type: String, trim: true, required: true, immutable: true },
        quoteId: { type: String, trim: true, default: "", immutable: true },
        ownerId: { type: String, trim: true, required: true, immutable: true },
        owner: {
            type: ownerSchema,
            required: true,
            immutable: true,
            validate: { validator: hasOwner, message: "PaymentAttempt requires a valid owner binding." }
        },
        provider: { type: String, trim: true, required: true, immutable: true },
        providerType: { type: String, trim: true, default: "", immutable: true },
        paymentMethod: { type: String, trim: true, required: true, immutable: true },
        paymentMethodId: { type: String, trim: true, default: "", immutable: true },
        paymentChannel: { type: String, trim: true, default: "", immutable: true },
        confirmationMode: { type: String, trim: true, default: "", immutable: true },
        amount: { type: Number, required: true, validate: finiteNonNegative, immutable: true },
        currency: { type: String, trim: true, uppercase: true, required: true, immutable: true },
        region: { type: String, trim: true, uppercase: true, default: "", immutable: true },
        status: { type: String, enum: PAYMENT_ATTEMPT_STATUSES, default: "UNPAID", required: true },
        providerReference: { type: String, trim: true, default: "" },
        providerTransactionId: { type: String, trim: true, default: "" },
        rawProviderStatus: { type: String, trim: true, default: "" },
        idempotencyKey: { type: String, trim: true, default: "", immutable: true },
        operation: { type: String, trim: true, default: "initiatePayment", immutable: true },
        requestFingerprint: { type: String, trim: true, default: "", immutable: true },
        previousAttemptId: { type: String, trim: true, default: "", immutable: true },
        providerMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
        safeMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
        paymentInstructions: { type: mongoose.Schema.Types.Mixed, default: null },
        qr: { type: mongoose.Schema.Types.Mixed, default: null },
        redirect: { type: mongoose.Schema.Types.Mixed, default: null },
        failure: { type: failureSchema, default: () => ({}) },
        failureCategory: { type: String, trim: true, default: "" },
        failureCode: { type: String, trim: true, default: "" },
        failureMessage: { type: String, trim: true, default: "" },
        eventHistory: { type: [providerEventSchema], default: [] },
        createdAt: { type: Date, required: true, immutable: true },
        updatedAt: { type: Date, required: true },
        expiresAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        expiredAt: { type: Date, default: null }
    },
    {
        strict: "throw",
        minimize: false,
        timestamps: false,
        collection: "paymentattempts"
    }
);

paymentAttemptSchema.pre("validate", function validatePaymentAttempt() {
    if (this.owner?.type === "USER" && this.ownerId !== this.owner.userId) {
        this.invalidate("ownerId", "USER PaymentAttempt ownerId must match owner.userId.");
    }
    if (this.owner?.type === "SESSION" && this.ownerId !== this.owner.sessionId) {
        this.invalidate("ownerId", "SESSION PaymentAttempt ownerId must match owner.sessionId.");
    }
    if (this.paymentMethodId && this.paymentMethod && this.paymentMethodId !== this.paymentMethod) {
        this.invalidate("paymentMethodId", "paymentMethod and paymentMethodId must match when both are supplied.");
    }
    if (this.failure?.category && this.failureCategory && this.failure.category !== this.failureCategory) {
        this.invalidate("failureCategory", "Top-level and nested failure category must match.");
    }
    if (this.failure?.code && this.failureCode && this.failure.code !== this.failureCode) {
        this.invalidate("failureCode", "Top-level and nested failure code must match.");
    }
});

paymentAttemptSchema.index({ attemptId: 1 }, { unique: true });
paymentAttemptSchema.index({ providerReference: 1 }, {
    unique: true,
    partialFilterExpression: { providerReference: { $exists: true, $gt: "" } }
});
paymentAttemptSchema.index({ provider: 1, ownerId: 1, idempotencyKey: 1, operation: 1 }, {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $exists: true, $gt: "" } }
});
paymentAttemptSchema.index({ ownerId: 1, orderId: 1 });
paymentAttemptSchema.index({ orderId: 1, createdAt: -1 });
paymentAttemptSchema.index({ status: 1 });
paymentAttemptSchema.index({ expiresAt: 1 }, { partialFilterExpression: { expiresAt: { $type: "date" } } });
paymentAttemptSchema.index({ "eventHistory.providerEventId": 1 }, {
    sparse: true,
    partialFilterExpression: { "eventHistory.providerEventId": { $exists: true, $gt: "" } }
});

module.exports = mongoose.model("PaymentAttempt", paymentAttemptSchema);
module.exports.PAYMENT_ATTEMPT_STATUSES = PAYMENT_ATTEMPT_STATUSES;
