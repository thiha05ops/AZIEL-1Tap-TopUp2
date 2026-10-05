#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const wizard = fs.readFileSync(path.join(root, "frontend/js/admin-add-product-wizard.js"), "utf8");
const onboardingVerifier = fs.readFileSync(path.join(root, "backend/scripts/verify-supplier-onboarding-wizard-continuation.js"), "utf8");

assert(wizard.includes('inventoryStatus:"idle"') && wizard.includes('inventoryError:""'), "Wizard must own explicit supplier inventory request state.");
assert(wizard.includes('inventoryStatus="loading"') && wizard.indexOf('inventoryStatus="loading"') < wizard.indexOf('await adminFetch("/api/admin/product-activation?customerMarket=TH")'), "First open must enter loading before the request starts.");
assert(wizard.includes('inventoryStatus="loaded"') && wizard.includes('if(addProductWizard.step===2)apwRenderProducts()'), "Authoritative first response must re-render Product when already visible.");
assert(wizard.includes('inventoryStatus==="loading"||addProductWizard.inventoryStatus==="idle"') && wizard.includes("Loading products"), "Uninitialized/loading product discovery must not render true-empty.");
assert(wizard.includes("No products match your search."), "Loaded zero-result state must retain the real empty message.");
assert(wizard.includes('inventoryStatus="error"') && wizard.includes("Supplier catalog could not be loaded."), "Request failure must have an explicit non-empty failure state.");
assert(wizard.includes("if(id!==addProductWizard.requestId)return") && wizard.includes("closeAddProductWizard(){addProductWizard.requestId+=1"), "Stale catalog and closed-session responses must not overwrite the current wizard session.");
assert(wizard.includes('inventorySearch:"",inventorySupplier:""') && wizard.match(/function apwReset\(\).*inventorySearch:"",inventorySupplier:""/), "Every modal session must reset catalog filters deterministically.");
assert(wizard.includes('labels=["Regions","Product","Supplier","Packages","Review"]'), "Wizard must retain exactly five named steps.");
assert(!wizard.includes("Step 6") && !wizard.includes("step===6"), "Wizard must not introduce Step 6.");
assert(wizard.includes('next.textContent=addProductWizard.step===5?"Add Product":"Continue"'), "Review must remain the final Add Product action.");
assert(wizard.includes('/api/admin/store-catalog-selections') && wizard.includes('method:"POST"'), "Final save must remain explicit StoreCatalogSelection.");
assert(onboardingVerifier.includes("partialSuccess") && onboardingVerifier.includes("exceptionsRemainReviewable"), "HOK partial-success continuation coverage must remain active.");
assert(!/(PackageSupplierSelection|productionRole\s*=(?!=)|submitTopup|CommerceOrder\.create|PaymentAttempt\.create|FulfillmentAttempt\.create)/.test(wizard), "First-open fix must not add commercial, routing, or fulfillment side effects.");

console.log(JSON.stringify({ result: "PASS", firstOpen: "loading-to-data", trueEmptyAfterLoad: true, failureDistinct: true, staleResponseProtected: true, reopenDeterministic: true, wizardSteps: 5, step6: false, storeCatalogSelectionFinal: true }, null, 2));
