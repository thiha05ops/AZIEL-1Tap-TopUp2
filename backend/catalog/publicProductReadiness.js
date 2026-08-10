const { isCanonicalProductCode, resolveCanonicalProductRoute } = require("./canonicalOperationalCatalog");

const REGIONS = Object.freeze(["MM", "TH"]);

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
    return {
        region,
        supported,
        packageCount: purchasablePackages.length,
        pricingReady: purchasablePackages.length > 0,
        fulfillmentReady,
        availabilityReady,
        blockers,
        warnings: [],
        state: blockers.length === 0 ? "AVAILABLE" : "COMING_SOON"
    };
}

function resolvePublicProductReadiness(product = {}, packages = [], commerceReadiness = {}) {
    const canonical = isCanonicalProductCode(product.productCode);
    const route = resolveCanonicalProductRoute(product.productCode, product.productRoute);
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
    return { state, requestedState: requested, route, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)], regions };
}

module.exports = { REGIONS, regionReadiness, resolvePublicProductReadiness };
