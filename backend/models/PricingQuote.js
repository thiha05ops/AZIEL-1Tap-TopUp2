const mongoose = require("mongoose");
const { CURRENCY, REGION } = require("../constants/commerce");

const QUOTE_STATUS = Object.freeze(["ISSUED", "USED", "EXPIRED", "INVALIDATED", "CANCELLED"]);
const TERMINAL_QUOTE_STATUS = Object.freeze(["USED", "EXPIRED", "INVALIDATED", "CANCELLED"]);

function finiteNonNegative(value) {
    return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function positiveInteger(value) {
    return Number.isInteger(Number(value)) && Number(value) > 0;
}

function hasOwner(owner = {}) {
    return Boolean(String(owner.userId || "").trim() || String(owner.sessionId || "").trim());
}

function hasPackageIdentity(snapshot = {}) {
    return Boolean(
        String(snapshot.packageId || "").trim() ||
        String(snapshot.packageCode || "").trim() ||
        String(snapshot.packageRef || "").trim()
    );
}

function expiresAfterIssued(lifecycle = {}) {
    if (!lifecycle.issuedAt || !lifecycle.expiresAt) return false;
    return new Date(lifecycle.expiresAt).getTime() > new Date(lifecycle.issuedAt).getTime();
}

const ownerSchema = new mongoose.Schema(
    {
        userId: { type: String, trim: true, default: "" },
        sessionId: { type: String, trim: true, default: "" }
    },
    { _id: false }
);

const packageSnapshotSchema = new mongoose.Schema(
    {
        packageId: { type: String, trim: true, default: "" },
        packageCode: { type: String, trim: true, default: "" },
        packageRef: { type: String, trim: true, default: "" },
        packageName: { type: String, trim: true, default: "" },
        gameId: { type: String, trim: true, default: "" },
        gameCode: { type: String, trim: true, default: "" },
        gameName: { type: String, trim: true, default: "" },
        categoryId: { type: String, trim: true, default: "" },
        categoryCode: { type: String, trim: true, default: "" },
        quantity: { type: Number, required: true, validate: positiveInteger }
    },
    { _id: false }
);

const commercialSnapshotSchema = new mongoose.Schema(
    {
        region: { type: String, enum: REGION, required: true },
        currency: { type: String, enum: CURRENCY, required: true },
        originalPrice: { type: Number, required: true, validate: finiteNonNegative },
        discountAmount: { type: Number, required: true, validate: finiteNonNegative },
        quotedUnitPrice: { type: Number, required: true, validate: finiteNonNegative },
        quantity: { type: Number, required: true, validate: positiveInteger },
        quotedTotalAmount: { type: Number, required: true, validate: finiteNonNegative },
        promotionAppliesTo: { type: String, trim: true, default: "UNIT_PRICE" }
    },
    { _id: false }
);

const lifecycleSchema = new mongoose.Schema(
    {
        issuedAt: { type: Date, required: true },
        expiresAt: { type: Date, required: true },
        status: { type: String, enum: QUOTE_STATUS, default: "ISSUED", required: true },
        usedAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        invalidatedAt: { type: Date, default: null },
        expiredAt: { type: Date, default: null }
    },
    { _id: false }
);

const integrityMetadataSchema = new mongoose.Schema(
    {
        algorithm: { type: String, trim: true, default: "" },
        keyId: { type: String, trim: true, default: "" },
        canonicalHash: { type: String, default: null },
        signature: { type: String, default: null }
    },
    { _id: false }
);

const pricingQuoteSchema = new mongoose.Schema(
    {
        quoteId: { type: String, required: true, trim: true, immutable: true },
        status: { type: String, enum: QUOTE_STATUS, default: "ISSUED", required: true },
        quoteRuntimeVersion: { type: String, required: true, trim: true, immutable: true },
        quoteSpecificationVersion: { type: String, required: true, trim: true, immutable: true },
        payloadVersion: { type: String, required: true, trim: true, immutable: true },
        owner: {
            type: ownerSchema,
            required: true,
            immutable: true,
            validate: { validator: hasOwner, message: "PricingQuote requires userId or sessionId ownership." }
        },
        packageSnapshot: {
            type: packageSnapshotSchema,
            required: true,
            immutable: true,
            validate: { validator: hasPackageIdentity, message: "PricingQuote requires a stable package identity." }
        },
        commercialSnapshot: { type: commercialSnapshotSchema, required: true, immutable: true },
        pricingSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
        promotionSnapshot: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
        lifecycle: {
            type: lifecycleSchema,
            required: true,
            validate: { validator: expiresAfterIssued, message: "PricingQuote expiresAt must be later than issuedAt." }
        },
        integrityPayload: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
        integrityMetadata: { type: integrityMetadataSchema, default: () => ({}), immutable: true },
        trace: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
        warnings: { type: [mongoose.Schema.Types.Mixed], default: [], immutable: true },
        idempotencyKey: { type: String, trim: true, default: "" },
        createdBySource: { type: String, trim: true, default: "pricing-quote-runtime" },
        consumedOrderId: { type: String, trim: true, default: "" },
        invalidationReason: { type: String, trim: true, default: "" },
        cleanupAt: { type: Date, default: null }
    },
    {
        timestamps: true,
        strict: "throw",
        minimize: false
    }
);

pricingQuoteSchema.pre("validate", function validateQuoteLifecycle() {
    if (this.status !== this.lifecycle?.status) {
        this.invalidate("lifecycle.status", "Top-level status and lifecycle status must match.");
    }
    if (this.status !== "ISSUED" && !TERMINAL_QUOTE_STATUS.includes(this.status)) {
        this.invalidate("status", "Unsupported quote status.");
    }
    if (this.commercialSnapshot?.quantity !== this.packageSnapshot?.quantity) {
        this.invalidate("commercialSnapshot.quantity", "Commercial quantity must match package quantity.");
    }
    if (!this.integrityPayload?.canonicalCommercialData || !this.integrityPayload?.canonicalSerialized) {
        this.invalidate("integrityPayload", "PricingQuote requires canonical integrity payload data.");
    }
});

pricingQuoteSchema.index({ quoteId: 1 }, { unique: true });
pricingQuoteSchema.index({ "owner.userId": 1, status: 1 });
pricingQuoteSchema.index({ "owner.sessionId": 1, status: 1 });
pricingQuoteSchema.index({ "lifecycle.expiresAt": 1, status: 1 });
pricingQuoteSchema.index({ consumedOrderId: 1 }, { sparse: true });
pricingQuoteSchema.index({ "trace.traceId": 1 }, { sparse: true });
pricingQuoteSchema.index(
    { "owner.userId": 1, idempotencyKey: 1 },
    {
        unique: true,
        partialFilterExpression: {
            "owner.userId": { $exists: true, $gt: "" },
            idempotencyKey: { $exists: true, $gt: "" }
        }
    }
);
pricingQuoteSchema.index(
    { "owner.sessionId": 1, idempotencyKey: 1 },
    {
        unique: true,
        partialFilterExpression: {
            "owner.sessionId": { $exists: true, $gt: "" },
            idempotencyKey: { $exists: true, $gt: "" }
        }
    }
);
pricingQuoteSchema.index({ cleanupAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { cleanupAt: { $type: "date" } } });

module.exports = mongoose.model("PricingQuote", pricingQuoteSchema);
module.exports.QUOTE_STATUS = QUOTE_STATUS;
module.exports.TERMINAL_QUOTE_STATUS = TERMINAL_QUOTE_STATUS;
