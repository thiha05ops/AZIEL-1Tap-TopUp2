const CatalogProduct = require("../models/CatalogProduct");
const Supplier = require("../models/Supplier");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");
const { supportsMapping } = require("./suppliers/supplierFulfillmentDispatcher");
const { validateFulfillmentEligibility, isCustomerMarketEligible } = require("./supplierFulfillmentEligibilityService");

const REGIONS = Object.freeze(["MM", "TH"]);

function normalizeRegion(value = "") {
    const region = String(value || "").trim().toUpperCase();
    return REGIONS.includes(region) ? region : "";
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
    const readiness = mapping.mappingMetadata?.readiness || {};
    const blockers = [];
    const eligibility = validateFulfillmentEligibility(mapping.fulfillmentEligibility);

    if (mapping.enabled !== true) blockers.push("MAPPING_DISABLED");
    if (mapping.archivedAt) blockers.push("MAPPING_ARCHIVED");
    if (String(mapping.productCode || "").trim().toLowerCase() !== productCode ||
        String(mapping.packageCode || "").trim().toUpperCase() !== packageCode) blockers.push("EXACT_MAPPING_MISMATCH");
    if (normalizeRegion(mapping.region) !== region) blockers.push("MAPPING_REGION_MISMATCH");
    if (!String(mapping.supplierProductCode || "").trim() || !String(mapping.supplierPackageCode || "").trim()) blockers.push("EXACT_MAPPING_INCOMPLETE");
    if (String(mapping.executionMode || "").trim().toUpperCase() !== "API") blockers.push("MAPPING_EXECUTION_NOT_API");
    if (String(mapping.productionRole || "").trim().toUpperCase() !== "PRIMARY") blockers.push("MAPPING_NOT_PRIMARY");
    if (!supplier || supplier.enabled !== true || String(supplier.mode || "").trim().toUpperCase() !== "API") blockers.push("SUPPLIER_NOT_API_READY");
    if (Array.isArray(supplier?.supportedRegions) && supplier.supportedRegions.length && !supplier.supportedRegions.map(normalizeRegion).includes(region)) blockers.push("SUPPLIER_REGION_UNSUPPORTED");
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
    if (!mappingSupportResolver(mapping)) blockers.push("FULFILLMENT_PROCESSOR_NOT_READY");

    return { ready: blockers.length === 0, blockers: [...new Set(blockers)].sort(), eligibility: eligibility.value };
}

function isProductionReadyFulfillmentMapping(mapping = {}, supplier = {}, context = {}) {
    return assessProductionReadyFulfillmentMapping(mapping, supplier, context).ready;
}

function eligibleMappingsForPackage({ mappings = [], suppliers = [], productCode = "", packageCode = "", region = "" } = {}) {
    const normalizedProduct = String(productCode || "").trim().toLowerCase();
    const normalizedPackage = String(packageCode || "").trim().toUpperCase();
    const normalizedRegion = normalizeRegion(region);
    const supplierById = new Map(suppliers.filter(item => item.enabled !== false).map(item => [String(item._id), item]));
    return mappings.flatMap(mapping => {
        const supplier = supplierById.get(String(mapping.supplierId));
        if (!supplier || mapping.enabled === false) return [];
        if (String(mapping.productCode || "").toLowerCase() !== normalizedProduct) return [];
        if (String(mapping.packageCode || "").toUpperCase() !== normalizedPackage) return [];
        if (normalizeRegion(mapping.region) !== normalizedRegion) return [];
        if (Array.isArray(supplier.supportedRegions) && supplier.supportedRegions.length && !supplier.supportedRegions.includes(normalizedRegion)) return [];
        if (isSupplierMappedAutoTopupThScope({ productCode: normalizedProduct, region: normalizedRegion }) && !isProductionReadyFulfillmentMapping(mapping, supplier, {
            productCode: normalizedProduct,
            packageCode: normalizedPackage,
            region: normalizedRegion
        })) return [];
        return [{ mapping, supplier, routeType: classifyMapping(mapping, supplier) }];
    });
}

function resolveFulfillmentCapability({ product = {}, mappings = [], suppliers = [], productCode = "", packageCode = "", region = "" } = {}) {
    const eligible = eligibleMappingsForPackage({ mappings, suppliers, productCode, packageCode, region });
    const automatedRoutes = eligible.filter(item => item.routeType === "SUPPLIER_API");
    const supplierManualRoutes = eligible.filter(item => item.routeType === "SUPPLIER_MANUAL");
    const manualAdminAllowed = isSupplierMappedAutoTopupThScope({ productCode, region }) ? false : isManualFulfillmentAllowed(product, region);
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
        region: normalizedRegion,
        enabled: true
    });
    if (session) {
        productQuery.session(session);
        mappingQuery.session(session);
    }
    const [product, mappings] = await Promise.all([productQuery.lean(), mappingQuery.lean()]);
    const supplierQuery = Supplier.find({ _id: { $in: mappings.map(item => item.supplierId) }, enabled: true });
    if (session) supplierQuery.session(session);
    const suppliers = await supplierQuery.lean();
    return resolveFulfillmentCapability({ product: product || {}, mappings, suppliers, productCode: normalizedProduct, packageCode: normalizedPackage, region: normalizedRegion });
}

module.exports = {
    REGIONS,
    classifyMapping,
    assessProductionReadyFulfillmentMapping,
    eligibleMappingsForPackage,
    isProductionReadyFulfillmentMapping,
    isSupplierMappedAutoTopupThScope,
    isManualFulfillmentAllowed,
    loadFulfillmentCapability,
    manualAllowedRegions,
    normalizeRegion,
    resolveFulfillmentCapability
};
