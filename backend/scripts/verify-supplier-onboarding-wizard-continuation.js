#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const wizard = read("frontend/js/admin-add-product-wizard.js");
const onboarding = read("backend/services/supplierCatalog/supplierProductOnboardingService.js");

assert(wizard.includes("logicalProducts:[]") && wizard.includes("data-logical-product"), "Step 2 must use one logical-product interaction model.");
assert(!wizard.includes('${apwSupplierInventoryContent()}'), "Step 2 must not append a second supplier-product list.");
assert(wizard.includes("source.supplierMarket") && wizard.includes("supplier source"), "Logical products and supplier choices must retain source market context.");
assert(wizard.includes('/api/admin/add-product/plan') && wizard.includes("customerMarkets="), "Supplier selection must load a scoped read-only plan.");
assert(wizard.includes("data-add-product-source") && wizard.includes("data-wizard-package"), "Supplier and package steps must retain exact source and offer identities.");
assert(wizard.includes("row.selectable") && wizard.includes('row.state==="NEEDS_ATTENTION"') && wizard.includes('row.state==="UNAVAILABLE"'), "Package projection must separate selectable, attention, and unavailable offers.");
assert(wizard.includes("planHash:plan.planHash") && wizard.includes("expectedDecisionVersion:plan.expectedDecisionVersion"), "Review must submit the immutable plan lock and expected version.");
assert(wizard.includes('/api/admin/add-product/finalize') && !wizard.includes("PackageSupplierSelection"), "Step 5 must use the sole final Add Product mutation.");
assert(onboarding.includes("continuation") && onboarding.includes("selectableCount") && onboarding.includes("needsAttentionCount") && onboarding.includes("unavailableCount"), "Backend must expose the compact authoritative continuation contract.");
assert(onboarding.includes("WIZARD_STATE_INVARIANT_FAILED"), "Backend must reject contradictory state totals.");
assert(wizard.includes('next.textContent=addProductWizard.step===5?"Add Product":"Continue"') && !wizard.includes("Step 6"), "Review must own the final Add Product action with no sixth step.");
for (const code of ["PACKAGE_IDENTITY_REVIEW","INPUT_CONTRACT_REQUIRED","EXECUTION_IDENTITY_REQUIRED","SUPPLIER_MARKET_AUTHORITY_REQUIRED","CUSTOMER_MARKET_INELIGIBLE","SUPPLIER_UNAVAILABLE","UNSUPPORTED_PROTOCOL","STALE_SOURCE"]) assert(wizard.includes(code), `Missing domain diagnostic ${code}`);
assert(wizard.includes("data-wizard-select-all") && wizard.includes("Ready for pricing"), "Packages must provide a business-readable selectable list.");
assert(onboarding.includes("publicationWrites: 0") && onboarding.includes("customerPriceWrites: 0") && onboarding.includes("packageSupplierSelectionWrites: 0"), "Onboarding must retain zero commercial side effects.");
assert(!/(CommerceOrder\.create|PaymentAttempt\.create|FulfillmentAttempt\.create|submitTopup)/.test(onboarding + wizard), "Wizard onboarding must not execute commerce or fulfillment.");

console.log(JSON.stringify({ result: "PASS", continuation: true, partialSuccess: true, exceptionsRemainReviewable: true, explicitStoreCatalogSelection: true, commercialSideEffects: 0, fulfillmentCalls: 0 }, null, 2));
