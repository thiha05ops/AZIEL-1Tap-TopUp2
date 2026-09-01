#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const plan = require("../../docs/current-supplier-master-catalog-reconciliation-plan-reviewed-2026-08-31.json");
const AdminAccount = require("../models/AdminAccount");
const Offer = require("../models/SupplierCatalogOffer");
const Decision = require("../models/SupplierCatalogReconciliationDecision");
const Mapping = require("../models/SupplierProductMapping");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Publication = require("../models/PackageMarketPublication");
const PricingPolicy = require("../models/PricingPolicy");
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");
const { createSupplierCatalogReconciliationService } = require("../services/supplierCatalog/supplierCatalogReconciliationService");

const suppliedHash = (process.argv.find(x => x.startsWith("--apply-reviewed-plan=")) || "").split("=")[1] || "";
const sha = value => crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const id = value => String(value?._id || value || "");

async function fingerprint(Model) {
    const rows = await Model.find().sort({ _id: 1 }).lean();
    return { count: rows.length, hash: sha(rows) };
}
function same(a, b) { return a.count === b.count && a.hash === b.hash; }

async function alreadyApplied() {
    const expectedOffers = [...plan.proposedMappings, ...plan.proposedDecisions];
    const offerIds = expectedOffers.map(x => x.supplierCatalogOfferId);
    const [decisions, mappings] = await Promise.all([
        Decision.find({ supplierCatalogOfferId: { $in: offerIds }, isCurrent: true }).lean(),
        Mapping.find({ supplierCatalogOfferId: { $in: plan.proposedMappings.map(x => x.supplierCatalogOfferId) } }).lean()
    ]);
    const decisionByOffer = new Map(decisions.map(x => [id(x.supplierCatalogOfferId), x]));
    const mappingByOffer = new Map(mappings.map(x => [id(x.supplierCatalogOfferId), x]));
    return expectedOffers.every(x => {
        const d = decisionByOffer.get(x.supplierCatalogOfferId);
        return d && d.reasonCode === (x.reasonCode || "EXACT_EXISTING_CANONICAL_REVIEWED");
    }) && plan.proposedMappings.every(x => {
        const m = mappingByOffer.get(x.supplierCatalogOfferId);
        return m && m.productCode === x.canonicalProductCode && m.packageCode === x.canonicalPackageCode && m.region === x.region && m.enabled === false && m.productionRole === "DISABLED";
    });
}

async function main() {
    if (!suppliedHash || suppliedHash !== plan.planHash) throw Object.assign(new Error("Exact reviewed plan hash is required."), { code: "REVIEWED_PLAN_HASH_MISMATCH" });
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI, { readPreference: "primary", serverSelectionTimeoutMS: 10000 });
    if (await alreadyApplied()) {
        console.log(JSON.stringify({ result: "PASS_IDEMPOTENT_REPLAY", planHash: plan.planHash, decisionCreates: 0, mappingCreates: 0 }, null, 2));
        return;
    }
    const [catalogProducts, catalogPackages, mappingsBefore, publications, pricingPolicies] = await Promise.all([
        fingerprint(CatalogProduct), fingerprint(CatalogPackage), fingerprint(Mapping), fingerprint(Publication), fingerprint(PricingPolicy)
    ]);
    const currentProtected = { catalogProducts, catalogPackages, mappings: mappingsBefore, publications, pricingPolicies };
    for (const key of Object.keys(plan.protectedState)) {
        if (!same(currentProtected[key], plan.protectedState[key])) throw Object.assign(new Error(`Protected production state changed after review: ${key}`), { code: "STALE_REVIEWED_PLAN" });
    }
    const owner = await AdminAccount.findOne({ role: "OWNER", status: "ACTIVE" }).sort({ createdAt: 1 }).lean();
    if (!owner) throw Object.assign(new Error("No active OWNER audit actor exists."), { code: "AUDIT_ACTOR_MISSING" });
    const actor = { id: owner._id, username: owner.username, role: owner.role };
    const service = createSupplierCatalogReconciliationService({ mutationsEnabled: () => true });
    let mappingCreates = 0, decisionCreates = 0, exactStateUpdates = 0;
    for (const item of plan.proposedMappings) {
        const offer = await Offer.findById(item.supplierCatalogOfferId).lean();
        if (!offer) throw Object.assign(new Error(`Offer disappeared: ${item.supplierCatalogOfferId}`), { code: "STALE_REVIEWED_PLAN" });
        if (offer.reconciliationState !== "EXACT_CANONICAL_MATCH") {
            await Offer.updateOne({ _id: offer._id, rawSnapshotHash: item.expectedSource.sourceOfferHash }, {
                $set: { reconciliationState: "EXACT_CANONICAL_MATCH", reconciliationEvidence: { authority: "PROMPT_1_EXACT_EXISTING_CANONICAL_REVIEW", planHash: plan.planHash, canonicalProductCode: item.canonicalProductCode, canonicalPackageCode: item.canonicalPackageCode, supplierNativeName: item.supplierOfferName, reviewedExpectedName: item.reviewedExpectedName } }
            });
            exactStateUpdates++;
        }
        const result = await service.decide({
            supplierCatalogOfferId: item.supplierCatalogOfferId, decisionType: "LINK_TO_EXISTING_CANONICAL_PACKAGE",
            canonicalPackageId: item.canonicalPackageId, region: item.region,
            reasonCode: "EXACT_EXISTING_CANONICAL_REVIEWED",
            reviewNotes: "Exact supplier-native entitlement matches the named existing supplier-neutral canonical package; mapping remains disabled, role DISABLED, eligibility UNKNOWN, and all readiness gates false.",
            evidence: { planHash: plan.planHash, reviewedSourceSetHash: plan.reviewedSourceSetHash, supplierNativeName: item.supplierOfferName, canonicalPackageName: item.canonicalPackageName },
            expectedSource: item.expectedSource, requestIdempotencyKey: `prompt1:${plan.planHash}:${item.supplierCatalogOfferId}`
        }, { actor, requestId: `prompt1-${plan.planHash.slice(0, 16)}` });
        if (!result.idempotentReplay) { mappingCreates++; decisionCreates++; }
    }
    for (const item of plan.proposedDecisions) {
        const result = await service.decide({
            supplierCatalogOfferId: item.supplierCatalogOfferId, decisionType: "DEFER_REVIEW",
            reasonCode: item.reasonCode, reviewNotes: item.reviewNotes,
            evidence: { planHash: plan.planHash, reviewedSourceSetHash: plan.reviewedSourceSetHash, exactEvidenceStillMissing: item.reviewNotes },
            expectedSource: item.expectedSource, requestIdempotencyKey: `prompt1:${plan.planHash}:${item.supplierCatalogOfferId}`
        }, { actor, requestId: `prompt1-${plan.planHash.slice(0, 16)}` });
        if (!result.idempotentReplay) decisionCreates++;
        if (decisionCreates > 0 && decisionCreates % 200 === 0) console.log(JSON.stringify({ progress: true, decisionCreates, mappingCreates }));
    }
    const [catalogProductsAfter, catalogPackagesAfter, mappingsAfter, publicationsAfter, pricingPoliciesAfter] = await Promise.all([
        fingerprint(CatalogProduct), fingerprint(CatalogPackage), fingerprint(Mapping), fingerprint(Publication), fingerprint(PricingPolicy)
    ]);
    if (!same(catalogProducts, catalogProductsAfter) || !same(catalogPackages, catalogPackagesAfter) || !same(publications, publicationsAfter) || !same(pricingPolicies, pricingPoliciesAfter)) {
        throw Object.assign(new Error("A protected authority changed during reconciliation apply."), { code: "PROTECTED_AUTHORITY_CHANGED" });
    }
    if (mappingsAfter.count !== mappingsBefore.count + plan.proposedMappings.length) throw Object.assign(new Error("Unexpected mapping count after apply."), { code: "MAPPING_COUNT_MISMATCH" });
    const created = await Mapping.find({ supplierCatalogOfferId: { $in: plan.proposedMappings.map(x => x.supplierCatalogOfferId) } }).lean();
    if (created.some(x => x.enabled !== false || x.productionRole !== "DISABLED" || x.fulfillmentEligibility?.mode !== "UNKNOWN")) throw Object.assign(new Error("A new mapping is not fail-closed."), { code: "MAPPING_FAIL_CLOSED_VIOLATION" });
    console.log(JSON.stringify({ result: "PASS", planHash: plan.planHash, exactStateUpdates, decisionCreates, mappingCreates, protectedAuthoritiesUnchanged: true, pricingWrites: 0, publicationWrites: 0, routingRoleWrites: 0, orders: 0, payments: 0, fulfillmentCalls: 0, supplierTransactionalCalls: 0 }, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ result: "ABORTED", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
