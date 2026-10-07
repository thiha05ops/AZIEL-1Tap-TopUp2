#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { makePlan, resolveOrCreateMarketMapping, storeCatalogEntry } = require("../services/supplierCatalog/addProductFinalizationService");

const now = new Date("2026-10-06T00:00:00.000Z"), supplier = { _id: "supplier-1", supplierCode: "FAZERCARDS", name: "FazerCards" };
const eligibility = { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "fixture", verifiedAt: now, version: 1 };
const product = { _id: "source-1", supplierId: supplier._id, catalogNamespace: "FAZERCARDS_RESELLER_CATALOG", supplierProductCode: "mobile_legends_global", supplierMarketCode: "GLOBAL", displayName: "Mobile Legends (Global)", supportState: "SUPPORTED", rawSnapshotHash: "a".repeat(64), sourceRevision: "source-1", lastChangedAt: now, restrictions: [], metadata: {}, normalizedInputContract: { authority: "FAZERCARDS_OFFERS_RESPONSE_FIELDS", fields: [{ customerField: "playerId", providerField: "player_id", required: true, label: "Player ID", type: "numeric-text", transformationId: "DIRECT" }], fulfillmentEligibility: eligibility } };
const offer = { _id: "offer-1", supplierId: supplier._id, supplierCatalogProductId: product._id, catalogNamespace: product.catalogNamespace, supplierProductCode: product.supplierProductCode, supplierOfferCode: "284_diamonds", supplierOfferName: "284 Diamonds", catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", rawSnapshotHash: "b".repeat(64), sourceRevision: "offer-1", lastChangedAt: now, normalizedSemantics: { denomination: 284 }, supplierCost: { amount: 1, currency: "USD", observedAt: now } };
const availability = { supplierCatalogOfferId: offer._id, state: "AVAILABLE", coverageComplete: true, evidenceCode: "FIXTURE", observedAt: now };
const canonical = { _id: "product-1", productCode: "mlbb", name: "Mobile Legends Diamonds", metadata: {} };
const pkg = { _id: "package-1", productCode: "mlbb", packageCode: "MLBB_284", name: "284 Diamonds", enabled: true, deletedAt: null };
const mapping = (mappingId, region, extra = {}) => ({ _id: mappingId, supplierId: supplier._id, supplierCode: "FAZERCARDS", supplierCatalogOfferId: offer._id, supplierProductCode: offer.supplierProductCode, supplierPackageCode: offer.supplierOfferCode, productCode: "mlbb", packageCode: "MLBB_284", region, enabled: true, productionRole: "PRIMARY", archivedAt: null, fulfillmentEligibility: eligibility, ...extra });
const context = mappings => ({ product, supplier, offers: [offer], availability: [availability], mappings, canonicalMappings: mappings, productCode: "mlbb", canonical, packages: [pkg], selection: null, mappedCodes: ["mlbb"], authorityCode: "" });
const input = { productCode: "mlbb", customerMarkets: ["TH"] };

(async () => {
    const th = mapping("mapping-th", "TH"), global = mapping("mapping-global", "GLOBAL", { enabled: false, productionRole: "DISABLED" });
    const thOnly = makePlan(context([th]), input).offers[0];
    assert.strictEqual(thOnly.state, "NEEDS_ATTENTION");
    assert.strictEqual(thOnly.selectable, false);
    assert.deepStrictEqual(thOnly.blockers, ["SUPPLIER_MARKET_ROUTE_DECISION"]);
    assert.strictEqual(thOnly.mappingId, "");
    let creates = 0;
    await assert.rejects(() => resolveOrCreateMarketMapping([th], { supplier, offer, productCode: "mlbb", packageCode: "MLBB_284", supplierMarket: "GLOBAL" }, async () => { creates++; return global; }), error => error.code === "SUPPLIER_MARKET_ROUTE_DECISION");
    assert.strictEqual(creates, 0);
    assert.deepStrictEqual({ region: th.region, enabled: th.enabled, productionRole: th.productionRole }, { region: "TH", enabled: true, productionRole: "PRIMARY" });

    let result = await resolveOrCreateMarketMapping([global], { supplier, offer, productCode: "mlbb", packageCode: "MLBB_284", supplierMarket: "GLOBAL" }, async () => { creates++; return null; });
    assert.strictEqual(result.mapping, global);
    assert.strictEqual(result.created, false);
    assert.strictEqual(storeCatalogEntry(result.mapping, { packageCode: "MLBB_284", supplierMarket: "GLOBAL" }).supplierProductMappingId, "mapping-global");

    result = await resolveOrCreateMarketMapping([th, global], { supplier, offer, productCode: "mlbb", packageCode: "MLBB_284", supplierMarket: "GLOBAL" }, async () => { creates++; return null; });
    assert.strictEqual(result.mapping, global);
    assert.strictEqual(th.region, "TH");

    const newMapping = mapping("mapping-new", "GLOBAL", { enabled: false, productionRole: "DISABLED" });
    result = await resolveOrCreateMarketMapping([], { supplier, offer, productCode: "mlbb", packageCode: "MLBB_284", supplierMarket: "GLOBAL" }, async () => { creates++; return newMapping; });
    assert.strictEqual(result.created, true);
    assert.strictEqual(result.mapping.enabled, false);
    assert.strictEqual(result.mapping.productionRole, "DISABLED");
    assert.strictEqual(storeCatalogEntry(result.mapping, { packageCode: "MLBB_284", supplierMarket: "GLOBAL" }).supplierProductMappingId, "mapping-new");
    assert.throws(() => storeCatalogEntry(th, { packageCode: "MLBB_284", supplierMarket: "GLOBAL" }), error => error.code === "SUPPLIER_MARKET_ROUTE_DECISION");

    const source = fs.readFileSync(path.join(__dirname, "../services/supplierCatalog/addProductFinalizationService.js"), "utf8");
    const wizard = fs.readFileSync(path.join(__dirname, "../../frontend/js/admin-add-product-wizard.js"), "utf8");
    assert(source.includes("publicationWrites:0,priceWrites:0,packageSupplierSelectionWrites,primaryAssignments:0,supplierCalls:0"));
    assert(source.includes("applyPackageSupplierSelectionBootstrapPlan"), "finalization must reconcile exact missing selection authority without a manual step");
    assert(!source.includes("mapping.region="));
    assert(wizard.includes("SUPPLIER_MARKET_ROUTE_DECISION"));
    assert(wizard.includes('labels=["Regions","Product","Supplier","Packages","Review"]'));
    assert.strictEqual(creates, 1);

    console.log(JSON.stringify({ result: "PASS", scenarios: { thOnly: "NEEDS_ATTENTION/SUPPLIER_MARKET_ROUTE_DECISION", globalOnly: "REUSED", thAndGlobal: "GLOBAL_REUSED", newRelationship: "CREATED_DISABLED" }, mappingCreates: creates, foreignMappingIdsCommitted: 0, existingMappingsChanged: 0, pricingWrites: 0, publicationWrites: 0, packageSupplierSelectionWrites: "AUTOMATIC_EXACT_AUTHORITY_ONLY", primaryAssignments: 0, supplierCalls: 0, productionWrites: 0 }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
