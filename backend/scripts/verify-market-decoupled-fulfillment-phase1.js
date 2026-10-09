#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const CommerceOrder = require("../models/CommerceOrder");
const {
    normalizeFulfillmentEligibility,
    validateFulfillmentEligibility,
    isCustomerMarketEligible
} = require("../services/supplierFulfillmentEligibilityService");
const { normalizeSupplierRouteSnapshot } = require("../services/commerce/orderSnapshotRuntime");
const { ensurePaidOrderFulfillmentWork } = require("../services/paidFulfillmentRoutingService");
const { FULFILLMENT_ROUTING_MODES, resolveFulfillmentRoutingMode } = require("../config/fulfillmentRoutingMode");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const SELECTED_AT = "2026-08-28T00:00:00.000Z";

function mappingData(overrides = {}) {
    return {
        supplierId: "507f1f77bcf86cd799439011",
        supplierCode: "WONDD",
        productCode: "mlbb",
        packageCode: "MLBB_55_DIA_FIRST_TOPUP",
        supplierProductCode: "mlbb",
        supplierPackageCode: "MLFT055",
        region: "TH",
        ...overrides
    };
}

function routeV1(overrides = {}) {
    return {
        routeType: "SUPPLIER_API",
        supplierMappingId: "mapping-wondd-mlft055",
        supplierId: "supplier-wondd",
        supplierCode: "WONDD",
        productCode: "mlbb",
        packageCode: "MLBB_55_DIA_FIRST_TOPUP",
        region: "TH",
        supplierProductCode: "mlbb",
        supplierPackageCode: "MLFT055",
        executionMode: "API",
        selectedRole: "PRIMARY",
        selectedAt: SELECTED_AT,
        ...overrides
    };
}

function routeV2(overrides = {}) {
    return {
        ...routeV1(),
        snapshotVersion: 2,
        customerMarket: "MM",
        eligibility: {
            mode: "CUSTOMER_MARKET_ALLOWLIST",
            allowedCustomerMarkets: ["TH", "MM"],
            evidenceCode: "CONTROLLED_TEST",
            evidenceSource: "phase-1-fixture",
            verifiedAt: SELECTED_AT,
            version: 1
        },
        ...overrides,
        region: undefined
    };
}

function quoteAuthority(region) {
    return {
        packageSnapshot: { gameCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP" },
        commercialSnapshot: { region }
    };
}

async function verifySchemaCompatibility() {
    const legacy = new SupplierProductMapping(mappingData());
    assert.strictEqual(legacy.fulfillmentEligibility, undefined, "Existing mapping shape must not receive implicit eligibility.");
    await legacy.validate();
    assert.strictEqual(legacy.region, "TH", "Legacy mapping.region remains required and unchanged.");

    const valid = new SupplierProductMapping(mappingData({ fulfillmentEligibility: {
        mode: "CUSTOMER_MARKET_ALLOWLIST",
        allowedCustomerMarkets: ["TH"],
        evidenceCode: "LEGACY_EFFECTIVE_SCOPE",
        evidenceSource: "fixture",
        version: 1
    } }));
    await valid.validate();

    const malformed = new SupplierProductMapping(mappingData({ fulfillmentEligibility: {
        mode: "GLOBAL",
        allowedCustomerMarkets: ["TH"],
        version: 1
    } }));
    await assert.rejects(() => malformed.validate(), /allowedCustomerMarkets/);
}

function verifyEligibilitySemantics() {
    const unknown = { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", version: 1 };
    const global = { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", version: 1 };
    const allowlist = { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "LEGACY_EFFECTIVE_SCOPE", version: 1 };
    assert.strictEqual(isCustomerMarketEligible(unknown, "TH"), false);
    assert.strictEqual(isCustomerMarketEligible(global, "TH"), true);
    assert.strictEqual(isCustomerMarketEligible(global, "MM"), true);
    assert.strictEqual(isCustomerMarketEligible(allowlist, "TH"), true);
    assert.strictEqual(isCustomerMarketEligible(allowlist, "MM"), false);
    assert.strictEqual(isCustomerMarketEligible(undefined, "TH"), false);
    assert.strictEqual(isCustomerMarketEligible({ mode: "GLOBAL", allowedCustomerMarkets: ["TH"], version: 1 }, "TH"), false);
    assert.strictEqual(isCustomerMarketEligible({ mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["SG"], version: 1 }, "SG"), false);
    assert.strictEqual(validateFulfillmentEligibility(undefined).valid, false);
    assert.deepStrictEqual(normalizeFulfillmentEligibility(unknown).allowedCustomerMarkets, []);
}

function verifySnapshotCompatibility() {
    const v1 = routeV1();
    const normalizedV1 = normalizeSupplierRouteSnapshot(v1, quoteAuthority("TH"));
    assert.strictEqual(normalizedV1.snapshotVersion, undefined, "V1 shape must not be rewritten or version-stamped.");
    assert.strictEqual(normalizedV1.region, "TH");
    assert.strictEqual(normalizedV1.supplierPackageCode, "MLFT055");

    const v2 = normalizeSupplierRouteSnapshot(routeV2(), quoteAuthority("MM"));
    assert.strictEqual(v2.snapshotVersion, 2);
    assert.strictEqual(v2.customerMarket, "MM");
    assert.strictEqual(v2.region, undefined);
    assert.strictEqual(v2.supplierMappingId, "mapping-wondd-mlft055");
    assert.strictEqual(v2.supplierProductCode, "mlbb");
    assert.strictEqual(v2.supplierPackageCode, "MLFT055");
    assert.strictEqual(v2.eligibility.mode, "CUSTOMER_MARKET_ALLOWLIST");
    assert.deepStrictEqual(v2.eligibility.allowedCustomerMarkets, ["MM", "TH"]);
    assert.throws(() => normalizeSupplierRouteSnapshot(routeV2({ supplierPackageCode: "" }), quoteAuthority("MM")), /exact provider identity/);
    assert.throws(() => normalizeSupplierRouteSnapshot(routeV2({ customerMarket: "TH" }), quoteAuthority("MM")), /quoted package authority/);

    const hydrated = CommerceOrder.hydrate({ fulfilment: { status: "completed", routeSnapshot: v1 } });
    assert.deepStrictEqual(hydrated.fulfilment.routeSnapshot, v1, "Historical mixed v1 snapshot must hydrate without rewriting.");
}

async function verifyPaidV2Compatibility() {
    let starts = 0;
    const order = {
        _id: "order-id",
        orderId: "AZL-PHASE1-V2",
        schemaVersion: "1",
        commerce: { source: "QUOTE_CHECKOUT" },
        product: { gameCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP" },
        commercial: { region: "MM" },
        paymentStatus: "paid",
        status: "paid",
        fulfilment: { status: "not_started", routeSnapshot: routeV2() }
    };
    const result = await ensurePaidOrderFulfillmentWork(order, {
        findAttemptByIdempotency: async () => null,
        startSupplierFulfillment: async (_orderId, payload) => {
            starts += 1;
            assert.strictEqual(payload.mappingId, "mapping-wondd-mlft055");
            return { status: "IN_PROGRESS", supplierMappingId: payload.mappingId };
        }
    });
    assert.strictEqual(result.reason, "SUPPLIER_FULFILLMENT_STARTED");
    assert.strictEqual(starts, 1);
}

function verifyDormantModeAndBoundaries() {
    assert.strictEqual(resolveFulfillmentRoutingMode({}), FULFILLMENT_ROUTING_MODES.LEGACY_REGION);
    assert.strictEqual(resolveFulfillmentRoutingMode({ AZIEL_FULFILLMENT_ROUTING_MODE: "LEGACY_REGION" }), FULFILLMENT_ROUTING_MODES.LEGACY_REGION);
    assert.throws(() => resolveFulfillmentRoutingMode({ AZIEL_FULFILLMENT_ROUTING_MODE: "INVALID" }), /Unsupported fulfillment routing mode/);

    const selection = read("backend/services/supplierProductionSelectionService.js");
    assert(!selection.includes("supplierFulfillmentEligibilityService"), "Phase 1 must not wire eligibility into production selection.");
    assert(selection.includes("region: clean(region).toUpperCase()"), "Legacy PRIMARY lookup must remain region-bound.");
    assert(selection.includes("region: mapping.region"), "Legacy route snapshots must remain v1.");
    assert(selection.includes("pilotSelected") && selection.includes("snapshotVersion: 2"), "Any later-phase v2 emission must remain behind the exact scoped pilot boundary.");
    const pilot = read("backend/config/mmWonddMlbbPilot.js");
    assert(pilot.includes('AZIEL_MM_WONDD_MLBB_PILOT_ENABLED') && pilot.includes('=== "true"'), "The Phase 4 pilot must remain false by default and explicitly enabled.");

    const capability = read("backend/services/fulfillmentCapabilityService.js");
    assert(capability.includes("normalizeRegion(mapping.region) !== normalizedRegion"), "MM routing must remain inactive in Phase 1.");
    const wondd = read("backend/services/fulfillmentCapabilityService.js");
    assert(wondd.includes('String(mapping.region || "").trim().toUpperCase() === "TH"'), "WonDD TH guard must remain.");
    const fazer = read("backend/services/suppliers/fazercardsFulfillmentProcessor.js");
    assert(fazer.includes('mapping.region !== "TH"'), "FazerCards TH guard must remain.");

    const wallet = read("backend/services/commerce/customerWalletCheckoutService.js");
    const promptPay = read("backend/services/commerce/customerManualPromptPayCheckoutService.js");
    assert(wallet.includes('return region === "TH" ? "THB" : "MMK"'));
    assert(promptPay.includes('return region === "TH" ? "THB" : "MMK"'));
    assert(promptPay.includes('if (region !== "TH" || requestedKey !== "promptpay")'));
}

(async () => {
    await verifySchemaCompatibility();
    verifyEligibilitySemantics();
    verifySnapshotCompatibility();
    await verifyPaidV2Compatibility();
    verifyDormantModeAndBoundaries();
    console.log(JSON.stringify({
        result: "PASS",
        routingMode: resolveFulfillmentRoutingMode({}),
        legacyMappingsCompatible: true,
        v1SnapshotsCompatible: true,
        v2SnapshotsSupported: true,
        mmAutomaticRoutingActivated: false,
        databaseMutations: 0,
        providerCalls: 0
    }, null, 2));
})().catch(error => {
    console.error(`VERIFY_MARKET_DECOUPLED_FULFILLMENT_PHASE1_FAILED: ${error.stack || error.message}`);
    process.exitCode = 1;
});
