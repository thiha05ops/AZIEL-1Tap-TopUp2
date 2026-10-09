"use strict";

const CatalogProduct = require("../../models/CatalogProduct");
const CatalogPackage = require("../../models/CatalogPackage");
const PackageMarketPublication = require("../../models/PackageMarketPublication");
const { isProductPubliclyEligible, productSupportsRegion } = require("../../catalog/productRegionAuthority");
const { canonicalSerialize } = require("./pricingQuoteRuntime");

const text = value => String(value == null ? "" : value).trim();
const upper = value => text(value).toUpperCase();
const lower = value => text(value).toLowerCase();

function denied(reasonCode) {
    return { allowed: false, reasonCode, supplierRouteSnapshot: null };
}

function sameDate(left, right) {
    const a = new Date(left).getTime();
    const b = new Date(right).getTime();
    return Number.isFinite(a) && a === b;
}

function quoteIntegrityMatches(quote = {}) {
    const canonical = quote.integrityPayload?.canonicalCommercialData;
    const serialized = quote.integrityPayload?.canonicalSerialized;
    if (!canonical || !serialized || canonicalSerialize(canonical) !== serialized) return false;
    const pkg = quote.packageSnapshot || {};
    const commercial = quote.commercialSnapshot || {};
    const identity = canonical.packageIdentity || {};
    return text(canonical.quoteId) === text(quote.quoteId) &&
        text(canonical.owner?.userId) === text(quote.owner?.userId) &&
        text(canonical.owner?.sessionId) === text(quote.owner?.sessionId) &&
        text(identity.packageId) === text(pkg.packageId) &&
        upper(identity.packageCode) === upper(pkg.packageCode) &&
        text(identity.packageRef) === text(pkg.packageRef) &&
        upper(canonical.region) === upper(commercial.region) &&
        upper(canonical.currency) === upper(commercial.currency) &&
        Number(canonical.originalPrice) === Number(commercial.originalPrice) &&
        Number(canonical.discountAmount) === Number(commercial.discountAmount) &&
        Number(canonical.quotedUnitPrice) === Number(commercial.quotedUnitPrice) &&
        Number(canonical.quantity) === Number(commercial.quantity) &&
        Number(canonical.quotedTotalAmount) === Number(commercial.quotedTotalAmount) &&
        sameDate(canonical.issuedAt, quote.lifecycle?.issuedAt) &&
        sameDate(canonical.expiresAt, quote.lifecycle?.expiresAt);
}

async function validatePaymentCatalogEligibility({ quote = {}, transactionContext = null } = {}, dependencies = {}) {
    if (!quoteIntegrityMatches(quote)) return denied("QUOTE_INTEGRITY_MISMATCH");
    const productCode = lower(quote.packageSnapshot?.gameCode || quote.packageSnapshot?.productCode);
    const packageCode = upper(quote.packageSnapshot?.packageCode);
    const packageId = text(quote.packageSnapshot?.packageId || quote.packageSnapshot?.packageRef);
    const region = upper(quote.commercialSnapshot?.region);
    const currency = upper(quote.commercialSnapshot?.currency);
    if (!productCode || !packageCode || !packageId || !region || !currency) return denied("PACKAGE_IDENTITY_INCOMPLETE");

    const session = transactionContext?.mongoSession || transactionContext?.session || null;
    const loadProduct = dependencies.loadProduct || (async query => {
        const request = CatalogProduct.findOne(query);
        if (session) request.session(session);
        return request.lean();
    });
    const loadPackage = dependencies.loadPackage || (async query => {
        const request = CatalogPackage.findOne(query);
        if (session) request.session(session);
        return request.lean();
    });
    const loadPublication = dependencies.loadPublication || (async query => {
        const request = PackageMarketPublication.findOne(query);
        if (session) request.session(session);
        return request.lean();
    });
    const [product, pkg, publication] = await Promise.all([
        loadProduct({ productCode }),
        loadPackage({ _id: packageId, productCode, packageCode }),
        loadPublication({ productCode, packageCode, customerMarket: region, published: true })
    ]);
    if (!product || !isProductPubliclyEligible(product)) return denied("PRODUCT_NOT_SELLABLE");
    if (!productSupportsRegion(product, region)) return denied("PRODUCT_REGION_UNAVAILABLE");
    if (!pkg) return denied("PACKAGE_IDENTITY_MISMATCH");
    if (pkg.enabled !== true) return denied("PACKAGE_DISABLED");
    if (pkg.deletedAt) return denied("PACKAGE_DELETED");
    const price = pkg.prices?.[region];
    if (!price || price.enabled !== true || !(Number(price.amount) > 0)) return denied("PACKAGE_PRICE_UNAVAILABLE");
    if (upper(price.currency) !== currency) return denied("PACKAGE_CURRENCY_MISMATCH");
    if (!publication) return denied("PACKAGE_NOT_PUBLISHED");
    return { allowed: true, supplierRouteSnapshot: null };
}

module.exports = Object.freeze({ validatePaymentCatalogEligibility, quoteIntegrityMatches });
