"use strict";

const crypto = require("crypto");
const { isCanonicalProductCode } = require("../../catalog/canonicalOperationalCatalog");
const CatalogPackage = require("../../models/CatalogPackage");
const PaymentMethod = require("../../models/PaymentMethod");
const { loadFulfillmentCapability } = require("../fulfillmentCapabilityService");
const { createAndPersistPricingQuote } = require("./pricingQuoteApplicationService");
const { resolveCheckoutRouteSnapshot } = require("../supplierProductionSelectionService");
const { checkoutFromQuote } = require("./checkoutApplicationService");
const orderRepository = require("./orderRepository");
const { buildProductionPricingContext } = require("./productionPricingContextService");
const {
    consumeCommercePromotion,
    loadCommercePromotionContext,
    releaseCommercePromotion,
    reserveCommercePromotion
} = require("./commercePromotionBridgeService");
const { debitWallet } = require("../walletService");

const ERROR_CODES = Object.freeze({
    INVALID_CHECKOUT_INPUT: "INVALID_CHECKOUT_INPUT",
    PACKAGE_UNAVAILABLE: "PACKAGE_UNAVAILABLE",
    FULFILLMENT_UNAVAILABLE: "FULFILLMENT_UNAVAILABLE",
    WALLET_UNAVAILABLE: "WALLET_UNAVAILABLE",
    COMMERCE_WALLET_CHECKOUT_FAILED: "COMMERCE_WALLET_CHECKOUT_FAILED"
});

class CustomerWalletCheckoutError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "CustomerWalletCheckoutError";
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
    throw new CustomerWalletCheckoutError(ERROR_CODES.INVALID_CHECKOUT_INPUT, "Unsupported region.");
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
    throw new CustomerWalletCheckoutError(ERROR_CODES.INVALID_CHECKOUT_INPUT, "Authenticated customer is required.", 401);
}

async function loadCatalogPackage(input = {}) {
    const region = normalizeRegion(input.region);
    const currency = normalizeCurrency(input.currency, region);
    const productCode = text(input.productCode || input.gameKey).toLowerCase();
    const packageCode = text(input.packageCode).toUpperCase();
    if (!productCode || !packageCode) {
        throw new CustomerWalletCheckoutError(ERROR_CODES.INVALID_CHECKOUT_INPUT, "Package selection is required.");
    }
    if (!isCanonicalProductCode(productCode)) {
        throw new CustomerWalletCheckoutError(ERROR_CODES.PACKAGE_UNAVAILABLE, "Selected package is no longer available.", 409);
    }

    const pkg = await CatalogPackage.findOne({
        productCode,
        packageCode,
        enabled: true,
        deletedAt: null
    }).lean();
    const price = pkg?.prices?.[region];
    if (!pkg || !price || price.enabled === false || normalizeCurrency(price.currency, region) !== currency) {
        throw new CustomerWalletCheckoutError(ERROR_CODES.PACKAGE_UNAVAILABLE, "Selected package is no longer available.", 409);
    }
    return { pkg, price, region, currency, productCode, packageCode };
}

async function assertAuthoritativeFulfillmentReady(catalog = {}, options = {}) {
    const capability = await (options.loadCapability || loadFulfillmentCapability)(catalog);
    if (!capability.fulfillmentAvailable) {
        throw new CustomerWalletCheckoutError(
            ERROR_CODES.FULFILLMENT_UNAVAILABLE,
            "This product is not currently available in the selected region.",
            409
        );
    }
    return capability;
}

async function loadWalletMethod(region) {
    const method = await PaymentMethod.findOne({
        key: "wallet",
        region,
        enabled: true
    }).lean();
    return method || {
        key: "wallet",
        method: "AZIEL Wallet",
        provider: "wallet",
        paymentType: "wallet"
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

function repositoryOwner(owner = {}) {
    return owner.userId
        ? { type: "USER", userId: owner.userId }
        : { type: "SESSION", sessionId: owner.sessionId };
}

async function markCommerceOrderPaid(orderId, owner, dependencies = {}) {
    const repo = dependencies.orderRepository || orderRepository;
    const changedAt = dependencies.changedAt || new Date();
    let order = await repo.findOwnedOrderById({ orderId, owner: repositoryOwner(owner) });
    if (!order) return null;

    if (order.paymentStatus !== "paid") {
        order = await repo.updatePaymentStatus({
            orderId,
            owner: repositoryOwner(owner),
            fromStatuses: [order.paymentStatus || "unpaid"],
            toStatus: "paid",
            changedAt,
            reason: "Paid with AZIEL Wallet"
        });
    }

    if (order.status === "pending_payment") {
        order = await repo.updateOrderStatus({
            orderId,
            owner: repositoryOwner(owner),
            fromStatuses: ["pending_payment"],
            toStatus: "paid",
            changedAt,
            reason: "Paid with AZIEL Wallet"
        });
    }

    return order;
}

function publicOrder(order = {}, fallback = {}) {
    const commercial = order.commercial || fallback.pricing || {};
    const product = order.product || fallback.product || {};
    return {
        commerce: true,
        orderId: order.orderId || fallback.orderId || "",
        quoteId: order.quoteId || fallback.quoteId || "",
        amount: Number(commercial.totalAmount || fallback.amount || 0),
        currency: commercial.currency || fallback.currency || "",
        region: commercial.region || fallback.region || "",
        paymentMethod: "wallet",
        paymentStatus: order.paymentStatus || "paid",
        status: order.status || "paid",
        game: product.gameName || fallback.productName || "",
        productName: product.gameName || fallback.productName || "",
        packageName: product.packageName || fallback.packageName || "",
        packageCode: product.packageCode || fallback.packageCode || ""
    };
}

async function startCustomerWalletCheckout(input = {}, context = {}, dependencies = {}) {
    const owner = ownerFromUser(context.user, context.sessionId);
    const username = text(context.user?.username || input.username);
    if (!username) {
        throw new CustomerWalletCheckoutError(ERROR_CODES.INVALID_CHECKOUT_INPUT, "Authenticated customer is required.", 401);
    }

    const catalog = await loadCatalogPackage(input);
    await (dependencies.assertFulfillmentReady || assertAuthoritativeFulfillmentReady)(catalog);
    const method = await loadWalletMethod(catalog.region);
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
            paymentMethodId: method.key || "wallet",
            couponCode: suppliedCouponCode,
            quantity: 1
        },
        idempotencyKey: `quote:${idempotencySeed}`,
        validitySeconds: 600,
        trace: { issueSource: "customer-wallet-checkout" },
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

    const repo = dependencies.orderRepository || orderRepository;
    let redemption = null;
    let checkoutResult = null;
    let releaseReservationOnFailure = true;
    try {
        checkoutResult = await checkoutFromQuote({
            quoteId: quoteResult.publicQuote.quoteId,
            owner,
            idempotencyKey: `checkout:${idempotencySeed}`,
            paymentSelection: {
                paymentMethodId: method.key || "wallet",
                paymentChannel: "AZIEL_WALLET"
            },
            customerInput: {
                gameAccount: {
                    userId: input.userId || "",
                    zoneId: input.zoneId || ""
                },
                customFields: {
                    username: input.username || username,
                    gameKey: input.gameKey || input.productCode || ""
                }
            },
            requestMetadata: {
                source: "customer-wallet"
            }
        }, {
            validateOperationalPackageState: async ({ quote }) => {
                const route = await resolveCheckoutRouteSnapshot({ productCode: quote.packageSnapshot?.gameCode, packageCode: quote.packageSnapshot?.packageCode, region: quote.commercialSnapshot?.region });
                return route.ready ? { allowed: true, supplierRouteSnapshot: route.routeSnapshot } : { allowed: false, reasonCode: route.blockers[0] || "PRIMARY_SUPPLIER_NOT_READY" };
            },
            validateFulfilmentInput: async ({ customerInput }) => ({ allowed: true, normalisedFulfilmentInput: customerInput }),
            validatePaymentMethod: async () => ({
                allowed: true,
                paymentSnapshot: {
                    paymentMethodId: method.key || "wallet",
                    paymentChannel: "AZIEL_WALLET",
                    provider: "AZIEL_WALLET",
                    flowType: "wallet",
                    nextAction: "DEBIT_WALLET",
                    paymentMethodBound: true
                },
                nextAction: "DEBIT_WALLET"
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
        const commerceOrder = await repo.findOrderById(checkoutResult.checkout.orderId);

        const orderAmount = Number(checkoutResult.checkout?.pricing?.totalAmount || 0);
        const orderCurrency = text(checkoutResult.checkout?.pricing?.currency || catalog.currency).toUpperCase();
        const walletResult = await (dependencies.debitWallet || debitWallet)({
            username,
            amount: orderAmount,
            currency: orderCurrency,
            type: "wallet.payment",
            source: "commerce_wallet_payment",
            referenceType: "commerce_order",
            referenceId: checkoutResult.checkout.orderId,
            orderId: checkoutResult.checkout.orderId,
            idempotencyKey: `wallet:commerce-order:${checkoutResult.checkout.orderId}:payment`,
            description: `Paid for ${checkoutResult.checkout.product?.gameName || catalog.productCode} - ${checkoutResult.checkout.product?.packageName || catalog.pkg.name}`,
            metadata: {
                commerce: true,
                orderId: checkoutResult.checkout.orderId,
                quoteId: checkoutResult.checkout.quoteId
            }
        });
        releaseReservationOnFailure = false;
        let paidOrder = await markCommerceOrderPaid(checkoutResult.checkout.orderId, owner, dependencies);
        const promotionOrder = paidOrder || commerceOrder;
        if (redemption || promotionOrder?.promotionRedemptionSnapshot?.redemptionId) {
            const consumed = await consumeCommercePromotion({
                ...promotionOrder,
                promotionRedemptionSnapshot: promotionOrder?.promotionRedemptionSnapshot || redemption
            });
            if (consumed && typeof repo.setPromotionRedemptionSnapshot === "function") {
                paidOrder = await repo.setPromotionRedemptionSnapshot({
                    orderId: checkoutResult.checkout.orderId,
                    promotionRedemptionSnapshot: consumed,
                    changedAt: new Date()
                });
            }
        }

        return {
            checkout: checkoutResult.checkout,
            order: publicOrder(paidOrder, {
                ...checkoutResult.checkout,
                amount: orderAmount,
                currency: orderCurrency,
                region: catalog.region,
                packageCode: catalog.packageCode
            }),
            balance: walletResult.balance,
            transaction: walletResult.transaction,
            duplicate: Boolean(walletResult.duplicate)
        };
    } catch (error) {
        if (redemption && releaseReservationOnFailure) {
            const released = await releaseCommercePromotion({ orderId: checkoutResult?.checkout?.orderId || redemption.orderId, promotionRedemptionSnapshot: redemption });
            if (released && checkoutResult?.checkout?.orderId && typeof repo.setPromotionRedemptionSnapshot === "function") {
                await repo.setPromotionRedemptionSnapshot({
                    orderId: checkoutResult.checkout.orderId,
                    promotionRedemptionSnapshot: released,
                    changedAt: new Date()
                });
            }
        }
        throw error;
    }
}

module.exports = Object.freeze({
    startCustomerWalletCheckout,
    assertAuthoritativeFulfillmentReady,
    CustomerWalletCheckoutError,
    ERROR_CODES
});
