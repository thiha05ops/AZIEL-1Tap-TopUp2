"use strict";

const crypto = require("crypto");
const PaymentMethod = require("../../models/PaymentMethod");
const User = require("../../models/User");
const { paymentMethodCapabilityState } = require("../paymentProviderRegistry");
const { findOwnedQuote } = require("./pricingQuoteRepository");
const { checkoutFromQuote } = require("./checkoutApplicationService");
const { resolveCheckoutRouteSnapshot } = require("../supplierProductionSelectionService");
const { reserveCommercePromotion, releaseCommercePromotion } = require("./commercePromotionBridgeService");
const orderRepository = require("./orderRepository");
const { createManualPaymentApplicationService } = require("./manualPaymentApplicationService");
const { dingerAccessDecision, isDingerMethod } = require("../dinger/dingerPaymentPolicy");
const { normalizeDingerMyanmarPhone, DingerCustomerPhoneError } = require("../dinger/dingerCustomerPhone");

const ERROR_CODES = Object.freeze({ INVALID_INPUT: "INVALID_INPUT", QUOTE_UNAVAILABLE: "QUOTE_UNAVAILABLE", PAYMENT_METHOD_UNAVAILABLE: "PAYMENT_METHOD_UNAVAILABLE", MANUAL_CHECKOUT_FAILED: "MANUAL_CHECKOUT_FAILED" });
class CustomerManualPaymentCheckoutError extends Error { constructor(code, message, statusCode = 400) { super(message); this.name = "CustomerManualPaymentCheckoutError"; this.code = code; this.statusCode = statusCode; } }
const text = value => String(value || "").trim();
const lower = value => text(value).toLowerCase();
const upper = value => text(value).toUpperCase();
const publicId = prefix => `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
function ownerFromContext(context = {}) { const userId = text(context.user?.id || context.user?._id || context.user?.userId); const sessionId = text(context.sessionId); if (userId) return { userId, sessionId: "" }; if (sessionId) return { userId: "", sessionId }; throw new CustomerManualPaymentCheckoutError(ERROR_CODES.INVALID_INPUT, "Authenticated customer is required.", 401); }
function repositoryOwner(owner) { return owner.userId ? { type: "USER", userId: owner.userId } : { type: "SESSION", sessionId: owner.sessionId }; }

async function resolveDingerCustomer({ owner, user, submittedPhone, allowPhoneUpdate = false }, dependencies = {}) {
    const contextualPhone = text(user?.phone || user?.mobile || user?.phoneNumber);
    const contextualName = text(user?.fullName || user?.name || user?.username);
    const findCustomer = dependencies.findCustomerById || (userId => User.findById(userId).select("phone username").lean());
    const stored = owner.userId ? await findCustomer(owner.userId) : null;
    const existingPhone = text(stored?.phone || contextualPhone);
    let phone;
    try { phone = normalizeDingerMyanmarPhone(text(submittedPhone) || existingPhone); }
    catch (error) {
        if (!(error instanceof DingerCustomerPhoneError)) throw error;
        throw new CustomerManualPaymentCheckoutError(ERROR_CODES.INVALID_INPUT, "A valid customer phone number is required for Dinger payment.", 422);
    }
    if (allowPhoneUpdate && text(submittedPhone) && phone !== existingPhone) {
        const updateCustomerPhone = dependencies.updateCustomerPhone || ((userId, normalizedPhone) => User.findOneAndUpdate(
            { _id: userId },
            { $set: { phone: normalizedPhone, phoneVerifiedAt: null, phoneVerificationMethod: "" } },
            { new: true, runValidators: true }
        ).select("phone username").lean());
        const updated = owner.userId ? await updateCustomerPhone(owner.userId, phone, { phoneVerifiedAt: null, phoneVerificationMethod: "" }) : null;
        if (!updated || text(updated.phone) !== phone) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.INVALID_INPUT, "Customer phone number could not be saved.", 409);
    }
    return { phone, name: contextualName || text(stored?.username) || "AZIEL Customer" };
}

async function loadManualPaymentMethod({ key, region, user }, dependencies = {}) {
    const methodKey = lower(key), market = upper(region);
    if (!methodKey || !market) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "Selected payment method is unavailable.", 422);
    const load = dependencies.findPaymentMethods || (query => PaymentMethod.find(query).lean());
    const matches = await load({ key: methodKey, region: market });
    if (!Array.isArray(matches) || matches.length !== 1) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "Selected payment method is unavailable.", 422);
    const method = matches[0], type = lower(method.paymentType);
    const retiredMyanmarManual = market === "MM" && ["ayapay", "wavepay", "kbzpay", "mmqr", "manual_bank"].includes(methodKey);
    if (retiredMyanmarManual) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "Legacy Myanmar manual payment methods are unavailable for new checkout.", 422);
    const trueWallet = methodKey === "truewallet" && market === "TH" && String(method.provider || "").toLowerCase() === "truewallet" && String(method.paymentChannel || "").toUpperCase() === "TRUE_MONEY_WALLET" && method.confirmationMode === "thunder_truewallet_slip";
    const dinger = isDingerMethod(method);
    const dingerAllowed = dinger && dingerAccessDecision(method, user || {}).allowed === true;
    if (method.enabled !== true || (!dinger && !["manual", "deeplink"].includes(type)) || (!dinger && !trueWallet && method.confirmationMode !== "manual_admin") || (!dinger && paymentMethodCapabilityState(method).customerVisible !== true) || (dinger && !dingerAllowed)) {
        throw new CustomerManualPaymentCheckoutError(ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "Selected payment method is unavailable.", 422);
    }
    if (market === "TH" && methodKey === "promptpay") throw new CustomerManualPaymentCheckoutError(ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "Use the dedicated PromptPay checkout.", 422);
    return method;
}

function sessionFrom({ checkout, payment, method }) {
    const instructions = payment.paymentInstructions || {};
    const trueWallet = method.key === "truewallet";
    const dinger = isDingerMethod(method);
    return {
        commerce: true, commerceOrderId: checkout.orderId, orderId: checkout.orderId, quoteId: checkout.quoteId, attemptId: payment.attemptId,
        reference: instructions.reference || payment.providerReference || payment.attemptId, amount: payment.amount, currency: payment.currency, region: checkout.region || method.region,
        productName: checkout.productName || checkout.product?.gameName || "", packageName: checkout.packageName || checkout.product?.packageName || "",
        paymentName: trueWallet ? "TrueMoney Wallet" : (instructions.title || method.method), paymentMethod: method.key, paymentType: method.paymentType, provider: dinger ? "DINGER" : trueWallet ? "THUNDER_TRUEWALLET" : "MANUAL_ADMIN", paymentChannel: dinger ? method.paymentChannel : trueWallet ? "TRUE_MONEY_WALLET" : "MANUAL_ADMIN", confirmationMode: dinger ? "provider_webhook" : trueWallet ? "thunder_truewallet_slip" : "manual_admin",
        accountName: instructions.accountName || "", accountNumber: instructions.accountNumber || "", qrImage: payment.qr?.image || "", qrUrl: payment.qr?.image || "", qrPayload: payment.qr?.payload || "", qrMode: payment.qr?.mode || method.qrMode || "none",
        redirect: payment.redirect || null,
        receiptUploadEnabled: dinger ? false : instructions.receiptUploadEnabled !== false, slipRequired: dinger ? false : instructions.slipRequired !== false,
        enableSaveQr: instructions.enableSaveQr === true,
        enableOpenApp: instructions.enableOpenApp === true, openAppMode: instructions.openAppMode || "disabled", deepLinkUrl: instructions.deepLinkUrl || "", appDisplayName: instructions.appDisplayName || "",
        expiresAt: payment.expiresAt || "",
        dynamicQr: payment.expiresAt ? { expiresAt: payment.expiresAt } : null
    };
}

async function startCustomerManualPaymentCheckout(input = {}, context = {}, dependencies = {}) {
    const owner = ownerFromContext(context), quoteId = text(input.reviewQuoteId), methodKey = lower(input.paymentMethod || input.methodCode), seed = text(input.checkoutKey || input.orderId);
    if (!quoteId || !methodKey || !seed) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.INVALID_INPUT, "Review quote, payment method, and checkout identity are required.");
    const quote = await (dependencies.findOwnedQuote || findOwnedQuote)({ quoteId, ...owner });
    if (!quote) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.QUOTE_UNAVAILABLE, "Checkout quote is unavailable.", 409);
    const region = upper(quote.commercialSnapshot?.region);
    if (!region) throw new CustomerManualPaymentCheckoutError(ERROR_CODES.QUOTE_UNAVAILABLE, "Checkout quote market is unavailable.", 409);
    const method = await loadManualPaymentMethod({ key: methodKey, region, user: context.user }, dependencies);
    const trueWallet = method.key === "truewallet";
    const dinger = isDingerMethod(method);
    const dingerCustomer = dinger ? await resolveDingerCustomer({
        owner,
        user: context.user,
        submittedPhone: method.key === "dinger_wavepay_pin" ? input.customerPhone : "",
        allowPhoneUpdate: method.key === "dinger_wavepay_pin"
    }, dependencies) : null;
    if (trueWallet && upper(quote.commercialSnapshot?.currency) !== "THB") throw new CustomerManualPaymentCheckoutError(ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "TrueMoney Wallet is available only for THB orders.", 422);
    let redemption = null, checkoutResult = null;
    try {
        checkoutResult = await (dependencies.checkoutFromQuote || checkoutFromQuote)({
            quoteId, owner, idempotencyKey: `checkout:${seed}`,
            paymentSelection: { paymentMethodId: method.key, paymentChannel: dinger ? method.paymentChannel : trueWallet ? "TRUE_MONEY_WALLET" : "MANUAL_ADMIN" },
            customerInput: { gameAccount: { userId: input.userId || "", zoneId: input.zoneId || "", accountFields: Array.isArray(input.accountFields) ? input.accountFields : [] }, contact: dingerCustomer ? { phone: dingerCustomer.phone } : {}, customFields: { username: input.username || "", gameKey: input.gameKey || input.productCode || "", customerPhone: dingerCustomer?.phone || "", customerName: dingerCustomer?.name || text(context.user?.fullName || context.user?.name || context.user?.username) } },
            requestMetadata: { source: "customer-storefront" }
        }, {
            validateOperationalPackageState: async ({ quote: lockedQuote }) => { const route = await (dependencies.resolveCheckoutRouteSnapshot || resolveCheckoutRouteSnapshot)({ productCode: lockedQuote.packageSnapshot?.gameCode, packageCode: lockedQuote.packageSnapshot?.packageCode, region: lockedQuote.commercialSnapshot?.region }); return route.ready ? { allowed: true, supplierRouteSnapshot: route.routeSnapshot } : { allowed: false, reasonCode: route.blockers?.[0] || "PRIMARY_SUPPLIER_NOT_READY" }; },
            validateFulfilmentInput: async ({ customerInput }) => ({ allowed: true, normalisedFulfilmentInput: customerInput }),
            validatePaymentMethod: async () => ({ allowed: true, paymentSnapshot: { paymentMethodId: method.key, paymentChannel: dinger ? method.paymentChannel : trueWallet ? "TRUE_MONEY_WALLET" : "MANUAL_ADMIN", provider: dinger ? "DINGER" : trueWallet ? "THUNDER_TRUEWALLET" : "MANUAL_ADMIN", providerType: dinger ? "automatic" : "manual", flowType: dinger ? "dinger" : trueWallet ? "thunder_truewallet" : "manual_admin", confirmationMode: dinger ? "provider_webhook" : trueWallet ? "thunder_truewallet_slip" : "manual_admin", nextAction: dinger ? "OPEN_PROVIDER_PAYMENT" : "OPEN_MANUAL_PAYMENT", paymentMethodBound: true, metadata: { methodName: method.method, region: method.region, confirmationMode: dinger ? "provider_webhook" : trueWallet ? "thunder_truewallet_slip" : "manual_admin" } }, nextAction: dinger ? "OPEN_PROVIDER_PAYMENT" : "OPEN_MANUAL_PAYMENT" }),
            validatePromotionRedemption: async ({ quote: lockedQuote, orderId }) => { redemption = await (dependencies.reserveCommercePromotion || reserveCommercePromotion)({ order: { orderId, commercial: lockedQuote.commercialSnapshot, promotionSnapshot: lockedQuote.promotionSnapshot, couponSnapshot: lockedQuote.couponSnapshot, quoteSnapshot: lockedQuote }, user: context.user, expiresAt: lockedQuote.lifecycle?.expiresAt }); return { allowed: true, promotionRedemptionSnapshot: redemption }; },
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

module.exports = Object.freeze({ startCustomerManualPaymentCheckout, loadManualPaymentMethod, resolveDingerCustomer, sessionFrom, CustomerManualPaymentCheckoutError, ERROR_CODES });
