"use strict";

const { validateFulfillmentEligibility } = require("./supplierFulfillmentEligibilityService");
const { supplierCapabilityProductCode } = require("./fulfillmentCapabilityService");

const READINESS_MODES = Object.freeze({
    NEW_ORDER_SELECTABLE: "NEW_ORDER_SELECTABLE",
    PUBLIC_PURCHASABLE: "PUBLIC_PURCHASABLE",
    FROZEN_ORDER_EXECUTABLE: "FROZEN_ORDER_EXECUTABLE"
});
const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const objectId = value => clean(value?._id || value);

function providerBlockers(mapping, supplier, adapter) {
    const blockers = [];
    if (upper(mapping.executionMode) !== "API") blockers.push("MAPPING_EXECUTION_NOT_API");
    if (!clean(mapping.supplierProductCode) || !clean(mapping.supplierPackageCode)) blockers.push("EXACT_MAPPING_INCOMPLETE");
    if (!supplier || supplier.enabled !== true || upper(supplier.mode) !== "API") blockers.push("SUPPLIER_NOT_API_READY");
    if (!adapter?.isConfigured?.()) blockers.push("SUPPLIER_ADAPTER_NOT_READY");
    let enabled = false;
    try { enabled = adapter?.isAutoFulfillmentEnabled?.(supplierCapabilityProductCode(mapping, { supplierCode: supplier?.supplierCode || mapping.supplierCode })) === true; } catch { enabled = false; }
    if (!enabled) blockers.push("PROVIDER_FEATURE_GATE_OFF");
    if (upper(supplier?.supplierCode || mapping.supplierCode) === "FAZERCARDS") {
        const { supportsFazerCardsMapping } = require("./suppliers/fazercardsFulfillmentProcessor");
        if (!supportsFazerCardsMapping(mapping)) blockers.push("FULFILLMENT_PROCESSOR_NOT_READY");
    }
    return blockers;
}

function assessMappingReadiness({ mode, mapping = {}, supplier = null, offer = null, availability = null, customerMarket = "", adapter = null, pkg = null, publication = null, selection = null, eligibilityOverride = null } = {}) {
    if (!Object.values(READINESS_MODES).includes(mode)) throw Object.assign(new Error(`Unsupported readiness mode: ${mode}`), { code: "READINESS_MODE_INVALID" });
    const blockers = [];
    if (mapping.archivedAt) blockers.push("MAPPING_ARCHIVED");
    if (mapping.enabled !== true) blockers.push("MAPPING_DISABLED");
    blockers.push(...providerBlockers(mapping, supplier, adapter));
    const readiness = mapping.mappingMetadata?.readiness || {};
    if (readiness.supplierMapped !== true) blockers.push("SUPPLIER_MAPPING_NOT_READY");
    if (readiness.inputReady !== true) blockers.push("INPUT_NOT_READY");
    if (readiness.fulfillmentReady !== true) blockers.push("FULFILLMENT_NOT_READY");

    const eligibility = validateFulfillmentEligibility(eligibilityOverride || mapping.fulfillmentEligibility);
    if (!eligibility.valid) blockers.push(...eligibility.errors);
    else if (eligibility.value.mode === "UNKNOWN") blockers.push("FULFILLMENT_ELIGIBILITY_UNKNOWN");
    else if (mode !== READINESS_MODES.FROZEN_ORDER_EXECUTABLE && eligibility.value.mode === "CUSTOMER_MARKET_ALLOWLIST" && !eligibility.value.allowedCustomerMarkets.includes(upper(customerMarket))) blockers.push("CUSTOMER_MARKET_NOT_ELIGIBLE");

    if (mode !== READINESS_MODES.FROZEN_ORDER_EXECUTABLE) {
        const offerMatches = offer && objectId(offer) === objectId(mapping.supplierCatalogOfferId) && objectId(offer.supplierId) === objectId(mapping.supplierId) && clean(offer.supplierProductCode) === clean(mapping.supplierProductCode) && clean(offer.supplierOfferCode) === clean(mapping.supplierPackageCode) && upper(offer.catalogLifecycleState) === "ACTIVE";
        if (!offerMatches) blockers.push("SUPPLIER_OFFER_NOT_ACTIVE");
        const availabilityCurrent = availability && objectId(availability.supplierCatalogOfferId) === objectId(mapping.supplierCatalogOfferId) && upper(availability.state) === "AVAILABLE" && (!availability.staleAt || new Date(availability.staleAt).getTime() > Date.now());
        if (!availabilityCurrent) blockers.push("SUPPLIER_AVAILABILITY_NOT_CONFIRMED");
    }
    if (mode === READINESS_MODES.PUBLIC_PURCHASABLE) {
        const price = pkg?.prices?.[upper(customerMarket)];
        if (!pkg || pkg.deletedAt || pkg.enabled !== true) blockers.push("PACKAGE_NOT_PUBLIC_READY");
        if (!price || price.enabled !== true || !(Number(price.amount) > 0)) blockers.push("NO_VALID_PRICE");
        if (!selection || objectId(selection.supplierMappingId) !== objectId(mapping)) blockers.push("SELECTED_MAPPING_MISMATCH");
    }
    return { ready: blockers.length === 0, blockers: [...new Set(blockers)].sort(), mode };
}

module.exports = Object.freeze({ READINESS_MODES, assessMappingReadiness });
