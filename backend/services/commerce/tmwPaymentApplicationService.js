"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const PaymentMethod = require("../../models/PaymentMethod");
const { findOwnedQuote } = require("./pricingQuoteRepository");
const { checkoutFromQuote } = require("./checkoutApplicationService");
const { validatePaymentCatalogEligibility } = require("./paymentCatalogEligibilityService");
const { reserveCommercePromotion, releaseCommercePromotion, consumeCommercePromotion } = require("./commercePromotionBridgeService");
const orderRepository = require("./orderRepository");
const paymentAttemptRepository = require("./paymentAttemptRepository");
const { createPaymentOrchestrator } = require("./paymentOrchestrator");
const { createTmwPromptPayAdapter, TMW_PROVIDER_ID, TMW_PAYMENT_METHOD } = require("./providers/tmwPromptPayAdapter");
const { ensurePaidOrderFulfillmentWork } = require("../paidFulfillmentRoutingService");
const { configurationFromEnvironment } = require("../tmwEasyApiClient");

class TmwPaymentApplicationError extends Error {
    constructor(code, message, statusCode = 400, options = {}) {
        super(message);
        this.name = "TmwPaymentApplicationError";
        this.code = code;
        this.statusCode = statusCode;
        this.retryable = options.retryable === true;
    }
}
const text = value => String(value == null ? "" : value).trim();
const upper = value => text(value).toUpperCase();
const publicId = prefix => `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;

function ownerFromContext(context = {}) {
    const userId = text(context.user?.id || context.user?._id || context.user?.userId);
    const sessionId = text(context.sessionId);
    if (userId) return { userId, sessionId: "" };
    if (sessionId) return { userId: "", sessionId };
    throw new TmwPaymentApplicationError("TMW_UNAUTHENTICATED", "Authenticated customer is required.", 401);
}
function repositoryOwner(owner) { return owner.userId ? { type: "USER", userId: owner.userId, sessionId: "" } : { type: "SESSION", userId: "", sessionId: owner.sessionId }; }
async function transactionRunner(callback) {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => { result = await callback({ mongoSession: session, session }); });
        return result;
    } finally { await session.endSession(); }
}

function createTmwPaymentApplicationService(dependencies = {}) {
    const env = dependencies.env || process.env;
    const configuration = dependencies.configuration || configurationFromEnvironment(env);
    const logger = dependencies.logger || console;
    const adapter = dependencies.adapter || createTmwPromptPayAdapter({ ...(dependencies.adapterOptions || {}), environment: env.NODE_ENV, logger });
    const orders = dependencies.orderRepository || orderRepository;
    const attempts = dependencies.paymentAttemptRepository || paymentAttemptRepository;
    const runTransaction = dependencies.transactionRunner || transactionRunner;

    async function settlePromotion(order) {
        const currentStatus = upper(order?.promotionRedemptionSnapshot?.status);
        if (currentStatus === "CONSUMED" || currentStatus === "USED") return { settled: true, idempotent: true };
        const snapshot = await (dependencies.consumeCommercePromotion || consumeCommercePromotion)(order);
        if (snapshot && typeof orders.setPromotionRedemptionSnapshot === "function") {
            await orders.setPromotionRedemptionSnapshot({ orderId: order.orderId, promotionRedemptionSnapshot: snapshot, changedAt: new Date() });
        }
        return { settled: true };
    }

    const orchestrator = dependencies.orchestrator || createPaymentOrchestrator({
        orderRepository: orders,
        paymentAttemptPort: attempts,
        providerResolver: async ({ intent }) => {
            if (text(intent?.provider) !== TMW_PROVIDER_ID) throw new TmwPaymentApplicationError("TMW_PROVIDER_MISMATCH", "TMW provider is not selected.", 422);
            return adapter;
        },
        transactionRunner: runTransaction,
        paidFulfillmentHandler: dependencies.paidFulfillmentHandler || ensurePaidOrderFulfillmentWork,
        paidFulfillmentFailureRecorder: dependencies.paidFulfillmentFailureRecorder || (async failure => {
            if (typeof orders.appendOperationalReference !== "function") return null;
            return orders.appendOperationalReference({
                orderId: failure.orderId,
                changedAt: failure.changedAt,
                reference: { type: "paid_fulfillment_start_failed", reason: failure.reason, errorCode: failure.errorCode }
            });
        }),
        paidSettlementHandler: settlePromotion,
        // Late EXPIRED -> PAID reconciliation remains disabled until the canonical
        // order repository supports the same terminal-state transition atomically.
        allowLatePaymentReconciliation: false,
        logger
    });

    async function loadMethod(region = "TH") {
        const method = await (dependencies.findPaymentMethod || (query => PaymentMethod.findOne(query).lean()))({ key: TMW_PAYMENT_METHOD, region, enabled: true });
        if (!method || text(method.paymentType).toLowerCase() !== "auto" || text(method.provider).toLowerCase() !== "tmw" || method.qrMode !== "provider_generated" || !["provider_webhook", "automatic_provider"].includes(text(method.confirmationMode))) {
            throw new TmwPaymentApplicationError("TMW_PAYMENT_METHOD_UNAVAILABLE", "TMW PromptPay is unavailable.", 422);
        }
        if (!configuration.ready) throw new TmwPaymentApplicationError("TMW_NOT_CONFIGURED", "TMW PromptPay is not ready.", 503);
        return method;
    }

    async function startCheckout(input = {}, context = {}) {
        const owner = ownerFromContext(context);
        const quoteId = text(input.reviewQuoteId);
        const seed = text(input.checkoutKey || input.orderId);
        if (!quoteId || !seed) throw new TmwPaymentApplicationError("TMW_INVALID_CHECKOUT", "Review quote and checkout identity are required.");
        const quote = await (dependencies.findOwnedQuote || findOwnedQuote)({ quoteId, ...owner });
        if (!quote) throw new TmwPaymentApplicationError("TMW_QUOTE_UNAVAILABLE", "Checkout quote is unavailable.", 409);
        const region = upper(quote.commercialSnapshot?.region);
        const currency = upper(quote.commercialSnapshot?.currency);
        const amount = Number(quote.commercialSnapshot?.quotedTotalAmount);
        if (region !== "TH" || currency !== "THB") throw new TmwPaymentApplicationError("TMW_UNSUPPORTED_CURRENCY", "TMW PromptPay supports Thailand THB checkout only.", 422);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new TmwPaymentApplicationError("TMW_INTEGER_THB_REQUIRED", "TMW PromptPay requires a positive whole-number THB total.", 422);
        const method = await loadMethod(region);
        let redemption = null;
        let checkoutResult = null;
        try {
            checkoutResult = await (dependencies.checkoutFromQuote || checkoutFromQuote)({
                quoteId,
                owner,
                idempotencyKey: `checkout:${seed}`,
                paymentSelection: { paymentMethodId: method.key, paymentChannel: "TMW_PROMPTPAY" },
                customerInput: { gameAccount: { userId: input.userId || "", zoneId: input.zoneId || "", accountFields: Array.isArray(input.accountFields) ? input.accountFields : [] }, customFields: { username: input.username || "", gameKey: input.gameKey || input.productCode || "" } },
                requestMetadata: { source: "customer-storefront", traceId: text(input.traceId) }
            }, {
                validateOperationalPackageState: args => (dependencies.validatePaymentCatalogEligibility || validatePaymentCatalogEligibility)(args, dependencies.catalogEligibilityDependencies || {}),
                validateFulfilmentInput: async ({ customerInput }) => ({ allowed: true, normalisedFulfilmentInput: customerInput }),
                validatePaymentMethod: async () => ({ allowed: true, paymentSnapshot: { paymentMethodId: method.key, paymentChannel: "TMW_PROMPTPAY", provider: TMW_PROVIDER_ID, providerType: "automatic", flowType: "automatic_provider", confirmationMode: "provider_webhook", nextAction: "OPEN_PROVIDER_QR", paymentMethodBound: true, metadata: { methodName: method.method, region, confirmationMode: "provider_webhook", qrMode: "provider_generated" } }, nextAction: "OPEN_PROVIDER_QR" }),
                validatePromotionRedemption: async ({ quote: lockedQuote, orderId }) => {
                    redemption = await (dependencies.reserveCommercePromotion || reserveCommercePromotion)({ order: { orderId, commercial: lockedQuote.commercialSnapshot, promotionSnapshot: lockedQuote.promotionSnapshot, couponSnapshot: lockedQuote.couponSnapshot, quoteSnapshot: lockedQuote }, user: context.user, expiresAt: lockedQuote.lifecycle?.expiresAt });
                    return { allowed: true, promotionRedemptionSnapshot: redemption };
                },
                generateOrderId: () => publicId("AZL"), generateCheckoutId: () => publicId("CHK"), getCheckoutTime: () => new Date(), ...dependencies.checkoutDependencies
            });
            const payment = await orchestrator.initiatePayment({ orderId: checkoutResult.checkout.orderId, owner, idempotencyKey: `tmw:${seed}`, clientIp: text(context.clientIp) });
            return { checkout: checkoutResult.checkout, payment, session: { commerce: true, commerceOrderId: checkoutResult.checkout.orderId, orderId: checkoutResult.checkout.orderId, quoteId, attemptId: payment.attemptId, reference: payment.attemptId, amount: payment.providerPayableAmount ?? payment.amount, commerceAmount: payment.amount, providerPayableAmountSatang: payment.providerPayableAmountSatang ?? null, providerPayableAmount: payment.providerPayableAmount ?? null, currency: payment.currency, region, paymentMethod: method.key, paymentName: method.method || "TMW PromptPay", paymentType: "auto", provider: "tmw", qrMode: "provider_generated", qrImage: payment.qr?.image || "", qrUrl: payment.qr?.image || "", dynamicQr: { qrImage: payment.qr?.image || "", expiresAt: payment.expiresAt || "" }, expiresAt: payment.expiresAt || "", confirmationMode: "provider_webhook", receiptUploadEnabled: false, slipRequired: false, autoVerificationSupported: true, webhookSupported: true } };
        } catch (error) {
            if (redemption && !checkoutResult?.checkout?.orderId) await (dependencies.releaseCommercePromotion || releaseCommercePromotion)({ orderId: redemption.orderId, promotionRedemptionSnapshot: redemption }).catch(() => null);
            if (error instanceof TmwPaymentApplicationError) throw error;
            throw new TmwPaymentApplicationError(error.code || "TMW_CHECKOUT_FAILED", error.message || "TMW checkout failed.", error.statusCode || error.httpStatus || 500, { retryable: error.retryable });
        }
    }

    async function refresh(input = {}, context = {}) {
        const owner = ownerFromContext(context);
        return orchestrator.refreshPayment({ attemptId: text(input.attemptId), owner });
    }
    async function getStatus(input = {}, context = {}) {
        const owner = ownerFromContext(context);
        return orchestrator.getPaymentResult({ attemptId: text(input.attemptId), owner });
    }

    return Object.freeze({ startCheckout, refresh, getStatus, orchestrator, adapter, configuration });
}

module.exports = Object.freeze({ createTmwPaymentApplicationService, TmwPaymentApplicationError, ownerFromContext, repositoryOwner });
