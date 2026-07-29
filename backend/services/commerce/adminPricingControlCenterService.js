"use strict";

const CatalogProduct = require("../../models/CatalogProduct");
const CatalogPackage = require("../../models/CatalogPackage");
const { REGION_CURRENCIES, normalizePackageCode, normalizeProductCode, normalizeRegion } = require("../../catalog/catalogProjection");
const { buildProductionPricingContext } = require("./productionPricingContextService");
const { createPricingQuote } = require("./pricingQuoteRuntime");
const { loadCommercePromotionContext } = require("./commercePromotionBridgeService");
const { updatePackage } = require("../catalogAdminService");

const PROFITABILITY_STATUS = Object.freeze({
    HEALTHY: "HEALTHY",
    LOW_MARGIN: "LOW_MARGIN",
    NEGATIVE_MARGIN: "NEGATIVE_MARGIN",
    PRICE_BELOW_COST: "PRICE_BELOW_COST",
    UNKNOWN_SUPPLIER_COST: "UNKNOWN_SUPPLIER_COST",
    EXCHANGE_RATE_MISSING: "EXCHANGE_RATE_MISSING",
    INVALID_CONFIGURATION: "INVALID_CONFIGURATION"
});

class AdminPricingControlCenterError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message);
        this.name = "AdminPricingControlCenterError";
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

function text(value) {
    return String(value || "").trim();
}

function upper(value) {
    return text(value).toUpperCase();
}

function amount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function safeNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function round(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : null;
}

function selectedPrice(existing = {}, draft = {}, region) {
    const currency = REGION_CURRENCIES[region];
    const merged = {
        ...existing,
        ...draft,
        currency,
        enabled: draft.enabled !== undefined ? draft.enabled !== false : existing.enabled !== false
    };

    if (Object.prototype.hasOwnProperty.call(draft, "amount")) {
        merged.amount = amount(draft.amount);
    }
    if (Object.prototype.hasOwnProperty.call(draft, "supplierCost")) {
        merged.supplierCost = amount(draft.supplierCost);
    }
    merged.supplierCurrency = upper(draft.supplierCurrency || existing.supplierCurrency || currency);
    merged.supplierName = text(draft.supplierName ?? existing.supplierName);
    merged.supplierVersion = text(draft.supplierVersion ?? existing.supplierVersion);
    merged.supplierCostTimestamp = draft.supplierCostTimestamp ?? existing.supplierCostTimestamp ?? null;
    merged.pricingNote = text(draft.pricingNote ?? existing.pricingNote);

    return merged;
}

function warning(code, message) {
    return { code, message };
}

function statusFromQuote({ quote, supplierConfigured }) {
    if (!supplierConfigured) return PROFITABILITY_STATUS.UNKNOWN_SUPPLIER_COST;
    const business = quote?.pricingSnapshot?.businessRuntime || {};
    const profit = safeNumber(business.netProfit);
    const margin = safeNumber(business.marginPercent);
    if (business.priceBelowCost === true) return PROFITABILITY_STATUS.PRICE_BELOW_COST;
    if (profit != null && profit < 0) return PROFITABILITY_STATUS.NEGATIVE_MARGIN;
    if (margin != null && margin < 8) return PROFITABILITY_STATUS.LOW_MARGIN;
    return PROFITABILITY_STATUS.HEALTHY;
}

function previewFromQuote({ quote, context, price, couponCode }) {
    const supplierSnapshot = context.pricing.pricingInput.context.supplierCostSnapshot || {};
    const exchangeSnapshot = context.pricing.pricingInput.context.exchangeRateSnapshot || null;
    const pricing = quote.pricingSnapshot || {};
    const business = pricing.businessRuntime || {};
    const commercial = quote.commercialSnapshot || {};
    const promotion = quote.promotionSnapshot || null;
    const supplierConfigured = supplierSnapshot.configured === true;
    const status = statusFromQuote({ quote, supplierConfigured });
    const warnings = [];

    if (!supplierConfigured) {
        warnings.push(warning("UNKNOWN_SUPPLIER_COST", "Supplier cost not configured. Profit and margin are compatibility estimates only."));
    }
    if (status === PROFITABILITY_STATUS.LOW_MARGIN) warnings.push(warning("LOW_MARGIN", "Margin is below the recommended operating threshold."));
    if (status === PROFITABILITY_STATUS.NEGATIVE_MARGIN) warnings.push(warning("NEGATIVE_MARGIN", "This price creates a loss after business costs."));
    if (status === PROFITABILITY_STATUS.PRICE_BELOW_COST) warnings.push(warning("PRICE_BELOW_COST", "Selling price is below supplier cost."));
    if (couponCode && !promotion?.selectedPromotion) {
        warnings.push(warning("COUPON_NOT_APPLIED", "Coupon was not eligible for this package preview."));
    }

    return {
        success: true,
        region: quote.commercialSnapshot.region,
        currency: quote.commercialSnapshot.currency,
        sellingPrice: round(price.amount),
        supplierCost: supplierConfigured ? round(supplierSnapshot.amount) : null,
        supplierCurrency: supplierSnapshot.currency || price.supplierCurrency || price.currency,
        supplierCostConfigured: supplierConfigured,
        supplierName: supplierSnapshot.supplierName || "",
        supplierVersion: supplierSnapshot.supplierVersion || "",
        supplierCostTimestamp: supplierSnapshot.costTimestamp || null,
        exchangeRatePair: exchangeSnapshot ? `${exchangeSnapshot.sourceCurrency}_${exchangeSnapshot.targetCurrency}` : "",
        exchangeRate: exchangeSnapshot?.rate ?? null,
        exchangeRateSource: exchangeSnapshot?.source || "",
        exchangeRateProvider: exchangeSnapshot?.provider || "",
        exchangeRateCapturedAt: exchangeSnapshot?.capturedAt || null,
        conversionRequired: Boolean(exchangeSnapshot && exchangeSnapshot.sourceCurrency !== exchangeSnapshot.targetCurrency),
        convertedSupplierCost: round(pricing.supplierCostInTargetCurrency ?? business.convertedSupplierCost),
        baseSellingPrice: round(commercial.originalPrice),
        discountAmount: round(commercial.discountAmount || 0),
        finalPayableAmount: round(commercial.quotedTotalAmount),
        gatewayFee: round(business.gatewayFee),
        walletFee: round(business.walletFee || 0),
        netRevenue: round(business.netRevenue),
        grossProfit: supplierConfigured ? round(business.grossProfit) : null,
        netProfit: supplierConfigured ? round(business.netProfit) : null,
        marginPercent: supplierConfigured ? round(business.marginPercent) : null,
        profitabilityStatus: status,
        marginEnforcementApplied: business.marginEnforcementApplied === true,
        coupon: couponCode ? {
            code: couponCode,
            applied: Boolean(promotion?.selectedPromotion),
            selectedPromotion: promotion?.selectedPromotion || null,
            discountAmount: round(commercial.discountAmount || 0)
        } : null,
        warnings,
        blockingErrors: []
    };
}

async function loadPackage(productCode, packageCode) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const normalizedPackageCode = normalizePackageCode(packageCode);
    const [product, pkg] = await Promise.all([
        CatalogProduct.findOne({ productCode: normalizedProductCode }).lean(),
        CatalogPackage.findOne({ productCode: normalizedProductCode, packageCode: normalizedPackageCode }).lean()
    ]);
    if (!product) {
        throw new AdminPricingControlCenterError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
    }
    if (!pkg) {
        throw new AdminPricingControlCenterError("CATALOG_PACKAGE_NOT_FOUND", "Package not found.", 404);
    }
    return { product, pkg };
}

async function previewPackagePricing({ productCode, packageCode, region, priceDraft = {}, couponCode = "", actor = null } = {}) {
    const normalizedRegion = normalizeRegion(region);
    const { product, pkg } = await loadPackage(productCode, packageCode);
    const existing = pkg.prices?.[normalizedRegion];
    if (!existing) {
        throw new AdminPricingControlCenterError("CATALOG_PRICE_NOT_FOUND", "Regional price is not configured.", 404);
    }
    const price = selectedPrice(existing, priceDraft, normalizedRegion);
    if (!price.amount || price.amount <= 0) {
        throw new AdminPricingControlCenterError("INVALID_CONFIGURATION", "Selling price is required.", 400);
    }

    const draftPackage = {
        ...pkg,
        prices: {
            ...pkg.prices,
            [normalizedRegion]: price
        }
    };

    let context;
    try {
        context = await buildProductionPricingContext({
            pkg: draftPackage,
            price,
            catalog: {
                productCode: product.productCode,
                productName: product.name,
                packageCode: pkg.packageCode,
                packageName: pkg.name
            },
            region: normalizedRegion,
            currency: price.currency
        });
    } catch (error) {
        const isExchangeError = /exchange rate/i.test(error.message || "");
        return {
            success: true,
            region: normalizedRegion,
            currency: price.currency,
            sellingPrice: round(price.amount),
            supplierCost: price.supplierCost == null ? null : round(price.supplierCost),
            supplierCurrency: price.supplierCurrency || price.currency,
            supplierCostConfigured: price.supplierCost != null,
            profitabilityStatus: isExchangeError ? PROFITABILITY_STATUS.EXCHANGE_RATE_MISSING : PROFITABILITY_STATUS.INVALID_CONFIGURATION,
            warnings: [],
            blockingErrors: [warning(isExchangeError ? "EXCHANGE_RATE_MISSING" : "INVALID_CONFIGURATION", error.message || "Pricing preview unavailable.")]
        };
    }

    const code = upper(couponCode);
    let promotionContext = null;
    if (code) {
        try {
            promotionContext = await loadCommercePromotionContext({
                couponCode: code,
                catalog: {
                    productCode: product.productCode,
                    productName: product.name,
                    packageCode: pkg.packageCode,
                    packageName: pkg.name,
                    region: normalizedRegion,
                    currency: price.currency,
                    amount: price.amount
                },
                owner: { userId: "admin-pricing-preview" },
                packageContext: context.packageContext
            });
        } catch (error) {
            promotionContext = {
                promotions: [],
                campaigns: [],
                context: { couponCode: code },
                strategy: { mode: "BEST_PRICE" },
                previewError: error.message || "Coupon preview unavailable."
            };
        }
    }

    const quote = createPricingQuote({
        quoteId: `admin-preview:${product.productCode}:${pkg.packageCode}:${normalizedRegion}:${Date.now()}`,
        issuedAt: new Date().toISOString(),
        validitySeconds: 300,
        owner: { userId: actor?.id || actor?.username || "admin-pricing-preview" },
        request: {
            region: normalizedRegion,
            currency: price.currency,
            package: {
                ...context.packageContext,
                quantity: 1
            },
            couponCode: code
        },
        pricingInput: context.pricing.pricingInput,
        promotionInput: promotionContext ? {
            promotions: promotionContext.promotions || [],
            campaigns: promotionContext.campaigns || [],
            context: promotionContext.context || {},
            strategy: promotionContext.strategy || {}
        } : null,
        versionContext: context.pricing.versionContext
    });

    const preview = previewFromQuote({ quote, context, price, couponCode: code });
    if (promotionContext?.previewError) {
        preview.warnings.push(warning("COUPON_PREVIEW_UNAVAILABLE", promotionContext.previewError));
    }
    return preview;
}

function normalizeBulkRow(row = {}) {
    const region = normalizeRegion(row.region);
    const supplierCost = amount(row.supplierCost);
    if (supplierCost == null) {
        throw new AdminPricingControlCenterError("INVALID_SUPPLIER_COST", "Each row requires a valid supplier cost.");
    }
    return {
        productCode: normalizeProductCode(row.productCode),
        packageCode: normalizePackageCode(row.packageCode),
        region,
        supplierCost,
        supplierCurrency: upper(row.supplierCurrency || REGION_CURRENCIES[region]),
        supplierName: text(row.supplierName),
        supplierVersion: text(row.supplierVersion),
        supplierCostTimestamp: row.supplierCostTimestamp || new Date().toISOString(),
        pricingNote: text(row.pricingNote)
    };
}

async function bulkBackfillSupplierCosts({ rows = [], overwrite = false, actor = "admin" } = {}) {
    if (!Array.isArray(rows) || !rows.length) {
        throw new AdminPricingControlCenterError("BULK_SUPPLIER_COST_EMPTY", "At least one supplier-cost row is required.");
    }
    if (rows.length > 250) {
        throw new AdminPricingControlCenterError("BULK_SUPPLIER_COST_TOO_LARGE", "Supplier-cost backfill is limited to 250 rows at a time.");
    }

    const normalizedRows = rows.map(normalizeBulkRow);
    const results = [];

    for (const row of normalizedRows) {
        const pkg = await CatalogPackage.findOne({
            productCode: row.productCode,
            packageCode: row.packageCode
        });
        if (!pkg) {
            results.push({ ...row, updated: false, skipped: true, reason: "Package not found" });
            continue;
        }
        const existing = pkg.prices?.[row.region];
        if (!existing) {
            results.push({ ...row, updated: false, skipped: true, reason: "Regional price not configured" });
            continue;
        }
        if (existing.supplierCost != null && overwrite !== true) {
            results.push({ ...row, updated: false, skipped: true, reason: "Supplier cost already configured" });
            continue;
        }

        const patch = {
            prices: {
                [row.region]: {
                    supplierCost: row.supplierCost,
                    supplierCurrency: row.supplierCurrency,
                    supplierName: row.supplierName,
                    supplierVersion: row.supplierVersion,
                    supplierCostTimestamp: row.supplierCostTimestamp,
                    pricingNote: row.pricingNote
                }
            },
            expectedUpdatedAt: pkg.updatedAt
        };
        const result = await updatePackage({
            productCode: row.productCode,
            packageCode: row.packageCode,
            patch,
            actor
        });
        results.push({ ...row, updated: result.changed === true, skipped: result.changed !== true, reason: result.changed ? "" : "No changes" });
    }

    return {
        success: true,
        updatedCount: results.filter(item => item.updated).length,
        skippedCount: results.filter(item => item.skipped).length,
        results
    };
}

module.exports = Object.freeze({
    AdminPricingControlCenterError,
    PROFITABILITY_STATUS,
    bulkBackfillSupplierCosts,
    previewPackagePricing
});
