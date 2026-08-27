"use strict";

const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");
const {
    validateFulfillmentEligibility,
    isCustomerMarketEligible
} = require("./supplierFulfillmentEligibilityService");

const OUTCOMES = Object.freeze({
    ELIGIBLE: "ELIGIBLE",
    NO_ELIGIBLE_ROUTE: "NO_ELIGIBLE_ROUTE",
    AMBIGUOUS_PRIMARY_ROUTE: "AMBIGUOUS_PRIMARY_ROUTE"
});
const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();

function gateEnabled(mapping, adapter) {
    try { return adapter?.isAutoFulfillmentEnabled?.(mapping.productCode) === true; } catch { return false; }
}

function basicCandidateBlockers({ mapping = {}, supplier = {}, pkg = {}, customerMarket = "", now = new Date(), adapter = null, controlledTestEvidence = false } = {}) {
    const blockers = [];
    const market = upper(customerMarket);
    const eligibility = validateFulfillmentEligibility(mapping.fulfillmentEligibility);
    if (!eligibility.valid) blockers.push(...eligibility.errors);
    else if (eligibility.value.mode === "UNKNOWN") blockers.push("FULFILLMENT_ELIGIBILITY_UNKNOWN");
    else if (!isCustomerMarketEligible(mapping.fulfillmentEligibility, market)) blockers.push("CUSTOMER_MARKET_NOT_ELIGIBLE");
    if (mapping.archivedAt) blockers.push("MAPPING_ARCHIVED");
    if (mapping.productionRole !== "PRIMARY") blockers.push("MAPPING_NOT_PRIMARY");
    if (mapping.enabled !== true) blockers.push("MAPPING_DISABLED");
    if (upper(mapping.executionMode) !== "API") blockers.push("MAPPING_EXECUTION_NOT_API");
    if (!clean(mapping.supplierProductCode) || !clean(mapping.supplierPackageCode)) blockers.push("EXACT_MAPPING_INCOMPLETE");
    if (!supplier || supplier.enabled !== true || upper(supplier.mode) !== "API") blockers.push("SUPPLIER_NOT_API_READY");
    const readiness = mapping.mappingMetadata?.readiness || {};
    if (readiness.supplierMapped !== true) blockers.push("SUPPLIER_MAPPING_NOT_READY");
    if (readiness.pricingReady !== true) blockers.push("PRICING_NOT_READY");
    if (readiness.inputReady !== true) blockers.push("INPUT_NOT_READY");
    if (readiness.fulfillmentReady !== true) blockers.push("FULFILLMENT_NOT_READY");
    const cost = Number(mapping.supplierCostAuthority?.rawSupplierCost ?? mapping.mappingMetadata?.supplierCost?.amount);
    const capturedValue = mapping.supplierCostAuthority?.capturedAt;
    const capturedAt = new Date(capturedValue || 0);
    const maximumAge = Number(mapping.mappingMetadata?.costAuthorityMaximumAgeSeconds || 86400);
    if (!Number.isFinite(cost) || cost < 0 || !capturedValue || !Number.isFinite(capturedAt.getTime())) blockers.push("CURRENT_SUPPLIER_COST_MISSING");
    else if (new Date(now).getTime() - capturedAt.getTime() > maximumAge * 1000) blockers.push("SUPPLIER_COST_AUTHORITY_STALE");
    const price = pkg?.prices?.[market];
    if (!pkg?.enabled || pkg?.deletedAt || price?.enabled !== true || !Number.isFinite(Number(price?.amount)) || Number(price.amount) <= 0) blockers.push("CUSTOMER_MARKET_PRICE_NOT_PUBLISHED");
    if (!adapter?.isConfigured?.()) blockers.push("SUPPLIER_ADAPTER_NOT_READY");
    if (!gateEnabled(mapping, adapter)) blockers.push("PROVIDER_FEATURE_GATE_OFF");
    if (upper(supplier?.supplierCode || mapping.supplierCode) === "FAZERCARDS") {
        const { supportsFazerCardsMapping } = require("./suppliers/fazercardsFulfillmentProcessor");
        if (!supportsFazerCardsMapping(mapping)) blockers.push("FULFILLMENT_PROCESSOR_NOT_READY");
    }
    return { blockers: [...new Set(blockers)].sort(), controlledTestEvidence };
}

function summarizeEligibilityResolution({ mappings = [], assessments = new Map(), productCode = "", packageCode = "", customerMarket = "" } = {}) {
    const normalizedProduct = lower(productCode);
    const normalizedPackage = upper(packageCode);
    const market = upper(customerMarket);
    const candidates = mappings
        .filter(mapping => lower(mapping.productCode) === normalizedProduct && upper(mapping.packageCode) === normalizedPackage)
        .map(mapping => {
            const assessment = assessments.get(String(mapping._id)) || { blockers: ["CANDIDATE_NOT_ASSESSED"] };
            return { mapping, blockers: assessment.blockers || [] };
        });
    const eligible = candidates.filter(candidate => candidate.blockers.length === 0);
    const blockerCodes = [...new Set(candidates.flatMap(candidate => candidate.blockers))].sort();
    if (eligible.length > 1) return { outcome: OUTCOMES.AMBIGUOUS_PRIMARY_ROUTE, routeSnapshot: null, blockerCodes: ["AMBIGUOUS_PRIMARY_ROUTE"] };
    if (eligible.length === 0) return { outcome: OUTCOMES.NO_ELIGIBLE_ROUTE, routeSnapshot: null, blockerCodes: blockerCodes.length ? blockerCodes : ["NO_PRIMARY_MAPPING"] };
    const mapping = eligible[0].mapping;
    return {
        outcome: OUTCOMES.ELIGIBLE,
        blockerCodes: [],
        eligibility: validateFulfillmentEligibility(mapping.fulfillmentEligibility).value,
        routeSnapshot: Object.freeze({
            routeType: "SUPPLIER_API",
            supplierMappingId: String(mapping._id),
            supplierId: String(mapping.supplierId),
            supplierCode: upper(mapping.supplierCode),
            productCode: normalizedProduct,
            packageCode: normalizedPackage,
            region: market,
            supplierProductCode: mapping.supplierProductCode,
            supplierPackageCode: mapping.supplierPackageCode,
            executionMode: "API",
            selectedRole: "PRIMARY",
            selectedAt: new Date().toISOString()
        })
    };
}

async function resolveEligibilityPrimaryRoute({ productCode, packageCode, customerMarket }) {
    const normalizedProduct = lower(productCode);
    const normalizedPackage = upper(packageCode);
    const market = upper(customerMarket);
    const [mappings, pkg] = await Promise.all([
        Mapping.find({ productCode: normalizedProduct, packageCode: normalizedPackage, productionRole: "PRIMARY", enabled: true, archivedAt: null }).lean(),
        CatalogPackage.findOne({ productCode: normalizedProduct, packageCode: normalizedPackage, deletedAt: null }).lean()
    ]);
    const suppliers = await Supplier.find({ _id: { $in: mappings.map(mapping => mapping.supplierId) } }).lean();
    const supplierById = new Map(suppliers.map(supplier => [String(supplier._id), supplier]));
    const assessments = new Map();
    await Promise.all(mappings.map(async mapping => {
        const supplier = supplierById.get(String(mapping.supplierId));
        const [controlledTest] = await Promise.all([
            FulfillmentAttempt.findOne({ supplierMappingId: mapping._id, status: "SUCCEEDED", supplierReference: { $ne: "" } }).select("_id").lean()
        ]);
        const adapter = supplier ? getSupplierAdapter(supplier) : null;
        assessments.set(String(mapping._id), basicCandidateBlockers({ mapping, supplier, pkg, customerMarket: market, adapter, controlledTestEvidence: Boolean(controlledTest) }));
    }));
    return summarizeEligibilityResolution({ mappings, assessments, productCode: normalizedProduct, packageCode: normalizedPackage, customerMarket: market });
}

module.exports = Object.freeze({ OUTCOMES, basicCandidateBlockers, summarizeEligibilityResolution, resolveEligibilityPrimaryRoute });
