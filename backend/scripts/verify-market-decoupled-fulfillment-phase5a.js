#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { evaluateFutureAuthority, CLASSIFICATIONS } = require("../services/futureSupplierAuthorityAuditService");
const { summarizeEligibilityResolution } = require("../services/supplierEligibilityRouteResolver");
const { normalizeSupplierRouteSnapshot } = require("../services/commerce/orderSnapshotRuntime");
const { resolveFulfillmentRoutingMode } = require("../config/fulfillmentRoutingMode");
const { isPilotEnabled } = require("../config/mmWonddMlbbPilot");
const { resolveSupplierGateMode } = require("../config/supplierAutoFulfillmentGate");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const now = new Date("2026-08-28T12:00:00.000Z");
const eligibility = mode => ({ mode, allowedCustomerMarkets: mode === "CUSTOMER_MARKET_ALLOWLIST" ? ["MM", "TH"] : [], evidenceCode: mode === "UNKNOWN" ? "LEGACY_EFFECTIVE_SCOPE" : "CONTROLLED_TEST", evidenceSource: "fixture", verifiedAt: now, version: 1 });
const mapping = overrides => ({ _id: "mapping-1", supplierCode: "WONDD", supplierId: "supplier-1", productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", supplierProductCode: "mlbb", supplierPackageCode: "MLFT055", region: "TH", enabled: true, archivedAt: null, executionMode: "API", productionRole: "PRIMARY", fulfillmentEligibility: eligibility("CUSTOMER_MARKET_ALLOWLIST"), supplierCostAuthority: { rawSupplierCost: 26, capturedAt: now }, mappingMetadata: { readiness: { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true }, costAuthorityMaximumAgeSeconds: 86400 }, ...overrides });

function verifyPureSimulator() {
    const supplier = { enabled: true, mode: "API" };
    const enabled = evaluateFutureAuthority({ mapping: mapping({}), supplier, currentProductGate: true, supplierLevelGate: true, adapterConfigured: true, processorReady: true, now });
    assert.strictEqual(enabled.classification, "MATCH_ENABLED");
    const unknown = evaluateFutureAuthority({ mapping: mapping({ fulfillmentEligibility: eligibility("UNKNOWN") }), supplier, currentProductGate: true, supplierLevelGate: true, adapterConfigured: true, processorReady: true, now });
    assert.strictEqual(unknown.classification, "UNKNOWN_ELIGIBILITY");
    const gateOnly = evaluateFutureAuthority({ mapping: mapping({}), supplier, currentProductGate: false, supplierLevelGate: true, adapterConfigured: true, processorReady: true, now });
    assert.strictEqual(gateOnly.classification, "FEATURE_GATE_ONLY_BLOCKER");
    assert(CLASSIFICATIONS.includes("REGION_COUPLED") && CLASSIFICATIONS.includes("AMBIGUOUS"));
}

function verifyCanonicalIdentityInvariant() {
    const mlbb = mapping({});
    const valorantTh = mapping({ _id: "valorant-th", productCode: "valorant-th", packageCode: "VAL_TH_100", supplierCode: "FAZERCARDS", supplierProductCode: "valorant_th", supplierPackageCode: "TH100" });
    const valorantMy = mapping({ _id: "valorant-my", productCode: "valorant-my", packageCode: "VAL_MY_100", supplierCode: "FAZERCARDS", supplierProductCode: "valorant_my", supplierPackageCode: "MY100" });
    const assessments = new Map([["mapping-1", { blockers: [] }], ["valorant-th", { blockers: [] }], ["valorant-my", { blockers: [] }]]);
    const crossMarket = summarizeEligibilityResolution({ mappings: [mlbb], assessments, productCode: "mlbb", packageCode: mlbb.packageCode, customerMarket: "MM" });
    assert.strictEqual(crossMarket.routeSnapshot.productCode, "mlbb");
    const th = summarizeEligibilityResolution({ mappings: [valorantTh, valorantMy], assessments, productCode: "valorant-th", packageCode: "VAL_TH_100", customerMarket: "MM" });
    assert.strictEqual(th.routeSnapshot.productCode, "valorant-th");
    assert.strictEqual(th.routeSnapshot.supplierProductCode, "valorant_th");
    assert.notStrictEqual(th.routeSnapshot.productCode, valorantMy.productCode, "Customer market must not substitute a different entitlement.");
}

function verifySnapshotCompatibility() {
    const quote = { packageSnapshot: { gameCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP" }, commercialSnapshot: { region: "MM" } };
    const common = { routeType: "SUPPLIER_API", supplierMappingId: "mapping-1", supplierId: "supplier-1", supplierCode: "WONDD", productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", supplierProductCode: "mlbb", supplierPackageCode: "MLFT055", executionMode: "API", selectedRole: "PRIMARY", selectedAt: now };
    const v1 = normalizeSupplierRouteSnapshot({ ...common, region: "MM" }, quote);
    const v2 = normalizeSupplierRouteSnapshot({ ...common, snapshotVersion: 2, customerMarket: "MM", eligibility: eligibility("CUSTOMER_MARKET_ALLOWLIST") }, quote);
    assert.strictEqual(v1.region, "MM");
    assert.strictEqual(v2.customerMarket, "MM");
}

function verifyProductionBoundaries() {
    assert.strictEqual(resolveFulfillmentRoutingMode({}), "LEGACY_REGION");
    assert.strictEqual(isPilotEnabled({}), false);
    const selection = read("backend/services/supplierProductionSelectionService.js");
    assert(selection.includes("resolveLegacyCheckoutRouteSnapshot"));
    assert(selection.includes("FULFILLMENT_ROUTING_MODES.DUAL_READ"));
    assert.strictEqual(resolveSupplierGateMode({}), "LEGACY_PRODUCT_ONLY", "Later supplier-gate phases must preserve the Phase 5A production baseline by default.");
    const audit = read("backend/scripts/audit-market-decoupled-fulfillment-phase5a.js");
    for (const forbidden of ["updateOne(", "updateMany(", "bulkWrite(", "save(", "submitTopup(", "/topups/order"]) assert(!audit.includes(forbidden), `Read-only audit contains forbidden operation ${forbidden}`);
    const paid = read("backend/services/paidFulfillmentRoutingService.js");
    assert(!paid.includes("resolveCheckoutRouteSnapshot"));
    assert(paid.includes("supplierMappingId"));
    const adapters = `${read("backend/services/suppliers/wonddAdapter.js")}\n${read("backend/services/suppliers/fazercardsAdapter.js")}`;
    for (const gate of ["WONDD_MLBB_AUTO_FULFILLMENT_ENABLED", "WONDD_FREEFIRE_AUTO_FULFILLMENT_ENABLED"]) assert(adapters.includes(gate));
    assert(adapters.includes("productGateKey") && adapters.includes("FAZERCARDS_${"), "FazerCards must retain an explicit derived per-product fulfillment gate.");
}

verifyPureSimulator();
verifyCanonicalIdentityInvariant();
verifySnapshotCompatibility();
verifyProductionBoundaries();
console.log(JSON.stringify({ result: "PASS", productionRoutingChanges: 0, routingMode: "LEGACY_REGION", dualReadChanged: false, phase4PilotChanged: false, eligibilityPrimaryActivated: false, productGatesPreserved: true, supplierGateDefaultPolicy: "LEGACY_PRODUCT_ONLY", simulatorReadOnly: true, canonicalIdentityRewrites: 0, v1Readable: true, v2Readable: true, snapshotBoundFulfillment: true, providerCalls: 0, databaseWrites: 0, environmentChanges: 0 }, null, 2));
