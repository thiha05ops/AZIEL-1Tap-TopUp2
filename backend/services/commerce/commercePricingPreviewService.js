"use strict";

const crypto = require("crypto");
const CatalogProduct = require("../../models/CatalogProduct");
const CatalogPackage = require("../../models/CatalogPackage");
const { findCatalogPackageByIdentity } = require("./catalogPackageIdentityService");
const { isCanonicalProductCode } = require("../../catalog/canonicalOperationalCatalog");
const { isProductPubliclyEligible, productSupportsRegion } = require("../../catalog/productRegionAuthority");
const { createPricingQuote } = require("./pricingQuoteRuntime");
const { buildProductionPricingContext } = require("./productionPricingContextService");
const { loadCommercePromotionContext } = require("./commercePromotionBridgeService");

class CommercePricingPreviewError extends Error {
    constructor(code, message, statusCode = 400, availabilityCode = "") {
        super(message);
        this.name = "CommercePricingPreviewError";
        this.code = code;
        this.statusCode = statusCode;
        this.availabilityCode = availabilityCode;
    }
}

const text = value => String(value || "").trim();
const upper = value => text(value).toUpperCase();

function normalizeRegion(value) {
    const region = upper(value);
    if (!["MM", "TH"].includes(region)) throw new CommercePricingPreviewError("INVALID_PRICING_PREVIEW", "Unsupported region.");
    return region;
}

function normalizeCurrency(value, region) {
    const currency = upper(value) || (region === "TH" ? "THB" : "MMK");
    if (!["MMK", "THB"].includes(currency)) throw new CommercePricingPreviewError("INVALID_PRICING_PREVIEW", "Unsupported currency.");
    return currency;
}

async function loadCatalogPackage(input = {}) {
    const productCode = text(input.productCode || input.gameKey).toLowerCase();
    const packageCode = upper(input.packageCode);
    const region = normalizeRegion(input.region);
    const currency = normalizeCurrency(input.currency, region);
    if (!productCode || !packageCode) throw new CommercePricingPreviewError("INVALID_PRICING_PREVIEW", "Package selection is required.");
    const product = await CatalogProduct.findOne({ productCode }).lean();
    if (!isCanonicalProductCode(productCode) || !product || !isProductPubliclyEligible(product)) {
        throw new CommercePricingPreviewError("PRODUCT_UNAVAILABLE", "Selected product is no longer available.", 409, "PRODUCT_DISABLED");
    }
    if (!productSupportsRegion(product, region)) {
        throw new CommercePricingPreviewError("PRODUCT_REGION_UNAVAILABLE", "Selected product is not available in this region.", 409, "REGION_UNAVAILABLE");
    }
    const pkg = await findCatalogPackageByIdentity(productCode, packageCode, { enabled: true, deletedAt: null }).lean();
    const price = pkg?.prices?.[region];
    if (!pkg || !price || price.enabled === false || upper(price.currency) !== currency) {
        throw new CommercePricingPreviewError("PACKAGE_UNAVAILABLE", "Selected package is no longer available.", 409, "PACKAGE_UNAVAILABLE");
    }
    return { product, pkg, price, productCode, packageCode: pkg.packageCode, region, currency };
}

function publicPreview(quote, catalog) {
    const promotion = quote.promotionSnapshot?.selectedPromotion || null;
    const businessRuntime = quote.pricingSnapshot?.businessRuntime || {};
    const currentAmount = Number(quote.commercialSnapshot.originalPrice || 0);
    const referencePrice = Number(catalog.price?.referencePrice || 0);
    const hasReferencePrice = Number.isFinite(referencePrice) && referencePrice > currentAmount;
    const saveAmount = hasReferencePrice ? Number((referencePrice - currentAmount).toFixed(6)) : 0;
    return {
        previewId: quote.quoteId,
        status: quote.status,
        productCode: catalog.productCode,
        packageCode: catalog.packageCode,
        packageName: catalog.pkg.name,
        region: catalog.region,
        currency: quote.commercialSnapshot.currency,
        baseAmount: quote.commercialSnapshot.originalPrice,
        originalAmount: quote.commercialSnapshot.originalPrice,
        discountAmount: quote.commercialSnapshot.discountAmount,
        finalAmount: quote.commercialSnapshot.quotedTotalAmount,
        referencePrice: hasReferencePrice ? referencePrice : 0,
        saveAmount,
        discountPercent: hasReferencePrice ? Math.round((saveAmount / referencePrice) * 100) : 0,
        supplierCostConfigured: businessRuntime.supplierCostConfigured === true,
        pricingSource: businessRuntime.supplierCostSource || "",
        promoCode: promotion?.code || "",
        promoType: promotion?.promotionType || "",
        issuedAt: quote.lifecycle.issuedAt,
        expiresAt: quote.lifecycle.expiresAt
    };
}

async function resolveCommercePricingPreviewDetailed(input = {}, context = {}, dependencies = {}) {
    const catalog = await (dependencies.loadCatalogPackage || loadCatalogPackage)(input);
    const issuedAt = dependencies.now ? new Date(dependencies.now) : new Date();
    const pricingContext = await (dependencies.buildPricingContext || buildProductionPricingContext)({
        pkg: catalog.pkg, price: catalog.price, catalog, region: catalog.region, currency: catalog.currency, now: issuedAt
    });
    const promoCode = upper(input.promoCode);
    const promotionContext = promoCode ? await (dependencies.loadPromotionContext || loadCommercePromotionContext)({
        couponCode: promoCode,
        catalog,
        user: context.user || null,
        owner: { userId: text(context.user?.id || context.user?._id), sessionId: text(context.sessionId) },
            packageContext: pricingContext.packageContext,
            readOnly: true
    }) : null;
    const quote = (dependencies.createPricingQuote || createPricingQuote)({
        quoteId: dependencies.quoteId || `AZP-${crypto.randomUUID()}`,
        issuedAt,
        validitySeconds: 300,
        owner: { userId: text(context.user?.id || context.user?._id), sessionId: text(context.sessionId) || "public-preview" },
        request: {
            region: catalog.region,
            currency: catalog.currency,
            package: { ...pricingContext.packageContext, quantity: 1 },
            paymentMethodId: "",
            couponCode: promoCode
        },
        pricingInput: pricingContext.pricing.pricingInput,
        promotionInput: promotionContext || undefined,
        versionContext: pricingContext.pricing.versionContext,
        trace: { issueSource: "product-detail-preview" }
    });
    return { quote, catalog, pricingContext, preview: publicPreview(quote, catalog) };
}

async function resolveCommercePricingPreview(input = {}, context = {}, dependencies = {}) {
    return (await resolveCommercePricingPreviewDetailed(input, context, dependencies)).preview;
}

module.exports = Object.freeze({
    loadCatalogPackage,
    resolveCommercePricingPreview,
    resolveCommercePricingPreviewDetailed,
    CommercePricingPreviewError
});
