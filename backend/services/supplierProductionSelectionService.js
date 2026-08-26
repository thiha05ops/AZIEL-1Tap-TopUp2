"use strict";

const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");

const ROLES = Object.freeze({ PRIMARY: "PRIMARY", BACKUP: "BACKUP", DISABLED: "DISABLED" });
const CORE_PRODUCTS = new Set(["mlbb", "pubg", "freefire", "hok"]);
const clean = value => String(value == null ? "" : value).trim();

function gateEnabled(mapping, adapter) {
    try { return adapter?.isAutoFulfillmentEnabled?.(mapping.productCode) === true; } catch { return false; }
}

async function assessProductionMapping(mappingOrId) {
    const mapping = typeof mappingOrId === "object" && mappingOrId
        ? mappingOrId
        : await Mapping.findById(mappingOrId).lean();
    if (!mapping) return { ready: false, blockers: ["MAPPING_NOT_FOUND"] };
    const [supplier, pkg, controlledTest] = await Promise.all([
        Supplier.findById(mapping.supplierId).lean(),
        CatalogPackage.findOne({ productCode: mapping.productCode, packageCode: mapping.packageCode, deletedAt: null }).lean(),
        FulfillmentAttempt.findOne({ supplierMappingId: mapping._id, status: "SUCCEEDED", supplierReference: { $ne: "" } }).select("_id").lean()
    ]);
    const blockers = [];
    if (mapping.archivedAt) blockers.push("MAPPING_ARCHIVED");
    if (!CORE_PRODUCTS.has(mapping.productCode)) blockers.push("PRODUCT_OUT_OF_CORE_SCOPE");
    if (!pkg) blockers.push("CANONICAL_PACKAGE_MISSING");
    if (mapping.enabled !== true) blockers.push("MAPPING_DISABLED");
    if (!supplier?.enabled) blockers.push("SUPPLIER_DISABLED");
    if (!supplier?.supportedRegions?.includes(mapping.region)) blockers.push("REGION_INCOMPATIBLE");
    if (!clean(mapping.supplierProductCode) || !clean(mapping.supplierPackageCode)) blockers.push("EXACT_MAPPING_INCOMPLETE");
    const readiness = mapping.mappingMetadata?.readiness || {};
    if (readiness.supplierMapped !== true) blockers.push("SUPPLIER_MAPPING_NOT_READY");
    if (readiness.pricingReady !== true) blockers.push("PRICING_NOT_READY");
    if (readiness.inputReady !== true) blockers.push("INPUT_NOT_READY");
    if (readiness.fulfillmentReady !== true) blockers.push("FULFILLMENT_NOT_READY");
    const cost = Number(mapping.supplierCostAuthority?.rawSupplierCost ?? mapping.mappingMetadata?.supplierCost?.amount);
    const capturedValue = mapping.supplierCostAuthority?.capturedAt;
    const capturedAt = new Date(capturedValue || 0);
    const maxAgeSeconds = Number(mapping.mappingMetadata?.costAuthorityMaximumAgeSeconds || 86400);
    if (!Number.isFinite(cost) || cost < 0 || !capturedValue || !Number.isFinite(capturedAt.getTime())) blockers.push("CURRENT_SUPPLIER_COST_MISSING");
    else if (Date.now() - capturedAt.getTime() > maxAgeSeconds * 1000) blockers.push("SUPPLIER_COST_AUTHORITY_STALE");
    const price = pkg?.prices?.[mapping.region];
    if (!pkg?.enabled || price?.enabled !== true || !Number.isFinite(Number(price?.amount)) || Number(price.amount) <= 0) blockers.push("PRODUCTION_PRICE_NOT_PUBLISHED");
    const adapter = supplier ? getSupplierAdapter(supplier) : null;
    if (mapping.executionMode !== "API" || !adapter?.isConfigured?.()) blockers.push("SUPPLIER_ADAPTER_NOT_READY");
    if (!gateEnabled(mapping, adapter)) blockers.push("PROVIDER_FEATURE_GATE_OFF");
    if (supplier?.supplierCode === "FAZERCARDS") {
        const { supportsFazerCardsMapping } = require("./suppliers/fazercardsFulfillmentProcessor");
        if (!supportsFazerCardsMapping(mapping)) blockers.push("FULFILLMENT_PROCESSOR_NOT_READY");
    }
    return { ready: blockers.length === 0, blockers, mapping, supplier, package: pkg, featureGateEnabled: gateEnabled(mapping, adapter), controlledTestEvidence: Boolean(controlledTest) };
}

async function setProductionRole(mappingId, role, { session = null } = {}) {
    const normalizedRole = clean(role).toUpperCase();
    if (!Object.values(ROLES).includes(normalizedRole)) throw Object.assign(new Error("Invalid production role."), { code: "INVALID_PRODUCTION_ROLE" });
    const mapping = await Mapping.findById(mappingId).session(session);
    if (!mapping) throw Object.assign(new Error("Supplier mapping not found."), { code: "SUPPLIER_MAPPING_NOT_FOUND" });
    if (normalizedRole === ROLES.PRIMARY) {
        const assessment = await assessProductionMapping(mapping.toObject());
        if (!assessment.ready) throw Object.assign(new Error(`Mapping cannot become PRIMARY: ${assessment.blockers.join(", ")}`), { code: "MAPPING_NOT_PRODUCTION_READY", blockers: assessment.blockers });
        await Mapping.updateMany({ _id: { $ne: mapping._id }, productCode: mapping.productCode, packageCode: mapping.packageCode, region: mapping.region, productionRole: ROLES.PRIMARY }, { $set: { productionRole: ROLES.BACKUP } }, { session });
    } else if (mapping.productionRole === ROLES.PRIMARY) {
        const [otherPrimary, product, pkg] = await Promise.all([
            Mapping.findOne({ _id: { $ne: mapping._id }, productCode: mapping.productCode, packageCode: mapping.packageCode, region: mapping.region, productionRole: ROLES.PRIMARY, archivedAt: null }).session(session).lean(),
            CatalogProduct.findOne({ productCode: mapping.productCode, enabled: true, deletedAt: null }).session(session).lean(),
            CatalogPackage.findOne({ productCode: mapping.productCode, packageCode: mapping.packageCode, enabled: true, deletedAt: null }).session(session).lean()
        ]);
        const manualAllowed = product?.fulfillment?.manualAllowedRegions?.includes(mapping.region) === true;
        const publishedPrice = pkg?.prices?.[mapping.region];
        if (!otherPrimary && (!manualAllowed || publishedPrice?.enabled !== true || !(Number(publishedPrice.amount) > 0))) {
            throw Object.assign(new Error("The sole PRIMARY cannot be removed because a valid MANUAL_ADMIN fallback is not available."), { code: "PRIMARY_ROUTE_REQUIRED" });
        }
    }
    mapping.productionRole = normalizedRole;
    await mapping.save({ session });
    return mapping;
}

async function resolvePrimaryRouteSnapshot({ productCode, packageCode, region }) {
    const mapping = await Mapping.findOne({ productCode: clean(productCode).toLowerCase(), packageCode: clean(packageCode).toUpperCase(), region: clean(region).toUpperCase(), productionRole: ROLES.PRIMARY, archivedAt: null }).lean();
    const assessment = await assessProductionMapping(mapping);
    if (!assessment.ready) return { ready: false, blockers: assessment.blockers, routeSnapshot: null };
    return { ready: true, blockers: [], routeSnapshot: Object.freeze({ routeType: "SUPPLIER_API", supplierMappingId: String(mapping._id), supplierId: String(mapping.supplierId), supplierCode: mapping.supplierCode, productCode: mapping.productCode, packageCode: mapping.packageCode, region: mapping.region, supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode, executionMode: mapping.executionMode, selectedRole: ROLES.PRIMARY, selectedAt: new Date().toISOString() }) };
}

async function resolveCheckoutRouteSnapshot({ productCode, packageCode, region }) {
    const primary = await resolvePrimaryRouteSnapshot({ productCode, packageCode, region });
    if (primary.ready) return primary;
    const normalizedProduct = clean(productCode).toLowerCase();
    const normalizedPackage = clean(packageCode).toUpperCase();
    const normalizedRegion = clean(region).toUpperCase();
    const [product, pkg] = await Promise.all([
        CatalogProduct.findOne({ productCode: normalizedProduct, enabled: true, deletedAt: null }).lean(),
        CatalogPackage.findOne({ productCode: normalizedProduct, packageCode: normalizedPackage, enabled: true, deletedAt: null }).lean()
    ]);
    const price = pkg?.prices?.[normalizedRegion];
    const manualAllowed = product?.fulfillment?.manualAllowedRegions?.includes(normalizedRegion) === true;
    if (manualAllowed && price?.enabled === true && Number(price.amount) > 0) {
        return { ready: true, blockers: [], routeSnapshot: Object.freeze({ routeType: "MANUAL_ADMIN", supplierMappingId: "", supplierId: "", supplierCode: "AZIEL_ADMIN", productCode: normalizedProduct, packageCode: normalizedPackage, region: normalizedRegion, selectedRole: "MANUAL_FALLBACK", selectedAt: new Date().toISOString() }) };
    }
    return { ready: false, blockers: [...primary.blockers, !manualAllowed ? "MANUAL_ADMIN_NOT_ALLOWED" : "MANUAL_PRICE_NOT_PUBLISHED"], routeSnapshot: null };
}

module.exports = { ROLES, CORE_PRODUCTS, assessProductionMapping, setProductionRole, resolvePrimaryRouteSnapshot, resolveCheckoutRouteSnapshot };
