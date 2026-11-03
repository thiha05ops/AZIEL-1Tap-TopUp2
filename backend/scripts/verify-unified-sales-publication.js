#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Product = require("../models/CatalogProduct");
const Package = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const Offer = require("../models/SupplierCatalogOffer");
const SupplierProduct = require("../models/SupplierCatalogProduct");
const Availability = require("../models/SupplierOfferAvailability");
const Latest = require("../models/SupplierCatalogLatestCost");
const Run = require("../models/SupplierCatalogIngestionRun");
const Store = require("../models/StoreCatalogSelection");
const Selection = require("../models/PackageSupplierSelection");
const Publication = require("../models/PackageMarketPublication");
const Attempt = require("../models/FulfillmentAttempt");
const { createUnifiedSalesPublicationService } = require("../services/commerce/unifiedSalesPublicationService");
const { reconcileAttempt } = require("../services/supplierChargeReconciliationService");
const { observedCostHash } = require("../services/supplierCatalog/supplierCostComparisonService");

const now = new Date(), hash = "a".repeat(64);
const ids = Object.fromEntries(["supplier", "run", "supplierProduct", "offer", "mapping"].map(key => [key, new mongoose.Types.ObjectId()]));
const pricePatches = { TH: { amount: 410, currency: "THB", enabled: true }, MM: { amount: 52000, currency: "MMK", enabled: true } };
const input = { mappingId: ids.mapping, regions: ["TH", "MM"], pricePatches, regionalPreviews: { TH: { blockingErrors: [] }, MM: { blockingErrors: [] } }, confirmed: true };
const actor = { role: "OWNER", username: "isolated-owner" };

async function seed() {
    await Supplier.collection.insertOne({ _id: ids.supplier, supplierCode: "FAZERCARDS", name: "FazerCards", enabled: true, mode: "API", supplierCurrency: "USD", supportedRegions: ["GLOBAL"], createdAt: now, updatedAt: now });
    await Product.collection.insertOne({ productCode: "test_game", name: "Test Game", enabled: true, deletedAt: null, createdAt: now, updatedAt: now });
    await Package.collection.insertOne({ productCode: "test_game", packageCode: "PACK_1", name: "Pack 1", enabled: true, deletedAt: null, prices: { TH: { amount: 400, currency: "THB", enabled: true }, MM: { amount: 50000, currency: "MMK", enabled: true } }, createdAt: now, updatedAt: now });
    await SupplierProduct.collection.insertOne({ _id: ids.supplierProduct, supplierId: ids.supplier, catalogNamespace: "FAZERCARDS_MASTER", supplierProductCode: "test_auto", displayName: "Test", supplierMarketCode: "GLOBAL", supportState: "SUPPORTED", rawSnapshotHash: hash, firstSeenAt: now, lastSeenAt: now, lastObservedAt: now, lastChangedAt: now, createdAt: now, updatedAt: now });
    await Run.collection.insertOne({ _id: ids.run, supplierId: ids.supplier, catalogNamespace: "FAZERCARDS_MASTER", runKey: "isolated-run", status: "SUCCEEDED_COMPLETE", coverageState: "COMPLETE", startedAt: now, completedAt: now, createdAt: now, updatedAt: now });
    const offer = { _id: ids.offer, supplierCatalogProductId: ids.supplierProduct, supplierId: ids.supplier, catalogNamespace: "FAZERCARDS_MASTER", supplierProductCode: "test_auto", supplierOfferCode: "pack_1", supplierOfferName: "Pack 1", supplierCost: { amount: 10, currency: "USD", observedAt: now }, catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", firstSeenAt: now, lastSeenAt: now, lastObservedAt: now, lastChangedAt: now, rawSnapshotHash: hash, rawSnapshot: {}, createdAt: now, updatedAt: now };
    const costHash = observedCostHash(offer);
    await Offer.collection.insertOne(offer);
    await Latest.collection.insertOne({ _id: ids.offer, schemaVersion: 1, supplierCatalogProductId: ids.supplierProduct, supplierId: ids.supplier, catalogNamespace: "FAZERCARDS_MASTER", supplierProductCode: "test_auto", supplierOfferCode: "pack_1", amount: 10, currency: "USD", validatedObservedAt: now, sourceRevision: hash, rawSnapshotHash: hash, observedCostHash: costHash, ingestionRunId: ids.run, runKey: "isolated-run", coverageState: "COMPLETE", publishedAt: now });
    await Availability.collection.insertOne({ supplierCatalogOfferId: ids.offer, state: "AVAILABLE", evidenceCode: "AUTHENTICATED_API", observedAt: now, staleAt: null, lastAvailableAt: now, consecutiveMissingCount: 0, observationRunId: ids.run, coverageComplete: true, createdAt: now, updatedAt: now });
    await Mapping.collection.insertOne({ _id: ids.mapping, supplierId: ids.supplier, supplierCode: "FAZERCARDS", productCode: "test_game", packageCode: "PACK_1", supplierProductCode: "test_auto", supplierPackageCode: "pack_1", supplierCatalogOfferId: ids.offer, region: "GLOBAL", supplierMarketEvidence: { normalizedMarket: "GLOBAL", supplierMarketCode: "GLOBAL", marketClassification: "GLOBAL", restrictions: [], evidenceCode: "AUTHENTICATED_API", sourceProductHash: hash }, enabled: false, productionRole: "DISABLED", archivedAt: null, executionMode: "API", supplierCostAuthority: { rawSupplierCost: 10, supplierCurrency: "USD", capturedAt: now, observedAt: now, providerProductCode: "test_auto", providerOfferCode: "pack_1", ingestionRunId: ids.run, rawSnapshotHash: hash, observedCostHash: costHash, verificationMode: "AUTOMATIC_VERIFIED_API" }, mappingMetadata: { readiness: {} }, createdAt: now, updatedAt: now });
}

async function main() {
    const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.14" } });
    await mongoose.connect(repl.getUri(), { dbName: "unified-publication-isolated" });
    try {
        await seed();
        const readyTechnical = () => ({ blockers: [], fulfillmentContract: { version: 1, fields: [{ customerField: "playerId", providerField: "player_id", required: true }] } });
        const service = createUnifiedSalesPublicationService({}, { technicalAssessment: readyTechnical, readinessAssessment: () => ({ ready: true, blockers: [] }), adapterFor: () => ({ isConfigured: () => true }) });
        const plan = await service.preflight(input); assert.equal(plan.ready, true, plan.blockers.join(","));
        const result = await service.publish(input, { actor }); assert.equal(result.purchasable, true);
        const [pkg, mapping, selection, store, publication] = await Promise.all([Package.findOne({ packageCode: "PACK_1" }).lean(), Mapping.findById(ids.mapping).lean(), Selection.findOne({ packageCode: "PACK_1" }).lean(), Store.findOne({ productCode: "test_game" }).lean(), Publication.findOne({ packageCode: "PACK_1" }).lean()]);
        assert.equal(pkg.prices.TH.amount, 410); assert.equal(pkg.prices.MM.amount, 52000); assert.equal(pkg.pricingPublicationHistory.length, 2);
        assert.equal(mapping.enabled, true); assert.equal(mapping.productionRole, "PRIMARY"); assert.equal(String(selection.supplierMappingId), String(ids.mapping)); assert.equal(store.status, "ACTIVE"); assert.equal(publication.published, true);
        const replay = await service.publish(input, { actor }); assert.equal(replay.purchasable, true);
        const beforeRollback = await Package.findOne({ packageCode: "PACK_1" }).lean();
        const failingService = createUnifiedSalesPublicationService({}, { technicalAssessment: readyTechnical, readinessAssessment: () => ({ ready: false, blockers: ["ROUTE_NOT_PURCHASABLE"] }), adapterFor: () => ({ isConfigured: () => true }) });
        const changedInput = { ...input, pricePatches: { ...pricePatches, TH: { ...pricePatches.TH, amount: 430 } } };
        await assert.rejects(() => failingService.publish(changedInput, { actor }), error => error.code === "POST_PUBLICATION_NOT_PURCHASABLE");
        const afterRollback = await Package.findOne({ packageCode: "PACK_1" }).lean();
        assert.equal(afterRollback.prices.TH.amount, beforeRollback.prices.TH.amount); assert.equal(afterRollback.pricingPublicationHistory.length, beforeRollback.pricingPublicationHistory.length);
        await Mapping.updateOne({ _id: ids.mapping }, { $set: { "supplierCostAuthority.observedAt": new Date(Date.now() - 172800000), "supplierCostAuthority.capturedAt": new Date(Date.now() - 172800000) } });
        const stale = await service.preflight(input); assert(stale.blockers.includes("SUPPLIER_COST_AUTHORITY_STALE"));
        await Mapping.updateOne({ _id: ids.mapping }, { $set: { "supplierCostAuthority.observedAt": now, "supplierCostAuthority.capturedAt": now } });
        await Package.updateOne({ packageCode: "PACK_1" }, { $set: { enabled: false } });
        const disabled = await service.preflight(input); assert(disabled.blockers.includes("CANONICAL_PACKAGE_DISABLED"));
        await assert.rejects(() => service.publish(input, { actor }), error => error.code === "PACKAGE_NOT_SELLABLE");
        assert.equal((await Package.findOne({ packageCode: "PACK_1" }).lean()).enabled, false);
        const match = reconcileAttempt({ supplierRequest: { costAuthoritySnapshot: { amount: 10, currency: "USD" } }, supplierResult: { rawMetadata: { provider: { charged_amount: 10, currency: "USD" } } } });
        const difference = reconcileAttempt({ supplierRequest: { costAuthoritySnapshot: { amount: 10, currency: "USD" } }, supplierResult: { rawMetadata: { provider: { charged_amount: 9.5, currency: "USD" } } } });
        const missing = reconcileAttempt({ supplierRequest: { costAuthoritySnapshot: { amount: 10, currency: "USD" } }, supplierResult: { rawMetadata: {} } });
        assert.equal(match.status, "MATCH"); assert.equal(difference.status, "DIFFERENCE"); assert.equal(missing.status, "ACTUAL_CHARGE_UNAVAILABLE");
        console.log(JSON.stringify({ result: "PASS", atomicPublication: true, transactionRollback: true, staleCostBlocked: true, idempotentReplay: true, disabledPackagePreserved: true, quoteChargeReconciliation: [match.status, difference.status, missing.status], productionConnections: 0, supplierCalls: 0 }, null, 2));
    } finally { await mongoose.disconnect(); await repl.stop(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
