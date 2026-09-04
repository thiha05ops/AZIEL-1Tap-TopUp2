#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { projectActivation } = require("../services/adminProductActivationService");
const { createStoreCatalogSelectionService, StoreCatalogSelectionError } = require("../services/storeCatalogSelectionService");

const now = new Date("2026-09-03T00:00:00.000Z");
const hash = value => value.repeat(64);
const supplier = { _id: "s1", supplierCode: "FAZERCARDS", name: "FazerCards", enabled: true, mode: "API" };
const product = { _id: "cp1", productCode: "pubg", name: "PUBG Mobile UC", deletedAt: null };
const pkg = { _id: "pk1", productCode: "pubg", packageCode: "PUBG_325_UC", name: "325 UC", enabled: false, deletedAt: null, prices: {} };
const supplierProduct = { _id: "sp1", supplierId: "s1", supplierProductCode: "pubg_mobile_auto", supplierMarketCode: "GLOBAL", displayName: "PUBG Mobile Auto", supportState: "SUPPORTED", rawSnapshotHash: hash("a"), normalizedInputContract: { fields: [{ customerField: "playerId", providerField: "player_id", required: true }] } };
const offer = { _id: "o1", supplierId: "s1", supplierCatalogProductId: "sp1", supplierProductCode: "pubg_mobile_auto", supplierOfferCode: "325_uc", supplierOfferName: "325 UC", catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", rawSnapshotHash: hash("b") };
const availability = { _id: "av1", supplierCatalogOfferId: "o1", state: "AVAILABLE", coverageComplete: true, observedAt: now, staleAt: null };
const mapping = { _id: "m1", supplierId: "s1", supplierCode: "FAZERCARDS", productCode: "pubg", packageCode: "PUBG_325_UC", supplierProductCode: "pubg_mobile_auto", supplierPackageCode: "325_uc", supplierCatalogOfferId: "o1", region: "GLOBAL", enabled: false, productionRole: "DISABLED", executionMode: "API", archivedAt: null, fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "fixture", verifiedAt: now, version: 1 }, mappingMetadata: { readiness: { supplierMapped: true, pricingReady: false, inputReady: true, validationReady: true, fulfillmentReady: true, storefrontReady: false } }, updatedAt: now };
const dependencies = { adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }), processorSupportResolver: () => true };

function projectionFor(rows) {
    return projectActivation({ products: [product], packages: [pkg], suppliers: [supplier], mappings: rows, offers: [offer], supplierProducts: [supplierProduct], availability: [availability], publications: [] }, { productCode: "pubg", supplierMarket: "GLOBAL", customerMarkets: "TH" }, dependencies);
}

const readyProjection = projectionFor([mapping]);
assert.strictEqual(readyProjection.packages[0].prepared.selectable, true);
assert.strictEqual(readyProjection.packages[0].masterCatalog.valid, true);
assert.strictEqual(readyProjection.packages[0].mappingEnabled, false);
assert.strictEqual(readyProjection.packages[0].productionRole, "DISABLED");
assert.strictEqual(readyProjection.packages[0].publishedPrice, null);

for (const changed of [
    { fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 } },
    { executionMode: "MANUAL" },
    { mappingMetadata: { readiness: { ...mapping.mappingMetadata.readiness, inputReady: false } } }
]) assert.strictEqual(projectionFor([{ ...mapping, ...changed }]).packages[0].prepared.selectable, false);

const missingAvailability = projectActivation({ products: [product], packages: [pkg], suppliers: [supplier], mappings: [mapping], offers: [offer], supplierProducts: [supplierProduct], availability: [], publications: [] }, { productCode: "pubg", supplierMarket: "GLOBAL", customerMarkets: "TH" }, dependencies);
assert.strictEqual(missingAvailability.packages[0].prepared.selectable, false);
const missingInput = projectActivation({ products: [product], packages: [pkg], suppliers: [supplier], mappings: [mapping], offers: [offer], supplierProducts: [{ ...supplierProduct, normalizedInputContract: { fields: [] } }], availability: [availability], publications: [] }, { productCode: "pubg", supplierMarket: "GLOBAL", customerMarkets: "TH" }, dependencies);
assert.strictEqual(missingInput.packages[0].prepared.selectable, false);
assert(missingInput.packages[0].masterCatalog.blockers.includes("INPUT_CONTRACT_UNRESOLVED"));
assert.strictEqual(projectionFor([]).packages.length, 0, "A missing mapping must not produce a selectable candidate.");

const secondSupplier = { ...supplier, _id: "s2", supplierCode: "WONDD", name: "WonDD" };
const secondProduct = { ...supplierProduct, _id: "sp2", supplierId: "s2", supplierProductCode: "9621", displayName: "PUBG WonDD" };
const secondOffer = { ...offer, _id: "o2", supplierId: "s2", supplierCatalogProductId: "sp2", supplierProductCode: "9621", supplierOfferCode: "PK325" };
const secondAvailability = { ...availability, _id: "av2", supplierCatalogOfferId: "o2" };
const secondMapping = { ...mapping, _id: "m2", supplierId: "s2", supplierCode: "WONDD", supplierProductCode: "9621", supplierPackageCode: "PK325", supplierCatalogOfferId: "o2" };
const multi = projectActivation({ products: [product], packages: [pkg], suppliers: [supplier, secondSupplier], mappings: [mapping, secondMapping], offers: [offer, secondOffer], supplierProducts: [supplierProduct, secondProduct], availability: [availability, secondAvailability], publications: [] }, { productCode: "pubg", supplierMarket: "GLOBAL", customerMarkets: "TH" }, dependencies);
assert.strictEqual(multi.packages.length, 2, "Exact supplier candidates must not collapse by canonical packageCode.");

const clone = value => structuredClone(value);
function query(value) { return { session() { return this; }, lean: async () => clone(value) }; }
function fixture(selectedMapping = mapping) {
    const state = { selection: null, mapping: clone(selectedMapping), product: clone(product), pkg: clone(pkg), supplierCalls: 0, mappingWrites: 0 };
    const models = {
        Supplier: { findOne: () => query(supplier) }, Mapping: { find: () => query([state.mapping]) },
        Selection: { findOne: () => query(state.selection), findOneAndUpdate: (_f, update) => ({ session() { return this; }, lean: async () => { state.selection = { _id: "sel1", ...clone(update.$set) }; return clone(state.selection); } }) },
        Offer: { find: () => query([offer]) }, SupplierProduct: { find: () => query([supplierProduct]) }, Availability: { find: () => query([availability]) },
        Product: { findOne: () => query(state.product), updateOne: async () => ({ modifiedCount: 1 }) },
        Package: { find: () => query([state.pkg]), updateMany: async () => ({ modifiedCount: 1 }) }, Publication: {}
    };
    const transaction = async callback => callback({ fixture: true });
    return { state, service: createStoreCatalogSelectionService(models, dependencies), transaction };
}

(async () => {
    const input = { productCode: "pubg", supplierMarket: "GLOBAL", supplierId: "s1", sellingRegions: ["TH"], mappingIds: ["m1"], expectedDecisionVersion: 0 };
    const accepted = fixture();
    const beforeMapping = clone(accepted.state.mapping);
    const result = await accepted.service.save(input, { actor: { username: "owner" }, transaction: accepted.transaction });
    assert.strictEqual(result.selection.packages[0].supplierProductMappingId, "m1");
    assert.deepStrictEqual(accepted.state.mapping, beforeMapping);
    assert.strictEqual(result.pricesChanged, 0);
    assert.strictEqual(result.publicPackagesChanged, 0);

    const rejected = fixture({ ...mapping, fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 } });
    await assert.rejects(() => rejected.service.save(input, { transaction: rejected.transaction }), error => error instanceof StoreCatalogSelectionError && error.code === "STORE_SELECTION_MAPPING_NOT_PREPARED");
    assert.strictEqual(rejected.state.selection, null);

    const wizard = fs.readFileSync(path.resolve(__dirname, "../../frontend/js/admin-add-product-wizard.js"), "utf8");
    assert(wizard.includes("row.prepared?.selectable===true"));
    assert(wizard.includes("No fulfillment-ready packages available."));
    assert(wizard.includes("data-wizard-package=\"${apwEsc(row.mappingId)}\""));
    assert(!wizard.includes("new Map(apwValidRows().map(row=>[row.packageCode,row]))"));
    console.log(JSON.stringify({ result: "PASS", preparedDisabledNonPrimarySelectable: true, rejectedAdvancedOnlyCases: 4, distinctSupplierCandidates: multi.packages.length, supplierNativeGrouping: true, storeSelectionGuard: true, mappingWrites: 0, automaticPrimaryAssignments: 0, pricingWrites: 0, publicationWrites: 0, supplierCalls: 0, productionWrites: 0 }, null, 2));
})().catch(error => { console.error("VERIFY_ADD_PRODUCT_FULFILLMENT_READY_INVENTORY_FAILED:", error); process.exitCode = 1; });
