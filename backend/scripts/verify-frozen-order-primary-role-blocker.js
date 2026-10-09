"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { normalizeSupplierRouteSnapshot, ORDER_SNAPSHOT_ERROR_CODES } = require("../services/commerce/orderSnapshotRuntime");
const { READINESS_MODES, assessMappingReadiness } = require("../services/supplierMappingReadinessService");
const { createRoutingAuthority } = require("../services/supplierProductionSelectionService");
const { FULFILLMENT_ROUTING_MODES } = require("../config/fulfillmentRoutingMode");

const quote = { packageSnapshot: { gameCode: "mlbb", packageCode: "MLBB_86" }, commercialSnapshot: { region: "TH" } };
const route = {
    snapshotVersion: 2,
    routeType: "SUPPLIER_API",
    supplierMappingId: "66aa00000000000000000001",
    supplierId: "66aa00000000000000000002",
    supplierCode: "FAZERCARDS",
    productCode: "mlbb",
    packageCode: "MLBB_86",
    supplierMarket: "GLOBAL",
    customerMarket: "TH",
    supplierProductCode: "MLBB",
    supplierPackageCode: "86",
    executionMode: "API",
    selectedRole: "PRIMARY",
    selectedAt: "2026-10-03T00:00:00.000Z",
    eligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "test", verifiedAt: "2026-10-03T00:00:00.000Z", version: 1 }
};

assert.strictEqual(normalizeSupplierRouteSnapshot(route, quote).selectedRole, "PRIMARY", "PRIMARY frozen route must normalize today.");
const mappingAfterRoleChange = {
    _id: route.supplierMappingId, enabled: true, archivedAt: null, productionRole: "BACKUP",
    supplierCode: "WONDD", supplierProductCode: "mlbb", supplierPackageCode: "ML086", executionMode: "API",
    fulfillmentEligibility: route.eligibility,
    mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true } }
};
assert.strictEqual(String(mappingAfterRoleChange._id), route.supplierMappingId, "Frozen mapping identity remains exact after the role change.");
const frozenReadiness = assessMappingReadiness({ mode: READINESS_MODES.FROZEN_ORDER_EXECUTABLE, mapping: mappingAfterRoleChange, supplier: { supplierCode: "WONDD", enabled: true, mode: "API" }, customerMarket: "TH", adapter: { isConfigured: () => true, isAutoFulfillmentEnabled: () => true }, eligibilityOverride: route.eligibility });
assert.strictEqual(frozenReadiness.ready, true, "A later PRIMARY-to-BACKUP change must not invalidate an otherwise executable frozen route.");
assert.strictEqual(normalizeSupplierRouteSnapshot({ ...route, selectedRole: "PACKAGE_SUPPLIER_SELECTION" }, quote).selectedRole, "PACKAGE_SUPPLIER_SELECTION", "Explicit Storefront supplier selection must freeze successfully.");
assert.strictEqual(normalizeSupplierRouteSnapshot({ ...route, selectedRole: "UNIQUE_EXECUTABLE_ROUTE" }, quote).selectedRole, "UNIQUE_EXECUTABLE_ROUTE", "Automatically resolved unique route must freeze successfully.");
assert.throws(
    () => normalizeSupplierRouteSnapshot({ ...route, selectedRole: "BACKUP" }, quote),
    error => error.code === ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT,
    "A newly created snapshot must reject BACKUP as a routing authority."
);
assert.throws(
    () => normalizeSupplierRouteSnapshot({ ...route, selectedRole: "DISABLED" }, quote),
    error => error.code === ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT,
    "DISABLED must remain unsafe."
);
const fulfillment = fs.readFileSync(path.resolve(__dirname, "../services/fulfillmentService.js"), "utf8");
assert(fulfillment.includes('if (!routeSnapshot && mapping.productionRole !== "PRIMARY")'), "Only an unfrozen legacy start may depend on the mapping's current PRIMARY role.");
assert(fulfillment.includes("READINESS_MODES.FROZEN_ORDER_EXECUTABLE"), "Frozen execution must still revalidate disabled, archived, supplier, adapter, and execution safety.");

(async () => {
    let legacyCalls = 0;
    let selectedCalls = 0;
    const selectedResult = { ready: true, blockers: [], routeSnapshot: { ...route, selectedRole: "PACKAGE_SUPPLIER_SELECTION" } };
    const selectNewOrder = createRoutingAuthority({
        legacyResolver: async () => { legacyCalls += 1; throw new Error("Selected mode must not consult legacy routing."); },
        selectedResolver: async () => { selectedCalls += 1; return selectedResult; },
        modeResolver: () => FULFILLMENT_ROUTING_MODES.SELECTED
    });
    assert.strictEqual(await selectNewOrder({ productCode: "mlbb", packageCode: "MLBB_86", region: "TH" }), selectedResult, "New orders must obey explicit PackageSupplierSelection authority.");
    assert.strictEqual(selectedCalls, 1);
    assert.strictEqual(legacyCalls, 0);
    const disabled = assessMappingReadiness({ mode: READINESS_MODES.FROZEN_ORDER_EXECUTABLE, mapping: { ...mappingAfterRoleChange, enabled: false }, supplier: { supplierCode: "WONDD", enabled: true, mode: "API" }, customerMarket: "TH", adapter: { isConfigured: () => true, isAutoFulfillmentEnabled: () => true }, eligibilityOverride: route.eligibility });
    assert(disabled.blockers.includes("MAPPING_DISABLED"), "Disabled frozen mappings must still fail safely.");
    console.log("PASS explicit new-order authority and immutable executable frozen BACKUP route; disabled remains unsafe");
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
