"use strict";

const { PROTOCOLS, inputAuthorityDiagnostic } = require("./supplierSellabilityContractCoverageService");
const { normalizeSupplierMarket } = require("../../constants/supplierMarkets");
const { validateFulfillmentEligibility, isCustomerMarketEligible } = require("../supplierFulfillmentEligibilityService");

const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const id = value => clean(value?._id || value);
const SOURCE_BLOCKERS = new Set(["STALE_SOURCE"]);

function verifiedEligibility(product = {}, mapping = null) {
    return mapping?.fulfillmentEligibility || product.metadata?.fulfillmentEligibility || product.normalizedInputContract?.fulfillmentEligibility || null;
}

function packageDisposition({ offer = {}, mapping = null, canonicalPackage = null, newCanonicalProduct = false } = {}) {
    if (mapping && id(mapping.supplierCatalogOfferId) === id(offer)) return { proven: true, create: false };
    if (upper(offer.reconciliationState) === "EXACT_CANONICAL_MATCH" && canonicalPackage) return { proven: true, create: false };
    if (upper(offer.catalogLifecycleState) === "ACTIVE" && newCanonicalProduct && ["UNREVIEWED", "NO_CANONICAL_PACKAGE", "MARKET_EVIDENCE_REQUIRED", "INPUT_CONTRACT_REQUIRED"].includes(upper(offer.reconciliationState))) return { proven: true, create: true };
    if (upper(offer.reconciliationState) === "NO_CANONICAL_PACKAGE" && offer.reconciliationEvidence?.distinctEntitlement === true) return { proven: true, create: true };
    return { proven: false, create: false };
}

function evaluateAddProductOffer({ supplier = {}, product = {}, offer = {}, availability = null, mapping = null, canonicalPackage = null, customerMarkets = [], newCanonicalProduct = false, sourceStale = false } = {}) {
    const blockers = [];
    const supplierCode = upper(supplier.supplierCode);
    const disposition = packageDisposition({ offer, mapping, canonicalPackage, newCanonicalProduct });
    if (sourceStale) blockers.push("STALE_SOURCE");
    if (upper(offer.catalogLifecycleState) !== "ACTIVE" || upper(availability?.state) !== "AVAILABLE") blockers.push("SUPPLIER_UNAVAILABLE");
    if (!PROTOCOLS[supplierCode]) blockers.push("UNSUPPORTED_PROTOCOL");
    const input = inputAuthorityDiagnostic(product, supplierCode);
    if (input.reason === "EXECUTION_IDENTITY_MISSING") blockers.push("EXECUTION_IDENTITY_REQUIRED");
    else if (!["SUPPLIER_METADATA_NORMALIZED", "OWNER_VERIFIED_FALLBACK"].includes(input.reason)) blockers.push("INPUT_CONTRACT_REQUIRED");
    if (!normalizeSupplierMarket(mapping?.region || product.supplierMarketCode)) blockers.push("SUPPLIER_MARKET_AUTHORITY_REQUIRED");
    const eligibility = verifiedEligibility(product, mapping);
    if (!validateFulfillmentEligibility(eligibility).valid || customerMarkets.some(market => !isCustomerMarketEligible(eligibility, market))) blockers.push("CUSTOMER_MARKET_INELIGIBLE");
    if (!disposition.proven) blockers.push("PACKAGE_IDENTITY_REVIEW");
    const unique = [...new Set(blockers)];
    const unavailable = unique.includes("SUPPLIER_UNAVAILABLE");
    const state = unavailable ? "UNAVAILABLE" : unique.length ? "NEEDS_ATTENTION" : mapping ? "READY" : "PREPARABLE";
    const actionByBlocker = { PACKAGE_IDENTITY_REVIEW: "PACKAGE_REVIEW", INPUT_CONTRACT_REQUIRED: "INPUT_CONTRACT", EXECUTION_IDENTITY_REQUIRED: "EXECUTION_CONFIGURATION", SUPPLIER_MARKET_AUTHORITY_REQUIRED: "MARKET_AUTHORITY", CUSTOMER_MARKET_INELIGIBLE: "MARKET_AUTHORITY", SUPPLIER_UNAVAILABLE: "NONE", UNSUPPORTED_PROTOCOL: "NONE", STALE_SOURCE: "REFRESH" };
    return { state, selectable: ["READY", "PREPARABLE"].includes(state), primaryBlocker: unique[0] || "", blockers: unique, correctiveAction: actionByBlocker[unique[0]] || "NONE", packageDisposition: disposition, inputAuthority: input.classification };
}

module.exports = Object.freeze({ SOURCE_BLOCKERS, verifiedEligibility, packageDisposition, evaluateAddProductOffer });
