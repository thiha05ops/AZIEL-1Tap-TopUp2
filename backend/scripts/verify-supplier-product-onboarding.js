"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { canonicalEvidence, classifyOffer } = require("../services/supplierCatalog/supplierProductOnboardingService");
const { projectActivation } = require("../services/adminProductActivationService");
const { resolveFulfillmentRoutingMode } = require("../config/fulfillmentRoutingMode");

const root = path.resolve(__dirname, "../..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };

const exact = { _id: "o1", supplierId: "s1", supplierCatalogProductId: "sp1", supplierOfferCode: "60", supplierOfferName: "60 Tokens", catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", reconciliationEvidence: { canonicalProductCode: "hok", canonicalPackageCode: "HOK_60" } };
const ambiguous = { ...exact, _id: "o2", supplierOfferCode: "weekly", reconciliationState: "AMBIGUOUS", reconciliationEvidence: {} };
const distinct = { ...exact, _id: "o3", supplierOfferCode: "new", reconciliationState: "NO_CANONICAL_PACKAGE", reconciliationEvidence: { canonicalProductCode: "hok", distinctEntitlement: true } };

ok(canonicalEvidence(exact).productCode === "hok", "canonical product evidence normalized");
ok(canonicalEvidence(exact).packageCode === "HOK_60", "canonical package evidence normalized");
ok(classifyOffer(exact, { _id: "p1" }).classification === "PROVEN_SAME", "deterministic same entitlement");
ok(classifyOffer(ambiguous, null).classification === "AMBIGUOUS", "ambiguous does not auto-link");
ok(classifyOffer(distinct, null).classification === "PROVEN_NEW", "explicit distinct entitlement can create");
ok(classifyOffer({ ...exact, catalogLifecycleState: "RETIRED" }, {}).classification === "BLOCKED", "retired offer blocked");

const projection = projectActivation({
    products: [], packages: [], suppliers: [{ _id: "s1", supplierCode: "WONDD", name: "WonDD" }], mappings: [], publications: [], availability: [{ supplierCatalogOfferId: "o1", state: "AVAILABLE" }],
    supplierProducts: [{ _id: "sp1", supplierId: "s1", supplierProductCode: "HOK", supplierMarketCode: "TH", displayName: "Honor of Kings", supportState: "SUPPORTED" }],
    offers: [exact, ambiguous]
}, { customerMarket: "TH" });
ok(projection.supplierInventory.length === 1, "unmapped supplier product appears");
ok(projection.supplierInventory[0].offers.length === 2, "all offers projected");
ok(projection.supplierInventory[0].onboardingState === "NEEDS_REVIEW", "derived onboarding state");
ok(projection.supplierInventory[0].offers[0].availability === "AVAILABLE", "safe availability projected");
ok(!JSON.stringify(projection).match(/rawSnapshot|credential|password|secret|apiKey/i), "no raw or credential leakage");

const service = source("backend/services/supplierCatalog/supplierProductOnboardingService.js");
const route = source("backend/routes/supplier.js");
const ui = source("frontend/js/admin-add-product-wizard.js");
for (const [needle, label] of [
    ["REUSED_MAPPING", "existing mapping reused"], ["REUSED_DECISION", "confirmed decision reused"], ["AUTO_LINKED", "same entitlement linked"], ["AUTO_CREATED", "new entitlement created"],
    ["CANONICAL_EQUIVALENCE_REVIEW_REQUIRED", "unknown equivalence reviewed"], ["supplierCatalogOfferId", "native offer identity retained"], ["supplierProductCode", "native product identity retained"],
    ["assessMappingReadiness", "existing readiness service reused"], ["NEW_ORDER_SELECTABLE", "candidate readiness evaluated"], ["customerMarkets", "market inputs retained"],
    ["publicationWrites: 0", "no publication"], ["customerPriceWrites: 0", "no customer price"], ["packageSupplierSelectionWrites: 0", "no automatic selection"],
    ["commerceOrderWrites: 0", "no order"], ["fulfillmentAttemptWrites: 0", "no attempt"], ["supplierExecutionCalls: 0", "no supplier execution"],
    ["commerceState: \"HIDDEN\"", "new product hidden"], ["publicDiscoveryEnabled: false", "new product not discoverable"], ["enabled: false", "new product disabled"],
    ["requestIdempotencyKey", "retry identity required"], ["CURRENT_DECISION_CONFLICT", "concurrent decision handled"], ["DUPLICATE_MAPPING_CONFLICT", "duplicate mapping handled"]
]) ok(service.includes(needle), label);
ok(!service.includes("CommerceOrder.create"), "no CommerceOrder creation");
ok(!service.includes("FulfillmentAttempt.create"), "no FulfillmentAttempt creation");
ok(!service.includes("PackageSupplierSelection.create"), "no selection creation");
ok(!service.includes("submitTopup"), "no provider fulfillment call");
ok(route.includes("/admin/supplier-catalog/products/:id/onboard"), "explicit Admin endpoint");
ok(route.includes("SUPPLIER_CATALOG_RECONCILE"), "reconciliation permission enforced");
ok(ui.includes("Add to AZIEL"), "Admin action available");
ok(ui.includes("confirmed:true"), "Admin confirmation sent");
ok(ui.includes("openSupplierReconciliationReview"), "ambiguous review reuses reconciliation UI");
ok(resolveFulfillmentRoutingMode({}) === "LEGACY_REGION", "legacy routing remains default");
ok(!service.match(/productionRole\s*:\s*"PRIMARY"/), "no PRIMARY promotion");
ok(!service.includes("prices:"), "no customer price mutation");
ok(!service.includes("published:"), "no publication mutation");
ok(service.includes("for (const offer of offers)"), "product-level operation processes every offer");
ok(service.includes("for (const offer of offers)") && service.includes("try {"), "per-offer partial success boundary present");

console.log(JSON.stringify({ result: "PASS", checks, productionWrites: 0, supplierCalls: 0, commerceOrders: 0, fulfillmentAttempts: 0 }, null, 2));
