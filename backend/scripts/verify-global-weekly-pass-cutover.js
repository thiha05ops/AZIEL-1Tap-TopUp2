#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const AdminAccount = require("../models/AdminAccount");
const AdminSession = require("../models/AdminSession");
const AdminAuditLog = require("../models/AdminAuditLog");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const CommerceOrder = require("../models/CommerceOrder");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierCatalogProduct = require("../models/SupplierCatalogProduct");
const SupplierCatalogReconciliationDecision = require("../models/SupplierCatalogReconciliationDecision");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const { CUTOVER, createGlobalWeeklyPassCutoverService } = require("../services/supplierCatalog/globalWeeklyPassCutoverService");
const { sourceLock } = require("../services/supplierCatalog/supplierCatalogReconciliationService");

const OID = Object.freeze({ owner: new mongoose.Types.ObjectId(), supplier: new mongoose.Types.ObjectId(), supplierProduct: new mongoose.Types.ObjectId(), offer: new mongoose.Types.ObjectId("6a93fe1bf8c717124060b28f"), decision: new mongoose.Types.ObjectId("6a94f2b21c1d128fed462603"), mapping: new mongoose.Types.ObjectId(CUTOVER.mappingId) });
const NOW = new Date("2026-10-14T08:00:00.000Z");
const UPDATED = new Date("2026-10-06T14:44:00.943Z");
const H = Object.freeze({ offer: "1".repeat(64), productSnapshot: "2".repeat(64) });
let LOCK = null;
let assertions = 0;
function ok(value, message) { assert(value, message); assertions += 1; }
async function rejects(fn, code) { await assert.rejects(fn, error => error.code === code); assertions += 1; }

async function clear() {
    const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) if (!name.startsWith("system.")) await mongoose.connection.db.collection(name).deleteMany({});
}

async function seed() {
    await clear();
    await AdminAccount.create({ _id: OID.owner, username: "owner", usernameNormalized: "owner", displayName: "Owner", passwordHash: "isolated-test-only", role: "OWNER", status: "ACTIVE" });
    await AdminSession.create({ sessionId: "isolated-owner-session", adminId: OID.owner, createdAt: new Date(NOW.getTime() - 1000), expiresAt: new Date(NOW.getTime() + 3600000), revokedAt: null });
    await CatalogProduct.create({ productCode: CUTOVER.newProductCode, name: "Mobile Legends (Global)", enabled: true, lifecycleStatus: "ACTIVE", commerceState: "PURCHASABLE", publicDiscoveryEnabled: true });
    const supplierProduct = await SupplierCatalogProduct.create({ _id: OID.supplierProduct, supplierId: OID.supplier, catalogNamespace: "FAZERCARDS_RESELLER_CATALOG", supplierProductCode: CUTOVER.supplierProductCode, supplierMarketCode: "GLOBAL", displayName: "Mobile Legends (Global)", supportState: "SUPPORTED", normalizedInputContract: { requiredFields: ["player_id", "zone_id"] }, restrictions: [{ type: "DESTINATION", value: "GLOBAL" }], firstSeenAt: NOW, lastSeenAt: NOW, lastObservedAt: NOW, lastChangedAt: NOW, sourceRevision: "reviewed-product-revision", rawSnapshotHash: H.productSnapshot, rawSnapshot: { fixture: true } });
    await SupplierCatalogOffer.collection.insertOne({ _id: OID.offer, supplierId: OID.supplier, supplierCatalogProductId: OID.supplierProduct, catalogNamespace: "FAZERCARDS_RESELLER_CATALOG", supplierProductCode: CUTOVER.supplierProductCode, supplierOfferCode: CUTOVER.supplierPackageCode, supplierOfferName: "Weekly Pass", catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", normalizedSemantics: { repeatability: "REPEATABLE", passType: "WEEKLY" }, rawSnapshotHash: H.offer, sourceRevision: "reviewed-revision", lastChangedAt: NOW, supplierCost: { amount: 1.5092, currency: "USD", observedAt: NOW }, createdAt: NOW, updatedAt: NOW });
    const availability = await SupplierOfferAvailability.create({ supplierCatalogOfferId: OID.offer, state: "AVAILABLE", evidenceCode: "AUTHORITATIVE_CATALOG", observedAt: NOW, lastAvailableAt: NOW, consecutiveMissingCount: 0, coverageComplete: true });
    const offer = await SupplierCatalogOffer.findById(OID.offer).lean();
    LOCK = sourceLock({ offer, product: supplierProduct.toObject(), availability: availability.toObject() });
    await SupplierProductMapping.collection.insertOne({ _id: OID.mapping, supplierId: OID.supplier, supplierCode: CUTOVER.supplierCode, productCode: CUTOVER.oldProductCode, packageCode: CUTOVER.oldPackageCode, supplierProductCode: CUTOVER.supplierProductCode, supplierPackageCode: CUTOVER.supplierPackageCode, supplierCatalogOfferId: OID.offer, supplierDisplayName: "Weekly Pass", region: "GLOBAL", enabled: true, productionRole: "PRIMARY", archivedAt: null, executionMode: "API", supplierCostAuthority: { rawSupplierCost: null, supplierCurrency: null, capturedAt: null, source: "", providerProductCode: "", providerOfferCode: "", fundingCost: 0, otherAcquisitionCost: 0 }, mappingMetadata: { reconciliationDecision: true, readiness: { supplierMapped: true, pricingReady: false, inputReady: true, fulfillmentReady: true, storefrontReady: true, validationReady: true }, fulfillmentContract: { version: 1, supplierCode: "FAZERCARDS", protocol: "FAZERCARDS_TOPUPS_ORDER_V2", supplierProductCode: CUTOVER.supplierProductCode, fields: [{ customerField: "playerId", providerField: "player_id", required: true, transformationId: "DIRECT" }], fingerprint: "fixture" } }, fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM", "TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "fixture", verifiedAt: NOW, version: 2 }, createdAt: new Date("2026-08-31T03:19:14.691Z"), updatedAt: UPDATED, __v: 0 });
    const actor = { adminId: OID.owner, username: "owner", role: "OWNER" };
    await SupplierCatalogReconciliationDecision.create({ _id: OID.decision, supplierCatalogOfferId: OID.offer, supplierIdentity: { supplierId: OID.supplier, supplierCode: CUTOVER.supplierCode, catalogNamespace: "FAZERCARDS_RESELLER_CATALOG", supplierProductCode: CUTOVER.supplierProductCode, supplierOfferCode: CUTOVER.supplierPackageCode }, decisionType: "LINK_TO_EXISTING_CANONICAL_PACKAGE", decisionStatus: "APPROVED", decisionVersion: 1, isCurrent: true, canonicalProductCode: CUTOVER.oldProductCode, canonicalPackageCode: CUTOVER.oldPackageCode, mappingId: OID.mapping, reasonCode: "EXACT_EXISTING_CANONICAL_REVIEWED", sourceOfferHash: LOCK.sourceOfferHash, sourceOfferRevision: LOCK.sourceOfferRevision, sourceLastChangedAt: LOCK.sourceLastChangedAt, sourceSemanticHash: LOCK.sourceSemanticHash, sourceProductEvidenceHash: LOCK.sourceProductEvidenceHash, sourceCostHash: LOCK.sourceCostHash, reviewedBy: actor, reviewedAt: NOW, approvedBy: actor, approvedAt: NOW, idempotencyKey: "original-decision", beforeState: {}, afterState: {}, auditTrail: { fixture: true } });
    const orders = Array.from({ length: 4 }, (_, index) => ({ orderId: `AZL-HISTORICAL-${index + 1}`, quoteId: `QUOTE-HISTORICAL-${index + 1}`, checkoutId: `CHECKOUT-HISTORICAL-${index + 1}`, status: "paid", paymentStatus: "paid", fulfilment: { status: "not_started", routeSnapshot: { supplierMappingId: CUTOVER.mappingId, productCode: CUTOVER.oldProductCode, packageCode: CUTOVER.oldPackageCode } }, marker: `untouched-${index + 1}` }));
    await CommerceOrder.collection.insertMany(orders);
}

function expected(overrides = {}) { return { mappingUpdatedAt: UPDATED.toISOString(), mappingVersion: 0, decisionId: String(OID.decision), decisionVersion: 1, sourceOfferHash: LOCK.sourceOfferHash, sourceOfferRevision: LOCK.sourceOfferRevision, sourceLastChangedAt: LOCK.sourceLastChangedAt, sourceSemanticHash: LOCK.sourceSemanticHash, sourceProductEvidenceHash: LOCK.sourceProductEvidenceHash, sourceCostHash: LOCK.sourceCostHash, ...overrides }; }
function sourceOnly(value) { return { sourceOfferHash: value.sourceOfferHash, sourceOfferRevision: value.sourceOfferRevision, sourceLastChangedAt: value.sourceLastChangedAt, sourceSemanticHash: value.sourceSemanticHash, sourceProductEvidenceHash: value.sourceProductEvidenceHash, sourceCostHash: value.sourceCostHash }; }
async function refreshFixtureEvidence() {
    const previousExpected = expected();
    const changedAt = new Date("2026-10-14T09:50:58.213Z");
    await SupplierCatalogOffer.updateOne({ _id: OID.offer }, { $set: { rawSnapshotHash: "3".repeat(64), sourceRevision: "", lastChangedAt: changedAt, lastObservedAt: changedAt, supplierCost: { amount: CUTOVER.reviewedCost.amount, currency: CUTOVER.reviewedCost.currency, observedAt: changedAt }, normalizedSemantics: { firstPurchaseOnly: false, repeatability: "REPEATABLE", passType: "WEEKLY" } } });
    await SupplierCatalogProduct.updateOne({ _id: OID.supplierProduct }, { $set: { rawSnapshotHash: "4".repeat(64), lastObservedAt: changedAt, restrictions: [{ scope: "CATEGORY", excludedMarkets: ["ID", "BR"] }, { scope: "OFFER_SET", excludedMarkets: ["MY", "SG", "PH", "ID", "RU"], offerLabels: ["Weekly Pass"] }] } });
    await SupplierOfferAvailability.updateOne({ supplierCatalogOfferId: OID.offer }, { $set: { state: "AVAILABLE", coverageComplete: true, evidenceCode: "FAZERCARDS_CATALOG_LISTED", observedAt: changedAt } });
    const [offer, product, availability] = await Promise.all([SupplierCatalogOffer.findById(OID.offer).lean(), SupplierCatalogProduct.findById(OID.supplierProduct).lean(), SupplierOfferAvailability.findOne({ supplierCatalogOfferId: OID.offer }).lean()]);
    LOCK = sourceLock({ offer, product, availability });
    return { expected: expected(), previousSource: sourceOnly(previousExpected) };
}
const actor = { id: OID.owner, sessionId: "isolated-owner-session" };

async function run() {
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
    try {
        await mongoose.connect(replSet.getUri("aziel_global_weekly_pass_cutover_test"), { autoIndex: true });
        for (const model of [AdminAccount, AdminSession, AdminAuditLog, CatalogProduct, CatalogPackage, CommerceOrder, PackageMarketPublication, PackageSupplierSelection, SupplierCatalogProduct, SupplierCatalogOffer, SupplierOfferAvailability, SupplierCatalogReconciliationDecision, SupplierProductMapping]) await model.syncIndexes();

        await seed();
        const service = createGlobalWeeklyPassCutoverService({ clock: () => NOW });
        const plan = await service.inspect({ expected: expected() });
        ok(plan.state === "READY" && plan.historicalOrders.length === 4, "dry-run verifies four frozen orders");
        const beforeOrders = await CommerceOrder.collection.find({ orderId: /^AZL-HISTORICAL-/ }).sort({ orderId: 1 }).toArray();
        const applied = await service.apply({ expected: expected(), planHash: plan.planHash, confirmed: true, confirmation: CUTOVER.confirmation }, { actor, requestId: "isolated-success" });
        ok(applied.applied && !applied.idempotentReplay, "cutover applies once");
        const [pkg, mapping, decisions, audit, selections, publications, afterOrders] = await Promise.all([
            CatalogPackage.findOne({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode }).lean(),
            SupplierProductMapping.findById(OID.mapping).lean(),
            SupplierCatalogReconciliationDecision.find({ supplierCatalogOfferId: OID.offer }).sort({ decisionVersion: 1 }).lean(),
            AdminAuditLog.findOne({ action: CUTOVER.operation }).lean(),
            PackageSupplierSelection.countDocuments({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode }),
            PackageMarketPublication.countDocuments({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode }),
            CommerceOrder.collection.find({ orderId: /^AZL-HISTORICAL-/ }).sort({ orderId: 1 }).toArray()
        ]);
        ok(pkg && pkg.enabled === false && Object.keys(pkg.prices || {}).length === 0, "package is disabled and unpriced");
        ok(mapping.productCode === CUTOVER.newProductCode && mapping.packageCode === CUTOVER.newPackageCode, "mapping canonical target moved");
        ok(mapping.supplierCode === CUTOVER.supplierCode && mapping.supplierProductCode === CUTOVER.supplierProductCode && mapping.supplierPackageCode === CUTOVER.supplierPackageCode && String(mapping.supplierCatalogOfferId) === String(OID.offer), "native identity is exact and unchanged");
        ok(mapping.supplierCostAuthority.rawSupplierCost == null && mapping.mappingMetadata.readiness.pricingReady === false && mapping.mappingMetadata.readiness.storefrontReady === false, "cost and commercial readiness remain closed");
        ok(decisions.length === 2 && decisions[0].decisionStatus === "SUPERSEDED" && decisions[0].isCurrent === false && decisions[1].decisionStatus === "APPROVED" && decisions[1].isCurrent === true && decisions[1].supersedesDecisionId.equals(decisions[0]._id), "decision history is preserved and superseded");
        ok(decisions[1].reviewedBy.adminId.equals(OID.owner) && decisions[1].approvedBy.adminId.equals(OID.owner), "persisted OWNER is audit authority");
        ok(audit && audit.actorAdminId.equals(OID.owner) && audit.metadata.historicalOrdersModified === 0, "mandatory audit is attributed and records zero order mutations");
        ok(selections === 0 && publications === 0, "no selection or publication is created");
        ok(JSON.stringify(beforeOrders.map(x => ({ orderId: x.orderId, status: x.status, paymentStatus: x.paymentStatus, fulfilment: x.fulfilment, marker: x.marker }))) === JSON.stringify(afterOrders.map(x => ({ orderId: x.orderId, status: x.status, paymentStatus: x.paymentStatus, fulfilment: x.fulfilment, marker: x.marker }))), "historical orders are byte-equivalent in relevant fields");
        ok(afterOrders.every(order => order.fulfilment.routeSnapshot.productCode === CUTOVER.oldProductCode && mapping.productCode !== order.fulfilment.routeSnapshot.productCode), "historical retries now fail closed on canonical mismatch");

        const replay = await service.apply({ expected: expected(), planHash: plan.planHash, confirmed: true, confirmation: CUTOVER.confirmation }, { actor, requestId: "isolated-replay" });
        ok(!replay.applied && replay.idempotentReplay, "identical replay is a no-op");
        ok(await CatalogPackage.countDocuments({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode }) === 1 && await SupplierCatalogReconciliationDecision.countDocuments({ supplierCatalogOfferId: OID.offer }) === 2 && await AdminAuditLog.countDocuments({ action: CUTOVER.operation }) === 1, "replay creates no duplicates");

        await seed();
        const auditFailureService = createGlobalWeeklyPassCutoverService({ clock: () => NOW, createAudit: async () => { throw Object.assign(new Error("forced audit failure"), { code: "AUDIT_FAILURE" }); } });
        const auditPlan = await auditFailureService.inspect({ expected: expected() });
        await assert.rejects(() => auditFailureService.apply({ expected: expected(), planHash: auditPlan.planHash, confirmed: true, confirmation: CUTOVER.confirmation }, { actor }), /forced audit failure/); assertions += 1;
        ok(!await CatalogPackage.exists({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode }) && (await SupplierProductMapping.findById(OID.mapping).lean()).productCode === CUTOVER.oldProductCode && (await SupplierCatalogReconciliationDecision.findById(OID.decision).lean()).isCurrent === true, "audit failure rolls back package, mapping and decision");

        await seed();
        await SupplierProductMapping.collection.updateOne({ _id: OID.mapping }, { $set: { updatedAt: new Date("2026-10-07T00:00:00.000Z") } });
        await rejects(() => createGlobalWeeklyPassCutoverService({ clock: () => NOW }).inspect({ expected: expected() }), "MAPPING_PRECONDITION_CONFLICT");
        ok(!await CatalogPackage.exists({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode }), "concurrency conflict creates nothing");

        await seed();
        await CatalogPackage.create({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode, name: CUTOVER.packageName, enabled: false, prices: {}, source: "admin" });
        await rejects(() => createGlobalWeeklyPassCutoverService({ clock: () => NOW }).inspect({ expected: expected() }), "CUTOVER_CONFLICTING_STATE");

        await seed();
        await rejects(() => createGlobalWeeklyPassCutoverService({ clock: () => NOW }).apply({ expected: expected(), planHash: "0".repeat(64), confirmed: true, confirmation: CUTOVER.confirmation }, { actor }), "CUTOVER_PLAN_HASH_MISMATCH");
        const confirmationService = createGlobalWeeklyPassCutoverService({ clock: () => NOW });
        const confirmationPlan = await confirmationService.inspect({ expected: expected() });
        await rejects(() => confirmationService.apply({ expected: expected(), planHash: confirmationPlan.planHash, confirmed: false, confirmation: CUTOVER.confirmation }, { actor }), "EXPLICIT_OWNER_CONFIRMATION_REQUIRED");

        await seed();
        const unauthorizedPlan = await createGlobalWeeklyPassCutoverService({ clock: () => NOW }).inspect({ expected: expected() });
        await AdminAccount.updateOne({ _id: OID.owner }, { $set: { role: "CATALOG" } });
        await rejects(() => createGlobalWeeklyPassCutoverService({ clock: () => NOW }).apply({ expected: expected(), planHash: unauthorizedPlan.planHash, confirmed: true, confirmation: CUTOVER.confirmation }, { actor }), "OWNER_AUTHENTICATION_REQUIRED");
        ok(!await CatalogPackage.exists({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode }), "persisted non-OWNER cannot invoke the cutover");

        await seed();
        await SupplierCatalogOffer.updateOne({ _id: OID.offer }, { $set: { "supplierCost.amount": 1.6 } });
        await rejects(() => createGlobalWeeklyPassCutoverService({ clock: () => NOW }).inspect({ expected: expected() }), "SUPPLIER_SOURCE_PRECONDITION_CONFLICT");
        ok(!await CatalogPackage.exists({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode }), "changed supplier evidence fails closed without writes");

        await seed();
        const refreshInput = await refreshFixtureEvidence();
        const refreshService = createGlobalWeeklyPassCutoverService({ clock: () => NOW });
        const refreshPlan = await refreshService.inspectRefresh(refreshInput);
        ok(refreshPlan.state === "READY" && refreshPlan.offer.supplierCost.amount === 1.4911, "refresh dry-run validates the reviewed current USD cost");
        ok(refreshPlan.supplierProduct.restrictions.some(item => item.offerLabels?.includes("Weekly Pass")), "refresh dry-run validates destination restrictions");
        const mappingBeforeRefresh = await SupplierProductMapping.findById(OID.mapping).lean();
        const refreshed = await refreshService.refreshApproval({ ...refreshInput, planHash: refreshPlan.planHash, confirmed: true, confirmation: CUTOVER.refreshConfirmation }, { actor, requestId: "isolated-refresh" });
        ok(refreshed.applied && refreshed.decisionVersion === 2, "authenticated OWNER refresh applies once");
        const [refreshDecisions, refreshAudit, mappingAfterRefresh] = await Promise.all([SupplierCatalogReconciliationDecision.find({ supplierCatalogOfferId: OID.offer }).sort({ decisionVersion: 1 }).lean(), AdminAuditLog.findOne({ action: CUTOVER.refreshOperation }).lean(), SupplierProductMapping.findById(OID.mapping).lean()]);
        ok(refreshDecisions.length === 2 && refreshDecisions[0].decisionStatus === "SUPERSEDED" && refreshDecisions[1].decisionStatus === "APPROVED" && refreshDecisions[1].reasonCode === "GLOBAL_WEEKLY_PASS_SOURCE_REAPPROVED", "refresh preserves immutable decision history");
        ok(refreshAudit?.actorAdminId.equals(OID.owner) && refreshAudit.metadata.mappingChanged === false, "refresh audit is mandatory and OWNER-attributed");
        ok(mappingAfterRefresh.productCode === mappingBeforeRefresh.productCode && mappingAfterRefresh.packageCode === mappingBeforeRefresh.packageCode && mappingAfterRefresh.updatedAt.getTime() === mappingBeforeRefresh.updatedAt.getTime() && mappingAfterRefresh.__v === mappingBeforeRefresh.__v, "refresh does not modify the mapping or old canonical target");
        const refreshReplay = await refreshService.refreshApproval({ ...refreshInput, planHash: refreshPlan.planHash, confirmed: true, confirmation: CUTOVER.refreshConfirmation }, { actor, requestId: "isolated-refresh-replay" });
        ok(refreshReplay.idempotentReplay && !refreshReplay.applied, "refresh replay is idempotent");
        ok(await SupplierCatalogReconciliationDecision.countDocuments({ supplierCatalogOfferId: OID.offer }) === 2 && await AdminAuditLog.countDocuments({ action: CUTOVER.refreshOperation }) === 1, "refresh replay creates no duplicate decision or audit");

        await seed();
        const rollbackInput = await refreshFixtureEvidence();
        const rollbackRefreshService = createGlobalWeeklyPassCutoverService({ clock: () => NOW, createAudit: async () => { throw new Error("forced refresh audit failure"); } });
        const rollbackPlan = await rollbackRefreshService.inspectRefresh(rollbackInput);
        await assert.rejects(() => rollbackRefreshService.refreshApproval({ ...rollbackInput, planHash: rollbackPlan.planHash, confirmed: true, confirmation: CUTOVER.refreshConfirmation }, { actor }), /forced refresh audit failure/); assertions += 1;
        ok(await SupplierCatalogReconciliationDecision.countDocuments({ supplierCatalogOfferId: OID.offer }) === 1 && (await SupplierCatalogReconciliationDecision.findById(OID.decision).lean()).isCurrent === true, "refresh audit failure rolls back decision supersession");

        await seed();
        const concurrentInput = await refreshFixtureEvidence();
        const concurrentService = createGlobalWeeklyPassCutoverService({ clock: () => NOW });
        const concurrentPlan = await concurrentService.inspectRefresh(concurrentInput);
        await SupplierCatalogReconciliationDecision.updateOne({ _id: OID.decision }, { $set: { sourceOfferHash: "f".repeat(64) } });
        await rejects(() => concurrentService.refreshApproval({ ...concurrentInput, planHash: concurrentPlan.planHash, confirmed: true, confirmation: CUTOVER.refreshConfirmation }, { actor }), "REFRESH_PREVIOUS_DECISION_CONFLICT");
        ok(await SupplierCatalogReconciliationDecision.countDocuments({ supplierCatalogOfferId: OID.offer }) === 1, "concurrent decision change creates no replacement");

        await seed();
        const staleInput = await refreshFixtureEvidence();
        const staleService = createGlobalWeeklyPassCutoverService({ clock: () => NOW });
        const stalePlan = await staleService.inspectRefresh(staleInput);
        await SupplierCatalogOffer.updateOne({ _id: OID.offer }, { $set: { "supplierCost.amount": 1.48 } });
        await rejects(() => staleService.refreshApproval({ ...staleInput, planHash: stalePlan.planHash, confirmed: true, confirmation: CUTOVER.refreshConfirmation }, { actor }), "SUPPLIER_SOURCE_PRECONDITION_CONFLICT");
        ok(await SupplierCatalogReconciliationDecision.countDocuments({ supplierCatalogOfferId: OID.offer }) === 1, "stale supplier source creates no refreshed approval");

        console.log(JSON.stringify({ result: "PASS", assertions, isolatedDatabase: "mongodb-memory-server replica set", productionConnections: 0, supplierCalls: 0, historicalOrderWrites: 0 }, null, 2));
    } finally {
        await mongoose.disconnect().catch(() => {});
        await replSet.stop();
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
