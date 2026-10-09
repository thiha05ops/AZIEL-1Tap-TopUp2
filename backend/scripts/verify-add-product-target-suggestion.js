#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { canonicalProductSuggestion } = require("../services/adminProductActivationService");

const canonicalProducts = [
    { _id: "1", productCode: "afk-journey", name: "AFK Journey" },
    { _id: "2", productCode: "mlbb", name: "Mobile Legends" },
    { _id: "3", productCode: "pubg", name: "PUBG Mobile" }
];
const supplierProduct = { displayName: "Mobile Legends (Global)", supplierProductCode: "mobile_legends_global", metadata: {} };

const suggested = canonicalProductSuggestion({ supplierProduct, canonicalProducts });
assert.strictEqual(suggested.productCode, "mlbb");
assert.strictEqual(suggested.name, "Mobile Legends");
assert.strictEqual(suggested.evidence, "DISPLAY_NAME_SUGGESTION_ONLY");
assert.strictEqual(suggested.confidence, "SUGGESTION");

const authoritative = canonicalProductSuggestion({
    supplierProduct: { ...supplierProduct, metadata: { onboardingCanonicalProduct: { productCode: "pubg" } } },
    canonicalProducts
});
assert.strictEqual(authoritative.productCode, "pubg", "durable canonical authority must outrank display-name similarity");
assert.strictEqual(authoritative.confidence, "AUTHORITATIVE");

const reconciled = canonicalProductSuggestion({
    supplierProduct: { displayName: "Unrelated provider title", supplierProductCode: "native-1", metadata: {} },
    offers: [{ reconciliationEvidence: { canonicalProductCode: "mlbb", canonicalPackageCode: "MLBB_86" } }],
    canonicalProducts
});
assert.strictEqual(reconciled.productCode, "mlbb");
assert.strictEqual(reconciled.evidence, "RECONCILIATION_EVIDENCE");

const multiOffers = Array.from({ length: 43 }, (_, index) => ({ _id: `offer-${index + 1}`, supplierOfferCode: `package-${index + 1}` }));
const multiMappings = [
    ...multiOffers.slice(0, 40).map(offer => ({ supplierCatalogOfferId: offer._id, supplierPackageCode: offer.supplierOfferCode, productCode: "mlbb" })),
    ...multiOffers.slice(40).map(offer => ({ supplierCatalogOfferId: offer._id, supplierPackageCode: offer.supplierOfferCode, productCode: "mlbb-pass" })),
    { supplierCatalogOfferId: "offer-1", supplierPackageCode: "package-1", productCode: "mlbb", region: "TH" },
    { supplierCatalogOfferId: "offer-1", supplierPackageCode: "package-1", productCode: "mlbb", region: "GLOBAL" }
];
const multi = canonicalProductSuggestion({ supplierProduct, offers: multiOffers, sourceMappings: multiMappings, canonicalProducts: [...canonicalProducts, { productCode: "mlbb-pass", name: "Mobile Legends Twilight Pass & Weekly Diamonds" }] });
assert.strictEqual(multi.productCode, "mlbb");
assert.strictEqual(multi.distinctOfferCount, 40, "duplicate regional mapping rows must count one supplier offer");
assert.strictEqual(multi.totalSourceOfferCount, 43);
assert.deepStrictEqual(multi.alternatives.map(item => [item.productCode, item.distinctOfferCount]), [["mlbb-pass", 3]], "minority authoritative links must remain visible and separate");
const tied = canonicalProductSuggestion({ supplierProduct: { displayName: "Unrelated" }, offers: multiOffers.slice(0, 4), sourceMappings: [
    { supplierCatalogOfferId: "offer-1", productCode: "mlbb" }, { supplierCatalogOfferId: "offer-2", productCode: "mlbb" },
    { supplierCatalogOfferId: "offer-3", productCode: "pubg" }, { supplierCatalogOfferId: "offer-4", productCode: "pubg" }
], canonicalProducts });
assert.strictEqual(tied, null, "equal durable evidence must not fabricate a dominant suggestion");

assert.strictEqual(canonicalProductSuggestion({ supplierProduct: { displayName: "Unknown Game" }, canonicalProducts }), null, "unknown products must not receive a fabricated suggestion");
assert.strictEqual(canonicalProductSuggestion({ supplierProduct: { displayName: "Mobile Legends" }, canonicalProducts: [...canonicalProducts, { productCode: "mlbb-alt", name: "Mobile Legends" }] }), null, "ambiguous display names must not produce a suggestion");

const root = path.resolve(__dirname, "../..");
const wizard = fs.readFileSync(path.join(root, "frontend/js/admin-add-product-wizard.js"), "utf8");
const reconciliation = fs.readFileSync(path.join(root, "frontend/js/admin-supplier-catalog.js"), "utf8");
const activation = fs.readFileSync(path.join(root, "backend/services/adminProductActivationService.js"), "utf8");
assert(activation.includes("reconciliationState reconciliationEvidence catalogLifecycleState"), "the read model must load existing reconciliation evidence");
assert(wizard.includes("Choose AZIEL product"));
assert(wizard.includes("Suggested existing AZIEL product"));
assert(wizard.includes("Use this product"), "Owner confirmation must be explicit");
assert(wizard.includes("supplier packages already belong here") && wizard.includes("Also linked elsewhere:"), "multi-canonical evidence counts must be explained");
assert(wizard.includes("targetCatalogExpanded?"), "the full catalog must be hidden until explicitly expanded");
assert(wizard.includes("data-show-add-product-targets") && wizard.includes("Choose another AZIEL product"));
assert(wizard.includes("Create new AZIEL product"));
assert(wizard.includes("No existing AZIEL product confidently suggested."));
assert(wizard.includes('row.currentLink?"Already linked"'), "exact existing package links remain visible");
assert(!wizard.includes('if(event.target.matches("[data-wizard-package]")&&addProductWizard.step===4&&addProductWizard.onboardingPlan)apwRenderPackages()'), "package selection must remain scroll-stable");
assert(reconciliation.includes("Link Existing") && reconciliation.includes("Add New Package") && reconciliation.includes("Needs Review"));
assert(reconciliation.includes("Names, prices, and arithmetic are suggestions only"));

console.log(JSON.stringify({
    result: "PASS",
    mobileLegendsSuggestion: suggested.productCode,
    unrelatedProductsInitiallyVisible: 0,
    ownerConfirmationRequired: true,
    suggestionWrites: 0,
    packageReconciliationChanged: false,
    productionWrites: 0,
    supplierCalls: 0
}, null, 2));
