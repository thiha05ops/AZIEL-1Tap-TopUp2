"use strict";

const mongoose = require("mongoose");
const CatalogProduct = require("../../models/CatalogProduct");
const CatalogPackage = require("../../models/CatalogPackage");
const Supplier = require("../../models/Supplier");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const SupplierCatalogOffer = require("../../models/SupplierCatalogOffer");
const StoreCatalogSelection = require("../../models/StoreCatalogSelection");
const PackagePricingOverride = require("../../models/PackagePricingOverride");
const { REGION_CURRENCIES, normalizePackageCode, normalizeProductCode, normalizeRegion } = require("../../catalog/catalogProjection");
const { CANONICAL_PRODUCT_CODES, isCanonicalProductCode } = require("../../catalog/canonicalOperationalCatalog");
const { buildProductionPricingContext } = require("./productionPricingContextService");
const { createPricingQuote } = require("./pricingQuoteRuntime");
const { loadCommercePromotionContext } = require("./commercePromotionBridgeService");
const { resolveCommercePricingPreviewDetailed } = require("./commercePricingPreviewService");
const { updatePackage } = require("../catalogAdminService");
const { clearPublishedSupplierCostDraftRows } = require("./pricingWorkspaceDraftService");
const { resolvePricingSupplier } = require("./pricingSupplierService");
const { SUPPLIER_CURRENCY } = require("../../constants/commerce");
const { finalizeCustomerPayableAmount } = require("./customerPayableAmountService");

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

async function loadDailyPricingWorkspace({ supplierId = "", supplierMarket = "", productCode = "", region = "TH" } = {}) {
    const normalizedRegion = upper(region || "ALL");
    const storeSelectionExplicit = String(process.env.STORE_CATALOG_SELECTION_MODE || "LEGACY").trim().toUpperCase() === "EXPLICIT";
    const selectionFilter = { status: "ACTIVE" };
    if (WORKSPACE_REGIONS.includes(normalizedRegion)) selectionFilter.sellingRegions = normalizedRegion;
    const storeSelections = await StoreCatalogSelection.find(selectionFilter).lean();
    const suppliersWithMappings = storeSelectionExplicit ? [...new Set(storeSelections.map(item => String(item.supplierId)))] : await SupplierProductMapping.distinct("supplierId", { archivedAt: null });
    const suppliers = await Supplier.find({ _id: { $in: suppliersWithMappings }, enabled: true }).sort({ supplierCode: 1 }).lean();
    const projectedSuppliers = suppliers.map(item => ({
        id: String(item._id), supplierId: String(item._id), supplierCode: upper(item.supplierCode),
        name: text(item.name), supplierName: text(item.name), supplierCurrency: upper(item.supplierCurrency || item.balanceCurrency || item.metadata?.supplierCurrency),
        supportedRegions: Array.isArray(item.supportedRegions) ? item.supportedRegions.map(upper) : [], enabled: item.enabled !== false
    })).filter(item => SUPPLIER_CURRENCY.includes(item.supplierCurrency));
    const requestedProductCode = text(productCode).toLowerCase();
    const requestedSelection = storeSelections.find(item => item.productCode === requestedProductCode && (!WORKSPACE_REGIONS.includes(normalizedRegion) || item.sellingRegions.includes(normalizedRegion)));
    const selected = projectedSuppliers.find(item => item.id === text(supplierId)) || projectedSuppliers.find(item => item.id === String(requestedSelection?.supplierId)) || projectedSuppliers[0] || null;
    if (!selected) return { success: true, suppliers: [], selectedSupplierId: "", products: [], rows: [] };

    const selectedSupplierSelections = storeSelections.filter(item => String(item.supplierId) === selected.id);
    const selectedMappingIds = selectedSupplierSelections.flatMap(item => item.packages || []).map(item => item.supplierProductMappingId);
    const selectedSupplierMappings = await SupplierProductMapping.find(storeSelectionExplicit ? { _id: { $in: selectedMappingIds }, supplierId: selected.id } : { supplierId: selected.id })
        .select("region productCode packageCode").lean();
    const supplierMarkets = [...selectedSupplierMappings.reduce((counts, item) => {
        const market = upper(item.region);
        if (market) counts.set(market, (counts.get(market) || 0) + 1);
        return counts;
    }, new Map())].map(([value, count]) => ({ value, label: value, count })).sort((a, b) => a.value.localeCompare(b.value));
    const requestedSupplierMarket = upper(supplierMarket);
    const selectedSupplierMarket = supplierMarkets.some(item => item.value === requestedSupplierMarket)
        ? requestedSupplierMarket
        : supplierMarkets[0]?.value || "";
    const marketMappings = selectedSupplierMappings.filter(item => upper(item.region) === selectedSupplierMarket);
    const navigationProductCodes = [...new Set((storeSelectionExplicit?storeSelections:marketMappings).map(item => text(item.productCode).toLowerCase()).filter(Boolean))];
    const navigationCatalogProducts = navigationProductCodes.length ? await CatalogProduct.find({ productCode: { $in: navigationProductCodes }, deletedAt: null }).select("productCode name enabled commerceState").lean() : [];
    const navigationProductByCode = new Map(navigationCatalogProducts.map(item => [item.productCode, item]));
    const navigationProducts = navigationProductCodes.map(code => ({
        productId: code, productCode: code, productName: navigationProductByCode.get(code)?.name || code,
        mappingCount: storeSelectionExplicit?storeSelections.filter(item => item.productCode === code).reduce((count,item)=>count+(item.packages||[]).length,0):marketMappings.filter(item=>item.productCode===code).length,
        enabled: navigationProductByCode.get(code)?.enabled !== false,
        commerceState: navigationProductByCode.get(code)?.commerceState || "HIDDEN"
    })).sort((a, b) => a.productName.localeCompare(b.productName));
    const selectedProductCode = navigationProductCodes.includes(requestedProductCode) ? requestedProductCode : navigationProducts[0]?.productCode || "";
    const activeSelection = selectedSupplierSelections.find(item => item.productCode === selectedProductCode && item.supplierMarket === selectedSupplierMarket);
    const activeMappingIds = (activeSelection?.packages || []).map(item => item.supplierProductMappingId);
    const mappingQuery = storeSelectionExplicit ? { _id: { $in: activeMappingIds }, supplierId: selected.id, region: selectedSupplierMarket } : { supplierId: selected.id, region: selectedSupplierMarket };
    if (selectedProductCode) mappingQuery.productCode = selectedProductCode;
    const mappings = await SupplierProductMapping.find(mappingQuery).sort({ productCode: 1, packageCode: 1 }).lean();
    const packageKeys = mappings.map(item => ({ productCode: item.productCode, packageCode: item.packageCode }));
    const productCodes = [...new Set(mappings.map(item => item.productCode))];
    const [packages, products, overrides, supplierOffers] = await Promise.all([
        packageKeys.length ? CatalogPackage.find({ $or: packageKeys, deletedAt: null }).lean() : [],
        productCodes.length ? CatalogProduct.find({ productCode: { $in: productCodes } }).lean() : [],
        productCodes.length ? PackagePricingOverride.find({ productCode: { $in: productCodes } }).lean() : [],
        SupplierCatalogOffer.find({ _id: { $in: mappings.map(item => item.supplierCatalogOfferId).filter(Boolean) } }).lean()
    ]);
    const overrideMap = new Map(overrides.map(item => [`${item.productCode}:${item.packageCode}:${item.region}`, item.profitOverride]));
    const packageMap = new Map(packages.map(item => [`${item.productCode}:${item.packageCode}`, item]));
    const productMap = new Map(products.map(item => [item.productCode, item]));
    const offerMap = new Map(supplierOffers.map(item => [String(item._id), item]));
    const rows = mappings.flatMap(mapping => {
        const pkg = packageMap.get(`${mapping.productCode}:${mapping.packageCode}`);
        if (!pkg) return [];
        const product = productMap.get(mapping.productCode);
        const supplierCostEvidence = mapping.supplierCostAuthority?.rawSupplierCost != null
            ? mapping.supplierCostAuthority
            : mapping.mappingMetadata?.supplierCost || {};
        const observedSupplierCost = offerMap.get(String(mapping.supplierCatalogOfferId))?.supplierCost || null;
        const supplierCost = Number(supplierCostEvidence.rawSupplierCost ?? supplierCostEvidence.priceUsd ?? supplierCostEvidence.netDealerPrice);
        const mappingRegion = upper(mapping.region);
        const previewEligible = Number.isFinite(supplierCost) &&
            mapping.mappingMetadata?.readiness?.supplierMapped === true &&
            Boolean(text(mapping.supplierProductCode)) &&
            Boolean(text(mapping.supplierPackageCode));
        const pricingRegions = canonicalPricingRegions(product, pkg, normalizedRegion);
        return pricingRegions.map(pricingRegion => {
            const price = pkg.prices?.[pricingRegion] || null;
            return {
            rowId: String(mapping._id), mappingId: String(mapping._id), supplierId: selected.id, supplierCode: selected.supplierCode,
            productCode: mapping.productCode, productName: product?.name || mapping.productCode,
            packageId: String(pkg._id), packageCode: pkg.packageCode, packageName: pkg.name,
            supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode,
            executionMode: mapping.executionMode, mappingRegion, targetRegion: normalizedRegion,
            offered: true, previewEligible,
            regionalAvailability: regionalAvailability(product, pkg),
            fulfillmentMappingEnabled: mapping.enabled === true,
            offerabilityReason: "",
            previewabilityReason: previewEligible ? "" : "Exact supplier mapping and raw supplier cost are required for pricing preview.",
            supplierCost: Number.isFinite(supplierCost) ? supplierCost : null, supplierCurrency: supplierCostEvidence.supplierCurrency || selected.supplierCurrency,
            observedSupplierCost: observedSupplierCost?.amount ?? null, observedSupplierCurrency: observedSupplierCost?.currency || "", observedSupplierCostAt: observedSupplierCost?.observedAt || null,
            supplierCostStatus: !observedSupplierCost && !Number.isFinite(supplierCost) ? "COST_MISSING" : !Number.isFinite(supplierCost) ? "COST_REVIEW_REQUIRED" : (mapping.supplierCostAuthority?.capturedAt && Date.now()-new Date(mapping.supplierCostAuthority.capturedAt).getTime()>Number(mapping.mappingMetadata?.costAuthorityMaximumAgeSeconds||86400)*1000) ? "COST_STALE" : "COST_READY",
            supplierCostTimestamp: supplierCostEvidence.capturedAt || null,
            supplierCostSource: supplierCostEvidence.source || "supplier_mapping",
            providerProductCode: mapping.supplierProductCode,
            providerOfferCode: mapping.supplierPackageCode,
            fundingCost: Number(supplierCostEvidence.fundingCost || 0),
            otherAcquisitionCost: Number(supplierCostEvidence.otherAcquisitionCost || 0),
            mappingReadiness: mapping.mappingMetadata?.readiness || {}, packageEnabled: pkg.enabled !== false,
            priceEnabled: price?.enabled !== false && Boolean(price), region: pricingRegion, currency: price?.currency || REGION_CURRENCIES[pricingRegion],
            publishedPrice: price?.amount ?? null, publishedPriceMode: price?.publishedPriceMode || "",
            publishedSupplierPrice: Number.isFinite(supplierCost) ? supplierCost : null,
            publishedSupplierCurrency: selected.supplierCurrency, publishedSupplierId: selected.id,
            publishedSupplierCode: selected.supplierCode, publishedSupplierCostConfigured: Number.isFinite(supplierCost),
            updatedAt: pkg.updatedAt || null
            ,profitOverride: overrideMap.get(`${mapping.productCode}:${pkg.packageCode}:${pricingRegion}`) || { mode: "INHERIT", value: null }
            };
        });
    });
    const grouped = [...new Set(rows.map(item => item.productCode))].map(code => ({
        productId: code, productCode: code, productName: productMap.get(code)?.name || code,
        packages: rows.filter(item => item.productCode === code)
    }));
    return {
        success: true, generatedAt: new Date().toISOString(),
        region: normalizedRegion, customerMarket: normalizedRegion,
        suppliers: projectedSuppliers, selectedSupplierId: selected.id,
        supplierMarkets, selectedSupplierMarket, navigationProducts, selectedProductCode, products: grouped, rows
    };
}

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

function canonicalPricingProductCode(value) {
    const exact = text(value).toLowerCase();
    if (isCanonicalProductCode(exact)) return exact;
    const compact = normalizeProductCode(exact);
    return CANONICAL_PRODUCT_CODES.find(code => normalizeProductCode(code) === compact) || exact;
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

function precise(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number(numeric.toFixed(6)) : null;
}

function normalizePriceInstruction(input = {}, region) {
    const mode = upper(input.mode || "CALCULATED");
    if (!["CALCULATED", "MANUAL_OVERRIDE", "ADJUSTMENT"].includes(mode)) {
        throw new AdminPricingControlCenterError("WORKSPACE_PRICE_MODE_INVALID", `${region} price mode is invalid.`);
    }
    if (mode === "CALCULATED") return { mode, adjustmentType: "", value: null, reason: "" };
    const value = Number(input.value);
    if (!Number.isFinite(value) || (mode === "MANUAL_OVERRIDE" && value <= 0)) {
        throw new AdminPricingControlCenterError("WORKSPACE_PRICE_VALUE_INVALID", `${region} price value is invalid.`);
    }
    const adjustmentType = mode === "ADJUSTMENT" ? upper(input.adjustmentType || "FIXED") : "";
    if (mode === "ADJUSTMENT" && !["FIXED", "PERCENTAGE"].includes(adjustmentType)) {
        throw new AdminPricingControlCenterError("WORKSPACE_ADJUSTMENT_TYPE_INVALID", `${region} adjustment type is invalid.`);
    }
    if (adjustmentType === "PERCENTAGE" && Math.abs(value) > 100) {
        throw new AdminPricingControlCenterError("WORKSPACE_ADJUSTMENT_VALUE_INVALID", `${region} percentage adjustment must be between -100 and 100.`);
    }
    return { mode, adjustmentType, value, reason: text(input.reason) };
}

function resolveWorkspacePriceInstruction({ instruction = {}, calculatedPrice, currency, region } = {}) {
    const normalized = normalizePriceInstruction(instruction, region);
    const calculated = finalizeCustomerPayableAmount(calculatedPrice, currency);
    let finalPrice = calculated;
    if (normalized.mode === "MANUAL_OVERRIDE") finalPrice = finalizeCustomerPayableAmount(normalized.value, currency);
    if (normalized.mode === "ADJUSTMENT") {
        const delta = normalized.adjustmentType === "PERCENTAGE"
            ? calculated * (normalized.value / 100)
            : normalized.value;
        finalPrice = finalizeCustomerPayableAmount(calculated + delta, currency);
    }
    if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
        throw new AdminPricingControlCenterError("WORKSPACE_FINAL_PRICE_INVALID", `${region} final preview price must be positive.`);
    }
    const reason = normalized.reason || (normalized.mode === "MANUAL_OVERRIDE"
        ? "Daily Pricing exact manual override."
        : normalized.mode === "ADJUSTMENT"
            ? `Daily Pricing ${normalized.adjustmentType.toLowerCase()} adjustment ${normalized.value >= 0 ? "+" : ""}${normalized.value}${normalized.adjustmentType === "PERCENTAGE" ? "%" : ""}.`
            : "");
    return { ...normalized, calculatedPrice: calculated, finalPrice, reason };
}

function buildWorkspacePricePatch({ regionalPreview = {}, normalized = {}, supplier = {}, row = {} } = {}) {
    const finalPrice = Number(regionalPreview.finalPreviewPrice ?? regionalPreview.recommendedSellingPrice);
    const priceMode = regionalPreview.priceMode || "CALCULATED";
    const patch = {
        amount: finalPrice,
        publishedPriceMode: priceMode === "CALCULATED" ? "POLICY_DERIVED" : "MANUAL_OVERRIDE",
        manualOverrideReason: priceMode === "CALCULATED" ? "" : regionalPreview.manualOverrideReason,
        pricingNote: priceMode === "ADJUSTMENT" ? regionalPreview.manualOverrideReason : normalized.pricingNote
    };
    if (normalized.supplierCostEdited === true) {
        Object.assign(patch, {
            supplierCost: normalized.newSupplierCost,
            supplierCurrency: supplier.supplierCurrency,
            rawSupplierCost: normalized.newSupplierCost,
            rawSupplierCurrency: supplier.supplierCurrency,
            supplierCostSource: normalized.supplierCostSource,
            providerProductCode: normalized.providerProductCode,
            providerOfferCode: normalized.providerOfferCode,
            fxRate: regionalPreview.exchangeRate,
            fxRateSource: regionalPreview.exchangeRateSource,
            fxRateCapturedAt: regionalPreview.exchangeRateCapturedAt,
            fxRateEffectiveAt: regionalPreview.exchangeSnapshot?.effectiveAt || null,
            fxRateExpiresAt: regionalPreview.exchangeRateExpiresAt || null,
            fxRateMaxAgeSeconds: regionalPreview.exchangeRateMaxAgeSeconds || null,
            fxConvertedCost: regionalPreview.fxConvertedCost,
            fundingCost: regionalPreview.fundingCost || 0,
            otherAcquisitionCost: regionalPreview.otherAcquisitionCost || 0,
            landedCost: regionalPreview.landedCost,
            landedCurrency: regionalPreview.landedCurrency,
            supplierId: supplier.supplierId,
            supplierCode: supplier.supplierCode,
            supplierName: supplier.supplierName,
            supplierVersion: normalized.supplierVersion || row.supplierVersion || "",
            supplierCostTimestamp: normalized.supplierCostTimestamp
        });
    }
    return patch;
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
    return `${canonicalPricingProductCode(row.productCode)}:${normalizePackageCode(row.packageCode)}`;
}

function workspaceRegions(region) {
    const normalized = upper(region || "");
    if (!normalized || normalized === "ALL") return [...WORKSPACE_REGIONS];
    return [normalizeRegion(normalized)];
}

function canonicalPricingRegions(product = {}, pkg = {}, region = "ALL") {
    if (product.enabled === false || pkg.enabled === false) return [];
    const supported = new Set((product.supportedRegions || []).map(upper));
    return workspaceRegions(region).filter(regionCode =>
        supported.has(regionCode) && pkg.prices?.[regionCode]?.enabled !== false
    );
}

function regionalAvailability(product = {}, pkg = {}) {
    return Object.fromEntries(WORKSPACE_REGIONS.map(regionCode => {
        let reason = "";
        if (product.enabled === false) reason = "Canonical product is disabled.";
        else if (pkg.enabled === false) reason = "Canonical package is disabled.";
        else if (!(product.supportedRegions || []).map(upper).includes(regionCode)) reason = `Canonical product is not offered in ${regionCode}.`;
        else if (pkg.prices?.[regionCode]?.enabled === false) reason = `Canonical package price is disabled in ${regionCode}.`;
        return [regionCode, { eligible: !reason, reason }];
    }));
}

function normalizeWorkspaceRow(row = {}, index = 0) {
    if (!isCanonicalProductCode(row.productCode)) {
        throw new AdminPricingControlCenterError("CATALOG_PRODUCT_UNSUPPORTED", `Row ${index + 1} references an unsupported product.`);
    }
    const productCode = canonicalPricingProductCode(row.productCode);
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
    if (!SUPPLIER_CURRENCY.includes(supplierCurrency)) {
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
        supplierCostSource: text(row.supplierCostSource || "supplier_mapping"),
        providerProductCode: text(row.providerProductCode || row.supplierProductCode),
        providerOfferCode: text(row.providerOfferCode || row.supplierPackageCode),
        fundingCost: amount(row.fundingCost) || 0,
        otherAcquisitionCost: amount(row.otherAcquisitionCost) || 0,
        pricingNote: text(row.pricingNote),
        expectedUpdatedAt: row.expectedUpdatedAt || null,
        manualPublishedPrice: amount(row.manualPublishedPrice),
        manualOverrideReason: text(row.manualOverrideReason),
        publishedPriceMode: upper(row.publishedPriceMode || ""),
        priceInstructions: Object.fromEntries(WORKSPACE_REGIONS.map(region => [
            region,
            normalizePriceInstruction(row.priceInstructions?.[region] || {}, region)
        ])),
        supplierCostEdited: row.supplierCostEdited === true,
        mappingId: text(row.mappingId),
        supplierProductCode: text(row.supplierProductCode),
        supplierPackageCode: text(row.supplierPackageCode),
        mappingRegion: upper(row.mappingRegion),
        mappingReadiness: row.mappingReadiness && typeof row.mappingReadiness === "object" ? row.mappingReadiness : {}
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

function statusFromPricingEvidence({ supplierConfigured, priceBelowCost = false, netProfit = null, minimumProfitAmount = 0 } = {}) {
    if (!supplierConfigured) return PROFITABILITY_STATUS.UNKNOWN_SUPPLIER_COST;
    const profit = safeNumber(netProfit);
    if (priceBelowCost === true) return PROFITABILITY_STATUS.PRICE_BELOW_COST;
    if (profit != null && profit < 0) return PROFITABILITY_STATUS.NEGATIVE_MARGIN;
    if (profit != null && profit + Number.EPSILON < Number(minimumProfitAmount ?? 0)) return PROFITABILITY_STATUS.INVALID_CONFIGURATION;
    return PROFITABILITY_STATUS.HEALTHY;
}

function statusFromQuote({ quote, supplierConfigured }) {
    const business = quote?.pricingSnapshot?.businessRuntime || {};
    return statusFromPricingEvidence({
        supplierConfigured,
        priceBelowCost: business.priceBelowCost === true,
        netProfit: business.netProfit
    });
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
    const minimumProfitAmount = Number(context.pricing.pricingInput.policy?.minimumProfitAmount ?? 0);
    const minimumMarginPercent = Number(context.pricing.pricingInput.policy?.minimumProfitMarginPercent ?? 0);
    const blockingErrors = [];
    status = statusFromPricingEvidence({
        supplierConfigured,
        priceBelowCost: business.priceBelowCost === true,
        netProfit,
        minimumProfitAmount
    });
    if (status === PROFITABILITY_STATUS.INVALID_CONFIGURATION && netProfit != null && netProfit >= 0) {
        blockingErrors.push(warning("MINIMUM_PROFIT_NOT_APPLIED", "Calculated profit is below the authoritative minimum profit guardrail."));
    }
    if (status === PROFITABILITY_STATUS.NEGATIVE_MARGIN) blockingErrors.push(warning("NEGATIVE_MARGIN", "This price creates a loss after business costs."));
    if (status === PROFITABILITY_STATUS.PRICE_BELOW_COST) blockingErrors.push(warning("PRICE_BELOW_COST", "Selling price is below supplier cost."));
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
    const recommendedSellingPrice = round(pricing.result?.preOverridePrice ?? pricing.result?.regularPrice ?? commercial.originalPrice);
    const publishedCustomerPrice = finalizeCustomerPayableAmount(price.amount, quote.commercialSnapshot.currency);
    const previewCustomerPrice = finalizeCustomerPayableAmount(recommendedSellingPrice, quote.commercialSnapshot.currency);
    const publishedPriceDifference = Number((previewCustomerPrice - publishedCustomerPrice).toFixed(quote.commercialSnapshot.currency === "MMK" ? 0 : 2));

    return {
        success: true,
        region: quote.commercialSnapshot.region,
        currency: quote.commercialSnapshot.currency,
        sellingPrice: round(price.amount),
        publishedPriceMode: price.publishedPriceMode || "LEGACY_COMPATIBILITY_PRICE",
        manualOverrideReason: price.manualOverrideReason || "",
        supplierCost: supplierConfigured ? round(supplierSnapshot.amount) : null,
        rawSupplierCost: supplierConfigured ? precise(supplierSnapshot.rawSupplierCost ?? supplierSnapshot.amount) : null,
        rawSupplierCurrency: supplierSnapshot.rawSupplierCurrency || supplierSnapshot.currency || "",
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
        exchangeRateEffectiveAt: exchangeSnapshot?.effectiveAt || null,
        exchangeRateExpiresAt: exchangeSnapshot?.expiresAt || null,
        exchangeRateMaxAgeSeconds: exchangeSnapshot?.maxAgeSeconds || null,
        conversionRequired: Boolean(exchangeSnapshot && exchangeSnapshot.sourceCurrency !== exchangeSnapshot.targetCurrency),
        convertedSupplierCost,
        fxConvertedCost: supplierConfigured ? precise(pricing.result?.fxConvertedCost ?? convertedSupplierCost) : null,
        fundingCost: supplierConfigured ? precise(pricing.result?.fundingCost || 0) : null,
        otherAcquisitionCost: supplierConfigured ? precise(pricing.result?.otherAcquisitionCost || 0) : null,
        landedCost: supplierConfigured ? precise(pricing.result?.landedCost ?? convertedSupplierCost) : null,
        landedCurrency: supplierConfigured ? pricing.result?.landedCurrency || quote.commercialSnapshot.currency : "",
        recommendedSellingPrice: previewCustomerPrice,
        currentPublishedPrice: publishedCustomerPrice,
        changed: previewCustomerPrice !== publishedCustomerPrice,
        manualPublishedPrice: pricing.result?.preOverridePrice != null ? round(commercial.originalPrice) : null,
        publishedPriceDifference,
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
        baseProfit: pricing.result?.baseProfitAmount ?? netProfit,
        appliedProfit: pricing.result?.profitAmount ?? netProfit,
        maximumProfitAmount: pricing.result?.maximumProfitAmount ?? null,
        packageProfitOverride: pricing.result?.packageProfitOverride || { mode: "INHERIT", value: null },
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
        blockingErrors
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
    const configuredPrice = pkg.prices?.[region];
    if (configuredPrice?.enabled === false) {
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
    // A newly onboarded package may have authoritative supplier cost but no
    // regional selling price yet. Allow the production policy engine to create
    // the first price in preview/publish instead of requiring a placeholder
    // catalog write outside the pricing authority.
    const existing = configuredPrice || {
        amount: 0,
        currency: REGION_CURRENCIES[region],
        enabled: true,
        publishedPriceMode: "LEGACY_COMPATIBILITY_PRICE"
    };
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
        rawSupplierCost: row.newSupplierCost,
        rawSupplierCurrency: row.supplierCurrency,
        supplierCostSource: row.supplierCostSource,
        providerProductCode: row.providerProductCode,
        providerOfferCode: row.providerOfferCode,
        fundingCost: row.fundingCost,
        otherAcquisitionCost: row.otherAcquisitionCost,
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
        const calculatedPreview = previewFromQuote({ quote, context, price, couponCode: upper(couponCode) });
        const instruction = resolveWorkspacePriceInstruction({
            instruction: row.priceInstructions?.[region],
            calculatedPrice: calculatedPreview.recommendedSellingPrice,
            currency: price.currency,
            region
        });
        let preview = {
            ...calculatedPreview,
            priceMode: instruction.mode,
            adjustmentType: instruction.adjustmentType,
            adjustmentValue: instruction.mode === "ADJUSTMENT" ? instruction.value : null,
            manualOverrideValue: instruction.mode === "MANUAL_OVERRIDE" ? instruction.value : null,
            calculatedPrice: instruction.calculatedPrice,
            finalPreviewPrice: instruction.finalPrice,
            recommendedSellingPrice: instruction.finalPrice,
            manualOverrideReason: instruction.reason,
            changed: instruction.finalPrice !== calculatedPreview.currentPublishedPrice,
            publishedPriceDifference: Number((instruction.finalPrice - calculatedPreview.currentPublishedPrice).toFixed(price.currency === "MMK" ? 0 : 2))
        };
        if (instruction.mode !== "CALCULATED") {
            const overridePrice = {
                ...price,
                amount: instruction.finalPrice,
                publishedPriceMode: "MANUAL_OVERRIDE",
                manualOverrideReason: instruction.reason
            };
            const overridePackage = {
                ...pkg,
                prices: { ...pkg.prices, [region]: overridePrice }
            };
            const overrideContext = await buildProductionPricingContext({
                pkg: overridePackage,
                price: overridePrice,
                catalog: {
                    productCode: product.productCode,
                    productName: product.name,
                    packageCode: pkg.packageCode,
                    packageName: pkg.name
                },
                region,
                currency: overridePrice.currency,
                includePublishedPriceOverride: true
            });
            const overrideQuote = createPricingQuote({
                quoteId: `daily-pricing-override-preview:${product.productCode}:${pkg.packageCode}:${region}:${Date.now()}`,
                issuedAt: new Date().toISOString(),
                validitySeconds: 300,
                owner: { userId: actor?.id || actor?.username || "admin-pricing-workspace" },
                request: {
                    region,
                    currency: overridePrice.currency,
                    package: { ...overrideContext.packageContext, quantity: 1 },
                    couponCode: upper(couponCode)
                },
                pricingInput: overrideContext.pricing.pricingInput,
                promotionInput: null,
                versionContext: overrideContext.pricing.versionContext
            });
            const validated = previewFromQuote({ quote: overrideQuote, context: overrideContext, price: overridePrice, couponCode: upper(couponCode) });
            preview = {
                ...validated,
                priceMode: instruction.mode,
                adjustmentType: instruction.adjustmentType,
                adjustmentValue: instruction.mode === "ADJUSTMENT" ? instruction.value : null,
                manualOverrideValue: instruction.mode === "MANUAL_OVERRIDE" ? instruction.value : null,
                calculatedPrice: instruction.calculatedPrice,
                finalPreviewPrice: instruction.finalPrice,
                recommendedSellingPrice: instruction.finalPrice,
                currentPublishedPrice: calculatedPreview.currentPublishedPrice,
                manualOverrideReason: instruction.reason,
                changed: instruction.finalPrice !== calculatedPreview.currentPublishedPrice,
                publishedPriceDifference: Number((instruction.finalPrice - calculatedPreview.currentPublishedPrice).toFixed(price.currency === "MMK" ? 0 : 2))
            };
        }
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
    if (warnings.length) return "Warning";
    return "Ready";
}

function selectedPublicationDecision(row = {}) {
    if (row.changed !== true) return { action: "NO_OP", reason: "No changes" };
    if (row.publishEligible !== true || (row.blockingErrors || []).length) {
        return { action: "BLOCKED", reason: "Blocked by pricing preview" };
    }
    return { action: "PUBLISH", reason: "" };
}

function operatorRegionStatus(item = {}) {
    if (item.blockingErrors?.length || [PROFITABILITY_STATUS.NEGATIVE_MARGIN, PROFITABILITY_STATUS.PRICE_BELOW_COST, PROFITABILITY_STATUS.INVALID_CONFIGURATION, PROFITABILITY_STATUS.EXCHANGE_RATE_MISSING].includes(item.profitabilityStatus)) return "BLOCKED";
    if (item.warnings?.length) return "WARNING";
    return item.supplierCostConfigured === false ? "MISSING" : "READY";
}

function withRegionalContract(row = {}) {
    const regionalResults = {};
    (row.regions || []).forEach(item => {
        regionalResults[item.region] = {
            storeCurrency: item.currency,
            rawSupplierCost: item.rawSupplierCost ?? item.supplierCost,
            rawSupplierCurrency: item.rawSupplierCurrency || item.supplierCurrency,
            exchangeRate: item.exchangeRate,
            exchangeRateSource: item.exchangeRateSource,
            exchangeRateCapturedAt: item.exchangeRateCapturedAt,
            fxConvertedCost: item.fxConvertedCost ?? item.convertedSupplierCost,
            fundingCost: item.fundingCost,
            otherAcquisitionCost: item.otherAcquisitionCost,
            landedCost: item.landedCost,
            landedCurrency: item.landedCurrency,
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

    const supplier = await resolvePricingSupplier({ supplierId, region, requireFulfillmentRegion: false });
    const mappingIds = rows.map(row => text(row.mappingId)).filter(id => mongoose.Types.ObjectId.isValid(id));
    const mappingMap = mappingIds.length
        ? new Map((await SupplierProductMapping.find({ _id: { $in: mappingIds } }).lean()).map(mapping => [String(mapping._id), mapping]))
        : new Map();
    const packageIds = rows.filter(row => !row.packageCode && mongoose.Types.ObjectId.isValid(text(row.packageId))).map(row => row.packageId);
    const packagesById = packageIds.length
        ? new Map((await CatalogPackage.find({ _id: { $in: packageIds }, deletedAt: null }).select("_id productCode packageCode").lean()).map(pkg => [String(pkg._id), pkg]))
        : new Map();
    const resolvedInputRows = rows.map(row => {
        const pkg = packagesById.get(text(row.packageId));
        const mapping = mappingMap.get(text(row.mappingId));
        if (supplier.mode === "API" && !mapping) {
            return { ...row, productCode: row.productCode || row.productId, newSupplierCost: null, authorityError: "SUPPLIER_MAPPING_REQUIRED" };
        }
        if (text(row.mappingId) && (!mapping || String(mapping.supplierId) !== supplier.supplierId)) {
            return { ...row, productCode: row.productCode || row.productId, newSupplierCost: null, authorityError: "SUPPLIER_MAPPING_UNAVAILABLE" };
        }
        const supplierCostEvidence = mapping?.supplierCostAuthority?.rawSupplierCost != null
            ? mapping.supplierCostAuthority
            : mapping?.mappingMetadata?.supplierCost || {};
        const authoritativeCost = Number(supplierCostEvidence.rawSupplierCost ?? supplierCostEvidence.priceUsd ?? supplierCostEvidence.netDealerPrice);
        const mapped = mapping ? {
            productCode: mapping.productCode,
            packageCode: mapping.packageCode,
            mappingId: String(mapping._id),
            supplierProductCode: mapping.supplierProductCode,
            supplierPackageCode: mapping.supplierPackageCode,
            mappingRegion: mapping.region,
            mappingReadiness: mapping.mappingMetadata?.readiness || {},
            newSupplierCost: Number.isFinite(authoritativeCost) ? authoritativeCost : null,
            supplierCostTimestamp: supplierCostEvidence.capturedAt || row.supplierCostTimestamp,
            supplierCostSource: supplierCostEvidence.source || "supplier_mapping",
            providerProductCode: mapping.supplierProductCode,
            providerOfferCode: mapping.supplierPackageCode,
            fundingCost: Number(supplierCostEvidence.fundingCost || 0),
            otherAcquisitionCost: Number(supplierCostEvidence.otherAcquisitionCost || 0)
        } : {};
        return pkg ? { ...row, ...mapped, productCode: mapped.productCode || row.productCode || row.productId || pkg.productCode, packageCode: mapped.packageCode || pkg.packageCode } : { ...row, ...mapped, productCode: mapped.productCode || row.productCode || row.productId };
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
        const requestedRegions = canonicalPricingRegions(product, pkg, region);
        const regional = await Promise.all(requestedRegions.map(region => previewLoadedPackageRegion({
            product,
            pkg,
            region,
            row,
            couponCode,
            actor
        })));
        const existingPrices = WORKSPACE_REGIONS.map(regionCode => pkg.prices?.[regionCode]).filter(Boolean);
        const selectedExistingPrices = requestedRegions
            .map(regionCode => pkg.prices?.[regionCode])
            .filter(Boolean);
        const selectedExistingPrice = selectedExistingPrices[0] || null;
        const oldSupplierCost = selectedExistingPrice?.supplierCost ?? null;
        const oldSupplierCurrency = selectedExistingPrice?.supplierCurrency || "";
        const changed = regional.some(regionalPreview => regionalPreview.changed === true);
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
            oldSupplierCost: oldSupplierCost == null ? null : round(oldSupplierCost),
            newSupplierCost: row.newSupplierCost,
            costDelta: oldSupplierCost == null ? null : round(row.newSupplierCost - Number(oldSupplierCost)),
            supplierCurrency: row.supplierCurrency,
            supplierName: row.supplierName || existingPrices.find(price => price?.supplierName)?.supplierName || "",
            supplierId: supplier.supplierId,
            supplierCode: supplier.supplierCode,
            mappingId: row.mappingId || "",
            supplierProductCode: row.supplierProductCode || "",
            supplierPackageCode: row.supplierPackageCode || pkg.supplierPackageCode || pkg.metadata?.supplierPackageCode || pkg.packageCode,
            mappingRegion: row.mappingRegion || "",
            mappingReadiness: row.mappingReadiness || {},
            supplierVersion: row.supplierVersion || existingPrices.find(price => price?.supplierVersion)?.supplierVersion || "",
            supplierCostTimestamp: row.supplierCostTimestamp,
            supplierCostSource: row.supplierCostSource,
            providerProductCode: row.providerProductCode,
            providerOfferCode: row.providerOfferCode,
            fundingCost: row.fundingCost,
            otherAcquisitionCost: row.otherAcquisitionCost,
            expectedUpdatedAt: row.expectedUpdatedAt || pkg.updatedAt,
            changed,
            selected: row.selected !== false,
            status: rowStatusFromRegional(regional),
            // Operational pricing readiness is independent from explicit admin
            // selection intent. Folding row.selected into this flag deadlocks
            // initially-unselected READY rows in the browser.
            publishEligible: !blockingErrors.length,
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
        await resolvePricingSupplier({ supplierId, region: selectedRegion, requireFulfillmentRegion: false })
    ])));
    const suppliersByRegion = new Map(supplierEntries);

    // Mapping identity and authoritative cost are pricing authority. Mapping
    // enablement is fulfillment transport authority and must not gate pricing.
    const selectedMappingIds = rows
        .filter(row => row.selected !== false)
        .map(row => text(row.mappingId))
        .filter(id => mongoose.Types.ObjectId.isValid(id));
    if (selectedMappingIds.length) {
        const publicationMappings = await SupplierProductMapping.find({
            _id: { $in: selectedMappingIds },
            supplierId
        }).select("_id supplierProductCode supplierPackageCode supplierCostAuthority mappingMetadata").lean();
        const authoritativeMappings = publicationMappings.filter(mapping => {
            const evidence = mapping.supplierCostAuthority?.rawSupplierCost != null
                ? mapping.supplierCostAuthority
                : mapping.mappingMetadata?.supplierCost || {};
            const cost = Number(evidence.rawSupplierCost ?? evidence.priceUsd ?? evidence.netDealerPrice);
            return Boolean(text(mapping.supplierProductCode)) && Boolean(text(mapping.supplierPackageCode)) && Number.isFinite(cost);
        });
        if (authoritativeMappings.length !== new Set(selectedMappingIds).size) {
            throw new AdminPricingControlCenterError(
                "SUPPLIER_COST_AUTHORITY_NOT_READY",
                "Publishing requires an exact supplier mapping with authoritative supplier cost.",
                409
            );
        }
    }

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
            const previewRow = preview.rows.find(row => `${row.productCode}:${row.packageCode}` === rowKey(input));
            const normalized = normalizeWorkspaceRow({
                ...input,
                ...(previewRow?.mappingId ? {
                    newSupplierCost: previewRow.newSupplierCost,
                    supplierCurrency: previewRow.supplierCurrency,
                    supplierName: previewRow.supplierName,
                    supplierCostTimestamp: previewRow.supplierCostTimestamp,
                    supplierCostSource: previewRow.supplierCostSource,
                    providerProductCode: previewRow.providerProductCode,
                    providerOfferCode: previewRow.providerOfferCode,
                    fundingCost: previewRow.fundingCost,
                    otherAcquisitionCost: previewRow.otherAcquisitionCost
                } : {})
            }, index);
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

        const publicationDecision = selectedPublicationDecision(row);
        if (publicationDecision.action === "NO_OP") {
            selectedRegions.forEach(selectedRegion => {
                results.push({
                    region: selectedRegion,
                    productCode: row.productCode,
                    packageCode: row.packageCode,
                    published: false,
                    skipped: true,
                    reason: publicationDecision.reason
                });
            });
            continue;
        }

        const pricePatches = {};
        const publishableRegions = [];

        for (const selectedRegion of selectedRegions) {
            const regionalPreview = (row.regions || []).find(item => item.region === selectedRegion);
            const calculatedPrice = Number(regionalPreview?.finalPreviewPrice ?? regionalPreview?.recommendedSellingPrice);
            const regionalBlockingErrors = regionalPreview?.blockingErrors || [];

            if (regionalPreview && regionalPreview.changed !== true) {
                results.push({
                    region: selectedRegion,
                    productCode: row.productCode,
                    packageCode: row.packageCode,
                    published: false,
                    skipped: true,
                    reason: "No changes"
                });
                continue;
            }

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
            pricePatches[selectedRegion] = buildWorkspacePricePatch({ regionalPreview, normalized, supplier, row });
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
            ...(normalized.supplierCostEdited === true ? { canonicalSupplierCost: {
                supplierId: canonicalSupplier.supplierId,
                supplierCode: canonicalSupplier.supplierCode,
                supplierName: canonicalSupplier.supplierName,
                amount: normalized.newSupplierCost,
                currency: canonicalSupplier.supplierCurrency,
                capturedAt: normalized.supplierCostTimestamp,
                rawSupplierCost: normalized.newSupplierCost,
                rawSupplierCurrency: canonicalSupplier.supplierCurrency,
                supplierCostSource: normalized.supplierCostSource,
                providerProductCode: normalized.providerProductCode,
                providerOfferCode: normalized.providerOfferCode,
                fxRate: pricePatches[publishableRegions[0]].fxRate,
                fxRateSource: pricePatches[publishableRegions[0]].fxRateSource,
                fxRateCapturedAt: pricePatches[publishableRegions[0]].fxRateCapturedAt,
                fxRateEffectiveAt: pricePatches[publishableRegions[0]].fxRateEffectiveAt,
                fxRateExpiresAt: pricePatches[publishableRegions[0]].fxRateExpiresAt,
                fxRateMaxAgeSeconds: pricePatches[publishableRegions[0]].fxRateMaxAgeSeconds,
                fxConvertedCost: pricePatches[publishableRegions[0]].fxConvertedCost,
                fundingCost: pricePatches[publishableRegions[0]].fundingCost,
                otherAcquisitionCost: pricePatches[publishableRegions[0]].otherAcquisitionCost,
                landedCost: pricePatches[publishableRegions[0]].landedCost,
                landedCurrency: pricePatches[publishableRegions[0]].landedCurrency
            } } : {}),
            prices: pricePatches,
            pricingPublicationEvidence: publishableRegions.map(selectedRegion => {
                const regionalPreview = row.regions.find(item => item.region === selectedRegion);
                return {
                    region: selectedRegion,
                    supplierBasis: {
                        supplierId: suppliersByRegion.get(selectedRegion).supplierId,
                        supplierCode: suppliersByRegion.get(selectedRegion).supplierCode,
                        rawSupplierCost: normalized.newSupplierCost,
                        supplierCurrency: suppliersByRegion.get(selectedRegion).supplierCurrency,
                        supplierCostSource: normalized.supplierCostSource,
                        providerProductCode: normalized.providerProductCode,
                        providerOfferCode: normalized.providerOfferCode
                    },
                    fxBasis: {
                        rate: regionalPreview.exchangeRate,
                        source: regionalPreview.exchangeRateSource,
                        capturedAt: regionalPreview.exchangeRateCapturedAt
                    },
                    appliedProfit: regionalPreview.appliedProfit ?? regionalPreview.netProfit,
                    pricingPolicy: {
                        source: regionalPreview.effectivePolicySource,
                        versionId: regionalPreview.policyVersionId,
                        versionNumber: regionalPreview.policyVersionNumber
                    },
                    packageProfitOverride: regionalPreview.packageProfitOverride || { mode: "INHERIT", value: null }
                    ,priceMode: regionalPreview.priceMode || "CALCULATED"
                    ,calculatedPrice: regionalPreview.calculatedPrice
                    ,finalPreviewPrice: regionalPreview.finalPreviewPrice ?? regionalPreview.recommendedSellingPrice
                    ,manualOverrideReason: regionalPreview.manualOverrideReason || ""
                };
            }),
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
    if (!isCanonicalProductCode(productCode)) {
        throw new AdminPricingControlCenterError("CATALOG_PRODUCT_UNSUPPORTED", "Product is not supported by the canonical catalog.", 409);
    }
    const normalizedProductCode = canonicalPricingProductCode(productCode);
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

async function savePackageProfitOverride({ productCode, packageCode, region, profitOverride = {}, actor = null } = {}) {
    const normalizedProductCode = String(productCode || "").trim().toLowerCase();
    const normalizedPackageCode = normalizePackageCode(packageCode);
    const normalizedRegion = normalizeRegion(region);
    await loadPackage(normalizedProductCode, normalizedPackageCode);
    const mode = upper(profitOverride.mode || "INHERIT");
    if (!["INHERIT", "FIXED_AMOUNT", "PERCENTAGE"].includes(mode)) throw new AdminPricingControlCenterError("PROFIT_OVERRIDE_MODE_INVALID", "Profit override mode is invalid.");
    const value = mode === "INHERIT" ? null : Number(profitOverride.value);
    if (mode !== "INHERIT" && (!Number.isFinite(value) || value < 0 || (mode === "PERCENTAGE" && value > 100))) throw new AdminPricingControlCenterError("PROFIT_OVERRIDE_VALUE_INVALID", "Profit override value is invalid.");
    const row = await PackagePricingOverride.findOneAndUpdate({ productCode: normalizedProductCode, packageCode: normalizedPackageCode, region: normalizedRegion }, { $set: { profitOverride: { mode, value }, updatedBy: text(actor?.username || actor?.id || "admin") } }, { upsert: true, new: true, runValidators: true }).lean();
    return { success: true, productCode: row.productCode, packageCode: row.packageCode, region: row.region, profitOverride: row.profitOverride, publishedPricesChanged: false };
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
    if (!isCanonicalProductCode(row.productCode)) {
        throw new AdminPricingControlCenterError("CATALOG_PRODUCT_UNSUPPORTED", "Product is not supported by the canonical catalog.", 409);
    }
    const region = normalizeRegion(row.region);
    const supplierCost = amount(row.supplierCost);
    if (supplierCost == null) {
        throw new AdminPricingControlCenterError("INVALID_SUPPLIER_COST", "Each row requires a valid supplier cost.");
    }
    return {
        productCode: canonicalPricingProductCode(row.productCode),
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
    statusFromPricingEvidence,
    rowStatusFromRegional,
    selectedPublicationDecision,
    resolveWorkspacePriceInstruction,
    buildWorkspacePricePatch,
    batchPreviewDailyPricing,
    loadDailyPricingWorkspace,
    bulkBackfillSupplierCosts,
    publishDailyPricing,
    previewPackagePricing
    ,savePackageProfitOverride
});
