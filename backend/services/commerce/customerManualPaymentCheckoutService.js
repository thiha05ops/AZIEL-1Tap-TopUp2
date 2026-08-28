"use strict";

const crypto = require("crypto");
const PaymentMethod = require("../../models/PaymentMethod");
const { paymentMethodCapabilityState } = require("../paymentProviderRegistry");
const { findOwnedQuote } = require("./pricingQuoteRepository");
const { checkoutFromQuote } = require("./checkoutApplicationService");
const { resolveCheckoutRouteSnapshot } = require("../supplierProductionSelectionService");
const { reserveCommercePromotion, releaseCommercePromotion } = require("./commercePromotionBridgeService");
const orderRepository = require("./orderRepository");
const { createManualPaymentApplicationService } = require("./manualPaymentApplicationService");

const ERROR_CODES = Object.freeze({ INVALID_INPUT: "INVALID_INPUT", QUOTE_UNAVAILABLE: "QUOTE_UNAVAILABLE", PAYMENT_METHOD_UNAVAILABLE: "PAYMENT_METHOD_UNAVAILABLE", MANUAL_CHECKOUT_FAILED: "MANUAL_CHECKOUT_FAILED" });
class CustomerManualPaymentCheckoutError extends Error { constructor(code, message, statusCode = 400) { super(message); this.name = "CustomerManualPaymentCheckoutError"; this.code = code; this.statusCode = statusCode; } }
const text = value => String(value || "").trim();
const lower = value => text(value).toLowerCase();
const upper = value => text(value).toUpperCase();
const publicId = prefix => `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
function ownerFromContext(context = {}) { const userId = text(context.user?.id || context.user?._id || context.user?.userId); const sessionId = text(context.sessionId); if (userId) return { userId, sessionId: "" }; if (sessionId) return { userId: "", sessionId }; throw new CustomerManualPaymentCheckoutError(ERROR_CODES.INVALID_INPUT, "Authenticated customer is required.", 401); }
function repositoryOwner(owner) { return owner.userId ? { type: "USER", userId: owner.userId } : { type: "SESSION", sessionId: owner.sessionId }; }

async function loadManualPaymentMethod({ key, region }, dependencies = {}) {
    const methodKey = lower(key), market = upper(region);
    if (!methodKey || !market) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "Selected payment method is unavailable.", 422);
    const load = dependencies.findPaymentMethods || (query => PaymentMethod.find(query).lean());
    const matches = await load({ key: methodKey, region: market });
    if (!Array.isArray(matches) || matches.length !== 1) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "Selected payment method is unavailable.", 422);
    const method = matches[0], type = lower(method.paymentType);
    if (method.enabled !== true || !["manual", "deeplink"].includes(type) || method.confirmationMode !== "manual_admin" || paymentMethodCapabilityState(method).customerVisible !== true) {
        throw new CustomerManualPaymentCheckoutError(ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "Selected payment method is unavailable.", 422);
    }
    if (market === "TH" && methodKey === "promptpay") throw new CustomerManualPaymentCheckoutError(ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "Use the dedicated PromptPay checkout.", 422);
    return method;
}

function sessionFrom({ checkout, payment, method }) {
    const instructions = payment.paymentInstructions || {};
    return {
        commerce: true, commerceOrderId: checkout.orderId, orderId: checkout.orderId, quoteId: checkout.quoteId, attemptId: payment.attemptId,
        reference: instructions.reference || payment.providerReference || payment.attemptId, amount: payment.amount, currency: payment.currency, region: checkout.region || method.region,
        productName: checkout.productName || checkout.product?.gameName || "", packageName: checkout.packageName || checkout.product?.packageName || "",
        paymentName: instructions.title || method.method, paymentMethod: method.key, paymentType: method.paymentType, provider: "MANUAL_ADMIN",
        accountName: instructions.accountName || "", accountNumber: instructions.accountNumber || "", qrImage: payment.qr?.image || "", qrUrl: payment.qr?.image || "", qrMode: payment.qr?.mode || method.qrMode || "none",
        receiptUploadEnabled: instructions.receiptUploadEnabled !== false, slipRequired: instructions.slipRequired !== false,
        enableOpenApp: instructions.enableOpenApp === true, openAppMode: instructions.openAppMode || "disabled", deepLinkUrl: instructions.deepLinkUrl || "", appDisplayName: instructions.appDisplayName || "", expiresAt: payment.expiresAt || ""
    };
}

async function startCustomerManualPaymentCheckout(input = {}, context = {}, dependencies = {}) {
    const owner = ownerFromContext(context), quoteId = text(input.reviewQuoteId), methodKey = lower(input.paymentMethod || input.methodCode), seed = text(input.checkoutKey || input.orderId);
    if (!quoteId || !methodKey || !seed) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.INVALID_INPUT, "Review quote, payment method, and checkout identity are required.");
    const quote = await (dependencies.findOwnedQuote || findOwnedQuote)({ quoteId, ...owner });
    if (!quote) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.QUOTE_UNAVAILABLE, "Checkout quote is unavailable.", 409);
    const region = upper(quote.commercialSnapshot?.region);
    if (!region) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.QUOTE_UNAVAILABLE, "Checkout quote market is unavailable.", 409);
    const method = await loadManualPaymentMethod({ key: methodKey, region }, dependencies);
    let redemption = null, checkoutResult = null;
    try {
        checkoutResult = await (dependencies.checkoutFromQuote || checkoutFromQuote)({
            quoteId, owner, idempotencyKey: `checkout:${seed}`,
            paymentSelection: { paymentMethodId: method.key, paymentChannel: "MANUAL_ADMIN" },
            customerInput: { gameAccount: { userId: input.userId || "", zoneId: input.zoneId || "", accountFields: Array.isArray(input.accountFields) ? input.accountFields : [] }, customFields: { username: input.username || "", gameKey: input.gameKey || input.productCode || "" } },
            requestMetadata: { source: "customer-storefront" }
        }, {
            validateOperationalPackageState: async ({ quote: lockedQuote }) => { const route = await (dependencies.resolveCheckoutRouteSnapshot || resolveCheckoutRouteSnapshot)({ productCode: lockedQuote.packageSnapshot?.gameCode, packageCode: lockedQuote.packageSnapshot?.packageCode, region: lockedQuote.commercialSnapshot?.region }); return route.ready ? { allowed: true, supplierRouteSnapshot: route.routeSnapshot } : { allowed: false, reasonCode: route.blockers?.[0] || "PRIMARY_SUPPLIER_NOT_READY" }; },
            validateFulfilmentInput: async ({ customerInput }) => ({ allowed: true, normalisedFulfilmentInput: customerInput }),
            validatePaymentMethod: async () => ({ allowed: true, paymentSnapshot: { paymentMethodId: method.key, paymentChannel: "MANUAL_ADMIN", provider: "MANUAL_ADMIN", providerType: "manual", flowType: "manual_admin", confirmationMode: "manual_admin", nextAction: "OPEN_MANUAL_PAYMENT", paymentMethodBound: true, metadata: { methodName: method.method, region: method.region } }, nextAction: "OPEN_MANUAL_PAYMENT" }),
            validatePromotionRedemption: async ({ quote: lockedQuote, orderId }) => { redemption = await (dependencies.reserveCommercePromotion || reserveCommercePromotion)({ order: { orderId, commercial: lockedQuote.commercialSnapshot, promotionSnapshot: lockedQuote.promotionSnapshot }, user: context.user, expiresAt: lockedQuote.lifecycle?.expiresAt }); return { allowed: true, promotionRedemptionSnapshot: redemption }; },
            generateOrderId: () => publicId("AZL"), generateCheckoutId: () => publicId("CHK"), getCheckoutTime: () => new Date(), ...dependencies.checkoutDependencies
        });
        const manualService = dependencies.manualPaymentService || createManualPaymentApplicationService(dependencies.manualPaymentOptions || {});
        let payment = await manualService.initiateManualPayment({ orderId: checkoutResult.checkout.orderId, owner, idempotencyKey: `manual:${seed}` });
        if (payment?.retryEligible && manualService.resumeOrRetryManualPayment) payment = await manualService.resumeOrRetryManualPayment({ orderId: checkoutResult.checkout.orderId, owner, traceId: `retry:${seed}` });
        return { checkout: checkoutResult.checkout, payment, session: sessionFrom({ checkout: checkoutResult.checkout, payment, method }) };
    } catch (error) {
        if (redemption && !checkoutResult?.checkout?.orderId) await (dependencies.releaseCommercePromotion || releaseCommercePromotion)({ orderId: redemption.orderId, promotionRedemptionSnapshot: redemption }).catch(() => null);
        if (error instanceof CustomerManualPaymentCheckoutError) throw error;
        throw new CustomerManualPaymentCheckoutError(ERROR_CODES.MANUAL_CHECKOUT_FAILED, "Manual payment checkout failed.", error.statusCode || error.httpStatus || 500);
    }
}

module.exports = Object.freeze({ startCustomerManualPaymentCheckout, loadManualPaymentMethod, sessionFrom, CustomerManualPaymentCheckoutError, ERROR_CODES });
