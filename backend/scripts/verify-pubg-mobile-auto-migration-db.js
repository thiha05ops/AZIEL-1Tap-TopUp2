#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const AdminAuditLog = require("../models/AdminAuditLog");
const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const CommerceOrder = require("../models/CommerceOrder");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const PaymentAttempt = require("../models/PaymentAttempt");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const Supplier = require("../models/Supplier");
const SupplierCatalogIngestionRun = require("../models/SupplierCatalogIngestionRun");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierCatalogProduct = require("../models/SupplierCatalogProduct");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const { eligibleMappingsForPackage } = require("../services/fulfillmentCapabilityService");
const { contractFingerprint } = require("../services/suppliers/fazercardsFulfillmentContractService");
const {
    PRODUCT_CODE,
    SOURCE_PRODUCT_CODE,
    TARGET_PRODUCT_CODE,
    NAMESPACE,
    OPERATION,
    CONFIRMATION,
    PACKAGE_MIGRATIONS,
    createPubgMobileAutoMigrationService
} = require("../services/supplierCatalog/pubgMobileAutoMigrationService");

const NOW = new Date("2026-11-02T06:00:00.000Z");
const ids = Object.freeze({ supplier: new mongoose.Types.ObjectId(), targetProduct: new mongoose.Types.ObjectId(), run: new mongoose.Types.ObjectId(), owner: new mongoose.Types.ObjectId() });
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fingerprint = async Model => hash((await Model.collection.find({}).sort({ _id: 1 }).toArray()).map(row => ({ ...row, _id: String(row._id) })));

function contractBody() {
    return {
        version: 1, decisionVersion: 1, supplierCode: "FAZERCARDS", protocol: "FAZERCARDS_TOPUPS_ORDER_V2",
        transactionalServiceCode: "", supplierProductCode: TARGET_PRODUCT_CODE,
        sourceSupplierCatalogProductId: String(ids.targetProduct), sourceHash: "a".repeat(64), sourceOfferHash: "b".repeat(64),
        authorityScope: "PRODUCT", noCustomerInput: false,
        fields: [{ customerField: "playerId", providerField: "player_id", required: true, label: "Player ID", type: "text", options: [], constraints: {}, evidenceReference: "FAZERCARDS_OFFERS_RESPONSE_FIELDS", transformationId: "DIRECT" }]
    };
}

async function clear() {
    for (const Model of [AdminAuditLog, StoreCatalogSelection, SupplierProductMapping, SupplierOfferAvailability, SupplierCatalogOffer, SupplierCatalogProduct, SupplierCatalogIngestionRun, CatalogPackage, CatalogProduct, Supplier, CommerceOrder, FulfillmentAttempt, PaymentAttempt]) await Model.collection.deleteMany({});
}

async function seed() {
    await clear();
    await Supplier.collection.insertOne({ _id: ids.supplier, supplierCode: "FAZERCARDS", name: "FazerCards", enabled: true, mode: "API", supplierCurrency: "USD", supportedRegions: ["TH"], createdAt: NOW, updatedAt: NOW });
    await CatalogProduct.collection.insertOne({ productCode: PRODUCT_CODE, name: "PUBG Mobile (Global)", enabled: true, commerceState: "PURCHASABLE", publicDiscoveryEnabled: true, deletedAt: null, createdAt: NOW, updatedAt: NOW });
    await SupplierCatalogIngestionRun.collection.insertOne({ _id: ids.run, supplierId: ids.supplier, catalogNamespace: NAMESPACE, runKey: "fixture-run", status: "SUCCEEDED_COMPLETE", coverageState: "COMPLETE", startedAt: new Date(NOW.getTime() - 60000), completedAt: NOW, createdAt: NOW, updatedAt: NOW });
    await SupplierCatalogProduct.collection.insertOne({ _id: ids.targetProduct, supplierId: ids.supplier, catalogNamespace: NAMESPACE, supplierProductCode: TARGET_PRODUCT_CODE, supplierMarketCode: "GLOBAL", supportState: "SUPPORTED", rawSnapshotHash: "a".repeat(64), normalizedInputContract: { fields: contractBody().fields, noCustomerInput: false, authority: "FAZERCARDS_OFFERS_RESPONSE_FIELDS", sourceHash: "a".repeat(64) }, requiredFields: contractBody().fields, restrictions: [], createdAt: NOW, updatedAt: NOW });
    const selectionPackages = [];
    for (let index = 0; index < PACKAGE_MIGRATIONS.length; index += 1) {
        const expected = PACKAGE_MIGRATIONS[index], packageId = new mongoose.Types.ObjectId(), sourceId = new mongoose.Types.ObjectId(), offerId = new mongoose.Types.ObjectId();
        await CatalogPackage.collection.insertOne({ _id: packageId, productCode: PRODUCT_CODE, packageCode: expected.packageCode, name: expected.name, enabled: index !== 3, deletedAt: null, prices: { TH: { amount: 35 + index, currency: "THB", enabled: true }, MM: { amount: 4400 + index, currency: "MMK", enabled: true } }, createdAt: NOW, updatedAt: NOW });
        await SupplierCatalogOffer.collection.insertOne({ _id: offerId, supplierId: ids.supplier, supplierCatalogProductId: ids.targetProduct, catalogNamespace: NAMESPACE, supplierProductCode: TARGET_PRODUCT_CODE, supplierOfferCode: expected.offerCode, supplierOfferName: expected.name, supplierCost: { amount: index + 1, currency: "USD", observedAt: NOW }, catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", rawSnapshotHash: "b".repeat(64), createdAt: NOW, updatedAt: NOW });
        await SupplierOfferAvailability.collection.insertOne({ supplierCatalogOfferId: offerId, state: "AVAILABLE", evidenceCode: "FAZERCARDS_CATALOG_LISTED", observedAt: NOW, staleAt: null, lastAvailableAt: NOW, consecutiveMissingCount: 0, observationRunId: ids.run, coverageComplete: true, createdAt: NOW, updatedAt: NOW });
        await SupplierProductMapping.collection.insertOne({ _id: sourceId, supplierId: ids.supplier, supplierCode: "FAZERCARDS", productCode: PRODUCT_CODE, packageCode: expected.packageCode, supplierProductCode: SOURCE_PRODUCT_CODE, supplierPackageCode: expected.offerCode, supplierCatalogOfferId: new mongoose.Types.ObjectId(), supplierDisplayName: expected.name, region: "GLOBAL", enabled: true, productionRole: "PRIMARY", archivedAt: null, executionMode: "API", mappingMetadata: { readiness: { supplierMapped: true, pricingReady: index > 2, inputReady: true, validationReady: true, fulfillmentReady: true, storefrontReady: true } }, fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PAYMENT_MARKET_DECOUPLED", evidenceSource: "fixture", verifiedAt: NOW, version: 1 }, createdAt: NOW, updatedAt: NOW, __v: 0 });
        selectionPackages.push({ packageCode: expected.packageCode, supplierProductMappingId: sourceId });
    }
    await StoreCatalogSelection.collection.insertOne({ productCode: PRODUCT_CODE, supplierId: ids.supplier, supplierCode: "FAZERCARDS", supplierMarket: "GLOBAL", sellingRegions: ["TH", "MM"], visibleRegions: ["TH", "MM"], packages: selectionPackages, status: "ACTIVE", decisionVersion: 1, selectedBy: "fixture", selectedAt: NOW, createdAt: NOW, updatedAt: NOW });
    await CommerceOrder.collection.insertOne({ orderId: "AZL-HISTORICAL", status: "paid", paymentStatus: "paid", marker: "unchanged", createdAt: NOW, updatedAt: NOW });
    await FulfillmentAttempt.collection.insertOne({ fulfillmentId: "FUL-HISTORICAL", orderId: new mongoose.Types.ObjectId(), supplierMappingId: selectionPackages[0].supplierProductMappingId, status: "IN_PROGRESS", marker: "unchanged", createdAt: NOW, updatedAt: NOW });
    await PaymentAttempt.collection.insertOne({ paymentAttemptId: "PAY-HISTORICAL", status: "completed", marker: "unchanged", createdAt: NOW, updatedAt: NOW });
}

async function protectedFingerprints() {
    return Promise.all([CatalogProduct, CatalogPackage, StoreCatalogSelection, CommerceOrder, FulfillmentAttempt, PaymentAttempt].map(fingerprint));
}

async function run() {
    const replSet = await MongoMemoryReplSet.create({ binary: { version: "7.0.14" }, replSet: { count: 1, storageEngine: "wiredTiger" } });
    try {
        await mongoose.connect(replSet.getUri("aziel_pubg_auto_migration_test"), { autoIndex: true });
        for (const Model of [AdminAuditLog, StoreCatalogSelection, SupplierProductMapping, SupplierOfferAvailability, SupplierCatalogOffer, SupplierCatalogProduct, SupplierCatalogIngestionRun, CatalogPackage, CatalogProduct, Supplier]) await Model.syncIndexes();
        const actor = { adminId: String(ids.owner), username: "owner", role: "OWNER" };
        const inputFor = plan => ({ planHash: plan.planHash, confirmed: true, confirmation: CONFIRMATION, requestId: "isolated-test" });

        await seed();
        const service = createPubgMobileAutoMigrationService({ connection: mongoose.connection, clock: () => NOW, env: { PUBG_MOBILE_AUTO_MIGRATION_PREPARE_ENABLED: "true" } });
        const plan = await service.inspect();
        assert.strictEqual(plan.state, "READY");
        const protectedBefore = await protectedFingerprints();
        const result = await service.prepare(inputFor(plan), actor);
        assert.strictEqual(result.applied, true);
        const prepared = await SupplierProductMapping.find({ supplierProductCode: TARGET_PRODUCT_CODE }).lean();
        assert.strictEqual(prepared.length, 6);
        assert(prepared.every(row => row.enabled === false && row.productionRole === "DISABLED" && row.mappingMetadata.readiness.fulfillmentReady === false && row.mappingMetadata.readiness.storefrontReady === false && row.supplierCostAuthority.rawSupplierCost == null));
        assert.deepStrictEqual(await protectedFingerprints(), protectedBefore, "Preparation must not mutate catalog, prices, selection, orders, payments, or attempts.");
        const audit = await AdminAuditLog.findOne({ action: OPERATION }).lean();
        assert(audit && audit.metadata.preparedMappingIds.length === 6 && audit.metadata.activationPerformed === false && audit.metadata.publicationPerformed === false);
        for (const mapping of prepared) {
            const eligible = eligibleMappingsForPackage({ mappings: [mapping], suppliers: [{ _id: ids.supplier, supplierCode: "FAZERCARDS", enabled: true, mode: "API" }], productCode: PRODUCT_CODE, packageCode: mapping.packageCode, region: "TH", context: { supplierProduct: { supplierProductCode: TARGET_PRODUCT_CODE }, productCompatibilityMarkets: ["GLOBAL"] } });
            assert.strictEqual(eligible.length, 0, `${mapping.packageCode} must remain ineligible while disabled.`);
        }
        const replay = await service.prepare(inputFor(plan), actor);
        assert.strictEqual(replay.applied, false);
        assert.strictEqual(replay.idempotentReplay, true);
        assert.strictEqual(await SupplierProductMapping.countDocuments({ supplierProductCode: TARGET_PRODUCT_CODE }), 6);
        assert.strictEqual(await AdminAuditLog.countDocuments({ action: OPERATION }), 1);

        await seed();
        const auditFailure = createPubgMobileAutoMigrationService({ connection: mongoose.connection, clock: () => NOW, env: { PUBG_MOBILE_AUTO_MIGRATION_PREPARE_ENABLED: "true" }, Audit: { create: async () => { throw new Error("FORCED_AUDIT_FAILURE"); } } });
        const rollbackPlan = await auditFailure.inspect();
        await assert.rejects(() => auditFailure.prepare(inputFor(rollbackPlan), actor), /FORCED_AUDIT_FAILURE/);
        assert.strictEqual(await SupplierProductMapping.countDocuments({ supplierProductCode: TARGET_PRODUCT_CODE }), 0, "Audit failure must roll back all prepared mappings.");

        await seed();
        const staleService = createPubgMobileAutoMigrationService({ connection: mongoose.connection, clock: () => NOW, env: { PUBG_MOBILE_AUTO_MIGRATION_PREPARE_ENABLED: "true" } });
        const stalePlan = await staleService.inspect();
        await SupplierCatalogOffer.updateOne({ supplierProductCode: TARGET_PRODUCT_CODE, supplierOfferCode: "60_uc" }, { $set: { rawSnapshotHash: "c".repeat(64), "supplierCost.amount": 1.25 } });
        const regenerated = await staleService.inspect();
        assert.notStrictEqual(regenerated.planHash, stalePlan.planHash, "Changed supplier evidence must regenerate the plan hash.");
        await assert.rejects(() => staleService.prepare(inputFor(stalePlan), actor), error => error.code === "PLAN_CHANGED");
        assert.strictEqual(await SupplierProductMapping.countDocuments({ supplierProductCode: TARGET_PRODUCT_CODE }), 0, "Stale plan must not create mappings.");

        console.log(JSON.stringify({ result: "PASS", database: "isolated mongodb-memory-server replica set", mongoVersion: "7.0.14", packages: 6, transactionRollback: true, concurrencyStalePlanRejected: true, idempotentReplay: true, auditCreated: true, protectedCollectionsUnchanged: true, disabledMappingsProductionEligible: 0, planRegenerationOnEvidenceChange: true, productionConnections: 0, supplierCalls: 0, realOrders: 0 }, null, 2));
    } finally {
        await mongoose.disconnect().catch(() => null);
        await replSet.stop();
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
