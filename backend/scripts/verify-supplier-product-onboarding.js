"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { WIZARD_STATES, canonicalEvidence, classifyOffer, wizardStateFor } = require("../services/supplierCatalog/supplierProductOnboardingService");
const { projectActivation } = require("../services/adminProductActivationService");
const { resolveFulfillmentRoutingMode } = require("../config/fulfillmentRoutingMode");
const { READINESS_MODES, assessMappingReadiness } = require("../services/supplierMappingReadinessService");
const { assessCanonicalEquivalenceProof } = require("../services/supplierCatalog/canonicalEquivalenceProofService");

const root = path.resolve(__dirname, "../..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };

const exact = { _id: "o1", supplierId: "s1", supplierCatalogProductId: "sp1", supplierProductCode: "HOK", supplierOfferCode: "60", supplierOfferName: "60 Tokens", catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", reconciliationEvidence: { canonicalProductCode: "hok", canonicalPackageCode: "HOK_60" } };
const ambiguous = { ...exact, _id: "o2", supplierOfferCode: "weekly", reconciliationState: "AMBIGUOUS", reconciliationEvidence: {} };
const distinct = { ...exact, _id: "o3", supplierOfferCode: "new", reconciliationState: "NO_CANONICAL_PACKAGE", reconciliationEvidence: { canonicalProductCode: "hok", distinctEntitlement: true } };
const supplierProduct = { _id: "sp1", supplierId: "s1", supplierProductCode: "HOK", supplierMarketCode: "TH" };
const canonicalProduct = { _id: "cp1", productCode: "hok" };
const canonicalPackage = { _id: "p1", productCode: "hok", packageCode: "HOK_60" };
const exactMapping = { _id: "m1", supplierId: "s1", supplierCatalogOfferId: "o1", supplierProductCode: "HOK", supplierPackageCode: "60", region: "TH", productCode: "hok", packageCode: "HOK_60", archivedAt: null };
const proof = overrides => assessCanonicalEquivalenceProof({ supplierProduct, offer: { ...exact, reconciliationState: "UNRECONCILED", reconciliationEvidence: {}, ...overrides?.offer }, mapping: { ...exactMapping, ...overrides?.mapping }, reconciliationDecision: overrides?.decision, canonicalProduct: overrides?.canonicalProduct === undefined ? canonicalProduct : overrides.canonicalProduct, canonicalPackages: overrides?.canonicalPackages === undefined ? [canonicalPackage] : overrides.canonicalPackages });

ok(canonicalEvidence(exact).productCode === "hok", "canonical product evidence normalized");
ok(canonicalEvidence(exact).packageCode === "HOK_60", "canonical package evidence normalized");
ok(classifyOffer(exact, { _id: "p1" }).classification === "PROVEN_SAME", "deterministic same entitlement");
ok(classifyOffer(ambiguous, null).classification === "AMBIGUOUS", "ambiguous does not auto-link");
ok(classifyOffer(distinct, null).classification === "PROVEN_NEW", "explicit distinct entitlement can create");
ok(classifyOffer({ ...exact, catalogLifecycleState: "RETIRED" }, {}).classification === "BLOCKED", "retired offer blocked");
ok(proof().proven && proof().source === "EXACT_MAPPING", "exact durable mapping proves equivalence despite incomplete mutable offer evidence");
ok(!proof().blockers.includes("CANONICAL_EQUIVALENCE_REVIEW_REQUIRED"), "exact mapping does not retain duplicate equivalence blocker");
const approvedLink = { _id: "d1", supplierCatalogOfferId: "o1", supplierIdentity: { supplierId: "s1", supplierProductCode: "HOK", supplierOfferCode: "60" }, decisionType: "LINK_TO_EXISTING_CANONICAL_PACKAGE", decisionStatus: "APPROVED", isCurrent: true, mappingId: "m1", canonicalProductId: "cp1", canonicalPackageId: "p1", canonicalProductCode: "hok", canonicalPackageCode: "HOK_60", sourceOfferHash: "" };
ok(proof({ decision: approvedLink }).proven && proof({ decision: approvedLink }).source === "RECONCILIATION_DECISION", "approved LINK decision is durable authority");
ok(proof({ decision: { ...approvedLink, decisionType: "CREATE_CANONICAL_PACKAGE_AND_LINK" } }).proven, "approved CREATE decision and exact created mapping remain proven");
for (const [overrides, blocker, label] of [
    [{ mapping: { supplierCatalogOfferId: "wrong" } }, "SUPPLIER_CATALOG_OFFER_IDENTITY_CONFLICT", "offer identity mismatch"],
    [{ mapping: { supplierId: "wrong" } }, "SUPPLIER_IDENTITY_CONFLICT", "supplier identity mismatch"],
    [{ mapping: { supplierProductCode: "WRONG" } }, "SUPPLIER_PRODUCT_IDENTITY_CONFLICT", "native product mismatch"],
    [{ mapping: { supplierPackageCode: "WRONG" } }, "SUPPLIER_OFFER_IDENTITY_CONFLICT", "native offer mismatch"],
    [{ canonicalProduct: null }, "CANONICAL_PRODUCT_MISSING", "canonical product missing"],
    [{ canonicalPackages: [] }, "CANONICAL_PACKAGE_MISSING", "canonical package missing"],
    [{ canonicalPackages: [{ ...canonicalPackage, packageCode: "WRONG" }] }, "CANONICAL_PACKAGE_IDENTITY_CONFLICT", "wrong canonical package"],
    [{ mapping: { archivedAt: new Date() } }, "MAPPING_ARCHIVED", "archived mapping"]
]) ok(!proof(overrides).proven && proof(overrides).blockers.includes(blocker), label + " fails closed");
ok(assessCanonicalEquivalenceProof({ supplierProduct: { ...supplierProduct, supplierMarketCode: "UNKNOWN" }, offer: { ...exact, reconciliationState: "UNRECONCILED", reconciliationEvidence: {} }, mapping: exactMapping, canonicalProduct, canonicalPackages: [canonicalPackage] }).proven, "UNKNOWN catalog market can coexist with exact TH mapping");
ok(assessCanonicalEquivalenceProof({ supplierProduct: { ...supplierProduct, supplierMarketCode: "GLOBAL" }, offer: { ...exact, reconciliationState: "UNRECONCILED", reconciliationEvidence: {} }, mapping: exactMapping, canonicalProduct, canonicalPackages: [canonicalPackage] }).proven, "GLOBAL catalog market can coexist with exact TH mapping");
ok(assessCanonicalEquivalenceProof({ supplierProduct: { ...supplierProduct, supplierMarketCode: "GLOBAL" }, offer: { ...exact, reconciliationState: "UNRECONCILED", reconciliationEvidence: {} }, mapping: { ...exactMapping, region: "MM" }, canonicalProduct, canonicalPackages: [canonicalPackage] }).proven, "GLOBAL catalog market can coexist with exact MM mapping");
ok(!proof({ canonicalPackages: [canonicalPackage, { ...canonicalPackage, _id: "p2" }] }).proven, "contradictory active canonical authority requires review");
ok(!proof({ decision: { ...approvedLink, sourceOfferHash: "stale" } }).proven && proof({ decision: { ...approvedLink, sourceOfferHash: "stale" } }).blockers.includes("RECONCILIATION_DECISION_SOURCE_STALE"), "stale decision requires review");
ok(proof({ decision: approvedLink, offer: { reconciliationState: "AMBIGUOUS" } }).proven, "mutable reconciliation state does not invalidate exact durable decision");
ok(!proof({ decision: approvedLink, offer: { supplierOfferCode: "changed" } }).proven, "native identity change invalidates decision");
ok(assessCanonicalEquivalenceProof({ supplierProduct, offer: exact, canonicalProduct, canonicalPackages: [canonicalPackage] }).proven, "strict authoritative offer evidence remains available without mapping");
ok(!assessCanonicalEquivalenceProof({ supplierProduct, offer: ambiguous, canonicalProduct, canonicalPackages: [] }).proven, "ambiguous unmapped offer requires review");
ok(!assessCanonicalEquivalenceProof({ supplierProduct, offer: { ...ambiguous, supplierOfferName: "60 Tokens", supplierCost: 1, normalizedSemantics: { denomination: 60 } }, canonicalProduct, canonicalPackages: [canonicalPackage] }).proven, "name, price, and numeric denomination are not equivalence authority");

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
const productAuthority = source("backend/services/supplierCatalog/supplierCanonicalProductAuthorityService.js");
const route = source("backend/routes/supplier.js");
const ui = source("frontend/js/admin-add-product-wizard.js");
const routePreparationSource = source("backend/services/supplierCatalog/supplierRoutePreparationService.js");
for (const [needle, label] of [
    ["REUSED_MAPPING", "existing mapping reused"], ["REUSED_DECISION", "confirmed decision reused"], ["AUTO_LINKED", "same entitlement linked"], ["AUTO_CREATED", "new entitlement created"],
    ["CANONICAL_EQUIVALENCE_REVIEW_REQUIRED", "unknown equivalence reviewed"], ["supplierCatalogOfferId", "native offer identity retained"], ["supplierProductCode", "native product identity retained"],
    ["assessMappingReadiness", "existing readiness service reused"], ["NEW_ORDER_SELECTABLE", "candidate readiness evaluated"], ["customerMarkets", "market inputs retained"],
    ["publicationWrites: 0", "no publication"], ["customerPriceWrites: 0", "no customer price"], ["packageSupplierSelectionWrites: 0", "no automatic selection"],
    ["commerceOrderWrites: 0", "no order"], ["fulfillmentAttemptWrites: 0", "no attempt"], ["supplierExecutionCalls: 0", "no supplier execution"],
    ["commerceState: \"HIDDEN\"", "new product hidden"], ["publicDiscoveryEnabled: false", "new product not discoverable"], ["enabled: false", "new product disabled"],
    ["requestIdempotencyKey", "retry identity required"], ["CURRENT_DECISION_CONFLICT", "concurrent decision handled"], ["DUPLICATE_MAPPING_CONFLICT", "duplicate mapping handled"]
]) ok((service + productAuthority).includes(needle), label);
ok(!service.includes("CommerceOrder.create"), "no CommerceOrder creation");
ok(!service.includes("FulfillmentAttempt.create"), "no FulfillmentAttempt creation");
ok(!service.includes("PackageSupplierSelection.create"), "no selection creation");
ok(!service.includes("submitTopup"), "no provider fulfillment call");
ok(route.includes("/admin/supplier-catalog/products/:id/onboard"), "explicit Admin endpoint");
ok(route.includes("SUPPLIER_CATALOG_RECONCILE"), "reconciliation permission enforced");
ok(ui.includes("data-onboard-supplier-product") && ui.includes(">Select</button>"), "business-facing Admin selection action available");
ok(ui.includes("confirmed:true"), "Admin confirmation sent");
ok(ui.includes("openSupplierReconciliationReview"), "ambiguous review reuses reconciliation UI");
ok(resolveFulfillmentRoutingMode({}) === "LEGACY_REGION", "legacy routing remains default");
ok(!service.match(/productionRole\s*:\s*"PRIMARY"/), "no PRIMARY promotion");
ok(!service.includes("prices:"), "no customer price mutation");
ok(!service.includes("published:"), "no publication mutation");
ok(service.includes("for (const offer of offers)"), "product-level operation processes every offer");
ok(service.includes("for (const offer of offers)") && service.includes("try {"), "per-offer partial success boundary present");
ok(service.includes("generateSupplierRoutePreparationPlan"), "onboarding invokes route-preparation planning");
ok(service.includes("applySupplierRoutePreparationPlan"), "deterministic route preparation uses existing apply authority");
ok(service.includes("M.Mapping.findById(prepared.mappingId"), "mapping is re-read after preparation");
ok(service.match(/assessMappingReadiness/g).length >= 2, "readiness is re-evaluated after preparation");
ok(!service.includes("intentionallyDisabled") && service.includes("generateSupplierRoutePreparationPlan"), "exact disabled mappings use the bounded route-preparation authority instead of a generic adoption-review rejection");
ok(service.includes("existingContract") && service.includes("fingerprint"), "explicit contract is not replaced by weaker evidence");
ok(Object.keys(WIZARD_STATES).join(",") === "READY,PREPARABLE,NEEDS_ATTENTION,UNAVAILABLE", "one authoritative four-state wizard contract");
ok(wizardStateFor({ mapping: exactMapping, classification: "PROVEN_SAME", blockers: [] }) === WIZARD_STATES.READY, "selectable exact mapping is READY");
ok(wizardStateFor({ mapping: { ...exactMapping, mappingMetadata: { technicalPreparation: { authority: "test" } } }, classification: "PROVEN_SAME", blockers: ["MAPPING_DISABLED"] }) === WIZARD_STATES.PREPARABLE, "safe prepared disabled mapping is PREPARABLE without claiming execution readiness");
ok(wizardStateFor({ mapping: { ...exactMapping, mappingMetadata: { technicalPreparation: { authority: "test" } } }, classification: "PROVEN_SAME", blockers: ["MAPPING_DISABLED", "MAPPING_NOT_PRIMARY", "PROVIDER_FEATURE_GATE_OFF"] }) === WIZARD_STATES.PREPARABLE, "live activation controls remain distinct from technical preparation");
ok(wizardStateFor({ mapping: null, classification: "PROVEN_NEW", blockers: [] }) === WIZARD_STATES.PREPARABLE, "bounded exact new offer is PREPARABLE");
ok(wizardStateFor({ mapping: null, classification: "AMBIGUOUS", blockers: ["CANONICAL_EQUIVALENCE_REVIEW_REQUIRED"] }) === WIZARD_STATES.NEEDS_ATTENTION, "ambiguous identity needs attention");
ok(wizardStateFor({ mapping: exactMapping, classification: "PROVEN_SAME", blockers: ["CUSTOMER_MARKET_NOT_ELIGIBLE"] }) === WIZARD_STATES.UNAVAILABLE, "unsupported customer market is unavailable");
const technical = { enabled: true, executionMode: "API", supplierProductCode: "HOK", supplierPackageCode: "60", supplierCatalogOfferId: "o1", supplierId: "s1", mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true, pricingReady: false } }, fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "test", verifiedAt: new Date(), version: 1 } };
const supplier = { _id: "s1", supplierCode: "TEST", enabled: true, mode: "API" }, adapter = { isConfigured: () => true, isAutoFulfillmentEnabled: () => true }, availability = { supplierCatalogOfferId: "o1", state: "AVAILABLE" };
ok(assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping: technical, supplier, offer: exact, availability, customerMarket: "TH", adapter }).blockers.includes("PRICING_NOT_READY") === false, "NEW_ORDER_SELECTABLE ignores retail pricing readiness");
const publicAssessment = assessMappingReadiness({ mode: READINESS_MODES.PUBLIC_PURCHASABLE, mapping: technical, supplier, offer: exact, availability, customerMarket: "TH", adapter, pkg: { enabled: true, prices: {} }, publication: { published: true }, selection: { supplierMappingId: technical._id } });
ok(!publicAssessment.blockers.includes("PRICING_NOT_READY") && publicAssessment.blockers.includes("NO_VALID_PRICE"), "PUBLIC_PURCHASABLE uses the published customer price and does not add mapping pricingReady as a second sales gate");
ok(assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping: technical, supplier, offer: exact, availability, customerMarket: "MM", adapter }).blockers.includes("CUSTOMER_MARKET_NOT_ELIGIBLE"), "TH eligibility does not imply MM readiness");
const globalEligibility = { ...technical, fulfillmentEligibility: { ...technical.fulfillmentEligibility, mode: "GLOBAL", allowedCustomerMarkets: [] } };
ok(!assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping: globalEligibility, supplier, offer: exact, availability, customerMarket: "TH", adapter }).blockers.includes("CUSTOMER_MARKET_NOT_ELIGIBLE"), "GLOBAL eligibility permits supported TH market");
ok(!assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping: globalEligibility, supplier, offer: exact, availability, customerMarket: "MM", adapter }).blockers.includes("CUSTOMER_MARKET_NOT_ELIGIBLE"), "GLOBAL eligibility permits supported MM market");
const unknownEligibility = { ...technical, fulfillmentEligibility: { ...technical.fulfillmentEligibility, mode: "UNKNOWN", allowedCustomerMarkets: [] } };
ok(assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping: unknownEligibility, supplier, offer: exact, availability, customerMarket: "TH", adapter }).blockers.includes("FULFILLMENT_ELIGIBILITY_UNKNOWN"), "UNKNOWN eligibility remains fail closed");
ok(service.includes("continuation") && service.includes("selectableCount") && service.includes("needsAttentionCount") && service.includes("unavailableCount"), "onboarding exposes sanitized four-state wizard continuation");
ok(service.includes("WIZARD_STATE_INVARIANT_FAILED") && service.includes("summary.ready + summary.preparable + summary.needsAttention + summary.unavailable"), "state counts are guarded by an invariant");
ok(service.includes("mutationsEnabled: () => canonicalProductAuthority.mutationsEnabled() === true"), "bounded onboarding uses only the dedicated default-off authority gate");
ok(service.includes("markets.map(customerMarket") && service.includes("assessments.every(item => item.ready)"), "every requested customer market must pass readiness");
ok(ui.includes("row.blockers") && ui.includes("apwBlockerLabel"), "frontend renders sanitized blocker codes");
ok(!routePreparationSource.includes("Promise.all"), "route-preparation session reads remain sequential");

console.log(JSON.stringify({ result: "PASS", checks, productionWrites: 0, supplierCalls: 0, commerceOrders: 0, fulfillmentAttempts: 0 }, null, 2));
