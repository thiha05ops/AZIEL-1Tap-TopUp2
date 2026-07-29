"use strict";

const crypto = require("crypto");
const CatalogPackage = require("../../models/CatalogPackage");
const PaymentMethod = require("../../models/PaymentMethod");
const { createAndPersistPricingQuote } = require("./pricingQuoteApplicationService");
const { checkoutFromQuote } = require("./checkoutApplicationService");
const orderRepository = require("./orderRepository");
const { createManualPaymentApplicationService } = require("./manualPaymentApplicationService");
const { buildProductionPricingContext } = require("./productionPricingContextService");
const {
    loadCommercePromotionContext,
    reserveCommercePromotion,
    releaseCommercePromotion
} = require("./commercePromotionBridgeService");

const ERROR_CODES = Object.freeze({
    INVALID_CHECKOUT_INPUT: "INVALID_CHECKOUT_INPUT",
    PACKAGE_UNAVAILABLE: "PACKAGE_UNAVAILABLE",
    PAYMENT_METHOD_UNAVAILABLE: "PAYMENT_METHOD_UNAVAILABLE",
    COMMERCE_CHECKOUT_FAILED: "COMMERCE_CHECKOUT_FAILED"
});

class CustomerManualPromptPayCheckoutError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "CustomerManualPromptPayCheckoutError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function text(value) {
    return String(value || "").trim();
}

function normalizeRegion(value) {
    const raw = text(value).toUpperCase();
    if (["TH", "THAILAND"].includes(raw)) return "TH";
    if (["MM", "MYANMAR"].includes(raw)) return "MM";
    throw new CustomerManualPromptPayCheckoutError(ERROR_CODES.INVALID_CHECKOUT_INPUT, "Unsupported region.");
}

function normalizeCurrency(value, region) {
    const raw = text(value).toUpperCase();
    if (raw) return raw;
    return region === "TH" ? "THB" : "MMK";
}

function publicId(prefix) {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}

function ownerFromUser(user = {}, sessionId = "") {
    const userId = text(user.id || user._id || user.userId);
    if (userId) return { userId, sessionId: "" };
    if (sessionId) return { userId: "", sessionId };
    throw new CustomerManualPromptPayCheckoutError(ERROR_CODES.INVALID_CHECKOUT_INPUT, "Authenticated customer is required.", 401);
}

async function loadCatalogPackage(input = {}) {
    const region = normalizeRegion(input.region);
    const currency = normalizeCurrency(input.currency, region);
    const productCode = text(input.productCode || input.gameKey).toLowerCase();
    const packageCode = text(input.packageCode).toUpperCase();
    if (!productCode || !packageCode) {
        throw new CustomerManualPromptPayCheckoutError(ERROR_CODES.INVALID_CHECKOUT_INPUT, "Package selection is required.");
    }

    const pkg = await CatalogPackage.findOne({
        productCode,
        packageCode,
        enabled: true,
        deletedAt: null
    }).lean();
    const price = pkg?.prices?.[region];
    if (!pkg || !price || price.enabled === false || normalizeCurrency(price.currency, region) !== currency) {
        throw new CustomerManualPromptPayCheckoutError(ERROR_CODES.PACKAGE_UNAVAILABLE, "Selected package is no longer available.", 409);
    }

    return { pkg, price, region, currency, productCode, packageCode };
}

async function loadPromptPayMethod(input = {}, region) {
    const requestedKey = text(input.paymentMethod || input.methodCode || "promptpay").toLowerCase();
    const method = await PaymentMethod.findOne({
        key: requestedKey,
        region,
        enabled: true
    }).lean();
    if (!method || method.qrMode !== "aziel_promptpay_dynamic") {
        throw new CustomerManualPromptPayCheckoutError(ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE, "PromptPay QR is not available.", 422);
    }
    return method;
}

function paymentCapabilities(method = {}) {
    return {
        paymentName: method.method || "PromptPay QR",
        paymentMethod: method.key || "promptpay",
        paymentType: method.paymentType || "manual",
        provider: method.provider || "promptpay",
        accountName: method.accountName || "",
        accountNumber: method.accountNumber || "",
        qrMode: method.qrMode || "aziel_promptpay_dynamic",
        receiptUploadEnabled: method.receiptUploadEnabled !== false,
        slipRequired: method.slipRequired !== false,
        enableSaveQr: method.enableSaveQr === true,
        enableOpenApp: method.enableOpenApp !== false,
        enableChecklist: method.enableChecklist !== false,
        appDisplayName: method.appDisplayName || "PromptPay",
        openAppMode: method.openAppMode || "bank_chooser",
        appLaunchMode: method.appLaunchMode || "APP_ONLY",
        iosAppLaunchUrl: method.iosAppLaunchUrl || "",
        androidAppLaunchUrl: method.androidAppLaunchUrl || "",
        androidPackageName: method.androidPackageName || "",
        appStoreFallbackUrl: method.appStoreFallbackUrl || "",
        playStoreFallbackUrl: method.playStoreFallbackUrl || "",
        galleryScanSupported: method.galleryScanSupported === true,
        dynamicQrSupported: method.dynamicQrSupported === true,
        amountPrefillSupported: method.amountPrefillSupported === true,
        checklistSteps: Array.isArray(method.checklistSteps) ? method.checklistSteps : [],
        bankLaunchers: Array.isArray(method.bankLaunchers) ? method.bankLaunchers : []
    };
}

function defaultQuoteDependencies(overrides = {}) {
    return {
        getIssuedAt: () => new Date(),
        generateQuoteId: () => publicId("AZQ"),
        generateTraceId: () => publicId("TRC"),
        ...overrides
    };
}

function toCheckoutSession({ checkout, payment, method, catalog }) {
    const qr = payment.qr || {};
    return {
        commerce: true,
        commerceOrderId: checkout.orderId,
        orderId: checkout.orderId,
        quoteId: checkout.quoteId,
        attemptId: payment.attemptId,
        reference: qr.encodedReference || payment.attemptId || checkout.orderId,
        amount: payment.amount,
        currency: payment.currency,
        pricing: checkout.pricing || null,
        productName: checkout.product?.gameName || catalog.pkg.metadata?.gameName || catalog.productCode,
        packageName: checkout.product?.packageName || catalog.pkg.name,
        qrImage: qr.image || "",
        qrUrl: qr.image || "",
        dynamicQr: {
            qrPayload: qr.payload || "",
            qrImage: qr.image || "",
            expiresAt: payment.expiresAt || "",
            orderReference: qr.encodedReference || payment.attemptId || checkout.orderId
        },
        expiresAt: payment.expiresAt || "",
        receiptEvidence: payment.receiptEvidence || { attached: false },
        ...paymentCapabilities(method)
    };
}

async function startCustomerManualPromptPayCheckout(input = {}, context = {}, dependencies = {}) {
    const owner = ownerFromUser(context.user, context.sessionId);
    const catalog = await loadCatalogPackage(input);
    const method = await loadPromptPayMethod(input, catalog.region);
    const issuedAt = new Date();
    const pricingContext = await (dependencies.buildPricingContext || buildProductionPricingContext)({
        pkg: catalog.pkg,
        price: catalog.price,
        catalog,
        region: catalog.region,
        currency: catalog.currency,
        now: issuedAt
    });
    const idempotencySeed = text(input.orderId) || publicId("checkout");
    const suppliedCouponCode = text(input.promoCode);
    const quoteDependencies = defaultQuoteDependencies({
        ...(suppliedCouponCode ? {
            loadPromotionContext: args => loadCommercePromotionContext({
                ...args,
                catalog,
                user: context.user
            })
        } : {}),
        ...(dependencies.quoteDependencies || {})
    });
    const quoteResult = await createAndPersistPricingQuote({
        owner,
        request: {
            region: catalog.region,
            currency: catalog.currency,
            packageIdentity: {
                packageRef: String(catalog.pkg._id || ""),
                packageCode: catalog.packageCode
            },
            paymentMethodId: method.key,
            couponCode: suppliedCouponCode,
            quantity: 1
        },
        idempotencyKey: `quote:${idempotencySeed}`,
        validitySeconds: Number(method.dynamicQrExpiryMinutes || 15) * 60,
        trace: { issueSource: "customer-checkout" },
        trustedContext: {
            package: {
                ...(pricingContext.packageContext || {}),
                packageId: pricingContext.packageContext?.packageId || String(catalog.pkg._id || ""),
                packageRef: pricingContext.packageContext?.packageRef || String(catalog.pkg._id || ""),
                packageCode: catalog.packageCode,
                packageName: pricingContext.packageContext?.packageName || catalog.pkg.name,
                gameId: pricingContext.packageContext?.gameId || catalog.productCode,
                gameCode: pricingContext.packageContext?.gameCode || catalog.productCode,
                gameName: pricingContext.packageContext?.gameName || text(input.game) || catalog.productCode,
                categoryId: pricingContext.packageContext?.categoryId || "game",
                categoryCode: pricingContext.packageContext?.categoryCode || "game"
            },
            pricing: pricingContext.pricing
        }
    }, quoteDependencies);

    let redemption = null;
    let checkoutResult = null;
    try {
        checkoutResult = await checkoutFromQuote({
            quoteId: quoteResult.publicQuote.quoteId,
            owner,
            idempotencyKey: `checkout:${idempotencySeed}`,
            paymentSelection: {
                paymentMethodId: method.key,
                paymentChannel: "MANUAL_PROMPTPAY"
            },
            customerInput: {
                gameAccount: {
                    userId: input.userId || "",
                    zoneId: input.zoneId || ""
                },
                customFields: {
                    username: input.username || "",
                    gameKey: input.gameKey || input.productCode || ""
                }
            },
            requestMetadata: {
                source: "customer-storefront"
            }
        }, {
            validateOperationalPackageState: async () => ({ allowed: true }),
            validateFulfilmentInput: async ({ customerInput }) => ({ allowed: true, normalisedFulfilmentInput: customerInput }),
            validatePaymentMethod: async () => ({
                allowed: true,
                paymentSnapshot: {
                    paymentMethodId: method.key,
                    paymentChannel: "MANUAL_PROMPTPAY",
                    provider: "MANUAL_PROMPTPAY",
                    flowType: "manual_promptpay",
                    nextAction: "OPEN_MANUAL_PAYMENT",
                    paymentMethodBound: true,
                    metadata: {
                        qrMode: method.qrMode,
                        confirmationMode: method.confirmationMode || "manual_admin"
                    }
                },
                nextAction: "OPEN_MANUAL_PAYMENT"
            }),
            validatePromotionRedemption: async ({ quote, orderId }) => {
                redemption = await reserveCommercePromotion({
                    order: {
                        orderId,
                        commercial: {
                            region: quote.commercialSnapshot?.region,
                            currency: quote.commercialSnapshot?.currency,
                            originalUnitPrice: quote.commercialSnapshot?.originalPrice,
                            quantity: quote.commercialSnapshot?.quantity,
                            discountAmount: quote.commercialSnapshot?.discountAmount,
                            totalAmount: quote.commercialSnapshot?.quotedTotalAmount
                        },
                        promotionSnapshot: quote.promotionSnapshot
                    },
                    user: context.user,
                    expiresAt: quote.lifecycle?.expiresAt || quoteResult.publicQuote.expiresAt || null
                });
                return { allowed: true, promotionRedemptionSnapshot: redemption };
            },
            getCheckoutTime: () => new Date(),
            generateOrderId: () => publicId("AZL"),
            generateCheckoutId: () => publicId("CHK"),
            ...dependencies.checkoutDependencies
        });

        const manualService = dependencies.manualPaymentService || createManualPaymentApplicationService(dependencies.manualPaymentOptions || {});
        const payment = await manualService.initiateManualPayment({
            orderId: checkoutResult.checkout.orderId,
            owner,
            idempotencyKey: `manual:${idempotencySeed}`
        });

        return {
            checkout: checkoutResult.checkout,
            payment,
            session: toCheckoutSession({ checkout: checkoutResult.checkout, payment, method, catalog })
        };
    } catch (error) {
        if (redemption) {
            const released = await releaseCommercePromotion({ orderId: checkoutResult?.checkout?.orderId || redemption.orderId, promotionRedemptionSnapshot: redemption });
            if (released && checkoutResult?.checkout?.orderId && typeof (dependencies.orderRepository || orderRepository).setPromotionRedemptionSnapshot === "function") {
                await (dependencies.orderRepository || orderRepository).setPromotionRedemptionSnapshot({
                    orderId: checkoutResult?.checkout?.orderId || redemption.orderId,
                    promotionRedemptionSnapshot: released,
                    changedAt: new Date()
                });
            }
        }
        throw error;
    }
}

module.exports = Object.freeze({
    startCustomerManualPromptPayCheckout,
    CustomerManualPromptPayCheckoutError,
    ERROR_CODES
});
