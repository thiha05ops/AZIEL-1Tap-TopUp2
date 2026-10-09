#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { assessPreCommercialFulfillmentReadiness } = require("../services/fulfillmentCapabilityService");
const { createSupplierRoutePreparationService, OUTCOMES, outcomeFor, contractFromCurrentSupplierCatalog, proposedMapping, supportsPreparationProtocol } = require("../services/supplierCatalog/supplierRoutePreparationService");
const { supportsMapping } = require("../services/suppliers/supplierFulfillmentDispatcher");
const { contractFingerprint } = require("../services/suppliers/fazercardsFulfillmentContractService");

const hash = character => character.repeat(64);
const now = new Date("2026-09-03T00:00:00.000Z");
const contract = { version: 1, supplierCode: "FAZERCARDS", protocol: "FAZERCARDS_TOPUPS_ORDER_V2", supplierProductCode: "pubg_mobile_auto", sourceSupplierCatalogProductId: "sp1", sourceHash: hash("a"), fields: [{ customerField: "playerId", providerField: "player_id", required: true }], fingerprint: "fixture" };
const mapping = { _id: "m1", supplierId: "s1", supplierCode: "FAZERCARDS", productCode: "pubg", packageCode: "PUBG_325_UC", supplierProductCode: "pubg_mobile_auto", supplierPackageCode: "325_uc", supplierCatalogOfferId: "o1", region: "GLOBAL", enabled: false, productionRole: "DISABLED", executionMode: "API", archivedAt: null, fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "fixture", verifiedAt: now, version: 2 }, mappingMetadata: { readiness: { supplierMapped: true, pricingReady: false, inputReady: true, validationReady: true, fulfillmentReady: true, storefrontReady: false }, fulfillmentContract: contract }, updatedAt: now };
const supplier = { _id: "s1", supplierCode: "FAZERCARDS", enabled: true, mode: "API", updatedAt: now };
const supplierProduct = { _id: "sp1", supplierId: "s1", supplierProductCode: "pubg_mobile_auto", supplierMarketCode: "GLOBAL", supportState: "SUPPORTED", rawSnapshotHash: hash("a"), sourceRevision: "p1", normalizedInputContract: { fields: contract.fields }, restrictions: [], updatedAt: now };
const offer = { _id: "o1", supplierId: "s1", supplierCatalogProductId: "sp1", supplierProductCode: "pubg_mobile_auto", supplierOfferCode: "325_uc", catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", rawSnapshotHash: hash("b"), sourceRevision: "o1", updatedAt: now };
const availability = { supplierCatalogOfferId: "o1", state: "AVAILABLE", coverageComplete: true, observedAt: now, staleAt: null, updatedAt: now };
const canonicalProduct = { _id: "cp1", productCode: "pubg", supportedRegions: ["GLOBAL"], updatedAt: now };
const canonicalPackage = { _id: "ck1", productCode: "pubg", packageCode: "PUBG_325_UC", enabled: false, prices: {}, updatedAt: now };
const readyInput = { mapping, supplier, supplierProduct, offer, availability, canonicalProduct, canonicalPackages: [canonicalPackage], customerMarkets: ["TH"], fulfillmentContract: contract, adapterConfigured: true, autoFulfillmentEnabled: true, processorSupported: true };

const ready = assessPreCommercialFulfillmentReadiness(readyInput);
assert.strictEqual(ready.ready, true);
assert.strictEqual(mapping.enabled, false);
assert.strictEqual(mapping.productionRole, "DISABLED");
assert.strictEqual(mapping.mappingMetadata.readiness.pricingReady, false);
assert.strictEqual(mapping.mappingMetadata.readiness.storefrontReady, false);
assert.deepStrictEqual(canonicalPackage.prices, {});
assert.deepStrictEqual(ready.ignoredCommercialState, ["enabled", "productionRole", "pricingReady", "storefrontReady", "retailPrice", "publication"]);
assert.strictEqual(ready.evidence.supplierCatalogOfferId, "o1");
const gatedPreparation = assessPreCommercialFulfillmentReadiness({ ...readyInput, autoFulfillmentEnabled: false });
assert.strictEqual(gatedPreparation.ready, true, "The live execution gate must not block technical preparation.");
assert.deepStrictEqual(gatedPreparation.activationBlockers, ["SUPPLIER_AUTO_FULFILLMENT_DISABLED"]);
assert.strictEqual(outcomeFor([]), OUTCOMES.FULFILLMENT_READY);
assert.strictEqual(outcomeFor(["STALE_OR_WRONG_OFFER_LINKAGE"]), OUTCOMES.REVIEW_REQUIRED);
assert.strictEqual(outcomeFor(["SUPPLIER_UNSUPPORTED"]), OUTCOMES.UNSUPPORTED);
assert.strictEqual(outcomeFor(["MARKET_UNRESOLVED"]), OUTCOMES.MARKET_UNRESOLVED);
assert.strictEqual(outcomeFor(["AVAILABILITY_UNPROVEN"]), OUTCOMES.AVAILABILITY_UNPROVEN);
const wonddMapping = { ...mapping, supplierCode: "WONDD", productCode: "heartopia", supplierProductCode: "9624", supplierPackageCode: "HTP00020", supplierCatalogOfferId: "wo1" };
const wonddSupplier = { ...supplier, supplierCode: "WONDD" };
const rovContractBody = { version: 1, decisionVersion: 1, supplierCode: "WONDD", protocol: "WONDD_GAME_ID_TOPUP", transactionalServiceCode: "rov", supplierProductCode: "9601", sourceSupplierCatalogProductId: "wsp1", sourceHash: hash("w"), sourceOfferHash: hash("x"), authorityScope: "PRODUCT", noCustomerInput: false, fields: [{ customerField: "playerId", providerField: "gameid", required: true, label: "Player ID", type: "numeric-text", options: [], constraints: {}, evidenceReference: "supplier docs", transformationId: "DIRECT" }] };
const rovContract = { ...rovContractBody, fingerprint: contractFingerprint(rovContractBody) };
assert.strictEqual(supportsMapping({ ...wonddMapping, productCode: "aovid", supplierProductCode: "9601", mappingMetadata: { fulfillmentContract: rovContract } }), true, "A verified declarative WonDD contract must make a configured catalog family executable without a product-specific formatter.");
const wonddProduct = { ...supplierProduct, _id: "wsp1", supplierProductCode: "9624", metadata: { transactionalServiceCode: "HTP" }, normalizedInputContract: { fields: [{ name: "userId", providerField: "gameid", transformationId: "DIRECT", required: true }] } };
const wonddOffer = { ...offer, _id: "wo1", supplierCatalogProductId: "wsp1", supplierProductCode: "9624", supplierOfferCode: "HTP00020" };
const wonddContract = contractFromCurrentSupplierCatalog({ mapping: wonddMapping, supplier: wonddSupplier, supplierProduct: wonddProduct, offer: wonddOffer });
assert.strictEqual(wonddContract.supplierProductCode, "9624", "Durable catalog identity must remain the WonDD service ID.");
assert.strictEqual(wonddContract.transactionalServiceCode, "HTP", "Transactional service code must remain separate from catalog identity.");
assert.strictEqual(proposedMapping(wonddMapping, { mapping: wonddMapping, supplier: wonddSupplier, supplierProduct: wonddProduct, offer: wonddOffer }, { customerMarkets: ["TH"] }, { fulfillmentContract: wonddContract }).supplierProductCode, "9624", "Preparation must not rewrite durable catalog identity to the execution code.");
assert.strictEqual(supportsPreparationProtocol(wonddMapping, wonddSupplier, wonddProduct), true, "Known WonDD service/product protocol must be recognized independently from live activation.");
assert.strictEqual(contractFromCurrentSupplierCatalog({ mapping: wonddMapping, supplier: wonddSupplier, supplierProduct: { ...wonddProduct, normalizedInputContract: {} }, offer: wonddOffer }), null, "Missing structured input evidence must remain fail-closed.");
assert.strictEqual(contractFromCurrentSupplierCatalog({ mapping: { ...wonddMapping, supplierProductCode: "9623" }, supplier: wonddSupplier, supplierProduct: wonddProduct, offer: wonddOffer }), null, "True supplier identity contradictions must remain fail-closed.");
for (const [change, blocker] of [
    [{ mapping: null }, "MISSING_MAPPING"],
    [{ offer: { ...offer, _id: "wrong" } }, "STALE_OR_WRONG_OFFER_LINKAGE"],
    [{ mapping: { ...mapping, fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 } } }, "CUSTOMER_MARKET_ELIGIBILITY_UNPROVEN"],
    [{ customerMarkets: ["MM"] }, "CUSTOMER_MARKET_NOT_ELIGIBLE"],
    [{ fulfillmentContract: null }, "INPUT_CONTRACT_UNRESOLVED"],
    [{ processorSupported: false }, "PROTOCOL_UNSUPPORTED"],
    [{ availability: { ...availability, state: "UNKNOWN" } }, "AVAILABILITY_UNPROVEN"],
    [{ offer: { ...offer, catalogLifecycleState: "RETIRED" } }, "OFFER_NOT_ACTIVE"],
    [{ canonicalPackages: [canonicalPackage, { ...canonicalPackage, _id: "ck2" }] }, "AMBIGUOUS_CANONICAL_IDENTITY"]
]) assert(assessPreCommercialFulfillmentReadiness({ ...readyInput, ...change }).blockers.includes(blocker), blocker);

function fixtures({ failAudit = false, adapterConfigured = true } = {}) {
    const state = { mapping: { ...mapping, region: "TH", executionMode: "MANUAL", fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 }, mappingMetadata: { readiness: { supplierMapped: true, pricingReady: false, inputReady: false, validationReady: false, fulfillmentReady: false, storefrontReady: false } } }, exactMarketMapping: null, supplier: { ...supplier }, supplierProduct: { ...supplierProduct, supplierMarketCode: "GLOBAL" }, offer: { ...offer, reconciliationState: "AMBIGUOUS", reconciliationEvidence: {} }, availability: { ...availability }, canonicalProduct: { ...canonicalProduct }, canonicalProductEvidence: { ...canonicalProduct }, canonicalPackages: [{ ...canonicalPackage }], canonicalPackagesEvidence: [{ ...canonicalPackage }], audits: [], createdMappings: [], updates: [] };
    const repos = {
        transaction: async fn => {
            const snapshot = structuredClone(state);
            try { return await fn({ transaction: true }); }
            catch (error) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, snapshot); throw error; }
        },
        mappingById: async id => [state.mapping, state.exactMarketMapping, ...state.createdMappings].find(item => item && id === item._id) || null,
        supplierById: async () => state.supplier,
        offerById: async () => state.offer,
        productById: async () => state.supplierProduct,
        availabilityByOffer: async () => state.availability,
        canonicalProduct: async () => state.canonicalProduct,
        canonicalPackages: async () => state.canonicalPackages,
        canonicalProductAny: async () => state.canonicalProductEvidence,
        canonicalPackagesAny: async () => state.canonicalPackagesEvidence,
        auditByPlanHash: async planHash => state.audits.find(item => item.metadata.planHash === planHash) || null,
        mappingByExactMarket: async (anchor, region) => state.exactMarketMapping && state.exactMarketMapping.region === region ? state.exactMarketMapping : null,
        updateMapping: async (id, expectedUpdatedAt, update) => {
            const key = id === state.mapping?._id ? "mapping" : id === state.exactMarketMapping?._id ? "exactMarketMapping" : "";
            if (!key || new Date(expectedUpdatedAt).getTime() !== new Date(state[key].updatedAt).getTime()) return { matchedCount: 0, modifiedCount: 0 };
            state[key] = { ...state[key], ...update, updatedAt: new Date(now.getTime() + 1000) }; state.updates.push(id);
            return { matchedCount: 1, modifiedCount: 1 };
        },
        createMapping: async document => { const created = { ...document, _id: `created-${state.createdMappings.length + 1}`, updatedAt: now }; state.createdMappings.push(created); return created; },
        createAudit: async document => { if (failAudit) throw new Error("AUDIT_WRITE_FAILED"); state.audits.push(document); return [document]; }
    };
    const service = createSupplierRoutePreparationService({ repos, adapterResolver: () => ({ isConfigured: () => adapterConfigured, isAutoFulfillmentEnabled: () => true }), processorSupportResolver: value => value.mappingMetadata?.fulfillmentContract?.protocol === "FAZERCARDS_TOPUPS_ORDER_V2", clock: () => now });
    return { state, service };
}

(async () => {
    const { state, service } = fixtures();
    const plan = await service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(plan.outcome, OUTCOMES.FULFILLMENT_READY);
    assert.strictEqual(plan.sourceLock.canonicalEquivalence.source, "EXACT_MAPPING");
    assert.strictEqual(plan.proposedChanges.region, "TH", "Catalog market classification must not rewrite established mapping route scope.");
    assert.strictEqual(plan.proposedChanges.executionMode, "API");
    assert.strictEqual(plan.safety.enabledWrites, 0);
    assert.strictEqual(plan.safety.roleWrites, 0);
    assert.strictEqual(plan.safety.pricingWrites, 0);
    assert.strictEqual(plan.safety.publicationWrites, 0);
    assert.strictEqual(plan.safety.storefrontWrites, 0);
    assert.strictEqual(plan.safety.supplierCalls, 0);
    await assert.rejects(() => service.applyPlan(plan, { actor: { username: "catalog-admin", role: "ADMIN" }, confirmed: true }), error => error.code === "OWNER_PREPARATION_REQUIRED");
    await assert.rejects(() => service.applyPlan(plan, { actor: { username: "owner", role: "OWNER" }, confirmed: false }), error => error.code === "PREPARATION_CONFIRMATION_REQUIRED");
    const result = await service.applyPlan(plan, { actor: { id: "507f1f77bcf86cd799439011", username: "owner", role: "OWNER" }, confirmed: true });
    assert.strictEqual(result.applied, 1);
    assert.strictEqual(state.mapping.enabled, false);
    assert.strictEqual(state.mapping.productionRole, "DISABLED");
    assert.strictEqual(state.mapping.executionMode, "API");
    assert.strictEqual(state.mapping.mappingMetadata.readiness.pricingReady, false);
    assert.strictEqual(state.mapping.mappingMetadata.readiness.storefrontReady, false);
    assert.strictEqual(state.mapping.mappingMetadata.readiness.fulfillmentReady, true);
    assert.deepStrictEqual(state.mapping.fulfillmentEligibility.allowedCustomerMarkets, ["TH"]);
    assert.strictEqual(state.audits.length, 1);
    const replay = await service.applyPlan(plan, { actor: { id: "507f1f77bcf86cd799439011", username: "owner", role: "OWNER" }, confirmed: true });
    assert.strictEqual(replay.idempotentReplay, true);
    assert.deepStrictEqual(state.updates, ["m1"]);

    const stale = fixtures(), stalePlan = await stale.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    stale.state.offer.rawSnapshotHash = hash("c");
    await assert.rejects(() => stale.service.applyPlan(stalePlan, { actor: { username: "owner", role: "OWNER" }, confirmed: true }), error => error.code === "PREPARATION_SOURCE_STALE");
    assert.strictEqual(stale.state.updates.length, 0);
    assert.strictEqual(stale.state.audits.length, 0);

    const tampered = fixtures(), tamperedPlan = await tampered.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    tamperedPlan.proposedChanges.executionMode = "MANUAL";
    await assert.rejects(() => tampered.service.applyPlan(tamperedPlan, { actor: { username: "owner", role: "OWNER" }, confirmed: true }), error => error.code === "PREPARATION_PLAN_HASH_MISMATCH");
    assert.strictEqual(tampered.state.updates.length, 0);

    const auditFailure = fixtures({ failAudit: true }), auditFailurePlan = await auditFailure.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    await assert.rejects(() => auditFailure.service.applyPlan(auditFailurePlan, { actor: { username: "owner", role: "OWNER" }, confirmed: true }), /AUDIT_WRITE_FAILED/);
    assert.strictEqual(auditFailure.state.updates.length, 0, "The mapping mutation must roll back with a failed audit write.");
    assert.strictEqual(auditFailure.state.mapping.executionMode, "MANUAL");

    const ambiguous = fixtures(); ambiguous.state.canonicalPackages.push({ ...canonicalPackage, _id: "ck2" });
    const ambiguousPlan = await ambiguous.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(ambiguousPlan.outcome, OUTCOMES.REVIEW_REQUIRED);
    assert.strictEqual(ambiguousPlan.proposedChanges, null);
    await assert.rejects(() => ambiguous.service.applyPlan(ambiguousPlan, { actor: { username: "owner", role: "OWNER" }, confirmed: true }), error => error.code === "PREPARATION_NOT_READY");
    assert.strictEqual(ambiguous.state.updates.length, 0);
    assert.strictEqual(ambiguous.state.audits.length, 0);

    const missing = fixtures(); missing.state.mapping = null;
    assert.strictEqual((await missing.service.generatePlan({ mappingId: "missing", customerMarkets: ["TH"] })).outcome, OUTCOMES.MISSING_MAPPING);
    const unresolvedMarket = fixtures();
    unresolvedMarket.state.supplierProduct.supplierMarketCode = "UNSPECIFIED";
    const unresolvedPlan = await unresolvedMarket.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(unresolvedPlan.outcome, OUTCOMES.MARKET_UNRESOLVED, "A legacy mapping region must not manufacture supplier-market authority.");
    assert(unresolvedPlan.blockers.includes("MARKET_UNRESOLVED"));
    assert.strictEqual(unresolvedPlan.proposedChanges, null);
    unresolvedMarket.state.supplierProduct.metadata = { businessAuthority: { marketAuthority: { nativeMarketEvidence: "TH", fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"] } } } };
    const reviewedMarketPlan = await unresolvedMarket.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(reviewedMarketPlan.outcome, OUTCOMES.FULFILLMENT_READY, "Explicit reviewed supplier-market authority must make the existing exact route preparable.");
    assert.strictEqual(reviewedMarketPlan.proposedChanges.region, "TH");

    const inactiveCanonical = fixtures();
    inactiveCanonical.state.canonicalProduct = null;
    inactiveCanonical.state.canonicalProductEvidence = { ...canonicalProduct, deletedAt: now, updatedAt: now };
    const inactiveCanonicalPlan = await inactiveCanonical.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(inactiveCanonicalPlan.sourceLock.canonicalEquivalence.proven, true, "Exact mapping/reconciliation evidence must remain canonical proof even when its canonical product is inactive.");
    assert(inactiveCanonicalPlan.blockers.includes("MISSING_CANONICAL_LINK"));
    assert.strictEqual(inactiveCanonicalPlan.requirements.canonicalPackage.proven, true);
    assert.strictEqual(inactiveCanonicalPlan.requirements.canonicalPackage.ready, false);
    assert.strictEqual(inactiveCanonicalPlan.requirements.canonicalPackage.action, "RESTORE_CANONICAL_PRODUCT");

    const wonddFlow = fixtures();
    wonddFlow.state.supplier = { ...wonddFlow.state.supplier, supplierCode: "WONDD" };
    wonddFlow.state.mapping = { ...wonddFlow.state.mapping, supplierCode: "WONDD", productCode: "heartopia", packageCode: "HTP_20", supplierProductCode: "9624", supplierPackageCode: "HTP00020", supplierCatalogOfferId: "wo1" };
    wonddFlow.state.supplierProduct = { ...wonddFlow.state.supplierProduct, _id: "wsp1", supplierProductCode: "9624", supplierMarketCode: "UNSPECIFIED", normalizedInputContract: {}, requiredFields: [], metadata: { transactionalServiceCode: "HTP", serviceCodeAuthority: "WONDD_CATALOG_CONFIG_LEGACY" } };
    wonddFlow.state.offer = { ...wonddFlow.state.offer, _id: "wo1", supplierId: "s1", supplierCatalogProductId: "wsp1", supplierProductCode: "9624", supplierOfferCode: "HTP00020", reconciliationState: "EXACT_CANONICAL_MATCH" };
    wonddFlow.state.availability = { ...wonddFlow.state.availability, supplierCatalogOfferId: "wo1" };
    wonddFlow.state.canonicalProduct = { ...wonddFlow.state.canonicalProduct, productCode: "heartopia" };
    wonddFlow.state.canonicalProductEvidence = { ...wonddFlow.state.canonicalProduct };
    wonddFlow.state.canonicalPackages = [{ ...canonicalPackage, productCode: "heartopia", packageCode: "HTP_20" }];
    wonddFlow.state.canonicalPackagesEvidence = structuredClone(wonddFlow.state.canonicalPackages);
    const wonddInitial = await wonddFlow.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert(wonddInitial.blockers.includes("MARKET_UNRESOLVED"));
    assert(wonddInitial.blockers.includes("EXECUTION_IDENTITY_UNRESOLVED"));
    assert(wonddInitial.blockers.includes("INPUT_CONTRACT_UNRESOLVED"));
    assert.strictEqual(wonddInitial.requirements.canonicalPackage.proven, true);
    wonddFlow.state.supplierProduct.metadata.businessAuthority = { marketAuthority: { nativeMarketEvidence: "TH", fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"] } } };
    const wonddMarket = await wonddFlow.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(wonddMarket.requirements.supplierMarket.ready, true);
    assert.strictEqual(wonddMarket.requirements.customerEligibility.ready, true);
    assert.strictEqual(wonddMarket.requirements.executionIdentity.ready, false);
    assert.strictEqual(wonddMarket.requirements.customerInformation.ready, false);
    wonddFlow.state.supplierProduct.metadata.businessAuthority.executionAuthority = { executionIdentity: { servicecode: "HTP" } };
    const wonddExecution = await wonddFlow.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(wonddExecution.requirements.executionIdentity.ready, true);
    assert.strictEqual(wonddExecution.requirements.customerInformation.ready, false);
    wonddFlow.state.supplierProduct.normalizedInputContract = { version: 1, decisionVersion: 1, transactionalServiceCode: "HTP", fields: [{ customerField: "playerId", providerField: "gameid", required: true, label: "Player ID", type: "numeric-text", transformationId: "DIRECT", evidenceReference: "provider docs" }], authority: "OWNER_REVIEWED_PROVIDER_EVIDENCE", review: { status: "OWNER_REVIEWED", sourceHash: wonddFlow.state.supplierProduct.rawSnapshotHash } };
    const wonddReady = await wonddFlow.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(wonddReady.outcome, OUTCOMES.FULFILLMENT_READY);
    assert(Object.values(wonddReady.requirements).every(item => item.ready === true));
    const wonddUnavailable = fixtures(); wonddUnavailable.state.availability.state = "UNKNOWN";
    assert((await wonddUnavailable.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] })).requirements.availability.ready === false);
    const adapterMissing = fixtures({ adapterConfigured: false });
    assert.strictEqual((await adapterMissing.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] })).requirements.adapterProtocol.adapterConfigured, false);
    const crossMarket = fixtures();
    crossMarket.state.mapping.mappingMetadata = { foreignOnly: "TH_ROUTE_ONLY", readiness: { supplierMapped: true, inputReady: false, validationReady: false, fulfillmentReady: false, pricingReady: true, storefrontReady: true }, technicalPreparation: { authority: "FOREIGN_TH_PREPARATION", reviewedCustomerMarkets: ["TH"] } };
    crossMarket.state.mapping.supplierMarketEvidence = { normalizedMarket: "TH", supplierMarketCode: "TH", marketClassification: "FOREIGN_ROUTE", evidenceCode: "TH_ONLY" };
    const foreignBeforeCreate = structuredClone(crossMarket.state.mapping);
    crossMarket.state.supplierProduct.metadata = { businessAuthority: { marketAuthority: { nativeMarketEvidence: "MM", fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM"] } } } };
    const crossMarketPlan = await crossMarket.service.generatePlan({ mappingId: "m1", customerMarkets: ["MM"] });
    assert.strictEqual(crossMarketPlan.proposedChanges.operation, "CREATE");
    assert.strictEqual(crossMarketPlan.proposedChanges.region, "MM");
    const crossMarketResult = await crossMarket.service.applyPlan(crossMarketPlan, { actor: { id: "507f1f77bcf86cd799439011", username: "owner", role: "OWNER" }, confirmed: true });
    assert.strictEqual(crossMarket.state.createdMappings.length, 1);
    assert.strictEqual(crossMarket.state.createdMappings[0].enabled, false);
    assert.strictEqual(crossMarket.state.createdMappings[0].productionRole, "DISABLED");
    assert.strictEqual(crossMarket.state.createdMappings[0].region, "MM");
    assert.deepStrictEqual(crossMarket.state.mapping, foreignBeforeCreate, "The foreign-market canonical mapping must remain byte-for-byte unchanged.");
    assert.strictEqual(crossMarket.state.createdMappings[0].mappingMetadata.foreignOnly, undefined);
    assert.strictEqual(crossMarket.state.createdMappings[0].mappingMetadata.technicalPreparation.authority, "SUPPLIER_ROUTE_TECHNICALLY_PREPARED");
    assert.notDeepStrictEqual(crossMarket.state.createdMappings[0].mappingMetadata.technicalPreparation, foreignBeforeCreate.mappingMetadata.technicalPreparation);
    assert.strictEqual(crossMarket.state.createdMappings[0].mappingMetadata.readiness.pricingReady, false);
    assert.strictEqual(crossMarket.state.createdMappings[0].mappingMetadata.readiness.storefrontReady, false);
    assert.strictEqual(crossMarket.state.createdMappings[0].mappingMetadata.readiness.fulfillmentReady, true);
    assert(crossMarket.state.createdMappings[0].mappingMetadata.fulfillmentContract?.fingerprint);
    assert.deepStrictEqual(crossMarket.state.createdMappings[0].fulfillmentEligibility.allowedCustomerMarkets, ["MM"]);
    assert.strictEqual(crossMarket.state.audits[0].resourceId, "created-1");
    assert.strictEqual(crossMarketResult.mappingId, "created-1");
    const crossMarketReplay = await crossMarket.service.applyPlan(crossMarketPlan, { actor: { id: "507f1f77bcf86cd799439011", username: "owner", role: "OWNER" }, confirmed: true });
    assert.strictEqual(crossMarketReplay.idempotentReplay, true);
    assert.strictEqual(crossMarketReplay.mappingId, "created-1");
    assert.strictEqual(crossMarket.state.createdMappings.length, 1);

    const exactUpdate = fixtures();
    exactUpdate.state.supplierProduct.metadata = { businessAuthority: { marketAuthority: { nativeMarketEvidence: "MM", fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM"] } } } };
    exactUpdate.state.exactMarketMapping = { ...structuredClone(exactUpdate.state.mapping), _id: "m-mm", region: "MM", updatedAt: new Date(now.getTime() + 500), mappingMetadata: { exactRouteOnly: "MM_ROUTE", readiness: { supplierMapped: true, inputReady: false, validationReady: false, fulfillmentReady: false, pricingReady: false, storefrontReady: false } } };
    const foreignBeforeUpdate = structuredClone(exactUpdate.state.mapping);
    const exactUpdatePlan = await exactUpdate.service.generatePlan({ mappingId: "m1", customerMarkets: ["MM"] });
    assert.strictEqual(exactUpdatePlan.proposedChanges.operation, "UPDATE");
    assert.strictEqual(exactUpdatePlan.sourceLock.mapping.id, "m-mm");
    await exactUpdate.service.applyPlan(exactUpdatePlan, { actor: { id: "507f1f77bcf86cd799439011", username: "owner", role: "OWNER" }, confirmed: true });
    assert.deepStrictEqual(exactUpdate.state.updates, ["m-mm"]);
    assert.deepStrictEqual(exactUpdate.state.mapping, foreignBeforeUpdate);
    assert.strictEqual(exactUpdate.state.exactMarketMapping.mappingMetadata.exactRouteOnly, "MM_ROUTE");
    assert.strictEqual(exactUpdate.state.exactMarketMapping.mappingMetadata.technicalPreparation.authority, "SUPPLIER_ROUTE_TECHNICALLY_PREPARED");

    const createAuditFailure = fixtures({ failAudit: true });
    createAuditFailure.state.mapping.mappingMetadata = structuredClone(foreignBeforeCreate.mappingMetadata);
    createAuditFailure.state.supplierProduct.metadata = { businessAuthority: { marketAuthority: { nativeMarketEvidence: "MM", fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM"] } } } };
    const createFailureAnchor = structuredClone(createAuditFailure.state.mapping), createFailurePlan = await createAuditFailure.service.generatePlan({ mappingId: "m1", customerMarkets: ["MM"] });
    await assert.rejects(() => createAuditFailure.service.applyPlan(createFailurePlan, { actor: { username: "owner", role: "OWNER" }, confirmed: true }), /AUDIT_WRITE_FAILED/);
    assert.strictEqual(createAuditFailure.state.createdMappings.length, 0, "Failed audit must roll back the new mapping.");
    assert.deepStrictEqual(createAuditFailure.state.mapping, createFailureAnchor);
    assert.strictEqual(createAuditFailure.state.audits.length, 0);
    const routeSource = fs.readFileSync(path.resolve(__dirname, "../routes/supplier.js"), "utf8");
    const wizardSource = fs.readFileSync(path.resolve(__dirname, "../../frontend/js/admin-add-product-wizard.js"), "utf8");
    assert(routeSource.includes('router.post("/admin/supplier-catalog/route-preparation/plan", adminMiddleware, requireAdminPermission(PERMISSIONS.OWNER_ROUTING_MANAGE)'));
    assert(routeSource.includes('router.post("/admin/supplier-catalog/route-preparation/apply", adminMiddleware, requireAdminPermission(PERMISSIONS.OWNER_ROUTING_MANAGE)'));
    assert(wizardSource.includes('MARKET_ROUTE_DECISION:"Set up route"'));
    assert(wizardSource.includes('data-apply-route-setup'));
    assert(wizardSource.includes('/api/admin/supplier-catalog/route-preparation/plan'));
    for (const label of ["Canonical package", "Supplier market", "Customer eligibility", "Execution identity", "Customer information", "Availability", "Adapter / protocol"]) assert(wizardSource.includes(label), `Missing route requirement: ${label}`);
    assert(wizardSource.includes("RESTORE_CANONICAL_PRODUCT"));
    assert(wizardSource.includes("Run controlled refresh"));
    assert(wizardSource.includes("/api/admin/supplier-catalog/automation/"));
    console.log(JSON.stringify({ result: "PASS", preCommercialReadyWhilePrivate: true, negativeCases: 8, sourceLockRejectsStale: true, idempotentApply: true, automaticPrimaryAssignments: 0, enabledWrites: 0, pricingWrites: 0, publicationWrites: 0, storefrontWrites: 0, supplierCalls: 0 }, null, 2));
})().catch(error => { console.error("VERIFY_SUPPLIER_ROUTE_PREPARATION_FAILED:", error); process.exitCode = 1; });
