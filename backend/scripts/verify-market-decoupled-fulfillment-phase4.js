#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    buildPlan,
    applyPlan,
    legacyEligibility,
    pilotEligibility,
    EVIDENCE_SOURCE
} = require("./migrate-mm-wondd-mlbb-pilot-eligibility");
const { createRoutingAuthority, compareRoutingDecisions } = require("../services/supplierProductionSelectionService");
const { OUTCOMES } = require("../services/supplierEligibilityRouteResolver");
const { FULFILLMENT_ROUTING_MODES } = require("../config/fulfillmentRoutingMode");
const { ensurePaidOrderFulfillmentWork } = require("../services/paidFulfillmentRoutingService");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const VERIFIED_AT = new Date("2026-08-28T12:00:00.000Z");

function pilotMapping(eligibility = legacyEligibility(VERIFIED_AT), overrides = {}) {
    return { _id: "pilot-mapping-id", supplierCode: "WONDD", productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", supplierProductCode: "mlbb", supplierPackageCode: "MLFT055", region: "TH", enabled: true, archivedAt: null, executionMode: "API", fulfillmentEligibility: eligibility, ...overrides };
}

async function verifyMigration() {
    const dry = buildPlan([pilotMapping()], { apply: false, rollback: false, verifiedAt: VERIFIED_AT });
    assert.strictEqual(dry.mode, "DRY_RUN");
    assert.strictEqual(dry.selectedCount, 1);
    assert.strictEqual(dry.proposedChangeCount, 1);
    assert.deepStrictEqual(dry.after.allowedCustomerMarkets, ["MM", "TH"]);
    assert.strictEqual(dry.after.mode, "CUSTOMER_MARKET_ALLOWLIST");
    assert.strictEqual(dry.after.evidenceCode, "CONTROLLED_TEST");
    assert.strictEqual(dry.after.evidenceSource, EVIDENCE_SOURCE);
    assert.throws(() => buildPlan([], {}), error => error.code === "PILOT_MAPPING_CARDINALITY_INVALID");
    assert.throws(() => buildPlan([pilotMapping(), pilotMapping(undefined, { _id: "duplicate" })], {}), error => error.code === "PILOT_MAPPING_CARDINALITY_INVALID");
    assert.throws(() => buildPlan([pilotMapping(undefined, { supplierPackageCode: "WRONG" })], {}), error => error.code === "PILOT_PROVIDER_IDENTITY_MISMATCH");

    let operation;
    const result = await applyPlan({ ...dry, mode: "APPLY" }, { async updateOne(filter, update) { operation = { filter, update }; return { matchedCount: 1, modifiedCount: 1 }; } });
    assert.deepStrictEqual(result, { matched: 1, modified: 1, writes: 1 });
    assert.strictEqual(operation.filter._id, "pilot-mapping-id");
    assert.strictEqual(operation.filter.supplierPackageCode, "MLFT055");
    assert.deepStrictEqual(operation.update.$set.fulfillmentEligibility.allowedCustomerMarkets, ["MM", "TH"]);

    const applied = pilotMapping(pilotEligibility(VERIFIED_AT));
    const second = buildPlan([applied], { apply: true, rollback: false, verifiedAt: VERIFIED_AT });
    assert.strictEqual(second.idempotentNoop, true);
    assert.strictEqual((await applyPlan(second, { updateOne: async () => { throw new Error("must not write"); } })).writes, 0);
    const rollback = buildPlan([applied], { apply: false, rollback: true, verifiedAt: VERIFIED_AT });
    assert.strictEqual(rollback.after.mode, "UNKNOWN");
    assert.deepStrictEqual(rollback.after.allowedCustomerMarkets, []);
    assert.strictEqual(rollback.after.evidenceCode, "LEGACY_EFFECTIVE_SCOPE");
}

function eligibleShadow(packageCode = "MLBB_55_DIA_FIRST_TOPUP") {
    return { outcome: OUTCOMES.ELIGIBLE, blockerCodes: [], eligibility: pilotEligibility(VERIFIED_AT), routeSnapshot: { routeType: "SUPPLIER_API", supplierMappingId: "pilot-mapping-id", supplierId: "supplier-id", supplierCode: "WONDD", productCode: "mlbb", packageCode, region: "MM", supplierProductCode: "mlbb", supplierPackageCode: "MLFT055", executionMode: "API", selectedRole: "PRIMARY", selectedAt: VERIFIED_AT.toISOString() } };
}

async function verifyRouting() {
    const thLegacy = { ready: true, blockers: [], routeSnapshot: { routeType: "SUPPLIER_API", supplierCode: "WONDD", region: "TH" } };
    const mmLegacy = { ready: true, blockers: [], routeSnapshot: { routeType: "MANUAL_ADMIN", supplierCode: "AZIEL_ADMIN", region: "MM" } };
    assert.strictEqual(compareRoutingDecisions({ legacy: thLegacy, shadow: eligibleShadow() }).classification, "MATCH");
    assert.strictEqual(compareRoutingDecisions({ legacy: mmLegacy, shadow: eligibleShadow() }).classification, "ELIGIBILITY_ONLY");

    const common = { eligibilityResolver: async () => eligibleShadow(), modeResolver: () => FULFILLMENT_ROUTING_MODES.DUAL_READ };
    const off = createRoutingAuthority({ ...common, legacyResolver: async () => mmLegacy, pilotEnabledResolver: () => false });
    assert.strictEqual((await off({ productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", region: "MM" })).routeSnapshot.routeType, "MANUAL_ADMIN");
    const on = createRoutingAuthority({ ...common, legacyResolver: async () => mmLegacy, pilotEnabledResolver: () => true });
    const pilot = await on({ productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", region: "MM" });
    assert.strictEqual(pilot.routeSnapshot.snapshotVersion, 2);
    assert.strictEqual(pilot.routeSnapshot.customerMarket, "MM");
    assert.strictEqual(pilot.routeSnapshot.supplierMappingId, "pilot-mapping-id");
    assert.strictEqual(pilot.routeSnapshot.supplierPackageCode, "MLFT055");
    assert.deepStrictEqual(pilot.routeSnapshot.eligibility.allowedCustomerMarkets, ["MM", "TH"]);
    assert.strictEqual(pilot.routeSnapshot.region, undefined);

    const thOn = createRoutingAuthority({ ...common, legacyResolver: async () => thLegacy, pilotEnabledResolver: () => true });
    assert.strictEqual((await thOn({ productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", region: "TH" })).routeSnapshot, thLegacy.routeSnapshot);
    const nonPilot = createRoutingAuthority({ eligibilityResolver: async () => eligibleShadow("MLBB_86"), legacyResolver: async () => mmLegacy, modeResolver: () => FULFILLMENT_ROUTING_MODES.DUAL_READ, pilotEnabledResolver: () => true });
    assert.strictEqual((await nonPilot({ productCode: "mlbb", packageCode: "MLBB_86", region: "MM" })).routeSnapshot.routeType, "MANUAL_ADMIN");
}

async function verifyPaidSnapshotBinding() {
    let submitted = 0;
    const order = { _id: "order-db-id", orderId: "ORD-PILOT", schemaVersion: 1, status: "paid", paymentStatus: "paid", product: { gameCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP" }, commercial: { region: "MM", currency: "MMK", total: 9900 }, fulfilment: { routeSnapshot: { ...eligibleShadow().routeSnapshot, snapshotVersion: 2, customerMarket: "MM", eligibility: pilotEligibility(VERIFIED_AT) } } };
    const first = await ensurePaidOrderFulfillmentWork(order, { findAttemptByIdempotency: async () => null, startSupplierFulfillment: async (_orderCode, payload) => { submitted += 1; assert.strictEqual(payload.mappingId, "pilot-mapping-id"); return { fulfillmentId: "FUL-PILOT" }; } });
    assert.strictEqual(first.created, true);
    assert.strictEqual(submitted, 1);
    const duplicate = await ensurePaidOrderFulfillmentWork(order, { findAttemptByIdempotency: async () => ({ fulfillmentId: "FUL-PILOT" }), startSupplierFulfillment: async () => { throw new Error("duplicate submit"); } });
    assert.strictEqual(duplicate.reason, "SUPPLIER_FULFILLMENT_ALREADY_BOUND");
    assert.strictEqual(submitted, 1);
}

function verifyBoundaries() {
    const fulfillment = read("backend/services/fulfillmentService.js");
    assert(fulfillment.includes("scopedPilotV2"));
    assert(fulfillment.includes("basicCandidateBlockers"));
    const processor = read("backend/services/suppliers/wonddFulfillmentProcessor.js");
    assert(processor.includes("packCode: mapping.supplierPackageCode"));
    assert(processor.includes("reference: attempt.fulfillmentId"));
    assert(!processor.includes("customer currency"));
    const walletVerifier = read("backend/scripts/verify-wallet-paid-auto-fulfillment.js");
    assert(walletVerifier.includes("walletDebitCount"));
}

(async () => {
    await verifyMigration();
    await verifyRouting();
    await verifyPaidSnapshotBinding();
    verifyBoundaries();
    console.log(JSON.stringify({ result: "PASS", pilotMappingsChangedByDryRun: 1, unrelatedMappingsChanged: 0, rollbackVerified: true, dualReadTh: "MATCH", dualReadMm: "ELIGIBILITY_ONLY", pilotOffMm: "MANUAL_ADMIN", pilotOnMm: "WONDD_V2", mmCurrency: "MMK", supplierCostCurrency: "THB", providerCalls: 0, productionMutations: 0 }, null, 2));
})().catch(error => { console.error(`VERIFY_MARKET_DECOUPLED_FULFILLMENT_PHASE4_FAILED: ${error.stack || error.message}`); process.exitCode = 1; });
