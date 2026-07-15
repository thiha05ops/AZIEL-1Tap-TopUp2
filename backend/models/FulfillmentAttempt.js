const mongoose = require("mongoose");

const FULFILLMENT_STATUSES = Object.freeze({
    PENDING: "PENDING",
    IN_PROGRESS: "IN_PROGRESS",
    SUCCEEDED: "SUCCEEDED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED"
});

const ACTIVE_FULFILLMENT_STATUSES = Object.freeze([
    FULFILLMENT_STATUSES.PENDING,
    FULFILLMENT_STATUSES.IN_PROGRESS
]);

const fulfillmentAttemptSchema = new mongoose.Schema(
    {
        fulfillmentId: {
            type: String,
            required: true,
            unique: true,
            immutable: true,
            trim: true,
            uppercase: true
        },
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            required: true
        },
        orderCode: {
            type: String,
            required: true,
            trim: true
        },
        supplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Supplier",
            required: true
        },
        supplierCodeSnapshot: {
            type: String,
            required: true,
            trim: true,
            uppercase: true
        },
        supplierMappingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SupplierProductMapping",
            required: true
        },
        productCode: {
            type: String,
            trim: true,
            lowercase: true,
            default: ""
        },
        packageCode: {
            type: String,
            trim: true,
            uppercase: true,
            default: ""
        },
        region: {
            type: String,
            enum: ["MM", "TH"],
            required: true
        },
        mode: {
            type: String,
            enum: ["MANUAL", "API"],
            required: true
        },
        status: {
            type: String,
            enum: Object.values(FULFILLMENT_STATUSES),
            required: true,
            default: FULFILLMENT_STATUSES.PENDING
        },
        idempotencyKey: {
            type: String,
            required: true,
            trim: true
        },
        startedByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAccount",
            default: null
        },
        startedByUsernameSnapshot: {
            type: String,
            trim: true,
            default: ""
        },
        assignedAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAccount",
            default: null
        },
        supplierReference: {
            type: String,
            trim: true,
            maxlength: 160,
            default: ""
        },
        supplierRequest: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        supplierResult: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        failureCode: {
            type: String,
            trim: true,
            maxlength: 80,
            default: ""
        },
        failureReason: {
            type: String,
            trim: true,
            maxlength: 500,
            default: ""
        },
        startedAt: {
            type: Date,
            default: null
        },
        completedAt: {
            type: Date,
            default: null
        },
        failedAt: {
            type: Date,
            default: null
        },
        cancelledAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

fulfillmentAttemptSchema.index({ orderId: 1, createdAt: -1, _id: -1 });
fulfillmentAttemptSchema.index(
    { orderId: 1, status: 1 },
    {
        name: "one_active_fulfillment_per_order",
        unique: true,
        partialFilterExpression: { status: { $in: ACTIVE_FULFILLMENT_STATUSES } }
    }
);
fulfillmentAttemptSchema.index({ orderId: 1, status: 1 }, {
    name: "one_successful_fulfillment_per_order",
    unique: true,
    partialFilterExpression: { status: FULFILLMENT_STATUSES.SUCCEEDED }
});
fulfillmentAttemptSchema.index({ idempotencyKey: 1 }, { unique: true, name: "unique_fulfillment_idempotency" });
fulfillmentAttemptSchema.index({ status: 1, createdAt: -1, _id: -1 });
fulfillmentAttemptSchema.index({ supplierId: 1, createdAt: -1, _id: -1 });
fulfillmentAttemptSchema.index({ supplierCodeSnapshot: 1, createdAt: -1, _id: -1 });
fulfillmentAttemptSchema.index({ createdAt: -1, _id: -1 });

module.exports = mongoose.model("FulfillmentAttempt", fulfillmentAttemptSchema);
module.exports.FULFILLMENT_STATUSES = FULFILLMENT_STATUSES;
module.exports.ACTIVE_FULFILLMENT_STATUSES = ACTIVE_FULFILLMENT_STATUSES;
