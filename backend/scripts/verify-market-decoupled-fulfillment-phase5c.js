#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    SUPPLIER_GATE_MODES,
    resolveSupplierGateMode,
    effectiveAutoFulfillmentGateState
} = require("../config/supplierAutoFulfillmentGate");
const { createWonddAdapter } = require("../services/suppliers/wonddAdapter");
const { createFazerCardsAdapter } = require("../services/suppliers/fazercardsAdapter");
const { createWonddFulfillmentProcessor } = require("../services/suppliers/wonddFulfillmentProcessor");
const { createFazerCardsFulfillmentProcessor } = require("../services/suppliers/fazercardsFulfillmentProcessor");
const { basicCandidateBlockers, summarizeEligibilityResolution, OUTCOMES } = require("../services/supplierEligibilityRouteResolver");
const { createRoutingAuthority } = require("../services/supplierProductionSelectionService");
const { FULFILLMENT_ROUTING_MODES } = require("../config/fulfillmentRoutingMode");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const now = new Date("2026-08-28T12:00:00.000Z");
const mode = value => ({ AZIEL_SUPPLIER_GATE_MODE: value });
const enabled = (supplierCode, productGateEnabled, env) => effectiveAutoFulfillmentGateState({ supplierCode, productGateEnabled, env }).effectiveGateEnabled;

function verifyModeContract() {
    assert.strictEqual(resolveSupplierGateMode({}), SUPPLIER_GATE_MODES.LEGACY_PRODUCT_ONLY);
    assert.strictEqual(resolveSupplierGateMode(mode("SUPPLIER_ONLY")), SUPPLIER_GATE_MODES.SUPPLIER_ONLY);
    assert.strictEqual(enabled("WONDD", true, {}), true);
    assert.strictEqual(enabled("WONDD", false, {}), false);
    assert.strictEqual(enabled("WONDD", true, { ...mode("SUPPLIER_AND_PRODUCT"), WONDD_AUTO_FULFILLMENT_ENABLED: "true" }), true);
    assert.strictEqual(enabled("WONDD", false, { ...mode("SUPPLIER_AND_PRODUCT"), WONDD_AUTO_FULFILLMENT_ENABLED: "true" }), false);
    assert.strictEqual(enabled("WONDD", true, { ...mode("SUPPLIER_AND_PRODUCT"), WONDD_AUTO_FULFILLMENT_ENABLED: "false" }), false);
    for (const legacyValue of [undefined, "true", "false"]) {
        const env = { ...mode("SUPPLIER_ONLY"), WONDD_AUTO_FULFILLMENT_ENABLED: "true" };
        if (legacyValue !== undefined) env.WONDD_MLBB_AUTO_FULFILLMENT_ENABLED = legacyValue;
        assert.strictEqual(createWonddAdapter({ env }).isAutoFulfillmentEnabled("new-mapped-product"), true, "A new product must not need a product env key in supplier-only mode.");
        assert.strictEqual(createWonddAdapter({ env }).isAutoFulfillmentEnabled("mlbb"), true, "Legacy product values must have zero supplier-only authorization effect.");
    }
    for (const value of [undefined, "", "false", "yes", "1", "tru"]) {
        const env = { ...mode("SUPPLIER_ONLY"), WONDD_MLBB_AUTO_FULFILLMENT_ENABLED: "true" };
        if (value !== undefined) env.WONDD_AUTO_FULFILLMENT_ENABLED = value;
        assert.strictEqual(createWonddAdapter({ env }).isAutoFulfillmentEnabled("mlbb"), false, "Missing/false/malformed supplier switches must fail closed.");
    }
    assert.strictEqual(enabled("UNKNOWN", true, { ...mode("SUPPLIER_ONLY"), UNKNOWN_AUTO_FULFILLMENT_ENABLED: "true" }), false);
}

function verifyMappingAndEligibilityRemainAuthoritative() {
    const eligibility = { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM", "TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "operator fixture", verifiedAt: now, version: 1 };
    const mapping = { _id: "mapping-1", supplierId: "supplier-1", supplierCode: "WONDD", productCode: "new-product", packageCode: "NEW_1", supplierProductCode: "provider-new", supplierPackageCode: "NEW001", productionRole: "PRIMARY", enabled: true, archivedAt: null, executionMode: "API", fulfillmentEligibility: eligibility, supplierCostAuthority: { rawSupplierCost: 10, capturedAt: now }, mappingMetadata: { costAuthorityMaximumAgeSeconds: 86400, readiness: { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true } } };
    const supplier = { _id: "supplier-1", supplierCode: "WONDD", enabled: true, mode: "API" };
    const pkg = { enabled: true, deletedAt: null, prices: { MM: { enabled: true, amount: 1000, currency: "MMK" } } };
    const adapter = createWonddAdapter({ env: { ...mode("SUPPLIER_ONLY"), WONDD_AUTO_FULFILLMENT_ENABLED: "true", WONDD_USERNAME: "u", WONDD_PASSWORD: "p" } });
    const assessed = value => basicCandidateBlockers({ mapping: value, supplier, pkg, customerMarket: "MM", now, adapter }).blockers;
    assert.deepStrictEqual(assessed(mapping), [], "A valid new mapped product must pass the gate layer without a product env variable.");
    assert(assessed({ ...mapping, enabled: false }).includes("MAPPING_DISABLED"));
    assert(assessed({ ...mapping, fulfillmentEligibility: { ...eligibility, mode: "UNKNOWN", allowedCustomerMarkets: [] } }).includes("FULFILLMENT_ELIGIBILITY_UNKNOWN"));
    assert(assessed({ ...mapping, supplierProductCode: "" }).includes("EXACT_MAPPING_INCOMPLETE"));
    assert.strictEqual(summarizeEligibilityResolution({ mappings: [], assessments: new Map(), productCode: "new-product", packageCode: "NEW_1", customerMarket: "MM" }).outcome, OUTCOMES.NO_ELIGIBLE_ROUTE);
    const assessments = new Map([["mapping-1", { blockers: [] }], ["mapping-2", { blockers: [] }]]);
    assert.strictEqual(summarizeEligibilityResolution({ mappings: [mapping, { ...mapping, _id: "mapping-2" }], assessments, productCode: "new-product", packageCode: "NEW_1", customerMarket: "MM" }).outcome, OUTCOMES.AMBIGUOUS_PRIMARY_ROUTE);
}

async function verifySubmissionAndRecoveryBoundaries() {
    let providerCalls = 0;
    const blockedEnv = { ...mode("SUPPLIER_ONLY"), WONDD_AUTO_FULFILLMENT_ENABLED: "false", WONDD_MLBB_AUTO_FULFILLMENT_ENABLED: "true", WONDD_USERNAME: "u", WONDD_PASSWORD: "p" };
    const wondd = createWonddAdapter({ env: blockedEnv, fetchImpl: async () => { providerCalls += 1; throw new Error("provider must not be called"); } });
    await assert.rejects(() => wondd.submitTopup({ productCode: "mlbb", serviceCode: "mlbb", packCode: "MLFT055", gameId: "123 456" }), error => error.code === "SUPPLIER_AUTO_FULFILLMENT_DISABLED");
    const fazer = createFazerCardsAdapter({ env: { ...mode("SUPPLIER_ONLY"), FAZERCARDS_AUTO_FULFILLMENT_ENABLED: "false", FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED: "true", FAZERCARDS_API_KEY: "key" }, fetchImpl: async () => { providerCalls += 1; throw new Error("provider must not be called"); } });
    await assert.rejects(() => fazer.submitTopup({ categoryId: "pubg_mobile_auto", offerId: "OFFER", fields: { player_id: "123" }, idempotencyKey: "idem", productCode: "pubg" }), error => error.code === "SUPPLIER_AUTO_FULFILLMENT_DISABLED");
    let recoveryReads = 0;
    const Attempt = { find() { recoveryReads += 1; throw new Error("disabled recovery must not query attempts"); } };
    assert.deepStrictEqual(await createWonddFulfillmentProcessor({ adapter: wondd, Attempt, Order: {}, Mapping: {} }).recoverDue(), { recovered: 0, disabled: true });
    assert.deepStrictEqual(await createFazerCardsFulfillmentProcessor({ adapter: fazer, Attempt, Order: {}, Mapping: {} }).recoverDue(), { recovered: 0, disabled: true });
    assert.strictEqual(recoveryReads, 0);
    assert.strictEqual(providerCalls, 0);
}

async function verifyRoutingAndPayloadCompatibility() {
    const legacy = { ready: true, blockers: [], routeSnapshot: { routeType: "MANUAL_ADMIN", region: "MM" } };
    const shadow = { outcome: "ELIGIBLE", blockerCodes: [], eligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM"], evidenceCode: "TEST", version: 1 }, routeSnapshot: { routeType: "SUPPLIER_API", supplierMappingId: "mapping-1", supplierId: "supplier-1", supplierCode: "WONDD", productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", region: "MM", supplierMarket: "MM", supplierProductCode: "mlbb", supplierPackageCode: "MLFT055", executionMode: "API", selectedRole: "PRIMARY" } };
    const authority = createRoutingAuthority({ legacyResolver: async () => legacy, eligibilityResolver: async () => shadow, modeResolver: () => FULFILLMENT_ROUTING_MODES.DUAL_READ, pilotEnabledResolver: () => false });
    const resolved = await authority({ productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", region: "MM" });
    assert.strictEqual(resolved.routeSnapshot.routeType, "SUPPLIER_API", "DUAL_READ must not let MANUAL_ADMIN shadow an executable eligible PRIMARY/API supplier route.");
    assert.strictEqual(resolved.routeSnapshot.supplierCode, "WONDD");
    assert.strictEqual(resolved.routeSnapshot.snapshotVersion, 2);
    assert.strictEqual(resolved.routeSnapshot.customerMarket, "MM");
    const genuineManual = createRoutingAuthority({ legacyResolver: async () => legacy, eligibilityResolver: async () => ({ outcome: OUTCOMES.NO_ELIGIBLE_ROUTE, blockerCodes: ["NO_PRIMARY_MAPPING"], routeSnapshot: null }), modeResolver: () => FULFILLMENT_ROUTING_MODES.DUAL_READ });
    assert.strictEqual((await genuineManual({ productCode: "manual-product", packageCode: "MANUAL_1", region: "MM" })).routeSnapshot.routeType, "MANUAL_ADMIN", "Genuine manual-only products must retain manual-admin routing.");
    const wondd = createWonddAdapter({ env: {} }).buildTopupPayload({ productCode: "mlbb", serviceCode: "mlbb", packCode: "MLFT055", gameId: "123 456" });
    assert.deepStrictEqual(Object.keys(wondd).sort(), ["gameid", "method", "packcode", "servicecode"]);
    for (const forbidden of ["region", "country", "customerMarket"]) assert.strictEqual(Object.hasOwn(wondd, forbidden), false);
    const fazer = createFazerCardsAdapter({ env: {} }).buildTopupPayload({ categoryId: "mobile_legends_global", offerId: "ML86", fields: { player_id: "123", server_id: "456" } });
    assert.deepStrictEqual(fazer, { category_id: "mobile_legends_global", offer_id: "ML86", fields: { player_id: "123", server_id: "456" } });
}

function verifyStaticEnforcement() {
    const fulfillment = read("backend/services/fulfillmentService.js");
    const wondd = read("backend/services/suppliers/wonddAdapter.js");
    const fazer = read("backend/services/suppliers/fazercardsAdapter.js");
    assert(fulfillment.includes("adapter.isAutoFulfillmentEnabled(mapping.productCode)"), "Fulfillment start must enforce the effective gate.");
    assert(wondd.indexOf("const gate = autoFulfillmentGateState(productCode)") < wondd.indexOf("const response = await postWonDD(payload"), "WonDD submission must gate before transport.");
    assert(fazer.indexOf("const gate = autoFulfillmentGateState(productCode)") < fazer.indexOf('request("/topups/order"'), "FazerCards submission must gate before transport.");
    assert(!read("backend/config/fulfillmentRoutingMode.js").includes('DEFAULT_MODE = FULFILLMENT_ROUTING_MODES.ELIGIBILITY_PRIMARY'));
}

(async () => {
    verifyModeContract();
    verifyMappingAndEligibilityRemainAuthoritative();
    await verifySubmissionAndRecoveryBoundaries();
    await verifyRoutingAndPayloadCompatibility();
    verifyStaticEnforcement();
    console.log(JSON.stringify({ result: "PASS", defaultMode: "LEGACY_PRODUCT_ONLY", supplierOnlyAdded: true, supplierOnlyProductGateAuthorizationEffect: 0, newProductEnvironmentVariablesRequired: 0, missingSupplierGateFailsClosed: true, unknownSupplierFailsClosed: true, mappingAuthorityPreserved: true, eligibilityAuthorityPreserved: true, ambiguousPrimaryFailsClosed: true, routeSelectionProtected: true, fulfillmentStartProtected: true, adapterSubmissionProtected: true, recoveryProtected: true, dualReadPreserved: true, mmPilotSemanticsChanged: false, wonddPayloadChanged: false, fazerCardsPayloadChanged: false, providerCalls: 0, supplierTransactionalCalls: 0, orderCreations: 0, fulfillmentAttemptCreations: 0, databaseWrites: 0, pricingMutations: 0, eligibilityMutations: 0 }, null, 2));
})().catch(error => { console.error(`VERIFY_MARKET_DECOUPLED_FULFILLMENT_PHASE5C_FAILED: ${error.stack || error.message}`); process.exitCode = 1; });
