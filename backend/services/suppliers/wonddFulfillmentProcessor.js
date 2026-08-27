const FulfillmentAttempt = require("../../models/FulfillmentAttempt");
const CommerceOrder = require("../../models/CommerceOrder");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const commerceOrderRepository = require("../commerce/orderRepository");
const wonddAdapter = require("./wonddAdapter");
const { normalizeSupplierResult } = require("../supplierAdapterRegistry");
const { CONFIRMED_SERVICE_CODES } = require("./wonddCatalogConfig");
const { buildWonddGameId, hasWonddGameIdFormatter } = require("./wonddGameIdFormatters");
const { providerGameCodeForProduct } = require("../commerce/canonicalGameInputContract");

const POLL_DELAYS_MS = Object.freeze([0, 5000, 10000, 20000, 30000, 60000]);

async function transitionCommerceOrder(order, target, reason) {
    let status = String(order.status || "");
    let fulfilment = String(order.fulfilment?.status || "not_started");
    if (["not_started", "queued"].includes(fulfilment)) {
        await commerceOrderRepository.updateFulfilmentStatus({ orderId: order.orderId, fromStatuses: [fulfilment], toStatus: "processing", changedAt: new Date(), reason });
        fulfilment = "processing";
    }
    if (status === "paid") {
        await commerceOrderRepository.updateOrderStatus({ orderId: order.orderId, fromStatuses: ["paid"], toStatus: "processing", changedAt: new Date(), reason });
        status = "processing";
    }
    if (target !== "processing") {
        await commerceOrderRepository.updateFulfilmentStatus({ orderId: order.orderId, fromStatuses: [fulfilment], toStatus: target, changedAt: new Date(), reason });
        await commerceOrderRepository.updateOrderStatus({ orderId: order.orderId, fromStatuses: [status], toStatus: target === "completed" ? "completed" : "failed", changedAt: new Date(), reason });
    }
}

function validateWonddMapping(mapping = {}) {
    if (!mapping || !mapping.enabled || String(mapping.supplierCode || "").toUpperCase() !== "WONDD") {
        const error = new Error("A verified WonDD package mapping is required.");
        error.code = "WONDD_PACKAGE_MAPPING_MISSING";
        throw error;
    }
    const productCode = providerGameCodeForProduct(mapping.productCode) || String(mapping.productCode || "").trim().toLowerCase();
    const expectedServiceCode = CONFIRMED_SERVICE_CODES[productCode];
    if (String(mapping.executionMode || "API").toUpperCase() !== "API" || !expectedServiceCode || String(mapping.supplierProductCode || "").trim().toLowerCase() !== expectedServiceCode.toLowerCase() || !String(mapping.supplierPackageCode || "").trim()) {
        const error = new Error("WonDD mapping must explicitly contain its confirmed servicecode and packcode.");
        error.code = "WONDD_PACKAGE_MAPPING_MISSING";
        throw error;
    }
    const readiness = mapping.mappingMetadata?.readiness || {};
    if (readiness.supplierMapped !== true || readiness.inputReady !== true || readiness.pricingReady !== true || readiness.fulfillmentReady !== true) {
        const error = new Error("WonDD package production readiness is incomplete.");
        error.code = "WONDD_PACKAGE_NOT_PRODUCTION_READY";
        throw error;
    }
    return mapping;
}

function createWonddFulfillmentProcessor(deps = {}) {
    const Attempt = deps.Attempt || FulfillmentAttempt;
    const Order = deps.Order || CommerceOrder;
    const Mapping = deps.Mapping || SupplierProductMapping;
    const adapter = deps.adapter || wonddAdapter;
    const transitionOrder = deps.transitionOrder || transitionCommerceOrder;
    const schedule = deps.schedule || ((fn, delay) => setTimeout(fn, delay));

    async function markTerminal(attempt, order, result) {
        attempt.supplierResult = normalizeSupplierResult(result);
        if (result.status === "SUCCEEDED") {
            attempt.status = "SUCCEEDED";
            attempt.completedAt = new Date();
            await attempt.save();
            await transitionOrder(order, "completed", `WonDD completed ${attempt.fulfillmentId}`);
        } else {
            attempt.status = "FAILED";
            attempt.failureCode = result.failureCode || result.providerStatus || "WONDD_FULFILLMENT_FAILED";
            attempt.failureReason = result.safeMessage || "WonDD fulfillment failed.";
            attempt.failedAt = new Date();
            await attempt.save();
            await transitionOrder(order, "failed", `WonDD failed ${attempt.fulfillmentId}`);
        }
    }

    async function poll(attemptId, index = 0) {
        const attempt = await Attempt.findById(attemptId);
        if (!attempt || attempt.status !== "IN_PROGRESS" || !attempt.supplierReference) return;
        const order = await Order.findById(attempt.orderId);
        if (!order) return;
        try {
            const result = await adapter.checkStatus({ orderId: attempt.supplierReference });
            attempt.supplierResult = normalizeSupplierResult(result);
            attempt.supplierRequest = { ...(attempt.supplierRequest || {}), pollCount: index + 1, lastPolledAt: new Date(), nextRecoveryAt: null };
            if (result.status === "SUCCEEDED" || result.status === "FAILED") return markTerminal(attempt, order, result);
            await attempt.save();
        } catch (error) {
            attempt.supplierResult = normalizeSupplierResult({ status: "PENDING", supplierCode: "WONDD", providerStatus: "STATUS_CHECK_ERROR", failureCode: error.code || "WONDD_STATUS_CHECK_ERROR", safeMessage: "WonDD status check requires retry." });
            await attempt.save();
        }
        if (index + 1 < POLL_DELAYS_MS.length) schedule(() => poll(attemptId, index + 1).catch(() => null), POLL_DELAYS_MS[index + 1]);
        else {
            attempt.supplierRequest = { ...(attempt.supplierRequest || {}), pollingState: "MANUAL_ATTENTION", nextRecoveryAt: new Date(Date.now() + 15 * 60 * 1000) };
            await attempt.save();
        }
    }

    async function submit(attemptId) {
        const attempt = await Attempt.findById(attemptId);
        if (!attempt || attempt.status !== "IN_PROGRESS" || attempt.supplierCodeSnapshot !== "WONDD") return null;
        if (attempt.supplierReference || ["SUBMISSION_IN_FLIGHT", "SUBMISSION_UNCERTAIN", "ACCEPTED"].includes(attempt.supplierRequest?.submissionState)) return attempt;
        const [order, mapping] = await Promise.all([Order.findById(attempt.orderId), Mapping.findById(attempt.supplierMappingId)]);
        if (!order) throw Object.assign(new Error("CommerceOrder not found."), { code: "ORDER_NOT_FOUND" });
        validateWonddMapping(mapping);
        const input = order.fulfilment?.input || {};
        const productCode = providerGameCodeForProduct(mapping.productCode) || String(mapping.productCode).toLowerCase();
        const serviceCode = CONFIRMED_SERVICE_CODES[productCode];
        const gameId = buildWonddGameId(productCode, input);
        attempt.supplierRequest = { ...(attempt.supplierRequest || {}), submissionState: "SUBMISSION_IN_FLIGHT", submissionStartedAt: new Date(), serviceCode, packCodeConfigured: true, playerInputValidated: true };
        await attempt.save();
        let result;
        try {
            result = await adapter.submitTopup({ productCode, serviceCode, packCode: mapping.supplierPackageCode, gameId, reference: attempt.fulfillmentId });
        } catch (error) {
            attempt.supplierRequest = { ...(attempt.supplierRequest || {}), submissionState: error.submissionUncertain ? "SUBMISSION_UNCERTAIN" : "SUBMISSION_BLOCKED" };
            attempt.supplierResult = normalizeSupplierResult({ status: "PENDING", supplierCode: "WONDD", providerStatus: error.submissionUncertain ? "SUBMISSION_UNCERTAIN" : "SUBMISSION_BLOCKED", failureCode: error.code || "WONDD_SUBMISSION_ERROR", safeMessage: error.submissionUncertain ? "Supplier acceptance is uncertain; do not resubmit automatically." : error.message });
            await attempt.save();
            return attempt;
        }
        if (result.status === "FAILED") return markTerminal(attempt, order, result);
        attempt.supplierReference = result.supplierReference;
        attempt.supplierResult = normalizeSupplierResult(result);
        attempt.supplierRequest = { ...(attempt.supplierRequest || {}), submissionState: "ACCEPTED", submittedAt: new Date(), providerResponseCode: result.rawMetadata?.responseCode || "00" };
        await attempt.save();
        schedule(() => poll(attempt._id, 0).catch(() => null), POLL_DELAYS_MS[0]);
        return attempt;
    }

    async function dryRunForOrder(orderId, mappingId) {
        const [order, mapping] = await Promise.all([Order.findById(orderId), Mapping.findById(mappingId)]);
        if (!order) throw Object.assign(new Error("CommerceOrder not found."), { code: "ORDER_NOT_FOUND" });
        validateWonddMapping(mapping);
        const input = order.fulfilment?.input || {};
        const productCode = providerGameCodeForProduct(mapping.productCode) || String(mapping.productCode).toLowerCase();
        return adapter.dryRunTopup({ productCode, serviceCode: CONFIRMED_SERVICE_CODES[productCode], packCode: mapping.supplierPackageCode, gameId: buildWonddGameId(productCode, input) });
    }

    async function dryRunForAttempt(attemptId) {
        const attempt = await Attempt.findById(attemptId);
        if (!attempt || attempt.supplierCodeSnapshot !== "WONDD") throw Object.assign(new Error("WonDD fulfillment attempt not found."), { code: "FULFILLMENT_NOT_FOUND" });
        return dryRunForOrder(attempt.orderId, attempt.supplierMappingId);
    }

    async function recoverDue() {
        const recoveryEnabled = typeof adapter.hasAnyAutoFulfillmentEnabled === "function"
            ? adapter.hasAnyAutoFulfillmentEnabled()
            : adapter.isAutoFulfillmentEnabled?.("mlbb") === true || adapter.isAutoFulfillmentEnabled?.("freefire") === true;
        if (!recoveryEnabled) return { recovered: 0, disabled: true };
        const attempts = await Attempt.find({ supplierCodeSnapshot: "WONDD", status: "IN_PROGRESS", supplierReference: { $ne: "" }, "supplierRequest.submissionState": "ACCEPTED", $or: [{ "supplierRequest.nextRecoveryAt": null }, { "supplierRequest.nextRecoveryAt": { $lte: new Date() } }] }).limit(50);
        attempts.forEach(item => schedule(() => poll(item._id, 0).catch(() => null), 0));
        return { recovered: attempts.length, disabled: false };
    }

    return { submit, poll, recoverDue, dryRunForOrder, dryRunForAttempt };
}

module.exports = { POLL_DELAYS_MS, validateWonddMapping, hasWonddGameIdFormatter, createWonddFulfillmentProcessor, processor: createWonddFulfillmentProcessor() };
