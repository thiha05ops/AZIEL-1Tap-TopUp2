"use strict";

const assert = require("assert");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const SupplierCatalogProduct = require("../models/SupplierCatalogProduct");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const Decision = require("../models/SupplierCatalogReconciliationDecision");
const AdminAuditLog = require("../models/AdminAuditLog");
const { createSupplierCanonicalProductAuthorityService } = require("../services/supplierCatalog/supplierCanonicalProductAuthorityService");
const { createSupplierCatalogReconciliationService } = require("../services/supplierCatalog/supplierCatalogReconciliationService");
const { createSupplierCatalogMongoRepositories } = require("../services/supplierCatalog/supplierCatalogMongoRepositories");

const uri = process.env.AZIEL_LIFECYCLE_TEST_MONGODB_URI;
if (!uri || process.env.AZIEL_LIFECYCLE_TEST_DB_CONFIRMED !== "true") {
    console.log(JSON.stringify({ result: "SKIP", reason: "AZIEL_LIFECYCLE_TEST_MONGODB_URI and AZIEL_LIFECYCLE_TEST_DB_CONFIRMED=true are required", productionWrites: 0 }, null, 2));
    process.exit(0);
}
const databaseName = decodeURIComponent((uri.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "").toLowerCase();
if (!databaseName || !/(test|isolated|lifecycle)/.test(databaseName) || /(prod|production|admin|config|local)/.test(databaseName)) throw new Error(`Unsafe lifecycle test database name: ${databaseName || "missing"}`);

const runId = `lifecycle-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const objectIds = Array.from({ length: 11 }, () => new mongoose.Types.ObjectId());
const [supplierId, productId, offerId, linkOfferId, linkPackageId, staleProductId, staleOfferId, collisionProductId, collisionCanonicalId, rollbackProductId, rollbackOfferId] = objectIds;
const actor = { id: new mongoose.Types.ObjectId(), username: "lifecycle-owner", role: "OWNER" };
const now = new Date();
const hash = value => crypto.createHash("sha256").update(`${runId}:${value}`).digest("hex");
const concurrentOutcome = item => item.status === "fulfilled"
    ? { status: "fulfilled", idempotentReplay: item.value?.idempotentReplay === true, concurrentReplay: item.value?.concurrentReplay === true, productCode: item.value?.canonicalProduct?.productCode || "" }
    : { status: "rejected", name: item.reason?.name || "Error", domainCode: typeof item.reason?.code === "string" ? item.reason.code : "", mongoCode: Number.isFinite(Number(item.reason?.code)) ? Number(item.reason.code) : null, labels: Array.isArray(item.reason?.errorLabels) ? item.reason.errorLabels : [], statusCode: item.reason?.statusCode || null };

async function cleanup() {
    await SupplierProductMapping.deleteMany({ supplierCatalogOfferId: { $in: [offerId, linkOfferId, staleOfferId, rollbackOfferId] } });
    await Decision.deleteMany({ supplierCatalogOfferId: { $in: [offerId, linkOfferId, staleOfferId, rollbackOfferId] } });
    await CatalogPackage.deleteMany({ $or: [{ _id: linkPackageId }, { "metadata.sourceSupplierCatalogOfferId": { $in: [String(offerId), String(linkOfferId), String(staleOfferId), String(rollbackOfferId)] } }] });
    await CatalogProduct.deleteMany({ $or: [{ _id: collisionCanonicalId }, { "metadata.preparedFromSupplierCatalogProductId": { $in: [String(productId), String(staleProductId), String(collisionProductId), String(rollbackProductId)] } }] });
    await SupplierOfferAvailability.deleteMany({ supplierCatalogOfferId: { $in: [offerId, linkOfferId, staleOfferId, rollbackOfferId] } });
    await SupplierCatalogOffer.deleteMany({ _id: { $in: [offerId, linkOfferId, staleOfferId, rollbackOfferId] } });
    await SupplierCatalogProduct.deleteMany({ _id: { $in: [productId, staleProductId, collisionProductId, rollbackProductId] } });
    await Supplier.deleteMany({ _id: supplierId });
    await AdminAuditLog.deleteMany({ requestId: runId });
}

(async () => {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert(hello.setName, "Replica set is required");
    assert(Number(hello.logicalSessionTimeoutMinutes) > 0, "Logical sessions are required");
    await cleanup();
    await Supplier.create({ _id: supplierId, supplierCode: `T${hash("supplier").slice(0, 10).toUpperCase()}`, name: runId, mode: "API", enabled: true, supportedRegions: ["TH"] });
    const productDocument = { _id: productId, supplierId, catalogNamespace: "LIFECYCLE_TEST", supplierProductCode: runId, supplierMarketCode: "TH", displayName: "Lifecycle Test Game", supportState: "SUPPORTED", requiredFields: [], normalizedInputContract: {}, restrictions: [], metadata: {}, firstSeenAt: now, lastSeenAt: now, lastObservedAt: now, lastChangedAt: now, sourceRevision: "p1", rawSnapshotHash: hash("product-source"), rawSnapshot: { runId } };
    await SupplierCatalogProduct.create(productDocument);
    await SupplierCatalogOffer.create({ _id: offerId, supplierCatalogProductId: productId, supplierId, catalogNamespace: "LIFECYCLE_TEST", supplierProductCode: runId, supplierOfferCode: "60", supplierOfferName: "60 Gems", rawSemantics: {}, normalizedSemantics: { denomination: 60 }, catalogLifecycleState: "ACTIVE", reconciliationState: "NO_CANONICAL_PACKAGE", reconciliationEvidence: {}, firstSeenAt: now, lastSeenAt: now, lastObservedAt: now, lastChangedAt: now, sourceRevision: "o1", rawSnapshotHash: hash("offer-source"), rawSnapshot: { runId, offer: 60 } });
    await SupplierCatalogOffer.create({ _id: linkOfferId, supplierCatalogProductId: productId, supplierId, catalogNamespace: "LIFECYCLE_TEST", supplierProductCode: runId, supplierOfferCode: "120", supplierOfferName: "120 Gems", rawSemantics: {}, normalizedSemantics: { denomination: 120 }, catalogLifecycleState: "ACTIVE", reconciliationState: "NO_CANONICAL_PACKAGE", reconciliationEvidence: {}, firstSeenAt: now, lastSeenAt: now, lastObservedAt: now, lastChangedAt: now, sourceRevision: "o2", rawSnapshotHash: hash("link-offer-source"), rawSnapshot: { runId, offer: 120 } });
    await SupplierOfferAvailability.create({ supplierCatalogOfferId: offerId, state: "AVAILABLE", evidenceCode: "LIFECYCLE_TEST", observedAt: now, consecutiveMissingCount: 0, coverageComplete: true });
    await SupplierOfferAvailability.create({ supplierCatalogOfferId: linkOfferId, state: "AVAILABLE", evidenceCode: "LIFECYCLE_TEST", observedAt: now, consecutiveMissingCount: 0, coverageComplete: true });

    const authority = createSupplierCanonicalProductAuthorityService({ gate: () => true });
    const plan = await authority.plan(productId);
    const createPlanOffer = plan.offers.find(item => String(item.supplierCatalogOfferId) === String(offerId));
    assert(createPlanOffer, "product authority plan must source-lock the create offer by exact ID");
    const persistedProduct = await SupplierCatalogProduct.findById(productId).lean();
    const persistedCreateOffer = await SupplierCatalogOffer.findById(offerId).lean();
    assert.strictEqual(plan.product.sourceLock.sourceRevision, persistedProduct.sourceRevision);
    assert.strictEqual(createPlanOffer.sourceLock.sourceOfferRevision, persistedCreateOffer.sourceRevision);
    assert.strictEqual(createPlanOffer.sourceLock.supplierOfferCode, persistedCreateOffer.supplierOfferCode);
    const input = { supplierCatalogProductId: String(productId), confirmed: true, productCode: plan.canonical.productCode, name: plan.canonical.name, expectedSource: plan.product.sourceLock, approvedOffers: [{ supplierCatalogOfferId: String(offerId), expectedSource: createPlanOffer.sourceLock }], idempotencyKey: runId };
    const concurrent = await Promise.allSettled([authority.authorize(input, { actor, requestId: runId }), authority.authorize(input, { actor, requestId: runId })]);
    const concurrentOutcomes = concurrent.map(concurrentOutcome);
    const created = concurrent.find(item => item.status === "fulfilled")?.value;
    assert(created, `one concurrent product authority request must succeed: ${JSON.stringify(concurrentOutcomes)}`);
    assert(concurrent.filter(item => item.status === "fulfilled").length >= 1, `at least one request must fulfill: ${JSON.stringify(concurrentOutcomes)}`);
    assert(concurrent.filter(item => item.status === "rejected").every(item => ["CANONICAL_PRODUCT_AUTHORITY_RACE_UNRESOLVED"].includes(item.reason?.code)), `race loser must be controlled: ${JSON.stringify(concurrentOutcomes)}`);
    assert.strictEqual(created.canonicalProduct.commerceState, "HIDDEN");
    assert.strictEqual(created.canonicalProduct.publicDiscoveryEnabled, false);
    const durableProducts = await CatalogProduct.find({ productCode: plan.canonical.productCode }).lean();
    const durableSource = await SupplierCatalogProduct.findById(productId).lean();
    const durableAudits = await AdminAuditLog.find({ action: "SUPPLIER_CANONICAL_PRODUCT_CREATED", resourceType: "CatalogProduct", resourceId: plan.canonical.productCode, "metadata.supplierCatalogProductId": String(productId), "metadata.idempotencyKey": runId }).lean();
    assert.strictEqual(durableProducts.length, 1, `exactly one canonical product must survive: ${JSON.stringify(concurrentOutcomes)}`);
    assert.strictEqual(durableProducts[0].metadata?.preparedFromSupplierCatalogProductId, String(productId));
    assert.strictEqual(durableSource.metadata?.onboardingCanonicalProduct?.supplierId, String(supplierId));
    assert.strictEqual(durableSource.metadata?.onboardingCanonicalProduct?.catalogNamespace, "LIFECYCLE_TEST");
    assert.strictEqual(durableSource.metadata?.onboardingCanonicalProduct?.supplierProductCode, runId);
    assert.strictEqual(durableSource.metadata?.onboardingCanonicalProduct?.sourceHash, productDocument.rawSnapshotHash);
    assert.strictEqual(durableSource.metadata?.onboardingCanonicalProduct?.productCode, plan.canonical.productCode);
    assert.strictEqual(durableAudits.length, 1, `exactly one creation audit must survive: ${JSON.stringify(concurrentOutcomes)}`);
    const replay = await authority.authorize(input, { actor, requestId: runId });
    assert.strictEqual(replay.idempotentReplay, true);
    assert.strictEqual(await CatalogProduct.countDocuments({ productCode: plan.canonical.productCode }), 1);
    assert.strictEqual(await AdminAuditLog.countDocuments({ action: "SUPPLIER_CANONICAL_PRODUCT_CREATED", resourceType: "CatalogProduct", resourceId: plan.canonical.productCode, "metadata.supplierCatalogProductId": String(productId), "metadata.idempotencyKey": runId }), 1);

    const reconciliation = createSupplierCatalogReconciliationService({ mutationsEnabled: () => true });
    const reconciled = await reconciliation.decide({ supplierCatalogOfferId: String(offerId), decisionType: "CREATE_CANONICAL_PACKAGE_AND_LINK", confirmed: true, canonicalProductCode: plan.canonical.productCode, canonicalPackageName: "60 Gems", region: "TH", reasonCode: "LIFECYCLE_TEST", reviewNotes: runId, expectedSource: createPlanOffer.sourceLock, requestIdempotencyKey: `${runId}:offer` }, { actor, requestId: runId });
    assert(reconciled.canonicalPackage && reconciled.mapping && reconciled.decision);
    assert.strictEqual(reconciled.mapping.enabled, false);
    assert.strictEqual(reconciled.mapping.productionRole, "DISABLED");
    assert.strictEqual(reconciled.mapping.executionMode, "MANUAL");
    const createdMapping = await SupplierProductMapping.findById(reconciled.mapping._id).lean();
    assert.strictEqual(createdMapping.region, "TH");
    assert.strictEqual(createdMapping.supplierMarketEvidence.normalizedMarket, "TH");
    assert.strictEqual(createdMapping.supplierMarketEvidence.supplierMarketCode, "TH");
    assert.strictEqual(createdMapping.supplierMarketEvidence.marketClassification, "ELIGIBLE_ASIA_COUNTRY");
    assert.strictEqual(createdMapping.supplierMarketEvidence.evidenceCode, "EXPLICIT_TARGET_ASIA_MARKET_EVIDENCE");
    assert.strictEqual(createdMapping.supplierMarketEvidence.sourceProductHash, productDocument.rawSnapshotHash);
    const packageReplay = await reconciliation.decide({ supplierCatalogOfferId: String(offerId), decisionType: "CREATE_CANONICAL_PACKAGE_AND_LINK", confirmed: true, canonicalProductCode: plan.canonical.productCode, canonicalPackageName: "60 Gems", region: "TH", reasonCode: "LIFECYCLE_TEST", reviewNotes: runId, expectedSource: createPlanOffer.sourceLock, requestIdempotencyKey: `${runId}:offer` }, { actor, requestId: runId });
    assert.strictEqual(packageReplay.idempotentReplay, true);

    await CatalogPackage.create({ _id: linkPackageId, productCode: plan.canonical.productCode, packageCode: `LINK_${hash("package-code").slice(0, 12).toUpperCase()}`, name: "120 Gems Existing", enabled: false, metadata: { sourceSupplierCatalogOfferId: String(linkOfferId) } });
    const linkPlanOffer = plan.offers.find(item => String(item.supplierCatalogOfferId) === String(linkOfferId));
    assert(linkPlanOffer, "product authority plan must source-lock the link offer");
    const linked = await reconciliation.decide({ supplierCatalogOfferId: String(linkOfferId), decisionType: "LINK_TO_EXISTING_CANONICAL_PACKAGE", confirmed: true, canonicalPackageId: String(linkPackageId), region: "TH", reasonCode: "LIFECYCLE_TEST", reviewNotes: runId, expectedSource: linkPlanOffer.sourceLock, requestIdempotencyKey: `${runId}:link-offer` }, { actor, requestId: runId });
    const linkedMapping = await SupplierProductMapping.findById(linked.mapping._id).lean();
    assert(linkedMapping && linked.decision, "link action must persist mapping and decision");
    assert.strictEqual(linkedMapping.region, "TH");
    assert.strictEqual(linkedMapping.supplierMarketEvidence.normalizedMarket, "TH");
    assert.strictEqual(linkedMapping.supplierMarketEvidence.supplierMarketCode, "TH");
    assert.strictEqual(linkedMapping.supplierMarketEvidence.marketClassification, "ELIGIBLE_ASIA_COUNTRY");
    assert.strictEqual(linkedMapping.supplierMarketEvidence.evidenceCode, "EXPLICIT_TARGET_ASIA_MARKET_EVIDENCE");
    assert.strictEqual(linkedMapping.supplierMarketEvidence.sourceProductHash, productDocument.rawSnapshotHash);

    await SupplierCatalogProduct.create({ ...productDocument, _id: staleProductId, supplierProductCode: `${runId}-stale`, displayName: "Lifecycle Stale Source", sourceRevision: "stale-p1", rawSnapshotHash: hash("stale-product") });
    await SupplierCatalogOffer.create({ ...(await SupplierCatalogOffer.findById(offerId).lean()), _id: staleOfferId, supplierCatalogProductId: staleProductId, supplierProductCode: `${runId}-stale`, supplierOfferCode: "stale-60", sourceRevision: "stale-o1", rawSnapshotHash: hash("stale-offer-v1") });
    await SupplierOfferAvailability.create({ supplierCatalogOfferId: staleOfferId, state: "AVAILABLE", evidenceCode: "LIFECYCLE_TEST", observedAt: now, consecutiveMissingCount: 0, coverageComplete: true });
    const stalePlan = await authority.plan(staleProductId);
    const stalePlanOffer = stalePlan.offers.find(item => String(item.supplierCatalogOfferId) === String(staleOfferId));
    assert(stalePlanOffer, "stale-source plan must contain the exact offer");
    const staleInput = { supplierCatalogProductId: String(staleProductId), confirmed: true, productCode: stalePlan.canonical.productCode, name: stalePlan.canonical.name, expectedSource: stalePlan.product.sourceLock, approvedOffers: [{ supplierCatalogOfferId: String(staleOfferId), expectedSource: stalePlanOffer.sourceLock }], idempotencyKey: `${runId}:stale` };
    const staleOffer = await SupplierCatalogOffer.findById(staleOfferId).lean();
    const ingestionRepositories = createSupplierCatalogMongoRepositories();
    await ingestionRepositories.offers.upsert({ supplierCatalogProductId: staleOffer.supplierCatalogProductId, supplierId: staleOffer.supplierId, catalogNamespace: staleOffer.catalogNamespace, supplierProductCode: staleOffer.supplierProductCode, supplierOfferCode: staleOffer.supplierOfferCode, supplierOfferName: staleOffer.supplierOfferName, rawName: staleOffer.rawName, supplierCost: staleOffer.supplierCost, rawSemantics: staleOffer.rawSemantics, normalizedSemantics: staleOffer.normalizedSemantics, catalogLifecycleState: staleOffer.catalogLifecycleState, reconciliationState: staleOffer.reconciliationState, reconciliationEvidence: staleOffer.reconciliationEvidence, firstSeenAt: staleOffer.firstSeenAt, lastSeenAt: new Date(now.getTime() + 1000), lastObservedAt: new Date(now.getTime() + 1000), lastChangedAt: new Date(now.getTime() + 1000), sourceRevision: "stale-o2", rawSnapshotHash: hash("stale-offer-v2"), rawSnapshot: { runId, offer: "stale-v2" }, metadata: staleOffer.metadata });
    await assert.rejects(() => authority.authorize(staleInput, { actor, requestId: runId }), error => error?.code === "STALE_SOURCE_REVISION");
    assert.strictEqual(await CatalogProduct.countDocuments({ productCode: stalePlan.canonical.productCode }), 0, "stale source must not create a canonical product");
    assert.strictEqual(Boolean((await SupplierCatalogProduct.findById(staleProductId).lean()).metadata?.onboardingCanonicalProduct), false, "stale source must not acquire authority");
    assert.strictEqual(await AdminAuditLog.countDocuments({ action: "SUPPLIER_CANONICAL_PRODUCT_CREATED", "metadata.supplierCatalogProductId": String(staleProductId) }), 0, "stale source must not create an audit");

    await SupplierCatalogProduct.create({ ...productDocument, _id: collisionProductId, supplierProductCode: `${runId}-collision`, displayName: "Lifecycle Collision Product", sourceRevision: "collision-p1", rawSnapshotHash: hash("collision-product") });
    const collisionPlan = await authority.plan(collisionProductId);
    await CatalogProduct.create({ _id: collisionCanonicalId, productCode: collisionPlan.canonical.productCode, name: "Unrelated Existing Product", enabled: false, commerceState: "HIDDEN", publicDiscoveryEnabled: false, metadata: { preparedFromSupplierCatalogProductId: String(new mongoose.Types.ObjectId()) } });
    await assert.rejects(() => authority.authorize({ supplierCatalogProductId: String(collisionProductId), confirmed: true, productCode: collisionPlan.canonical.productCode, name: collisionPlan.canonical.name, expectedSource: collisionPlan.product.sourceLock, approvedOffers: [], idempotencyKey: `${runId}:collision` }, { actor, requestId: runId }), error => error?.code === "CANONICAL_PRODUCT_CODE_CONFLICT");
    assert.strictEqual(Boolean((await SupplierCatalogProduct.findById(collisionProductId).lean()).metadata?.onboardingCanonicalProduct), false, "unrelated product-code collision must not acquire authority");

    await SupplierCatalogProduct.create({ ...productDocument, _id: rollbackProductId, supplierProductCode: `${runId}-rollback`, rawSnapshotHash: hash("rollback-product") });
    await SupplierCatalogOffer.create({ ...(await SupplierCatalogOffer.findById(offerId).lean()), _id: rollbackOfferId, supplierCatalogProductId: rollbackProductId, supplierProductCode: `${runId}-rollback`, supplierOfferCode: "rollback", rawSnapshotHash: hash("rollback-offer") });
    const rollbackPlan = await authority.plan(rollbackProductId);
    const originalCreate = AdminAuditLog.create;
    AdminAuditLog.create = async () => { throw new Error("forced audit failure"); };
    await assert.rejects(() => authority.authorize({ supplierCatalogProductId: String(rollbackProductId), confirmed: true, productCode: rollbackPlan.canonical.productCode, name: rollbackPlan.canonical.name, expectedSource: rollbackPlan.product.sourceLock, approvedOffers: [], idempotencyKey: `${runId}:rollback` }, { actor, requestId: runId }), /forced audit failure/);
    AdminAuditLog.create = originalCreate;
    assert.strictEqual(await CatalogProduct.countDocuments({ productCode: rollbackPlan.canonical.productCode }), 0, "audit failure must roll back canonical product");
    assert.strictEqual(Boolean((await SupplierCatalogProduct.findById(rollbackProductId).lean()).metadata?.onboardingCanonicalProduct), false, "audit failure must roll back authority metadata");

    console.log(JSON.stringify({ result: "PASS", databaseName, replicaSet: hello.setName, logicalSessions: true, sourceLockSelection: "EXACT_OFFER_ID", persistedProductRevision: persistedProduct.sourceRevision, submittedProductRevision: input.expectedSource.sourceRevision, persistedCreateOfferRevision: persistedCreateOffer.sourceRevision, submittedCreateOfferRevision: input.approvedOffers[0].expectedSource.sourceOfferRevision, concurrentOutcomes, canonicalProductTransaction: true, canonicalProductCount: durableProducts.length, canonicalProductAuditCount: durableAudits.length, staleSourceRejected: true, staleSourceSideEffects: 0, trueCollisionFailsClosed: true, packageMappingDecisionAuditTransaction: true, createMappingMarketEvidence: true, linkMappingMarketEvidence: true, forcedAuditRollback: true, productReplay: true, packageReplay: true, concurrentDuplicateProductAttempts: true, productionWrites: 0 }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { try { if (mongoose.connection.readyState) await cleanup(); } finally { await mongoose.disconnect().catch(() => null); } });
