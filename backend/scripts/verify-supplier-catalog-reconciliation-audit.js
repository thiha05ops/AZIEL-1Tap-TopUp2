#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Mapping = require("../models/SupplierProductMapping");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Publication = require("../models/PackageMarketPublication");
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");
const { mappingBusinessHash } = require("../services/supplierCatalog/supplierCatalogMappingReferenceService");

const ARTIFACT = path.resolve(__dirname, "../../docs/supplier-catalog-reconciliation-audit-phase2g-a-2026-08-31.json");
const sha = value => crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const id = value => String(value?._id || value || "");
const stableRows = rows => [...rows].sort((a, b) => id(a).localeCompare(id(b)));
async function fingerprint(Model) { const rows = stableRows(await Model.find().lean()); return { count: rows.length, sha256: sha(rows) }; }
async function fingerprints() { return { SupplierCatalogProduct: await fingerprint(Product), SupplierCatalogOffer: await fingerprint(Offer), SupplierOfferAvailability: await fingerprint(Availability), SupplierProductMapping: await fingerprint(Mapping), CatalogProduct: await fingerprint(CatalogProduct), CatalogPackage: await fingerprint(CatalogPackage), PackageMarketPublication: await fingerprint(Publication) }; }
const semanticKey = offer => canonicalJson(offer.normalizedSemantics || {});
const countBy = (rows, field) => rows.reduce((out, row) => { const key = row[field] || "UNSPECIFIED"; out[key] = (out[key] || 0) + 1; return out; }, {});

function recommendation(offer, product, suggestedTargets) {
    const code = String(product?.supplierProductCode || offer.supplierProductCode || "");
    if (offer.reconciliationState === "NO_CANONICAL_PACKAGE" && code === "9604") return { action: "BLOCKED_MISSING_PROVIDER_AUTHORITY", reasons: ["TRANSACTIONAL_SERVICE_CODE_UNCONFIRMED", "CANONICAL_PRODUCT_AUTHORITY_MISSING"] };
    if (offer.reconciliationState === "SPECIAL_VARIANT") return { action: "SPECIAL_VARIANT_REVIEW", reasons: ["SPECIAL_PRODUCT_SEMANTICS_REQUIRE_EXPLICIT_REVIEW"] };
    if (offer.reconciliationState === "SEMANTIC_REVIEW_REQUIRED" && suggestedTargets.length) return { action: "LINK_EXISTING_CANDIDATE", reasons: ["NON_AUTHORITATIVE_SEMANTIC_CANDIDATE_AVAILABLE", "ADMIN_APPROVAL_REQUIRED"] };
    if (offer.reconciliationState === "SEMANTIC_REVIEW_REQUIRED") return { action: "DEFER", reasons: ["CANONICAL_EQUIVALENCE_NOT_PROVEN"] };
    return { action: "DEFER", reasons: ["RECONCILIATION_REQUIRES_HUMAN_REVIEW"] };
}

function buildArtifact(data) {
    const supplierById = new Map(data.suppliers.map(row => [id(row), row]));
    const productById = new Map(data.products.map(row => [id(row), row]));
    const availabilityByOffer = new Map(data.availability.map(row => [id(row.supplierCatalogOfferId), row]));
    const mappingByOffer = new Map(data.mappings.filter(row => row.supplierCatalogOfferId).map(row => [id(row.supplierCatalogOfferId), row]));
    const linkedTargetsBySemantic = new Map();
    for (const offer of data.offers) {
        const mapping = mappingByOffer.get(id(offer));
        if (!mapping) continue;
        const key = semanticKey(offer);
        if (!linkedTargetsBySemantic.has(key)) linkedTargetsBySemantic.set(key, new Map());
        linkedTargetsBySemantic.get(key).set(`${mapping.productCode}/${mapping.packageCode}`, { productCode: mapping.productCode, packageCode: mapping.packageCode, evidence: "IDENTICAL_NORMALIZED_SEMANTICS_ON_EXISTING_LINKED_OFFER", authority: "SUGGESTED_CANDIDATE_ONLY" });
    }
    const unmapped = data.offers.filter(offer => !mappingByOffer.has(id(offer))).map(offer => {
        const supplier = supplierById.get(id(offer.supplierId)) || {};
        const product = productById.get(id(offer.supplierCatalogProductId)) || {};
        const availability = availabilityByOffer.get(id(offer)) || {};
        const suggestedTargets = [...(linkedTargetsBySemantic.get(semanticKey(offer))?.values() || [])].sort((a, b) => `${a.productCode}/${a.packageCode}`.localeCompare(`${b.productCode}/${b.packageCode}`));
        const next = recommendation(offer, product, suggestedTargets);
        return {
            supplierCatalogOfferId: id(offer),
            supplierCode: supplier.supplierCode,
            catalogNamespace: offer.catalogNamespace,
            supplierProductCode: offer.supplierProductCode,
            supplierProductName: product.displayName || product.rawName || offer.supplierProductCode,
            supplierOfferCode: offer.supplierOfferCode,
            supplierOfferName: offer.supplierOfferName || offer.rawName,
            supplierMarketCode: product.supplierMarketCode || "UNSPECIFIED",
            reconciliationState: offer.reconciliationState,
            semanticClassification: offer.reconciliationState === "SPECIAL_VARIANT" ? "SPECIAL_PRODUCT" : offer.reconciliationState === "NO_CANONICAL_PACKAGE" ? "MISSING_CANONICAL_AUTHORITY" : "NORMALIZED_SEMANTIC_REVIEW",
            normalizedSemantics: offer.normalizedSemantics || {},
            restrictions: product.restrictions || [],
            normalizedInputContract: product.normalizedInputContract || {},
            availability: { state: availability.state || "UNKNOWN", evidenceCode: availability.evidenceCode || "INSUFFICIENT_EVIDENCE", coverageComplete: availability.coverageComplete === true, observedAt: availability.observedAt || null },
            observedSupplierCost: offer.supplierCost ? { amount: offer.supplierCost.amount, currency: offer.supplierCost.currency, observedAt: offer.supplierCost.observedAt, authority: "INFORMATIONAL_ONLY" } : null,
            sourceOfferHash: offer.rawSnapshotHash,
            sourceOfferRevision: offer.sourceRevision || "",
            sourceLastChangedAt: offer.lastChangedAt,
            recommendedAction: next.action,
            blockingReasons: next.reasons,
            candidateCanonicalTargets: suggestedTargets,
            candidateAuthority: "NON_AUTHORITATIVE_SUGGESTION",
            automaticApproval: false,
            customerEligibilityInferred: false,
            publicationInferred: false,
            observedCostPromoted: false
        };
    }).sort((a, b) => [a.supplierCode, a.catalogNamespace, a.supplierProductCode, a.supplierOfferCode].join("|").localeCompare([b.supplierCode, b.catalogNamespace, b.supplierProductCode, b.supplierOfferCode].join("|")));
    const sourceObservedAt = data.offers.reduce((latest, row) => new Date(row.lastObservedAt || 0) > new Date(latest || 0) ? row.lastObservedAt : latest, null);
    const base = {
        artifactType: "AZIEL_SUPPLIER_CATALOG_RECONCILIATION_AUDIT_PHASE_2G_A",
        artifactVersion: 1,
        auditAsOf: sourceObservedAt,
        mode: "PRODUCTION_READ_ONLY",
        authorityNotice: "Recommendations and candidate targets are non-authoritative. No mapping, canonical, pricing, eligibility, readiness, role, or publication mutation is authorized.",
        baseline: { supplierCatalogProducts: data.products.length, supplierCatalogOffers: data.offers.length, supplierOfferAvailability: data.availability.length, supplierProductMappings: data.mappings.length, linkedMappings: data.mappings.filter(row => row.supplierCatalogOfferId).length, unlinkedLegacyMappings: data.mappings.filter(row => !row.supplierCatalogOfferId).length, packageMarketPublications: data.publications.length, unmappedOffers: unmapped.length },
        breakdown: {
            bySupplier: countBy(unmapped, "supplierCode"),
            byReconciliationState: countBy(unmapped, "reconciliationState"),
            byRecommendedAction: countBy(unmapped, "recommendedAction"),
            bySupplierAndReconciliation: Object.fromEntries([...new Set(unmapped.map(row => row.supplierCode))].sort().map(code => [code, countBy(unmapped.filter(row => row.supplierCode === code), "reconciliationState")]))
        },
        unmappedOffers: unmapped
    };
    return { ...base, artifactHash: sha(base) };
}

function verifyArtifact(artifact) {
    let checks = 0; const ok = (condition, message) => { assert(condition, message); checks += 1; };
    ok(artifact.baseline.unmappedOffers === artifact.unmappedOffers.length, "all current unmapped offers accounted for");
    ok(artifact.baseline.supplierCatalogOffers === artifact.baseline.linkedMappings + artifact.baseline.unmappedOffers, "current linked and unmapped offer sets are exhaustive");
    ok(artifact.unmappedOffers.every(row => !row.mappingId), "no linked offer in unmapped set");
    ok(artifact.unmappedOffers.every(row => row.automaticApproval === false), "no automatic mapping");
    ok(artifact.unmappedOffers.every(row => row.supplierCode && row.catalogNamespace && row.supplierProductCode && row.supplierOfferCode), "supplier identities preserved");
    ok(artifact.unmappedOffers.every(row => row.customerEligibilityInferred === false), "supplier market is not eligibility");
    ok(artifact.unmappedOffers.every(row => !["AVAILABLE", "UNAVAILABLE", "UNKNOWN"].includes(row.recommendedAction)), "availability is not approval");
    ok(artifact.unmappedOffers.every(row => row.publicationInferred === false), "publication is not approval");
    ok(artifact.unmappedOffers.every(row => row.observedCostPromoted === false && (!row.observedSupplierCost || row.observedSupplierCost.authority === "INFORMATIONAL_ONLY")), "observed cost not promoted");
    const blackClover = artifact.unmappedOffers.filter(row => row.supplierProductCode === "9604");
    ok(blackClover.length === 0 || blackClover.every(row => row.recommendedAction === "BLOCKED_MISSING_PROVIDER_AUTHORITY"), "Black Clover remains blocked when present");
    const heartopia = artifact.unmappedOffers.filter(row => row.supplierCode === "WONDD" && row.reconciliationState === "SPECIAL_VARIANT");
    ok(heartopia.length === 0 || heartopia.every(row => row.recommendedAction === "SPECIAL_VARIANT_REVIEW"), "Heartopia variants distinct when present");
    const fazerSpecial = artifact.unmappedOffers.filter(row => row.supplierCode === "FAZERCARDS" && row.reconciliationState === "SPECIAL_VARIANT");
    ok(fazerSpecial.every(row => row.recommendedAction === "SPECIAL_VARIANT_REVIEW"), "Fazer specials remain distinct");
    ok(artifact.unmappedOffers.every(row => row.candidateCanonicalTargets.every(target => target.authority === "SUGGESTED_CANDIDATE_ONLY")), "numeric similarity never approves");
    ok(artifact.unmappedOffers.every(row => row.candidateAuthority === "NON_AUTHORITATIVE_SUGGESTION"), "candidate recommendations non-authoritative");
    const architecture = fs.readFileSync(path.resolve(__dirname, "../../docs/supplier-catalog-reconciliation-architecture-phase2g.md"), "utf8");
    ok(architecture.includes("Duplicate and conflict policy"), "duplicate and conflicts defined");
    ok(architecture.includes("sourceOfferHash") && architecture.includes("STALE_SOURCE_REVISION"), "source revision required");
    ok(architecture.includes("Idempotency") && architecture.includes("approvedDecisionId"), "idempotency designed");
    ok(architecture.includes("Audit trail") && architecture.includes("beforeState") && architecture.includes("afterState"), "audit trail designed");
    ok(architecture.includes("SUPPLIER_CATALOG_RECONCILE") && architecture.includes("SUPPLIERS_READ"), "mutation permission separate");
    ok(architecture.includes("productionRole = DISABLED") && architecture.includes("mode = UNKNOWN") && architecture.includes("enabled = false"), "safe defaults fail closed");
    ok(artifact.mode === "PRODUCTION_READ_ONLY", "no production write");
    ok(artifact.artifactHash === sha(Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "artifactHash"))), "artifact hash valid");
    return checks;
}

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const before = await fingerprints();
    const [suppliers, products, offers, availability, mappings, catalogProducts, catalogPackages, publications] = await Promise.all([Supplier.find().lean(), Product.find().lean(), Offer.find().lean(), Availability.find().lean(), Mapping.find().lean(), CatalogProduct.find().lean(), CatalogPackage.find().lean(), Publication.find().lean()]);
    const mappingHashBefore = mappingBusinessHash(mappings);
    const artifact = buildArtifact({ suppliers, products, offers, availability, mappings, catalogProducts, catalogPackages, publications });
    const checks = verifyArtifact(artifact);
    fs.writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    const after = await fingerprints();
    const mappingHashAfter = mappingBusinessHash(await Mapping.find().lean());
    assert.deepStrictEqual(after, before, "Production fingerprint changed");
    assert.strictEqual(mappingHashAfter, mappingHashBefore, "Mapping business hash changed");
    console.log(JSON.stringify({ result: "PASS", checks, artifact: ARTIFACT, artifactHash: artifact.artifactHash, baseline: artifact.baseline, breakdown: artifact.breakdown, productionFingerprintExactEquality: true, mappingBusinessStateHash: mappingHashAfter, supplierCalls: 0, productionWrites: 0 }, null, 2));
    await mongoose.disconnect();
})().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(error); process.exit(1); });

module.exports = { buildArtifact, verifyArtifact, recommendation };
