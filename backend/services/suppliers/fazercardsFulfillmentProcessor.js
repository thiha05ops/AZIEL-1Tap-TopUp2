const FulfillmentAttempt = require("../../models/FulfillmentAttempt");
const CommerceOrder = require("../../models/CommerceOrder");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const SupplierCatalogOffer = require("../../models/SupplierCatalogOffer");
const SupplierCatalogProduct = require("../../models/SupplierCatalogProduct");
const commerceOrderRepository = require("../commerce/orderRepository");
const adapterDefault = require("./fazercardsAdapter");
const { normalizeSupplierResult } = require("../supplierAdapterRegistry");
const { classifySupplierFailure } = require("../supplierFailureClassificationService");
const { buildFazerCardsFields, maskFazerCardsFields } = require("./fazercardsInputFormatters");
const { buildFieldsFromContract, verifiedMappingContract, mappingContractMatchesSupplierCatalog } = require("./fazercardsFulfillmentContractService");
const { isCustomerMarketCompatible } = require("../supplierFulfillmentEligibilityService");

const POLL_DELAYS_MS = Object.freeze([0, 5000, 10000, 20000, 30000, 60000]);
const SUPPORTED_PRODUCT_CATEGORIES = Object.freeze({ pubg: "pubg_mobile_auto", mlbb: "mobile_legends_global", freefire: "free_fire_th", hok: "honor_of_kings", valorant: "valorant_th" });

function supportsFazerCardsMapping(mapping = {}) {
    return Boolean(verifiedMappingContract(mapping)) || SUPPORTED_PRODUCT_CATEGORIES[String(mapping.productCode || "").trim().toLowerCase()] === String(mapping.supplierProductCode || "").trim();
}

function validateFazerCardsMapping(mapping = {}, { customerMarket = "" } = {}) {
    const readiness = mapping.mappingMetadata?.readiness || {};
    const legacyMarket = ["TH", "MM"].includes(String(mapping.region || "").trim().toUpperCase()) ? mapping.region : "";
    const market = String(customerMarket || legacyMarket).trim().toUpperCase();
    if (!mapping.enabled || mapping.supplierCode !== "FAZERCARDS" || mapping.executionMode !== "API" || !supportsFazerCardsMapping(mapping) || !String(mapping.supplierPackageCode || "").trim()) throw Object.assign(new Error("An exact supported FazerCards mapping is required."), { code: "FAZERCARDS_PACKAGE_MAPPING_MISSING" });
    if (!market || !isCustomerMarketCompatible(mapping, market)) throw Object.assign(new Error("FazerCards supplier market is not compatible with the customer market."), { code: "FAZERCARDS_CUSTOMER_MARKET_NOT_ELIGIBLE" });
    if (readiness.supplierMapped !== true || readiness.inputReady !== true || readiness.pricingReady !== true || readiness.fulfillmentReady !== true) throw Object.assign(new Error("FazerCards package production readiness is incomplete."), { code: "FAZERCARDS_PACKAGE_NOT_PRODUCTION_READY" });
    return mapping;
}

async function transitionOrder(order, target, reason) {
    let orderStatus = String(order.status || "");
    let fulfillmentStatus = String(order.fulfilment?.status || "not_started");
    if (["not_started", "queued"].includes(fulfillmentStatus)) {
        await commerceOrderRepository.updateFulfilmentStatus({ orderId: order.orderId, fromStatuses: [fulfillmentStatus], toStatus: "processing", changedAt: new Date(), reason });
        fulfillmentStatus = "processing";
    }
    if (orderStatus === "paid") {
        await commerceOrderRepository.updateOrderStatus({ orderId: order.orderId, fromStatuses: ["paid"], toStatus: "processing", changedAt: new Date(), reason });
        orderStatus = "processing";
    }
    if (target === "completed") {
        await commerceOrderRepository.updateFulfilmentStatus({ orderId: order.orderId, fromStatuses: [fulfillmentStatus], toStatus: "completed", changedAt: new Date(), reason });
        await commerceOrderRepository.updateOrderStatus({ orderId: order.orderId, fromStatuses: [orderStatus], toStatus: "completed", changedAt: new Date(), reason });
    } else if (target === "failed") {
        await commerceOrderRepository.updateFulfilmentStatus({ orderId: order.orderId, fromStatuses: [fulfillmentStatus], toStatus: "failed", changedAt: new Date(), reason });
        await commerceOrderRepository.updateOrderStatus({ orderId: order.orderId, fromStatuses: [orderStatus], toStatus: "failed", changedAt: new Date(), reason });
    }
}

function createFazerCardsFulfillmentProcessor(deps = {}) {
    const Attempt = deps.Attempt || FulfillmentAttempt;
    const Order = deps.Order || CommerceOrder;
    const Mapping = deps.Mapping || SupplierProductMapping;
    const CatalogOffer = deps.CatalogOffer || SupplierCatalogOffer;
    const CatalogProduct = deps.CatalogProduct || SupplierCatalogProduct;
    const adapter = deps.adapter || adapterDefault;
    const transition = deps.transitionOrder || transitionOrder;
    const schedule = deps.schedule || ((fn, delay) => setTimeout(fn, delay));

    async function reconcile(attempt, order, result) {
        attempt.supplierResult = normalizeSupplierResult(result);
        if (result.supplierReference && !attempt.supplierReference) attempt.supplierReference = result.supplierReference;
        if (result.status === "SUCCEEDED") {
            attempt.status = "SUCCEEDED"; attempt.completedAt = new Date(); await attempt.save();
            await transition(order, "completed", `FazerCards completed ${attempt.fulfillmentId}`);
        } else if (result.status === "FAILED") {
            attempt.status = "FAILED"; attempt.failureCode = result.failureCode || result.providerStatus; attempt.failureReason = result.safeMessage; attempt.normalizedFailureCategory = classifySupplierFailure(result).category; attempt.failedAt = new Date(); await attempt.save();
            await transition(order, "failed", `FazerCards ${result.providerStatus} ${attempt.fulfillmentId}`);
        } else {
            attempt.supplierRequest = { ...(attempt.supplierRequest || {}), manualAttention: result.providerStatus === "UNKNOWN_PROVIDER_STATUS", lastReconciledAt: new Date() };
            await attempt.save();
        }
        return attempt;
    }

    async function poll(attemptId, index = 0) {
        const attempt = await Attempt.findById(attemptId);
        if (!attempt || attempt.status !== "IN_PROGRESS" || !attempt.supplierReference) return null;
        const order = await Order.findById(attempt.orderId);
        if (!order) return null;
        let result;
        try { result = await adapter.checkStatus({ orderId: attempt.supplierReference }); }
        catch (error) { result = { status: "PENDING", supplierCode: "FAZERCARDS", supplierReference: attempt.supplierReference, providerStatus: "STATUS_CHECK_ERROR", failureCode: error.code, safeMessage: "FazerCards status check requires retry.", rawMetadata: { retryable: error.retryable } }; }
        await reconcile(attempt, order, result);
        if (attempt.status === "IN_PROGRESS" && index + 1 < POLL_DELAYS_MS.length) schedule(() => poll(attemptId, index + 1).catch(() => null), POLL_DELAYS_MS[index + 1]);
        else if (attempt.status === "IN_PROGRESS") { attempt.supplierRequest = { ...(attempt.supplierRequest || {}), pollingState: "MANUAL_ATTENTION", nextRecoveryAt: new Date(Date.now() + 15 * 60 * 1000) }; await attempt.save(); }
        return attempt;
    }

    async function submit(attemptId) {
        const attempt = await Attempt.findById(attemptId);
        if (!attempt || attempt.status !== "IN_PROGRESS" || attempt.supplierCodeSnapshot !== "FAZERCARDS") return null;
        if (attempt.supplierReference || ["SUBMISSION_IN_FLIGHT", "SUBMISSION_UNCERTAIN", "ACCEPTED"].includes(attempt.supplierRequest?.submissionState)) return attempt;
        const [order, mapping] = await Promise.all([Order.findById(attempt.orderId), Mapping.findById(attempt.supplierMappingId)]);
        if (!order) throw Object.assign(new Error("CommerceOrder not found."), { code: "ORDER_NOT_FOUND" });
        const customerMarket = String(order.commercial?.region || order.product?.region || order.region || "").trim().toUpperCase();
        validateFazerCardsMapping(mapping, { customerMarket });
        const contract = verifiedMappingContract(mapping);
        if (contract) {
            const offer = await CatalogOffer.findById(mapping.supplierCatalogOfferId).lean();
            const supplierProduct = offer ? await CatalogProduct.findById(offer.supplierCatalogProductId).lean() : null;
            if (!offer || !supplierProduct || String(offer.catalogLifecycleState || "").toUpperCase() !== "ACTIVE" || !mappingContractMatchesSupplierCatalog(mapping, supplierProduct)) throw Object.assign(new Error("FazerCards supplier input contract changed and requires Owner re-review."), { code: "FAZERCARDS_INPUT_CONTRACT_STALE" });
        }
        const fields = contract
            ? buildFieldsFromContract(contract, order.fulfilment?.input || {})
            : buildFazerCardsFields(mapping.productCode, order.fulfilment?.input || {});
        attempt.supplierRequest = { ...(attempt.supplierRequest || {}), submissionState: "SUBMISSION_IN_FLIGHT", submissionStartedAt: new Date(), categoryId: mapping.supplierProductCode, offerId: mapping.supplierPackageCode, fields: maskFazerCardsFields(fields), providerIdempotencyKey: attempt.idempotencyKey };
        await attempt.save();
        let result;
        try { result = await adapter.submitTopup({ categoryId: mapping.supplierProductCode, offerId: mapping.supplierPackageCode, fields, idempotencyKey: attempt.idempotencyKey, productCode: mapping.productCode }); }
        catch (error) {
            attempt.supplierRequest = { ...(attempt.supplierRequest || {}), submissionState: error.submissionUncertain ? "SUBMISSION_UNCERTAIN" : "SUBMISSION_BLOCKED" };
            attempt.supplierResult = normalizeSupplierResult({ status: "PENDING", supplierCode: "FAZERCARDS", providerStatus: error.submissionUncertain ? "SUBMISSION_UNCERTAIN" : "SUBMISSION_BLOCKED", failureCode: error.code, safeMessage: error.submissionUncertain ? "Provider outcome is uncertain; retry only with the same idempotency key." : error.message });
            await attempt.save(); return attempt;
        }
        if (result.supplierReference) { attempt.supplierReference = result.supplierReference; attempt.supplierResult = normalizeSupplierResult(result); attempt.supplierRequest = { ...(attempt.supplierRequest || {}), submissionState: "ACCEPTED", submittedAt: new Date() }; await attempt.save(); }
        await reconcile(attempt, order, result);
        if (attempt.status === "IN_PROGRESS" && attempt.supplierReference) schedule(() => poll(attempt._id, 0).catch(() => null), 0);
        return attempt;
    }

    async function reconcileProviderStatus(orderId, result) {
        const attempt = await Attempt.findOne({ supplierCodeSnapshot: "FAZERCARDS", supplierReference: String(orderId), status: "IN_PROGRESS" });
        if (!attempt) return null;
        const order = await Order.findById(attempt.orderId);
        return order ? reconcile(attempt, order, result) : null;
    }

    async function recoverDue() {
        if (!adapter.isAnyAutoFulfillmentEnabled?.() && !Object.keys(SUPPORTED_PRODUCT_CATEGORIES).some(product => adapter.isAutoFulfillmentEnabled(product))) return { recovered: 0, disabled: true };
        const attempts = await Attempt.find({ supplierCodeSnapshot: "FAZERCARDS", status: "IN_PROGRESS", supplierReference: { $ne: "" }, $or: [{ "supplierRequest.nextRecoveryAt": null }, { "supplierRequest.nextRecoveryAt": { $lte: new Date() } }] }).limit(50);
        attempts.forEach(item => schedule(() => poll(item._id, 0).catch(() => null), 0));
        return { recovered: attempts.length, disabled: false };
    }

    return { submit, poll, reconcileProviderStatus, recoverDue };
}

module.exports = { POLL_DELAYS_MS, SUPPORTED_PRODUCT_CATEGORIES, supportsFazerCardsMapping, validateFazerCardsMapping, createFazerCardsFulfillmentProcessor, processor: createFazerCardsFulfillmentProcessor() };
