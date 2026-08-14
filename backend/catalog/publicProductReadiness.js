const { isCanonicalProductCode, resolveCanonicalProductRoute } = require("./canonicalOperationalCatalog");

const REGIONS = Object.freeze(["MM", "TH"]);

const PUBLIC_AVAILABILITY = Object.freeze({
    AVAILABLE: "AVAILABLE",
    COMING_SOON: "COMING_SOON",
    PRODUCT_HIDDEN: "PRODUCT_HIDDEN",
    PRODUCT_DISABLED: "PRODUCT_DISABLED",
    REGION_UNAVAILABLE: "REGION_UNAVAILABLE",
    PACKAGE_UNAVAILABLE: "PACKAGE_UNAVAILABLE",
    SETUP_INCOMPLETE: "SETUP_INCOMPLETE",
    PRICING_UNAVAILABLE: "PRICING_UNAVAILABLE",
    CATALOG_UNAVAILABLE: "CATALOG_UNAVAILABLE"
});

const PUBLIC_AVAILABILITY_MESSAGES = Object.freeze({
    AVAILABLE: "Available.",
    COMING_SOON: "Coming soon.",
    PRODUCT_HIDDEN: "This product is currently unavailable.",
    PRODUCT_DISABLED: "This product is currently unavailable.",
    REGION_UNAVAILABLE: "This product is not available in your region.",
    PACKAGE_UNAVAILABLE: "This package is currently unavailable.",
    SETUP_INCOMPLETE: "This product is currently unavailable.",
    PRICING_UNAVAILABLE: "Prices are temporarily unavailable. Please try again shortly.",
    CATALOG_UNAVAILABLE: "Catalog is temporarily unavailable. Please try again shortly."
});

function availabilityReason(code) {
    return PUBLIC_AVAILABILITY_MESSAGES[code] || PUBLIC_AVAILABILITY_MESSAGES.SETUP_INCOMPLETE;
}

function meaningfulDescription(product = {}) {
    return String(product.productKnowledge?.shortDescription || product.description || "").trim();
}

function regionReadiness(product = {}, packages = [], region, commerceReadiness = {}) {
    const supported = Array.isArray(product.supportedRegions) && product.supportedRegions.includes(region);
    const enabled = packages.filter(item => item.enabled !== false && !item.deletedAt);
    const purchasablePackages = enabled.filter(item => {
        const price = item.prices?.[region];
        return supported && price?.enabled !== false && Number.isFinite(Number(price?.amount)) && Number(price.amount) > 0;
    });
    const commerceRegion = commerceReadiness.regions?.[region] || {};
    const fulfillmentReady = commerceRegion.fulfillment === true || (!commerceReadiness.regions && commerceReadiness.checks?.fulfillment === true);
    const availabilityReady = commerceRegion.availability !== false && commerceReadiness.checks?.availability !== false;
    const blockers = [];
    if (!supported) blockers.push("region");
    if (!purchasablePackages.length) blockers.push("packagesAndPricing");
    if (!fulfillmentReady) blockers.push("fulfillment");
    if (!availabilityReady) blockers.push("availability");
    let availabilityCode = PUBLIC_AVAILABILITY.AVAILABLE;
    if (!supported) availabilityCode = PUBLIC_AVAILABILITY.REGION_UNAVAILABLE;
    else if (!purchasablePackages.length) availabilityCode = PUBLIC_AVAILABILITY.SETUP_INCOMPLETE;
    else if (!availabilityReady) availabilityCode = PUBLIC_AVAILABILITY.PACKAGE_UNAVAILABLE;
    else if (!fulfillmentReady) availabilityCode = PUBLIC_AVAILABILITY.SETUP_INCOMPLETE;
    return {
        region,
        supported,
        packageCount: purchasablePackages.length,
        pricingReady: purchasablePackages.length > 0,
        fulfillmentReady,
        availabilityReady,
        blockers,
        warnings: [],
        state: blockers.length === 0 ? "AVAILABLE" : "COMING_SOON",
        availabilityCode,
        availabilityReason: availabilityReason(availabilityCode)
    };
}

function resolvePublicProductReadiness(product = {}, packages = [], commerceReadiness = {}) {
    const canonical = isCanonicalProductCode(product.productCode);
    const route = resolveCanonicalProductRoute(product.productCode);
    const regions = Object.fromEntries(REGIONS.map(region => [region, regionReadiness(product, packages, region, commerceReadiness)]));
    const blockers = [];
    const warnings = [];
    if (!canonical) blockers.push("canonicalIdentity");
    if (!route) blockers.push("route");
    if (!Array.isArray(product.supportedRegions) || !product.supportedRegions.length) blockers.push("regions");
    if (!Object.values(regions).some(item => item.pricingReady)) blockers.push("packagesAndPricing");
    if (!Object.values(regions).some(item => item.fulfillmentReady)) blockers.push("fulfillment");
    if (!Object.values(regions).some(item => item.availabilityReady)) blockers.push("availability");
    if (!meaningfulDescription(product)) warnings.push("description");
    else if (meaningfulDescription(product).length < 40) warnings.push("shortDescription");
    if (!product.productKnowledge?.faq?.length) warnings.push("faq");
    if (!String(product.seo?.title || "").trim()) warnings.push("seoTitle");
    if (!String(product.seo?.description || "").trim()) warnings.push("seoDescription");
    if (!String(product.artworkPath || product.imageUrl || product.presentation?.imageAssetId || "").trim()) warnings.push("artwork");
    if (packages.some(item => item.enabled !== false && !String(item.customerNote || "").trim())) warnings.push("packageNotes");

    const requested = String(product.commerceState || product.requestedCommerceState || "HIDDEN").toUpperCase();
    const discoverable = product.publicDiscoveryEnabled === true && product.enabled !== false && !product.deletedAt;
    let state = "HIDDEN";
    if (canonical && discoverable && requested !== "HIDDEN") {
        const intentionallyComingSoon = String(product.lifecycleStatus || "").toUpperCase() === "COMING_SOON" || requested === "COMING_SOON";
        const regionAvailable = Object.values(regions).some(item => item.state === "AVAILABLE");
        state = !intentionallyComingSoon && requested === "PURCHASABLE" && blockers.length === 0 && regionAvailable ? "AVAILABLE" : "COMING_SOON";
    }
    const intentionallyComingSoon = String(product.lifecycleStatus || "").toUpperCase() === "COMING_SOON" || requested === "COMING_SOON";
    let availabilityCode = PUBLIC_AVAILABILITY.AVAILABLE;
    if (product.enabled === false || product.deletedAt) availabilityCode = PUBLIC_AVAILABILITY.PRODUCT_DISABLED;
    else if (!discoverable || requested === "HIDDEN") availabilityCode = PUBLIC_AVAILABILITY.PRODUCT_HIDDEN;
    else if (intentionallyComingSoon) availabilityCode = PUBLIC_AVAILABILITY.COMING_SOON;
    else if (state !== "AVAILABLE") availabilityCode = PUBLIC_AVAILABILITY.SETUP_INCOMPLETE;
    return {
        state,
        requestedState: requested,
        route,
        blockers: [...new Set(blockers)],
        warnings: [...new Set(warnings)],
        regions,
        availabilityCode,
        availabilityReason: availabilityReason(availabilityCode)
    };
}

module.exports = {
    PUBLIC_AVAILABILITY,
    PUBLIC_AVAILABILITY_MESSAGES,
    REGIONS,
    availabilityReason,
    regionReadiness,
    resolvePublicProductReadiness
};
