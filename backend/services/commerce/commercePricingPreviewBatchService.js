"use strict";

const { resolveCommercePricingPreview } = require("./commercePricingPreviewService");
const { loadCatalogPackage } = require("./commercePricingPreviewService");
const CatalogProduct = require("../../models/CatalogProduct");
const CatalogPackage = require("../../models/CatalogPackage");
const { findCatalogPackageByIdentity } = require("./catalogPackageIdentityService");

function packageCode(item = {}) {
    return String(item.packageCode || "").trim().toUpperCase();
}

function productCode(item = {}) {
    return String(item.productCode || item.gameKey || "").trim().toLowerCase();
}

async function buildBatchCatalogLoader(items, dependencies = {}) {
    if (dependencies.loadCatalogPackage) return dependencies.loadCatalogPackage;
    const productCodes = [...new Set(items.map(productCode).filter(Boolean))];
    const packageCodes = [...new Set(items.map(packageCode).filter(Boolean))];
    const [products, packages] = await Promise.all([
        dependencies.findProducts
            ? dependencies.findProducts(productCodes)
            : CatalogProduct.find({ productCode: { $in: productCodes } }).lean(),
        dependencies.findPackages
            ? dependencies.findPackages(productCodes, packageCodes)
            : CatalogPackage.find({
            productCode: { $in: productCodes },
            packageCode: { $in: packageCodes },
            enabled: true,
            deletedAt: null
        }).lean()
    ]);
    const productsByCode = new Map(products.map(product => [productCode(product), product]));
    const packagesByIdentity = new Map(packages.map(pkg => [`${productCode(pkg)}:${packageCode(pkg)}`, pkg]));
    return input => loadCatalogPackage(input, {
        findProduct: code => productsByCode.get(code) || null,
        findPackage: (code, pkgCode) => packagesByIdentity.get(`${code}:${pkgCode}`)
            || (dependencies.findFallbackPackage || findCatalogPackageByIdentity)(code, pkgCode, { enabled: true, deletedAt: null })
    });
}

async function resolveCommercePricingPreviewBatch(items, context = {}, dependencies = {}) {
    const resolvePreview = dependencies.resolvePreview || resolveCommercePricingPreview;
    const projectError = dependencies.projectError || (() => ({
        code: "PRICING_PREVIEW_UNAVAILABLE",
        message: "Pricing preview is temporarily unavailable."
    }));
    const concurrency = Math.max(1, Math.min(8, Number(dependencies.concurrency || 4)));
    const batchCatalogLoader = dependencies.resolvePreview
        ? dependencies.loadCatalogPackage
        : await buildBatchCatalogLoader(items, dependencies);
    const results = [];

    for (let index = 0; index < items.length; index += concurrency) {
        const batch = items.slice(index, index + concurrency);
        const settled = await Promise.allSettled(batch.map(item => resolvePreview(item, context, batchCatalogLoader
            ? { loadCatalogPackage: batchCatalogLoader }
            : undefined)));
        results.push(...settled.map((result, offset) => {
            const item = batch[offset];
            return result.status === "fulfilled"
                ? {
                    success: true,
                    packageCode: packageCode(item),
                    resolvedPackageCode: packageCode(result.value),
                    quote: result.value
                }
                : { success: false, packageCode: packageCode(item), error: projectError(result.reason) };
        }));
    }

    return results;
}

module.exports = Object.freeze({ buildBatchCatalogLoader, resolveCommercePricingPreviewBatch });
