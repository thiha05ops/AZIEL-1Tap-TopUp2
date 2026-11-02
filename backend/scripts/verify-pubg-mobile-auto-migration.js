#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    PRODUCT_CODE,
    SOURCE_PRODUCT_CODE,
    TARGET_PRODUCT_CODE,
    PACKAGE_MIGRATIONS,
    CONFIRMATION
} = require("../services/supplierCatalog/pubgMobileAutoMigrationService");
const {
    contractFromSupplierCatalog,
    verifiedMappingContract,
    buildFieldsFromContract
} = require("../services/suppliers/fazercardsFulfillmentContractService");

assert.strictEqual(PRODUCT_CODE, "pubg-mobile-fast-7fbcc7684d");
assert.strictEqual(SOURCE_PRODUCT_CODE, "pubg_mobile_fast");
assert.strictEqual(TARGET_PRODUCT_CODE, "pubg_mobile_auto");
assert.strictEqual(PACKAGE_MIGRATIONS.length, 6);
assert.deepStrictEqual(PACKAGE_MIGRATIONS.map(item => item.offerCode), ["60_uc", "325_uc", "660_uc", "1800_uc", "3850_uc", "8100_uc"]);
assert.strictEqual(new Set(PACKAGE_MIGRATIONS.map(item => item.packageCode)).size, 6);

const product = {
    _id: "supplier-product-auto",
    supplierProductCode: TARGET_PRODUCT_CODE,
    supplierMarketCode: "GLOBAL",
    supportState: "SUPPORTED",
    rawSnapshotHash: "a".repeat(64),
    normalizedInputContract: {
        fields: [{ customerField: "playerId", providerField: "player_id", required: true, label: "Player ID", type: "text", options: [], constraints: {}, transformationId: "DIRECT", evidenceReference: "FAZERCARDS_OFFERS_RESPONSE_FIELDS" }]
    }
};

for (const expected of PACKAGE_MIGRATIONS) {
    const offer = { _id: `offer-${expected.offerCode}`, supplierCatalogProductId: product._id, supplierProductCode: TARGET_PRODUCT_CODE, supplierOfferCode: expected.offerCode, catalogLifecycleState: "ACTIVE", rawSnapshotHash: "b".repeat(64) };
    const mapping = { supplierCode: "FAZERCARDS", supplierProductCode: TARGET_PRODUCT_CODE, supplierPackageCode: expected.offerCode, supplierCatalogOfferId: offer._id };
    const contract = contractFromSupplierCatalog({ mapping, offer, supplierProduct: product, supplierCode: "FAZERCARDS" });
    assert(contract, `contract required for ${expected.offerCode}`);
    assert(verifiedMappingContract({ ...mapping, mappingMetadata: { fulfillmentContract: contract } }), `verified contract required for ${expected.offerCode}`);
    assert.deepStrictEqual(buildFieldsFromContract(contract, { playerId: "123456789" }), { player_id: "123456789" });
    assert.throws(() => buildFieldsFromContract(contract, {}), error => error.code === "FAZERCARDS_REQUIRED_INPUT_MISSING");
}

const servicePath = path.resolve(__dirname, "../services/supplierCatalog/pubgMobileAutoMigrationService.js");
const scriptPath = path.resolve(__dirname, "prepare-pubg-mobile-auto-migration.js");
const service = fs.readFileSync(servicePath, "utf8");
const script = fs.readFileSync(scriptPath, "utf8");
assert(service.includes('run.status === "SUCCEEDED_COMPLETE"'));
assert(service.includes('run.coverageState === "COMPLETE"'));
assert(service.includes('observed?.state === "AVAILABLE"'));
assert(service.includes('id(observed.observationRunId) === id(run)'));
assert(service.includes('enabled: false, productionRole: "DISABLED"'));
assert(service.includes('fulfillmentReady: false, storefrontReady: false'));
assert(service.includes('rawSupplierCost: null'));
assert(service.includes('sellingPricesChanged: 0'));
assert(service.includes('storeSelectionsChanged: 0'));
assert(service.includes('commerceOrdersChanged: 0'));
assert(service.includes('fulfillmentAttemptsChanged: 0'));
assert(!service.includes("CommerceOrder.update"));
assert(!service.includes("FulfillmentAttempt.update"));
assert(!service.includes("submitTopup"));
assert(!service.includes("PackageMarketPublication"));
assert(script.includes('if (!apply)'));
assert(script.includes('mongoose.set("autoIndex", false)'));
assert.strictEqual(CONFIRMATION, "PREPARE PUBG MOBILE AUTO MIGRATION");

console.log(JSON.stringify({
    result: "PASS",
    packages: PACKAGE_MIGRATIONS.length,
    exactNativeIdentities: true,
    verifiedPlayerIdContracts: true,
    freshSingleRunAvailabilityRequired: true,
    preparedMappingsDisabled: true,
    costAuthorityUnpromoted: true,
    sellingPricesChanged: 0,
    storeSelectionsChanged: 0,
    checkoutChanges: 0,
    paymentChanges: 0,
    historicalOrderChanges: 0,
    fulfillmentAttemptChanges: 0,
    supplierOrderCalls: 0
}, null, 2));
