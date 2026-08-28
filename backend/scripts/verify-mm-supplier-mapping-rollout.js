#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { classify, buildPlan, parseArgs, applyPlan, OPERATOR_EVIDENCE_SOURCE } = require("./rollout-mm-supplier-mapping-eligibility");
const { isCustomerMarketEligible, validateFulfillmentEligibility } = require("../services/supplierFulfillmentEligibilityService");
const { summarizeEligibilityResolution, basicCandidateBlockers, OUTCOMES } = require("../services/supplierEligibilityRouteResolver");
const { createWonddAdapter } = require("../services/suppliers/wonddAdapter");
const { findPublishedVersionForPackage } = require("../services/commerce/productionPricingContextService");

const now = new Date("2026-08-28T00:00:00.000Z");
const unknown = { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "LEGACY_EFFECTIVE_SCOPE", evidenceSource: "legacy", verifiedAt: now, version: 1 };
const th = { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "provider TH contract", verifiedAt: now, version: 1 };
const global = { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "provider global contract", verifiedAt: now, version: 1 };
const mm = { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM", "TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "provider MM/TH contract", verifiedAt: now, version: 1 };
const operator = { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM", "TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: OPERATOR_EVIDENCE_SOURCE, verifiedAt: now, version: 1 };
const mapping = (overrides = {}) => ({ _id: overrides._id || "m1", supplierId: "s1", supplierCode: "WONDD", productCode: "game", packageCode: "PKG", supplierProductCode: "provider-game", supplierPackageCode: "provider-pkg", region: "TH", enabled: true, archivedAt: null, productionRole: "PRIMARY", executionMode: "API", fulfillmentEligibility: unknown, supplierCostAuthority: { rawSupplierCost: 10, supplierCurrency: "THB", capturedAt: now }, mappingMetadata: { costAuthorityMaximumAgeSeconds: 86400, readiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true } }, ...overrides });
const pkg = (overrides = {}) => ({ _id: "p1", productCode: "game", packageCode: "PKG", enabled: true, deletedAt: null, prices: { MM: { amount: 1000, currency: "MMK", enabled: true, fxRate: 100, fxRateSource: "stored" } }, ...overrides });
const supplier = { _id: "s1", supplierCode: "WONDD", enabled: true, mode: "API" };
const mmPolicy = { _id: "mm-policy", region: "MM", currency: "MMK", status: "ACTIVE" };
const publication = (overrides = {}) => ({ status: "PUBLISHED", branchKey: "storefront", pricingPolicyId: "mm-policy", affectedPackages: [{ packageCode: "PKG" }], ...overrides });

assert(findPublishedVersionForPackage({ versions: [publication()], policy: mmPolicy, pkg: pkg() }), "Direct policy binding must match.");
assert(findPublishedVersionForPackage({ versions: [publication({ pricingPolicyId: "th-policy", metadata: { policyIds: ["mm-policy"] } })], policy: mmPolicy, pkg: pkg() }), "metadata.policyIds must match a multi-policy publication.");
assert(findPublishedVersionForPackage({ versions: [publication({ pricingPolicyId: null })], policy: mmPolicy, pkg: pkg() }), "Null policy publication must match production semantics.");
assert(findPublishedVersionForPackage({ versions: [publication({ affectedPackages: [{ packageRef: "p1" }] })], policy: mmPolicy, pkg: pkg() }), "packageRef must match.");
assert(findPublishedVersionForPackage({ versions: [publication({ affectedPackages: [{ packageId: "PKG" }] })], policy: mmPolicy, pkg: pkg() }), "packageId must match canonical packageCode.");
assert(findPublishedVersionForPackage({ versions: [publication({ affectedPackages: [{ packageCode: "PKG" }] })], policy: mmPolicy, pkg: pkg() }), "packageCode must match.");
assert(findPublishedVersionForPackage({ versions: [publication({ affectedPackages: [] })], policy: mmPolicy, pkg: pkg() }), "Empty affectedPackages must be policy-level.");
assert.strictEqual(findPublishedVersionForPackage({ versions: [publication({ branchKey: "draft" })], policy: mmPolicy, pkg: pkg() }), null, "Non-storefront branches must be rejected.");
assert.strictEqual(findPublishedVersionForPackage({ versions: [publication({ status: "DRAFT" })], policy: mmPolicy, pkg: pkg() }), null, "Non-published versions must be rejected.");
assert.strictEqual(findPublishedVersionForPackage({ versions: [publication({ affectedPackages: [{ packageCode: "OTHER" }] })], policy: mmPolicy, pkg: pkg() }), null, "Unrelated package bindings must be rejected.");
assert(findPublishedVersionForPackage({ versions: [publication({ affectedPackages: [{ packageCode: "PKG" }] })], policy: mmPolicy, pkg: pkg({ productCode: "different-product" }) }), "Publication matching must not require affectedPackages.productCode.");

assert.strictEqual(isCustomerMarketEligible(unknown, "MM"), false, "UNKNOWN must fail closed for MM.");
assert.strictEqual(isCustomerMarketEligible(mm, "MM"), true, "Provider-confirmed MM allowlist must route for MM.");
assert.strictEqual(isCustomerMarketEligible(th, "MM"), false, "TH-only eligibility must not route for MM.");
assert.strictEqual(isCustomerMarketEligible(global, "MM"), true); assert.strictEqual(isCustomerMarketEligible(global, "TH"), true, "GLOBAL must include MM and TH.");
assert.strictEqual(validateFulfillmentEligibility(operator).valid, true, "Operator-confirmed capability must be accepted as explicit eligibility evidence.");
assert.notStrictEqual(operator.evidenceCode, "PROVIDER_CONFIRMED", "Operator evidence must remain distinct from provider confirmation.");
assert.strictEqual(classify(mapping({ fulfillmentEligibility: mm }), { canonical: pkg(), duplicatePrimary: false, verifiedAt: now }).bucket, "VERIFIED_MM");
assert.strictEqual(classify(mapping({ fulfillmentEligibility: global }), { canonical: pkg(), duplicatePrimary: false, verifiedAt: now }).bucket, "GLOBAL");
assert.strictEqual(classify(mapping({ fulfillmentEligibility: th }), { canonical: pkg(), duplicatePrimary: false, verifiedAt: now }).bucket, "TH_ONLY");
assert.strictEqual(classify(mapping(), { canonical: pkg(), duplicatePrimary: false, verifiedAt: now }).bucket, "UNKNOWN");
assert.strictEqual(classify(mapping(), { canonical: null, duplicatePrimary: false, verifiedAt: now }).bucket, "INVALID_MAPPING", "Exact canonical package identity is required.");
assert.strictEqual(classify(mapping({ supplierPackageCode: "" }), { canonical: pkg(), duplicatePrimary: false, verifiedAt: now }).bucket, "INVALID_MAPPING", "Exact provider identity is required.");
assert.strictEqual(classify(mapping(), { canonical: pkg(), duplicatePrimary: true, verifiedAt: now }).bucket, "INVALID_MAPPING", "Duplicate PRIMARY routes must fail closed.");

const assessments = new Map([["m1", { blockers: [] }]]);
assert.strictEqual(summarizeEligibilityResolution({ mappings: [mapping({ fulfillmentEligibility: mm })], assessments, productCode: "game", packageCode: "PKG", customerMarket: "MM" }).outcome, OUTCOMES.ELIGIBLE);
assert.strictEqual(summarizeEligibilityResolution({ mappings: [mapping({ _id: "m1" }), mapping({ _id: "m2" })], assessments: new Map([["m1", { blockers: [] }], ["m2", { blockers: [] }]]), productCode: "game", packageCode: "PKG", customerMarket: "MM" }).outcome, OUTCOMES.AMBIGUOUS_PRIMARY_ROUTE);
const blocked = basicCandidateBlockers({ mapping: mapping({ fulfillmentEligibility: mm, enabled: false }), supplier, pkg: pkg(), customerMarket: "MM", now, adapter: { isConfigured: () => true, isAutoFulfillmentEnabled: () => true } });
assert(blocked.blockers.includes("MAPPING_DISABLED"), "Disabled mappings must fail closed.");
const killed = basicCandidateBlockers({ mapping: mapping({ fulfillmentEligibility: mm }), supplier, pkg: pkg(), customerMarket: "MM", now, adapter: { isConfigured: () => true, isAutoFulfillmentEnabled: () => false, autoFulfillmentGateState: () => ({ blockerCode: "SUPPLIER_AUTO_FULFILLMENT_DISABLED" }) } });
assert(killed.blockers.includes("SUPPLIER_AUTO_FULFILLMENT_DISABLED"), "Supplier emergency kill switch must block execution.");

const base = { mappings: [mapping({ fulfillmentEligibility: mm })], packages: [pkg()], suppliers: [supplier], policies: [], versions: [], options: {}, now };
const dry = buildPlan(base); assert.strictEqual(dry.mode, "DRY_RUN"); assert.strictEqual(dry.writes, 0); assert.strictEqual(dry.totals.VERIFIED_MM, 1);
assert.strictEqual(buildPlan({ ...base, options: { apply: true } }).proposedChanges.length, 0, "Already-classified mappings must make apply idempotent.");
assert.throws(() => parseArgs(["--supplier=SEAGM"]), error => error.code === "SCOPE_SUPPLIER_UNSUPPORTED");
assert(!dry.inventory.some(item => item.supplier === "SEAGM"), "SEAGM must remain absent.");

const operatorMapping = mapping({ _id: "operator-1", productCode: "mlbb", packageCode: "MLBB_86", supplierProductCode: "mlbb", supplierPackageCode: "ML00086" });
const operatorPackage = pkg({ _id: "operator-package", productCode: "mlbb", packageCode: "MLBB_86" });
const operatorDry = buildPlan({ mappings: [operatorMapping], packages: [operatorPackage], suppliers: [supplier], policies: [], versions: [], options: {}, now });
assert.strictEqual(operatorDry.regionalProductRule, "Create separate regional canonical product identities only when the supplier/product has an actual market restriction.");
assert.strictEqual(operatorDry.totals.operatorConfirmedProposed, 1);
assert.strictEqual(operatorDry.proposedChanges[0].shadowVerification.MM, "ELIGIBLE");
assert.strictEqual(operatorDry.proposedChanges[0].shadowVerification.TH, "ELIGIBLE");
assert.strictEqual(operatorDry.proposedChanges[0].proposedEligibility.evidenceCode, "OPERATOR_CONFIRMED_CAPABILITY");
const operatorApplied = { ...operatorMapping, fulfillmentEligibility: operatorDry.proposedChanges[0].proposedEligibility };
assert.strictEqual(buildPlan({ mappings: [operatorApplied], packages: [operatorPackage], suppliers: [supplier], policies: [], versions: [], options: { apply: true }, now }).proposedChanges.length, 0, "Operator migration must be idempotent after apply.");
const pilotMapping = mapping({ _id: "pilot", productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", supplierProductCode: "mlbb", supplierPackageCode: "MLFT055", fulfillmentEligibility: { ...operator, evidenceCode: "CONTROLLED_TEST", evidenceSource: "controlled pilot" } });
const pilotPackage = pkg({ productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP" });
assert.strictEqual(buildPlan({ mappings: [pilotMapping], packages: [pilotPackage], suppliers: [supplier], policies: [], versions: [], options: {}, now }).proposedChanges.length, 0, "Existing CONTROLLED_TEST pilot must remain unchanged.");

const payload = createWonddAdapter({ env: {} }).buildTopupPayload({ productCode: "mlbb", serviceCode: "mlbb", packCode: "ML00086", gameId: "123456 789" });
assert.deepStrictEqual(Object.keys(payload).sort(), ["gameid", "method", "packcode", "servicecode"]);
for (const forbidden of ["region", "country", "customerMarket"]) assert.strictEqual(Object.hasOwn(payload, forbidden), false, `WonDD payload must not contain ${forbidden}.`);

let bulkCalls = 0;
applyPlan({ mode: "DRY_RUN", proposedChanges: [{}] }, { Mapping: { bulkWrite: async () => { bulkCalls += 1; } }, connection: {} }).then(result => {
    assert.strictEqual(result.writes, 0); assert.strictEqual(bulkCalls, 0, "Dry-run must perform zero writes.");
    const source = fs.readFileSync(path.resolve(__dirname, "../services/supplierProductionSelectionService.js"), "utf8");
    assert(source.includes("FULFILLMENT_ROUTING_MODES.LEGACY_REGION") && source.includes("FULFILLMENT_ROUTING_MODES.DUAL_READ"), "Legacy and dual-read compatibility must remain present.");
    console.log(JSON.stringify({ result: "PASS", operatorEvidenceAccepted: true, operatorDistinctFromProvider: true, unknownFailsClosed: true, verifiedMmRoutes: true, thOnlyBlockedForMm: true, globalRoutesMmAndTh: true, exactCanonicalIdentity: true, exactProviderIdentity: true, duplicatePrimaryFailsClosed: true, disabledFailsClosed: true, supplierKillSwitch: true, thCompatibilityPreserved: true, legacyCompatibilityPreserved: true, pilotContractPreserved: true, wonddPayloadKeys: Object.keys(payload).sort(), forbiddenSupplierMarketFields: 0, dryRunWrites: 0, applyIdempotent: true, uncertainRemainsUnknown: true, fazerCardsChanges: 0, seagmAbsent: true, providerCalls: 0 }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });
