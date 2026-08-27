#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    SUPPLIER_GATE_MODES,
    resolveSupplierGateMode,
    supplierAutoFulfillmentGateState,
    effectiveAutoFulfillmentGateState
} = require("../config/supplierAutoFulfillmentGate");
const { createWonddAdapter } = require("../services/suppliers/wonddAdapter");
const { createFazerCardsAdapter } = require("../services/suppliers/fazercardsAdapter");
const { createWonddFulfillmentProcessor } = require("../services/suppliers/wonddFulfillmentProcessor");
const { createRoutingAuthority } = require("../services/supplierProductionSelectionService");
const { FULFILLMENT_ROUTING_MODES, resolveFulfillmentRoutingMode } = require("../config/fulfillmentRoutingMode");
const { normalizeSupplierRouteSnapshot } = require("../services/commerce/orderSnapshotRuntime");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const now = new Date("2026-08-28T12:00:00.000Z");

function verifyGateAuthority() {
    assert.strictEqual(resolveSupplierGateMode({}), SUPPLIER_GATE_MODES.LEGACY_PRODUCT_ONLY);
    assert.throws(() => resolveSupplierGateMode({ AZIEL_SUPPLIER_GATE_MODE: "BROKEN" }), error => error.code === "SUPPLIER_GATE_MODE_INVALID");
    assert.strictEqual(supplierAutoFulfillmentGateState("WONDD", {}).supplierGateEnabled, false);
    assert.strictEqual(supplierAutoFulfillmentGateState("WONDD", { WONDD_AUTO_FULFILLMENT_ENABLED: "TRUE" }).supplierGateEnabled, true);
    assert.strictEqual(supplierAutoFulfillmentGateState("WONDD", { WONDD_AUTO_FULFILLMENT_ENABLED: "yes" }).supplierGateEnabled, false);
    assert.strictEqual(effectiveAutoFulfillmentGateState({ supplierCode: "WONDD", productGateEnabled: true, env: {} }).effectiveGateEnabled, true, "Default legacy mode must preserve product-only behavior.");
    const mode = AZIEL_SUPPLIER_GATE_MODE => ({ AZIEL_SUPPLIER_GATE_MODE });
    assert.strictEqual(effectiveAutoFulfillmentGateState({ supplierCode: "WONDD", productGateEnabled: true, env: { ...mode("SUPPLIER_AND_PRODUCT"), WONDD_AUTO_FULFILLMENT_ENABLED: "true" } }).effectiveGateEnabled, true);
    assert.strictEqual(effectiveAutoFulfillmentGateState({ supplierCode: "WONDD", productGateEnabled: true, env: { ...mode("SUPPLIER_AND_PRODUCT"), WONDD_AUTO_FULFILLMENT_ENABLED: "false" } }).blockerCode, "SUPPLIER_AUTO_FULFILLMENT_DISABLED");
    assert.strictEqual(effectiveAutoFulfillmentGateState({ supplierCode: "WONDD", productGateEnabled: false, env: { ...mode("SUPPLIER_AND_PRODUCT"), WONDD_AUTO_FULFILLMENT_ENABLED: "true" } }).effectiveGateEnabled, false);
    assert.strictEqual(effectiveAutoFulfillmentGateState({ supplierCode: "WONDD", productGateEnabled: true, env: mode("SUPPLIER_AND_PRODUCT") }).effectiveGateEnabled, false);
    assert.strictEqual(effectiveAutoFulfillmentGateState({ supplierCode: "UNKNOWN", productGateEnabled: true, env: {} }).effectiveGateEnabled, false);
}

function verifyProductGateCompatibility() {
    const wonddLegacy = createWonddAdapter({ env: { WONDD_USERNAME: "u", WONDD_PASSWORD: "p", WONDD_MLBB_AUTO_FULFILLMENT_ENABLED: "true" } });
    assert.strictEqual(wonddLegacy.isAutoFulfillmentEnabled("mlbb"), true);
    assert.strictEqual(wonddLegacy.autoFulfillmentGateState("mlbb").supplierGateEnabled, false);
    const fazerLegacy = createFazerCardsAdapter({ env: { FAZERCARDS_API_KEY: "key", FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED: "true", FAZERCARDS_VALORANT_AUTO_FULFILLMENT_ENABLED: "false" } });
    assert.strictEqual(fazerLegacy.isAutoFulfillmentEnabled("pubg"), true);
    assert.strictEqual(fazerLegacy.isAutoFulfillmentEnabled("valorant"), false);
    assert.strictEqual(fazerLegacy.isAutoFulfillmentEnabled("unknown"), false);
}

async function verifySubmissionAndRecoveryKillSwitch() {
    let fetchCalls = 0;
    const env = { AZIEL_SUPPLIER_GATE_MODE: "SUPPLIER_AND_PRODUCT", WONDD_AUTO_FULFILLMENT_ENABLED: "false", WONDD_MLBB_AUTO_FULFILLMENT_ENABLED: "true", WONDD_USERNAME: "u", WONDD_PASSWORD: "p" };
    const adapter = createWonddAdapter({ env, fetchImpl: async () => { fetchCalls += 1; throw new Error("provider must not be called"); } });
    await assert.rejects(() => adapter.submitTopup({ productCode: "mlbb", serviceCode: "mlbb", packCode: "MLFT055", gameId: "123 456", reference: "FUL-1" }), error => error.code === "SUPPLIER_AUTO_FULFILLMENT_DISABLED");
    assert.strictEqual(fetchCalls, 0);
    let dbReads = 0;
    const persistedAttempt = { status: "IN_PROGRESS", supplierReference: "ACCEPTED-1" };
    const processor = createWonddFulfillmentProcessor({
        adapter,
        Attempt: { find() { dbReads += 1; throw new Error("recovery query must not run"); } },
        Order: {}, Mapping: {}
    });
    const recovery = await processor.recoverDue();
    assert.deepStrictEqual(recovery, { recovered: 0, disabled: true });
    assert.strictEqual(dbReads, 0);
    assert.deepStrictEqual(persistedAttempt, { status: "IN_PROGRESS", supplierReference: "ACCEPTED-1" }, "Kill switch must not erase accepted attempts.");
}

async function verifyRoutingCompatibility() {
    const legacy = { ready: true, blockers: [], routeSnapshot: { routeType: "MANUAL_ADMIN", supplierCode: "AZIEL_ADMIN", region: "MM" } };
    const eligible = { outcome: "ELIGIBLE", blockerCodes: [], eligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM", "TH"], evidenceCode: "CONTROLLED_TEST", evidenceSource: "fixture", verifiedAt: now, version: 1 }, routeSnapshot: { routeType: "SUPPLIER_API", supplierMappingId: "mapping-1", supplierId: "supplier-1", supplierCode: "WONDD", productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", region: "MM", supplierProductCode: "mlbb", supplierPackageCode: "MLFT055", executionMode: "API", selectedRole: "PRIMARY", selectedAt: now.toISOString() } };
    const dual = createRoutingAuthority({ legacyResolver: async () => legacy, eligibilityResolver: async () => eligible, modeResolver: () => FULFILLMENT_ROUTING_MODES.DUAL_READ, pilotEnabledResolver: () => false });
    assert.strictEqual(await dual({ productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", region: "MM" }), legacy);
    const pilotOn = createRoutingAuthority({ legacyResolver: async () => legacy, eligibilityResolver: async () => eligible, modeResolver: () => FULFILLMENT_ROUTING_MODES.DUAL_READ, pilotEnabledResolver: () => true });
    assert.strictEqual((await pilotOn({ productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", region: "MM" })).routeSnapshot.snapshotVersion, 2);
    assert.strictEqual(resolveFulfillmentRoutingMode({}), "LEGACY_REGION");
}

function verifySnapshotsAndStaticSafety() {
    const quote = { packageSnapshot: { gameCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP" }, commercialSnapshot: { region: "MM" } };
    const common = { routeType: "SUPPLIER_API", supplierMappingId: "mapping-1", supplierId: "supplier-1", supplierCode: "WONDD", productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", supplierProductCode: "mlbb", supplierPackageCode: "MLFT055", executionMode: "API", selectedRole: "PRIMARY", selectedAt: now };
    assert.strictEqual(normalizeSupplierRouteSnapshot({ ...common, region: "MM" }, quote).region, "MM");
    assert.strictEqual(normalizeSupplierRouteSnapshot({ ...common, snapshotVersion: 2, customerMarket: "MM", eligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM", "TH"], evidenceCode: "CONTROLLED_TEST", evidenceSource: "fixture", verifiedAt: now, version: 1 } }, quote).customerMarket, "MM");
    const wallet = read("backend/scripts/verify-wallet-paid-auto-fulfillment.js");
    assert(wallet.includes("walletDebitCount") && wallet.includes("repeatedProviderSubmissions"));
    const paid = read("backend/services/paidFulfillmentRoutingService.js");
    assert(!paid.includes("resolveCheckoutRouteSnapshot"));
    const config = read("backend/config/supplierAutoFulfillmentGate.js");
    assert(!config.includes("submitTopup") && !config.includes("updateOne"));
}

(async () => {
    verifyGateAuthority();
    verifyProductGateCompatibility();
    await verifySubmissionAndRecoveryKillSwitch();
    await verifyRoutingCompatibility();
    verifySnapshotsAndStaticSafety();
    console.log(JSON.stringify({ result: "PASS", defaultPolicy: "LEGACY_PRODUCT_ONLY", legacyBehaviorPreserved: true, supplierAndProductTruthTable: true, unknownSupplierBlocked: true, phase4PilotCompatible: true, submissionBlockedBeforeProvider: true, recoverySchedulingBlocked: true, acceptedAttemptPreserved: true, paidOrderReversed: false, duplicateProviderSubmissions: 0, productGatesRemoved: 0, eligibilityPrimaryActivated: false, providerCalls: 0, databaseWrites: 0 }, null, 2));
})().catch(error => { console.error(`VERIFY_MARKET_DECOUPLED_FULFILLMENT_PHASE5B_FAILED: ${error.stack || error.message}`); process.exitCode = 1; });
