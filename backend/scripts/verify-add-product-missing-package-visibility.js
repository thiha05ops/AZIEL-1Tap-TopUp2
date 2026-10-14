#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { makePlan } = require("../services/supplierCatalog/addProductFinalizationService");

const now = new Date("2026-10-14T00:00:00.000Z");
const eligibility = { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "fixture", verifiedAt: now, version: 1 };

function fixture({ supplierCode, supplierProductCode, ordinaryOfferCode, conflictOfferCode, conflictProductCode, conflictPackageCode }) {
    const supplier = { _id: `supplier-${supplierCode}`, supplierCode, name: supplierCode };
    const product = { _id: `product-${supplierProductCode}`, supplierId: supplier._id, catalogNamespace: `${supplierCode}_CATALOG`, supplierProductCode, supplierMarketCode: "GLOBAL", displayName: supplierProductCode, supportState: "SUPPORTED", rawSnapshotHash: "a".repeat(64), sourceRevision: "product-revision", lastChangedAt: now, restrictions: [], metadata: { fulfillmentEligibility: eligibility }, normalizedInputContract: { authority: "VERIFIED_FIXTURE", noCustomerInput: true, fields: [] } };
    const offer = (code, name) => ({ _id: `${supplierProductCode}-${code}`, supplierId: supplier._id, supplierCatalogProductId: product._id, catalogNamespace: product.catalogNamespace, supplierProductCode, supplierOfferCode: code, supplierOfferName: name, catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", rawSnapshotHash: "b".repeat(64), sourceRevision: `${code}-revision`, lastChangedAt: now, normalizedSemantics: { canonicalCode: code }, supplierCost: { amount: 1, currency: supplierCode === "WONDD" ? "THB" : "USD", observedAt: now } });
    const ordinary = offer(ordinaryOfferCode, "Ordinary package"), conflict = offer(conflictOfferCode, "Weekly Pass");
    const availability = [ordinary, conflict].map(row => ({ supplierCatalogOfferId: row._id, state: "AVAILABLE", coverageComplete: true, evidenceCode: "FIXTURE", observedAt: now }));
    const mapping = { _id: `${supplierProductCode}-conflict-mapping`, supplierId: supplier._id, supplierCode, supplierCatalogOfferId: conflict._id, supplierProductCode, supplierPackageCode: conflictOfferCode, productCode: conflictProductCode, packageCode: conflictPackageCode, region: "GLOBAL", enabled: false, productionRole: "DISABLED", archivedAt: null, fulfillmentEligibility: eligibility };
    return { product, supplier, offers: [ordinary, conflict], availability, mappings: [mapping], canonicalMappings: [], productCode: "mlbb", canonical: { _id: "canonical-mlbb", productCode: "mlbb", name: "Mobile Legends (Global)", metadata: {} }, packages: [], selection: null, mappedCodes: [conflictProductCode], authorityCode: "", mappingTargetProducts: [], mappingTargetPackages: [] };
}

for (const scenario of [
    { label: "FazerCards Global Weekly Pass", supplierCode: "FAZERCARDS", supplierProductCode: "mobile_legends_global", ordinaryOfferCode: "86_diamonds", conflictOfferCode: "weekly_pass", conflictProductCode: "mlbb-twilight-weekly-pass", conflictPackageCode: "MLBB-WEEKLY.PASS" },
    { label: "WonDD service 9622", supplierCode: "WONDD", supplierProductCode: "9622", ordinaryOfferCode: "9622-86", conflictOfferCode: "9622-weekly", conflictProductCode: "mlbb-twilight-weekly-pass", conflictPackageCode: "MLBB-WEEKLY.PASS" }
]) {
    const plan = makePlan(fixture(scenario), { productCode: "mlbb", customerMarkets: ["TH", "MM"] });
    assert.strictEqual(plan.offerCounts.total, 2, `${scenario.label}: every native offer must remain in the plan`);
    assert.strictEqual(plan.offerCounts.selectable, 1);
    assert.strictEqual(plan.offerCounts.blocked, 1);
    const blocked = plan.offers.find(row => row.supplierOfferCode === scenario.conflictOfferCode);
    assert(blocked, `${scenario.label}: conflicted native offer must be visible`);
    assert.strictEqual(blocked.state, "NEEDS_ATTENTION");
    assert.strictEqual(blocked.selectable, false);
    assert.strictEqual(blocked.primaryBlocker, "EXISTING_MAPPING_TARGET_CONFLICT");
    assert.strictEqual(blocked.ownerReviewRequired, true);
    assert.deepStrictEqual({ productCode: blocked.currentLink.productCode, packageCode: blocked.currentLink.packageCode, canonicalProductExists: blocked.currentLink.canonicalProductExists, canonicalPackageExists: blocked.currentLink.canonicalPackageExists }, { productCode: scenario.conflictProductCode, packageCode: scenario.conflictPackageCode, canonicalProductExists: false, canonicalPackageExists: false });
}

const wizard = fs.readFileSync(path.join(__dirname, "../../frontend/js/admin-add-product-wizard.js"), "utf8");
assert(wizard.includes("native offer"));
assert(wizard.includes("selectable ·"));
assert(wizard.includes("blocked. Available packages"));
assert(wizard.includes("Existing canonical mapping target"));
assert(wizard.includes("canonicalProductExists"));
assert(wizard.includes("canonicalPackageExists"));
assert(wizard.includes("OWNER review required"));
assert(!/mappingEvidence[\s\S]*data-wizard-package/.test(wizard.slice(wizard.indexOf("mappingEvidence"), wizard.indexOf("apwBody().innerHTML"))), "blocked mapping evidence must not add a selection input");

console.log(JSON.stringify({ result: "PASS", scenarios: 2, nativeOffersVisible: 4, selectable: 2, mappingConflictsBlocked: 2, ownerReviewRequired: 2, mappingWrites: 0, selectionWrites: 0, pricingWrites: 0, supplierCalls: 0 }, null, 2));
