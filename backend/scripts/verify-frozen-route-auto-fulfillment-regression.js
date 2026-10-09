#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { contractFingerprint } = require("../services/suppliers/fazercardsFulfillmentContractService");
const { READINESS_MODES, assessMappingReadiness } = require("../services/supplierMappingReadinessService");
const { isMarketDecoupledV2RouteSnapshot } = require("../services/fulfillmentService");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function verifiedContract(supplierCode, protocol, transactionalServiceCode = "") {
    const contract = {
        version: 1,
        decisionVersion: 1,
        supplierCode,
        protocol,
        transactionalServiceCode,
        supplierProductCode: supplierCode === "WONDD" ? "9622" : "mobile_legends_global",
        sourceSupplierCatalogProductId: "supplier-product-1",
        sourceHash: "source-hash",
        sourceOfferHash: "offer-hash",
        authorityScope: "PRODUCT",
        noCustomerInput: false,
        fields: [{ customerField: "playerId", providerField: supplierCode === "WONDD" ? "gameid" : "player_id", required: true, label: "Player ID", type: "numeric-text", options: [], constraints: {}, evidenceReference: "verified fixture", transformationId: "DIRECT" }]
    };
    contract.fingerprint = contractFingerprint(contract);
    return contract;
}

function mapping(supplierCode) {
    return {
        _id: `${supplierCode.toLowerCase()}-mapping`,
        supplierId: `${supplierCode.toLowerCase()}-supplier`,
        supplierCode,
        productCode: "mlbb",
        packageCode: "MLBB.PACKAGE.1",
        supplierProductCode: supplierCode === "WONDD" ? "9622" : "mobile_legends_global",
        supplierPackageCode: supplierCode === "WONDD" ? "WONDD-PACK-1" : "FAZER-PACK-1",
        region: "GLOBAL",
        enabled: true,
        archivedAt: null,
        executionMode: "API",
        fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH", "MM"] },
        mappingMetadata: {
            readiness: { supplierMapped: true, inputReady: true, pricingReady: false, fulfillmentReady: true },
            fulfillmentContract: verifiedContract(supplierCode, supplierCode === "WONDD" ? "WONDD_GAME_ID_TOPUP" : "FAZERCARDS_TOPUPS_ORDER_V2", supplierCode === "WONDD" ? "mlbb" : "")
        }
    };
}

function supplier(supplierCode) {
    return { _id: `${supplierCode.toLowerCase()}-supplier`, supplierCode, enabled: true, mode: "API" };
}

function adapter(enabled = true) {
    return { isConfigured: () => true, isAutoFulfillmentEnabled: () => enabled };
}

function routeSnapshot(value, customerMarket) {
    return {
        snapshotVersion: 2,
        routeType: "SUPPLIER_API",
        supplierMappingId: value._id,
        supplierId: value.supplierId,
        supplierCode: value.supplierCode,
        productCode: value.productCode,
        packageCode: value.packageCode,
        supplierProductCode: value.supplierProductCode,
        supplierPackageCode: value.supplierPackageCode,
        supplierMarket: value.region,
        customerMarket,
        executionMode: "API",
        selectedRole: "PACKAGE_SUPPLIER_SELECTION",
        fulfillmentContract: value.mappingMetadata.fulfillmentContract
    };
}

for (const supplierCode of ["WONDD", "FAZERCARDS"]) {
    const value = mapping(supplierCode);
    for (const customerMarket of ["TH", "MM"]) {
        const before = structuredClone(value);
        const result = assessMappingReadiness({
            mode: READINESS_MODES.FROZEN_ORDER_EXECUTABLE,
            mapping: value,
            supplier: supplier(supplierCode),
            customerMarket,
            adapter: adapter(true),
            // These public-commerce inputs are deliberately invalid. They must not
            // revoke an already paid order's exact, safe frozen supplier route.
            pkg: { enabled: false, prices: { [customerMarket]: { enabled: false, amount: 0 } } },
            publication: null,
            selection: null
        });
        assert.deepStrictEqual(result, { ready: true, blockers: [], mode: "FROZEN_ORDER_EXECUTABLE" }, `${supplierCode}/${customerMarket} frozen execution must ignore pricing/publication state.`);
        assert.strictEqual(isMarketDecoupledV2RouteSnapshot({ routeSnapshot: routeSnapshot(value, customerMarket), mapping: value, customerMarket }), true, `${supplierCode}/${customerMarket} exact frozen native identity must match.`);
        assert.deepStrictEqual(value, before, "Readiness and fulfillment must not mutate PackageSupplierSelection or mapping authority.");
    }

    assert(assessMappingReadiness({ mode: READINESS_MODES.FROZEN_ORDER_EXECUTABLE, mapping: { ...value, enabled: false }, supplier: supplier(supplierCode), customerMarket: "TH", adapter: adapter(true) }).blockers.includes("MAPPING_DISABLED"));
    assert(assessMappingReadiness({ mode: READINESS_MODES.FROZEN_ORDER_EXECUTABLE, mapping: value, supplier: supplier(supplierCode), customerMarket: "TH", adapter: adapter(false) }).blockers.includes("PROVIDER_FEATURE_GATE_OFF"));
    assert.strictEqual(isMarketDecoupledV2RouteSnapshot({ routeSnapshot: { ...routeSnapshot(value, "TH"), supplierPackageCode: "WRONG-NATIVE-PACKAGE" }, mapping: value, customerMarket: "TH" }), false, "A mismatched supplier-native package must fail exact frozen identity validation.");
}

const fulfillmentSource = read("backend/services/fulfillmentService.js");
const declaration = fulfillmentSource.indexOf("const capabilityProductCode = supplierCapabilityProductCode(mapping, supplier);");
const gateUse = fulfillmentSource.indexOf("adapter.isAutoFulfillmentEnabled(capabilityProductCode)", declaration);
assert(declaration >= 0 && gateUse > declaration, "WonDD must derive its gate identity before using it; otherwise a valid route throws ReferenceError before attempt creation.");
assert(fulfillmentSource.includes("supplierMappingId: mapping._id") && fulfillmentSource.includes("supplierPackageCode: mapping.supplierPackageCode"), "FulfillmentAttempt must preserve the exact frozen mapping and supplier-native package.");

console.log(JSON.stringify({
    result: "PASS",
    suppliers: ["WONDD", "FAZERCARDS"],
    customerMarkets: ["TH", "MM"],
    pricingPublicationIgnoredForFrozenExecution: true,
    invalidMappingRejected: true,
    nativePackageMismatchRejected: true,
    packageSupplierSelectionWrites: 0,
    providerCalls: 0,
    productionWrites: 0
}, null, 2));
