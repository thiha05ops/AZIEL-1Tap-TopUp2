"use strict";

const SUPPORTED_REGIONS = Object.freeze(["MM", "TH"]);

const normalizeRegion = value => String(value || "").trim().toUpperCase();

function normalizeProductRegions(product = {}) {
    if (!Array.isArray(product.supportedRegions)) return [];
    return [...new Set(product.supportedRegions
        .map(normalizeRegion)
        .filter(region => SUPPORTED_REGIONS.includes(region)))];
}

function productSupportsRegion(product = {}, region = "") {
    return normalizeProductRegions(product).includes(normalizeRegion(region));
}

function isProductPubliclyEligible(product = {}) {
    const commerceState = String(product.commerceState || product.requestedCommerceState || "HIDDEN")
        .trim()
        .toUpperCase();

    return product.enabled !== false &&
        !product.deletedAt &&
        product.publicDiscoveryEnabled === true &&
        commerceState === "PURCHASABLE" &&
        String(product.lifecycleStatus || "ACTIVE").trim().toUpperCase() !== "COMING_SOON";
}

module.exports = Object.freeze({
    SUPPORTED_REGIONS,
    isProductPubliclyEligible,
    normalizeProductRegions,
    productSupportsRegion
});
