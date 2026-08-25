const CatalogProduct = require("../models/CatalogProduct");
const Supplier = require("../models/Supplier");
const SupplierProductMapping = require("../models/SupplierProductMapping");

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

function isWonddAutoTopupThScope({ productCode = "", region = "" } = {}) {
    return ["mlbb", "freefire"].includes(String(productCode || "").trim().toLowerCase()) && normalizeRegion(region) === "TH";
}

function isProductionReadyWonddMapping(mapping = {}, supplier = {}) {
    const readiness = mapping.mappingMetadata?.readiness || {};
    const productCode = String(mapping.productCode || "").trim().toLowerCase();
    return mapping.enabled === true &&
        String(mapping.supplierCode || supplier.supplierCode || "").trim().toUpperCase() === "WONDD" &&
        String(supplier.supplierCode || mapping.supplierCode || "").trim().toUpperCase() === "WONDD" &&
        String(mapping.region || "").trim().toUpperCase() === "TH" &&
        ["mlbb", "freefire"].includes(productCode) &&
        String(mapping.supplierProductCode || "").trim().toLowerCase() === productCode &&
        Boolean(String(mapping.supplierPackageCode || "").trim()) &&
        String(mapping.executionMode || "").trim().toUpperCase() === "API" &&
        String(supplier.mode || "").trim().toUpperCase() === "API" &&
        readiness.supplierMapped === true &&
        readiness.inputReady === true &&
        readiness.pricingReady === true &&
        readiness.fulfillmentReady === true;
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
        if (isWonddAutoTopupThScope({ productCode: normalizedProduct, region: normalizedRegion }) && !isProductionReadyWonddMapping(mapping, supplier)) return [];
        return [{ mapping, supplier, routeType: classifyMapping(mapping, supplier) }];
    });
}

function resolveFulfillmentCapability({ product = {}, mappings = [], suppliers = [], productCode = "", packageCode = "", region = "" } = {}) {
    const eligible = eligibleMappingsForPackage({ mappings, suppliers, productCode, packageCode, region });
    const automatedRoutes = eligible.filter(item => item.routeType === "SUPPLIER_API");
    const supplierManualRoutes = eligible.filter(item => item.routeType === "SUPPLIER_MANUAL");
    const manualAdminAllowed = isWonddAutoTopupThScope({ productCode, region }) ? false : isManualFulfillmentAllowed(product, region);
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
    eligibleMappingsForPackage,
    isProductionReadyWonddMapping,
    isProductionReadyWonddMlbbMapping: isProductionReadyWonddMapping,
    isWonddAutoTopupThScope,
    isWonddMlbbThScope: isWonddAutoTopupThScope,
    isManualFulfillmentAllowed,
    loadFulfillmentCapability,
    manualAllowedRegions,
    normalizeRegion,
    resolveFulfillmentCapability
};
