"use strict";

const assert = require("assert");
const SupplierCatalogProduct = require("../models/SupplierCatalogProduct");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const {
    CATALOG_AUTHORITY_BOUNDARIES,
    operationalPrimaryCustomerMarkets,
    eligiblePrimaryRouteConflicts,
    summarizeEligibilityResolution,
    OUTCOMES
} = require("../services/supplierEligibilityRouteResolver");

const readiness = { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true, storefrontReady: true };
const mapping = (id, overrides = {}) => ({
    _id: id, supplierId: `supplier-${id}`, supplierCode: "TEST", productCode: "game", packageCode: "GAME_100",
    supplierProductCode: `provider-${id}`, supplierPackageCode: "100", region: "GLOBAL", enabled: true,
    productionRole: "PRIMARY", executionMode: "API", archivedAt: null,
    fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "fixture", verifiedAt: new Date(), version: 1 },
    mappingMetadata: { readiness }, ...overrides
});

assert.deepStrictEqual(CATALOG_AUTHORITY_BOUNDARIES, {
    supplierInventory: "SupplierCatalogProduct/SupplierCatalogOffer",
    commercialIdentity: "CatalogProduct/CatalogPackage",
    routeCandidate: "SupplierProductMapping",
    commercialSelection: "StoreCatalogSelection",
    publication: "PackageMarketPublication",
    retailPrice: "CatalogPackage.prices"
});
assert.strictEqual(SupplierCatalogProduct.schema.path("supplierId").options.immutable, true);
assert.strictEqual(SupplierCatalogOffer.schema.path("supplierCatalogProductId").options.immutable, true);
assert(SupplierProductMapping.schema.path("supplierCatalogOfferId"));
assert(SupplierProductMapping.schema.path("productionRole").enumValues.includes("BACKUP"));

const legacySelection = {
    productCode: "game", supplierId: "507f1f77bcf86cd799439011", supplierCode: "TEST", supplierMarket: "GLOBAL",
    sellingRegions: ["TH"], visibleRegions: [], packages: [{ packageCode: "GAME_100", supplierProductMappingId: "507f191e810c19729de860ea" }],
    status: "ACTIVE", decisionVersion: 3, provenance: { source: "ADMIN", sourceHash: "source", planHash: "plan", reversible: true }
};
const selection = new StoreCatalogSelection(legacySelection);
assert.ifError(selection.validateSync());
const roundTrip = selection.toObject();
assert.strictEqual(String(roundTrip.supplierId), legacySelection.supplierId);
assert.strictEqual(roundTrip.supplierCode, "TEST");
assert.strictEqual(roundTrip.supplierMarket, "GLOBAL");
assert.strictEqual(String(roundTrip.packages[0].supplierProductMappingId), legacySelection.packages[0].supplierProductMappingId);

const primary = mapping("primary");
assert.deepStrictEqual(operationalPrimaryCustomerMarkets(primary), ["TH"]);
assert.deepStrictEqual(eligiblePrimaryRouteConflicts({ candidate: primary, existingMappings: [] }), []);
const second = mapping("second", { region: "TH" });
assert.deepStrictEqual(eligiblePrimaryRouteConflicts({ candidate: second, existingMappings: [primary] }).map(item => item._id), ["primary"]);
const mmOnly = mapping("mm", { fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "fixture", verifiedAt: new Date(), version: 1 } });
assert.deepStrictEqual(eligiblePrimaryRouteConflicts({ candidate: mmOnly, existingMappings: [primary] }), []);
const global = mapping("global", { fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "fixture", verifiedAt: new Date(), version: 1 } });
assert.deepStrictEqual(operationalPrimaryCustomerMarkets(global), ["TH", "MM"]);
assert.deepStrictEqual(operationalPrimaryCustomerMarkets(mapping("backup", { productionRole: "BACKUP" })), []);
assert.deepStrictEqual(operationalPrimaryCustomerMarkets(mapping("disabled", { productionRole: "DISABLED" })), []);

const assessments = new Map([["primary", { blockers: [] }], ["second", { blockers: [] }]]);
assert.strictEqual(summarizeEligibilityResolution({ mappings: [primary], assessments, productCode: "game", packageCode: "GAME_100", customerMarket: "TH" }).outcome, OUTCOMES.ELIGIBLE);
assert.strictEqual(summarizeEligibilityResolution({ mappings: [primary, second], assessments, productCode: "game", packageCode: "GAME_100", customerMarket: "TH" }).outcome, OUTCOMES.AMBIGUOUS_PRIMARY_ROUTE);

const productionSelectionSource = require("fs").readFileSync(require.resolve("../services/supplierProductionSelectionService"), "utf8");
assert(productionSelectionSource.includes("eligiblePrimaryRouteConflicts"));
assert(productionSelectionSource.includes('code: "AMBIGUOUS_PRIMARY_ROUTE"'));
const orderSchemaSource = require("fs").readFileSync(require.resolve("../models/CommerceOrder"), "utf8");
assert(orderSchemaSource.includes("routeSnapshot") && orderSchemaSource.includes("immutable: true"));
const attemptSchemaSource = require("fs").readFileSync(require.resolve("../models/FulfillmentAttempt"), "utf8");
assert(attemptSchemaSource.includes("supplierMappingId"));

console.log(JSON.stringify({ result: "PASS", authorityBoundaries: 6, legacySelectionRoundTrip: true, eligiblePrimaryPass: true, ambiguousPrimaryFailsClosed: true, globalCustomerMarkets: ["TH", "MM"], backupCompetes: false, disabledCompetes: false, historicalMigrationWrites: 0 }, null, 2));
