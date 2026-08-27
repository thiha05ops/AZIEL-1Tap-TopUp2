const crypto = require("crypto");
const CommerceOrder = require("../models/CommerceOrder");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { FULFILLMENT_ROUTE_TYPES, FULFILLMENT_STATUSES } = require("../models/FulfillmentAttempt");
const { loadFulfillmentCapability } = require("./fulfillmentCapabilityService");

function fulfillmentIdentity(order = {}) {
    return {
        orderId: order._id,
        orderCode: String(order.orderId || "").trim(),
        orderModel: order.commerce?.source === "QUOTE_CHECKOUT" || order.schemaVersion ? "CommerceOrder" : "Order",
        productCode: String(order.product?.gameCode || order.productCode || order.game || "").trim().toLowerCase(),
        packageCode: String(order.product?.packageCode || order.packageCode || "").trim().toUpperCase(),
        region: String(order.commercial?.region || order.product?.region || order.region || "").trim().toUpperCase()
    };
}

function manualAdminIdempotencyKey(orderCode = "") {
    return `fulfillment:manual-admin:${String(orderCode || "").trim()}`;
}

function supplierApiIdempotencyKey(orderCode = "", mappingId = "") {
    return `fulfillment:start:${String(orderCode || "").trim()}:${String(mappingId || "").trim()}`;
}

function makeFulfillmentId() {
    return `FUL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function ensurePaidOrderFulfillmentWork(order = {}, options = {}) {
    const identity = fulfillmentIdentity(order);
    if (!identity.orderId || !identity.orderCode || !identity.productCode || !identity.packageCode || !identity.region) {
        return { created: false, reason: "INCOMPLETE_ORDER_IDENTITY", attempt: null };
    }
    const paymentStatus = String(order.paymentStatus || order.payment?.status || "").toLowerCase();
    if (paymentStatus !== "paid") return { created: false, reason: "ORDER_NOT_PAID", attempt: null };

    const routeSnapshot = order.fulfilment?.routeSnapshot || null;
    let capability = null;
    if (routeSnapshot) {
        if (routeSnapshot.productCode !== identity.productCode || routeSnapshot.packageCode !== identity.packageCode || routeSnapshot.region !== identity.region) return { created: false, reason: "ORDER_ROUTE_SNAPSHOT_MISMATCH", attempt: null };
        if (routeSnapshot.routeType === FULFILLMENT_ROUTE_TYPES.SUPPLIER_API) {
            const mappingId = String(routeSnapshot.supplierMappingId || "").trim();
            if (!mappingId) return { created: false, reason: "SUPPLIER_ROUTE_MAPPING_MISSING", attempt: null, routeSnapshot };
            if (String(order.status || "").toLowerCase() !== "paid") return { created: false, reason: "ORDER_LIFECYCLE_NOT_PAID", attempt: null, routeSnapshot };
            const idempotencyKey = supplierApiIdempotencyKey(identity.orderCode, mappingId);
            const findAttempt = options.findAttemptByIdempotency || (async key => FulfillmentAttempt.findOne({ idempotencyKey: key }).lean());
            const existing = await findAttempt(idempotencyKey);
            if (existing) return { created: false, reason: "SUPPLIER_FULFILLMENT_ALREADY_BOUND", attempt: existing, routeSnapshot };
            const startSupplierFulfillment = options.startSupplierFulfillment || ((orderCode, payload, context) => require("./fulfillmentService").startFulfillmentForOrder(orderCode, payload, context));
            try {
                const attempt = await startSupplierFulfillment(identity.orderCode, {
                    mappingId,
                    supplierMappingId: mappingId,
                    idempotencyKey
                }, { source: "paid_order_automatic_fulfillment" });
                return { created: true, reason: "SUPPLIER_FULFILLMENT_STARTED", attempt, routeSnapshot };
            } catch (error) {
                const racedAttempt = await findAttempt(idempotencyKey).catch(() => null);
                if (racedAttempt) return { created: false, reason: "SUPPLIER_FULFILLMENT_ALREADY_BOUND", attempt: racedAttempt, routeSnapshot };
                return { created: false, reason: "SUPPLIER_FULFILLMENT_START_FAILED", attempt: null, routeSnapshot, errorCode: error?.code || error?.name || "SUPPLIER_FULFILLMENT_START_FAILED" };
            }
        }
        if (routeSnapshot.routeType !== FULFILLMENT_ROUTE_TYPES.MANUAL_ADMIN) return { created: false, reason: "SUPPLIER_ROUTE_SNAPSHOT_BOUND", attempt: null, routeSnapshot };
    } else {
        capability = await (options.loadCapability || loadFulfillmentCapability)({
            productCode: identity.productCode,
            packageCode: identity.packageCode,
            region: identity.region,
            session: options.session || null
        });
        if (capability.automatedAvailable) return { created: false, reason: "AUTOMATED_ROUTE_AVAILABLE", attempt: null, capability };
        if (!capability.manualAdminAllowed) return { created: false, reason: "MANUAL_ADMIN_NOT_ALLOWED", attempt: null, capability };
    }

    const idempotencyKey = manualAdminIdempotencyKey(identity.orderCode);
    const queryOptions = { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, runValidators: true };
    if (options.session) queryOptions.session = options.session;
    const attemptModel = options.attemptModel || FulfillmentAttempt;
    const commerceOrderModel = options.commerceOrderModel || CommerceOrder;
    const attempt = await attemptModel.findOneAndUpdate(
        { idempotencyKey },
        { $setOnInsert: {
            fulfillmentId: makeFulfillmentId(),
            orderId: identity.orderId,
            orderCode: identity.orderCode,
            orderModel: identity.orderModel,
            supplierId: null,
            supplierCodeSnapshot: "AZIEL_ADMIN",
            supplierMappingId: null,
            productCode: identity.productCode,
            packageCode: identity.packageCode,
            region: identity.region,
            mode: "MANUAL",
            routeType: FULFILLMENT_ROUTE_TYPES.MANUAL_ADMIN,
            status: FULFILLMENT_STATUSES.PENDING,
            idempotencyKey,
            supplierRequest: { executionMode: FULFILLMENT_ROUTE_TYPES.MANUAL_ADMIN },
            supplierResult: {
                status: "PENDING",
                supplierCode: "AZIEL_ADMIN",
                providerStatus: "MANUAL_ADMIN_QUEUED",
                safeMessage: "Manual fulfillment is queued for AZIEL Admin."
            }
        } },
        queryOptions
    );

    if (identity.orderModel === "CommerceOrder") {
        const updateOptions = options.session ? { session: options.session } : {};
        await commerceOrderModel.updateOne(
            { _id: identity.orderId, "fulfilment.status": "not_started" },
            {
                $set: { "fulfilment.status": "queued", updatedAt: new Date() },
                $addToSet: { operationalReferences: { type: "FULFILLMENT_ATTEMPT", id: attempt.fulfillmentId, routeType: FULFILLMENT_ROUTE_TYPES.MANUAL_ADMIN } }
            },
            updateOptions
        );
    }
    return { created: true, reason: "MANUAL_ADMIN_QUEUED", attempt, capability, routeSnapshot };
}

module.exports = {
    ensurePaidOrderFulfillmentWork,
    fulfillmentIdentity,
    manualAdminIdempotencyKey,
    supplierApiIdempotencyKey
};
