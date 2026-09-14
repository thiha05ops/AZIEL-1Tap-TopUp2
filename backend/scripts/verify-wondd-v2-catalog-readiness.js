#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { basicCandidateBlockers, summarizeEligibilityResolution, OUTCOMES } = require("../services/supplierEligibilityRouteResolver");
const { createRoutingAuthority } = require("../services/supplierProductionSelectionService");
const { FULFILLMENT_ROUTING_MODES } = require("../config/fulfillmentRoutingMode");
const { createWonddAdapter } = require("../services/suppliers/wonddAdapter");
const { validateWonddMapping } = require("../services/suppliers/wonddFulfillmentProcessor");
const { supportsMapping } = require("../services/suppliers/supplierFulfillmentDispatcher");
const { transactionalServiceCode } = require("../services/suppliers/wonddCatalogConfig");
const { buildPlan } = require("./migrate-wondd-v2-catalog-readiness");

const now = new Date("2026-09-14T00:00:00.000Z");
const mapping = {
    _id: "6a8d5b2806e43181e513ee32", supplierId: "6a8d535a25a23944b761fddb", supplierCode: "WONDD",
    productCode: "mlbb-twilight-weekly-pass", packageCode: "MLBB_ONE_TIME_WEEKLY_PASS", region: "TH",
    supplierProductCode: "9622", supplierPackageCode: "MLOTW01", supplierCatalogOfferId: "6a940241f8c717124060b47e",
    enabled: true, archivedAt: null, productionRole: "PRIMARY", executionMode: "API",
    fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "isolated fixture", verifiedAt: now, version: 1 },
    mappingMetadata: { readiness: { supplierMapped: true, pricingReady: true, inputReady: true, validationReady: true, fulfillmentReady: true, storefrontReady: true } }
};
const supplier = { _id: mapping.supplierId, supplierCode: "WONDD", enabled: true, mode: "API" };
const product = { _id: "6a940213f8c717124060b370", supplierId: mapping.supplierId, supplierProductCode: "9622", metadata: { transactionalServiceCode: "mlbb" } };
const offer = { _id: mapping.supplierCatalogOfferId, supplierCatalogProductId: product._id, supplierId: mapping.supplierId, catalogNamespace: "WONDD_PACKAGE_CATALOG", supplierProductCode: "9622", supplierOfferCode: "MLOTW01", catalogLifecycleState: "ACTIVE", lastObservedAt: now };
const availability = { supplierCatalogOfferId: offer._id, state: "AVAILABLE", evidenceCode: "WONDD_PACKAGE_LISTED", observedAt: now, staleAt: null, coverageComplete: false };
const pkg = { productCode: mapping.productCode, packageCode: mapping.packageCode, enabled: true, deletedAt: null, prices: { TH: { enabled: true, amount: 60, currency: "THB" } } };
const adapter = { isConfigured: () => true, isAutoFulfillmentEnabled: code => code === "mlbb", autoFulfillmentGateState: () => ({ effectiveGateEnabled: true }) };

function blockers(availabilityEvidence) {
    return basicCandidateBlockers({ mapping, supplier, pkg, customerMarket: "TH", adapter, offer, availability: availabilityEvidence, requireCatalogEvidence: true }).blockers;
}

(async () => {
    assert.strictEqual(transactionalServiceCode("9622"), "mlbb");
    assert.strictEqual(validateWonddMapping(mapping), mapping);
    assert.strictEqual(supportsMapping(mapping), true);
    assert.deepStrictEqual(blockers(availability), []);
    assert(!blockers(availability).includes("SUPPLIER_OFFER_NOT_ACTIVE"));
    assert(blockers(null).includes("SUPPLIER_AVAILABILITY_NOT_CONFIRMED"));
    assert(blockers({ ...availability, staleAt: new Date("2026-09-13T00:00:00.000Z") }).includes("SUPPLIER_AVAILABILITY_NOT_CONFIRMED"));

    const assessments = new Map([[mapping._id, { blockers: blockers(availability) }]]);
    const resolved = summarizeEligibilityResolution({ mappings: [mapping], assessments, productCode: mapping.productCode, packageCode: mapping.packageCode, customerMarket: "TH" });
    assert.strictEqual(resolved.outcome, OUTCOMES.ELIGIBLE);
    assert.strictEqual(resolved.routeSnapshot.supplierProductCode, "9622");
    const routeResolver = createRoutingAuthority({
        legacyResolver: async () => ({ ready: false, blockers: ["NO_LEGACY_ROUTE"], routeSnapshot: null }),
        eligibilityResolver: async () => resolved,
        modeResolver: () => FULFILLMENT_ROUTING_MODES.ELIGIBILITY_PRIMARY
    });
    const checkoutRoute = await routeResolver({ productCode: mapping.productCode, packageCode: mapping.packageCode, region: "TH" });
    assert.strictEqual(checkoutRoute.ready, true);
    assert.strictEqual(checkoutRoute.routeSnapshot.supplierCode, "WONDD");
    assert.strictEqual(checkoutRoute.routeSnapshot.supplierProductCode, "9622");
    assert.strictEqual(checkoutRoute.routeSnapshot.supplierPackageCode, "MLOTW01");

    let transportCalls = 0;
    const wondd = createWonddAdapter({ env: {}, fetchImpl: async () => { transportCalls += 1; throw new Error("transport forbidden"); } });
    assert.deepStrictEqual(wondd.buildTopupPayload({ serviceCode: transactionalServiceCode(mapping.supplierProductCode), packCode: mapping.supplierPackageCode, gameId: "439488505 2409" }), { method: "topup", servicecode: "mlbb", packcode: "MLOTW01", gameid: "439488505 2409" });
    assert.strictEqual(transportCalls, 0);

    const plan = buildPlan({ supplier, mappings: [{ ...mapping, supplierProductCode: "mlbb" }], products: [product], offers: [offer], availability: [] });
    assert.deepStrictEqual(plan.blockers, []);
    assert.strictEqual(plan.updates[0].supplierProductCode, "9622");
    assert.strictEqual(plan.updates[0].availability.state, "AVAILABLE");
    assert.strictEqual(plan.updates[0].availability.evidenceCode, "WONDD_PACKAGE_LISTED");
    const replay = buildPlan({ supplier, mappings: [mapping], products: [product], offers: [offer], availability: [availability] });
    assert.deepStrictEqual(replay, { supplierId: supplier._id, updates: [], blockers: [] });

    console.log(JSON.stringify({ result: "PASS", productCode: mapping.productCode, packageCode: mapping.packageCode, customerMarket: "TH", routeReady: checkoutRoute.ready, supplierProductCode: "9622", transactionalServiceCode: "mlbb", supplierPackageCode: "MLOTW01", missingAvailabilityFailsClosed: true, staleAvailabilityFailsClosed: true, realSupplierCalls: 0, productionWrites: 0 }, null, 2));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
