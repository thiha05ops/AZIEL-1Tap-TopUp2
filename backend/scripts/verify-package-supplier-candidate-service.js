"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { costProjection, createPackageSupplierCandidateService } = require("../services/packageSupplierCandidateService");

const id = () => new mongoose.Types.ObjectId();
const supplierA = id(), supplierB = id(), supplierC = id();
const offerA = id(), offerB = id(), offerC = id();
const mappingA = id(), mappingB = id(), mappingC = id();
const future = new Date(Date.now() + 3600000);
const ready = { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true };
const eligibility = { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH", "MM"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "test", verifiedAt: new Date(), version: 1 };

function query(value) {
    return { lean: async () => value, sort() { return this; } };
}

const mappings = [
    { _id: mappingA, supplierId: supplierA, supplierCode: "A", productCode: "game", packageCode: "PACK", supplierProductCode: "P", supplierPackageCode: "A", supplierCatalogOfferId: offerA, region: "GLOBAL", enabled: true, productionRole: "PRIMARY", executionMode: "API", supplierCostAuthority: { rawSupplierCost: 4, supplierCurrency: "USD", capturedAt: new Date(), source: "test" }, mappingMetadata: { readiness: ready }, fulfillmentEligibility: eligibility },
    { _id: mappingB, supplierId: supplierB, supplierCode: "B", productCode: "game", packageCode: "PACK", supplierProductCode: "P", supplierPackageCode: "B", supplierCatalogOfferId: offerB, region: "GLOBAL", enabled: true, productionRole: "BACKUP", executionMode: "API", supplierCostAuthority: { rawSupplierCost: 3.8, supplierCurrency: "USD", capturedAt: new Date(), source: "test" }, mappingMetadata: { readiness: ready }, fulfillmentEligibility: eligibility },
    { _id: mappingC, supplierId: supplierC, supplierCode: "C", productCode: "game", packageCode: "PACK", supplierProductCode: "P", supplierPackageCode: "C", supplierCatalogOfferId: offerC, region: "GLOBAL", enabled: false, productionRole: "DISABLED", executionMode: "API", mappingMetadata: { readiness: ready }, fulfillmentEligibility: eligibility }
];
const suppliers = [supplierA, supplierB, supplierC].map((value, index) => ({ _id: value, supplierCode: String.fromCharCode(65 + index), name: `Supplier ${String.fromCharCode(65 + index)}`, enabled: true, mode: "API" }));
const offers = mappings.map(mapping => ({ _id: mapping.supplierCatalogOfferId, supplierId: mapping.supplierId, supplierProductCode: "P", supplierOfferCode: mapping.supplierPackageCode, catalogLifecycleState: "ACTIVE", supplierCost: { amount: 4, currency: "USD", observedAt: new Date() } }));
const availability = mappings.map(mapping => ({ supplierCatalogOfferId: mapping.supplierCatalogOfferId, state: mapping._id === mappingC ? "UNAVAILABLE" : "AVAILABLE", observedAt: new Date(), staleAt: future }));

const service = createPackageSupplierCandidateService({
    Package: { findOne: () => query({ productCode: "game", packageCode: "PACK", name: "Pack", enabled: true, prices: { TH: { amount: 100, currency: "THB", enabled: true } }, updatedAt: new Date() }) },
    Publication: { findOne: () => query({ published: true, customerMarket: "TH" }) },
    Selection: { findOne: () => query(null) },
    Mapping: { find: () => query(mappings) },
    Supplier: { find: () => query(suppliers) },
    Offer: { find: () => query(offers) },
    Availability: { find: () => query(availability) },
    Media: { findOne: () => query(null) }
}, {
    getSupplierAdapter: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true })
});

service({ productCode: "game", packageCode: "PACK", customerMarket: "TH" }).then(result => {
    assert.strictEqual(result.candidates.length, 3);
    assert.strictEqual(result.selection, null);
    const backup = result.candidates.find(item => item.supplierMappingId === String(mappingB));
    assert.strictEqual(backup.readiness.legacyProductionRole, "BACKUP");
    assert.strictEqual(backup.readiness.selectable, true, "BACKUP must be selectable when intrinsically ready");
    assert.strictEqual(backup.productionRole, "BACKUP");
    assert.deepStrictEqual(backup.providerIdentity, { productCode: "P", packageCode: "B" });
    assert.strictEqual(backup.offer.offerId, String(offerB));
    assert.deepStrictEqual(backup.eligibility.allowedCustomerMarkets, ["TH", "MM"]);
    assert.strictEqual(backup.eligibility.evidenceCode, "PROVIDER_CONFIRMED");
    const disabled = result.candidates.find(item => item.supplierMappingId === String(mappingC));
    assert.strictEqual(disabled.readiness.selectable, false);
    assert(disabled.readiness.blockerCodes.includes("MAPPING_DISABLED"));
    assert(disabled.readiness.blockerCodes.includes("SUPPLIER_AVAILABILITY_NOT_CONFIRMED"));
    assert.strictEqual(result.publication.state, "PUBLISHED");
    assert.strictEqual(costProjection({ supplierCostAuthority: { rawSupplierCost: null } }, { supplierCost: { amount: 7, currency: "USD", observedAt: new Date() } }).amount, 7);
    for (const missing of [null, undefined, "", "not-a-number", Infinity]) {
        assert.strictEqual(costProjection({ supplierCostAuthority: { rawSupplierCost: missing } }, { supplierCost: { amount: null } }).amount, null);
    }
    assert.strictEqual(costProjection({ supplierCostAuthority: { rawSupplierCost: 0, supplierCurrency: "USD", capturedAt: new Date(), source: "explicit" } }).amount, 0);
    assert.strictEqual(costProjection({ supplierCostAuthority: { rawSupplierCost: null } }, { supplierCost: { amount: null } }).state, "UNAVAILABLE");
    console.log("PASS read-only candidate projection and non-primary intrinsic readiness");
}).catch(error => { console.error(error); process.exitCode = 1; });
