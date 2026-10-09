"use strict";

const { PROTOCOLS, inputAuthorityDiagnostic } = require("./supplierSellabilityContractCoverageService");
const { normalizeSupplierMarket } = require("../../constants/supplierMarkets");
const { resolvedAuthorities } = require("./supplierBusinessAuthorityService");

const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const id = value => clean(value?._id || value);
const SOURCE_BLOCKERS = new Set(["STALE_SOURCE"]);

function verifiedEligibility(product = {}, mapping = null, offer = null) {
    return mapping?.fulfillmentEligibility || resolvedAuthorities(product, offer).market?.fulfillmentEligibility || product.metadata?.fulfillmentEligibility || product.normalizedInputContract?.fulfillmentEligibility || {
        mode: "GLOBAL",
        allowedCustomerMarkets: [],
        evidenceCode: "PAYMENT_MARKET_DECOUPLED",
        evidenceSource: "Exact supplier-native product and offer identity",
        verifiedAt: null,
        version: 1
    };
}

function packageDisposition({ offer = {}, mapping = null, canonicalPackage = null, newCanonicalProduct = false } = {}) {
    if (mapping && id(mapping.supplierCatalogOfferId) === id(offer)) return { proven: true, create: false };
    if (upper(offer.reconciliationState) === "EXACT_CANONICAL_MATCH" && canonicalPackage) return { proven: true, create: false };
    if (!mapping && upper(offer.catalogLifecycleState) === "ACTIVE") return { proven: true, create: true };
    return { proven: false, create: false };
}

function evaluateAddProductOffer({ supplier = {}, product = {}, offer = {}, availability = null, mapping = null, canonicalPackage = null, customerMarkets = [], newCanonicalProduct = false, sourceStale = false } = {}) {
    const blockers = [];
    const sellingBlockers = [];
    const supplierCode = upper(supplier.supplierCode);
    const disposition = packageDisposition({ offer, mapping, canonicalPackage, newCanonicalProduct });
    if (sourceStale) blockers.push("STALE_SOURCE");
    if (upper(offer.catalogLifecycleState) !== "ACTIVE") blockers.push("SUPPLIER_UNAVAILABLE");
    if (upper(availability?.state) !== "AVAILABLE") sellingBlockers.push("SUPPLIER_UNAVAILABLE");
    if (!PROTOCOLS[supplierCode]) sellingBlockers.push("UNSUPPORTED_PROTOCOL");
    const authorities = resolvedAuthorities(product, offer);
    const inputProduct = offer?.metadata?.normalizedInputContract ? { ...product, normalizedInputContract: offer.metadata.normalizedInputContract } : product;
    const input = inputAuthorityDiagnostic(inputProduct, supplierCode);
    if (input.reason === "EXECUTION_IDENTITY_MISSING") {
        if (!authorities.execution?.executionIdentity) sellingBlockers.push("EXECUTION_IDENTITY_REQUIRED");
        const contractWithoutExecution = { ...inputProduct, normalizedInputContract: { ...(inputProduct.normalizedInputContract || {}), transactionalServiceCode: authorities.execution?.executionIdentity?.servicecode || authorities.execution?.executionIdentity?.serviceCode || authorities.execution?.executionIdentity?.transactionalServiceCode || "" } };
        const contractDiagnostic = inputAuthorityDiagnostic(contractWithoutExecution, supplierCode);
        if (!["SUPPLIER_METADATA_NORMALIZED", "OWNER_VERIFIED_FALLBACK"].includes(contractDiagnostic.reason)) sellingBlockers.push("INPUT_CONTRACT_REQUIRED");
    } else if (!["SUPPLIER_METADATA_NORMALIZED", "OWNER_VERIFIED_FALLBACK"].includes(input.reason)) sellingBlockers.push("INPUT_CONTRACT_REQUIRED");
    if (!disposition.proven) blockers.push("PACKAGE_IDENTITY_REVIEW");
    const unique = [...new Set(blockers)];
    const unavailable = unique.includes("SUPPLIER_UNAVAILABLE");
    const state = unavailable ? "UNAVAILABLE" : unique.length ? "NEEDS_ATTENTION" : mapping ? "READY" : "PREPARABLE";
    const actionByBlocker = { PACKAGE_IDENTITY_REVIEW: "PACKAGE_REVIEW", INPUT_CONTRACT_REQUIRED: "INPUT_CONTRACT", EXECUTION_IDENTITY_REQUIRED: "EXECUTION_CONFIGURATION", SUPPLIER_MARKET_AUTHORITY_REQUIRED: "MARKET_AUTHORITY", CUSTOMER_MARKET_INELIGIBLE: "MARKET_AUTHORITY", SUPPLIER_UNAVAILABLE: "NONE", UNSUPPORTED_PROTOCOL: "NONE", STALE_SOURCE: "REFRESH" };
    return { state, selectable: ["READY", "PREPARABLE"].includes(state), primaryBlocker: unique[0] || "", blockers: unique, sellingBlockers: [...new Set(sellingBlockers)], correctiveAction: actionByBlocker[unique[0]] || "NONE", packageDisposition: disposition, inputAuthority: input.classification };
}

module.exports = Object.freeze({ SOURCE_BLOCKERS, verifiedEligibility, packageDisposition, evaluateAddProductOffer });
