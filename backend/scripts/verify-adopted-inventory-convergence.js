#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
    ADOPTION_STATES,
    OUTCOMES,
    adoptionStateFor,
    assessExistingPreparedRoute,
    proposedMapping,
    createSupplierRoutePreparationService
} = require("../services/supplierCatalog/supplierRoutePreparationService");
const { linkedOfferLaunchTarget } = require("../services/adminSupplierCatalogReadService");
const { supportsMapping } = require("../services/suppliers/supplierFulfillmentDispatcher");

const hash = character => character.repeat(64);
const now = new Date("2026-09-04T00:00:00.000Z");
const contract = {
    version: 1,
    supplierCode: "FAZERCARDS",
    protocol: "FAZERCARDS_TOPUPS_ORDER_V2",
    supplierProductCode: "pubg_mobile_auto",
    sourceSupplierCatalogProductId: "sp1",
    sourceHash: hash("a"),
    fields: [{ customerField: "playerId", providerField: "player_id", required: true }],
    fingerprint: "fixture"
};
const supplier = { _id: "s1", supplierCode: "FAZERCARDS", enabled: true, mode: "API", updatedAt: now };
const mapping = {
    _id: "m1",
    supplierId: "s1",
    supplierCode: "FAZERCARDS",
    productCode: "pubg",
    packageCode: "PUBG_325_UC",
    supplierProductCode: "pubg_mobile_auto",
    supplierPackageCode: "325_uc",
    supplierCatalogOfferId: "o1",
    region: "TH",
    enabled: false,
    productionRole: "DISABLED",
    executionMode: "MANUAL",
    archivedAt: null,
    fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 },
    mappingMetadata: { readiness: { supplierMapped: true, pricingReady: false, inputReady: false, validationReady: false, fulfillmentReady: false, storefrontReady: false } },
    updatedAt: now
};
const supplierProduct = {
    _id: "sp1",
    supplierId: "s1",
    supplierProductCode: "pubg_mobile_auto",
    supplierMarketCode: "GLOBAL",
    supportState: "SUPPORTED",
    rawSnapshotHash: hash("a"),
    sourceRevision: "p1",
    normalizedInputContract: { fields: contract.fields },
    restrictions: [],
    updatedAt: now
};
const offer = {
    _id: "o1",
    supplierId: "s1",
    supplierCatalogProductId: "sp1",
    supplierProductCode: "pubg_mobile_auto",
    supplierOfferCode: "325_uc",
    catalogLifecycleState: "ACTIVE",
    reconciliationState: "EXACT_CANONICAL_MATCH",
    rawSnapshotHash: hash("b"),
    sourceRevision: "o1",
    updatedAt: now
};
const availability = { supplierCatalogOfferId: "o1", state: "AVAILABLE", coverageComplete: true, observedAt: now, staleAt: null, updatedAt: now };
const canonicalProduct = { _id: "cp1", productCode: "pubg", updatedAt: now };
const canonicalPackage = { _id: "ck1", productCode: "pubg", packageCode: "PUBG_325_UC", enabled: false, prices: {}, updatedAt: now };

function fixtures(overrides = {}) {
    const state = {
        mapping: structuredClone({ ...mapping, ...(overrides.mapping || {}) }),
        supplier: structuredClone({ ...supplier, ...(overrides.supplier || {}) }),
        supplierProduct: structuredClone({ ...supplierProduct, ...(overrides.supplierProduct || {}) }),
        offer: structuredClone({ ...offer, ...(overrides.offer || {}) }),
        availability: structuredClone({ ...availability, ...(overrides.availability || {}) }),
        canonicalProduct: structuredClone({ ...canonicalProduct, ...(overrides.canonicalProduct || {}) }),
        canonicalPackages: structuredClone(overrides.canonicalPackages || [canonicalPackage]),
        audits: [],
        updates: 0
    };
    const repos = {
        transaction: async fn => {
            const snapshot = structuredClone(state);
            try { return await fn({}); }
            catch (error) {
                for (const key of Object.keys(state)) delete state[key];
                Object.assign(state, snapshot);
                throw error;
            }
        },
        mappingById: async value => value === state.mapping?._id ? state.mapping : null,
        supplierById: async () => state.supplier,
        offerById: async () => state.offer,
        productById: async () => state.supplierProduct,
        availabilityByOffer: async () => state.availability,
        canonicalProduct: async () => state.canonicalProduct,
        canonicalPackages: async () => state.canonicalPackages,
        auditByPlanHash: async planHash => state.audits.find(item => item.metadata.planHash === planHash) || null,
        updateMapping: async (mappingId, expectedUpdatedAt, update) => {
            if (mappingId !== state.mapping._id || new Date(expectedUpdatedAt).getTime() !== new Date(state.mapping.updatedAt).getTime()) return { matchedCount: 0, modifiedCount: 0 };
            state.mapping = { ...state.mapping, ...update, mappingMetadata: update.mappingMetadata, updatedAt: new Date(now.getTime() + 1000) };
            state.updates += 1;
            return { matchedCount: 1, modifiedCount: 1 };
        },
        createAudit: async document => { state.audits.push(document); return [document]; }
    };
    return {
        state,
        service: createSupplierRoutePreparationService({
            repos,
            adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }),
            processorSupportResolver: value => value.supplierCode === "FAZERCARDS" && value.supplierProductCode === "pubg_mobile_auto",
            clock: () => now
        })
    };
}

(async () => {
    assert.strictEqual(adoptionStateFor({ mapping, offer, supplierProduct }), ADOPTION_STATES.CURRENTLY_ADOPTED);
    assert.strictEqual(adoptionStateFor({ mapping: { ...mapping, supplierCatalogOfferId: "" }, offer, supplierProduct }), ADOPTION_STATES.HISTORICAL_ONLY);
    assert.strictEqual(adoptionStateFor({ mapping: null, offer: { ...offer, reconciliationState: "AMBIGUOUS" }, supplierProduct }), ADOPTION_STATES.ADOPTION_REVIEW_REQUIRED);
    assert.strictEqual(adoptionStateFor({ mapping: null, offer: { ...offer, reconciliationState: "UNREVIEWED" }, supplierProduct }), ADOPTION_STATES.NOT_ADOPTED);

    const prepared = fixtures();
    const plan = await prepared.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH", "MM"] });
    assert.strictEqual(plan.adoptionState, ADOPTION_STATES.CURRENTLY_ADOPTED);
    assert.strictEqual(plan.outcome, OUTCOMES.FULFILLMENT_READY);
    assert.strictEqual(plan.proposedChanges.region, "GLOBAL");
    assert.deepStrictEqual(plan.proposedChanges.fulfillmentEligibility.allowedCustomerMarkets, ["MM", "TH"]);
    assert.strictEqual(plan.safety.enabledWrites, 0);
    assert.strictEqual(plan.safety.roleWrites, 0);
    assert.strictEqual(plan.safety.pricingWrites, 0);
    assert.strictEqual(plan.safety.publicationWrites, 0);
    assert.strictEqual(plan.safety.storefrontWrites, 0);
    assert.strictEqual(plan.safety.supplierCalls, 0);
    const applied = await prepared.service.applyPlan(plan, { actor: { id: "507f1f77bcf86cd799439011", username: "owner", role: "OWNER" }, confirmed: true });
    assert.strictEqual(applied.applied, 1);
    assert.strictEqual(prepared.state.mapping.enabled, false);
    assert.strictEqual(prepared.state.mapping.productionRole, "DISABLED");
    assert.strictEqual(prepared.state.mapping.region, "GLOBAL");
    assert.strictEqual(prepared.state.mapping.executionMode, "API");
    assert.deepStrictEqual(prepared.state.mapping.fulfillmentEligibility.allowedCustomerMarkets, ["MM", "TH"]);
    assert.strictEqual(prepared.state.mapping.mappingMetadata.readiness.inputReady, true);
    assert.strictEqual(prepared.state.mapping.mappingMetadata.readiness.validationReady, true);
    assert.strictEqual(prepared.state.mapping.mappingMetadata.readiness.fulfillmentReady, true);
    assert.strictEqual(prepared.state.mapping.mappingMetadata.readiness.pricingReady, false);
    assert.strictEqual(prepared.state.mapping.mappingMetadata.readiness.storefrontReady, false);
    assert.strictEqual((await prepared.service.applyPlan(plan, { actor: { id: "507f1f77bcf86cd799439011", username: "owner", role: "OWNER" }, confirmed: true })).idempotentReplay, true);
    assert.strictEqual(prepared.state.updates, 1);

    const unresolvedMarket = fixtures({ supplierProduct: { supplierMarketCode: "UNSPECIFIED" } });
    const unresolvedMarketPlan = await unresolvedMarket.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(unresolvedMarketPlan.outcome, OUTCOMES.FULFILLMENT_READY);
    assert.strictEqual(unresolvedMarketPlan.proposedChanges.region, "TH");
    const genuinelyUnresolvedMarket = fixtures({ mapping: { region: "UNKNOWN" }, supplierProduct: { supplierMarketCode: "UNSPECIFIED" } });
    const genuinelyUnresolvedMarketPlan = await genuinelyUnresolvedMarket.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(genuinelyUnresolvedMarketPlan.outcome, OUTCOMES.MARKET_UNRESOLVED);
    assert.strictEqual(genuinelyUnresolvedMarketPlan.proposedChanges, null);

    const missingContract = fixtures({ supplierProduct: { normalizedInputContract: { fields: [] } } });
    const missingContractPlan = await missingContract.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(missingContractPlan.outcome, OUTCOMES.INPUT_CONTRACT_UNRESOLVED);

    const ambiguousPackage = fixtures({ canonicalPackages: [canonicalPackage, { ...canonicalPackage, _id: "ck2" }] });
    const ambiguousPackagePlan = await ambiguousPackage.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    assert.strictEqual(ambiguousPackagePlan.outcome, OUTCOMES.REVIEW_REQUIRED);

    const projected = {
        rows: [
            { supplierCode: "FAZERCARDS", supplierProductId: "fp1", mappingStatus: "LINKED", offerId: "fo1" },
            { supplierCode: "FAZERCARDS", supplierProductId: "fp1", mappingStatus: "UNLINKED", offerId: "fo2" },
            { supplierCode: "WONDD", supplierProductId: "wp1", mappingStatus: "LINKED", offerId: "wo1" },
            { supplierCode: "WONDD", supplierProductId: "wp2", mappingStatus: "UNLINKED", offerId: "wo2" }
        ],
        productRows: [
            { supplierCode: "FAZERCARDS", productId: "fp1" },
            { supplierCode: "WONDD", productId: "wp1" },
            { supplierCode: "WONDD", productId: "wp2" }
        ]
    };
    const target = linkedOfferLaunchTarget(projected);
    assert.strictEqual(target.authority, "ADMIN_SUPPLIER_CATALOG_LINKED_OFFER_PROJECTION");
    assert.strictEqual(target.linkedOfferCount, 2);
    assert.strictEqual(target.supplierProductCount, 2);
    assert.deepStrictEqual(target.offers.map(row => row.offerId).sort(), ["fo1", "wo1"]);
    assert.deepStrictEqual(target.products.map(row => row.productId).sort(), ["fp1", "wp1"]);

    const wonddMapping = {
        ...mapping,
        _id: "wm1",
        supplierCode: "WONDD",
        productCode: "mlbb",
        packageCode: "MLBB_42",
        supplierProductCode: "mlbb",
        supplierPackageCode: "M00042",
        region: "TH"
    };
    const wonddSupplier = { ...supplier, supplierCode: "WONDD" };
    const wonddProduct = {
        ...supplierProduct,
        supplierProductCode: "mlbb",
        supplierMarketCode: "UNSPECIFIED",
        metadata: { transactionalServiceCode: "mlbb" },
        normalizedInputContract: { contractId: "MLBB_USER_ZONE", fields: [{ name: "userId", required: true }, { name: "zoneId", required: true }] }
    };
    const wonddOffer = {
        ...offer,
        supplierProductCode: "mlbb",
        supplierOfferCode: "M00042"
    };
    assert.strictEqual(supportsMapping(wonddMapping), true);
    assert.strictEqual(supportsMapping({ ...wonddMapping, supplierProductCode: "9622" }), false);
    const wonddInitial = assessExistingPreparedRoute({
        mapping: wonddMapping,
        supplier: wonddSupplier,
        supplierProduct: wonddProduct,
        offer: wonddOffer,
        availability,
        canonicalProduct: { ...canonicalProduct, productCode: "mlbb" },
        canonicalPackages: [{ ...canonicalPackage, productCode: "mlbb", packageCode: "MLBB_42" }]
    }, ["TH"], { adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }), processorSupportResolver: supportsMapping });
    assert(!wonddInitial.blockers.includes("MARKET_UNRESOLVED"));
    const wonddProposal = proposedMapping(wonddMapping, {
        mapping: wonddMapping,
        supplier: wonddSupplier,
        supplierProduct: wonddProduct,
        offer: wonddOffer,
        availability,
        canonicalProduct: { ...canonicalProduct, productCode: "mlbb" },
        canonicalPackages: [{ ...canonicalPackage, productCode: "mlbb", packageCode: "MLBB_42" }]
    }, { customerMarkets: ["TH"] }, wonddInitial);
    assert.strictEqual(wonddProposal.region, "TH");
    assert.strictEqual(wonddProposal.executionMode, "API");
    assert.strictEqual(wonddProposal.fulfillmentEligibility.mode, "CUSTOMER_MARKET_ALLOWLIST");
    const wonddPrepared = assessExistingPreparedRoute({
        mapping: wonddProposal,
        supplier: wonddSupplier,
        supplierProduct: wonddProduct,
        offer: wonddOffer,
        availability,
        canonicalProduct: { ...canonicalProduct, productCode: "mlbb" },
        canonicalPackages: [{ ...canonicalPackage, productCode: "mlbb", packageCode: "MLBB_42" }]
    }, ["TH"], { adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }), processorSupportResolver: supportsMapping });
    assert.deepStrictEqual(wonddPrepared.blockers, []);
    assert(!wonddPrepared.blockers.includes("PROTOCOL_UNSUPPORTED"));

    const stale = fixtures();
    const stalePlan = await stale.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    stale.state.offer.rawSnapshotHash = hash("c");
    await assert.rejects(() => stale.service.applyPlan(stalePlan, { actor: { username: "owner", role: "OWNER" }, confirmed: true }), error => error.code === "PREPARATION_SOURCE_STALE");
    assert.strictEqual(stale.state.updates, 0);

    const tampered = fixtures();
    const tamperedPlan = await tampered.service.generatePlan({ mappingId: "m1", customerMarkets: ["TH"] });
    tamperedPlan.proposedChanges.region = "TH";
    await assert.rejects(() => tampered.service.applyPlan(tamperedPlan, { actor: { username: "owner", role: "OWNER" }, confirmed: true }), error => error.code === "PREPARATION_PLAN_HASH_MISMATCH");
    assert.strictEqual(tampered.state.updates, 0);

    console.log(JSON.stringify({
        result: "PASS",
        adoptionStates: Object.keys(ADOPTION_STATES).length,
        deterministicGlobalFazerPreparation: true,
        unresolvedMarketBlocked: true,
        ambiguousEvidenceBlocked: true,
        linkedOfferLaunchTargetLocked: true,
        wonddServiceCodeSupported: true,
        wonddConcreteMarketPreparedWithoutFakeGlobal: true,
        preparedMappingRemainsDisabled: true,
        primaryAssignments: 0,
        pricingWrites: 0,
        publicationWrites: 0,
        storefrontWrites: 0,
        supplierOrderCalls: 0,
        productionWrites: 0
    }, null, 2));
})().catch(error => {
    console.error("VERIFY_ADOPTED_INVENTORY_CONVERGENCE_FAILED:", error);
    process.exitCode = 1;
});
