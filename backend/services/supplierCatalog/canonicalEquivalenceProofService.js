"use strict";

const { normalizeSupplierMarket } = require("../../constants/supplierMarkets");

const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();
const id = value => clean(value?._id || value);
const APPROVED_TYPES = new Set(["LINK_TO_EXISTING_CANONICAL_PACKAGE", "CREATE_CANONICAL_PACKAGE_AND_LINK"]);

function decisionBlockers({ decision, supplierProduct, offer, mapping, canonicalProduct, canonicalPackage }) {
    if (!decision) return [];
    const identity = decision.supplierIdentity || {};
    const blockers = [];
    if (decision.isCurrent !== true || decision.decisionStatus !== "APPROVED" || !APPROVED_TYPES.has(decision.decisionType)) blockers.push("RECONCILIATION_DECISION_NOT_CURRENT_APPROVED");
    if (id(decision.supplierCatalogOfferId) !== id(offer) || id(identity.supplierId) !== id(offer?.supplierId)) blockers.push("RECONCILIATION_DECISION_IDENTITY_CONFLICT");
    if (clean(identity.supplierProductCode) !== clean(offer?.supplierProductCode) || clean(identity.supplierOfferCode) !== clean(offer?.supplierOfferCode)) blockers.push("RECONCILIATION_DECISION_NATIVE_IDENTITY_CONFLICT");
    if (id(decision.mappingId) && id(decision.mappingId) !== id(mapping)) blockers.push("RECONCILIATION_DECISION_MAPPING_CONFLICT");
    if (decision.canonicalProductId && id(decision.canonicalProductId) !== id(canonicalProduct)) blockers.push("RECONCILIATION_DECISION_CANONICAL_CONFLICT");
    if (decision.canonicalPackageId && id(decision.canonicalPackageId) !== id(canonicalPackage)) blockers.push("RECONCILIATION_DECISION_CANONICAL_CONFLICT");
    if (lower(decision.canonicalProductCode) && lower(decision.canonicalProductCode) !== lower(mapping?.productCode)) blockers.push("RECONCILIATION_DECISION_CANONICAL_CONFLICT");
    if (upper(decision.canonicalPackageCode) && upper(decision.canonicalPackageCode) !== upper(mapping?.packageCode)) blockers.push("RECONCILIATION_DECISION_CANONICAL_CONFLICT");
    if (clean(decision.sourceOfferHash) && clean(decision.sourceOfferHash) !== clean(offer?.rawSnapshotHash)) blockers.push("RECONCILIATION_DECISION_SOURCE_STALE");
    if (supplierProduct && id(supplierProduct.supplierId) !== id(offer?.supplierId)) blockers.push("SUPPLIER_PRODUCT_IDENTITY_CONFLICT");
    return [...new Set(blockers)].sort();
}

function mappingBlockers({ supplierProduct, offer, mapping, canonicalProduct, canonicalPackages = [] }) {
    if (!mapping) return ["CANONICAL_EQUIVALENCE_MAPPING_MISSING"];
    const packages = canonicalPackages.filter(Boolean);
    const supplierMarket = normalizeSupplierMarket(supplierProduct?.supplierMarketCode) || upper(supplierProduct?.supplierMarketCode);
    const mappingMarket = normalizeSupplierMarket(mapping.region) || upper(mapping.region);
    const blockers = [];
    if (mapping.archivedAt) blockers.push("MAPPING_ARCHIVED");
    if (id(mapping.supplierId) !== id(offer?.supplierId) || id(mapping.supplierId) !== id(supplierProduct?.supplierId)) blockers.push("SUPPLIER_IDENTITY_CONFLICT");
    if (id(mapping.supplierCatalogOfferId) !== id(offer)) blockers.push("SUPPLIER_CATALOG_OFFER_IDENTITY_CONFLICT");
    if (clean(mapping.supplierProductCode) !== clean(offer?.supplierProductCode) || clean(mapping.supplierProductCode) !== clean(supplierProduct?.supplierProductCode)) blockers.push("SUPPLIER_PRODUCT_IDENTITY_CONFLICT");
    if (clean(mapping.supplierPackageCode) !== clean(offer?.supplierOfferCode)) blockers.push("SUPPLIER_OFFER_IDENTITY_CONFLICT");
    if (!supplierMarket || !mappingMarket || supplierMarket !== mappingMarket) blockers.push("SUPPLIER_MARKET_IDENTITY_CONFLICT");
    if (!canonicalProduct || lower(canonicalProduct.productCode) !== lower(mapping.productCode)) blockers.push("CANONICAL_PRODUCT_MISSING");
    if (packages.length !== 1) blockers.push(packages.length ? "AMBIGUOUS_CANONICAL_IDENTITY" : "CANONICAL_PACKAGE_MISSING");
    const canonicalPackage = packages[0];
    if (canonicalPackage && (lower(canonicalPackage.productCode) !== lower(mapping.productCode) || upper(canonicalPackage.packageCode) !== upper(mapping.packageCode))) blockers.push("CANONICAL_PACKAGE_IDENTITY_CONFLICT");
    return { blockers: [...new Set(blockers)].sort(), canonicalPackage };
}

function assessCanonicalEquivalenceProof(input = {}) {
    if (!input.mapping) {
        const evidence = input.offer?.reconciliationEvidence || {};
        const evidenceProduct = lower(evidence.canonicalProductCode || evidence.productCode), evidencePackage = upper(evidence.canonicalPackageCode || evidence.packageCode);
        const packages = (input.canonicalPackages || []).filter(Boolean), canonicalPackage = packages.length === 1 ? packages[0] : null;
        if (upper(input.offer?.reconciliationState) === "EXACT_CANONICAL_MATCH" && evidenceProduct && evidencePackage && lower(input.canonicalProduct?.productCode) === evidenceProduct && canonicalPackage && upper(canonicalPackage.packageCode) === evidencePackage) return { proven: true, source: "AUTHORITATIVE_OFFER_EVIDENCE", classification: "PROVEN_SAME", blockers: [] };
        return { proven: false, source: null, classification: "AMBIGUOUS", blockers: ["CANONICAL_EQUIVALENCE_REVIEW_REQUIRED"] };
    }
    const mapped = mappingBlockers(input);
    const decision = decisionBlockers({ ...input, decision: input.reconciliationDecision, canonicalPackage: mapped.canonicalPackage });
    if (mapped.blockers.length || decision.length) return { proven: false, source: null, classification: "CONFLICT", blockers: [...new Set([...mapped.blockers, ...decision, "CANONICAL_EQUIVALENCE_REVIEW_REQUIRED"])].sort() };
    if (input.mapping) return { proven: true, source: input.reconciliationDecision ? "RECONCILIATION_DECISION" : "EXACT_MAPPING", classification: "PROVEN_SAME", blockers: [] };
    return { proven: false, source: null, classification: "AMBIGUOUS", blockers: ["CANONICAL_EQUIVALENCE_REVIEW_REQUIRED"] };
}

module.exports = Object.freeze({ APPROVED_TYPES, assessCanonicalEquivalenceProof });
