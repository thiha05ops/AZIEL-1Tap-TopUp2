"use strict";

const { validateFulfillmentEligibility } = require("./supplierFulfillmentEligibilityService");

const CLASSIFICATIONS = Object.freeze([
    "MATCH_ENABLED", "MATCH_DISABLED", "CURRENT_ONLY", "FUTURE_ONLY",
    "UNKNOWN_ELIGIBILITY", "REGION_COUPLED", "FEATURE_GATE_ONLY_BLOCKER",
    "READINESS_DIFFERENCE", "AMBIGUOUS"
]);
const text = value => String(value == null ? "" : value).trim();

function costAuthorityFresh(mapping = {}, now = new Date()) {
    const amount = Number(mapping.supplierCostAuthority?.rawSupplierCost ?? mapping.mappingMetadata?.supplierCost?.amount);
    const capturedValue = mapping.supplierCostAuthority?.capturedAt;
    const capturedAt = new Date(capturedValue || 0);
    const maximumAge = Number(mapping.mappingMetadata?.costAuthorityMaximumAgeSeconds || 86400);
    return Number.isFinite(amount) && amount >= 0 && Boolean(capturedValue) && Number.isFinite(capturedAt.getTime()) && new Date(now).getTime() - capturedAt.getTime() <= maximumAge * 1000;
}

function mappingDbReady(mapping = {}) {
    const readiness = mapping.mappingMetadata?.readiness || {};
    return mapping.enabled === true && !mapping.archivedAt && mapping.executionMode === "API" && mapping.productionRole === "PRIMARY" &&
        Boolean(text(mapping.supplierProductCode)) && Boolean(text(mapping.supplierPackageCode)) &&
        readiness.supplierMapped === true && readiness.pricingReady === true && readiness.inputReady === true && readiness.fulfillmentReady === true;
}

function evaluateFutureAuthority({ mapping = {}, supplier = {}, currentProductGate = false, supplierLevelGate = false, adapterConfigured = false, processorReady = false, now = new Date(), ambiguous = false } = {}) {
    const eligibility = validateFulfillmentEligibility(mapping.fulfillmentEligibility);
    const eligibilityKnown = eligibility.valid && eligibility.value.mode !== "UNKNOWN";
    const supplierReady = supplier.enabled === true && supplier.mode === "API" && adapterConfigured && processorReady;
    const dbReady = mappingDbReady(mapping) && costAuthorityFresh(mapping, now);
    const currentEnabled = supplierReady && dbReady && currentProductGate === true && String(mapping.region || "").trim() !== "";
    const futureEnabled = supplierLevelGate === true && supplierReady && dbReady && eligibilityKnown;
    let classification;
    if (ambiguous) classification = "AMBIGUOUS";
    else if (!eligibilityKnown && dbReady && supplierReady) classification = "UNKNOWN_ELIGIBILITY";
    else if (currentEnabled && futureEnabled) classification = "MATCH_ENABLED";
    else if (!currentEnabled && !futureEnabled) classification = "MATCH_DISABLED";
    else if (currentEnabled && !futureEnabled && !currentProductGate) classification = "FEATURE_GATE_ONLY_BLOCKER";
    else if (currentEnabled && !futureEnabled) classification = "CURRENT_ONLY";
    else if (!currentEnabled && futureEnabled && currentProductGate === false) classification = "FEATURE_GATE_ONLY_BLOCKER";
    else if (!currentEnabled && futureEnabled && text(mapping.region)) classification = "REGION_COUPLED";
    else classification = "READINESS_DIFFERENCE";
    return Object.freeze({ currentEnabled, futureEnabled, classification, eligibilityKnown, supplierReady, dbReady, costFresh: costAuthorityFresh(mapping, now) });
}

module.exports = Object.freeze({ CLASSIFICATIONS, costAuthorityFresh, mappingDbReady, evaluateFutureAuthority });
