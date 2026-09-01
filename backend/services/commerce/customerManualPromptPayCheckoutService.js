"use strict";

const crypto = require("crypto");
const { isCanonicalProductCode } = require("../../catalog/canonicalOperationalCatalog");
const CatalogPackage = require("../../models/CatalogPackage");
const { CatalogError, resolvePackagePrice } = require("../catalogService");
const { findCatalogPackageByIdentity } = require("./catalogPackageIdentityService");
const PaymentMethod = require("../../models/PaymentMethod");
const { paymentMethodCapabilityState } = require("../paymentProviderRegistry");
const { loadFulfillmentCapability } = require("../fulfillmentCapabilityService");
const {
    createAndPersistPricingQuote,
    getOwnedPricingQuote
} = require("./pricingQuoteApplicationService");
const { resolveCheckoutRouteSnapshot } = require("../supplierProductionSelectionService");
const { checkoutFromQuote } = require("./checkoutApplicationService");
const orderRepository = require("./orderRepository");
const { createManualPaymentApplicationService } = require("./manualPaymentApplicationService");
const { buildProductionPricingContext } = require("./productionPricingContextService");
const {
    loadCommercePromotionContext,
    reserveCommercePromotion,
    releaseCommercePromotion
} = require("./commercePromotionBridgeService");
const { runtimeDebug } = require("../../utils/runtimeDebug");

const ERROR_CODES = Object.freeze({
    INVALID_CHECKOUT_INPUT: "INVALID_CHECKOUT_INPUT",
    PACKAGE_UNAVAILABLE: "PACKAGE_UNAVAILABLE",
    FULFILLMENT_UNAVAILABLE: "FULFILLMENT_UNAVAILABLE",
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
    if (!isCanonicalProductCode(productCode)) {
        throw new CustomerManualPromptPayCheckoutError(ERROR_CODES.PACKAGE_UNAVAILABLE, "Selected package is no longer available.", 409);
    }

    let publicPackage;
    try {
        publicPackage = await resolvePackagePrice({
            productCode,
            packageCode,
            region,
            currency
        });
    } catch (error) {
        if (!(error instanceof CatalogError) || error.code === "CATALOG_UNAVAILABLE") throw error;
        throw new CustomerManualPromptPayCheckoutError(
            ERROR_CODES.PACKAGE_UNAVAILABLE,
            "Selected package is no longer available.",
            409
        );
    }

    const pkg = await findCatalogPackageByIdentity(productCode, packageCode, {
        enabled: true,
        deletedAt: null
    }).lean();
    const price = pkg?.prices?.[region];
    if (
        !pkg ||
        !price ||
        price.enabled === false ||
        normalizeCurrency(price.currency, region) !== currency ||
        publicPackage.productCode !== productCode ||
        publicPackage.packageCode !== pkg.packageCode ||
        publicPackage.region !== region ||
        publicPackage.currency !== currency ||
        Number(publicPackage.amount) !== Number(price.amount)
    ) {
        throw new CustomerManualPromptPayCheckoutError(ERROR_CODES.PACKAGE_UNAVAILABLE, "Selected package is no longer available.", 409);
    }

    return { pkg, price, region, currency, productCode, packageCode: pkg.packageCode };
}

async function assertAuthoritativeFulfillmentReady(catalog = {}, options = {}) {
    const capability = await (options.loadCapability || loadFulfillmentCapability)({
        productCode: catalog.productCode,
        packageCode: catalog.packageCode,
        region: catalog.region
    });
    if (!capability.fulfillmentAvailable) {
        throw new CustomerManualPromptPayCheckoutError(
            ERROR_CODES.FULFILLMENT_UNAVAILABLE,
            "This product is not currently available in the selected region.",
            409
        );
    }
    return capability;
}

async function loadPromptPayMethod(input = {}, region) {
    const requestedKey = text(input.paymentMethod || input.methodCode || "promptpay").toLowerCase();
    if (region !== "TH" || requestedKey !== "promptpay") {
        throw new CustomerManualPromptPayCheckoutError(
            ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE,
            "Selected payment method is unavailable for this checkout.",
            422
        );
    }
    const method = await PaymentMethod.findOne({
        key: requestedKey,
        region,
        enabled: true
    }).lean();
    if (!method || method.qrMode !== "aziel_promptpay_dynamic" || paymentMethodCapabilityState(method).customerVisible !== true) {
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

function assertReviewQuoteMatchesCheckout(review, catalog, input = {}) {
    const expiresAt = review?.expiresAt ? new Date(review.expiresAt) : null;
    const suppliedCouponCode = text(input.promoCode).toUpperCase();
    const reviewedCouponCode = text(review?.promotion?.code).toUpperCase();
    if (
        !review?.quoteId ||
        text(review.status).toUpperCase() !== "ISSUED" ||
        !expiresAt ||
        !Number.isFinite(expiresAt.getTime()) ||
        expiresAt <= new Date() ||
        text(review.package?.packageCode).toUpperCase() !== catalog.packageCode ||
        text(review.pricing?.currency).toUpperCase() !== catalog.currency ||
        reviewedCouponCode !== suppliedCouponCode
    ) {
        throw new CustomerManualPromptPayCheckoutError(
            ERROR_CODES.INVALID_CHECKOUT_INPUT,
            "Checkout review is stale or no longer matches this purchase. Refresh the review before paying.",
            409
        );
    }
    return review;
}

async function reviewCustomerCheckout(input = {}, context = {}, dependencies = {}) {
    const owner = ownerFromUser(context.user, context.sessionId);
    const catalog = await (dependencies.loadCatalogPackage || loadCatalogPackage)(input);
    await (dependencies.assertFulfillmentReady || assertAuthoritativeFulfillmentReady)(catalog);
    const issuedAt = new Date();
    const pricingContext = await (
        dependencies.buildPricingContext ||
        buildProductionPricingContext
    )({
        pkg: catalog.pkg,
        price: catalog.price,
        catalog,
        region: catalog.region,
        currency: catalog.currency,
        now: issuedAt
    });
    const idempotencySeed = text(input.checkoutKey || input.orderId);
    if (!idempotencySeed) {
        throw new CustomerManualPromptPayCheckoutError(
            ERROR_CODES.INVALID_CHECKOUT_INPUT,
            "Stable checkoutKey is required."
        );
    }
    const suppliedCouponCode = text(input.promoCode);
    const quoteDependencies = defaultQuoteDependencies({
        ...(suppliedCouponCode
            ? {
                loadPromotionContext: args =>
                    (dependencies.loadPromotionContext || loadCommercePromotionContext)({
                        ...args,
                        catalog,
                        user: context.user
                    })
            }
            : {}),
        ...(dependencies.quoteDependencies || {})
    });
    const quoteResult = await (
        dependencies.createAndPersistPricingQuote ||
        createAndPersistPricingQuote
    )(
        {
            owner,
            request: {
                region: catalog.region,
                currency: catalog.currency,
                packageIdentity: {
                    packageRef: String(catalog.pkg._id || ""),
                    packageCode: catalog.packageCode
                },
                paymentMethodId: "",
                couponCode: suppliedCouponCode,
                quantity: 1
            },
            idempotencyKey: `review-quote:${idempotencySeed}`,
            validitySeconds: 30 * 60,
            trace: { issueSource: "customer-checkout-review" },
            trustedContext: {
                package: {
                    ...(pricingContext.packageContext || {}),
                    packageId:
                        pricingContext.packageContext?.packageId ||
                        String(catalog.pkg._id || ""),
                    packageRef:
                        pricingContext.packageContext?.packageRef ||
                        String(catalog.pkg._id || ""),
                    packageCode: catalog.packageCode,
                    packageName:
                        pricingContext.packageContext?.packageName ||
                        catalog.pkg.name,
                    gameId:
                        pricingContext.packageContext?.gameId ||
                        catalog.productCode,
                    gameCode:
                        pricingContext.packageContext?.gameCode ||
                        catalog.productCode,
                    gameName:
                        pricingContext.packageContext?.gameName ||
                        text(input.game) ||
                        catalog.productCode,
                    categoryId:
                        pricingContext.packageContext?.categoryId ||
                        "game",
                    categoryCode:
                        pricingContext.packageContext?.categoryCode ||
                        "game"
                },
                pricing: pricingContext.pricing
            }
        },
        quoteDependencies
    );

    return {
        review: quoteResult.publicQuote,
        metadata: {
            idempotentReuse: quoteResult.metadata?.idempotentReuse === true,
            transactionCreated: false
        }
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

async function startCustomerManualPromptPayCheckout(
    input = {},
    context = {},
    dependencies = {}
) {
    runtimeDebug("[CHECKOUT STEP 0] Request entered", {
        productCode: input.productCode || input.gameKey || "",
        packageCode: input.packageCode || "",
        region: input.region || "",
        currency: input.currency || "",
        paymentMethod: input.paymentMethod || input.methodCode || "",
        userId: input.userId || "",
        zoneId: input.zoneId || ""
    });

    const owner = ownerFromUser(context.user, context.sessionId);

    runtimeDebug("[CHECKOUT STEP 1] Owner resolved", {
        hasUserId: Boolean(owner.userId),
        hasSessionId: Boolean(owner.sessionId)
    });

    runtimeDebug("[CHECKOUT STEP 2] Loading catalog package");

    const catalog = await (dependencies.loadCatalogPackage || loadCatalogPackage)(input);
    await (dependencies.assertFulfillmentReady || assertAuthoritativeFulfillmentReady)(catalog);

    runtimeDebug("[CHECKOUT STEP 3] Catalog package loaded", {
        productCode: catalog.productCode,
        packageCode: catalog.packageCode,
        region: catalog.region,
        currency: catalog.currency,
        catalogPackageId: String(catalog.pkg?._id || ""),
        catalogAmount: Number(catalog.price?.amount || 0)
    });

    runtimeDebug("[CHECKOUT STEP 4] Loading PromptPay method");

    const method = await loadPromptPayMethod(input, catalog.region);

    runtimeDebug("[CHECKOUT STEP 5] PromptPay method loaded", {
        key: method.key,
        region: method.region,
        paymentType: method.paymentType,
        provider: method.provider,
        qrMode: method.qrMode,
        enabled: method.enabled === true
    });

    const issuedAt = new Date();

    runtimeDebug("[CHECKOUT STEP 6] Building pricing context");

    const pricingContext = await (
        dependencies.buildPricingContext ||
        buildProductionPricingContext
    )({
        pkg: catalog.pkg,
        price: catalog.price,
        catalog,
        region: catalog.region,
        currency: catalog.currency,
        now: issuedAt
    });

    runtimeDebug("[CHECKOUT STEP 7] Pricing context ready", {
        supplierCost:
            pricingContext?.pricing?.pricingInput?.supplierCost ?? null,
        supplierCurrency:
            pricingContext?.pricing?.pricingInput?.supplierCurrency || "",
        targetCurrency:
            pricingContext?.pricing?.pricingInput?.targetCurrency || "",
        priceVersionId:
            pricingContext?.pricing?.versionContext?.priceVersionId || "",
        priceVersionNumber:
            pricingContext?.pricing?.versionContext?.priceVersionNumber || 0,
        appliedRuleCount: Array.isArray(
            pricingContext?.pricing?.pricingInput?.appliedPricingRules
        )
            ? pricingContext.pricing.pricingInput.appliedPricingRules.length
            : 0
    });

    const idempotencySeed =
        text(input.orderId) ||
        publicId("checkout");

    const suppliedCouponCode = text(input.promoCode);

    const quoteDependencies = defaultQuoteDependencies({
        ...(suppliedCouponCode
            ? {
                loadPromotionContext: args =>
                    loadCommercePromotionContext({
                        ...args,
                        catalog,
                        user: context.user
                    })
            }
            : {}),
        ...(dependencies.quoteDependencies || {})
    });

    runtimeDebug("[CHECKOUT STEP 8] Creating pricing quote", {
        idempotencySeed,
        couponCode: suppliedCouponCode,
        validitySeconds:
            Number(method.dynamicQrExpiryMinutes || 15) * 60
    });

    const reviewedQuoteId = text(input.reviewQuoteId);
    const reviewedQuote = reviewedQuoteId
        ? assertReviewQuoteMatchesCheckout(
            await (dependencies.getOwnedPricingQuote || getOwnedPricingQuote)(
                { quoteId: reviewedQuoteId, owner },
                dependencies.quoteDependencies || {}
            ),
            catalog,
            input
        )
        : null;

    const quoteResult = reviewedQuote
        ? {
            publicQuote: reviewedQuote,
            metadata: {
                persistenceOutcome: "review_quote_reused",
                idempotentReuse: true
            }
        }
        : await createAndPersistPricingQuote(
        {
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
            validitySeconds:
                Number(method.dynamicQrExpiryMinutes || 15) * 60,
            trace: {
                issueSource: "customer-checkout"
            },
            trustedContext: {
                package: {
                    ...(pricingContext.packageContext || {}),
                    packageId:
                        pricingContext.packageContext?.packageId ||
                        String(catalog.pkg._id || ""),
                    packageRef:
                        pricingContext.packageContext?.packageRef ||
                        String(catalog.pkg._id || ""),
                    packageCode: catalog.packageCode,
                    packageName:
                        pricingContext.packageContext?.packageName ||
                        catalog.pkg.name,
                    gameId:
                        pricingContext.packageContext?.gameId ||
                        catalog.productCode,
                    gameCode:
                        pricingContext.packageContext?.gameCode ||
                        catalog.productCode,
                    gameName:
                        pricingContext.packageContext?.gameName ||
                        text(input.game) ||
                        catalog.productCode,
                    categoryId:
                        pricingContext.packageContext?.categoryId ||
                        "game",
                    categoryCode:
                        pricingContext.packageContext?.categoryCode ||
                        "game"
                },
                pricing: pricingContext.pricing
            }
        },
        quoteDependencies
        );

    runtimeDebug("[CHECKOUT STEP 9] Pricing quote created", {
        quoteId: quoteResult?.publicQuote?.quoteId || "",
        status: quoteResult?.publicQuote?.status || "",
        amount:
            quoteResult?.publicQuote?.pricing?.quotedTotalAmount ?? null,
        currency:
            quoteResult?.publicQuote?.pricing?.currency || "",
        persistenceOutcome:
            quoteResult?.metadata?.persistenceOutcome || ""
    });

    let redemption = null;
    let checkoutResult = null;

    try {
        runtimeDebug("[CHECKOUT STEP 10] Starting CommerceOrder checkout");

        checkoutResult = await checkoutFromQuote(
            {
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
                        zoneId: input.zoneId || "",
                        accountFields: Array.isArray(input.accountFields) ? input.accountFields : []
                    },
                    customFields: {
                        username: input.username || "",
                        gameKey:
                            input.gameKey ||
                            input.productCode ||
                            ""
                    }
                },
                requestMetadata: {
                    source: "customer-storefront"
                }
            },
            {
                validateOperationalPackageState: async ({ quote }) => {
                    const route = await resolveCheckoutRouteSnapshot({ productCode: quote.packageSnapshot?.gameCode, packageCode: quote.packageSnapshot?.packageCode, region: quote.commercialSnapshot?.region });
                    return route.ready ? { allowed: true, supplierRouteSnapshot: route.routeSnapshot } : { allowed: false, reasonCode: route.blockers[0] || "PRIMARY_SUPPLIER_NOT_READY" };
                },

                validateFulfilmentInput: async ({
                    customerInput
                }) => ({
                    allowed: true,
                    normalisedFulfilmentInput: customerInput
                }),

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
                            confirmationMode:
                                method.confirmationMode ||
                                "manual_admin"
                        }
                    },
                    nextAction: "OPEN_MANUAL_PAYMENT"
                }),

                validatePromotionRedemption: async ({
                    quote,
                    orderId
                }) => {
                    runtimeDebug(
                        "[CHECKOUT STEP 10A] Reserving promotion",
                        {
                            orderId,
                            hasPromotion:
                                Boolean(
                                    quote?.promotionSnapshot
                                        ?.selectedPromotion
                                )
                        }
                    );

                    redemption =
                        await reserveCommercePromotion({
                            order: {
                                orderId,
                                commercial: {
                                    region:
                                        quote.commercialSnapshot
                                            ?.region,
                                    currency:
                                        quote.commercialSnapshot
                                            ?.currency,
                                    originalUnitPrice:
                                        quote.commercialSnapshot
                                            ?.originalPrice,
                                    quantity:
                                        quote.commercialSnapshot
                                            ?.quantity,
                                    discountAmount:
                                        quote.commercialSnapshot
                                            ?.discountAmount,
                                    totalAmount:
                                        quote.commercialSnapshot
                                            ?.quotedTotalAmount
                                },
                                promotionSnapshot:
                                    quote.promotionSnapshot
                            },
                            user: context.user,
                            expiresAt:
                                quote.lifecycle?.expiresAt ||
                                quoteResult.publicQuote
                                    .expiresAt ||
                                null
                        });

                    runtimeDebug(
                        "[CHECKOUT STEP 10B] Promotion reservation complete",
                        {
                            reserved: Boolean(redemption),
                            orderId:
                                redemption?.orderId ||
                                orderId
                        }
                    );

                    return {
                        allowed: true,
                        promotionRedemptionSnapshot:
                            redemption
                    };
                },

                getCheckoutTime: () => new Date(),
                generateOrderId: () => publicId("AZL"),
                generateCheckoutId: () => publicId("CHK"),

                ...dependencies.checkoutDependencies
            }
        );

        runtimeDebug("[CHECKOUT STEP 11] CommerceOrder created", {
            orderId:
                checkoutResult?.checkout?.orderId || "",
            quoteId:
                checkoutResult?.checkout?.quoteId || "",
            status:
                checkoutResult?.checkout?.status || "",
            paymentStatus:
                checkoutResult?.checkout?.paymentStatus ||
                "",
            totalAmount:
                checkoutResult?.checkout?.pricing
                    ?.totalAmount ?? null,
            currency:
                checkoutResult?.checkout?.pricing
                    ?.currency || "",
            idempotentReuse:
                checkoutResult?.metadata
                    ?.idempotentReuse === true
        });

        const manualService =
            dependencies.manualPaymentService ||
            createManualPaymentApplicationService(
                dependencies.manualPaymentOptions || {}
            );

        runtimeDebug(
            "[CHECKOUT STEP 12] Starting manual payment",
            {
                orderId:
                    checkoutResult.checkout.orderId,
                idempotencyKey:
                    `manual:${idempotencySeed}`
            }
        );

        let payment =
            await manualService.initiateManualPayment({
                orderId:
                    checkoutResult.checkout.orderId,
                owner,
                idempotencyKey:
                    `manual:${idempotencySeed}`
            });

        if (
            payment?.retryEligible === true &&
            typeof manualService.resumeOrRetryManualPayment === "function"
        ) {
            payment = await manualService.resumeOrRetryManualPayment({
                orderId: checkoutResult.checkout.orderId,
                owner,
                traceId: `retry:${idempotencySeed}`
            });
        }

        runtimeDebug(
            "[CHECKOUT STEP 13] Manual payment created",
            {
                attemptId: payment?.attemptId || "",
                status:
                    payment?.paymentStatus || "",
                amount: payment?.amount ?? null,
                currency: payment?.currency || "",
                hasQr: Boolean(payment?.qr?.image),
                hasQrPayload: Boolean(
                    payment?.qr?.payload
                ),
                expiresAt:
                    payment?.expiresAt || ""
            }
        );

        const session = toCheckoutSession({
            checkout: checkoutResult.checkout,
            payment,
            method,
            catalog
        });

        runtimeDebug(
            "[CHECKOUT STEP 14] Checkout session ready",
            {
                commerceOrderId:
                    session.commerceOrderId,
                attemptId: session.attemptId,
                amount: session.amount,
                currency: session.currency,
                hasQrImage: Boolean(
                    session.qrImage
                ),
                hasDynamicQrImage: Boolean(
                    session.dynamicQr?.qrImage
                )
            }
        );

        return {
            checkout: checkoutResult.checkout,
            payment,
            session
        };
    } catch (error) {
        console.error(
            "[CHECKOUT ERROR] Checkout failed",
            {
                name: error?.name || "",
                code: error?.code || "",
                message: error?.message || "",
                stage: error?.stage || "",
                causeCode: error?.causeCode || "",
                statusCode:
                    error?.statusCode ||
                    error?.httpStatus ||
                    0,
                retryable:
                    error?.retryable === true
            }
        );

        if (redemption) {
            runtimeDebug(
                "[CHECKOUT CLEANUP] Releasing promotion",
                {
                    orderId:
                        checkoutResult?.checkout
                            ?.orderId ||
                        redemption.orderId ||
                        ""
                }
            );

            const released =
                await releaseCommercePromotion({
                    orderId:
                        checkoutResult?.checkout
                            ?.orderId ||
                        redemption.orderId,
                    promotionRedemptionSnapshot:
                        redemption
                });

            runtimeDebug(
                "[CHECKOUT CLEANUP] Promotion released",
                {
                    released: Boolean(released)
                }
            );

            if (
                released &&
                checkoutResult?.checkout?.orderId &&
                typeof (
                    dependencies.orderRepository ||
                    orderRepository
                ).setPromotionRedemptionSnapshot ===
                "function"
            ) {
                await (
                    dependencies.orderRepository ||
                    orderRepository
                ).setPromotionRedemptionSnapshot({
                    orderId:
                        checkoutResult.checkout.orderId,
                    promotionRedemptionSnapshot:
                        released,
                    changedAt: new Date()
                });

                runtimeDebug(
                    "[CHECKOUT CLEANUP] Order promotion snapshot updated"
                );
            }
        }

        throw error;
    }
}

module.exports = Object.freeze({
    assertReviewQuoteMatchesCheckout,
    assertAuthoritativeFulfillmentReady,
    loadPromptPayMethod,
    reviewCustomerCheckout,
    startCustomerManualPromptPayCheckout,
    CustomerManualPromptPayCheckoutError,
    ERROR_CODES
});
