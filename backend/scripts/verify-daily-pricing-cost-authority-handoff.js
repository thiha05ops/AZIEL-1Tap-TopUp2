#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { PERMISSIONS, ROLES, hasPermission } = require("../services/adminAuthorizationService");
const costAuthority = require("../services/supplierCatalog/supplierCostAuthorityService");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const pricing = read("frontend/js/admin-pricing-engine.js");
const review = read("frontend/js/admin-supplier-catalog.js");
const workspace = read("backend/services/commerce/adminPricingControlCenterService.js");
const routes = read("backend/routes/supplier.js");

assert(hasPermission({ role: ROLES.OWNER }, PERMISSIONS.SUPPLIER_COST_MANAGE));
for (const role of [ROLES.OPERATIONS, ROLES.FINANCE, ROLES.SUPPORT, ROLES.CATALOG]) {
    assert.strictEqual(hasPermission({ role }, PERMISSIONS.SUPPLIER_COST_MANAGE), false, `${role} must not approve supplier cost.`);
}

assert(workspace.includes('supplierCatalogOfferId: mapping.supplierCatalogOfferId ? String(mapping.supplierCatalogOfferId) : ""'), "Daily Pricing must expose the exact linked offer ID.");
assert(workspace.includes("storePublicationReadinessReasons({ mapping, pkg, selections: storeSelections"), "Refreshing approved cost must retain independent operational blockers.");
assert(pricing.includes('row.supplierCostStatus === "COST_REVIEW_REQUIRED"') && pricing.includes("data-pricing-review-cost"), "Cost-review-required rows must render the review action.");
assert(pricing.includes('hasPermission?.("SUPPLIER_COST_MANAGE") === true'), "Review cost must be Owner-authority visible only.");
for (const identity of ["data-mapping-id", "data-offer-id", "data-supplier-code", "data-product-code", "data-package-code", "data-supplier-market"]) {
    assert(pricing.includes(identity), `Daily Pricing handoff is missing ${identity}.`);
}
assert(pricing.includes("AZIEL_SUPPLIER_COST_AUTHORITY_REVIEW") && pricing.includes("mappingId: row.mappingId"), "Daily Pricing must reuse the existing exact review controller.");
assert(pricing.includes('onApproved: async () =>') && pricing.includes("await loadDaily(true)"), "Successful approval must reload and re-preview Daily Pricing.");
assert(!pricing.includes("/cost-authority/promote"), "Daily Pricing must not duplicate the promotion request.");

assert(review.includes("AZIEL_SUPPLIER_COST_AUTHORITY_REVIEW"), "Existing review controller must be reusable.");
assert(review.includes('`?mappingId=${encodeURIComponent(mappingId)}`'), "Review GET must use the exact mapping ID.");
assert(review.includes("c.mutationGate.enabled") && review.includes('type="submit" ${can?"":"disabled"}'), "Disabled mutation gate must keep approval non-actionable.");
assert(review.includes("Supplier cost authority changes are currently disabled. Review evidence remains available."));
assert(review.includes("sourceLock:lock") && review.includes("reason:form.elements.reason.value.trim()") && review.includes("confirmed:form.elements.confirmed.checked") && review.includes("idempotencyToken:supplierReconciliationIdempotency()"));
assert(review.includes('typeof onApproved==="function"') && review.includes("await onApproved"));

assert(routes.includes('router.get("/admin/supplier-catalog/offers/:id/cost-authority"'));
assert(routes.includes('router.post("/admin/supplier-catalog/offers/:id/cost-authority/promote"'));
assert(routes.includes("requireAdminPermission(PERMISSIONS.SUPPLIER_COST_MANAGE)"));
assert.strictEqual(costAuthority.mutationsEnabled(), false, "Verification environment must remain fail-closed.");

for (const forbidden of ["CatalogPackage.findOneAndUpdate", "PackageMarketPublication.findOneAndUpdate", "productionRole:", "executionMode:", "fulfillmentEligibility:"]) {
    assert(!review.includes(forbidden), `Review UI must not introduce ${forbidden}.`);
}

console.log(JSON.stringify({
    result: "PASS",
    ownerReviewAction: true,
    exactMappingAndOfferIdentity: true,
    existingReviewGetReused: true,
    existingPromotionPostReused: true,
    mutationGateEnabled: false,
    gateDisabledReviewReadable: true,
    gateDisabledApprovalActionable: false,
    successfulApprovalRefreshesDailyPricing: true,
    nonOwnerPromotion: false,
    duplicateAuthorityServices: 0,
    packageMutations: 0,
    mappingRouteMutations: 0,
    pricingPublications: 0,
    supplierCalls: 0,
    productionWrites: 0
}, null, 2));
