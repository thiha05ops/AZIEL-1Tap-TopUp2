#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
process.env.SUPPLIER_COST_LATEST_ONLY_ENABLED = "true";
process.env.SUPPLIER_COST_AUTHORITY_MUTATIONS_ENABLED = "true";
process.env.PUBG_MOBILE_AUTO_COST_RECOVERY_ENABLED = "true";
const Admin = require("../models/AdminAccount");
const Audit = require("../models/AdminAuditLog");
const Package = require("../models/CatalogPackage");
const Attempt = require("../models/FulfillmentAttempt");
const PackageSelection = require("../models/PackageSupplierSelection");
const StoreSelection = require("../models/StoreCatalogSelection");
const Supplier = require("../models/Supplier");
const Run = require("../models/SupplierCatalogIngestionRun");
const Offer = require("../models/SupplierCatalogOffer");
const SupplierProduct = require("../models/SupplierCatalogProduct");
const Availability = require("../models/SupplierOfferAvailability");
const Mapping = require("../models/SupplierProductMapping");
const LatestCost = require("../models/SupplierCatalogLatestCost");
const CostChange = require("../models/SupplierCostAuthorityChange");
const { observedCostHash } = require("../services/supplierCatalog/supplierCostComparisonService");
const { contractFingerprint } = require("../services/suppliers/fazercardsFulfillmentContractService");
const { selectedRouteSnapshot } = require("../services/supplierProductionSelectionService");
const { assessMappingReadiness, READINESS_MODES } = require("../services/supplierMappingReadinessService");
const { ensurePaidOrderFulfillmentWork } = require("../services/paidFulfillmentRoutingService");
const {
    PRODUCT_CODE, SOURCE_PRODUCT_CODE, TARGET_PRODUCT_CODE, NAMESPACE, PACKAGE_MIGRATIONS
} = require("../services/supplierCatalog/pubgMobileAutoMigrationService");
const {
    CUTOVER_OPERATION, CUTOVER_CONFIRMATION, ROLLBACK_OPERATION, ROLLBACK_CONFIRMATION,
    createPubgMobileAutoCutoverService
} = require("../services/supplierCatalog/pubgMobileAutoCutoverService");
const { CONFIRMATION: RECOVERY_CONFIRMATION, createPubgMobileAutoCostRecoveryService } = require("../services/supplierCatalog/pubgMobileAutoCostRecoveryService");

const NOW = new Date();
const ownerId = new mongoose.Types.ObjectId();
const adapter = { isConfigured: () => true, isAutoFulfillmentEnabled: () => true };
const actor = { adminId: String(ownerId), username: "isolated-owner", role: "OWNER" };
const cutoverInput = plan => ({ planHash: plan.planHash, confirmed: true, confirmation: CUTOVER_CONFIRMATION, requestId: "isolated-cutover" });
const rollbackInput = (plan, cutoverPlanHash) => ({ planHash: plan.planHash, cutoverPlanHash, confirmed: true, confirmation: ROLLBACK_CONFIRMATION, requestId: "isolated-rollback" });

function contract(productCode, sourceHash, offerHash) {
    const value = { version: 1, decisionVersion: 1, supplierCode: "FAZERCARDS", protocol: "FAZERCARDS_TOPUPS_ORDER_V2", transactionalServiceCode: "", supplierProductCode: productCode, sourceSupplierCatalogProductId: String(new mongoose.Types.ObjectId()), sourceHash, sourceOfferHash: offerHash, authorityScope: "PRODUCT", noCustomerInput: false, fields: [{ customerField: "playerId", providerField: "player_id", required: true, label: "Player ID", type: "text", options: [], constraints: {}, evidenceReference: "AUTHENTICATED_API", transformationId: "DIRECT" }] };
    return { ...value, fingerprint: contractFingerprint(value) };
}

async function clear() {
    for (const Model of [Admin, Audit, Attempt, PackageSelection, StoreSelection, Mapping, Availability, LatestCost, CostChange, Offer, SupplierProduct, Run, Package, Supplier]) await Model.deleteMany({});
}

async function seed() {
    await clear();
    const supplierId = new mongoose.Types.ObjectId(), runId = new mongoose.Types.ObjectId(), productId = new mongoose.Types.ObjectId(), runKey = `cutover-${Date.now()}`;
    await Admin.collection.insertOne({ _id: ownerId, username: actor.username, usernameNormalized: actor.username, displayName: "Isolated Owner", passwordHash: "not-a-real-secret", role: "OWNER", status: "ACTIVE", createdAt: NOW, updatedAt: NOW });
    await Supplier.collection.insertOne({ _id: supplierId, supplierCode: "FAZERCARDS", name: "FazerCards", enabled: true, mode: "API", supplierCurrency: "USD", supportedRegions: ["GLOBAL"], createdAt: NOW, updatedAt: NOW });
    await SupplierProduct.collection.insertOne({ _id: productId, supplierId, catalogNamespace: NAMESPACE, supplierProductCode: TARGET_PRODUCT_CODE, displayName: "PUBG Mobile Auto", supplierMarketCode: "GLOBAL", supportState: "SUPPORTED", rawSnapshotHash: "d".repeat(64), firstSeenAt: NOW, lastSeenAt: NOW, lastObservedAt: NOW, lastChangedAt: NOW, createdAt: NOW, updatedAt: NOW });
    await Run.collection.insertOne({ _id: runId, supplierId, catalogNamespace: NAMESPACE, runKey, status: "SUCCEEDED_COMPLETE", coverageState: "COMPLETE", startedAt: NOW, completedAt: NOW, createdAt: NOW, updatedAt: NOW });
    const storePackages = [];
    for (let index = 0; index < PACKAGE_MIGRATIONS.length; index += 1) {
        const item = PACKAGE_MIGRATIONS[index], sourceOfferId = new mongoose.Types.ObjectId(), targetOfferId = new mongoose.Types.ObjectId(), sourceId = new mongoose.Types.ObjectId(), targetId = new mongoose.Types.ObjectId();
        await Package.collection.insertOne({ productCode: PRODUCT_CODE, packageCode: item.packageCode, name: item.name, enabled: item.offerCode !== "1800_uc", deletedAt: null, prices: { TH: { amount: 100 + index, currency: "THB", enabled: true }, MM: { amount: 5000 + index, currency: "MMK", enabled: true } }, createdAt: NOW, updatedAt: NOW });
        for (const [offerId, productCode, amount, hashChar] of [[sourceOfferId, SOURCE_PRODUCT_CODE, 10 + index, "a"], [targetOfferId, TARGET_PRODUCT_CODE, 9 + index, "b"]]) {
            const offer = { _id: offerId, supplierCatalogProductId: productId, supplierId, catalogNamespace: NAMESPACE, supplierProductCode: productCode, supplierOfferCode: item.offerCode, supplierOfferName: item.name, supplierCost: { amount, currency: "USD", observedAt: NOW }, catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", firstSeenAt: NOW, lastSeenAt: NOW, lastObservedAt: NOW, lastChangedAt: NOW, rawSnapshotHash: hashChar.repeat(64), rawSnapshot: {}, createdAt: NOW, updatedAt: NOW };
            await Offer.collection.insertOne(offer);
            if (productCode === TARGET_PRODUCT_CODE) await LatestCost.collection.insertOne({ _id: offerId, schemaVersion: 1, supplierCatalogProductId: productId, supplierId, catalogNamespace: NAMESPACE, supplierProductCode: productCode, supplierOfferCode: item.offerCode, amount, currency: "USD", validatedObservedAt: NOW, sourceRevision: offer.rawSnapshotHash, rawSnapshotHash: offer.rawSnapshotHash, observedCostHash: observedCostHash(offer), ingestionRunId: runId, runKey, coverageState: "COMPLETE", publishedAt: NOW });
            await Availability.collection.insertOne({ supplierCatalogOfferId: offerId, state: "AVAILABLE", evidenceCode: "AUTHENTICATED_API", observedAt: NOW, staleAt: null, lastAvailableAt: NOW, consecutiveMissingCount: 0, observationRunId: runId, coverageComplete: true, createdAt: NOW, updatedAt: NOW });
            const mappingId = productCode === SOURCE_PRODUCT_CODE ? sourceId : targetId;
            const sourceHash = productCode === SOURCE_PRODUCT_CODE ? "c".repeat(64) : "d".repeat(64);
            await Mapping.collection.insertOne({ _id: mappingId, supplierId, supplierCode: "FAZERCARDS", productCode: PRODUCT_CODE, packageCode: item.packageCode, supplierProductCode: productCode, supplierPackageCode: item.offerCode, supplierCatalogOfferId: offerId, supplierDisplayName: item.name, region: "GLOBAL", enabled: productCode === SOURCE_PRODUCT_CODE, productionRole: productCode === SOURCE_PRODUCT_CODE ? "PRIMARY" : "DISABLED", archivedAt: null, executionMode: "API", supplierCostAuthority: { rawSupplierCost: amount, supplierCurrency: "USD", capturedAt: NOW, source: "AUTHENTICATED_API", providerProductCode: productCode, providerOfferCode: item.offerCode, ingestionRunId: runId, observedAt: NOW, rawSnapshotHash: offer.rawSnapshotHash, observedCostHash: observedCostHash(offer), verificationMode: "AUTOMATIC_VERIFIED_API", fundingCost: 0, otherAcquisitionCost: 0 }, mappingMetadata: { migration: { operation: "PREPARE_PUBG_MOBILE_AUTO_MIGRATION_V1" }, readiness: { supplierMapped: true, pricingReady: productCode === SOURCE_PRODUCT_CODE, inputReady: true, validationReady: true, fulfillmentReady: productCode === SOURCE_PRODUCT_CODE, storefrontReady: productCode === SOURCE_PRODUCT_CODE }, fulfillmentContract: contract(productCode, sourceHash, offer.rawSnapshotHash) }, fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "CONTROLLED_TEST", evidenceSource: "isolated successful order", verifiedAt: NOW, version: 1 }, createdAt: NOW, updatedAt: NOW, __v: 0 });
        }
        await PackageSelection.collection.insertOne({ productCode: PRODUCT_CODE, packageCode: item.packageCode, customerMarket: "GLOBAL", supplierMappingId: sourceId, selectedByAdminId: ownerId, selectedByUsernameSnapshot: "fixture", selectedAt: NOW, decisionVersion: 1, reason: "fixture", createdAt: NOW, updatedAt: NOW });
        storePackages.push({ packageCode: item.packageCode, supplierProductMappingId: sourceId });
        const targetContract = (await Mapping.findById(targetId).lean()).mappingMetadata.fulfillmentContract;
        await Attempt.collection.insertOne({ fulfillmentId: `FUL-CONTROL-${index}`, orderId: new mongoose.Types.ObjectId(), orderModel: "CommerceOrder", orderCode: `CONTROL-${index}`, supplierId, supplierCodeSnapshot: "FAZERCARDS", supplierMappingId: targetId, productCode: PRODUCT_CODE, packageCode: item.packageCode, region: "TH", customerMarket: "TH", mode: "API", routeType: "SUPPLIER_API", status: "SUCCEEDED", idempotencyKey: `control-${index}`, supplierReference: `supplier-ok-${index}`, supplierRequest: { categoryId: TARGET_PRODUCT_CODE, offerId: item.offerCode, inputContractFingerprint: targetContract.fingerprint, fields: { player_id: "12***89" } }, startedAt: NOW, completedAt: NOW, createdAt: NOW, updatedAt: NOW });
    }
    const unrelatedStoreMappingId = new mongoose.Types.ObjectId();
    storePackages.splice(2, 0, { packageCode: "UNRELATED_PUBG_PACKAGE", supplierProductMappingId: unrelatedStoreMappingId });
    await StoreSelection.collection.insertOne({ productCode: PRODUCT_CODE, supplierId, supplierCode: "FAZERCARDS", supplierMarket: "GLOBAL", sellingRegions: ["TH", "MM"], visibleRegions: ["TH", "MM"], packages: storePackages, status: "ACTIVE", decisionVersion: 1, selectedBy: "fixture", selectedAt: NOW, createdAt: NOW, updatedAt: NOW });
    return { supplierId, unrelatedStoreMappingId };
}

function service(env = { PUBG_MOBILE_AUTO_CUTOVER_ENABLED: "true", PUBG_MOBILE_AUTO_ROLLBACK_ENABLED: "true" }) {
    return createPubgMobileAutoCutoverService({ connection: mongoose.connection, clock: () => NOW, env, adapterResolver: () => adapter });
}

async function run() {
    const repl = await MongoMemoryReplSet.create({ binary: { version: "7.0.14" }, replSet: { count: 1, storageEngine: "wiredTiger" } });
    try {
        await mongoose.connect(repl.getUri("aziel_pubg_cutover"), { autoIndex: true });
        for (const Model of [Admin, Audit, Attempt, PackageSelection, StoreSelection, Mapping, Availability, LatestCost, CostChange, Offer, SupplierProduct, Run, Package, Supplier]) await Model.syncIndexes();
        const seeded = await seed();
        const sixtyCode = PACKAGE_MIGRATIONS.find(item => item.offerCode === "60_uc").packageCode;
        await Mapping.updateOne({ packageCode: sixtyCode, supplierProductCode: TARGET_PRODUCT_CODE }, { $set: { "supplierCostAuthority.verificationMode": "MANUAL_REVIEW", "supplierCostAuthority.ingestionRunId": null, "supplierCostAuthority.observedCostHash": "f".repeat(64) } });
        const blockedDiagnosis = await service().diagnose();
        assert.strictEqual(blockedDiagnosis.state, "BLOCKED");
        assert(blockedDiagnosis.packages.find(value => value.packageCode === sixtyCode).blockers.some(value => value.code === "COST_AUTHORITY_INVALID"));
        assert.strictEqual(blockedDiagnosis.packages.filter(value => value.blockers.length).length, 1, "diagnosis must continue through all six packages");
        const duplicateStoreEntry = (await StoreSelection.findOne().lean()).packages[0];
        await StoreSelection.updateOne({}, { $push: { packages: duplicateStoreEntry } });
        await assert.rejects(() => service().preflight(), error => error.code === "SELECTION_SET_INCOMPLETE", "duplicate UC Store Catalog entries must fail closed");
        await StoreSelection.updateOne({}, { $pop: { packages: 1 } });
        const recovery = createPubgMobileAutoCostRecoveryService({ clock: () => NOW, env: process.env });
        const recoveryPlan = await recovery.inspect();
        assert.strictEqual(recoveryPlan.state, "READY");
        assert.strictEqual(recoveryPlan.summary.acceptable, 1, "only the invalid 60 UC authority should require re-attestation");
        const recoveryOutcomes = await Promise.allSettled([
            recovery.recover({ planHash: recoveryPlan.planHash, confirmed: true, confirmation: RECOVERY_CONFIRMATION }, actor),
            recovery.recover({ planHash: recoveryPlan.planHash, confirmed: true, confirmation: RECOVERY_CONFIRMATION }, actor)
        ]);
        assert(recoveryOutcomes.some(value => value.status === "fulfilled"), "at least one concurrent recovery must complete");
        assert.strictEqual(await CostChange.countDocuments({ canonicalPackageCode: sixtyCode, promotionMode: "AUTOMATIC_VERIFIED_API", warnings: "AUTHORITY_EVIDENCE_REATTESTED" }), 1);
        const replayPlan = await recovery.inspect();
        const recoveryReplay = await recovery.recover({ planHash: replayPlan.planHash, confirmed: true, confirmation: RECOVERY_CONFIRMATION }, actor);
        assert.strictEqual(recoveryReplay.applied, false);
        const api = service(), plan = await api.preflight();
        assert.strictEqual(plan.state, "READY");
        const disabledPackageCode = PACKAGE_MIGRATIONS.find(item => item.offerCode === "1800_uc").packageCode;
        const disabledBefore = await Package.findOne({ packageCode: disabledPackageCode }).lean();
        assert.strictEqual(disabledBefore.enabled, false, "1800 UC fixture must be intentionally disabled");
        const storeOrder = plan.storeSelection.packages.map(value => value.packageCode);
        const packageState = JSON.stringify((await Package.find().sort({ packageCode: 1 }).lean()).map(value => ({ id: String(value._id), packageCode: value.packageCode, enabled: value.enabled, prices: value.prices })));
        const attemptCount = await Attempt.countDocuments();
        const oldMapping = plan.rows[0].source, oldSelection = plan.rows[0].packageSelection;
        const oldFrozenRoute = selectedRouteSnapshot(oldMapping, oldSelection, "TH");
        const result = await api.cutover(cutoverInput(plan), actor);
        assert(result.applied && result.primaryCounts.every(value => value === 1));
        const cutoverAudit = await Audit.findOne({ action: CUTOVER_OPERATION }).lean();
        assert(cutoverAudit && cutoverAudit.metadata.packages.find(value => value.packageCode === disabledPackageCode)?.enabled === false, "audit must preserve the disabled package decision");
        assert.strictEqual(JSON.stringify((await Package.find().sort({ packageCode: 1 }).lean()).map(value => ({ id: String(value._id), packageCode: value.packageCode, enabled: value.enabled, prices: value.prices }))), packageState, "canonical package identity, enabled state, or prices changed");
        assert.strictEqual(await Attempt.countDocuments(), attemptCount, "historical attempts changed");
        assert.strictEqual(await Mapping.countDocuments({ supplierProductCode: SOURCE_PRODUCT_CODE, enabled: true, productionRole: "DISABLED" }), 6, "old frozen routes must remain executable");
        assert.strictEqual(await Mapping.countDocuments({ supplierProductCode: TARGET_PRODUCT_CODE, enabled: true, productionRole: "PRIMARY" }), 6);
        assert.strictEqual(await Mapping.countDocuments({ supplierProductCode: TARGET_PRODUCT_CODE, "mappingMetadata.readiness.pricingReady": true, "mappingMetadata.readiness.fulfillmentReady": true }), 6, "cutover must persist evidence-derived readiness without manual mapping edits");
        assert.deepStrictEqual((await StoreSelection.findOne().lean()).packages.map(value => value.packageCode), storeOrder, "Store Catalog presentation order changed");
        assert.strictEqual(String((await StoreSelection.findOne().lean()).packages.find(value => value.packageCode === "UNRELATED_PUBG_PACKAGE").supplierProductMappingId), String(seeded.unrelatedStoreMappingId), "cutover changed an unrelated Store Catalog selection");
        const selected = await PackageSelection.findOne({ packageCode: PACKAGE_MIGRATIONS[0].packageCode }).lean();
        const target = await Mapping.findById(selected.supplierMappingId).lean();
        const newRoute = selectedRouteSnapshot(target, selected, "TH");
        assert.strictEqual(newRoute.supplierProductCode, TARGET_PRODUCT_CODE, "new orders must select auto");
        const disabledTarget = await Mapping.findOne({ packageCode: disabledPackageCode, supplierProductCode: TARGET_PRODUCT_CODE }).lean();
        const disabledTargetOffer = await Offer.findById(disabledTarget.supplierCatalogOfferId).lean();
        const disabledAvailability = await Availability.findOne({ supplierCatalogOfferId: disabledTargetOffer._id }).lean();
        const disabledAssessment = assessMappingReadiness({ mode: READINESS_MODES.PUBLIC_PURCHASABLE, mapping: disabledTarget, supplier: plan.supplier, offer: disabledTargetOffer, availability: disabledAvailability, customerMarket: "TH", adapter, pkg: disabledBefore, publication: { published: true } });
        assert.strictEqual(disabledAssessment.ready, false);
        assert(disabledAssessment.blockers.includes("PACKAGE_NOT_PUBLIC_READY"), "disabled 1800 UC must remain unavailable for new purchases");
        let historicalStarts = 0;
        const paid = await ensurePaidOrderFulfillmentWork({ _id: new mongoose.Types.ObjectId(), orderId: "AZL-OLD-PAID", status: "paid", paymentStatus: "paid", product: { gameCode: PRODUCT_CODE, packageCode: oldMapping.packageCode }, commercial: { region: "TH" }, fulfilment: { routeSnapshot: oldFrozenRoute } }, { findAttemptByIdempotency: async () => null, startSupplierFulfillment: async (_orderId, payload) => { historicalStarts += 1; assert.strictEqual(String(payload.mappingId), String(oldMapping._id)); return { fulfillmentId: "FUL-OLD" }; } });
        assert.strictEqual(paid.reason, "SUPPLIER_FULFILLMENT_STARTED");
        assert.strictEqual(historicalStarts, 1, "paid old order must retain frozen fast route");
        const replay = await api.cutover(cutoverInput(plan), actor);
        assert.strictEqual(replay.idempotentReplay, true);
        assert.strictEqual(await Audit.countDocuments({ action: CUTOVER_OPERATION }), 1);

        const rollbackPlan = await api.rollbackPreflight({ cutoverPlanHash: plan.planHash });
        assert.strictEqual(rollbackPlan.state, "READY");
        const rolledBack = await api.rollback(rollbackInput(rollbackPlan, plan.planHash), actor);
        assert(rolledBack.applied);
        assert.strictEqual(JSON.stringify((await Package.find().sort({ packageCode: 1 }).lean()).map(value => ({ id: String(value._id), packageCode: value.packageCode, enabled: value.enabled, prices: value.prices }))), packageState, "rollback changed canonical package identity, enabled state, or prices");
        assert.strictEqual(await Mapping.countDocuments({ supplierProductCode: SOURCE_PRODUCT_CODE, productionRole: "PRIMARY" }), 6);
        assert.strictEqual(await Mapping.countDocuments({ supplierProductCode: TARGET_PRODUCT_CODE, enabled: true, productionRole: "DISABLED" }), 6, "target frozen routes must survive rollback");
        assert.strictEqual(String((await StoreSelection.findOne().lean()).packages.find(value => value.packageCode === "UNRELATED_PUBG_PACKAGE").supplierProductMappingId), String(seeded.unrelatedStoreMappingId), "rollback changed an unrelated Store Catalog selection");
        const rollbackReplay = await api.rollback(rollbackInput(rollbackPlan, plan.planHash), actor);
        assert.strictEqual(rollbackReplay.idempotentReplay, true);
        assert.strictEqual(await Audit.countDocuments({ action: ROLLBACK_OPERATION }), 1);

        await seed();
        await Package.updateOne({ packageCode: disabledPackageCode }, { $set: { "prices.MM.amount": 0 } });
        await assert.rejects(() => service().preflight(), error => error.code === "CUSTOMER_PRICE_INVALID");

        await seed();
        const failureApi = service(), failurePlan = await failureApi.preflight(), originalCreate = Audit.create;
        Audit.create = async () => { throw new Error("FORCED_AUDIT_FAILURE"); };
        await assert.rejects(() => failureApi.cutover(cutoverInput(failurePlan), actor), /FORCED_AUDIT_FAILURE/);
        Audit.create = originalCreate;
        assert.strictEqual(await Mapping.countDocuments({ supplierProductCode: SOURCE_PRODUCT_CODE, productionRole: "PRIMARY" }), 6, "transaction did not roll back");
        assert.strictEqual(await Mapping.countDocuments({ supplierProductCode: TARGET_PRODUCT_CODE, productionRole: "PRIMARY" }), 0);

        await seed();
        const staleApi = service(), stalePlan = await staleApi.preflight();
        await Mapping.updateOne({ supplierProductCode: TARGET_PRODUCT_CODE }, { $set: { "supplierCostAuthority.rawSupplierCost": 999 } });
        await assert.rejects(() => staleApi.cutover(cutoverInput(stalePlan), actor), error => ["COST_AUTHORITY_INVALID", "CUTOVER_PLAN_CHANGED"].includes(error.code));
        assert.strictEqual(await Mapping.countDocuments({ supplierProductCode: SOURCE_PRODUCT_CODE, productionRole: "PRIMARY" }), 6);

        await seed();
        await Mapping.updateOne({ supplierProductCode: TARGET_PRODUCT_CODE }, { $set: { supplierCostAuthority: {} } });
        await assert.rejects(() => service().preflight(), error => error.code === "COST_AUTHORITY_INVALID");

        await seed();
        await Mapping.updateOne({ supplierProductCode: TARGET_PRODUCT_CODE }, { $set: { "mappingMetadata.fulfillmentContract.fields.0.providerField": "unverified_field" } });
        await assert.rejects(() => service().preflight(), error => error.code === "TARGET_CONTRACT_INVALID");

        await seed();
        const providerOff = createPubgMobileAutoCutoverService({ connection: mongoose.connection, clock: () => NOW, env: {}, adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => false }) });
        await assert.rejects(() => providerOff.preflight(), error => error.code === "PROVIDER_NOT_READY");

        await seed();
        const staleTarget = await Offer.findOne({ supplierProductCode: TARGET_PRODUCT_CODE }).lean();
        await Availability.updateOne({ supplierCatalogOfferId: staleTarget._id }, { $set: { staleAt: NOW } });
        await assert.rejects(() => service().preflight(), error => error.code === "AVAILABILITY_NOT_CURRENT");
        const staleRecovery = await createPubgMobileAutoCostRecoveryService({ clock: () => NOW, env: process.env }).inspect();
        assert.strictEqual(staleRecovery.state, "BLOCKED");
        assert(staleRecovery.decisions.some(value => value.code === "SUPPLIER_AVAILABILITY_NOT_CONFIRMED"));

        console.log(JSON.stringify({ result: "PASS", mongoVersion: "7.0.14", isolatedReplicaSet: true, packages: 6, consolidatedSixPackageDiagnosis: true, verifiedCostAuthorityRecovery: true, sameAmountEvidenceReattestation: true, recoveryConcurrentSafe: true, recoveryIdempotent: true, recoveryStaleEvidenceBlocked: true, disabled1800UcPreserved: true, disabled1800UcPublicPurchasable: false, invalidExistingPriceBlocked: true, canonicalPackageIdsPreserved: true, atomicCutover: true, exactOnePrimary: true, storePresentationOrderPreserved: true, unrelatedStoreSelectionPreserved: true, newOrderRoute: TARGET_PRODUCT_CODE, paidHistoricalRoute: SOURCE_PRODUCT_CODE, customerPricesUnchanged: true, historicalAttemptsUnchanged: true, transactionRollback: true, staleEvidenceBlocked: true, missingCostAuthorityBlocked: true, invalidContractBlocked: true, providerGateBlocked: true, stalePlanBlocked: true, cutoverIdempotent: true, rollbackIdempotent: true, auditsVerified: true, supplierCalls: 0, productionConnections: 0 }, null, 2));
    } finally {
        await mongoose.disconnect().catch(() => null);
        await repl.stop();
    }
}

run().catch(error => { console.dir(error, { depth: 8 }); process.exitCode = 1; });
