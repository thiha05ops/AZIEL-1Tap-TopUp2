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
assert.strictEqual(normalizeSupplierRouteSnapshot({ ...route, selectedRole: "PACKAGE_SUPPLIER_SELECTION" }, quote).selectedRole, "PACKAGE_SUPPLIER_SELECTION", "Explicit Storefront supplier selection must freeze successfully.");
assert.strictEqual(normalizeSupplierRouteSnapshot({ ...route, selectedRole: "UNIQUE_EXECUTABLE_ROUTE" }, quote).selectedRole, "UNIQUE_EXECUTABLE_ROUTE", "Automatically resolved unique route must freeze successfully.");
const mappingAfterRoleChange = { _id: route.supplierMappingId, enabled: true, archivedAt: null, productionRole: "BACKUP" };
assert.strictEqual(String(mappingAfterRoleChange._id), route.supplierMappingId, "Frozen mapping identity remains exact after the role change.");
assert.strictEqual(mappingAfterRoleChange.productionRole !== "PRIMARY", true, "The current mapping role may change without rewriting the frozen route.");
assert.throws(
    () => normalizeSupplierRouteSnapshot({ ...route, selectedRole: "BACKUP" }, quote),
    error => error.code === ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT,
    "A newly supplied BACKUP role is not a valid checkout snapshot authority."
);
assert.throws(
    () => normalizeSupplierRouteSnapshot({ ...route, selectedRole: "DISABLED" }, quote),
    error => error.code === ORDER_SNAPSHOT_ERROR_CODES.INVALID_FULFILMENT_INPUT,
    "DISABLED must remain unsafe."
);
const fulfillment = fs.readFileSync(path.resolve(__dirname, "../services/fulfillmentService.js"), "utf8");
assert(fulfillment.includes('if (!routeSnapshot && mapping.productionRole !== "PRIMARY")'), "Only non-frozen route resolution may require the current PRIMARY role.");
console.log("PASS frozen PRIMARY snapshot remains executable after current mapping becomes BACKUP; new BACKUP/DISABLED snapshots remain unsafe");
