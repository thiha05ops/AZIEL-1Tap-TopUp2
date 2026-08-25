"use strict";

const { STOREFRONT_CURRENCY, SUPPLIER_CURRENCY, REGION } = require("../../constants/commerce");

function text(value) {
    return String(value || "").trim();
}

function upper(value) {
    return text(value).toUpperCase();
}

function amount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Number(numeric.toFixed(6)) : null;
}

function timestamp(value, fallback = new Date()) {
    const date = value ? new Date(value) : fallback;
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}

function regionCostFromMetadata(pkg = {}, region) {
    const metadata = pkg.metadata && typeof pkg.metadata === "object" ? pkg.metadata : {};
    const candidates = [
        metadata.supplierCosts?.[region],
        metadata.supplierCost?.[region],
        metadata.commerceSupplierCosts?.[region]
    ];
    return candidates.find(Boolean) || null;
}

function normalizeSupplierCost({ raw = {}, price = {}, pkg = {}, region, currency, now = new Date(), source } = {}) {
    if (!raw || typeof raw !== "object") return null;
    const cost = amount(raw.rawSupplierCost ?? raw.amount ?? raw.supplierCost ?? raw.cost);
    const supplierCurrency = upper(raw.rawSupplierCurrency || raw.currency || raw.supplierCurrency || currency);
    if (cost === null || !SUPPLIER_CURRENCY.includes(supplierCurrency)) return null;
    return {
        amount: cost,
        currency: supplierCurrency,
        rawSupplierCost: cost,
        rawSupplierCurrency: supplierCurrency,
        supplierCostSource: text(raw.supplierCostSource || source),
        providerProductCode: text(raw.providerProductCode),
        providerOfferCode: text(raw.providerOfferCode),
        fundingCost: amount(raw.fundingCost) || 0,
        otherAcquisitionCost: amount(raw.otherAcquisitionCost) || 0,
        supplierName: text(raw.supplierName || raw.supplier || pkg.metadata?.supplierName || "AZIEL Supplier"),
        supplierVersion: text(raw.supplierVersion || raw.version || pkg.metadata?.supplierVersion || "v1"),
        costTimestamp: timestamp(raw.costTimestamp || raw.supplierCostTimestamp || raw.updatedAt || price.updatedAt || pkg.updatedAt, now),
        source,
        configured: true
    };
}

function compatibilityCost({ price = {}, pkg = {}, region, currency, now = new Date() } = {}) {
    const fallback = amount(price.amount);
    if (fallback === null) {
        throw new Error("Catalog package has no usable supplier cost or compatibility price.");
    }
    return {
        amount: fallback,
        currency,
        supplierName: text(pkg.metadata?.supplierName || "LEGACY_CATALOG_COMPATIBILITY"),
        supplierVersion: text(pkg.metadata?.supplierVersion || `catalog:${upper(region)}:${upper(currency)}`),
        costTimestamp: timestamp(pkg.updatedAt, now),
        source: "catalog_price_compatibility",
        configured: false,
        warning: "SUPPLIER_COST_NOT_CONFIGURED"
    };
}

function resolveSupplierCostSnapshot({ pkg = {}, price = {}, region, currency, now = new Date() } = {}) {
    const normalizedRegion = upper(region);
    const normalizedCurrency = upper(currency || price.currency);
    if (!REGION.includes(normalizedRegion)) throw new Error(`Unsupported supplier cost region: ${normalizedRegion || "(empty)"}`);
    if (!STOREFRONT_CURRENCY.includes(normalizedCurrency)) throw new Error(`Unsupported storefront currency: ${normalizedCurrency || "(empty)"}`);

    const direct = normalizeSupplierCost({
        raw: {
            rawSupplierCost: price.rawSupplierCost ?? price.supplierCost,
            rawSupplierCurrency: price.rawSupplierCurrency || price.supplierCurrency,
            supplierCostSource: price.supplierCostSource,
            providerProductCode: price.providerProductCode,
            providerOfferCode: price.providerOfferCode,
            fundingCost: price.fundingCost,
            otherAcquisitionCost: price.otherAcquisitionCost,
            supplierName: price.supplierName,
            supplierVersion: price.supplierVersion,
            costTimestamp: price.supplierCostTimestamp
        },
        price,
        pkg,
        region: normalizedRegion,
        currency: normalizedCurrency,
        now,
        source: `catalog_package.prices.${normalizedRegion}`
    });
    if (direct) return direct;

    const metadata = normalizeSupplierCost({
        raw: regionCostFromMetadata(pkg, normalizedRegion),
        price,
        pkg,
        region: normalizedRegion,
        currency: normalizedCurrency,
        now,
        source: `catalog_package.metadata.supplierCosts.${normalizedRegion}`
    });
    if (metadata) return metadata;

    return compatibilityCost({
        price,
        pkg,
        region: normalizedRegion,
        currency: normalizedCurrency,
        now
    });
}

module.exports = Object.freeze({
    resolveSupplierCostSnapshot
});
