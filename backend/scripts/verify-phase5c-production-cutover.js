#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const assert = require("assert");
const {
    SUPPLIER_GATE_MODES,
    resolveSupplierGateMode,
    supplierAutoFulfillmentGateState,
    effectiveAutoFulfillmentGateState
} = require("../config/supplierAutoFulfillmentGate");
const { FULFILLMENT_ROUTING_MODES, resolveFulfillmentRoutingMode } = require("../config/fulfillmentRoutingMode");
const { isPilotEnabled } = require("../config/mmWonddMlbbPilot");
const { createWonddAdapter } = require("../services/suppliers/wonddAdapter");
const { createFazerCardsAdapter } = require("../services/suppliers/fazercardsAdapter");

const CUTOVER_KEYS = Object.freeze([
    "AZIEL_SUPPLIER_GATE_MODE",
    "WONDD_AUTO_FULFILLMENT_ENABLED",
    "FAZERCARDS_AUTO_FULFILLMENT_ENABLED",
    "AZIEL_FULFILLMENT_ROUTING_MODE",
    "AZIEL_MM_WONDD_MLBB_PILOT_ENABLED",
    "WONDD_MLBB_AUTO_FULFILLMENT_ENABLED",
    "WONDD_FREEFIRE_AUTO_FULFILLMENT_ENABLED",
    "FAZERCARDS_MLBB_AUTO_FULFILLMENT_ENABLED",
    "FAZERCARDS_FREEFIRE_AUTO_FULFILLMENT_ENABLED",
    "FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED",
    "FAZERCARDS_HOK_AUTO_FULFILLMENT_ENABLED"
]);

async function withProcessEnv(overrides, operation) {
    const previous = new Map(Object.keys(overrides).map(key => [key, Object.hasOwn(process.env, key) ? process.env[key] : undefined]));
    try {
        for (const [key, value] of Object.entries(overrides)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = String(value);
        }
        return await operation();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function effective(supplierCode, productGateEnabled) {
    return effectiveAutoFulfillmentGateState({ supplierCode, productGateEnabled, env: process.env });
}

async function main() {
    const originalEnvironment = new Map(CUTOVER_KEYS.map(key => [key, Object.hasOwn(process.env, key) ? process.env[key] : undefined]));
    const mode = resolveSupplierGateMode(process.env);
    const routingMode = resolveFulfillmentRoutingMode(process.env);
    const pilotEnabled = isPilotEnabled(process.env);
    assert.strictEqual(mode, SUPPLIER_GATE_MODES.SUPPLIER_ONLY, "Production cutover mode must be SUPPLIER_ONLY.");
    assert.strictEqual(routingMode, FULFILLMENT_ROUTING_MODES.DUAL_READ, "Production routing mode must remain DUAL_READ.");
    assert.strictEqual(pilotEnabled, true, "The MM WonDD MLBB pilot must remain enabled.");

    const wonddSupplier = supplierAutoFulfillmentGateState("WONDD", process.env);
    const fazerSupplier = supplierAutoFulfillmentGateState("FAZERCARDS", process.env);
    assert.strictEqual(wonddSupplier.supplierGateEnabled, true, "WonDD supplier switch must be explicitly true.");
    assert.strictEqual(fazerSupplier.supplierGateEnabled, true, "FazerCards supplier switch must be explicitly true.");

    for (const supplierCode of ["WONDD", "FAZERCARDS"]) {
        assert.strictEqual(effective(supplierCode, false).effectiveGateEnabled, true, `${supplierCode} must not require a product gate in SUPPLIER_ONLY.`);
        assert.strictEqual(effective(supplierCode, true).effectiveGateEnabled, true, `${supplierCode} product gate=true must produce the same result in SUPPLIER_ONLY.`);
    }

    await withProcessEnv({ WONDD_AUTO_FULFILLMENT_ENABLED: "false" }, async () => {
        assert.strictEqual(effective("WONDD", true).effectiveGateEnabled, false);
        assert.strictEqual(effective("WONDD", false).blockerCode, "SUPPLIER_AUTO_FULFILLMENT_DISABLED");
    });
    await withProcessEnv({ FAZERCARDS_AUTO_FULFILLMENT_ENABLED: "false" }, async () => {
        assert.strictEqual(effective("FAZERCARDS", true).effectiveGateEnabled, false);
        assert.strictEqual(effective("FAZERCARDS", false).blockerCode, "SUPPLIER_AUTO_FULFILLMENT_DISABLED");
    });
    for (const value of [undefined, "", "yes", "1", "tru", "enabled"]) {
        await withProcessEnv({ WONDD_AUTO_FULFILLMENT_ENABLED: value }, async () => {
            assert.strictEqual(effective("WONDD", true).effectiveGateEnabled, false, "Missing or malformed supplier switch must fail closed.");
        });
    }
    assert.strictEqual(effectiveAutoFulfillmentGateState({ supplierCode: "UNKNOWN", productGateEnabled: true, env: process.env }).effectiveGateEnabled, false);

    const wonddPayload = createWonddAdapter({ env: {} }).buildTopupPayload({ productCode: "mlbb", serviceCode: "mlbb", packCode: "MLFT055", gameId: "123456 789" });
    assert.deepStrictEqual(Object.keys(wonddPayload).sort(), ["gameid", "method", "packcode", "servicecode"]);
    for (const forbidden of ["region", "country", "customerMarket"]) assert.strictEqual(Object.hasOwn(wonddPayload, forbidden), false);
    const fazerPayload = createFazerCardsAdapter({ env: {} }).buildTopupPayload({ categoryId: "mobile_legends_global", offerId: "ML86", fields: { player_id: "123456", server_id: "789" } });
    assert.deepStrictEqual(fazerPayload, { category_id: "mobile_legends_global", offer_id: "ML86", fields: { player_id: "123456", server_id: "789" } });

    for (const [key, value] of originalEnvironment) {
        assert.strictEqual(Object.hasOwn(process.env, key) ? process.env[key] : undefined, value, `Verifier must restore process.env.${key}.`);
    }

    console.log(JSON.stringify({
        result: "PASS",
        mode,
        wonddSupplierGateEnabled: wonddSupplier.supplierGateEnabled,
        fazerCardsSupplierGateEnabled: fazerSupplier.supplierGateEnabled,
        productGateAuthorizationEffect: 0,
        wonddFalseBlocks: true,
        fazerCardsFalseBlocks: true,
        missingSupplierGateFailsClosed: true,
        malformedSupplierGateFailsClosed: true,
        unknownSupplierFailsClosed: true,
        dualReadPreserved: routingMode === FULFILLMENT_ROUTING_MODES.DUAL_READ,
        mmPilotPreserved: pilotEnabled,
        wonddPayloadChanged: false,
        fazerCardsPayloadChanged: false,
        providerCalls: 0,
        supplierTransactionalCalls: 0,
        databaseWrites: 0,
        orderCreations: 0,
        fulfillmentAttemptCreations: 0,
        supplierMappingMutations: 0,
        pricingMutations: 0,
        renderEnvironmentMutations: 0
    }, null, 2));
}

main().catch(error => {
    console.error(`VERIFY_PHASE5C_PRODUCTION_CUTOVER_FAILED: ${error.message}`);
    process.exitCode = 1;
});

module.exports = Object.freeze({ withProcessEnv });
