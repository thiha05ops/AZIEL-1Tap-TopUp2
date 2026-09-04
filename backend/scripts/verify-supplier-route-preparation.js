#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { assessPreCommercialFulfillmentReadiness } = require("../services/fulfillmentCapabilityService");
const { createSupplierRoutePreparationService, OUTCOMES, outcomeFor } = require("../services/supplierCatalog/supplierRoutePreparationService");

const hash = character => character.repeat(64);
const now = new Date("2026-09-03T00:00:00.000Z");
const contract = { version: 1, supplierCode: "FAZERCARDS", protocol: "FAZERCARDS_TOPUPS_ORDER_V2", supplierProductCode: "pubg_mobile_auto", sourceSupplierCatalogProductId: "sp1", sourceHash: hash("a"), fields: [{ customerField: "playerId", providerField: "player_id", required: true }], fingerprint: "fixture" };
const mapping = { _id: "m1", supplierId: "s1", supplierCode: "FAZERCARDS", productCode: "pubg", packageCode: "PUBG_325_UC", supplierProductCode: "pubg_mobile_auto", supplierPackageCode: "325_uc", supplierCatalogOfferId: "o1", region: "GLOBAL", enabled: false, productionRole: "DISABLED", executionMode: "API", archivedAt: null, fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "fixture", verifiedAt: now, version: 2 }, mappingMetadata: { readiness: { supplierMapped: true, pricingReady: false, inputReady: true, validationReady: true, fulfillmentReady: true, storefrontReady: false }, fulfillmentContract: contract }, updatedAt: now };
const supplier = { _id: "s1", supplierCode: "FAZERCARDS", enabled: true, mode: "API", updatedAt: now };
const supplierProduct = { _id: "sp1", supplierId: "s1", supplierProductCode: "pubg_mobile_auto", supplierMarketCode: "GLOBAL", supportState: "SUPPORTED", rawSnapshotHash: hash("a"), sourceRevision: "p1", normalizedInputContract: { fields: contract.fields }, restrictions: [], updatedAt: now };
const offer = { _id: "o1", supplierId: "s1", supplierCatalogProductId: "sp1", supplierProductCode: "pubg_mobile_auto", supplierOfferCode: "325_uc", catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", rawSnapshotHash: hash("b"), sourceRevision: "o1", updatedAt: now };
const availability = { supplierCatalogOfferId: "o1", state: "AVAILABLE", coverageComplete: true, observedAt: now, staleAt: null, updatedAt: now };
const canonicalProduct = { _id: "cp1", productCode: "pubg", updatedAt: now };
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
assert.strictEqual(outcomeFor([]), OUTCOMES.FULFILLMENT_READY);
assert.strictEqual(outcomeFor(["STALE_OR_WRONG_OFFER_LINKAGE"]), OUTCOMES.REVIEW_REQUIRED);
assert.strictEqual(outcomeFor(["SUPPLIER_UNSUPPORTED"]), OUTCOMES.UNSUPPORTED);
assert.strictEqual(outcomeFor(["MARKET_UNRESOLVED"]), OUTCOMES.MARKET_UNRESOLVED);
assert.strictEqual(outcomeFor(["AVAILABILITY_UNPROVEN"]), OUTCOMES.AVAILABILITY_UNPROVEN);
for (const [change, blocker] of [
    [{ mapping: null }, "MISSING_MAPPING"],
    [{ offer: { ...offer, _id: "wrong" } }, "STALE_OR_WRONG_OFFER_LINKAGE"],
    [{ mapping: { ...mapping, fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 } } }, "CUSTOMER_MARKET_ELIGIBILITY_UNPROVEN"],
    [{ fulfillmentContract: null }, "INPUT_CONTRACT_UNRESOLVED"],
    [{ processorSupported: false }, "PROTOCOL_UNSUPPORTED"],
    [{ availability: { ...availability, coverageComplete: false } }, "AVAILABILITY_UNPROVEN"],
    [{ offer: { ...offer, catalogLifecycleState: "RETIRED" } }, "OFFER_NOT_ACTIVE"],
    [{ canonicalPackages: [canonicalPackage, { ...canonicalPackage, _id: "ck2" }] }, "AMBIGUOUS_CANONICAL_IDENTITY"]
]) assert(assessPreCommercialFulfillmentReadiness({ ...readyInput, ...change }).blockers.includes(blocker), blocker);

function fixtures({ failAudit = false } = {}) {
    const state = { mapping: { ...mapping, executionMode: "MANUAL", fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 }, mappingMetadata: { readiness: { supplierMapped: true, pricingReady: false, inputReady: false, validationReady: false, fulfillmentReady: false, storefrontReady: false } } }, supplier: { ...supplier }, supplierProduct: { ...supplierProduct }, offer: { ...offer }, availability: { ...availability }, canonicalProduct: { ...canonicalProduct }, canonicalPackages: [{ ...canonicalPackage }], audits: [], updates: 0 };
    const repos = {
        transaction: async fn => {
            const snapshot = structuredClone(state);
            try { return await fn({ transaction: true }); }
            catch (error) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, snapshot); throw error; }
        },
        mappingById: async id => state.mapping && id === state.mapping._id ? state.mapping : null,
        supplierById: async () => state.supplier,
        offerById: async () => state.offer,
        productById: async () => state.supplierProduct,
        availabilityByOffer: async () => state.availability,
        canonicalProduct: async () => state.canonicalProduct,
        canonicalPackages: async () => state.canonicalPackages,
        auditByPlanHash: async planHash => state.audits.find(item => item.metadata.planHash === planHash) || null,
        updateMapping: async (id, expectedUpdatedAt, update) => {
            if (id !== state.mapping._id || new Date(expectedUpdatedAt).getTime() !== new Date(state.mapping.updatedAt).getTime()) return { matchedCount: 0, modifiedCount: 0 };
            state.mapping = { ...state.mapping, ...update, updatedAt: new Date(now.getTime() + 1000) }; state.updates += 1;
            return { matchedCount: 1, modifiedCount: 1 };
        },
        createAudit: async document => { if (failAudit) throw new Error("AUDIT_WRITE_FAILED"); state.audits.push(document); return [document]; }
    };
    const service = createSupplierRoutePreparationService({ repos, adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }), processorSupportResolver: value => value.mappingMetadata?.fulfillmentContract?.protocol === "FAZERCARDS_TOPUPS_ORDER_V2", clock: () => now });
    return { state, service };
}

(async () => {
    const { state, service } = fixtures();
    const plan = await service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(plan.outcome, OUTCOMES.FULFILLMENT_READY);
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
    assert.strictEqual(state.updates, 1);

    const stale = fixtures(), stalePlan = await stale.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    stale.state.offer.rawSnapshotHash = hash("c");
    await assert.rejects(() => stale.service.applyPlan(stalePlan, { actor: { username: "owner", role: "OWNER" }, confirmed: true }), error => error.code === "PREPARATION_SOURCE_STALE");
    assert.strictEqual(stale.state.updates, 0);
    assert.strictEqual(stale.state.audits.length, 0);

    const tampered = fixtures(), tamperedPlan = await tampered.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    tamperedPlan.proposedChanges.executionMode = "MANUAL";
    await assert.rejects(() => tampered.service.applyPlan(tamperedPlan, { actor: { username: "owner", role: "OWNER" }, confirmed: true }), error => error.code === "PREPARATION_PLAN_HASH_MISMATCH");
    assert.strictEqual(tampered.state.updates, 0);

    const auditFailure = fixtures({ failAudit: true }), auditFailurePlan = await auditFailure.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    await assert.rejects(() => auditFailure.service.applyPlan(auditFailurePlan, { actor: { username: "owner", role: "OWNER" }, confirmed: true }), /AUDIT_WRITE_FAILED/);
    assert.strictEqual(auditFailure.state.updates, 0, "The mapping mutation must roll back with a failed audit write.");
    assert.strictEqual(auditFailure.state.mapping.executionMode, "MANUAL");

    const ambiguous = fixtures(); ambiguous.state.canonicalPackages.push({ ...canonicalPackage, _id: "ck2" });
    const ambiguousPlan = await ambiguous.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(ambiguousPlan.outcome, OUTCOMES.REVIEW_REQUIRED);
    assert.strictEqual(ambiguousPlan.proposedChanges, null);
    await assert.rejects(() => ambiguous.service.applyPlan(ambiguousPlan, { actor: { username: "owner", role: "OWNER" }, confirmed: true }), error => error.code === "PREPARATION_NOT_READY");
    assert.strictEqual(ambiguous.state.updates, 0);
    assert.strictEqual(ambiguous.state.audits.length, 0);

    const missing = fixtures(); missing.state.mapping = null;
    assert.strictEqual((await missing.service.generatePlan({ mappingId: "missing", customerMarkets: ["TH"] })).outcome, OUTCOMES.MISSING_MAPPING);
    const routeSource = fs.readFileSync(path.resolve(__dirname, "../routes/supplier.js"), "utf8");
    assert(routeSource.includes('router.post("/admin/supplier-catalog/route-preparation/plan", adminMiddleware, requireAdminPermission(PERMISSIONS.OWNER_ROUTING_MANAGE)'));
    assert(routeSource.includes('router.post("/admin/supplier-catalog/route-preparation/apply", adminMiddleware, requireAdminPermission(PERMISSIONS.OWNER_ROUTING_MANAGE)'));
    console.log(JSON.stringify({ result: "PASS", preCommercialReadyWhilePrivate: true, negativeCases: 8, sourceLockRejectsStale: true, idempotentApply: true, automaticPrimaryAssignments: 0, enabledWrites: 0, pricingWrites: 0, publicationWrites: 0, storefrontWrites: 0, supplierCalls: 0 }, null, 2));
})().catch(error => { console.error("VERIFY_SUPPLIER_ROUTE_PREPARATION_FAILED:", error); process.exitCode = 1; });
