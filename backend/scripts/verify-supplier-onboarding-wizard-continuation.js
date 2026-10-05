#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const wizard = read("frontend/js/admin-add-product-wizard.js");
const onboarding = read("backend/services/supplierCatalog/supplierProductOnboardingService.js");

assert(wizard.includes("onboardingSummary:null") && wizard.includes("onboardingExceptions:[]"), "Wizard must retain compact onboarding state.");
assert(wizard.includes("addProductWizard.step=3") && wizard.includes("Preparing exact supplier mappings"), "Supplier API onboarding must participate in the Supplier step.");
assert(wizard.includes("result.continuation") && wizard.includes("continuation.productCode") && wizard.includes("continuation.supplierMarket") && wizard.includes("continuation.supplierId"), "Continuation must populate canonical product and supplier/account context.");
assert(wizard.includes("await apwLoadDetail()"), "Onboarding must reload the existing product-activation projection.");
assert(wizard.includes("apwValidRows().some") && wizard.includes("addProductWizard.step=4") && wizard.includes("apwRenderPackages()"), "Valid prepared mappings must advance to Packages.");
assert(wizard.includes("apwOnboardingNotice()") && wizard.includes('row.state==="NEEDS_REVIEW"') && wizard.includes("data-onboard-review"), "Ambiguous exceptions must remain visible and reviewable without replacing the wizard.");
const onboardingHandler = wizard.slice(wizard.indexOf("async function apwOnboardSupplierProduct"), wizard.indexOf("async function apwLoadDetail"));
assert(!onboardingHandler.includes('document.getElementById("wizardNext").hidden=true'), "Onboarding must not terminate the wizard by hiding Continue.");
assert(wizard.includes("data-wizard-package") && wizard.includes("row.mappingId") && wizard.includes("row.packageCode"), "Packages must retain stable mapping and canonical package identities.");
assert(wizard.includes("addProductWizard.selected.size>0") && wizard.includes("apwRenderReview") && wizard.includes("mappingIds:mappings.map(row=>row.mappingId)"), "Review must receive explicitly selected mapping IDs.");
assert(wizard.includes('/api/admin/store-catalog-selections') && !wizard.includes("PackageSupplierSelection"), "Final save must remain explicit StoreCatalogSelection only.");
assert(onboarding.includes("continuation") && onboarding.includes("preparedCount") && onboarding.includes("exceptionCount"), "Backend must expose only the compact continuation contract.");
assert(onboarding.includes("publicationWrites: 0") && onboarding.includes("customerPriceWrites: 0") && onboarding.includes("packageSupplierSelectionWrites: 0"), "Onboarding must retain zero commercial side effects.");
assert(!/(CommerceOrder\.create|PaymentAttempt\.create|FulfillmentAttempt\.create|submitTopup)/.test(onboarding + wizard), "Wizard onboarding must not execute commerce or fulfillment.");

console.log(JSON.stringify({ result: "PASS", continuation: true, partialSuccess: true, exceptionsRemainReviewable: true, explicitStoreCatalogSelection: true, commercialSideEffects: 0, fulfillmentCalls: 0 }, null, 2));
