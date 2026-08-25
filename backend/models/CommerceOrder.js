const mongoose = require("mongoose");

const OWNER_TYPES = Object.freeze(["USER", "SESSION"]);
const ORDER_STATUSES = Object.freeze([
    "pending_payment",
    "paid",
    "processing",
    "completed",
    "cancelled",
    "payment_failed",
    "expired",
    "failed",
    "refund_pending",
    "refunded"
]);
const PAYMENT_STATUSES = Object.freeze(["unpaid", "pending", "paid", "failed", "expired", "cancelled", "waived", "refunded"]);
const FULFILMENT_STATUSES = Object.freeze(["not_started", "queued", "processing", "completed", "failed", "cancelled"]);

function hasOwner(owner = {}) {
    if (owner.type === "USER") return Boolean(String(owner.userId || "").trim());
    if (owner.type === "SESSION") return Boolean(String(owner.sessionId || "").trim()) && !String(owner.userId || "").trim();
    return false;
}

function hasPackageIdentity(product = {}) {
    return Boolean(
        String(product.packageId || "").trim() ||
        String(product.packageCode || "").trim() ||
        String(product.packageRef || "").trim()
    );
}

function finiteNonNegative(value) {
    return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function positiveInteger(value) {
    return Number.isInteger(Number(value)) && Number(value) > 0;
}

const ownerSchema = new mongoose.Schema(
    {
        type: { type: String, enum: OWNER_TYPES, required: true, immutable: true },
        userId: { type: String, trim: true, default: "", immutable: true },
        sessionId: { type: String, trim: true, default: "", immutable: true }
    },
    { _id: false }
);

const commerceSchema = new mongoose.Schema(
    {
        source: { type: String, trim: true, required: true, immutable: true },
        version: { type: String, trim: true, required: true, immutable: true }
    },
    { _id: false }
);

const productSchema = new mongoose.Schema(
    {
        gameId: { type: String, trim: true, default: "", immutable: true },
        gameCode: { type: String, trim: true, default: "", immutable: true },
        gameName: { type: String, trim: true, default: "", immutable: true },
        packageId: { type: String, trim: true, default: "", immutable: true },
        packageCode: { type: String, trim: true, default: "", immutable: true },
        packageRef: { type: String, trim: true, default: "", immutable: true },
        packageName: { type: String, trim: true, default: "", immutable: true },
        packageType: { type: String, trim: true, default: "", immutable: true },
        category: { type: String, trim: true, default: "", immutable: true },
        categoryId: { type: String, trim: true, default: "", immutable: true },
        categoryCode: { type: String, trim: true, default: "", immutable: true },
        region: { type: String, trim: true, required: true, immutable: true },
        quantity: { type: Number, required: true, validate: positiveInteger, immutable: true },
        fulfilmentSchemaVersion: { type: String, trim: true, default: "", immutable: true }
    },
    { _id: false }
);

const fulfilmentSchema = new mongoose.Schema(
    {
        input: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
        routeSnapshot: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
        status: { type: String, enum: FULFILMENT_STATUSES, default: "not_started" },
        references: { type: [mongoose.Schema.Types.Mixed], default: [] }
    },
    { _id: false, minimize: false }
);

const customerSchema = new mongoose.Schema(
    {
        contact: {
            email: { type: String, trim: true, lowercase: true, default: "", immutable: true },
            phone: { type: String, trim: true, default: "", immutable: true }
        },
        notes: { type: String, trim: true, default: "", immutable: true }
    },
    { _id: false }
);

const commercialSchema = new mongoose.Schema(
    {
        currency: { type: String, trim: true, required: true, immutable: true },
        region: { type: String, trim: true, required: true, immutable: true },
        quantity: { type: Number, required: true, validate: positiveInteger, immutable: true },
        originalUnitPrice: { type: Number, required: true, validate: finiteNonNegative, immutable: true },
        discountAmount: { type: Number, required: true, validate: finiteNonNegative, immutable: true },
        quotedUnitPrice: { type: Number, required: true, validate: finiteNonNegative, immutable: true },
        subtotalAmount: { type: Number, default: null, validate: { validator: value => value === null || finiteNonNegative(value), message: "subtotalAmount must be non-negative." }, immutable: true },
        totalAmount: { type: Number, required: true, validate: finiteNonNegative, immutable: true },
        promotionAppliesTo: { type: String, trim: true, default: "UNIT_PRICE", immutable: true }
    },
    { _id: false }
);

const paymentSchema = new mongoose.Schema(
    {
        paymentMethodId: { type: String, trim: true, required: true, immutable: true },
        paymentChannel: { type: String, trim: true, default: "", immutable: true },
        provider: { type: String, trim: true, default: "", immutable: true },
        flowType: { type: String, trim: true, default: "", immutable: true },
        nextAction: { type: String, trim: true, default: "NONE" },
        status: { type: String, enum: PAYMENT_STATUSES, default: "unpaid" },
        paymentMethodBound: { type: Boolean, default: false, immutable: true },
        metadata: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
        references: { type: [mongoose.Schema.Types.Mixed], default: [] }
    },
    { _id: false, minimize: false }
);

const checkoutSchema = new mongoose.Schema(
    {
        idempotencyKeyHash: { type: String, trim: true, required: true, immutable: true },
        requestFingerprint: { type: String, trim: true, required: true, immutable: true },
        checkedOutAt: { type: Date, required: true, immutable: true },
        traceId: { type: String, trim: true, default: "", immutable: true },
        source: { type: String, trim: true, default: "", immutable: true },
        ipHash: { type: String, trim: true, default: "", immutable: true },
        userAgentHash: { type: String, trim: true, default: "", immutable: true }
    },
    { _id: false }
);

const quoteMetadataSchema = new mongoose.Schema(
    {
        quoteRuntimeVersion: { type: String, trim: true, default: "", immutable: true },
        quoteSpecificationVersion: { type: String, trim: true, default: "", immutable: true },
        payloadVersion: { type: String, trim: true, default: "", immutable: true },
        pricingVersion: { type: String, trim: true, default: "", immutable: true },
        promotionResolverVersion: { type: String, trim: true, default: "", immutable: true },
        issuedAt: { type: Date, required: true, immutable: true },
        expiresAt: { type: Date, required: true, immutable: true },
        integrityHash: { type: String, trim: true, default: "", immutable: true },
        integrityAlgorithm: { type: String, trim: true, default: "", immutable: true }
    },
    { _id: false }
);

const commerceOrderSchema = new mongoose.Schema(
    {
        schemaVersion: { type: String, trim: true, required: true, immutable: true },
        runtimeVersion: { type: String, trim: true, required: true, immutable: true },
        specificationVersion: { type: String, trim: true, default: "", immutable: true },
        orderId: { type: String, trim: true, required: true, immutable: true },
        quoteId: { type: String, trim: true, required: true, immutable: true },
        checkoutId: { type: String, trim: true, required: true, immutable: true },
        commerce: { type: commerceSchema, required: true, immutable: true },
        owner: {
            type: ownerSchema,
            required: true,
            immutable: true,
            validate: { validator: hasOwner, message: "CommerceOrder requires a valid owner binding." }
        },
        product: {
            type: productSchema,
            required: true,
            immutable: true,
            validate: { validator: hasPackageIdentity, message: "CommerceOrder requires package identity." }
        },
        fulfilment: { type: fulfilmentSchema, required: true },
        customer: { type: customerSchema, default: () => ({}) },
        commercial: { type: commercialSchema, required: true, immutable: true },
        pricing: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
        promotion: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
        payment: { type: paymentSchema, required: true },
        checkout: { type: checkoutSchema, required: true, immutable: true },
        quoteMetadata: { type: quoteMetadataSchema, required: true, immutable: true },
        quoteSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
        status: { type: String, enum: ORDER_STATUSES, default: "pending_payment" },
        paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "unpaid" },
        checkoutIdempotencyKeyHash: { type: String, trim: true, required: true, immutable: true },
        checkoutFingerprint: { type: String, trim: true, required: true, immutable: true },
        checkedOutAt: { type: Date, required: true, immutable: true },
        packageSnapshot: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
        commercialSnapshot: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
        promotionSnapshot: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
        promotionRedemptionSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
        createdAt: { type: Date, required: true, immutable: true },
        updatedAt: { type: Date, required: true },
        operationalReferences: { type: [mongoose.Schema.Types.Mixed], default: [] },
        statusHistory: { type: [mongoose.Schema.Types.Mixed], default: [] }
    },
    {
        strict: "throw",
        minimize: false,
        timestamps: false,
        collection: "commerceorders"
    }
);

commerceOrderSchema.pre("validate", function validateCommerceOrder() {
    if (this.commerce?.source !== "QUOTE_CHECKOUT") {
        this.invalidate("commerce.source", "CommerceOrder only supports quote checkout source.");
    }
    if (this.owner?.type === "USER" && !this.owner.userId) {
        this.invalidate("owner.userId", "USER owner requires userId.");
    }
    if (this.owner?.type === "SESSION" && (!this.owner.sessionId || this.owner.userId)) {
        this.invalidate("owner.sessionId", "SESSION owner requires sessionId and no userId.");
    }
    if (this.product?.quantity !== this.commercial?.quantity) {
        this.invalidate("commercial.quantity", "Commercial quantity must match product quantity.");
    }
    if (this.product?.region !== this.commercial?.region) {
        this.invalidate("commercial.region", "Commercial region must match product region.");
    }
    if (this.payment?.status !== this.paymentStatus) {
        this.invalidate("payment.status", "Nested and top-level payment status must match.");
    }
    if (this.fulfilment?.status && !FULFILMENT_STATUSES.includes(this.fulfilment.status)) {
        this.invalidate("fulfilment.status", "Invalid fulfilment status.");
    }
});

commerceOrderSchema.index({ orderId: 1 }, { unique: true });
commerceOrderSchema.index({ quoteId: 1 }, { unique: true });
commerceOrderSchema.index({ checkoutId: 1 }, { unique: true });
commerceOrderSchema.index({ "owner.type": 1, "owner.userId": 1, orderId: 1 });
commerceOrderSchema.index({ "owner.type": 1, "owner.sessionId": 1, orderId: 1 });
commerceOrderSchema.index({ "owner.type": 1, "owner.userId": 1, quoteId: 1 });
commerceOrderSchema.index({ "owner.type": 1, "owner.sessionId": 1, quoteId: 1 });
commerceOrderSchema.index(
    { "owner.type": 1, "owner.userId": 1, "checkout.idempotencyKeyHash": 1, "commerce.source": 1 },
    {
        unique: true,
        partialFilterExpression: {
            "owner.type": "USER",
            "owner.userId": { $exists: true, $gt: "" },
            "checkout.idempotencyKeyHash": { $exists: true, $gt: "" }
        }
    }
);
commerceOrderSchema.index(
    { "owner.type": 1, "owner.sessionId": 1, "checkout.idempotencyKeyHash": 1, "commerce.source": 1 },
    {
        unique: true,
        partialFilterExpression: {
            "owner.type": "SESSION",
            "owner.sessionId": { $exists: true, $gt: "" },
            "checkout.idempotencyKeyHash": { $exists: true, $gt: "" }
        }
    }
);
commerceOrderSchema.index({ status: 1, createdAt: -1, _id: -1 });
commerceOrderSchema.index({ paymentStatus: 1, createdAt: -1, _id: -1 });
commerceOrderSchema.index({ "fulfilment.status": 1, createdAt: -1, _id: -1 });
commerceOrderSchema.index({ "checkout.traceId": 1 }, { sparse: true });
commerceOrderSchema.index({ "commerce.source": 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("CommerceOrder", commerceOrderSchema);
module.exports.OWNER_TYPES = OWNER_TYPES;
module.exports.ORDER_STATUSES = ORDER_STATUSES;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
module.exports.FULFILMENT_STATUSES = FULFILMENT_STATUSES;
