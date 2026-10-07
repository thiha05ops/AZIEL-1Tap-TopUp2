"use strict";

const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");
const { supplierCapabilityProductCode } = require("./fulfillmentCapabilityService");
const { resolveFulfillmentRoutingMode, FULFILLMENT_ROUTING_MODES } = require("../config/fulfillmentRoutingMode");
const { resolveEligibilityPrimaryRoute, eligiblePrimaryRouteConflicts, OUTCOMES: ELIGIBILITY_OUTCOMES } = require("./supplierEligibilityRouteResolver");
const { READINESS_MODES, assessMappingReadiness } = require("./supplierMappingReadinessService");

const ROLES = Object.freeze({ PRIMARY: "PRIMARY", BACKUP: "BACKUP", DISABLED: "DISABLED" });
const CORE_PRODUCTS = new Set(["mlbb", "pubg", "freefire", "hok"]);
const clean = value => String(value == null ? "" : value).trim();

function gateEnabled(mapping, adapter) {
    try { return adapter?.isAutoFulfillmentEnabled?.(supplierCapabilityProductCode(mapping, { supplierCode: mapping.supplierCode })) === true; } catch { return false; }
}

function gateBlocker(mapping, adapter) {
    try {
        return adapter?.autoFulfillmentGateState?.(supplierCapabilityProductCode(mapping, { supplierCode: mapping.supplierCode }))?.blockerCode === "SUPPLIER_AUTO_FULFILLMENT_DISABLED"
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
        const primaryCandidates = await Mapping.find({ _id: { $ne: mapping._id }, productCode: mapping.productCode, packageCode: mapping.packageCode, productionRole: ROLES.PRIMARY, archivedAt: null }).session(session).lean();
        const replacementId = clean(replaceExistingPrimaryId);
        const customerMarketConflicts = eligiblePrimaryRouteConflicts({ candidate: { ...mapping.toObject(), productionRole: ROLES.PRIMARY }, existingMappings: primaryCandidates })
            .filter(item => replacementId !== String(item._id) || clean(item.region).toUpperCase() !== clean(mapping.region).toUpperCase());
        if (customerMarketConflicts.length) throw Object.assign(new Error("Multiple operational PRIMARY routes would be eligible for the same customer market."), {
            code: "AMBIGUOUS_PRIMARY_ROUTE",
            conflictingMappingIds: customerMarketConflicts.map(item => String(item._id))
        });
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

function selectedRouteSnapshot(mapping, selection, customerMarket, selectedRole = "PACKAGE_SUPPLIER_SELECTION") {
    return Object.freeze({
        routeType: "SUPPLIER_API", snapshotVersion: 2,
        supplierMappingId: String(mapping._id), supplierId: String(mapping.supplierId), supplierCode: mapping.supplierCode,
        productCode: mapping.productCode, packageCode: mapping.packageCode,
        region: upper(customerMarket), customerMarket: upper(customerMarket), supplierMarket: upper(mapping.region),
        supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode,
        fulfillmentContract: mapping.mappingMetadata?.fulfillmentContract || null, executionMode: mapping.executionMode,
        selectedRole, selectionDecisionVersion: selection ? Number(selection.decisionVersion) : null,
        eligibility: mapping.fulfillmentEligibility || null, selectedAt: new Date().toISOString()
    });
}

const upper = value => clean(value).toUpperCase();

async function resolveSelectedCheckoutRouteSnapshot({ productCode, packageCode, region }) {
    const normalizedProduct = clean(productCode).toLowerCase();
    const normalizedPackage = upper(packageCode);
    const customerMarket = upper(region);
    const selection = await PackageSupplierSelection.findOne({ productCode: normalizedProduct, packageCode: normalizedPackage, customerMarket }).lean();
    if (!selection) {
        const mappings = await Mapping.find({ productCode: normalizedProduct, packageCode: normalizedPackage, archivedAt: null }).lean();
        if (!mappings.length) return { ready: false, blockers: ["NO_EXECUTABLE_SUPPLIER_ROUTE"], routeSnapshot: null, resolution: "NONE" };
        const supplierIds = [...new Set(mappings.map(item => String(item.supplierId)))];
        const offerIds = [...new Set(mappings.map(item => item.supplierCatalogOfferId).filter(Boolean).map(String))];
        const [suppliers, offers, availabilityRows] = await Promise.all([
            Supplier.find({ _id: { $in: supplierIds } }).lean(),
            SupplierCatalogOffer.find({ _id: { $in: offerIds } }).lean(),
            SupplierOfferAvailability.find({ supplierCatalogOfferId: { $in: offerIds } }).lean()
        ]);
        const supplierById = new Map(suppliers.map(item => [String(item._id), item]));
        const offerById = new Map(offers.map(item => [String(item._id), item]));
        const availabilityByOffer = new Map(availabilityRows.map(item => [String(item.supplierCatalogOfferId), item]));
        const assessed = mappings.map(mapping => {
            const supplier = supplierById.get(String(mapping.supplierId)) || null;
            return { mapping, assessment: assessMappingReadiness({
                mode: READINESS_MODES.NEW_ORDER_SELECTABLE,
                mapping,
                supplier,
                offer: offerById.get(String(mapping.supplierCatalogOfferId)) || null,
                availability: availabilityByOffer.get(String(mapping.supplierCatalogOfferId)) || null,
                customerMarket,
                adapter: supplier ? getSupplierAdapter(supplier) : null
            }) };
        });
        const ready = assessed.filter(item => item.assessment.ready);
        if (ready.length === 1) return { ready: true, blockers: [], routeSnapshot: selectedRouteSnapshot(ready[0].mapping, null, customerMarket, "UNIQUE_EXECUTABLE_ROUTE"), resolution: "UNIQUE_EXECUTABLE_ROUTE" };
        if (ready.length > 1) return { ready: false, blockers: ["AMBIGUOUS_EXECUTABLE_SUPPLIER_ROUTES"], routeSnapshot: null, resolution: "AMBIGUOUS" };
        return { ready: false, blockers: [...new Set(assessed.flatMap(item => item.assessment.blockers))], routeSnapshot: null, resolution: "BLOCKED" };
    }
    const mapping = await Mapping.findById(selection.supplierMappingId).lean();
    if (!mapping || mapping.productCode !== normalizedProduct || mapping.packageCode !== normalizedPackage) return { ready: false, blockers: ["SELECTED_MAPPING_INVALID"], routeSnapshot: null };
    const supplier = await Supplier.findById(mapping.supplierId).lean();
    const offer = mapping.supplierCatalogOfferId ? await SupplierCatalogOffer.findById(mapping.supplierCatalogOfferId).lean() : null;
    const availability = mapping.supplierCatalogOfferId ? await SupplierOfferAvailability.findOne({ supplierCatalogOfferId: mapping.supplierCatalogOfferId }).lean() : null;
    const adapter = supplier ? getSupplierAdapter(supplier) : null;
    const assessment = assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping, supplier, offer, availability, customerMarket, adapter });
    if (!assessment.ready) return { ready: false, blockers: assessment.blockers, routeSnapshot: null, resolution: "OWNER_SELECTION" };
    return { ready: true, blockers: [], routeSnapshot: selectedRouteSnapshot(mapping, selection, customerMarket), resolution: "OWNER_SELECTION" };
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
        supplierMarket: clean(route.supplierMarket).toUpperCase(),
        customerMarket: clean(customerMarket).toUpperCase(),
        eligibility: shadow.eligibility
    });
}

function isSupplierApiRoute(result) {
    return result?.ready === true && result?.routeSnapshot?.routeType === "SUPPLIER_API";
}

function isManualAdminRoute(result) {
    return result?.ready === true && result?.routeSnapshot?.routeType === "MANUAL_ADMIN";
}

function isGenuineManualOnlyResolution(shadow) {
    return shadow?.outcome === ELIGIBILITY_OUTCOMES.NO_ELIGIBLE_ROUTE &&
        Array.isArray(shadow.blockerCodes) &&
        shadow.blockerCodes.length === 1 &&
        shadow.blockerCodes[0] === "NO_PRIMARY_MAPPING";
}

function createRoutingAuthority(options = {}) {
    const { legacyResolver = resolveLegacyCheckoutRouteSnapshot, eligibilityResolver = resolveEligibilityPrimaryRoute, selectedResolver = resolveSelectedCheckoutRouteSnapshot, modeResolver = resolveFulfillmentRoutingMode, diagnosticsObserver = null } = options;
    const enforceStorefrontAuthority = Object.keys(options).length === 0 || Object.prototype.hasOwnProperty.call(options, "selectedResolver");
    return async function route({ productCode, packageCode, region, includeDiagnostics = false }) {
        const routingMode = modeResolver();
        const storefrontRoute = enforceStorefrontAuthority ? await selectedResolver({ productCode, packageCode, region }) : null;
        if (storefrontRoute && (storefrontRoute.ready === true || (storefrontRoute.resolution && storefrontRoute.resolution !== "NONE"))) return storefrontRoute;
        if (routingMode === FULFILLMENT_ROUTING_MODES.SELECTED) return storefrontRoute || selectedResolver({ productCode, packageCode, region });
        const legacy = await legacyResolver({ productCode, packageCode, region });
        if (routingMode === FULFILLMENT_ROUTING_MODES.SHADOW) {
            let selected;
            try {
                selected = await selectedResolver({ productCode, packageCode, region });
            } catch (error) {
                selected = { ready: false, routeSnapshot: null, blockers: ["SELECTED_SHADOW_EVALUATION_FAILED"], errorCode: clean(error?.code || error?.name || "SELECTED_SHADOW_EVALUATION_FAILED") };
            }
            const diagnostics = Object.freeze({
                productCode: clean(productCode).toLowerCase(), packageCode: upper(packageCode), customerMarket: upper(region), routingMode,
                legacySupplierMappingId: clean(legacy?.routeSnapshot?.supplierMappingId), selectedSupplierMappingId: clean(selected?.routeSnapshot?.supplierMappingId),
                selectedReady: selected.ready === true, selectedBlockers: selected.blockers || [], selectedErrorCode: selected.errorCode || "",
                comparisonClassification: clean(legacy?.routeSnapshot?.supplierMappingId) === clean(selected?.routeSnapshot?.supplierMappingId) ? "MATCH" : "DIFFERENT_ROUTE"
            });
            if (typeof diagnosticsObserver === "function") { try { diagnosticsObserver(diagnostics); } catch { /* diagnostics never alter routing */ } }
            return includeDiagnostics ? { ...legacy, diagnostics } : legacy;
        }
        if (routingMode === FULFILLMENT_ROUTING_MODES.LEGACY_REGION && isSupplierApiRoute(legacy)) return legacy;
        const shadow = await eligibilityResolver({ productCode, packageCode, customerMarket: region });
        // A supplier-account market (for example GLOBAL) is not a customer market.
        // An exact legacy supplier route remains authoritative, but a manual fallback
        // must not hide an eligible market-decoupled PRIMARY/API route.
        if (routingMode === FULFILLMENT_ROUTING_MODES.LEGACY_REGION) {
            if (shadow.outcome === ELIGIBILITY_OUTCOMES.ELIGIBLE) {
                const result = { ready: true, blockers: [], routeSnapshot: pilotV2Snapshot(shadow, region) };
                return includeDiagnostics ? { ...result, diagnostics: Object.freeze({ scopedEligibilityFallback: true }) } : result;
            }
            if (isManualAdminRoute(legacy) && isGenuineManualOnlyResolution(shadow)) return legacy;
            if (!legacy.ready) return legacy;
            const result = { ready: false, blockers: shadow.blockerCodes?.length ? shadow.blockerCodes : ["SUPPLIER_ROUTE_NOT_EXECUTABLE"], routeSnapshot: null };
            return includeDiagnostics ? { ...result, diagnostics: Object.freeze({ manualFallbackSuppressed: true }) } : result;
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
        if (routingMode === FULFILLMENT_ROUTING_MODES.DUAL_READ && isSupplierApiRoute(legacy)) {
            return includeDiagnostics ? { ...legacy, diagnostics } : legacy;
        }
        if (routingMode === FULFILLMENT_ROUTING_MODES.DUAL_READ && shadow.outcome === ELIGIBILITY_OUTCOMES.ELIGIBLE) {
            const result = { ready: true, blockers: [], routeSnapshot: pilotV2Snapshot(shadow, region) };
            return includeDiagnostics ? { ...result, diagnostics: Object.freeze({ ...diagnostics, marketDecoupledAuthority: true }) } : result;
        }
        if (routingMode === FULFILLMENT_ROUTING_MODES.DUAL_READ && isManualAdminRoute(legacy) && isGenuineManualOnlyResolution(shadow)) {
            return includeDiagnostics ? { ...legacy, diagnostics } : legacy;
        }
        if (routingMode === FULFILLMENT_ROUTING_MODES.DUAL_READ) {
            const result = legacy.ready
                ? { ready: false, blockers: shadow.blockerCodes?.length ? shadow.blockerCodes : ["SUPPLIER_ROUTE_NOT_EXECUTABLE"], routeSnapshot: null }
                : legacy;
            return includeDiagnostics ? { ...result, diagnostics: Object.freeze({ ...diagnostics, manualFallbackSuppressed: legacy.ready }) } : result;
        }
        if (routingMode === FULFILLMENT_ROUTING_MODES.ELIGIBILITY_PRIMARY) {
            if (shadow.outcome === ELIGIBILITY_OUTCOMES.ELIGIBLE) {
                const result = { ready: true, blockers: [], routeSnapshot: pilotV2Snapshot(shadow, region) };
                return includeDiagnostics ? { ...result, diagnostics } : result;
            }
            const result = { ready: false, blockers: shadow.blockerCodes, routeSnapshot: null };
            return includeDiagnostics ? { ...result, diagnostics } : result;
        }
        throw Object.assign(new Error(`Unsupported fulfillment routing mode: ${routingMode}`), { code: "FULFILLMENT_ROUTING_MODE_INVALID" });
    };
}

const resolveCheckoutRouteSnapshot = createRoutingAuthority();

module.exports = { ROLES, CORE_PRODUCTS, assessProductionMapping, assessProductionMappingFromContext, setProductionRole, resolvePrimaryRouteSnapshot, resolveLegacyCheckoutRouteSnapshot, resolveSelectedCheckoutRouteSnapshot, selectedRouteSnapshot, resolveCheckoutRouteSnapshot, compareRoutingDecisions, pilotV2Snapshot, createRoutingAuthority };
