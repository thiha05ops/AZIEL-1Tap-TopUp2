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

const FULFILLMENT_ROUTE_TYPES = Object.freeze({
    MANUAL_ADMIN: "MANUAL_ADMIN",
    SUPPLIER_MANUAL: "SUPPLIER_MANUAL",
    SUPPLIER_API: "SUPPLIER_API"
});

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
            refPath: "orderModel",
            required: true
        },
        orderModel: {
            type: String,
            enum: ["Order", "CommerceOrder"],
            default: "Order",
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
            default: null
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
            default: null
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
        customerMarket: {
            type: String,
            enum: ["MM", "TH"],
            default: undefined
        },
        mode: {
            type: String,
            enum: ["MANUAL", "API"],
            required: true
        },
        routeType: {
            type: String,
            enum: Object.values(FULFILLMENT_ROUTE_TYPES),
            required: true,
            default: FULFILLMENT_ROUTE_TYPES.SUPPLIER_MANUAL
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
        normalizedFailureCategory: {
            type: String,
            enum: [
                "",
                "SUPPLIER_OUT_OF_STOCK",
                "SUPPLIER_BALANCE_INSUFFICIENT",
                "SUPPLIER_AUTH_ERROR",
                "SUPPLIER_TIMEOUT",
                "SUPPLIER_RATE_LIMIT",
                "SUPPLIER_PACKAGE_INVALID",
                "SUPPLIER_SERVICE_UNAVAILABLE",
                "SUPPLIER_REJECTED",
                "SUPPLIER_UNKNOWN_ERROR"
            ],
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

fulfillmentAttemptSchema.pre("validate", function validateFulfillmentRoute() {
    if (this.routeType === FULFILLMENT_ROUTE_TYPES.MANUAL_ADMIN) return;
    if (!this.supplierId) this.invalidate("supplierId", "Supplier-backed fulfillment requires supplierId.");
    if (!this.supplierMappingId) this.invalidate("supplierMappingId", "Supplier-backed fulfillment requires supplierMappingId.");
});

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
fulfillmentAttemptSchema.index({ normalizedFailureCategory: 1, failedAt: -1, _id: -1 });
fulfillmentAttemptSchema.index({ createdAt: -1, _id: -1 });

module.exports = mongoose.model("FulfillmentAttempt", fulfillmentAttemptSchema);
module.exports.FULFILLMENT_STATUSES = FULFILLMENT_STATUSES;
module.exports.ACTIVE_FULFILLMENT_STATUSES = ACTIVE_FULFILLMENT_STATUSES;
module.exports.FULFILLMENT_ROUTE_TYPES = FULFILLMENT_ROUTE_TYPES;
