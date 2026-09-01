#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const Supplier = require("../models/Supplier");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Mapping = require("../models/SupplierProductMapping");
const Decision = require("../models/SupplierCatalogReconciliationDecision");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Publication = require("../models/PackageMarketPublication");
const PricingPolicy = require("../models/PricingPolicy");
const { sourceLock } = require("../services/supplierCatalog/supplierCatalogReconciliationService");
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");
const { classifySupplierMarket, isTargetCoverageState } = require("../services/supplierCatalog/supplierMarketCoveragePolicy");

const OUTPUT = path.resolve(__dirname, "../../docs/current-supplier-master-catalog-reconciliation-plan-reviewed-2026-08-31.json");
const sha = value => crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const id = value => String(value?._id || value || "");
const sortIdentity = (a, b) => `${a.supplierCode}/${a.supplierProductCode}/${a.supplierOfferCode}`.localeCompare(`${b.supplierCode}/${b.supplierProductCode}/${b.supplierOfferCode}`);
const EXACT_EXISTING_TARGETS = Object.freeze({
    "undawn_garena_global/ace_fund": ["undawn", "UNDAWN_WONDD_UACE379", "Ace Fund"],
    "mobile_legends_global/7740_1548_diamonds": ["mlbb", "MLBB_7740_1548", "7740+1548 Diamonds"],
    "mobile_legends_global/weekly_pass": ["mlbb-twilight-weekly-pass", "MLBB-WEEKLY.PASS", "Weekly Pass"],
    "pubg_mobile_auto/first_purchase_pack": ["pubgrp", "PUBGRP_FIRST_PURCHASE", "First Purchase Pack"],
    "pubg_mobile_auto/prime_1_month": ["pubgrp", "PUBGRP_PRIME_1M", "Prime (1 Month)"],
    "pubg_mobile_auto/weekly_deal_pack_1": ["pubgrp", "PUBGRP_WEEKLY_DEAL_1", "Weekly Deal Pack 1"],
    "pubg_mobile_auto/upgradable_firearm_materials_pack": ["pubgrp", "PUBGRP_FIREARM_MATERIALS", "Upgradable Firearm Materials Pack"],
    "pubg_mobile_auto/weekly_mythic_emblem_value_pack": ["pubgrp", "PUBGRP_WEEKLY_MYTHIC", "Weekly Mythic Emblem Value Pack"],
    "pubg_mobile_auto/prime_3_months": ["pubgrp", "PUBGRP_PRIME_3M", "Prime (3 Months)"],
    "pubg_mobile_auto/weekly_deal_pack_2": ["pubgrp", "PUBGRP_WEEKLY_DEAL_2", "Weekly Deal Pack 2"],
    "pubg_mobile_auto/mythic_emblem_pack": ["pubgrp", "PUBGRP_MYTHIC_EMBLEM", "Mythic Emblem Pack"],
    "pubg_mobile_auto/prime_6_months": ["pubgrp", "PUBGRP_PRIME_6M", "Prime (6 Months)"],
    "pubg_mobile_auto/elite_pass_lv1_50": ["pubgrp", "PUBGRP_ELITE_1_50", "Elite Pass (LV1-50)"],
    "pubg_mobile_auto/prime_plus_1_month": ["pubgrp", "PUBGRP_PRIME_PLUS_1M", "Prime Plus (1 Month)"],
    "pubg_mobile_auto/prime_12_months": ["pubgrp", "PUBGRP_PRIME_12M", "Prime (12 Months)"],
    "pubg_mobile_auto/elite_pass_lv1_100": ["pubgrp", "PUBGRP_ELITE_1_100", "Elite Pass (LV1-100)"],
    "pubg_mobile_auto/elite_pass_plus_lv1_100": ["pubgrp", "PUBGRP_ELITE_PLUS_1_100", "Elite Pass Plus (LV1-100)"],
    "pubg_mobile_auto/prime_plus_3_months": ["pubgrp", "PUBGRP_PRIME_PLUS_3M", "Prime Plus (3 Months)"],
    "pubg_mobile_auto/prime_plus_6_months": ["pubgrp", "PUBGRP_PRIME_PLUS_6M", "Prime Plus (6 Months)"],
    "pubg_mobile_auto/prime_plus_12_months": ["pubgrp", "PUBGRP_PRIME_PLUS_12M", "Prime Plus (12 Months)"]
});

function reviewReason({ product, offer, coverage }) {
    const market = String(product.supplierMarketCode || "").toUpperCase();
    const name = `${product.displayName || ""} ${offer.supplierOfferName || ""}`.toLowerCase();
    if (coverage.state === "ELIGIBLE_ASIA_COUNTRY" && !["TH", "THAILAND", "MM", "MYANMAR"].includes(market)) {
        return {
            code: "UNSUPPORTED_BY_CURRENT_CANONICAL_MODEL",
            missing: `Supplier evidence is ${market}, but SupplierProductMapping and canonical customer markets currently represent only MM/TH; mapping this offer to TH or MM would corrupt its region restriction.`
        };
    }
    if (/first\s*(top.?up|purchase)|double|first\s*recharge/.test(name)) return { code: "BONUS_STRUCTURE_UNCONFIRMED", missing: "Provider evidence does not prove that the first-purchase/bonus entitlement is identical to any supplier-neutral canonical package." };
    if (/weekly|monthly|subscription|membership|pass|battle|elite|twilight|premium/.test(name)) return { code: "SUBSCRIPTION_VARIANT_UNCLEAR", missing: "Duration, renewal, one-time eligibility, and included entitlement must be confirmed before creating or reusing a subscription/pass canonical package." };
    const required = Array.isArray(product.requiredFields) ? product.requiredFields : [];
    const contract = product.normalizedInputContract && typeof product.normalizedInputContract === "object" ? product.normalizedInputContract : {};
    if (required.length === 0 && Object.keys(contract).length === 0) return { code: "INPUT_CONTRACT_UNCONFIRMED", missing: "The read-only catalog snapshot does not contain a provider-confirmed customer-input/order contract for this supplier product." };
    return { code: "ENTITLEMENT_AMBIGUOUS", missing: "The supplier-native offer label and category context are retained, but no reviewed exact canonical-package equivalence proves amount, bonus structure, delivery variant, and entitlement." };
}

async function fingerprint(Model, projection = {}) {
    const rows = await Model.find().select(projection).sort({ _id: 1 }).lean();
    return { count: rows.length, hash: sha(rows) };
}

async function main() {
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI, { readPreference: "secondaryPreferred", serverSelectionTimeoutMS: 10000 });
    const [suppliers, products, offers, availability, mappings, decisions, canonicalPackages, protectedState] = await Promise.all([
        Supplier.find({ supplierCode: { $in: ["FAZERCARDS", "WONDD"] } }).lean(),
        Product.find({}).lean(), Offer.find({}).lean(), Availability.find({}).lean(),
        Mapping.find({}).lean(), Decision.find({ isCurrent: true }).lean(), CatalogPackage.find({ deletedAt: null }).lean(),
        Promise.all([
            fingerprint(CatalogProduct), fingerprint(CatalogPackage), fingerprint(Mapping),
            fingerprint(Publication), fingerprint(PricingPolicy)
        ])
    ]);
    const supplierById = new Map(suppliers.map(x => [id(x), x]));
    const productById = new Map(products.map(x => [id(x), x]));
    const availabilityByOffer = new Map(availability.map(x => [id(x.supplierCatalogOfferId), x]));
    const mappingByOffer = new Map(mappings.filter(x => x.supplierCatalogOfferId).map(x => [id(x.supplierCatalogOfferId), x]));
    const decisionByOffer = new Map(decisions.map(x => [id(x.supplierCatalogOfferId), x]));
    const canonicalPackageByKey = new Map(canonicalPackages.map(x => [`${x.productCode}/${x.packageCode}`, x]));
    const rows = [];
    const proposedDecisions = [];
    const proposedMappings = [];
    for (const offer of offers) {
        const supplier = supplierById.get(id(offer.supplierId));
        if (!supplier) continue;
        const product = productById.get(id(offer.supplierCatalogProductId));
        const observedAvailability = availabilityByOffer.get(id(offer)) || null;
        const mapping = mappingByOffer.get(id(offer)) || null;
        const decision = decisionByOffer.get(id(offer)) || null;
        const coverage = classifySupplierMarket({ supplierMarketCode: product.supplierMarketCode, supportState: product.supportState });
        const target = isTargetCoverageState(coverage.state);
        let disposition;
        let reasonCode = "";
        let missingEvidence = "";
        if (!target) {
            disposition = coverage.state === "UNSUPPORTED" ? "EXCLUDED_UNSUPPORTED" : coverage.state === "NON_TARGET_MARKET" ? "EXCLUDED_NON_TARGET_MARKET" : "REVIEW_REQUIRED";
            reasonCode = coverage.evidenceCode;
            missingEvidence = coverage.state === "UNKNOWN_MARKET" ? "Provider-owned market/region evidence is absent or insufficient." : "No target canonical/mapping action is authorized for this market classification.";
        } else if (mapping) {
            disposition = "MAPPED_EXISTING_CANONICAL";
            reasonCode = "EXISTING_EXACT_MAPPING_REUSED";
        } else if (EXACT_EXISTING_TARGETS[`${offer.supplierProductCode}/${offer.supplierOfferCode}`]) {
            const [canonicalProductCode, canonicalPackageCode, canonicalName] = EXACT_EXISTING_TARGETS[`${offer.supplierProductCode}/${offer.supplierOfferCode}`];
            const canonicalPackage = canonicalPackageByKey.get(`${canonicalProductCode}/${canonicalPackageCode}`);
            if (!canonicalPackage) throw new Error(`Reviewed canonical target is missing: ${canonicalProductCode}/${canonicalPackageCode}`);
            disposition = "MAPPED_EXISTING_CANONICAL";
            reasonCode = "EXACT_EXISTING_CANONICAL_REVIEWED";
            const lock = sourceLock({ offer, product, availability: observedAvailability });
            proposedMappings.push({
                supplierCatalogOfferId: id(offer), supplierCode: supplier.supplierCode,
                supplierProductCode: offer.supplierProductCode, supplierOfferCode: offer.supplierOfferCode,
                supplierOfferName: offer.supplierOfferName, canonicalProductCode, canonicalPackageCode,
                canonicalPackageId: id(canonicalPackage), canonicalPackageName: canonicalPackage.name,
                reviewedExpectedName: canonicalName, region: "TH", expectedSource: lock
            });
        } else {
            disposition = "REVIEW_REQUIRED";
            const reason = reviewReason({ product, offer, coverage });
            reasonCode = decision?.reasonCode || reason.code;
            missingEvidence = decision?.reviewNotes || reason.missing;
            if (!decision) {
                const lock = sourceLock({ offer, product, availability: observedAvailability });
                proposedDecisions.push({
                    supplierCatalogOfferId: id(offer), supplierCode: supplier.supplierCode,
                    supplierProductCode: offer.supplierProductCode, supplierOfferCode: offer.supplierOfferCode,
                    decisionType: "DEFER_REVIEW", decisionStatus: "DEFERRED", reasonCode,
                    reviewNotes: missingEvidence, expectedSource: lock
                });
            }
        }
        rows.push({
            supplierCode: supplier.supplierCode, catalogNamespace: offer.catalogNamespace,
            supplierProductCode: offer.supplierProductCode, supplierProductName: product.displayName,
            supplierOfferCode: offer.supplierOfferCode, supplierOfferName: offer.supplierOfferName,
            supplierMarketCode: product.supplierMarketCode, marketClassification: coverage.state,
            marketEvidenceCode: coverage.evidenceCode, restrictions: product.restrictions || [],
            requiredFields: product.requiredFields || [], cost: offer.supplierCost || null,
            availability: observedAvailability ? { state: observedAvailability.state, evidenceCode: observedAvailability.evidenceCode, coverageComplete: observedAvailability.coverageComplete === true } : { state: "UNKNOWN", evidenceCode: "INSUFFICIENT_EVIDENCE", coverageComplete: false },
            target, disposition, reasonCode, exactEvidenceStillMissing: missingEvidence,
            mapping: mapping ? { mappingId: id(mapping), canonicalProductCode: mapping.productCode, canonicalPackageCode: mapping.packageCode, region: mapping.region, enabled: mapping.enabled, productionRole: mapping.productionRole } : null,
            currentDecisionId: decision ? id(decision) : ""
        });
    }
    rows.sort(sortIdentity); proposedDecisions.sort(sortIdentity);
    const targetRows = rows.filter(x => x.target);
    const productsInTarget = new Set(targetRows.map(x => `${x.supplierCode}/${x.supplierProductCode}`));
    const count = (list, predicate) => list.filter(predicate).length;
    const bySupplier = {};
    for (const supplierCode of ["FAZERCARDS", "WONDD"]) {
        const own = rows.filter(x => x.supplierCode === supplierCode), targetOwn = own.filter(x => x.target);
        bySupplier[supplierCode] = {
            products: new Set(own.map(x => x.supplierProductCode)).size, offers: own.length,
            globalOffers: count(own, x => x.marketClassification === "ELIGIBLE_GLOBAL"),
            asiaOffers: count(own, x => x.marketClassification === "ELIGIBLE_ASIA"),
            asiaCountryOffers: count(own, x => x.marketClassification === "ELIGIBLE_ASIA_COUNTRY"),
            nonTargetOffers: count(own, x => x.marketClassification === "NON_TARGET_MARKET"),
            unknownMarketOffers: count(own, x => x.marketClassification === "UNKNOWN_MARKET"),
            unsupportedOffers: count(own, x => x.marketClassification === "UNSUPPORTED"),
            targetProducts: new Set(targetOwn.map(x => x.supplierProductCode)).size, targetOffers: targetOwn.length,
            mappedExistingCanonical: count(targetOwn, x => x.disposition === "MAPPED_EXISTING_CANONICAL"),
            createdCanonicalAndMapped: 0, reviewRequired: count(targetOwn, x => x.disposition === "REVIEW_REQUIRED"), excludedUnsupported: count(targetOwn, x => x.disposition === "EXCLUDED_UNSUPPORTED")
        };
    }
    const summary = {
        targetProducts: productsInTarget.size, targetOffers: targetRows.length,
        mappedExistingCanonical: count(targetRows, x => x.disposition === "MAPPED_EXISTING_CANONICAL"),
        createdCanonicalAndMapped: 0, reviewRequired: count(targetRows, x => x.disposition === "REVIEW_REQUIRED"),
        excludedUnsupported: count(targetRows, x => x.disposition === "EXCLUDED_UNSUPPORTED"),
        unaccountedTargetOffers: count(targetRows, x => !["MAPPED_EXISTING_CANONICAL", "CREATED_CANONICAL_AND_MAPPED", "REVIEW_REQUIRED", "EXCLUDED_UNSUPPORTED"].includes(x.disposition)),
        proposedMappingCreates: proposedMappings.length, proposedDecisionCreates: proposedDecisions.length + proposedMappings.length, bySupplier
    };
    const body = {
        artifactType: "CURRENT_SUPPLIER_MASTER_CATALOG_RECONCILIATION_PLAN", schemaVersion: 1,
        generatedAt: new Date().toISOString(), mode: "EXACT_REVIEWED_PLAN_NO_AUTOMATIC_MAPPING",
        sourceArtifacts: {
            FAZERCARDS: { sourceSetHash: require("../../docs/fazercards-current-master-catalog-source-2026-08-31.json").sourceSetHash },
            WONDD: { sourceSetHash: require("../../docs/wondd-current-master-catalog-source-2026-08-31.json").sourceSetHash }
        },
        protectedState: { catalogProducts: protectedState[0], catalogPackages: protectedState[1], mappings: protectedState[2], publications: protectedState[3], pricingPolicies: protectedState[4] },
        summary, proposedMappings, proposedDecisions, offers: rows,
        safety: { canonicalProductWrites: 0, canonicalPackageWrites: 0, mappingWrites: proposedMappings.length, mappingEnabledTrueWrites: 0, mappingProductionRoleWrites: 0, pricingWrites: 0, publicationWrites: 0, routingRoleWrites: 0, orderWrites: 0, paymentWrites: 0, fulfillmentCalls: 0, supplierTransactionalCalls: 0 }
    };
    body.reviewedSourceSetHash = sha(rows);
    body.planHash = sha({ schemaVersion: body.schemaVersion, sourceArtifacts: body.sourceArtifacts, protectedState: body.protectedState, summary: body.summary, proposedMappings: body.proposedMappings, proposedDecisions: body.proposedDecisions });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(body, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ result: "PASS", output: OUTPUT, planHash: body.planHash, reviewedSourceSetHash: body.reviewedSourceSetHash, summary }, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ result: "ABORTED", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
