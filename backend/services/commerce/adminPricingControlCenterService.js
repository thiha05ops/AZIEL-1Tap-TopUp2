"use strict";

const mongoose = require("mongoose");
const CatalogProduct = require("../../models/CatalogProduct");
const CatalogPackage = require("../../models/CatalogPackage");
const { REGION_CURRENCIES, normalizePackageCode, normalizeProductCode, normalizeRegion } = require("../../catalog/catalogProjection");
const { buildProductionPricingContext } = require("./productionPricingContextService");
const { createPricingQuote } = require("./pricingQuoteRuntime");
const { loadCommercePromotionContext } = require("./commercePromotionBridgeService");
const { resolveCommercePricingPreviewDetailed } = require("./commercePricingPreviewService");
const { updatePackage } = require("../catalogAdminService");
const { clearPublishedSupplierCostDraftRows } = require("./pricingWorkspaceDraftService");
const { resolvePricingSupplier } = require("./pricingSupplierService");

const PROFITABILITY_STATUS = Object.freeze({
    HEALTHY: "HEALTHY",
    LOW_MARGIN: "LOW_MARGIN",
    NEGATIVE_MARGIN: "NEGATIVE_MARGIN",
    PRICE_BELOW_COST: "PRICE_BELOW_COST",
    UNKNOWN_SUPPLIER_COST: "UNKNOWN_SUPPLIER_COST",
    EXCHANGE_RATE_MISSING: "EXCHANGE_RATE_MISSING",
    INVALID_CONFIGURATION: "INVALID_CONFIGURATION"
});

const WORKSPACE_REGIONS = Object.freeze(["TH", "MM"]);
const MAX_WORKSPACE_ROWS = 250;
const PAYMENT_FEE_METHODS = Object.freeze([
    { method: "Wallet", type: "WALLET", providerCostRate: 0 },
    { method: "Manual PromptPay", type: "MANUAL_PROMPTPAY", providerCostRate: 0.004 },
    { method: "Gateway/Card", type: "GATEWAY", providerCostRate: 0.025 }
]);

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
    if (value == null || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function positiveAmount(value) {
    const numeric = amount(value);
    return numeric != null && numeric > 0 ? numeric : null;
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
    merged.publishedPriceMode = upper(draft.publishedPriceMode || existing.publishedPriceMode || "LEGACY_COMPATIBILITY_PRICE");
    merged.manualOverrideReason = text(draft.manualOverrideReason ?? existing.manualOverrideReason);

    return merged;
}

function warning(code, message) {
    return { code, message };
}

function uniqueRows(rows = []) {
    const seen = new Set();
    return rows.filter(row => {
        const key = `${row.productCode}:${row.packageCode}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function rowKey(row = {}) {
    return `${normalizeProductCode(row.productCode)}:${normalizePackageCode(row.packageCode)}`;
}

function workspaceRegions(region) {
    const normalized = upper(region || "");
    if (!normalized || normalized === "ALL") return [...WORKSPACE_REGIONS];
    return [normalizeRegion(normalized)];
}

function normalizeWorkspaceRow(row = {}, index = 0) {
    const productCode = normalizeProductCode(row.productCode);
    const packageCode = normalizePackageCode(row.packageCode);
    const rawSupplierCost = row.newSupplierCost ?? row.supplierCost;
    const newSupplierCost = rawSupplierCost == null || rawSupplierCost === "" ? null : positiveAmount(rawSupplierCost);
    const supplierCurrency = upper(row.supplierCurrency || "THB");
    if (!productCode || !packageCode) {
        throw new AdminPricingControlCenterError("WORKSPACE_ROW_INVALID", `Row ${index + 1} requires productCode and packageCode.`);
    }
    if (rawSupplierCost != null && rawSupplierCost !== "" && newSupplierCost == null) {
        throw new AdminPricingControlCenterError("WORKSPACE_SUPPLIER_COST_INVALID", `Row ${index + 1} requires a positive supplier cost.`);
    }
    if (!["MMK", "THB"].includes(supplierCurrency)) {
        throw new AdminPricingControlCenterError("WORKSPACE_SUPPLIER_CURRENCY_INVALID", `Row ${index + 1} has an unsupported supplier currency.`);
    }
    return {
        rowId: text(row.rowId) || `${productCode}:${packageCode}`,
        productCode,
        packageCode,
        selected: row.selected !== false,
        newSupplierCost,
        supplierCurrency,
        supplierName: text(row.supplierName),
        supplierVersion: text(row.supplierVersion),
        supplierCostTimestamp: row.supplierCostTimestamp || new Date().toISOString(),
        pricingNote: text(row.pricingNote),
        expectedUpdatedAt: row.expectedUpdatedAt || null,
        manualPublishedPrice: amount(row.manualPublishedPrice),
        manualOverrideReason: text(row.manualOverrideReason),
        publishedPriceMode: upper(row.publishedPriceMode || "")
    };
}

function invalidWorkspaceRow(row = {}, index = 0, error) {
    const productCode = text(row.productCode || row.product || "");
    const packageCode = text(row.packageCode || row.package || "");
    return {
        rowId: text(row.rowId) || `${productCode || "row"}:${packageCode || index}`,
        productCode,
        packageCode,
        productName: productCode || "Unmatched product",
        packageName: packageCode || `Invalid row ${index + 1}`,
        oldSupplierCost: null,
        newSupplierCost: amount(row.newSupplierCost ?? row.supplierCost),
        supplierCurrency: upper(row.supplierCurrency || ""),
        expectedUpdatedAt: row.expectedUpdatedAt || null,
        changed: false,
        selected: row.selected !== false,
        status: "Blocked",
        publishEligible: false,
        warnings: [],
        blockingErrors: [warning(error?.code || "WORKSPACE_ROW_INVALID", error?.message || `Row ${index + 1} is invalid.`)],
        regions: []
    };
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
    let status = statusFromQuote({ quote, supplierConfigured });
    const warnings = [];

    if (!supplierConfigured) {
        warnings.push(warning("UNKNOWN_SUPPLIER_COST", "Authoritative supplier cost is unavailable. Profit and margin are not calculated."));
    }
    if (status === PROFITABILITY_STATUS.LOW_MARGIN) warnings.push(warning("LOW_MARGIN", "Margin is below the recommended operating threshold."));
    if (status === PROFITABILITY_STATUS.NEGATIVE_MARGIN) warnings.push(warning("NEGATIVE_MARGIN", "This price creates a loss after business costs."));
    if (status === PROFITABILITY_STATUS.PRICE_BELOW_COST) warnings.push(warning("PRICE_BELOW_COST", "Selling price is below supplier cost."));
    if (couponCode && !promotion?.selectedPromotion) {
        warnings.push(warning("COUPON_NOT_APPLIED", "Coupon was not eligible for this package preview."));
    }

    const finalPayable = round(commercial.quotedTotalAmount);
    const convertedSupplierCost = supplierConfigured ? round(pricing.result?.postExchangeSubtotal) : null;
    const gatewayFee = round(pricing.result?.gatewayFeeAmount ?? business.gatewayFee ?? 0);
    const platformFee = round(pricing.result?.platformFeeAmount ?? 0);
    const grossProfit = supplierConfigured ? round(pricing.result?.calculatedProfitAmount) : null;
    const netProfit = supplierConfigured ? round(pricing.result?.calculatedProfitAmount ?? business.netProfit) : null;
    const marginPercent = supplierConfigured ? round(pricing.result?.calculatedMarginPercent ?? business.marginPercent) : null;
    const minimumProfitAmount = Number(context.pricing.pricingInput.policy?.minimumProfitAmount || 0);
    const minimumMarginPercent = Number(context.pricing.pricingInput.policy?.minimumProfitMarginPercent || 0);
    if (netProfit != null && netProfit < 0) status = PROFITABILITY_STATUS.NEGATIVE_MARGIN;
    if (netProfit != null && netProfit >= 0 && (netProfit < minimumProfitAmount || (marginPercent != null && marginPercent < minimumMarginPercent))) {
        status = PROFITABILITY_STATUS.LOW_MARGIN;
    }
    const paymentFeeSimulation = PAYMENT_FEE_METHODS.map(method => {
        const providerCost = round((finalPayable || 0) * method.providerCostRate);
        const netProfit = business.netProfit == null ? null : round((business.netProfit || 0) - (providerCost || 0));
        const marginPercent = finalPayable ? round(((netProfit || 0) / finalPayable) * 100) : null;
        return {
            method: method.method,
            type: method.type,
            customerPayable: finalPayable,
            paymentFeeChargedToCustomer: round(method.type === "GATEWAY" ? (business.gatewayFee || 0) : 0),
            providerCost,
            netRevenue: round((business.netRevenue || finalPayable || 0) - (providerCost || 0)),
            netProfit: supplierConfigured ? netProfit : null,
            marginPercent: supplierConfigured ? marginPercent : null
        };
    });
    const referencePrice = round(Math.max(Number(price.referencePrice || 0), Number(price.amount || 0)));
    const publishedPrice = round(commercial.originalPrice);
    const saveAmount = referencePrice && publishedPrice ? round(referencePrice - publishedPrice) : 0;
    const displayDiscountPercent = referencePrice && saveAmount > 0 ? round((saveAmount / referencePrice) * 100) : 0;

    return {
        success: true,
        region: quote.commercialSnapshot.region,
        currency: quote.commercialSnapshot.currency,
        sellingPrice: round(price.amount),
        publishedPriceMode: price.publishedPriceMode || "LEGACY_COMPATIBILITY_PRICE",
        manualOverrideReason: price.manualOverrideReason || "",
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
        convertedSupplierCost,
        recommendedSellingPrice: round(pricing.result?.preOverridePrice ?? pricing.result?.regularPrice ?? commercial.originalPrice),
        manualPublishedPrice: pricing.result?.preOverridePrice != null ? round(commercial.originalPrice) : null,
        publishedPriceDifference: pricing.result?.preOverridePrice != null
            ? round(commercial.originalPrice - pricing.result.preOverridePrice)
            : 0,
        baseSellingPrice: round(commercial.originalPrice),
        discountAmount: round(commercial.discountAmount || 0),
        finalPayableAmount: finalPayable,
        referencePrice,
        publishedPrice,
        saveAmount,
        displayDiscountPercent,
        paymentFeeSimulation,
        gatewayFee,
        platformFee,
        walletFee: round(business.walletFee || 0),
        netRevenue: round(business.netRevenue),
        grossProfit,
        netProfit,
        marginPercent,
        profitabilityStatus: status,
        minimumProfitAmount,
        minimumMarginPercent,
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

function previewFailure({ row, pkg, product, region, price, error }) {
    const isExchangeError = /exchange rate/i.test(error.message || "");
    return {
        success: true,
        region,
        currency: REGION_CURRENCIES[region],
        sellingPrice: round(price?.amount),
        supplierCost: row.newSupplierCost,
        supplierCurrency: row.supplierCurrency,
        supplierCostConfigured: row.newSupplierCost != null,
        productCode: product?.productCode || row.productCode,
        packageCode: pkg?.packageCode || row.packageCode,
        profitabilityStatus: isExchangeError ? PROFITABILITY_STATUS.EXCHANGE_RATE_MISSING : PROFITABILITY_STATUS.INVALID_CONFIGURATION,
        warnings: [],
        blockingErrors: [warning(isExchangeError ? "EXCHANGE_RATE_MISSING" : "INVALID_CONFIGURATION", error.message || "Pricing preview unavailable.")]
    };
}

async function previewLoadedPackageRegion({ product, pkg, region, row, couponCode = "", actor = null } = {}) {
    const existing = pkg.prices?.[region];
    if (!existing || existing.enabled === false) {
        return {
            success: true,
            region,
            currency: REGION_CURRENCIES[region],
            productCode: product.productCode,
            packageCode: pkg.packageCode,
            supplierCost: row.newSupplierCost,
            supplierCurrency: row.supplierCurrency,
            profitabilityStatus: PROFITABILITY_STATUS.INVALID_CONFIGURATION,
            warnings: [],
            blockingErrors: [warning("REGIONAL_PRICE_UNAVAILABLE", `${region} price is not configured for this package.`)]
        };
    }
    if (row.newSupplierCost == null) {
        return {
            success: true,
            region,
            currency: REGION_CURRENCIES[region],
            sellingPrice: round(existing.amount),
            publishedPrice: round(existing.amount),
            recommendedSellingPrice: null,
            finalPayableAmount: round(existing.amount),
            referencePrice: round(Math.max(Number(existing.referencePrice || 0), Number(existing.amount || 0))),
            supplierCost: null,
            supplierCurrency: row.supplierCurrency || existing.supplierCurrency || existing.currency,
            supplierCostConfigured: false,
            productCode: product.productCode,
            packageCode: pkg.packageCode,
            publishedPriceMode: existing.publishedPriceMode || "LEGACY_COMPATIBILITY_PRICE",
            manualOverrideReason: existing.manualOverrideReason || "",
            paymentFeeSimulation: [],
            grossProfit: null,
            netProfit: null,
            marginPercent: null,
            profitabilityStatus: PROFITABILITY_STATUS.UNKNOWN_SUPPLIER_COST,
            warnings: [warning("LEGACY_PRICE_ACTIVE", "Existing storefront price remains unchanged until a true supplier cost is staged.")],
            blockingErrors: [warning("UNKNOWN_SUPPLIER_COST", "Supplier cost missing — enter or paste supplier cost.")]
        };
    }

    const priceDraft = {
        supplierCost: row.newSupplierCost,
        supplierCurrency: row.supplierCurrency,
        supplierName: row.supplierName || existing.supplierName || "",
        supplierVersion: row.supplierVersion || existing.supplierVersion || "",
        supplierCostTimestamp: row.supplierCostTimestamp || existing.supplierCostTimestamp || new Date().toISOString(),
        pricingNote: row.pricingNote || existing.pricingNote || ""
    };
    if (row.publishedPriceMode) priceDraft.publishedPriceMode = row.publishedPriceMode;
    if (row.manualPublishedPrice != null) priceDraft.amount = row.manualPublishedPrice;
    if (row.manualOverrideReason) priceDraft.manualOverrideReason = row.manualOverrideReason;
    const price = selectedPrice(existing, priceDraft, region);

    try {
        const draftPackage = {
            ...pkg,
            prices: {
                ...pkg.prices,
                [region]: price
            }
        };
        const context = await buildProductionPricingContext({
            pkg: draftPackage,
            price,
            catalog: {
                productCode: product.productCode,
                productName: product.name,
                packageCode: pkg.packageCode,
                packageName: pkg.name
            },
            region,
            currency: price.currency,
            includePublishedPriceOverride: false
        });
        const quote = createPricingQuote({
            quoteId: `daily-pricing-preview:${product.productCode}:${pkg.packageCode}:${region}:${Date.now()}`,
            issuedAt: new Date().toISOString(),
            validitySeconds: 300,
            owner: { userId: actor?.id || actor?.username || "admin-pricing-workspace" },
            request: {
                region,
                currency: price.currency,
                package: {
                    ...context.packageContext,
                    quantity: 1
                },
                couponCode: upper(couponCode)
            },
            pricingInput: context.pricing.pricingInput,
            promotionInput: null,
            versionContext: context.pricing.versionContext
        });
        const preview = previewFromQuote({ quote, context, price, couponCode: upper(couponCode) });
        return {
            ...preview,
            productCode: product.productCode,
            packageCode: pkg.packageCode,
            effectivePolicySource: context.pricing.versionContext?.policySource || "production",
            policyScope: context.pricing.versionContext?.scope || "REGION",
            policyVersionId: context.pricing.versionContext?.priceVersionId || "",
            policyVersionNumber: context.pricing.versionContext?.priceVersionNumber || null,
            calculatedAt: new Date().toISOString(),
            exchangeSnapshot: context.pricing.pricingInput.context.exchangeRateSnapshot || null
        };
    } catch (error) {
        return previewFailure({ row, pkg, product, region, price, error });
    }
}

function rowStatusFromRegional(regional = []) {
    const blockingErrors = regional.flatMap(item => item.blockingErrors || []);
    const warnings = regional.flatMap(item => item.warnings || []);
    if (blockingErrors.length) return "Blocked";
    if (regional.some(item => item.profitabilityStatus === PROFITABILITY_STATUS.NEGATIVE_MARGIN || item.profitabilityStatus === PROFITABILITY_STATUS.PRICE_BELOW_COST)) return "Blocked";
    if (regional.some(item => item.profitabilityStatus === PROFITABILITY_STATUS.LOW_MARGIN) || warnings.length) return "Warning";
    return "Ready";
}

function operatorRegionStatus(item = {}) {
    if (item.blockingErrors?.length || [PROFITABILITY_STATUS.NEGATIVE_MARGIN, PROFITABILITY_STATUS.PRICE_BELOW_COST, PROFITABILITY_STATUS.INVALID_CONFIGURATION, PROFITABILITY_STATUS.EXCHANGE_RATE_MISSING].includes(item.profitabilityStatus)) return "BLOCKED";
    if (item.warnings?.length || item.profitabilityStatus === PROFITABILITY_STATUS.LOW_MARGIN) return "WARNING";
    return item.supplierCostConfigured === false ? "MISSING" : "READY";
}

function withRegionalContract(row = {}) {
    const regionalResults = {};
    (row.regions || []).forEach(item => {
        regionalResults[item.region] = {
            storeCurrency: item.currency,
            exchangeRate: item.exchangeRate,
            convertedSupplierCost: item.convertedSupplierCost,
            sellingPrice: item.recommendedSellingPrice,
            gatewayFee: item.gatewayFee,
            platformFee: item.platformFee,
            netProfit: item.netProfit,
            marginPercent: item.marginPercent,
            status: operatorRegionStatus(item),
            reason: item.blockingErrors?.[0]?.message || item.warnings?.[0]?.message || "",
            policyVersionId: item.policyVersionId || "",
            policyVersionNumber: item.policyVersionNumber || null,
            calculatedAt: item.calculatedAt || null
        };
    });
    const statuses = Object.values(regionalResults).map(item => item.status);
    const aggregateStatus = statuses.includes("BLOCKED") ? "BLOCKED" : statuses.includes("WARNING") ? "WARNING" : statuses.includes("MISSING") ? "MISSING" : "READY";
    return { ...row, aggregateStatus, regionalResults };
}

function summarizeWorkspaceRows(rows = []) {
    const configuredProfitabilityRows = rows.filter(row => row.regions?.some(item => item.supplierCostConfigured === true));
    return {
        packagesLoaded: rows.length,
        packageRows: rows.length,
        regionalPriceRows: rows.reduce((sum, row) => sum + (Array.isArray(row.regions) ? row.regions.length : 0), 0),
        changed: rows.filter(row => row.changed).length,
        ready: rows.filter(row => row.status === "Ready").length,
        lowMargin: configuredProfitabilityRows.filter(row => row.regions?.some(item => item.profitabilityStatus === PROFITABILITY_STATUS.LOW_MARGIN)).length,
        negativeMargin: configuredProfitabilityRows.filter(row => row.regions?.some(item => item.profitabilityStatus === PROFITABILITY_STATUS.NEGATIVE_MARGIN || item.profitabilityStatus === PROFITABILITY_STATUS.PRICE_BELOW_COST)).length,
        missingSupplierCost: rows.filter(row => row.regions?.some(item => item.profitabilityStatus === PROFITABILITY_STATUS.UNKNOWN_SUPPLIER_COST)).length,
        missingExchangeRate: rows.filter(row => row.regions?.some(item => item.profitabilityStatus === PROFITABILITY_STATUS.EXCHANGE_RATE_MISSING)).length,
        manualOverrides: rows.filter(row => row.regions?.some(item => item.publishedPriceMode === "MANUAL_OVERRIDE")).length,
        legacyCompatibility: rows.filter(row => row.regions?.some(item => item.publishedPriceMode === "LEGACY_COMPATIBILITY_PRICE")).length,
        promoRisk: rows.filter(row => row.regions?.some(item => item.warnings?.some(warn => /COUPON|PROMO/i.test(warn.code)))).length,
        blocked: rows.filter(row => row.status === "Blocked").length
    };
}

async function batchPreviewDailyPricing({ rows = [], couponCode = "", actor = null, region = "", supplierId = "" } = {}) {
    if (!Array.isArray(rows) || !rows.length) {
        throw new AdminPricingControlCenterError("WORKSPACE_PREVIEW_EMPTY", "At least one staged price row is required.");
    }
    if (rows.length > MAX_WORKSPACE_ROWS) {
        throw new AdminPricingControlCenterError("WORKSPACE_PREVIEW_TOO_LARGE", `Daily pricing preview is limited to ${MAX_WORKSPACE_ROWS} rows.`);
    }

    const supplier = await resolvePricingSupplier({ supplierId, region });
    const packageIds = rows.filter(row => !row.packageCode && mongoose.Types.ObjectId.isValid(text(row.packageId))).map(row => row.packageId);
    const packagesById = packageIds.length
        ? new Map((await CatalogPackage.find({ _id: { $in: packageIds }, deletedAt: null }).select("_id productCode packageCode").lean()).map(pkg => [String(pkg._id), pkg]))
        : new Map();
    const resolvedInputRows = rows.map(row => {
        const pkg = packagesById.get(text(row.packageId));
        return pkg ? { ...row, productCode: row.productCode || row.productId || pkg.productCode, packageCode: pkg.packageCode } : { ...row, productCode: row.productCode || row.productId };
    });
    const invalidRows = [];
    const normalizedRows = [];
    resolvedInputRows.forEach((row, index) => {
        try {
            normalizedRows.push(normalizeWorkspaceRow({
                ...row,
                supplierCurrency: supplier.supplierCurrency,
                supplierName: supplier.supplierName,
                supplierId: supplier.supplierId,
                supplierCode: supplier.supplierCode
            }, index));
        } catch (error) {
            invalidRows.push(invalidWorkspaceRow(row, index, error));
        }
    });
    if (!normalizedRows.length) {
        return {
            success: true,
            generatedAt: new Date().toISOString(),
            couponCode: upper(couponCode),
            summary: summarizeWorkspaceRows(invalidRows),
            rows: invalidRows,
            unmatchedRows: invalidRows.length,
            duplicateKeys: []
        };
    }
    const duplicateKeys = normalizedRows
        .map(row => rowKey(row))
        .filter((key, index, list) => list.indexOf(key) !== index);
    const unique = uniqueRows(normalizedRows);
    const productCodes = [...new Set(unique.map(row => row.productCode))];
    const packageCodes = [...new Set(unique.map(row => row.packageCode))];
    const [products, packages] = await Promise.all([
        CatalogProduct.find({ productCode: { $in: productCodes } }).lean(),
        CatalogPackage.find({
            productCode: { $in: productCodes },
            packageCode: { $in: packageCodes },
            deletedAt: null
        }).lean()
    ]);
    const productMap = new Map(products.map(product => [product.productCode, product]));
    const packageMap = new Map(packages.map(pkg => [`${pkg.productCode}:${pkg.packageCode}`, pkg]));

    const previewRows = await Promise.all(unique.map(async row => {
        const product = productMap.get(row.productCode);
        const pkg = packageMap.get(rowKey(row));
        if (!product || !pkg) {
            return {
                rowId: row.rowId,
                productCode: row.productCode,
                packageCode: row.packageCode,
                productName: product?.name || row.productCode,
                packageName: pkg?.name || row.packageCode,
                oldSupplierCost: null,
                newSupplierCost: row.newSupplierCost,
                supplierCurrency: row.supplierCurrency,
                expectedUpdatedAt: row.expectedUpdatedAt,
                changed: false,
                status: "Blocked",
                warnings: [],
                blockingErrors: [warning(!product ? "PRODUCT_NOT_FOUND" : "PACKAGE_NOT_FOUND", !product ? "Product not found." : "Package not found.")],
                regions: []
            };
        }
        const regional = await Promise.all(workspaceRegions(region).map(region => previewLoadedPackageRegion({
            product,
            pkg,
            region,
            row,
            couponCode,
            actor
        })));
        const requestedRegions = workspaceRegions(region);
        const existingPrices = WORKSPACE_REGIONS.map(regionCode => pkg.prices?.[regionCode]).filter(Boolean);
        const selectedExistingPrices = requestedRegions
            .map(regionCode => pkg.prices?.[regionCode])
            .filter(Boolean);
        const selectedExistingPrice = selectedExistingPrices[0] || null;
        const oldSupplierCost = selectedExistingPrice?.supplierCost ?? null;
        const oldSupplierCurrency = selectedExistingPrice?.supplierCurrency || "";
        const changed = selectedExistingPrices.some(existingPrice => (
            Number(existingPrice?.supplierCost) !== Number(row.newSupplierCost) ||
            upper(existingPrice?.supplierCurrency) !== row.supplierCurrency
        ));
        const blockingErrors = regional.flatMap(item => item.blockingErrors || []);
        const warnings = regional.flatMap(item => item.warnings || []);
        if (duplicateKeys.includes(rowKey(row))) {
            warnings.push(warning("DUPLICATE_STAGED_ROW", "Duplicate pasted row detected. Only the first row is previewed."));
        }
        return {
            rowId: row.rowId,
            productCode: product.productCode,
            packageId: String(pkg._id),
            packageCode: pkg.packageCode,
            productName: product.name,
            packageName: pkg.name,
            supplierPackageCode: pkg.supplierPackageCode || pkg.metadata?.supplierPackageCode || pkg.packageCode,
            oldSupplierCost: oldSupplierCost == null ? null : round(oldSupplierCost),
            newSupplierCost: row.newSupplierCost,
            costDelta: oldSupplierCost == null ? null : round(row.newSupplierCost - Number(oldSupplierCost)),
            supplierCurrency: row.supplierCurrency,
            supplierName: row.supplierName || existingPrices.find(price => price?.supplierName)?.supplierName || "",
            supplierId: supplier.supplierId,
            supplierCode: supplier.supplierCode,
            supplierVersion: row.supplierVersion || existingPrices.find(price => price?.supplierVersion)?.supplierVersion || "",
            supplierCostTimestamp: row.supplierCostTimestamp,
            expectedUpdatedAt: row.expectedUpdatedAt || pkg.updatedAt,
            changed,
            selected: row.selected !== false,
            status: rowStatusFromRegional(regional),
            publishEligible: !blockingErrors.length && row.selected !== false,
            warnings,
            blockingErrors,
            regions: regional,
            history: Array.isArray(pkg.supplierCostHistory) ? pkg.supplierCostHistory.slice(-5) : []
        };
    }));

    const allRows = invalidRows.concat(previewRows).map(withRegionalContract);
    return {
        success: true,
        generatedAt: new Date().toISOString(),
        couponCode: upper(couponCode),
        summary: summarizeWorkspaceRows(allRows),
        rows: allRows,
        unmatchedRows: normalizedRows.length - unique.length,
        duplicateKeys: [...new Set(duplicateKeys)]
    };
}

async function publishDailyPricing({
    rows = [],
    publishAll = false,
    actor = "admin",
    admin = null,
    region = "",
    supplierId = "",
    skipDraftCleanup = false
} = {}) {
    if (publishAll === true) {
        throw new AdminPricingControlCenterError(
            "WORKSPACE_PUBLISH_ALL_DISABLED",
            "Publish All is temporarily disabled for Daily Pricing Workspace.",
            400
        );
    }

    const selectedRegions = workspaceRegions(region);
    if (!selectedRegions.length) {
        throw new AdminPricingControlCenterError(
            "WORKSPACE_REGION_REQUIRED",
            "Publish requires at least one selected region.",
            400
        );
    }

    /*
     * Resolve every selected region before previewing. The same supplier may be
     * returned for both regions, but keeping a per-region map preserves future
     * support for regional supplier assignments.
     */
    const supplierEntries = await Promise.all(selectedRegions.map(async selectedRegion => ([
        selectedRegion,
        await resolvePricingSupplier({ supplierId, region: selectedRegion })
    ])));
    const suppliersByRegion = new Map(supplierEntries);

    /*
     * Preview all requested regions in one pass. This produces one authoritative
     * calculated result per package and region from the active pricing policies.
     */
    const preview = await batchPreviewDailyPricing({
        rows,
        actor: admin || { username: actor },
        region: selectedRegions.length === WORKSPACE_REGIONS.length ? "ALL" : selectedRegions[0],
        supplierId
    });

    const selectedKeys = new Set();
    rows.forEach((row, index) => {
        if (!publishAll && row.selected === false) return;
        try {
            selectedKeys.add(rowKey(normalizeWorkspaceRow(row, index)));
        } catch (_) {
            // Invalid selected rows are represented by blocked preview rows.
        }
    });

    const normalizedInputByKey = new Map();
    rows.forEach((input, index) => {
        try {
            const normalized = normalizeWorkspaceRow(input, index);
            normalizedInputByKey.set(rowKey(normalized), normalized);
        } catch (_) {
            // Invalid rows are already represented by the preview.
        }
    });

    const results = [];

    for (const row of preview.rows) {
        const key = `${row.productCode}:${row.packageCode}`;

        if (!selectedKeys.has(key)) {
            selectedRegions.forEach(selectedRegion => {
                results.push({
                    region: selectedRegion,
                    productCode: row.productCode,
                    packageCode: row.packageCode,
                    published: false,
                    skipped: true,
                    reason: "Not selected"
                });
            });
            continue;
        }

        const normalized = normalizedInputByKey.get(key);
        if (!normalized) {
            selectedRegions.forEach(selectedRegion => {
                results.push({
                    region: selectedRegion,
                    productCode: row.productCode,
                    packageCode: row.packageCode,
                    published: false,
                    skipped: true,
                    reason: "Invalid staged row",
                    blockingErrors: row.blockingErrors || []
                });
            });
            continue;
        }

        const pricePatches = {};
        const publishableRegions = [];

        for (const selectedRegion of selectedRegions) {
            const regionalPreview = (row.regions || []).find(item => item.region === selectedRegion);
            const calculatedPrice = Number(regionalPreview?.recommendedSellingPrice);
            const regionalBlockingErrors = regionalPreview?.blockingErrors || [];

            if (
                !regionalPreview ||
                regionalBlockingErrors.length > 0 ||
                !Number.isFinite(calculatedPrice) ||
                calculatedPrice < 0
            ) {
                results.push({
                    region: selectedRegion,
                    productCode: row.productCode,
                    packageCode: row.packageCode,
                    published: false,
                    skipped: true,
                    reason: Number.isFinite(calculatedPrice)
                        ? "Blocked by pricing preview"
                        : "Calculated selling price unavailable",
                    blockingErrors: regionalBlockingErrors.length
                        ? regionalBlockingErrors
                        : row.blockingErrors || []
                });
                continue;
            }

            const supplier = suppliersByRegion.get(selectedRegion);
            pricePatches[selectedRegion] = {
                amount: calculatedPrice,
                publishedPriceMode: "POLICY_DERIVED",
                manualOverrideReason: "",
                supplierCost: normalized.newSupplierCost,
                supplierCurrency: supplier.supplierCurrency,
                supplierId: supplier.supplierId,
                supplierCode: supplier.supplierCode,
                supplierName: supplier.supplierName,
                supplierVersion: normalized.supplierVersion || row.supplierVersion || "",
                supplierCostTimestamp: normalized.supplierCostTimestamp,
                pricingNote: normalized.pricingNote
            };
            publishableRegions.push(selectedRegion);
        }

        if (!publishableRegions.length) continue;

        /*
         * Important: write TH and MM in one updatePackage() call. Previously the
         * service recursively published TH first and MM second using the same
         * expectedUpdatedAt value. The first write changed updatedAt, causing the
         * second regional write to become stale and leaving MM unchanged.
         */
        const canonicalSupplier = suppliersByRegion.get(publishableRegions[0]);
        const patch = {
            canonicalSupplierCost: {
                supplierId: canonicalSupplier.supplierId,
                supplierCode: canonicalSupplier.supplierCode,
                supplierName: canonicalSupplier.supplierName,
                amount: normalized.newSupplierCost,
                currency: canonicalSupplier.supplierCurrency,
                capturedAt: normalized.supplierCostTimestamp
            },
            prices: pricePatches,
            expectedUpdatedAt: normalized.expectedUpdatedAt || row.expectedUpdatedAt
        };

        try {
            const update = await updatePackage({
                productCode: row.productCode,
                packageCode: row.packageCode,
                patch,
                actor
            });

            publishableRegions.forEach(selectedRegion => {
                results.push({
                    region: selectedRegion,
                    productCode: row.productCode,
                    packageCode: row.packageCode,
                    published: update.changed === true,
                    supplierCost: normalized.newSupplierCost,
                    sellingPrice: pricePatches[selectedRegion].amount,
                    skipped: update.changed !== true,
                    reason: update.changed ? "" : "No changes",
                    changedFields: update.changedFields || []
                });
            });
        } catch (error) {
            publishableRegions.forEach(selectedRegion => {
                results.push({
                    region: selectedRegion,
                    productCode: row.productCode,
                    packageCode: row.packageCode,
                    published: false,
                    failed: true,
                    reason: error.message || "Publish failed",
                    code: error.code || "PUBLISH_FAILED"
                });
            });
        }
    }

    const cleanupRegion = selectedRegions.length === 1 ? selectedRegions[0] : undefined;
    const draftCleanup = skipDraftCleanup
        ? { cleared: 0 }
        : await clearPublishedSupplierCostDraftRows({
            rows: results,
            ...(cleanupRegion ? { region: cleanupRegion } : {})
        });

    return {
        success: true,
        generatedAt: new Date().toISOString(),
        summary: {
            requested: results.length,
            published: results.filter(item => item.published).length,
            failed: results.filter(item => item.failed).length,
            skipped: results.filter(item => item.skipped).length
        },
        previewSummary: preview.summary,
        results,
        draftCleanup
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
    const draftPrice = selectedPrice(existing, priceDraft, normalizedRegion);
    let detailed;
    try {
        detailed = await resolveCommercePricingPreviewDetailed({
            productCode: product.productCode,
            packageCode: pkg.packageCode,
            region: normalizedRegion,
            currency: existing.currency,
            promoCode: upper(couponCode)
        }, {
            user: actor || null,
            sessionId: "admin-pricing-preview"
        });
    } catch (error) {
        const isExchangeError = /exchange rate/i.test(error.message || "");
        return {
            success: true,
            region: normalizedRegion,
            currency: existing.currency,
            sellingPrice: round(existing.amount),
            supplierCost: null,
            supplierCurrency: existing.supplierCurrency || existing.currency,
            supplierCostConfigured: false,
            profitabilityStatus: isExchangeError ? PROFITABILITY_STATUS.EXCHANGE_RATE_MISSING : PROFITABILITY_STATUS.INVALID_CONFIGURATION,
            warnings: [],
            blockingErrors: [warning(isExchangeError ? "EXCHANGE_RATE_MISSING" : "PRICING_PREVIEW_UNAVAILABLE", error.message || "Pricing preview unavailable.")],
            authority: "COMMERCE_PRICING_RUNTIME",
            authoritative: false
        };
    }
    const preview = previewFromQuote({
        quote: detailed.quote,
        context: detailed.pricingContext,
        price: existing,
        couponCode: upper(couponCode)
    });
    preview.authority = "COMMERCE_PRICING_RUNTIME";
    preview.authoritative = true;
    preview.currentCommercePrice = preview.baseSellingPrice;
    preview.publishedCatalogPrice = round(existing.amount);
    preview.publishedPriceDifference = round(preview.currentCommercePrice - preview.publishedCatalogPrice);
    preview.draftCatalogPrice = round(draftPrice.amount);
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
    batchPreviewDailyPricing,
    bulkBackfillSupplierCosts,
    publishDailyPricing,
    previewPackagePricing
});
