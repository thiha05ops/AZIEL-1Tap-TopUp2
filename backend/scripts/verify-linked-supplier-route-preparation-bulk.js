#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const mongoose = require("mongoose");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const AdminAuditLog = require("../models/AdminAuditLog");
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");
const {
    applyPlansAtomically,
    createSnapshotPreparationService,
    customerMarketsFor,
    hasEffectiveTechnicalDelta,
    sourceLockDiff,
    validatePlanPersistenceContracts
} = require("./apply-linked-supplier-route-preparation");
const { supplierMarketCompatibility } = require("../services/supplierFulfillmentEligibilityService");
const { normalizeSupplierMarket } = require("../constants/supplierMarkets");

const sha = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
const now = new Date("2026-09-04T12:00:00.000Z");
let supplierCalls = 0;

function plan(id, { updatedAt = now, executionMode = "MANUAL", supplierMarket = "GLOBAL", markets = ["TH"], product = "afk_journey", sku = "126_dragon_crystals", supplierId = "supplier-1", offerId = `offer-${id}` } = {}) {
    const body = {
        artifactType: "SUPPLIER_ROUTE_PREPARATION_PLAN",
        schemaVersion: 1,
        request: { mappingId: id, customerMarkets: markets },
        adoptionState: "CURRENTLY_ADOPTED",
        outcome: "FULFILLMENT_READY",
        blockers: [],
        evidence: { supplierCode: "FAZERCARDS", supplierProductCode: product, supplierOfferCode: sku, supplierMarket, canonicalProductCode: product, canonicalPackageCode: `PKG_${id}`, protocol: "FAZERCARDS_TOPUPS_ORDER_V2" },
        sourceLock: {
            mapping: {
                id,
                updatedAt,
                supplierId,
                supplierProductCode: product,
                supplierPackageCode: sku,
                supplierCatalogOfferId: offerId,
                supplierMarket,
                enabled: false,
                productionRole: "DISABLED",
                executionMode,
                fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 },
                readiness: { supplierMapped: true, pricingReady: false, inputReady: false, validationReady: false, fulfillmentReady: false, storefrontReady: false }
            },
            supplier: { id: supplierId, code: "FAZERCARDS", updatedAt: now },
            supplierProduct: { id: "sp-1", code: product, market: supplierMarket, sourceRevision: "p1", sourceHash: "a".repeat(64), updatedAt: now },
            offer: { id: offerId, code: sku, lifecycle: "ACTIVE", reconciliation: "EXACT_CANONICAL_MATCH", sourceRevision: "o1", sourceHash: "b".repeat(64), updatedAt: now },
            availability: { state: "AVAILABLE", coverageComplete: true, observedAt: now, updatedAt: now },
            canonical: { productId: "cp-1", productCode: product, packageIds: [`ck-${id}`], packageCode: `PKG_${id}`, productUpdatedAt: now, packageUpdatedAt: now },
            runtime: { adapterConfigured: true, autoFulfillmentEnabled: true, processorSupported: true, protocol: "FAZERCARDS_TOPUPS_ORDER_V2", contractFingerprint: `fingerprint-${id}` }
        },
        proposedChanges: {
            region: supplierMarket,
            supplierCatalogOfferId: offerId,
            supplierProductCode: product,
            supplierPackageCode: sku,
            executionMode: "API",
            supplierMarketEvidence: { normalizedMarket: supplierMarket, supplierMarketCode: supplierMarket, marketClassification: "REVIEWED_SUPPLIER_MARKET", restrictions: [], evidenceCode: "SOURCE_LOCKED_SUPPLIER_CATALOG", sourceProductHash: "a".repeat(64) },
            fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: markets, evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: `Reviewed ${supplierMarket} supplier route preparation`, verifiedAt: new Date(0), version: 2 },
            fulfillmentContract: { version: 1, supplierCode: "FAZERCARDS", protocol: "FAZERCARDS_TOPUPS_ORDER_V2", supplierProductCode: product, sourceSupplierCatalogProductId: "sp-1", sourceHash: "a".repeat(64), fields: [{ customerField: "accountId", providerField: "account_id", required: true }], fingerprint: `fingerprint-${id}` },
            readiness: { supplierMapped: true, inputReady: true, validationReady: true, fulfillmentReady: true }
        },
        safety: { enabledWrites: 0, roleWrites: 0, supplierMarketWrites: executionMode === "API" ? 0 : 1, offerLinkageWrites: 0, pricingWrites: 0, publicationWrites: 0, storefrontWrites: 0, supplierCalls: 0 }
    };
    return { ...body, sourceLockHash: sha(body.sourceLock), planHash: sha(body) };
}

function memoryDeps(initialMappings, { failAudit = false } = {}) {
    const state = {
        mappings: new Map(initialMappings.map(item => [item._id, structuredClone(item)])),
        audits: [],
        events: [],
        sessionStarts: 0
    };
    const session = {
        async withTransaction(callback) {
            const snapshot = structuredClone({ mappings: [...state.mappings.entries()], audits: state.audits });
            try { await callback(); }
            catch (error) {
                state.mappings = new Map(snapshot.mappings);
                state.audits = snapshot.audits;
                throw error;
            }
        },
        async endSession() {}
    };
    return {
        state,
        connection: { async startSession() { state.sessionStarts += 1; state.events.push("transaction:start"); return session; } },
        MappingModel: {
            find(filter = {}) {
                const ids = new Set((filter._id?.$in || []).map(String));
                return { lean: async () => [...state.mappings.values()].filter(row => !ids.size || ids.has(String(row._id))).map(row => structuredClone(row)) };
            },
            findById(id) {
                return { session: () => ({ lean: async () => structuredClone(state.mappings.get(id) || null) }) };
            },
            async bulkWrite(ops) {
                state.events.push(`mapping:bulkWrite:${ops.length}`);
                let matchedCount = 0;
                for (const op of ops) {
                    const filter = op.updateOne.filter;
                    const update = op.updateOne.update;
                    const current = state.mappings.get(filter._id);
                    if (!current || new Date(current.updatedAt).getTime() !== new Date(filter.updatedAt).getTime()) continue;
                    state.mappings.set(filter._id, { ...current, ...structuredClone(update.$set), updatedAt: new Date(now.getTime() + state.events.length) });
                    matchedCount += 1;
                }
                return { matchedCount, modifiedCount: matchedCount };
            },
            async updateOne(filter, update) {
                state.events.push(`mapping:update:${filter._id}`);
                const current = state.mappings.get(filter._id);
                if (!current || new Date(current.updatedAt).getTime() !== new Date(filter.updatedAt).getTime()) return { matchedCount: 0, modifiedCount: 0 };
                state.mappings.set(filter._id, { ...current, ...structuredClone(update.$set), updatedAt: new Date(now.getTime() + state.events.length) });
                return { matchedCount: 1, modifiedCount: 1 };
            }
        },
        AuditModel: {
            async insertMany(docs) {
                state.events.push("audit:insertMany");
                if (failAudit) throw new Error("AUDIT_WRITE_FAILED");
                state.audits.push(...structuredClone(docs));
            },
            async create(docs) {
                state.events.push("audit:create");
                if (failAudit) throw new Error("AUDIT_WRITE_FAILED");
                state.audits.push(...structuredClone(docs));
            }
        }
    };
}

function mappingFromPlan(item) {
    return {
        _id: item.request.mappingId,
        updatedAt: item.sourceLock.mapping.updatedAt,
        mappingMetadata: { readiness: item.sourceLock.mapping.readiness },
        enabled: false,
        productionRole: "DISABLED",
        executionMode: item.sourceLock.mapping.executionMode
    };
}

function canonicalParityFixture({ productDeleted = false, packageDeleted = false, includeActiveProduct = true, includeActivePackage = true, mappingRegion = "GLOBAL", productionRole = "DISABLED" } = {}) {
    const productCode = "parity_game";
    const packageCode = "PKG_PARITY";
    const supplierProductCode = "parity_supplier_game";
    const supplierOfferCode = "100_pack";
    const supplierId = "supplier-parity";
    const supplierCatalogProductId = "supplier-product-parity";
    const supplierCatalogOfferId = "supplier-offer-parity";
    const mappingId = "mapping-parity";
    const deletedAt = new Date("2026-09-03T00:00:00.000Z");
    return {
        suppliers: [{ _id: supplierId, supplierCode: "FAZERCARDS", enabled: true, mode: "API", updatedAt: now }],
        products: [{
            _id: supplierCatalogProductId,
            supplierId,
            supplierProductCode,
            supplierMarketCode: "GLOBAL",
            supportState: "SUPPORTED",
            rawSnapshotHash: "c".repeat(64),
            sourceRevision: "sp-rev",
            updatedAt: now,
            normalizedInputContract: {
                review: { status: "OWNER_REVIEWED", sourceHash: "c".repeat(64) },
                fields: [{ customerField: "playerId", providerField: "player_id", required: true, type: "text" }]
            }
        }],
        offers: [{
            _id: supplierCatalogOfferId,
            supplierId,
            supplierCatalogProductId,
            supplierProductCode,
            supplierOfferCode,
            catalogLifecycleState: "ACTIVE",
            reconciliationState: "EXACT_CANONICAL_MATCH",
            rawSnapshotHash: "d".repeat(64),
            sourceRevision: "offer-rev",
            updatedAt: now
        }],
        availability: [{ supplierCatalogOfferId, state: "AVAILABLE", coverageComplete: true, observedAt: now, updatedAt: now }],
        mappings: [{
            _id: mappingId,
            supplierId,
            supplierCode: "FAZERCARDS",
            supplierCatalogOfferId,
            supplierProductCode,
            supplierPackageCode: supplierOfferCode,
            productCode,
            packageCode,
            region: mappingRegion,
            enabled: false,
            productionRole,
            executionMode: "MANUAL",
            fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 },
            mappingMetadata: { readiness: { supplierMapped: true, inputReady: false, validationReady: false, fulfillmentReady: false } },
            updatedAt: now
        }],
        catalogProducts: [
            ...(includeActiveProduct ? [{ _id: "canonical-product-active", productCode, updatedAt: now, deletedAt: productDeleted ? deletedAt : null }] : []),
            { _id: "canonical-product-deleted", productCode, updatedAt: now, deletedAt }
        ],
        catalogPackages: [
            ...(includeActivePackage ? [{ _id: "canonical-package-active", productCode, packageCode, updatedAt: now, deletedAt: packageDeleted ? deletedAt : null }] : []),
            { _id: "canonical-package-deleted", productCode, packageCode, updatedAt: now, deletedAt }
        ],
        mappingId
    };
}

async function generateSnapshotPlan(fixture) {
    const service = createSnapshotPreparationService(fixture, {
        adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }),
        processorSupportResolver: () => true
    });
    return service.generatePlan({ mappingId: fixture.mappingId, customerMarkets: ["TH"] });
}

(async () => {
    const validCanonical = await generateSnapshotPlan(canonicalParityFixture());
    assert.strictEqual(validCanonical.outcome, "FULFILLMENT_READY", "Valid canonical evidence must remain preparable.");
    assert.strictEqual(validCanonical.sourceLock.canonical.productId, "canonical-product-active");
    assert.deepStrictEqual(validCanonical.sourceLock.canonical.packageIds, ["canonical-package-active"]);

    const commercialPrimaryRegionChange = await generateSnapshotPlan(canonicalParityFixture({ mappingRegion: "TH", productionRole: "PRIMARY" }));
    assert.strictEqual(commercialPrimaryRegionChange.outcome, "REVIEW_REQUIRED", "Technical preparation must not migrate an existing commercial PRIMARY route across regions.");
    assert(commercialPrimaryRegionChange.blockers.includes("COMMERCIAL_ROUTE_REGION_CHANGE_REQUIRES_OWNER_REVIEW"));
    assert.strictEqual(commercialPrimaryRegionChange.proposedChanges, null);

    const deletedProduct = await generateSnapshotPlan(canonicalParityFixture({ productDeleted: true }));
    assert.strictEqual(deletedProduct.outcome, "MISSING_CANONICAL_LINK", "Deleted canonical product cannot become WOULD_PREPARE.");
    assert.strictEqual(deletedProduct.sourceLock.canonical.productId, "");
    assert.deepStrictEqual(deletedProduct.sourceLock.canonical.packageIds, ["canonical-package-active"]);
    assert(deletedProduct.blockers.includes("MISSING_CANONICAL_LINK"));

    const deletedPackage = await generateSnapshotPlan(canonicalParityFixture({ packageDeleted: true }));
    assert.strictEqual(deletedPackage.outcome, "MISSING_CANONICAL_LINK", "Deleted canonical package cannot become WOULD_PREPARE.");
    assert.strictEqual(deletedPackage.sourceLock.canonical.productId, "canonical-product-active");
    assert.deepStrictEqual(deletedPackage.sourceLock.canonical.packageIds, []);
    assert(deletedPackage.blockers.includes("MISSING_CANONICAL_LINK"));

    const productRemoved = await generateSnapshotPlan(canonicalParityFixture({ includeActiveProduct: false }));
    const packageRemoved = await generateSnapshotPlan(canonicalParityFixture({ includeActivePackage: false }));
    assert.strictEqual(productRemoved.sourceLock.canonical.productId, "", "Missing canonical product is represented identically to authoritative replay.");
    assert.deepStrictEqual(packageRemoved.sourceLock.canonical.packageIds, [], "Missing canonical package is represented identically to authoritative replay.");
    assert.strictEqual(supplierMarketCompatibility("INDIA", "TH").compatible, false, "Unsupported supplier country markets must not imply AZIEL customer-market eligibility.");
    assert.strictEqual(supplierMarketCompatibility("IN", "MM").compatible, false, "Normalized unsupported supplier country markets must fail closed.");
    assert.deepStrictEqual(customerMarketsFor({ supplierMarketCode: "INDIA", customerMarket: "", fulfillmentEligibility: { allowedCustomerMarkets: [] } }), [], "Unsupported supplier markets cannot become preparation targets.");
    assert.strictEqual(normalizeSupplierMarket("SINGAPORE_MALAYSIA"), "MY_SG");
    assert.strictEqual(normalizeSupplierMarket("MALAYSIA_SINGAPORE"), "MY_SG");
    assert.strictEqual(normalizeSupplierMarket("TAIWAN_HONG_KONG_MACAU"), "TW_HK_MO");

    const validObjectIds = {
        mappingId: String(new mongoose.Types.ObjectId()),
        supplierId: String(new mongoose.Types.ObjectId()),
        offerId: String(new mongoose.Types.ObjectId())
    };
    const persistencePlan = plan(validObjectIds.mappingId, { supplierId: validObjectIds.supplierId, offerId: validObjectIds.offerId });
    const originalFindById = SupplierProductMapping.findById;
    SupplierProductMapping.findById = () => ({
        lean: async () => ({
            _id: validObjectIds.mappingId,
            supplierId: validObjectIds.supplierId,
            supplierCode: "FAZERCARDS",
            productCode: "afk_journey",
            packageCode: "PKG_SCHEMA",
            supplierProductCode: "afk_journey",
            supplierPackageCode: "126_dragon_crystals",
            supplierCatalogOfferId: validObjectIds.offerId,
            supplierDisplayName: "FazerCards",
            region: "GLOBAL",
            supplierMarketEvidence: { normalizedMarket: "GLOBAL", supplierMarketCode: "GLOBAL", marketClassification: "REVIEWED_SUPPLIER_MARKET" },
            enabled: false,
            productionRole: "DISABLED",
            executionMode: "MANUAL",
            fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", version: 1 },
            mappingMetadata: { readiness: persistencePlan.sourceLock.mapping.readiness },
            updatedAt: persistencePlan.sourceLock.mapping.updatedAt
        })
    });
    try {
        const dryRun = await validatePlanPersistenceContracts([persistencePlan], { username: "owner", role: "OWNER" }, { MappingModel: SupplierProductMapping, AuditModel: AdminAuditLog, clock: () => now });
        assert.strictEqual(dryRun.checked, 1);
        assert.strictEqual(dryRun.failures.length, 0, "Representative preparation update/audit must pass real Mongoose schema validation.");
    } finally {
        SupplierProductMapping.findById = originalFindById;
    }

    const first = plan("m1"), second = plan("m2"), stale = plan("m3");
    let generateCalls = 0;
    const staleDeps = memoryDeps([mappingFromPlan(first), mappingFromPlan(second), mappingFromPlan(stale)]);
    await assert.rejects(
        () => applyPlansAtomically([first, second, stale], { username: "owner", role: "OWNER" }, {
            ...staleDeps,
            generatePlan: async request => {
                generateCalls += 1;
                return request.mappingId === "m3" ? plan("m3", { updatedAt: new Date(now.getTime() + 1) }) : { m1: first, m2: second }[request.mappingId];
            }
        }),
        error => error.code === "BULK_PREPARATION_PREFLIGHT_STALE" && error.details.staleCount === 1
    );
    assert.strictEqual(staleDeps.state.sessionStarts, 0, "Stale global preflight must abort before transaction/write.");
    assert.strictEqual(staleDeps.state.audits.length, 0);
    assert.strictEqual(generateCalls, 3);

    const deps = memoryDeps([mappingFromPlan(first), mappingFromPlan(second)]);
    const result = await applyPlansAtomically([first, second], { username: "owner", role: "OWNER" }, { ...deps, generatePlan: async request => ({ m1: first, m2: second }[request.mappingId]) });
    assert.deepStrictEqual(result, { attempted: 2, applied: 2, auditRecords: 2 });
    assert.deepStrictEqual(deps.state.events.slice(0, 3), ["transaction:start", "mapping:bulkWrite:2", "audit:insertMany"]);
    assert.strictEqual(deps.state.audits.length, 2);
    assert.strictEqual(deps.state.mappings.get("m1").executionMode, "API");
    assert.strictEqual(deps.state.mappings.get("m2").fulfillmentEligibility.mode, "CUSTOMER_MARKET_ALLOWLIST");

    const auditFailDeps = memoryDeps([mappingFromPlan(first), mappingFromPlan(second)], { failAudit: true });
    await assert.rejects(
        () => applyPlansAtomically([first, second], { username: "owner", role: "OWNER" }, { ...auditFailDeps, generatePlan: async request => ({ m1: first, m2: second }[request.mappingId]) }),
        /AUDIT_WRITE_FAILED/
    );
    assert.strictEqual(auditFailDeps.state.mappings.get("m1").executionMode, "MANUAL", "Transaction failure must roll back mapping mutation.");
    assert.strictEqual(auditFailDeps.state.audits.length, 0, "Transaction failure must roll back audits.");

    const prepared = structuredClone(first);
    prepared.sourceLock.mapping.executionMode = "API";
    prepared.sourceLock.mapping.fulfillmentEligibility = { ...first.proposedChanges.fulfillmentEligibility, verifiedAt: now, version: 99 };
    prepared.sourceLock.mapping.readiness = { ...prepared.sourceLock.mapping.readiness, inputReady: true, validationReady: true, fulfillmentReady: true };
    prepared.sourceLock.runtime.contractFingerprint = first.proposedChanges.fulfillmentContract.fingerprint;
    assert.strictEqual(hasEffectiveTechnicalDelta(prepared), false, "Existing ready mappings must be no-op and avoid duplicate audit/version churn.");
    assert(sourceLockDiff(first.sourceLock, plan("m1", { updatedAt: new Date(now.getTime() + 1) }).sourceLock).some(item => item.path === "mapping.updatedAt"));
    assert.strictEqual(supplierCalls, 0);
    console.log(JSON.stringify({
        result: "PASS",
        canonicalPlannerReplayParity: true,
        missingCanonicalProductBlocksPreparation: true,
        missingCanonicalPackageBlocksPreparation: true,
        deletedCanonicalEvidenceBlocksPreparation: true,
        validCanonicalEvidenceRemainsPreparable: true,
        unsupportedSupplierCountryMarketsBlocked: true,
        compositeSupplierMarketsNormalizeToSchemaEnums: true,
        mongoosePersistenceDryRun: true,
        stalePlanItem53ZeroWrites: true,
        selfInducedPreparationDoesNotInvalidateLaterPlans: true,
        transactionRollback: true,
        existingReadyNoop: true,
        duplicateAuditsPreventedByNoopPlanning: true,
        supplierCalls
    }, null, 2));
})().catch(error => {
    console.error("VERIFY_LINKED_SUPPLIER_ROUTE_PREPARATION_BULK_FAILED:", error);
    process.exitCode = 1;
});
