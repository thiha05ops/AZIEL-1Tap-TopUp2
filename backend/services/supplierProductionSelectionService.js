"use strict";

const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");
const { resolveFulfillmentRoutingMode, FULFILLMENT_ROUTING_MODES } = require("../config/fulfillmentRoutingMode");
const { resolveEligibilityPrimaryRoute, OUTCOMES: ELIGIBILITY_OUTCOMES } = require("./supplierEligibilityRouteResolver");
const { isPilotEnabled, matchesPilotRoute } = require("../config/mmWonddMlbbPilot");

const ROLES = Object.freeze({ PRIMARY: "PRIMARY", BACKUP: "BACKUP", DISABLED: "DISABLED" });
const CORE_PRODUCTS = new Set(["mlbb", "pubg", "freefire", "hok"]);
const clean = value => String(value == null ? "" : value).trim();

function gateEnabled(mapping, adapter) {
    try { return adapter?.isAutoFulfillmentEnabled?.(mapping.productCode) === true; } catch { return false; }
}

function gateBlocker(mapping, adapter) {
    try {
        return adapter?.autoFulfillmentGateState?.(mapping.productCode)?.blockerCode === "SUPPLIER_AUTO_FULFILLMENT_DISABLED"
            ? "SUPPLIER_AUTO_FULFILLMENT_DISABLED"
            : "PROVIDER_FEATURE_GATE_OFF";
    } catch { return "PROVIDER_FEATURE_GATE_OFF"; }
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
    return assessProductionMappingFromContext(mapping, { supplier, pkg, controlledTest });
}

function assessProductionMappingFromContext(mapping, { supplier = null, pkg = null, controlledTest = null } = {}) {
    const blockers = [];
    if (mapping.archivedAt) blockers.push("MAPPING_ARCHIVED");
    // Product support is established by the exact mapping, adapter/processor,
    // feature gate and readiness evidence below. A hard-coded product allowlist
    // would make prepared Master Catalog products require another code change.
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
    if (!gateEnabled(mapping, adapter)) blockers.push(gateBlocker(mapping, adapter));
    if (supplier?.supplierCode === "FAZERCARDS") {
        const { supportsFazerCardsMapping } = require("./suppliers/fazercardsFulfillmentProcessor");
        if (!supportsFazerCardsMapping(mapping)) blockers.push("FULFILLMENT_PROCESSOR_NOT_READY");
    }
    return { ready: blockers.length === 0, blockers, mapping, supplier, package: pkg, featureGateEnabled: gateEnabled(mapping, adapter), controlledTestEvidence: Boolean(controlledTest) };
}

async function setProductionRole(mappingId, role, { session = null, replaceExistingPrimaryId = "", displacedRole = "" } = {}) {
    const normalizedRole = clean(role).toUpperCase();
    if (!Object.values(ROLES).includes(normalizedRole)) throw Object.assign(new Error("Invalid production role."), { code: "INVALID_PRODUCTION_ROLE" });
    const mapping = await Mapping.findById(mappingId).session(session);
    if (!mapping) throw Object.assign(new Error("Supplier mapping not found."), { code: "SUPPLIER_MAPPING_NOT_FOUND" });
    if (normalizedRole === ROLES.PRIMARY) {
        const assessment = await assessProductionMapping(mapping.toObject());
        if (!assessment.ready) throw Object.assign(new Error(`Mapping cannot become PRIMARY: ${assessment.blockers.join(", ")}`), { code: "MAPPING_NOT_PRODUCTION_READY", blockers: assessment.blockers });
        const existingPrimary = await Mapping.findOne({ _id: { $ne: mapping._id }, productCode: mapping.productCode, packageCode: mapping.packageCode, region: mapping.region, productionRole: ROLES.PRIMARY, archivedAt: null }).session(session);
        if (existingPrimary) {
            if (clean(replaceExistingPrimaryId) !== String(existingPrimary._id)) throw Object.assign(new Error("A different PRIMARY already exists; explicit Owner replacement is required."), { code: "PRIMARY_ROUTE_CONFLICT", currentPrimaryMappingId: String(existingPrimary._id) });
            const normalizedDisplacedRole = clean(displacedRole).toUpperCase();
            if (![ROLES.DISABLED, ROLES.BACKUP].includes(normalizedDisplacedRole)) throw Object.assign(new Error("Explicit replacement must state whether the displaced PRIMARY becomes DISABLED or BACKUP."), { code: "PRIMARY_REPLACEMENT_ROLE_REQUIRED" });
            existingPrimary.productionRole = normalizedDisplacedRole;
            await existingPrimary.save({ session });
        }
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
    return { ready: true, blockers: [], routeSnapshot: Object.freeze({ routeType: "SUPPLIER_API", supplierMappingId: String(mapping._id), supplierId: String(mapping.supplierId), supplierCode: mapping.supplierCode, productCode: mapping.productCode, packageCode: mapping.packageCode, region: mapping.region, supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode, fulfillmentContract: mapping.mappingMetadata?.fulfillmentContract || null, executionMode: mapping.executionMode, selectedRole: ROLES.PRIMARY, selectedAt: new Date().toISOString() }) };
}

async function resolveLegacyCheckoutRouteSnapshot({ productCode, packageCode, region }) {
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

function compareRoutingDecisions({ legacy, shadow }) {
    const legacySupplier = legacy?.routeSnapshot?.routeType === "SUPPLIER_API" ? clean(legacy.routeSnapshot.supplierCode).toUpperCase() : "";
    const shadowSupplier = shadow?.outcome === ELIGIBILITY_OUTCOMES.ELIGIBLE ? clean(shadow.routeSnapshot?.supplierCode).toUpperCase() : "";
    if (shadow?.outcome === ELIGIBILITY_OUTCOMES.AMBIGUOUS_PRIMARY_ROUTE) return { match: false, classification: "SHADOW_AMBIGUOUS" };
    if (shadow?.blockerCodes?.some(code => code === "FULFILLMENT_ELIGIBILITY_UNKNOWN" || code.startsWith("FULFILLMENT_ELIGIBILITY_"))) return { match: false, classification: "SHADOW_UNKNOWN" };
    if (legacySupplier && shadowSupplier) return { match: legacySupplier === shadowSupplier, classification: legacySupplier === shadowSupplier ? "MATCH" : "DIFFERENT_SUPPLIER" };
    if (legacySupplier) return { match: false, classification: "LEGACY_ONLY" };
    if (shadowSupplier) return { match: false, classification: "ELIGIBILITY_ONLY" };
    return { match: true, classification: "MATCH" };
}

function pilotV2Snapshot(shadow, customerMarket) {
    const { region: _legacyRegion, ...route } = shadow.routeSnapshot;
    return Object.freeze({
        ...route,
        snapshotVersion: 2,
        customerMarket: clean(customerMarket).toUpperCase(),
        eligibility: shadow.eligibility
    });
}

function createRoutingAuthority({ legacyResolver = resolveLegacyCheckoutRouteSnapshot, eligibilityResolver = resolveEligibilityPrimaryRoute, modeResolver = resolveFulfillmentRoutingMode, pilotEnabledResolver = isPilotEnabled, diagnosticsObserver = null } = {}) {
    return async function route({ productCode, packageCode, region, includeDiagnostics = false }) {
        const routingMode = modeResolver();
        const legacy = await legacyResolver({ productCode, packageCode, region });
        if (routingMode === FULFILLMENT_ROUTING_MODES.LEGACY_REGION && legacy.ready) return legacy;
        const shadow = await eligibilityResolver({ productCode, packageCode, customerMarket: region });
        // Compatibility convergence: a supplier-account market (for example GLOBAL)
        // is not a customer market. When the legacy region route has no route, an
        // explicitly eligible, enabled PRIMARY is authoritative and remains fail-closed.
        if (routingMode === FULFILLMENT_ROUTING_MODES.LEGACY_REGION) {
            if (shadow.outcome !== ELIGIBILITY_OUTCOMES.ELIGIBLE) return legacy;
            const result = { ready: true, blockers: [], routeSnapshot: pilotV2Snapshot(shadow, region) };
            return includeDiagnostics ? { ...result, diagnostics: Object.freeze({ scopedEligibilityFallback: true }) } : result;
        }
        const comparison = compareRoutingDecisions({ legacy, shadow });
        const diagnostics = Object.freeze({
            productCode: clean(productCode).toLowerCase(),
            packageCode: clean(packageCode).toUpperCase(),
            customerMarket: clean(region).toUpperCase(),
            routingMode,
            legacyRouteType: legacy?.routeSnapshot?.routeType || "NONE",
            legacySupplierCode: legacy?.routeSnapshot?.supplierCode || "",
            shadowOutcome: shadow.outcome,
            shadowSupplierCode: shadow?.routeSnapshot?.supplierCode || "",
            comparisonClassification: comparison.classification,
            blockerCodes: shadow.blockerCodes || []
        });
        if (typeof diagnosticsObserver === "function") {
            try { diagnosticsObserver(diagnostics); } catch { /* Observability must never alter route selection. */ }
        }
        const pilotSelected = routingMode === FULFILLMENT_ROUTING_MODES.DUAL_READ &&
            pilotEnabledResolver() === true &&
            shadow.outcome === ELIGIBILITY_OUTCOMES.ELIGIBLE &&
            matchesPilotRoute({ mapping: shadow.routeSnapshot, productCode, packageCode, customerMarket: region });
        if (pilotSelected) {
            const result = { ready: true, blockers: [], routeSnapshot: pilotV2Snapshot(shadow, region) };
            return includeDiagnostics ? { ...result, diagnostics: Object.freeze({ ...diagnostics, scopedPilotOverride: true }) } : result;
        }
        if (routingMode === FULFILLMENT_ROUTING_MODES.DUAL_READ) return includeDiagnostics ? { ...legacy, diagnostics } : legacy;
        if (routingMode === FULFILLMENT_ROUTING_MODES.ELIGIBILITY_PRIMARY) {
            if (shadow.outcome === ELIGIBILITY_OUTCOMES.ELIGIBLE) {
                const result = { ready: true, blockers: [], routeSnapshot: shadow.routeSnapshot };
                return includeDiagnostics ? { ...result, diagnostics } : result;
            }
            const result = { ready: false, blockers: shadow.blockerCodes, routeSnapshot: null };
            return includeDiagnostics ? { ...result, diagnostics } : result;
        }
        throw Object.assign(new Error(`Unsupported fulfillment routing mode: ${routingMode}`), { code: "FULFILLMENT_ROUTING_MODE_INVALID" });
    };
}

const resolveCheckoutRouteSnapshot = createRoutingAuthority();

module.exports = { ROLES, CORE_PRODUCTS, assessProductionMapping, assessProductionMappingFromContext, setProductionRole, resolvePrimaryRouteSnapshot, resolveLegacyCheckoutRouteSnapshot, resolveCheckoutRouteSnapshot, compareRoutingDecisions, pilotV2Snapshot, createRoutingAuthority };
