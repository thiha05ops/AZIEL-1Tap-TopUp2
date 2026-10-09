"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { normalizeSupplierRouteSnapshot, ORDER_SNAPSHOT_ERROR_CODES } = require("../services/commerce/orderSnapshotRuntime");

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
const mappingAfterRoleChange = { _id: route.supplierMappingId, enabled: true, archivedAt: null, productionRole: "BACKUP" };
assert.strictEqual(String(mappingAfterRoleChange._id), route.supplierMappingId, "Frozen mapping identity remains exact after the role change.");
assert.strictEqual(mappingAfterRoleChange.productionRole !== "PRIMARY", true, "Current fulfillment will reject this otherwise unchanged frozen route solely on role.");
assert.throws(
    () => normalizeSupplierRouteSnapshot({ ...route, selectedRole: "BACKUP" }, quote),
    error => error.code === ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT && /PRIMARY/.test(error.message),
    "Current snapshot normalization must expose the pre-Phase-3 BACKUP role blocker."
);
assert.throws(
    () => normalizeSupplierRouteSnapshot({ ...route, selectedRole: "DISABLED" }, quote),
    error => error.code === ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT,
    "DISABLED must remain unsafe."
);
const fulfillment = fs.readFileSync(path.resolve(__dirname, "../services/fulfillmentService.js"), "utf8");
assert(fulfillment.includes('if (mapping.productionRole !== "PRIMARY") throw new FulfillmentError("SUPPLIER_MAPPING_NOT_PRIMARY"'), "Current fulfillment role-only rejection must remain visible until Phase 3.");
console.log("PASS documented pre-Phase-3 blocker: frozen BACKUP routes are rejected; DISABLED remains unsafe");
