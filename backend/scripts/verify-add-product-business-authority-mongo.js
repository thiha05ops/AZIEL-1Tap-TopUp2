#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const uri = process.env.AZIEL_LIFECYCLE_TEST_MONGODB_URI;
const confirmed = process.env.AZIEL_LIFECYCLE_TEST_DB_CONFIRMED === "true";
if (!uri || !confirmed) {
    console.log(JSON.stringify({ result: "SKIP", reason: "AZIEL_LIFECYCLE_TEST_MONGODB_URI and AZIEL_LIFECYCLE_TEST_DB_CONFIRMED=true are required.", productionFallback: false, productionWrites: 0, supplierPurchaseCalls: 0 }, null, 2));
    process.exit(0);
}
const databaseName = decodeURIComponent((uri.match(/\/([^/?]+)(?:\?|$)/) || [])[1] || "").toLowerCase();
if (databaseName !== "aziel_supplier_onboarding_test" || /(prod|production|admin|config|local)/i.test(databaseName)) throw new Error(`Refusing non-isolated database: ${databaseName || "missing"}`);

const Supplier = require("../models/Supplier");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Mapping = require("../models/SupplierProductMapping");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Selection = require("../models/StoreCatalogSelection");
const Publication = require("../models/PackageMarketPublication");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const Decision = require("../models/SupplierCatalogReconciliationDecision");
const Audit = require("../models/AdminAuditLog");
const businessAuthority = require("../services/supplierCatalog/supplierBusinessAuthorityService");
const inputAuthority = require("../services/supplierCatalog/supplierInputContractReviewService");
const { evaluateAddProductOffer } = require("../services/supplierCatalog/addProductPreparabilityService");
const { createSupplierCatalogReconciliationService } = require("../services/supplierCatalog/supplierCatalogReconciliationService");
const { generateAddProductPlan, finalizeAddProduct } = require("../services/supplierCatalog/addProductFinalizationService");
const { loadDailyPricingProductDetail } = require("../services/commerce/adminPricingControlCenterService");

const run = `business-authority-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const now = new Date();
const hash = value => crypto.createHash("sha256").update(`${run}:${value}`).digest("hex");
const actor = { _id: new mongoose.Types.ObjectId(), id: new mongoose.Types.ObjectId(), username: "isolated-business-owner", role: "OWNER" };
const req = { id: run, headers: { "x-request-id": run }, originalUrl: "/isolated-test", method: "POST" };
const createdProductIds = [], createdOfferIds = [], createdCanonicalCodes = [], createdSupplierIds = [];
const result = { marketAuthority: false, inputContractAuthority: false, executionAuthority: false, packageIdentityDecision: false, marketScopedNonMerge: false, preparabilityAfterResolution: false, finalAddProductDailyPricing: false, replayConcurrencyStaleRollback: false, productionWrites: 0, supplierPurchaseCalls: 0 };

async function supplier(code) {
    return Supplier.findOneAndUpdate({ supplierCode: code }, { $setOnInsert: { supplierCode: code, name: `Isolated ${code}`, mode: "API", enabled: true, supportedRegions: ["TH", "MM"], supplierCurrency: "USD" } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}
async function productFixture(supplierDoc, suffix, { market = "UNSPECIFIED", contract = {}, metadata = {} } = {}) {
    const doc = await Product.create({ supplierId: supplierDoc._id, catalogNamespace: "BUSINESS_AUTHORITY_TEST", supplierProductCode: `${run}-${suffix}`, supplierMarketCode: market, displayName: `Business ${suffix}`, supportState: "SUPPORTED", requiredFields: contract.fields || [], normalizedInputContract: contract, restrictions: [], metadata, firstSeenAt: now, lastSeenAt: now, lastObservedAt: now, lastChangedAt: now, sourceRevision: `${suffix}-p1`, rawSnapshotHash: hash(`${suffix}-product`), rawSnapshot: { isolated: true, suffix } });
    createdProductIds.push(doc._id); return doc;
}
async function offerFixture(product, suffix, { state = "NO_CANONICAL_PACKAGE", distinct = true } = {}) {
    const doc = await Offer.create({ supplierCatalogProductId: product._id, supplierId: product.supplierId, catalogNamespace: product.catalogNamespace, supplierProductCode: product.supplierProductCode, supplierOfferCode: `${suffix}-offer`, supplierOfferName: `${suffix} 100 Credits`, supplierCost: { amount: 1, currency: "USD", observedAt: now }, rawSemantics: {}, normalizedSemantics: { denomination: 100, canonicalCode: "100_CREDITS" }, catalogLifecycleState: "ACTIVE", reconciliationState: state, reconciliationEvidence: distinct ? { distinctEntitlement: true } : {}, firstSeenAt: now, lastSeenAt: now, lastObservedAt: now, lastChangedAt: now, sourceRevision: `${suffix}-o1`, rawSnapshotHash: hash(`${suffix}-offer`), rawSnapshot: { isolated: true, suffix }, metadata: {} });
    createdOfferIds.push(doc._id); await Availability.create({ supplierCatalogOfferId: doc._id, state: "AVAILABLE", evidenceCode: "ISOLATED_TEST", observedAt: now, lastAvailableAt: now, coverageComplete: true }); return doc;
}
async function businessReview(product, type, offerId = "") { return businessAuthority.review(String(product._id), { type, offerId: offerId ? String(offerId) : "" }); }
async function approveBusiness(product, review, body) { return businessAuthority.approve(String(product._id), { type: review.authorityType, offerId: review.offer?.id || "", sourceLock: review.sourceLock, confirmed: true, evidenceDescription: "Verified isolated supplier documentation", ...body }, { actor, req }); }
async function forceAuditRollback(operation, verify) {
    const original = Audit.create;
    Audit.create = async () => { throw new Error("forced audit failure"); };
    try { await assert.rejects(operation, /forced audit failure/); } finally { Audit.create = original; }
    await verify();
}
async function cleanup() {
    await Selection.deleteMany({ productCode: { $in: createdCanonicalCodes } });
    await PackageSupplierSelection.deleteMany({ productCode: { $in: createdCanonicalCodes } });
    await Publication.deleteMany({ productCode: { $in: createdCanonicalCodes } });
    await Mapping.deleteMany({ supplierCatalogOfferId: { $in: createdOfferIds } });
    await Decision.deleteMany({ supplierCatalogOfferId: { $in: createdOfferIds } });
    await CatalogPackage.deleteMany({ productCode: { $in: createdCanonicalCodes } });
    await CatalogProduct.deleteMany({ productCode: { $in: createdCanonicalCodes } });
    await Availability.deleteMany({ supplierCatalogOfferId: { $in: createdOfferIds } });
    await Offer.deleteMany({ _id: { $in: createdOfferIds } });
    await Product.deleteMany({ _id: { $in: createdProductIds } });
    await Supplier.deleteMany({ _id: { $in: createdSupplierIds } });
    await Audit.deleteMany({ requestId: run });
}

(async () => {
    mongoose.set("autoIndex", true);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert(hello.setName, "Replica-set MongoDB is required");
    assert(Number(hello.logicalSessionTimeoutMinutes) > 0, "Logical sessions are required");
    console.log(JSON.stringify({ databaseName, replicaSet: hello.setName, logicalSessionTimeoutMinutes: hello.logicalSessionTimeoutMinutes, transactionsCapable: true }));
    await cleanup();
    const fazer = await supplier("FAZERCARDS"), wondd = await supplier("WONDD");
    const autoContract = { authority: "FAZERCARDS_TEST_SCHEMA", noCustomerInput: true, fields: [] };

    // Market authority: persistence, audit, replay, OCC, stale source, rollback, concurrency.
    const marketProduct = await productFixture(fazer, "market", { contract: autoContract });
    const marketOfferA = await offerFixture(marketProduct, "market-a"), marketOfferB = await offerFixture(marketProduct, "market-b");
    const marketReview = await businessReview(marketProduct, "MARKET");
    const marketInput = { nativeMarketEvidence: "TH", allowedCustomerMarkets: ["TH"] };
    const marketCreated = await approveBusiness(marketProduct, marketReview, marketInput);
    assert.strictEqual(marketCreated.authority.decisionVersion, 1);
    assert.deepStrictEqual(marketCreated.authority.fulfillmentEligibility.allowedCustomerMarkets, ["TH"]);
    assert.strictEqual(await Audit.countDocuments({ action: "SUPPLIER_MARKET_AUTHORITY_APPROVED", resourceId: String(marketProduct._id) }), 1);
    const marketReplay = await approveBusiness(marketProduct, marketReview, marketInput); assert.strictEqual(marketReplay.idempotentReplay, true);
    const marketReview2 = await businessReview(marketProduct, "MARKET");
    await assert.rejects(() => businessAuthority.approve(String(marketProduct._id), { type: "MARKET", sourceLock: { ...marketReview2.sourceLock, expectedDecisionVersion: 0 }, confirmed: true, evidenceDescription: "changed evidence", nativeMarketEvidence: "TH", allowedCustomerMarkets: ["TH"] }, { actor, req }), error => error?.code === "AUTHORITY_VERSION_CONFLICT");
    const marketUpdated = await approveBusiness(marketProduct, marketReview2, { nativeMarketEvidence: "TH", allowedCustomerMarkets: ["TH", "MM"] }); assert.strictEqual(marketUpdated.authority.decisionVersion, 2);
    await Product.updateOne({ _id: marketProduct._id }, { $set: { sourceRevision: "market-p2", rawSnapshotHash: hash("market-product-v2") } });
    await assert.rejects(() => approveBusiness(marketProduct, marketReview2, { nativeMarketEvidence: "TH", allowedCustomerMarkets: ["TH", "MM"] }), error => error?.code === "STALE_SOURCE");
    const rollbackMarket = await productFixture(fazer, "market-rollback", { contract: autoContract }), rollbackMarketReview = await businessReview(rollbackMarket, "MARKET");
    await forceAuditRollback(() => approveBusiness(rollbackMarket, rollbackMarketReview, marketInput), async () => assert.strictEqual(Boolean((await Product.findById(rollbackMarket._id).lean()).metadata?.businessAuthority?.marketAuthority), false));
    const concurrentMarket = await productFixture(fazer, "market-concurrent", { contract: autoContract }), concurrentReview = await businessReview(concurrentMarket, "MARKET");
    const concurrent = await Promise.allSettled([approveBusiness(concurrentMarket, concurrentReview, marketInput), approveBusiness(concurrentMarket, concurrentReview, marketInput)]);
    assert(concurrent.some(item => item.status === "fulfilled"));
    const converged = await approveBusiness(concurrentMarket, concurrentReview, marketInput); assert.strictEqual(converged.idempotentReplay, true);
    const differentMarket = await productFixture(fazer, "market-concurrent-different", { contract: autoContract }), differentReview = await businessReview(differentMarket, "MARKET");
    const differentConcurrent = await Promise.allSettled([approveBusiness(differentMarket, differentReview, marketInput), approveBusiness(differentMarket, differentReview, { nativeMarketEvidence: "MM", allowedCustomerMarkets: ["MM"] })]);
    assert.strictEqual(differentConcurrent.filter(item => item.status === "fulfilled").length, 1); assert.strictEqual(differentConcurrent.filter(item => item.status === "rejected" && item.reason?.code === "AUTHORITY_VERSION_CONFLICT").length, 1);
    result.marketAuthority = true;

    // Input contract authority: real service, inheritance, exact override, replay, version/stale/rollback.
    const inputProduct = await productFixture(fazer, "input", { market: "TH", metadata: { fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "isolated", verifiedAt: now, version: 1 } } });
    const inputOfferA = await offerFixture(inputProduct, "input-a"), inputOfferB = await offerFixture(inputProduct, "input-b");
    const fields = [{ label: "Player ID", customerField: "playerId", providerField: "player_id", type: "numeric-text", required: true, transformationId: "DIRECT", constraints: {}, options: [] }];
    const inputReview = await inputAuthority.context(String(inputProduct._id));
    const inputBody = { sourceLock: inputReview.sourceLock, fields, noCustomerInput: false, evidenceReference: "isolated provider documentation", evidenceExcerpt: "The required destination is player_id.", confirmed: true };
    const inputCreated = await inputAuthority.approve(String(inputProduct._id), inputBody, { actor, req });
    assert(inputCreated.contract.fingerprint && inputCreated.contract.review.evidenceReference);
    assert.strictEqual((await inputAuthority.context(String(inputProduct._id), String(inputOfferA._id))).product.normalizedInputContract.fingerprint, inputCreated.contract.fingerprint);
    assert.strictEqual((await inputAuthority.context(String(inputProduct._id), String(inputOfferB._id))).product.normalizedInputContract.fingerprint, inputCreated.contract.fingerprint);
    const inputReplayReview = await inputAuthority.context(String(inputProduct._id));
    const inputReplay = await inputAuthority.approve(String(inputProduct._id), { ...inputBody, sourceLock: inputReplayReview.sourceLock }, { actor, req }); assert.strictEqual(inputReplay.idempotentReplay, true);
    await assert.rejects(() => inputAuthority.approve(String(inputProduct._id), { ...inputBody, sourceLock: { ...inputReplayReview.sourceLock, expectedDecisionVersion: 0 }, evidenceReference: "different authoritative source" }, { actor, req }), error => error?.code === "INPUT_CONTRACT_VERSION_CONFLICT");
    const overrideReview = await inputAuthority.context(String(inputProduct._id), String(inputOfferA._id));
    const override = await inputAuthority.approve(String(inputProduct._id), { ...inputBody, offerId: String(inputOfferA._id), sourceLock: overrideReview.sourceLock, evidenceReference: "isolated exact offer documentation" }, { actor, req });
    assert(override.contract.fingerprint); assert((await Offer.findById(inputOfferA._id).lean()).metadata?.normalizedInputContract); assert.strictEqual(Boolean((await Offer.findById(inputOfferB._id).lean()).metadata?.normalizedInputContract), false);
    const staleInputProduct = await productFixture(fazer, "input-stale", { market: "TH" }), staleInputReview = await inputAuthority.context(String(staleInputProduct._id));
    await Product.updateOne({ _id: staleInputProduct._id }, { $set: { sourceRevision: "input-stale-p2", rawSnapshotHash: hash("input-stale-v2") } });
    await assert.rejects(() => inputAuthority.approve(String(staleInputProduct._id), { ...inputBody, sourceLock: staleInputReview.sourceLock }, { actor, req }), error => error?.code === "INPUT_CONTRACT_SOURCE_STALE");
    const rollbackInput = await productFixture(fazer, "input-rollback", { market: "TH" }), rollbackInputReview = await inputAuthority.context(String(rollbackInput._id));
    await forceAuditRollback(() => inputAuthority.approve(String(rollbackInput._id), { ...inputBody, sourceLock: rollbackInputReview.sourceLock }, { actor, req }), async () => assert.strictEqual(Boolean((await Product.findById(rollbackInput._id).lean()).normalizedInputContract?.fingerprint), false));
    result.inputContractAuthority = true;

    // Execution authority: protocol identity, product inheritance, exact override, serviceid separation, replay/stale/rollback/concurrency.
    const ownerContract = { authority: "OWNER_REVIEWED_PROVIDER_EVIDENCE", review: { status: "OWNER_REVIEWED" }, noCustomerInput: true, fields: [] };
    const executionProduct = await productFixture(wondd, "execution", { market: "TH", contract: ownerContract, metadata: { catalogServiceId: "9624", fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "isolated", verifiedAt: now, version: 1 } } });
    const executionOfferA = await offerFixture(executionProduct, "execution-a"), executionOfferB = await offerFixture(executionProduct, "execution-b");
    const executionReview = await businessReview(executionProduct, "EXECUTION"), executionInput = { executionIdentity: { servicecode: "HEARTOPIA_TOPUP" } };
    const executionCreated = await approveBusiness(executionProduct, executionReview, executionInput);
    assert.strictEqual(executionCreated.authority.protocol, "WONDD_GAME_ID_TOPUP"); assert.strictEqual(executionCreated.authority.executionIdentity.servicecode, "HEARTOPIA_TOPUP"); assert.notStrictEqual(executionCreated.authority.executionIdentity.servicecode, "9624");
    assert.strictEqual(businessAuthority.resolvedAuthorities(await Product.findById(executionProduct._id).lean(), await Offer.findById(executionOfferA._id).lean()).execution.executionIdentity.servicecode, "HEARTOPIA_TOPUP");
    const executionOverrideReview = await businessReview(executionProduct, "EXECUTION", executionOfferA._id), executionOverride = await approveBusiness(executionProduct, executionOverrideReview, { executionIdentity: { servicecode: "HEARTOPIA_SPECIAL" } });
    assert.strictEqual(executionOverride.authority.scope, "OFFER"); assert.strictEqual(executionOverride.authority.decisionVersion, 1); assert.strictEqual((await Product.findById(executionProduct._id).lean()).metadata.businessAuthority.executionAuthority.decisionVersion, 1); assert.strictEqual(businessAuthority.resolvedAuthorities(await Product.findById(executionProduct._id).lean(), await Offer.findById(executionOfferB._id).lean()).execution.executionIdentity.servicecode, "HEARTOPIA_TOPUP");
    const executionReplay = await approveBusiness(executionProduct, executionReview, executionInput); assert.strictEqual(executionReplay.idempotentReplay, true);
    const staleExecution = await productFixture(wondd, "execution-stale", { market: "TH", contract: ownerContract }), staleExecutionReview = await businessReview(staleExecution, "EXECUTION");
    await Product.updateOne({ _id: staleExecution._id }, { $set: { sourceRevision: "execution-stale-p2", rawSnapshotHash: hash("execution-stale-v2") } });
    await assert.rejects(() => approveBusiness(staleExecution, staleExecutionReview, executionInput), error => error?.code === "STALE_SOURCE");
    const concurrentExecution = await productFixture(wondd, "execution-concurrent", { market: "TH", contract: ownerContract }), concurrentExecutionReview = await businessReview(concurrentExecution, "EXECUTION");
    const executionConcurrentResults = await Promise.allSettled([approveBusiness(concurrentExecution, concurrentExecutionReview, executionInput), approveBusiness(concurrentExecution, concurrentExecutionReview, executionInput)]); assert(executionConcurrentResults.some(item => item.status === "fulfilled")); assert.strictEqual((await approveBusiness(concurrentExecution, concurrentExecutionReview, executionInput)).idempotentReplay, true);
    const rollbackExecution = await productFixture(wondd, "execution-rollback", { market: "TH", contract: ownerContract }), rollbackExecutionReview = await businessReview(rollbackExecution, "EXECUTION");
    await forceAuditRollback(() => approveBusiness(rollbackExecution, rollbackExecutionReview, executionInput), async () => assert.strictEqual(Boolean((await Product.findById(rollbackExecution._id).lean()).metadata?.businessAuthority?.executionAuthority), false));
    result.executionAuthority = true;

    // Package identity decisions: existing reconciliation service, link/create, replay, stale, audit rollback.
    const reconciliation = createSupplierCatalogReconciliationService({ mutationsEnabled: () => true });
    const packageProduct = await productFixture(fazer, "package", { market: "TH", contract: autoContract }), createOffer = await offerFixture(packageProduct, "package-create", { distinct: false }), linkOffer = await offerFixture(packageProduct, "package-link", { distinct: false });
    const canonicalCode = `${run}-canonical`.toLowerCase(); createdCanonicalCodes.push(canonicalCode); await CatalogProduct.create({ productCode: canonicalCode, name: "Isolated Canonical", enabled: false, commerceState: "HIDDEN", publicDiscoveryEnabled: false, homepageEnabled: false, supportedRegions: [], source: "admin", metadata: { sellableMarketScope: ["TH"] } });
    const createContext = await reconciliation.reviewContext(String(createOffer._id));
    const createDecisionInput = { supplierCatalogOfferId: String(createOffer._id), decisionType: "CREATE_CANONICAL_PACKAGE_AND_LINK", confirmed: true, canonicalProductCode: canonicalCode, canonicalPackageName: "100 Credits Separate", region: "TH", reasonCode: "ISOLATED_TEST", reviewNotes: run, expectedSource: createContext.source.identity, requestIdempotencyKey: `${run}:create` };
    const createDecision = await reconciliation.decide(createDecisionInput, { actor, requestId: run }); assert(createDecision.mapping && createDecision.canonicalPackage); const createReplay = await reconciliation.decide(createDecisionInput, { actor, requestId: run }); assert.strictEqual(createReplay.idempotentReplay, true);
    const existingPackage = await CatalogPackage.create({ productCode: canonicalCode, packageCode: `${hash("existing-package").slice(0, 16).toUpperCase()}`, name: "Existing Exact Entitlement", enabled: false, metadata: { sellableMarketScope: ["TH"] } });
    const linkContext = await reconciliation.reviewContext(String(linkOffer._id));
    const linked = await reconciliation.decide({ supplierCatalogOfferId: String(linkOffer._id), decisionType: "LINK_TO_EXISTING_CANONICAL_PACKAGE", confirmed: true, canonicalPackageId: String(existingPackage._id), region: "TH", reasonCode: "ISOLATED_TEST", reviewNotes: run, expectedSource: linkContext.source.identity, requestIdempotencyKey: `${run}:link` }, { actor, requestId: run }); assert(linked.mapping);
    const stalePackageProduct = await productFixture(fazer, "package-stale", { market: "TH", contract: autoContract }), stalePackageOffer = await offerFixture(stalePackageProduct, "package-stale", { distinct: false }), stalePackageContext = await reconciliation.reviewContext(String(stalePackageOffer._id));
    await Offer.updateOne({ _id: stalePackageOffer._id }, { $set: { sourceRevision: "package-stale-o2", rawSnapshotHash: hash("package-stale-v2"), lastChangedAt: new Date(now.getTime() + 1000) } });
    await assert.rejects(() => reconciliation.decide({ supplierCatalogOfferId: String(stalePackageOffer._id), decisionType: "LINK_TO_EXISTING_CANONICAL_PACKAGE", confirmed: true, canonicalPackageId: String(existingPackage._id), region: "TH", expectedSource: stalePackageContext.source.identity, requestIdempotencyKey: `${run}:stale-link` }, { actor, requestId: run }), error => error?.code === "STALE_SOURCE_REVISION");
    const rollbackPackageProduct = await productFixture(fazer, "package-rollback", { market: "TH", contract: autoContract }), rollbackPackageOffer = await offerFixture(rollbackPackageProduct, "package-rollback", { distinct: false }), rollbackPackageContext = await reconciliation.reviewContext(String(rollbackPackageOffer._id));
    await forceAuditRollback(() => reconciliation.decide({ supplierCatalogOfferId: String(rollbackPackageOffer._id), decisionType: "CREATE_CANONICAL_PACKAGE_AND_LINK", confirmed: true, canonicalProductCode: canonicalCode, canonicalPackageName: "Rollback Package", region: "TH", expectedSource: rollbackPackageContext.source.identity, requestIdempotencyKey: `${run}:rollback-package` }, { actor, requestId: run }), async () => { assert.strictEqual(await Mapping.countDocuments({ supplierCatalogOfferId: rollbackPackageOffer._id }), 0); assert.strictEqual(await Decision.countDocuments({ supplierCatalogOfferId: rollbackPackageOffer._id }), 0); });
    result.packageIdentityDecision = true;

    // Market-scoped safety uses actual plan evaluator and explicit canonical scope.
    const thPlanProduct = await productFixture(fazer, "market-scope-th", { market: "TH", contract: autoContract, metadata: { fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "isolated", verifiedAt: now, version: 1 } } }), thPlanOffer = await offerFixture(thPlanProduct, "market-scope-th");
    await Product.updateOne({ _id: thPlanProduct._id }, { $set: { "metadata.onboardingCanonicalProduct": { authoritative: true, productCode: canonicalCode, supplierCatalogProductId: String(thPlanProduct._id), sourceHash: thPlanProduct.rawSnapshotHash, marketScope: ["TH"] } } });
    const thPlan = await generateAddProductPlan({ supplierCatalogProductId: thPlanProduct._id, productCode: canonicalCode, sellingRegions: ["TH"] }); assert(thPlan.offers.some(row => row.primaryBlocker !== "MARKET_SCOPED_CANONICAL_CONFLICT"));
    const idPlanProduct = await productFixture(fazer, "market-scope-id", { market: "ID", contract: autoContract }), idPlanOffer = await offerFixture(idPlanProduct, "market-scope-id");
    await Product.updateOne({ _id: idPlanProduct._id }, { $set: { "metadata.onboardingCanonicalProduct": { authoritative: true, productCode: canonicalCode, supplierCatalogProductId: String(idPlanProduct._id), sourceHash: idPlanProduct.rawSnapshotHash, marketScope: ["ID"] } } });
    const idPlan = await generateAddProductPlan({ supplierCatalogProductId: idPlanProduct._id, productCode: canonicalCode, sellingRegions: ["TH"] }); assert(idPlan.offers.every(row => !row.selectable && (row.primaryBlocker === "MARKET_SCOPED_CANONICAL_CONFLICT" || row.blockers.includes("CUSTOMER_MARKET_INELIGIBLE"))));
    const unspecifiedProduct = await productFixture(fazer, "market-scope-unspecified", { contract: autoContract }), unspecifiedOffer = await offerFixture(unspecifiedProduct, "market-scope-unspecified");
    const unspecifiedAssessment = evaluateAddProductOffer({ supplier: fazer, product: unspecifiedProduct.toObject(), offer: unspecifiedOffer.toObject(), availability: { state: "AVAILABLE" }, customerMarkets: ["TH"], newCanonicalProduct: true }); assert(unspecifiedAssessment.blockers.includes("SUPPLIER_MARKET_AUTHORITY_REQUIRED"));
    const compatibleSupplier = await Supplier.create({ supplierCode: `T${hash("compatible-supplier").slice(0, 10).toUpperCase()}`, name: "Isolated Compatible TH Supplier", mode: "API", enabled: true, supportedRegions: ["TH"], supplierCurrency: "USD" });
    createdSupplierIds.push(compatibleSupplier._id);
    const compatibleProduct = await productFixture(compatibleSupplier, "compatible-th", { market: "TH", contract: autoContract }), compatibleOffer = await offerFixture(compatibleProduct, "compatible-th", { distinct: false }), compatibleContext = await reconciliation.reviewContext(String(compatibleOffer._id));
    const compatibleLink = await reconciliation.decide({ supplierCatalogOfferId: String(compatibleOffer._id), decisionType: "LINK_TO_EXISTING_CANONICAL_PACKAGE", confirmed: true, canonicalPackageId: String(existingPackage._id), region: "TH", reasonCode: "ISOLATED_COMPATIBLE_TH", reviewNotes: run, expectedSource: compatibleContext.source.identity, requestIdempotencyKey: `${run}:compatible-th` }, { actor, requestId: run });
    assert.strictEqual(compatibleLink.mapping.packageCode, linked.mapping.packageCode); assert.notStrictEqual(String(compatibleLink.mapping.supplierId), String(linked.mapping.supplierId));
    result.marketScopedNonMerge = true;

    // Actual preparability re-evaluation after each real authority write.
    const freshMarketProduct = await Product.findById(concurrentMarket._id).lean(), freshMarketOffer = await offerFixture(freshMarketProduct, "market-ready");
    const marketReady = evaluateAddProductOffer({ supplier: fazer, product: freshMarketProduct, offer: freshMarketOffer.toObject(), availability: { state: "AVAILABLE" }, customerMarkets: ["TH"], newCanonicalProduct: true }); assert.strictEqual(marketReady.state, "PREPARABLE");
    const freshInputProduct = await Product.findById(inputProduct._id).lean(), inputReady = evaluateAddProductOffer({ supplier: fazer, product: freshInputProduct, offer: (await Offer.findById(inputOfferB._id).lean()), availability: { state: "AVAILABLE" }, customerMarkets: ["TH"], newCanonicalProduct: true }); assert.strictEqual(inputReady.state, "PREPARABLE");
    const freshExecutionProduct = await Product.findById(executionProduct._id).lean(), executionReady = evaluateAddProductOffer({ supplier: wondd, product: freshExecutionProduct, offer: (await Offer.findById(executionOfferB._id).lean()), availability: { state: "AVAILABLE" }, customerMarkets: ["TH"], newCanonicalProduct: true }); assert.strictEqual(executionReady.state, "PREPARABLE");
    result.preparabilityAfterResolution = true;

    // Final business flow using actual plan/finalization and Daily Pricing discovery.
    process.env.SUPPLIER_PRODUCT_ONBOARDING_MUTATIONS_ENABLED = "true";
    const finalProduct = await productFixture(fazer, "final", { market: "TH", contract: autoContract, metadata: { fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "isolated", verifiedAt: now, version: 1 } } });
    await offerFixture(finalProduct, "final-a"); await offerFixture(finalProduct, "final-b");
    const finalPlan = await generateAddProductPlan({ supplierCatalogProductId: finalProduct._id, sellingRegions: ["TH"] }); assert(finalPlan.offers.every(row => row.state === "PREPARABLE")); createdCanonicalCodes.push(finalPlan.productCode);
    const finalized = await finalizeAddProduct({ supplierCatalogProductId: String(finalProduct._id), productCode: finalPlan.productCode, customerMarkets: finalPlan.customerMarkets, selectedOfferIds: [finalPlan.offers[0].supplierCatalogOfferId], expectedDecisionVersion: finalPlan.expectedDecisionVersion, planHash: finalPlan.planHash }, { actor, requestId: run });
    assert.strictEqual(finalized.packageCount, 1); assert.strictEqual(await Selection.countDocuments({ productCode: finalPlan.productCode }), 1);
    const daily = await loadDailyPricingProductDetail({ supplierId: String(fazer._id), productCode: finalPlan.productCode }); assert.strictEqual(daily.rows.length, 1);
    assert.strictEqual(await Publication.countDocuments({ productCode: finalPlan.productCode }), 0); assert.strictEqual(await PackageSupplierSelection.countDocuments({ productCode: finalPlan.productCode }), 0); assert.strictEqual(await Mapping.countDocuments({ productCode: finalPlan.productCode, productionRole: "PRIMARY" }), 0);
    result.finalAddProductDailyPricing = true; result.replayConcurrencyStaleRollback = true;

    console.log(JSON.stringify({ result: "PASS", databaseName, replicaSet: hello.setName, logicalSessions: true, ...result }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { try { if (mongoose.connection.readyState) await cleanup(); } finally { await mongoose.disconnect().catch(() => null); } });
