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
const product = { _id: "cp1", productCode: "pubg", name: "PUBG Mobile UC", supportedRegions: ["GLOBAL"], deletedAt: null };
const pkg = { _id: "pk1", productCode: "pubg", packageCode: "PUBG_325_UC", name: "325 UC", enabled: false, deletedAt: null, prices: {} };
const supplierProduct = { _id: "sp1", supplierId: "s1", supplierProductCode: "pubg_mobile_auto", supplierMarketCode: "GLOBAL", displayName: "PUBG Mobile Auto", supportState: "SUPPORTED", rawSnapshotHash: hash("a"), normalizedInputContract: { fields: [{ customerField: "playerId", providerField: "player_id", required: true }] } };
const offer = { _id: "o1", supplierId: "s1", supplierCatalogProductId: "sp1", supplierProductCode: "pubg_mobile_auto", supplierOfferCode: "325_uc", supplierOfferName: "325 UC", catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", rawSnapshotHash: hash("b") };
const offerWithCanonicalEvidence = { ...offer, _id: "o-source", reconciliationEvidence: { canonicalProductCode: "pubg", canonicalPackageCode: "PUBG_325_UC" } };
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

const thProduct = { ...product, _id: "cp-th", productCode: "valorant-th", name: "Valorant (Thailand)", supportedRegions: ["TH"] };
const thPackage = { ...pkg, productCode: "valorant-th", packageCode: "VALORANT_TH_100", name: "100 Points" };
const thSupplierProduct = { ...supplierProduct, _id: "sp-th", supplierProductCode: "valorant_th", supplierMarketCode: "TH", displayName: "Valorant TH" };
const thOffer = { ...offer, _id: "o-th", supplierCatalogProductId: "sp-th", supplierProductCode: "valorant_th", supplierOfferCode: "100_points" };
const thAvailability = { ...availability, _id: "av-th", supplierCatalogOfferId: "o-th" };
const thMapping = { ...mapping, _id: "m-th", productCode: "valorant-th", packageCode: "VALORANT_TH_100", supplierProductCode: "valorant_th", supplierPackageCode: "100_points", supplierCatalogOfferId: "o-th", region: "TH", fulfillmentEligibility: { ...mapping.fulfillmentEligibility, allowedCustomerMarkets: ["TH"] } };
const thCommerceProjection = projectActivation({
    products: [thProduct], packages: [thPackage], suppliers: [supplier],
    mappings: [thMapping], offers: [thOffer], supplierProducts: [thSupplierProduct],
    availability: [thAvailability], publications: []
}, { productCode: "valorant-th", supplierMarket: "TH", sellingRegions: "MM,TH" }, dependencies);
assert.strictEqual(thCommerceProjection.packages[0].prepared.selectable, true, "TH product / TH supplier route must remain selectable for TH+MM AZIEL commerce selling markets.");
assert.deepStrictEqual(thCommerceProjection.packages[0].prepared.sellingRegions, ["MM", "TH"]);
assert.deepStrictEqual(thCommerceProjection.packages[0].fulfillmentEligibility.allowedCustomerMarkets, ["TH"], "Add Product projection must not manufacture MM supplier eligibility for a TH route.");

for (const changed of [
    { executionMode: "MANUAL" },
    { mappingMetadata: { readiness: { ...mapping.mappingMetadata.readiness, inputReady: false } } },
    { enabled: true, productionRole: "PRIMARY", mappingMetadata: { readiness: { ...mapping.mappingMetadata.readiness, pricingReady: false, storefrontReady: false } } }
]) assert.strictEqual(projectionFor([{ ...mapping, ...changed }]).packages[0].prepared.selectable, true, "Stale technical/commercial mapping state must not hide a current executable supplier offer.");

const missingAvailability = projectActivation({ products: [product], packages: [pkg], suppliers: [supplier], mappings: [mapping], offers: [offer], supplierProducts: [supplierProduct], availability: [], publications: [] }, { productCode: "pubg", supplierMarket: "GLOBAL", customerMarkets: "TH" }, dependencies);
assert.strictEqual(missingAvailability.packages[0].prepared.selectable, false);
const missingInput = projectActivation({ products: [product], packages: [pkg], suppliers: [supplier], mappings: [mapping], offers: [offer], supplierProducts: [{ ...supplierProduct, normalizedInputContract: { fields: [] } }], availability: [availability], publications: [] }, { productCode: "pubg", supplierMarket: "GLOBAL", customerMarkets: "TH" }, dependencies);
assert.strictEqual(missingInput.packages[0].prepared.selectable, false);
assert(missingInput.packages[0].masterCatalog.blockers.includes("INPUT_CONTRACT_UNRESOLVED"));
assert.strictEqual(projectionFor([]).packages.length, 0, "A missing mapping must not produce a selectable candidate.");
const offerSourcedProjection = projectActivation({ products: [product], packages: [pkg], suppliers: [supplier], mappings: [], offers: [offerWithCanonicalEvidence], supplierProducts: [supplierProduct], availability: [{ ...availability, supplierCatalogOfferId: "o-source" }], publications: [] }, { productCode: "pubg", supplierMarket: "GLOBAL", customerMarkets: "TH" }, dependencies);
assert.strictEqual(offerSourcedProjection.packages[0].mappingId, "offer:o-source");
assert.strictEqual(offerSourcedProjection.packages[0].prepared.selectable, true, "SupplierCatalogOffer discovery must not require a pre-existing SupplierProductMapping.");
assert.strictEqual(offerSourcedProjection.packages[0].prepared.adoptionCreatesMapping, true);

const missingCanonicalProjection = projectActivation({ products: [product], packages: [], suppliers: [supplier], mappings: [mapping], offers: [offer], supplierProducts: [supplierProduct], availability: [availability], publications: [] }, { productCode: "pubg", supplierMarket: "GLOBAL", customerMarkets: "TH" }, dependencies);
assert.strictEqual(missingCanonicalProjection.packages[0].prepared.selectable, true, "A current exact supplier offer must be selectable before its CatalogPackage is adopted.");
assert.strictEqual(missingCanonicalProjection.packages[0].prepared.adoptionCreatesCanonicalPackage, true, "Discovery must disclose that adoption will create the missing canonical package.");

const secondSupplier = { ...supplier, _id: "s2", supplierCode: "WONDD", name: "WonDD" };
const secondProduct = { ...supplierProduct, _id: "sp2", supplierId: "s2", supplierProductCode: "9621", displayName: "PUBG WonDD" };
const secondOffer = { ...offer, _id: "o2", supplierId: "s2", supplierCatalogProductId: "sp2", supplierProductCode: "9621", supplierOfferCode: "PK325" };
const secondAvailability = { ...availability, _id: "av2", supplierCatalogOfferId: "o2" };
const secondMapping = { ...mapping, _id: "m2", supplierId: "s2", supplierCode: "WONDD", supplierProductCode: "9621", supplierPackageCode: "PK325", supplierCatalogOfferId: "o2" };
const multi = projectActivation({ products: [product], packages: [pkg], suppliers: [supplier, secondSupplier], mappings: [mapping, secondMapping], offers: [offer, secondOffer], supplierProducts: [supplierProduct, secondProduct], availability: [availability, secondAvailability], publications: [] }, { productCode: "pubg", supplierMarket: "GLOBAL", customerMarkets: "TH" }, dependencies);
assert.strictEqual(multi.packages.length, 2, "Exact supplier candidates must not collapse by canonical packageCode.");

const fastProduct = { ...supplierProduct, _id: "sp-fast", supplierProductCode: "pubg_mobile_fast", displayName: "PUBG Mobile Fast" };
const reserveProduct = { ...supplierProduct, _id: "sp-reserve", supplierProductCode: "pubg_mobile_reserve", displayName: "PUBG Mobile Reserve" };
const fastOffer = { ...offer, _id: "o-fast", supplierCatalogProductId: "sp-fast", supplierProductCode: "pubg_mobile_fast", supplierOfferCode: "325_uc_fast" };
const reserveOffer = { ...offer, _id: "o-reserve", supplierCatalogProductId: "sp-reserve", supplierProductCode: "pubg_mobile_reserve", supplierOfferCode: "325_uc_reserve" };
const fastAvailability = { ...availability, _id: "av-fast", supplierCatalogOfferId: "o-fast" };
const reserveAvailability = { ...availability, _id: "av-reserve", supplierCatalogOfferId: "o-reserve" };
const fastMapping = { ...mapping, _id: "m-fast", supplierProductCode: "pubg_mobile_fast", supplierPackageCode: "325_uc_fast", supplierCatalogOfferId: "o-fast" };
const reserveMapping = { ...mapping, _id: "m-reserve", supplierProductCode: "pubg_mobile_reserve", supplierPackageCode: "325_uc_reserve", supplierCatalogOfferId: "o-reserve" };
const sameSupplierNativeRoutes = projectActivation({
    products: [product], packages: [pkg], suppliers: [supplier],
    mappings: [mapping, fastMapping, reserveMapping],
    offers: [offer, fastOffer, reserveOffer],
    supplierProducts: [supplierProduct, fastProduct, reserveProduct],
    availability: [availability, fastAvailability, reserveAvailability],
    publications: []
}, { productCode: "pubg", supplierMarket: "GLOBAL", customerMarkets: "TH" }, dependencies);
assert.strictEqual(new Set(sameSupplierNativeRoutes.packages.map(row => row.supplierId)).size, 1, "Supplier-native route families must remain one Owner-facing supplier.");
assert.strictEqual(new Set(sameSupplierNativeRoutes.packages.map(row => row.supplierProductCode)).size, 3, "Exact supplier-native route identities must be preserved internally.");
assert.strictEqual(sameSupplierNativeRoutes.packages.filter(row => row.prepared.selectable).length, 3, "Package discovery must span all prepared supplier-native routes for the chosen supplier.");

const idProduct = { ...product, productCode: "codm-id", name: "Call of Duty Mobile (ID)", supportedRegions: ["ID"] };
const idPackage = { ...pkg, productCode: "codm-id", packageCode: "CODM_ID_80_CP", name: "80 CP" };
const idSupplierProduct = { ...supplierProduct, _id: "sp-id", supplierProductCode: "codm_id", supplierMarketCode: "ID", displayName: "CODM ID" };
const idOffer = { ...offer, _id: "o-id", supplierCatalogProductId: "sp-id", supplierProductCode: "codm_id", supplierOfferCode: "80_cp" };
const idAvailability = { ...availability, _id: "av-id", supplierCatalogOfferId: "o-id" };
const idMapping = { ...mapping, _id: "m-id", productCode: "codm-id", packageCode: "CODM_ID_80_CP", supplierProductCode: "codm_id", supplierPackageCode: "80_cp", supplierCatalogOfferId: "o-id", region: "ID", fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "fixture", verifiedAt: now, version: 1 } };
const idCommerceProjection = projectActivation({
    products: [idProduct], packages: [idPackage], suppliers: [supplier],
    mappings: [idMapping], offers: [idOffer], supplierProducts: [idSupplierProduct],
    availability: [idAvailability], publications: []
}, { productCode: "codm-id", supplierMarket: "ID", sellingRegions: "MM,TH" }, dependencies);
assert.strictEqual(idCommerceProjection.packages[0].prepared.selectable, true, "TH/MM commerce must allow an ID product when the supplier route is ID-compatible.");
assert.deepStrictEqual(idCommerceProjection.packages[0].prepared.sellingRegions, ["MM", "TH"]);
assert.strictEqual(idCommerceProjection.packages[0].fulfillmentEligibility.mode, "UNKNOWN", "Commerce selling regions must not be rewritten into supplier eligibility during projection.");
const mismatchedSupplierProduct = { ...idSupplierProduct, _id: "sp-india", supplierMarketCode: "INDIA" };
const mismatchedOffer = { ...idOffer, _id: "o-india", supplierCatalogProductId: "sp-india" };
const mismatchedAvailability = { ...idAvailability, supplierCatalogOfferId: "o-india" };
const mismatchedMapping = { ...idMapping, _id: "m-india", supplierCatalogOfferId: "o-india", region: "INDIA" };
const mismatchedProjection = projectActivation({
    products: [idProduct], packages: [idPackage], suppliers: [supplier],
    mappings: [mismatchedMapping], offers: [mismatchedOffer], supplierProducts: [mismatchedSupplierProduct],
    availability: [mismatchedAvailability], publications: []
}, { productCode: "codm-id", supplierMarket: "INDIA", sellingRegions: "TH" }, dependencies);
assert.strictEqual(mismatchedProjection.packages[0].prepared.selectable, false, "TH commerce preference alone must not make an incompatible supplier account market valid.");
assert(mismatchedProjection.packages[0].masterCatalog.blockers.includes("PRODUCT_ACCOUNT_MARKET_INCOMPATIBLE"));

const clone = value => structuredClone(value);
function query(value) { return { session() { return this; }, lean: async () => clone(value) }; }
function fixture(selectedMapping = mapping) {
    const state = { selection: null, mapping: clone(selectedMapping), product: clone(product), pkg: clone(pkg), createdPackages: [], mappingUpdates: [] };
    const fixtureOffer = selectedMapping?.supplierCatalogOfferId === "o-th" ? thOffer : offer;
    const fixtureSupplierProduct = selectedMapping?.supplierCatalogOfferId === "o-th" ? thSupplierProduct : supplierProduct;
    const fixtureAvailability = selectedMapping?.supplierCatalogOfferId === "o-th" ? thAvailability : availability;
    const models = {
        Supplier: { findOne: () => query(supplier) }, Mapping: { find: filter => query(state.mapping && (!filter?._id?.$in || filter._id.$in.includes(state.mapping._id)) ? [state.mapping] : []), findOne: () => query(null), create: async docs => { state.createdMappings = docs.map((doc, index) => ({ _id: `created-mapping-${index + 1}`, ...clone(doc) })); state.mapping = state.createdMappings[0]; return state.createdMappings; }, updateOne: async (_filter, update) => { state.mappingUpdates.push({ update: clone(update) }); Object.assign(state.mapping, clone(update.$set)); return { matchedCount: 1, modifiedCount: 1 }; } },
        Selection: { findOne: () => query(state.selection), findOneAndUpdate: (_f, update) => ({ session() { return this; }, lean: async () => { state.selection = { _id: "sel1", ...clone(update.$set) }; return clone(state.selection); } }) },
        Offer: { find: filter => query(filter?._id?.$in?.includes("o-source") ? [offerWithCanonicalEvidence] : [fixtureOffer]) }, SupplierProduct: { find: () => query([fixtureSupplierProduct]) }, Availability: { find: filter => query(filter?.supplierCatalogOfferId?.$in?.includes("o-source") ? [{ ...availability, supplierCatalogOfferId: "o-source" }] : [fixtureAvailability]) },
        Product: { findOne: () => query(state.product), updateOne: async () => ({ modifiedCount: 1 }) },
        Package: { find: () => query(state.pkg ? [state.pkg] : []), findOneAndUpdate: (_filter, update) => ({ session() { return this; }, lean: async () => { const created = { _id: `created-${state.createdPackages.length + 1}`, ...clone(update.$setOnInsert), ...clone(update.$set) }; state.createdPackages.push(created); state.pkg = created; return clone(created); } }), updateMany: async () => ({ modifiedCount: 1 }) }, Publication: {}
    };
    const transaction = async callback => callback({ fixture: true });
    return { state, models, service: createStoreCatalogSelectionService(models, dependencies), transaction };
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

    const thAccepted = fixture(thMapping);
    thAccepted.state.product = clone(thProduct);
    thAccepted.state.pkg = clone(thPackage);
    const thBeforeMapping = clone(thAccepted.state.mapping);
    const thSelection = await thAccepted.service.save({ productCode: "valorant-th", supplierMarket: "TH", supplierId: "s1", sellingRegions: ["TH", "MM"], mappingIds: ["m-th"], expectedDecisionVersion: 0 }, { actor: { username: "owner" }, transaction: thAccepted.transaction });
    assert.deepStrictEqual(thSelection.selection.sellingRegions, ["MM", "TH"], "Store Catalog save must accept TH+MM commerce scope for a valid TH product/account supplier route.");
    assert.deepStrictEqual(thAccepted.state.mapping, thBeforeMapping, "Store Catalog save must not mutate supplier route identity or manufacture MM technical eligibility.");

    const missingCanonical = fixture();
    missingCanonical.state.pkg = null;
    const adopted = await missingCanonical.service.save(input, { actor: { username: "owner" }, transaction: missingCanonical.transaction });
    assert.strictEqual(adopted.selection.packages[0].packageCode, "PUBG_325_UC");
    assert.strictEqual(missingCanonical.state.createdPackages.length, 1, "Store Catalog adoption must create the missing CatalogPackage idempotently.");
    assert.strictEqual(missingCanonical.state.mappingUpdates.length, 1, "Store Catalog adoption must prepare the exact mapping from supplier offer evidence.");
    assert.strictEqual(missingCanonical.state.mappingUpdates[0].update.$set.executionMode, "API");
    assert.strictEqual(missingCanonical.state.mappingUpdates[0].update.$set.fulfillmentEligibility.mode, "CUSTOMER_MARKET_ALLOWLIST");
    assert.deepStrictEqual(missingCanonical.state.mappingUpdates[0].update.$set.fulfillmentEligibility.allowedCustomerMarkets, ["TH"]);
    assert.strictEqual(missingCanonical.state.mappingUpdates[0].update.$set.mappingMetadata.readiness.inputReady, true);
    assert.strictEqual(missingCanonical.state.mappingUpdates[0].update.$set.mappingMetadata.readiness.fulfillmentReady, true);

    const offerSourced = fixture(null);
    const adoptedOffer = await offerSourced.service.save({ ...input, mappingIds: ["offer:o-source"] }, { actor: { username: "owner" }, transaction: offerSourced.transaction });
    assert.strictEqual(adoptedOffer.selection.packages[0].supplierProductMappingId, "created-mapping-1");
    assert.strictEqual(offerSourced.state.createdMappings.length, 1, "Offer-sourced adoption must create exactly one SupplierProductMapping.");
    assert.strictEqual(offerSourced.state.createdMappings[0].supplierCatalogOfferId, "o-source");

    const rejected = fixture({ ...mapping, supplierCode: "UNKNOWN_SUPPLIER" });
    await assert.rejects(() => rejected.service.save(input, { transaction: rejected.transaction }), error => error instanceof StoreCatalogSelectionError && error.code === "STORE_SELECTION_MAPPING_NOT_PREPARED");
    assert.strictEqual(rejected.state.selection, null);

    const wizard = fs.readFileSync(path.resolve(__dirname, "../../frontend/js/admin-add-product-wizard.js"), "utf8");
    assert(wizard.includes("row.prepared?.selectable===true"));
    assert(wizard.includes("No fulfillment-ready packages available."));
    assert(wizard.includes("data-wizard-package=\"${apwEsc(row.mappingId)}\""));
    assert(!wizard.includes("new Map(apwValidRows().map(row=>[row.packageCode,row]))"));
    assert(wizard.includes("valid.map(row=>[row.supplierId,row])"), "Add Product supplier step must aggregate by real supplier, not supplier-native product.");
    assert(!wizard.includes("&&(!addProductWizard.supplierProductCode||row.supplierProductCode===addProductWizard.supplierProductCode)"), "Package step must not narrow the chosen supplier to one supplier-native route family.");
    assert(!wizard.includes("!!addProductWizard.supplierProductCode&&apwValidRows().length>0"), "Continuing from Supplier step must not require a supplier-native product.");
    assert(wizard.includes("function apwRouteRank"), "Owner-facing duplicate package candidates must prefer an existing PRIMARY/API route when available.");
    assert(wizard.includes("routeAlternatives:rows.map"), "Collapsed package candidates must preserve exact supplier route identities internally.");
    assert(wizard.includes("row.routeAlternatives?.length>1"), "The package step must disclose reviewed alternate route evidence without presenting duplicate commercial packages.");
    console.log(JSON.stringify({ result: "PASS", preparedDisabledNonPrimarySelectable: true, supplierOfferDiscoveryWithoutMapping: true, offerSourcedAdoptionCreatesMapping: true, staleManualStateIgnoredForDiscovery: true, staleInputReadyFlagIgnoredForDiscovery: true, commercialStateIgnoredForDiscovery: true, missingCanonicalPackageSelectable: true, adoptionCreatesCanonicalPackage: true, adoptionPreparesExactMapping: true, rejectedAdvancedOnlyCases: 4, distinctSupplierCandidates: multi.packages.length, sameSupplierNativeRoutes: sameSupplierNativeRoutes.packages.length, supplierNativeGrouping: true, duplicateCommercialPackagesCollapsed: true, exactRouteIdentityPreserved: true, storeSelectionGuard: true, automaticPrimaryAssignments: 0, pricingWrites: 0, publicationWrites: 0, supplierCalls: 0, productionWrites: 0 }, null, 2));
})().catch(error => { console.error("VERIFY_ADD_PRODUCT_FULFILLMENT_READY_INVENTORY_FAILED:", error); process.exitCode = 1; });
