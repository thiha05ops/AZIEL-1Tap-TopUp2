const CatalogProduct = require("../models/CatalogProduct");
const Supplier = require("../models/Supplier");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");
const { supportsMapping } = require("./suppliers/supplierFulfillmentDispatcher");
const { validateFulfillmentEligibility, isCustomerMarketEligible, supplierRouteProductMarketCompatibility } = require("./supplierFulfillmentEligibilityService");

const REGIONS = Object.freeze(["MM", "TH"]);

function normalizeRegion(value = "") {
    const region = String(value || "").trim().toUpperCase();
    return REGIONS.includes(region) ? region : "";
}

function resolvedSupplierMarketForReadiness(mapping = {}, supplierProduct = {}) {
    const catalogMarket = String(supplierProduct?.supplierMarketCode || "").trim().toUpperCase();
    if (catalogMarket && !["UNKNOWN", "UNSPECIFIED"].includes(catalogMarket)) return catalogMarket;
    return normalizeRegion(mapping?.region);
}

function supplierProductCodeForReadiness(mapping = {}, supplier = {}, supplierProduct = {}) {
    const supplierCode = String(supplier?.supplierCode || mapping?.supplierCode || "").trim().toUpperCase();
    if (supplierCode === "WONDD") return String(supplierProduct?.metadata?.transactionalServiceCode || mapping?.supplierProductCode || "").trim();
    return String(supplierProduct?.supplierProductCode || "").trim();
}

function manualAllowedRegions(product = {}) {
    return Array.isArray(product.fulfillment?.manualAllowedRegions)
        ? product.fulfillment.manualAllowedRegions.map(normalizeRegion).filter(Boolean)
        : [];
}

function isManualFulfillmentAllowed(product = {}, region = "") {
    return manualAllowedRegions(product).includes(normalizeRegion(region));
}

function classifyMapping(mapping = {}, supplier = {}) {
    const supplierMode = String(supplier.mode || "").toUpperCase();
    const executionMode = String(mapping.executionMode || "").toUpperCase();
    return supplierMode === "API" && executionMode === "API" ? "SUPPLIER_API" : "SUPPLIER_MANUAL";
}

function isSupplierMappedAutoTopupThScope({ productCode = "", region = "" } = {}) {
    return ["mlbb", "freefire"].includes(String(productCode || "").trim().toLowerCase()) && normalizeRegion(region) === "TH";
}

function assessProductionReadyFulfillmentMapping(mapping = {}, supplier = {}, context = {}) {
    const productCode = String(context.productCode || mapping.productCode || "").trim().toLowerCase();
    const packageCode = String(context.packageCode || mapping.packageCode || "").trim().toUpperCase();
    const region = normalizeRegion(context.region || mapping.region);
    const routeMarket = String(context.supplierRouteMarket || mapping.region || "").trim().toUpperCase();
    const productCompatibilityMarkets = Array.isArray(context.productCompatibilityMarkets)
        ? context.productCompatibilityMarkets
        : [];
    const readiness = mapping.mappingMetadata?.readiness || {};
    const blockers = [];
    const eligibility = validateFulfillmentEligibility(mapping.fulfillmentEligibility);

    if (mapping.enabled !== true) blockers.push("MAPPING_DISABLED");
    if (mapping.archivedAt) blockers.push("MAPPING_ARCHIVED");
    if (String(mapping.productCode || "").trim().toLowerCase() !== productCode ||
        String(mapping.packageCode || "").trim().toUpperCase() !== packageCode) blockers.push("EXACT_MAPPING_MISMATCH");
    if (!String(mapping.supplierProductCode || "").trim() || !String(mapping.supplierPackageCode || "").trim()) blockers.push("EXACT_MAPPING_INCOMPLETE");
    if (String(mapping.executionMode || "").trim().toUpperCase() !== "API") blockers.push("MAPPING_EXECUTION_NOT_API");
    if (String(mapping.productionRole || "").trim().toUpperCase() !== "PRIMARY") blockers.push("MAPPING_NOT_PRIMARY");
    if (!supplier || supplier.enabled !== true || String(supplier.mode || "").trim().toUpperCase() !== "API") blockers.push("SUPPLIER_NOT_API_READY");
    if (productCompatibilityMarkets.length && !supplierRouteProductMarketCompatibility(routeMarket, productCompatibilityMarkets).compatible) blockers.push("PRODUCT_ACCOUNT_MARKET_INCOMPATIBLE");
    if (!eligibility.valid) blockers.push(...eligibility.errors);
    else if (eligibility.value.mode === "UNKNOWN") blockers.push("FULFILLMENT_ELIGIBILITY_UNKNOWN");
    else if (!isCustomerMarketEligible(mapping.fulfillmentEligibility, region)) blockers.push("CUSTOMER_MARKET_NOT_ELIGIBLE");
    ["supplierMapped", "inputReady", "validationReady", "pricingReady", "fulfillmentReady", "storefrontReady"].forEach(flag => {
        if (readiness[flag] !== true) blockers.push(`${flag.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}_FALSE`);
    });

    const adapterResolver = context.adapterResolver || getSupplierAdapter;
    const mappingSupportResolver = context.mappingSupportResolver || supportsMapping;
    const adapter = supplier ? adapterResolver(supplier) : null;
    if (!adapter?.isConfigured?.()) blockers.push("SUPPLIER_ADAPTER_NOT_READY");
    if (adapter?.isAutoFulfillmentEnabled?.(mapping.productCode) !== true) {
        let blocker = "PROVIDER_FEATURE_GATE_OFF";
        try { if (adapter?.autoFulfillmentGateState?.(mapping.productCode)?.blockerCode === "SUPPLIER_AUTO_FULFILLMENT_DISABLED") blocker = "SUPPLIER_AUTO_FULFILLMENT_DISABLED"; } catch { /* Fail closed. */ }
        blockers.push(blocker);
    }
    if (!mappingSupportResolver(mapping)) blockers.push("FULFILLMENT_PROCESSOR_NOT_READY");
    if (context.requireCatalogEvidence) {
        const offer = context.offer;
        const availability = context.availability;
        const offerMatches = offer && String(offer._id) === String(mapping.supplierCatalogOfferId) &&
            String(offer.supplierId) === String(mapping.supplierId) &&
            String(offer.supplierProductCode || "").trim() === String(mapping.supplierProductCode || "").trim() &&
            String(offer.supplierOfferCode || "").trim() === String(mapping.supplierPackageCode || "").trim() &&
            String(offer.catalogLifecycleState || "").toUpperCase() === "ACTIVE";
        if (!offerMatches) blockers.push("SUPPLIER_OFFER_NOT_ACTIVE");
        if (!availability || String(availability.supplierCatalogOfferId) !== String(mapping.supplierCatalogOfferId) || String(availability.state || "").toUpperCase() !== "AVAILABLE") blockers.push("SUPPLIER_AVAILABILITY_NOT_CONFIRMED");
    }

    return { ready: blockers.length === 0, blockers: [...new Set(blockers)].sort(), eligibility: eligibility.value };
}

function isProductionReadyFulfillmentMapping(mapping = {}, supplier = {}, context = {}) {
    return assessProductionReadyFulfillmentMapping(mapping, supplier, context).ready;
}

function assessPreCommercialFulfillmentReadiness({
    mapping = null,
    supplier = null,
    supplierProduct = null,
    offer = null,
    availability = null,
    canonicalProduct = null,
    canonicalPackages = [],
    customerMarkets = [],
    fulfillmentContract = null,
    adapterConfigured = false,
    autoFulfillmentEnabled = false,
    processorSupported = false
} = {}) {
    const blockers = [];
    const markets = [...new Set((customerMarkets || []).map(normalizeRegion).filter(Boolean))].sort();
    const packages = Array.isArray(canonicalPackages) ? canonicalPackages.filter(Boolean) : [];
    if (!mapping) blockers.push("MISSING_MAPPING");
    if (mapping?.archivedAt) blockers.push("MAPPING_ARCHIVED");
    if (!supplier || supplier.enabled !== true || String(supplier.mode || "").toUpperCase() !== "API") blockers.push("SUPPLIER_UNSUPPORTED");
    if (!supplierProduct || String(supplierProduct.supportState || "").toUpperCase() !== "SUPPORTED") blockers.push("SUPPLIER_PRODUCT_UNSUPPORTED");
    if (!offer || String(offer.catalogLifecycleState || "").toUpperCase() !== "ACTIVE") blockers.push("OFFER_NOT_ACTIVE");
    if (!availability || String(availability.state || "").toUpperCase() !== "AVAILABLE" || (availability.staleAt && new Date(availability.staleAt).getTime() <= Date.now())) blockers.push("AVAILABILITY_UNPROVEN");
    if (!canonicalProduct || packages.length === 0) blockers.push("MISSING_CANONICAL_LINK");
    if (packages.length > 1) blockers.push("AMBIGUOUS_CANONICAL_IDENTITY");
    if (mapping && offer) {
        const offerProductCode = String(mapping?.supplierCode || "").trim().toUpperCase() === "WONDD"
            ? String(mapping.supplierProductCode || "").trim()
            : String(offer.supplierProductCode || "").trim();
        if (String(mapping.supplierCatalogOfferId || "") !== String(offer._id || "") ||
            String(mapping.supplierId || "") !== String(offer.supplierId || "") ||
            String(mapping.supplierProductCode || "").trim() !== offerProductCode ||
            String(mapping.supplierPackageCode || "").trim() !== String(offer.supplierOfferCode || "").trim()) blockers.push("STALE_OR_WRONG_OFFER_LINKAGE");
    }
    if (mapping && supplierProduct) {
        if (String(mapping.supplierId || "") !== String(supplierProduct.supplierId || "") ||
            String(mapping.supplierProductCode || "").trim() !== supplierProductCodeForReadiness(mapping, supplier, supplierProduct)) blockers.push("SUPPLIER_IDENTITY_MISMATCH");
        const supplierMarket = resolvedSupplierMarketForReadiness(mapping, supplierProduct);
        if (!supplierMarket || ["UNKNOWN", "UNSPECIFIED"].includes(supplierMarket) || supplierMarket !== String(mapping.region || "").trim().toUpperCase()) blockers.push("MARKET_UNRESOLVED");
        if (!supplierRouteProductMarketCompatibility(supplierMarket, canonicalProduct?.supportedRegions || []).compatible) blockers.push("PRODUCT_ACCOUNT_MARKET_INCOMPATIBLE");
    }
    if (!markets.length) blockers.push("CUSTOMER_MARKET_REQUIRED");
    const eligibility = validateFulfillmentEligibility(mapping?.fulfillmentEligibility);
    if (!eligibility.valid || eligibility.value.mode === "UNKNOWN" || markets.some(market => !isCustomerMarketEligible(mapping.fulfillmentEligibility, market))) blockers.push("CUSTOMER_MARKET_ELIGIBILITY_UNPROVEN");
    if (!fulfillmentContract?.fields?.length) blockers.push("INPUT_CONTRACT_UNRESOLVED");
    if (String(mapping?.executionMode || "").toUpperCase() !== "API" || processorSupported !== true) blockers.push("PROTOCOL_UNSUPPORTED");
    if (adapterConfigured !== true) blockers.push("SUPPLIER_ADAPTER_NOT_READY");
    if (autoFulfillmentEnabled !== true) blockers.push("SUPPLIER_AUTO_FULFILLMENT_DISABLED");
    const readiness = mapping?.mappingMetadata?.readiness || {};
    if (readiness.supplierMapped !== true) blockers.push("SUPPLIER_MAPPING_NOT_READY");
    if (readiness.inputReady !== true) blockers.push("INPUT_NOT_READY");
    if (readiness.validationReady !== true) blockers.push("VALIDATION_NOT_READY");
    if (readiness.fulfillmentReady !== true) blockers.push("FULFILLMENT_NOT_READY");
    return {
        ready: blockers.length === 0,
        blockers: [...new Set(blockers)].sort(),
        customerMarkets: markets,
        evidence: {
            mappingId: String(mapping?._id || ""),
            supplierId: String(mapping?.supplierId || ""),
            supplierCatalogProductId: String(supplierProduct?._id || ""),
            supplierCatalogOfferId: String(offer?._id || ""),
            canonicalProductId: String(canonicalProduct?._id || ""),
            canonicalPackageIds: packages.map(item => String(item._id || "")).sort(),
            supplierMarket: String(mapping?.region || "").trim().toUpperCase(),
            protocol: String(fulfillmentContract?.protocol || "").trim(),
            availabilityObservedAt: availability?.observedAt || null,
            availabilityComplete: availability?.coverageComplete === true
        },
        ignoredCommercialState: ["enabled", "productionRole", "pricingReady", "storefrontReady", "retailPrice", "publication"]
    };
}

function eligibleMappingsForPackage({ mappings = [], suppliers = [], productCode = "", packageCode = "", region = "", context = {} } = {}) {
    const normalizedProduct = String(productCode || "").trim().toLowerCase();
    const normalizedPackage = String(packageCode || "").trim().toUpperCase();
    const normalizedRegion = normalizeRegion(region);
    const supplierById = new Map(suppliers.filter(item => item.enabled !== false).map(item => [String(item._id), item]));
    return mappings.flatMap(mapping => {
        const supplier = supplierById.get(String(mapping.supplierId));
        if (!supplier || mapping.enabled === false) return [];
        if (String(mapping.productCode || "").toLowerCase() !== normalizedProduct) return [];
        if (String(mapping.packageCode || "").toUpperCase() !== normalizedPackage) return [];
        if (!isCustomerMarketEligible(mapping.fulfillmentEligibility, normalizedRegion)) return [];
        if (!isProductionReadyFulfillmentMapping(mapping, supplier, {
            ...context,
            productCompatibilityMarkets: context.productCompatibilityMarkets,
            supplierRouteMarket: mapping.region,
            offer: context.offerByMappingId?.get(String(mapping._id)) || context.offer,
            availability: context.availabilityByMappingId?.get(String(mapping._id)) || context.availability,
            productCode: normalizedProduct,
            packageCode: normalizedPackage,
            region: normalizedRegion
        })) return [];
        return [{ mapping, supplier, routeType: classifyMapping(mapping, supplier) }];
    });
}

function resolveFulfillmentCapability({ product = {}, mappings = [], suppliers = [], productCode = "", packageCode = "", region = "", context = {} } = {}) {
    const eligible = eligibleMappingsForPackage({
        mappings,
        suppliers,
        productCode,
        packageCode,
        region,
        context: {
            productCompatibilityMarkets: product.supportedRegions || [],
            ...context
        }
    });
    const automatedRoutes = eligible.filter(item => item.routeType === "SUPPLIER_API");
    const supplierManualRoutes = eligible.filter(item => item.routeType === "SUPPLIER_MANUAL");
    const identifiedPrimary = mappings.some(mapping => !mapping.archivedAt && String(mapping.productionRole || "").toUpperCase() === "PRIMARY" &&
        String(mapping.productCode || "").toLowerCase() === String(productCode || "").toLowerCase() &&
        String(mapping.packageCode || "").toUpperCase() === String(packageCode || "").toUpperCase());
    const manualAdminAllowed = !identifiedPrimary && isManualFulfillmentAllowed(product, region);
    return {
        manualAdminAllowed,
        automatedAvailable: automatedRoutes.length > 0,
        supplierManualAvailable: supplierManualRoutes.length > 0,
        fulfillmentAvailable: manualAdminAllowed || eligible.length > 0,
        automatedRoutes,
        supplierManualRoutes,
        eligibleRoutes: eligible
    };
}

async function loadFulfillmentCapability({ productCode = "", packageCode = "", region = "", session = null } = {}) {
    const normalizedProduct = String(productCode || "").trim().toLowerCase();
    const normalizedPackage = String(packageCode || "").trim().toUpperCase();
    const normalizedRegion = normalizeRegion(region);
    const productQuery = CatalogProduct.findOne({ productCode: normalizedProduct });
    const mappingQuery = SupplierProductMapping.find({
        productCode: normalizedProduct,
        packageCode: normalizedPackage,
        archivedAt: null
    });
    if (session) {
        productQuery.session(session);
        mappingQuery.session(session);
    }
    const [product, mappings] = await Promise.all([productQuery.lean(), mappingQuery.lean()]);
    const supplierQuery = Supplier.find({ _id: { $in: mappings.map(item => item.supplierId) }, enabled: true });
    if (session) supplierQuery.session(session);
    const offerQuery = SupplierCatalogOffer.find({ _id: { $in: mappings.map(item => item.supplierCatalogOfferId).filter(Boolean) } });
    const availabilityQuery = SupplierOfferAvailability.find({ supplierCatalogOfferId: { $in: mappings.map(item => item.supplierCatalogOfferId).filter(Boolean) } });
    if (session) { supplierQuery.session(session); offerQuery.session(session); availabilityQuery.session(session); }
    const [suppliers, offers, availabilityRows] = await Promise.all([supplierQuery.lean(), offerQuery.lean(), availabilityQuery.lean()]);
    const offerById = new Map(offers.map(offer => [String(offer._id), offer]));
    const availabilityByOfferId = new Map(availabilityRows.map(row => [String(row.supplierCatalogOfferId), row]));
    const offerByMappingId = new Map(mappings.map(mapping => [String(mapping._id), offerById.get(String(mapping.supplierCatalogOfferId))]));
    const availabilityByMappingId = new Map(mappings.map(mapping => [String(mapping._id), availabilityByOfferId.get(String(mapping.supplierCatalogOfferId))]));
    return resolveFulfillmentCapability({ product: product || {}, mappings, suppliers, productCode: normalizedProduct, packageCode: normalizedPackage, region: normalizedRegion, context: { requireCatalogEvidence: true, offerByMappingId, availabilityByMappingId } });
}

module.exports = {
    REGIONS,
    classifyMapping,
    assessProductionReadyFulfillmentMapping,
    assessPreCommercialFulfillmentReadiness,
    eligibleMappingsForPackage,
    isProductionReadyFulfillmentMapping,
    isSupplierMappedAutoTopupThScope,
    isManualFulfillmentAllowed,
    loadFulfillmentCapability,
    manualAllowedRegions,
    normalizeRegion,
    resolveFulfillmentCapability
};
