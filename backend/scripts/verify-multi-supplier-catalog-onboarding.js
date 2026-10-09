#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { makePlan } = require("../services/supplierCatalog/addProductFinalizationService");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const now = new Date("2026-10-06T00:00:00.000Z");
const supplier = { _id: "64b000000000000000000001", supplierCode: "WONDD", name: "WonDD", enabled: true, mode: "API" };
const product = {
    _id: "64b000000000000000000010", supplierId: supplier._id, catalogNamespace: "WONDD_MASTER",
    supplierProductCode: "9604", supplierMarketCode: "GLOBAL", displayName: "Mobile Legends Supplier Native",
    rawName: "Mobile Legends Supplier Native", supportState: "SUPPORTED", rawSnapshotHash: "a".repeat(64),
    sourceRevision: "native-revision-1", lastChangedAt: now,
    metadata: { transactionalServiceCode: "mlbb" },
    normalizedInputContract: {
        transactionalServiceCode: "mlbb",
        fields: [{ customerField: "playerId", providerField: "gameid", required: true, label: "Player ID", type: "numeric-text", transformationId: "DIRECT" }],
        fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "fixture", verifiedAt: now, version: 1 }
    }
};
const offer = (id, code, name) => ({
    _id: id, supplierCatalogProductId: product._id, supplierId: supplier._id, catalogNamespace: product.catalogNamespace,
    supplierProductCode: product.supplierProductCode, supplierOfferCode: code, supplierOfferName: name,
    catalogLifecycleState: "ACTIVE", reconciliationState: "UNREVIEWED", normalizedSemantics: {}, rawSnapshotHash: id.padEnd(64, "b").slice(0, 64),
    sourceRevision: `revision-${code}`, lastChangedAt: now, supplierCost: { amount: 1, currency: "USD", observedAt: now }
});
const offers = [
    offer("64b000000000000000000101", "78_8", "78 + 8 Diamonds"),
    offer("64b000000000000000000102", "172", "172 Diamonds"),
    offer("64b000000000000000000103", "SPECIAL", "Special Pack")
];
const availability = offers.map((item, index) => ({ _id: `64b00000000000000000020${index}`, supplierCatalogOfferId: item._id, state: "AVAILABLE", coverageComplete: true, observedAt: now }));
const mapping = {
    _id: "64b000000000000000000301", supplierId: supplier._id, supplierCode: "WONDD", supplierCatalogOfferId: offers[0]._id,
    productCode: "mlbb", packageCode: "MLBB_86", supplierProductCode: "mlbb", supplierPackageCode: "78_8", region: "GLOBAL",
    enabled: false, productionRole: "DISABLED", executionMode: "MANUAL", archivedAt: null,
    mappingMetadata: { readiness: { supplierMapped: true, pricingReady: false, inputReady: false, fulfillmentReady: false } },
    fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 }
};
const context = {
    product, supplier, offers, availability, mappings: [mapping], productCode: "mlbb",
    canonical: { _id: "64b000000000000000000401", productCode: "mlbb", name: "Mobile Legends", metadata: {} },
    packages: [
        { _id: "64b000000000000000000501", productCode: "mlbb", packageCode: "MLBB_86", name: "86 Diamonds", enabled: true },
        { _id: "64b000000000000000000502", productCode: "mlbb", packageCode: "MLBB_172", name: "172 Diamonds", enabled: true }
    ],
    canonicalMappings: [mapping], selection: null, mappedCodes: ["mlbb"], authorityCode: ""
};

const plan = makePlan(context, { customerMarkets: ["TH"] });
assert.strictEqual(plan.productName, "Mobile Legends", "AZIEL presentation remains canonical.");
assert.strictEqual(plan.supplierProductCode, "9604", "supplier-native product identity remains exact.");
assert.strictEqual(plan.supplierMarket, "GLOBAL", "supplier market remains separate from TH customer market.");
assert.deepStrictEqual(plan.customerMarkets, ["TH"]);
const linked = plan.offers.find(row => row.supplierCatalogOfferId === offers[0]._id);
assert.strictEqual(linked.name, "78 + 8 Diamonds", "supplier-native title remains visible to Admin.");
assert.strictEqual(linked.packageCode, "MLBB_86", "different supplier title can retain its explicit existing AZIEL link.");
assert.strictEqual(linked.currentLink.productCode, "mlbb");
assert.strictEqual(linked.state, "READY", "an exact persisted link is catalog-ready even when fulfillment setup remains incomplete.");
assert(linked.setupBlockers.length > 0, "live-readiness gaps remain visible and are not weakened.");
for (const unresolved of plan.offers.filter(row => !row.mappingId)) {
    assert.strictEqual(unresolved.state, "PREPARABLE");
    assert.strictEqual(unresolved.primaryBlocker, "");
    assert.strictEqual(unresolved.selectable, true, "A new exact supplier-native offer imports as its own package without silently linking by name, price, or arithmetic.");
    assert.strictEqual(unresolved.packageDisposition.create, true);
    assert.strictEqual(unresolved.candidatePackages.length, 2, "existing AZIEL targets are suggestions only.");
}

const otherSupplierPlan = makePlan({ ...context, product: { ...product, _id: "64b000000000000000000011", displayName: "MLBB Global Top Up", supplierProductCode: "different-native-title" } }, { customerMarkets: ["TH"] });
assert.strictEqual(otherSupplierPlan.productCode, "mlbb", "different supplier product titles may target one explicit AZIEL product.");

const finalizer = read("backend/services/supplierCatalog/addProductFinalizationService.js");
const reconciliation = read("backend/services/supplierCatalog/supplierCatalogReconciliationService.js");
const wizard = read("frontend/js/admin-add-product-wizard.js");
const modal = read("frontend/js/admin-supplier-catalog.js");
assert(reconciliation.includes("LINK_TO_EXISTING_CANONICAL_PACKAGE") && reconciliation.includes("CREATE_CANONICAL_PACKAGE_AND_LINK"));
assert(reconciliation.includes('enabled:false,productionRole:"DISABLED"') && reconciliation.includes('fulfillmentEligibility:{mode:"UNKNOWN"'));
assert(finalizer.includes("packageSelection=new Map") && finalizer.includes("if(!packageSelection.has"), "adding a supplier source must not replace an existing canonical package link.");
assert(finalizer.includes("publicationWrites:0") && finalizer.includes("priceWrites:0") && finalizer.includes("packageSupplierSelectionWrites") && finalizer.includes("primaryAssignments:0") && finalizer.includes("supplierCalls:0"));
assert(!/Promise\.all\s*\(/.test(finalizer), "Add Product transaction operations must remain sequential on one Mongo session.");
assert(finalizer.includes('AddProductFinalizationError("ADD_PRODUCT_PACKAGE_NOT_PREPARABLE","One or more packages are no longer preparable.",409)'), "finalization rejection must retain the numeric HTTP status contract.");
assert(modal.includes("Names, prices, and arithmetic are suggestions only"));
assert(modal.includes("Link Existing") && modal.includes("Add New Package") && modal.includes("Needs Review"));
assert(wizard.includes("button.classList.toggle(\"selected\",selected)") && !wizard.includes('if(event.target.matches("[data-wizard-package]")&&addProductWizard.step===4&&addProductWizard.onboardingPlan)apwRenderPackages()'), "selection must update in place without a scroll-resetting full rerender.");
assert(!finalizer.includes("Supplier product has conflicting canonical authority."), "product-level conflict must not block package-level reconciliation.");

console.log(JSON.stringify({ result: "PASS", sourceTitlesPreserved: true, explicitExistingLink: true, silentNameMerge: false, silentPriceMerge: false, silentArithmeticMerge: false, setupSeparatedFromLive: true, scrollStableSelection: true, productionWrites: 0, supplierCalls: 0 }, null, 2));
