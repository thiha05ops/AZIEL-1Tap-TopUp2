#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const readService = require("../services/adminSupplierCatalogReadService");
const { createSupplierRoutePreparationService, generateSupplierRoutePreparationPlan, ACTION, isActiveCanonicalRecord } = require("../services/supplierCatalog/supplierRoutePreparationService");
const { supplierMarketCompatibility } = require("../services/supplierFulfillmentEligibilityService");
const { normalizeSupplierMarket } = require("../constants/supplierMarkets");
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const PricingQuote = require("../models/PricingQuote");
const CommerceOrder = require("../models/CommerceOrder");
const PaymentAttempt = require("../models/PaymentAttempt");
const ManualPaymentAttempt = require("../models/ManualPaymentAttempt");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const PackageInventoryState = require("../models/PackageInventoryState");
const AdminAuditLog = require("../models/AdminAuditLog");

const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.argv.includes("--confirm-linked-offer-technical-preparation");
const EXPECTED_PRODUCTS = Number(process.env.LINKED_ROUTE_PREPARATION_EXPECTED_PRODUCTS || 131);
const EXPECTED_LINKED_OFFERS = Number(process.env.LINKED_ROUTE_PREPARATION_EXPECTED_LINKED_OFFERS || 1802);
const CUSTOMER_MARKETS = Object.freeze(["MM", "TH"]);
const sha = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
const id = value => String(value?._id || value || "").trim();
const upper = value => String(value == null ? "" : value).trim().toUpperCase();
const sameSet = (a = [], b = []) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const PLAN_CONCURRENCY = Math.max(1, Math.min(50, Number(process.env.LINKED_ROUTE_PREPARATION_PLAN_CONCURRENCY || 20)));

const protectedModels = Object.freeze({
    StoreCatalogSelection,
    PackageMarketPublication,
    CatalogProduct,
    CatalogPackage,
    PricingQuote,
    CommerceOrder,
    PaymentAttempt,
    ManualPaymentAttempt,
    FulfillmentAttempt,
    PackageInventoryState
});

async function fingerprint(Model) {
    const rows = await Model.find({}).sort({ _id: 1 }).lean();
    return { count: rows.length, sha256: sha(rows) };
}

async function protectedFingerprints() {
    return Object.fromEntries(await Promise.all(Object.entries(protectedModels).map(async ([name, Model]) => [name, await fingerprint(Model)])));
}

async function mappingCommercialFingerprint() {
    const rows = await SupplierProductMapping.find({}).sort({ _id: 1 }).lean();
    return {
        count: rows.length,
        sha256: sha(rows.map(mapping => ({
            _id: id(mapping),
            enabled: mapping.enabled === true,
            productionRole: upper(mapping.productionRole),
            productCode: mapping.productCode,
            packageCode: mapping.packageCode,
            supplierId: id(mapping.supplierId),
            supplierCode: upper(mapping.supplierCode),
            supplierCostAuthority: mapping.supplierCostAuthority || null,
            archivedAt: mapping.archivedAt || null
        })))
    };
}

function customerMarketsFor(row) {
    const compatible = CUSTOMER_MARKETS.filter(market => supplierMarketCompatibility(row.supplierMarketCode, market).compatible);
    if (compatible.length) return compatible.sort();
    const mappingMarket = upper(row.customerMarket);
    if (CUSTOMER_MARKETS.includes(mappingMarket)) return [mappingMarket];
    const allowed = row.fulfillmentEligibility?.allowedCustomerMarkets || [];
    return allowed.map(upper).filter(market => CUSTOMER_MARKETS.includes(market)).sort();
}

function hasEffectiveTechnicalDelta(plan) {
    const proposed = plan?.proposedChanges;
    const source = plan?.sourceLock?.mapping || {};
    if (!proposed) return false;
    if (upper(source.supplierMarket) !== upper(proposed.region)) return true;
    if (id(source.supplierCatalogOfferId) !== id(proposed.supplierCatalogOfferId)) return true;
    if (String(source.supplierProductCode || "") !== String(proposed.supplierProductCode || "")) return true;
    if (String(source.supplierPackageCode || "") !== String(proposed.supplierPackageCode || "")) return true;
    if (upper(source.executionMode) !== "API") return true;
    const eligibility = source.fulfillmentEligibility || {};
    if (upper(eligibility.mode) !== upper(proposed.fulfillmentEligibility?.mode)) return true;
    if (!sameSet(eligibility.allowedCustomerMarkets || [], proposed.fulfillmentEligibility?.allowedCustomerMarkets || [])) return true;
    if (upper(eligibility.evidenceCode) !== upper(proposed.fulfillmentEligibility?.evidenceCode)) return true;
    if (String(eligibility.evidenceSource || "") !== String(proposed.fulfillmentEligibility?.evidenceSource || "")) return true;
    const readiness = source.readiness || {};
    for (const key of ["inputReady", "validationReady", "fulfillmentReady"]) {
        if (readiness[key] !== true && proposed.readiness?.[key] === true) return true;
    }
    if (String(plan.sourceLock?.runtime?.contractFingerprint || "") !== String(proposed.fulfillmentContract?.fingerprint || "")) return true;
    return false;
}

async function buildPlanSet() {
    const data = await readService.load();
    const projection = readService.project(data);
    const target = readService.linkedOfferLaunchTarget(projection);
    const service = createSnapshotPreparationService(data);
    return buildPlanSetFromTarget({ target, service });
}

function createSnapshotPreparationService(data = {}, options = {}) {
    const supplierById = new Map((data.suppliers || []).map(row => [id(row), row]));
    const offerById = new Map((data.offers || []).map(row => [id(row), row]));
    const productById = new Map((data.products || []).map(row => [id(row), row]));
    const availabilityByOffer = new Map((data.availability || []).map(row => [id(row.supplierCatalogOfferId), row]));
    const canonicalProductByCode = new Map((data.catalogProducts || []).filter(isActiveCanonicalRecord).map(row => [row.productCode, row]));
    const canonicalPackageByKey = new Map((data.catalogPackages || []).filter(isActiveCanonicalRecord).map(row => [`${row.productCode}/${row.packageCode}`, row]));
    return createSupplierRoutePreparationService({
        repos: {
            transaction: async fn => fn(null),
            mappingById: async value => data.mappings.find(row => id(row) === id(value)) || null,
            supplierById: async value => supplierById.get(id(value)) || null,
            offerById: async value => offerById.get(id(value)) || null,
            productById: async value => productById.get(id(value)) || null,
            availabilityByOffer: async value => availabilityByOffer.get(id(value)) || null,
            canonicalProduct: async value => canonicalProductByCode.get(value) || null,
            canonicalPackages: async (productCode, packageCode) => {
                const exact = canonicalPackageByKey.get(`${productCode}/${packageCode}`);
                return exact ? [exact] : [];
            },
            auditByPlanHash: async () => null,
            updateMapping: async () => { throw new Error("in-memory planner must not write mappings"); },
            createAudit: async () => { throw new Error("in-memory planner must not write audits"); }
        },
        ...options
    });
}

async function buildPlanSetFromTarget({ target, service }) {
    const plans = [];
    const blocked = [];
    const skipped = [];
    assert.strictEqual(target.authority, "ADMIN_SUPPLIER_CATALOG_LINKED_OFFER_PROJECTION");
    assert.strictEqual(target.supplierProductCount, EXPECTED_PRODUCTS, "Locked supplier-product target drifted.");
    assert.strictEqual(target.linkedOfferCount, EXPECTED_LINKED_OFFERS, "Locked linked-offer target drifted.");
    let cursor = 0;
    async function worker() {
        for (;;) {
            const index = cursor++;
            if (index >= target.offers.length) return;
            const row = target.offers[index];
        const customerMarkets = customerMarketsFor(row);
        if (!customerMarkets.length) {
            blocked.push({ mappingId: row.mappingId, supplierCode: row.supplierCode, supplierProductCode: row.supplierProductCode, supplierOfferCode: row.supplierOfferCode, supplierMarket: row.supplierMarketCode, blockers: ["CUSTOMER_MARKET_UNRESOLVED"] });
            continue;
        }
        const plan = await service.generatePlan({ mappingId: row.mappingId, customerMarkets });
        if (plan.outcome !== "FULFILLMENT_READY") {
            blocked.push({ mappingId: row.mappingId, supplierCode: row.supplierCode, supplierProductCode: row.supplierProductCode, supplierOfferCode: row.supplierOfferCode, supplierMarket: plan.evidence?.supplierMarket || row.supplierMarketCode, outcome: plan.outcome, blockers: plan.blockers || [] });
            continue;
        }
        if (!hasEffectiveTechnicalDelta(plan)) {
            skipped.push({ mappingId: row.mappingId, supplierCode: row.supplierCode, supplierProductCode: row.supplierProductCode, supplierOfferCode: row.supplierOfferCode, reason: "ALREADY_TECHNICALLY_PREPARED" });
            continue;
        }
        plans.push(plan);
        }
    }
    await Promise.all(Array.from({ length: PLAN_CONCURRENCY }, () => worker()));
    return { target, plans, blocked, skipped };
}

function supplierBreakdown(items) {
    return items.reduce((out, item) => {
        const supplier = upper(item.supplierCode || item.evidence?.supplierCode || "UNKNOWN");
        out[supplier] = (out[supplier] || 0) + 1;
        return out;
    }, {});
}

function productKeyFor(item) {
    return `${upper(item.supplierCode || item.evidence?.supplierCode || "UNKNOWN")}/${item.supplierProductCode || item.evidence?.supplierProductCode || ""}`;
}

function blockerGroups(items = []) {
    return items.reduce((out, item) => {
        const key = (item.blockers || ["UNKNOWN"]).join("|");
        out[key] = (out[key] || 0) + 1;
        return out;
    }, {});
}

function canonicalBlockerCount(items = []) {
    return items.filter(item => (item.blockers || []).includes("MISSING_CANONICAL_LINK") || (item.blockers || []).includes("AMBIGUOUS_CANONICAL_IDENTITY")).length;
}

function unsupportedMarketBreakdown(items = []) {
    return items
        .filter(item => (item.blockers || []).some(code => ["CUSTOMER_MARKET_UNRESOLVED", "MARKET_UNRESOLVED", "CUSTOMER_MARKET_ELIGIBILITY_UNPROVEN"].includes(code)))
        .reduce((out, item) => {
            const key = normalizeSupplierMarket(item.supplierMarket) || upper(item.supplierMarket || "UNRESOLVED") || "UNRESOLVED";
            out[key] = (out[key] || 0) + 1;
            return out;
        }, {});
}

function technicalUpdateForPlan(plan, now, actor, currentMetadata = {}) {
    return {
        region: plan.proposedChanges.region,
        supplierCatalogOfferId: plan.proposedChanges.supplierCatalogOfferId,
        supplierProductCode: plan.proposedChanges.supplierProductCode,
        supplierPackageCode: plan.proposedChanges.supplierPackageCode,
        executionMode: "API",
        supplierMarketEvidence: plan.proposedChanges.supplierMarketEvidence,
        fulfillmentEligibility: { ...plan.proposedChanges.fulfillmentEligibility, verifiedAt: now },
        mappingMetadata: {
            ...currentMetadata,
            fulfillmentContract: plan.proposedChanges.fulfillmentContract,
            readiness: { ...(currentMetadata.readiness || {}), ...plan.proposedChanges.readiness },
            technicalPreparation: {
                authority: ACTION,
                planHash: plan.planHash,
                sourceLockHash: plan.sourceLockHash,
                reviewedCustomerMarkets: plan.request.customerMarkets,
                protocol: plan.evidence.protocol,
                preparedAt: now,
                preparedBy: actor.username
            }
        }
    };
}

function auditDocumentForPlan(plan, actor) {
    return {
        actorAdminId: actor.id || actor._id || null,
        actorUsernameSnapshot: actor.username,
        actorRoleSnapshot: "OWNER",
        action: ACTION,
        resourceType: "SupplierProductMapping",
        resourceId: plan.request.mappingId,
        metadata: {
            planHash: plan.planHash,
            sourceLockHash: plan.sourceLockHash,
            customerMarkets: plan.request.customerMarkets,
            supplierCode: plan.evidence.supplierCode,
            supplierProductCode: plan.evidence.supplierProductCode,
            supplierOfferCode: plan.evidence.supplierOfferCode,
            canonicalProductCode: plan.evidence.canonicalProductCode,
            canonicalPackageCode: plan.evidence.canonicalPackageCode,
            before: {
                enabled: plan.sourceLock.mapping.enabled,
                productionRole: plan.sourceLock.mapping.productionRole,
                executionMode: plan.sourceLock.mapping.executionMode,
                region: plan.sourceLock.mapping.supplierMarket,
                supplierCatalogOfferId: plan.sourceLock.mapping.supplierCatalogOfferId
            },
            mutations: ["region", "supplierCatalogOfferId", "supplierProductCode", "supplierPackageCode", "executionMode", "supplierMarketEvidence", "fulfillmentEligibility", "mappingMetadata.fulfillmentContract", "mappingMetadata.readiness"]
        }
    };
}

function validationFailure(kind, plan, error, extra = {}) {
    return {
        kind,
        mappingId: plan.request?.mappingId || "",
        supplierCode: plan.evidence?.supplierCode || "",
        supplierProductCode: plan.evidence?.supplierProductCode || "",
        supplierOfferCode: plan.evidence?.supplierOfferCode || "",
        message: error?.message || String(error || "Validation failed."),
        paths: error?.errors ? Object.keys(error.errors).sort() : [],
        ...extra
    };
}

function classifyValidationFailures(failures = []) {
    return failures.reduce((out, item) => {
        const message = String(item.message || "");
        const paths = item.paths || [];
        if (item.kind === "SOURCE_LOCK") out.sourceLockFailures += 1;
        else if (item.kind === "MAPPING_SCHEMA") out.mappingSchemaValidationFailures += 1;
        else if (item.kind === "AUDIT_SCHEMA") out.auditValidationFailures += 1;
        else if (item.kind === "MAPPING_UNIQUE_INDEX") out.uniqueIndexValidationFailures += 1;
        else if (item.kind === "MARKET_DOMAIN") out.marketDomainValidationFailures += 1;
        else if (/Cast to|CastError|ObjectId/i.test(message)) out.castTypeValidationFailures += 1;
        else if (paths.some(pathName => /market|region|eligibility/i.test(pathName))) out.marketDomainValidationFailures += 1;
        else out.otherPreWriteFailures += 1;
        return out;
    }, {
        sourceLockFailures: 0,
        mappingSchemaValidationFailures: 0,
        auditValidationFailures: 0,
        uniqueIndexValidationFailures: 0,
        marketDomainValidationFailures: 0,
        castTypeValidationFailures: 0,
        otherPreWriteFailures: 0
    });
}

function mappingUniqueIdentity(row = {}) {
    return [
        id(row.supplierId),
        String(row.supplierProductCode || ""),
        String(row.supplierPackageCode || ""),
        upper(row.region)
    ].join("::");
}

function primaryRouteIdentity(row = {}) {
    return [
        String(row.productCode || "").toLowerCase(),
        upper(row.packageCode),
        upper(row.region)
    ].join("::");
}

async function validateMappingUniqueIndexContracts(candidates = [], MappingModel = SupplierProductMapping) {
    const failures = [];
    const candidateOfferKeys = new Map();
    const candidatePrimaryKeys = new Map();
    for (const item of candidates) {
        const offerKey = mappingUniqueIdentity(item.candidate);
        const priorOfferPlan = candidateOfferKeys.get(offerKey);
        if (priorOfferPlan && priorOfferPlan.request.mappingId !== item.plan.request.mappingId) {
            failures.push(validationFailure("MAPPING_UNIQUE_INDEX", item.plan, new Error("Prepared supplier offer identity would duplicate another plan in this batch."), { indexName: "one_supplier_offer_mapping_per_market", duplicateWithMappingId: priorOfferPlan.request.mappingId }));
        }
        candidateOfferKeys.set(offerKey, item.plan);
        if (upper(item.candidate.productionRole) === "PRIMARY") {
            const primaryKey = primaryRouteIdentity(item.candidate);
            const priorPrimaryPlan = candidatePrimaryKeys.get(primaryKey);
            if (priorPrimaryPlan && priorPrimaryPlan.request.mappingId !== item.plan.request.mappingId) {
                failures.push(validationFailure("MAPPING_UNIQUE_INDEX", item.plan, new Error("Prepared PRIMARY route identity would duplicate another plan in this batch."), { indexName: "one_primary_supplier_per_package_region", duplicateWithMappingId: priorPrimaryPlan.request.mappingId }));
            }
            candidatePrimaryKeys.set(primaryKey, item.plan);
        }
    }
    const connectionReady = MappingModel?.collection?.conn?.readyState === 1 || MappingModel?.db?.readyState === 1;
    if (!connectionReady || typeof MappingModel.find !== "function") return failures;
    const rows = await MappingModel.find({}).select("_id supplierId supplierProductCode supplierPackageCode productCode packageCode region productionRole").lean();
    const rowsByOfferKey = new Map();
    const rowsByPrimaryKey = new Map();
    for (const row of rows) {
        rowsByOfferKey.set(mappingUniqueIdentity(row), row);
        if (upper(row.productionRole) === "PRIMARY") rowsByPrimaryKey.set(primaryRouteIdentity(row), row);
    }
    for (const item of candidates) {
        const existingOffer = rowsByOfferKey.get(mappingUniqueIdentity(item.candidate));
        if (existingOffer && id(existingOffer) !== item.plan.request.mappingId) {
            failures.push(validationFailure("MAPPING_UNIQUE_INDEX", item.plan, new Error("Prepared supplier offer identity would collide with an existing mapping."), { indexName: "one_supplier_offer_mapping_per_market", duplicateWithMappingId: id(existingOffer) }));
        }
        if (upper(item.candidate.productionRole) === "PRIMARY") {
            const existingPrimary = rowsByPrimaryKey.get(primaryRouteIdentity(item.candidate));
            if (existingPrimary && id(existingPrimary) !== item.plan.request.mappingId) {
                failures.push(validationFailure("MAPPING_UNIQUE_INDEX", item.plan, new Error("Prepared PRIMARY route identity would collide with an existing PRIMARY mapping."), { indexName: "one_primary_supplier_per_package_region", duplicateWithMappingId: id(existingPrimary) }));
            }
        }
    }
    return failures;
}

async function validatePlanPersistenceContracts(plans, actor, {
    MappingModel = SupplierProductMapping,
    AuditModel = AdminAuditLog,
    clock = () => new Date()
} = {}) {
    if (typeof MappingModel !== "function" || typeof AuditModel !== "function") {
        return { checked: plans.length, failures: [], summary: classifyValidationFailures([]), skipped: "NON_MONGOOSE_MODEL_TEST_DOUBLE" };
    }
    const failures = [];
    const permittedUpdateKeys = [
        "region",
        "supplierCatalogOfferId",
        "supplierProductCode",
        "supplierPackageCode",
        "executionMode",
        "supplierMarketEvidence",
        "fulfillmentEligibility",
        "mappingMetadata"
    ].sort();
    const candidates = [];
    for (const plan of plans) {
        if (plan.outcome !== "FULFILLMENT_READY" || !plan.proposedChanges) {
            failures.push(validationFailure("OTHER", plan, new Error("Only FULFILLMENT_READY plans can enter persistence validation.")));
            continue;
        }
        const query = MappingModel.findById(plan.request.mappingId);
        const mapping = await (typeof query.lean === "function" ? query.lean() : query.session(null).lean());
        if (!mapping) {
            failures.push(validationFailure("SOURCE_LOCK", plan, new Error("Mapping disappeared before persistence validation.")));
            continue;
        }
        if (String(new Date(mapping.updatedAt).toISOString()) !== String(new Date(plan.sourceLock.mapping.updatedAt).toISOString())) {
            failures.push(validationFailure("SOURCE_LOCK", plan, new Error("Mapping updatedAt changed before persistence validation.")));
            continue;
        }
        const update = technicalUpdateForPlan(plan, clock(), actor, mapping.mappingMetadata || {});
        const updateKeys = Object.keys(update).sort();
        if (JSON.stringify(updateKeys) !== JSON.stringify(permittedUpdateKeys)) {
            failures.push(validationFailure("OTHER", plan, new Error("Technical-preparation update contains unexpected fields."), { updateKeys }));
            continue;
        }
        const candidate = new MappingModel({ ...mapping, ...update });
        const mappingError = candidate.validateSync();
        if (mappingError) failures.push(validationFailure("MAPPING_SCHEMA", plan, mappingError));
        else candidates.push({ plan, candidate: candidate.toObject ? candidate.toObject() : { ...mapping, ...update } });
        const audit = new AuditModel(auditDocumentForPlan(plan, actor));
        const auditError = audit.validateSync();
        if (auditError) failures.push(validationFailure("AUDIT_SCHEMA", plan, auditError));
    }
    failures.push(...await validateMappingUniqueIndexContracts(candidates, MappingModel));
    return { checked: plans.length, failures, summary: classifyValidationFailures(failures) };
}

async function loadMappingsForPlans(plans, MappingModel = SupplierProductMapping) {
    const ids = plans.map(plan => plan.request.mappingId);
    const rows = await MappingModel.find({ _id: { $in: ids } }).lean();
    return new Map(rows.map(row => [id(row), row]));
}

function assertPlanStillMatchesMapping(plan, mapping) {
    const body = { ...plan };
    delete body.planHash;
    delete body.sourceLockHash;
    if (!mapping || sha(body) !== plan.planHash || String(new Date(mapping.updatedAt).toISOString()) !== String(new Date(plan.sourceLock.mapping.updatedAt).toISOString())) {
        const error = new Error("A supplier mapping changed during bulk technical preparation.");
        error.code = "BULK_PREPARATION_SOURCE_STALE";
        error.details = { mappingId: plan.request.mappingId };
        throw error;
    }
}

function sourceLockDiff(oldLock = {}, freshLock = {}) {
    const diffs = [];
    const visit = (pathName, a, b) => {
        if (JSON.stringify(a) === JSON.stringify(b)) return;
        if (a instanceof Date || b instanceof Date) {
            diffs.push({ path: pathName, expected: a instanceof Date ? a.toISOString() : a ?? null, actual: b instanceof Date ? b.toISOString() : b ?? null });
            return;
        }
        if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
            for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) visit(pathName ? `${pathName}.${key}` : key, a[key], b[key]);
            return;
        }
        diffs.push({ path: pathName, expected: a ?? null, actual: b ?? null });
    };
    visit("", oldLock, freshLock);
    return diffs.slice(0, 20);
}

async function validateAllPlansBeforeFirstWrite(plans, { generatePlan = generateSupplierRoutePreparationPlan } = {}) {
    const stale = await collectStalePlanReplays(plans, { generatePlan });
    if (stale.length) {
        const error = new Error("One or more supplier-route preparation plans changed before bulk apply.");
        error.code = "BULK_PREPARATION_PREFLIGHT_STALE";
        error.details = { staleCount: stale.length, stale: stale.slice(0, 25) };
        throw error;
    }
}

async function collectStalePlanReplays(plans, { generatePlan = generateSupplierRoutePreparationPlan, concurrency = PLAN_CONCURRENCY } = {}) {
    const stale = [];
    let cursor = 0;
    async function worker() {
        for (;;) {
            const index = cursor++;
            if (index >= plans.length) return;
            const plan = plans[index];
            const fresh = await generatePlan(plan.request);
            if (fresh.planHash !== plan.planHash || fresh.sourceLockHash !== plan.sourceLockHash) {
                stale.push({
                    mappingId: plan.request.mappingId,
                    supplierCode: plan.evidence?.supplierCode || "",
                    supplierProductCode: plan.evidence?.supplierProductCode || "",
                    supplierOfferCode: plan.evidence?.supplierOfferCode || "",
                    sourceLockHash: plan.sourceLockHash,
                    freshSourceLockHash: fresh.sourceLockHash,
                    planHash: plan.planHash,
                    freshPlanHash: fresh.planHash,
                    sourceDiff: sourceLockDiff(plan.sourceLock, fresh.sourceLock)
                });
            }
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(Number(concurrency) || 1, plans.length || 1)) }, () => worker()));
    return stale;
}

async function applyPlansAtomically(plans, actor, { generatePlan = generateSupplierRoutePreparationPlan, MappingModel = SupplierProductMapping, AuditModel = AdminAuditLog, connection = mongoose, afterMappingBulkWrite = null } = {}) {
    if (!plans.length) return { attempted: 0, applied: 0, auditRecords: 0 };
    await validateAllPlansBeforeFirstWrite(plans, { generatePlan });
    const dryRun = await validatePlanPersistenceContracts(plans, actor, { MappingModel, AuditModel });
    if (dryRun.failures.length) {
        const error = new Error("One or more supplier-route preparation plans failed persistence validation before bulk apply.");
        error.code = "BULK_PREPARATION_PERSISTENCE_INVALID";
        error.details = { checked: dryRun.checked, ...dryRun.summary, failures: dryRun.failures.slice(0, 25) };
        throw error;
    }
    const mappingsById = await loadMappingsForPlans(plans, MappingModel);
    if (mappingsById.size !== plans.length) {
        const error = new Error("One or more supplier mappings disappeared before bulk technical preparation.");
        error.code = "BULK_PREPARATION_SOURCE_STALE";
        error.details = { expected: plans.length, actual: mappingsById.size };
        throw error;
    }
    const now = new Date();
    const mappingOps = plans.map(plan => {
        const mapping = mappingsById.get(plan.request.mappingId);
        assertPlanStillMatchesMapping(plan, mapping);
        return {
            updateOne: {
                filter: { _id: plan.request.mappingId, updatedAt: new Date(plan.sourceLock.mapping.updatedAt) },
                update: { $set: technicalUpdateForPlan(plan, now, actor, mapping.mappingMetadata || {}) },
                runValidators: true
            }
        };
    });
    const auditDocs = plans.map(plan => auditDocumentForPlan(plan, actor));
    const session = await connection.startSession();
    try {
        await session.withTransaction(async () => {
            let write;
            try {
                write = await MappingModel.bulkWrite(mappingOps, { session, ordered: true });
            } catch (error) {
                error.code = error.code || "BULK_PREPARATION_MAPPING_BULK_WRITE_FAILED";
                error.details = { phase: "mappingBulkWrite", message: error.message, codeName: error.codeName, errorLabels: error.errorLabels, writeErrors: error.writeErrors };
                throw error;
            }
            if (write.matchedCount !== plans.length) {
                const error = new Error("A supplier mapping changed during bulk technical preparation.");
                error.code = "BULK_PREPARATION_SOURCE_STALE";
                error.details = { phase: "mappingBulkWrite", expectedMatched: plans.length, actualMatched: write.matchedCount };
                throw error;
            }
            if (typeof afterMappingBulkWrite === "function") await afterMappingBulkWrite({ session, write });
            try {
                if (auditDocs.length) await AuditModel.insertMany(auditDocs, { session, ordered: true });
            } catch (error) {
                error.code = error.code || "BULK_PREPARATION_AUDIT_INSERT_FAILED";
                error.details = { phase: "auditInsertMany", message: error.message, codeName: error.codeName, errorLabels: error.errorLabels, writeErrors: error.writeErrors };
                throw error;
            }
        });
    } catch (error) {
        if (!error.details) error.details = { phase: "transaction", codeName: error.codeName, errorLabels: error.errorLabels, writeErrors: error.writeErrors, writeConcernError: error.writeConcernError };
        throw error;
    } finally {
        await session.endSession();
    }
    return { attempted: plans.length, applied: plans.length, auditRecords: auditDocs.length };
}

async function main() {
    assert(process.env.MONGO_URI, "MONGO_URI is required.");
    if (APPLY) assert(CONFIRMED, "--apply requires --confirm-linked-offer-technical-preparation.");
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000) });
    const preProtected = await protectedFingerprints();
    const preCommercialMapping = await mappingCommercialFingerprint();
    const planSet = await buildPlanSet();
    const planHash = sha(planSet.plans.map(plan => ({ mappingId: plan.request.mappingId, planHash: plan.planHash, sourceLockHash: plan.sourceLockHash })).sort((a, b) => a.mappingId.localeCompare(b.mappingId)));
    const globalPreflightStale = await collectStalePlanReplays(planSet.plans);
    if (globalPreflightStale.length) {
        const error = new Error("One or more supplier-route preparation plans changed before bulk apply.");
        error.code = "BULK_PREPARATION_PREFLIGHT_STALE";
        error.details = { staleCount: globalPreflightStale.length, stale: globalPreflightStale.slice(0, 25) };
        throw error;
    }
    const actor = { id: null, username: "owner-production-linked-route-preparation", role: "OWNER" };
    const persistenceDryRun = await validatePlanPersistenceContracts(planSet.plans, actor);
    if (persistenceDryRun.failures.length) {
        const error = new Error("One or more supplier-route preparation plans failed persistence validation before bulk apply.");
        error.code = "BULK_PREPARATION_PERSISTENCE_INVALID";
        error.details = { checked: persistenceDryRun.checked, ...persistenceDryRun.summary, failures: persistenceDryRun.failures.slice(0, 25) };
        throw error;
    }
    let applyResult = { attempted: 0, applied: 0, auditRecords: 0 };
    if (APPLY) {
        applyResult = await applyPlansAtomically(planSet.plans, actor);
    }
    const postProtected = await protectedFingerprints();
    const postCommercialMapping = await mappingCommercialFingerprint();
    assert.deepStrictEqual(postProtected, preProtected, "Protected business authority changed.");
    assert.deepStrictEqual(postCommercialMapping, preCommercialMapping, "Mapping commercial fields changed.");
    const postPlanSet = await buildPlanSet();
    const readyAfter = postPlanSet.skipped.length;
    const wouldPrepareAfter = postPlanSet.plans.length;
    const blockedAfter = postPlanSet.blocked.length;
    const readyProducts = new Set(postPlanSet.skipped.map(productKeyFor));
    const readyOrPreparableProducts = new Set([...postPlanSet.skipped, ...postPlanSet.plans].map(productKeyFor));
    const allProducts = new Set(planSet.target.offers.map(productKeyFor));
    const zeroReadyProducts = [...allProducts].filter(key => !readyProducts.has(key)).sort();
    const zeroReadyOrPreparableProducts = [...allProducts].filter(key => !readyOrPreparableProducts.has(key)).sort();
    console.log(JSON.stringify({
        result: "PASS",
        mode: APPLY ? "CONTROLLED_PRODUCTION_APPLY" : "READ_ONLY_PLAN",
        lockedTarget: { supplierProducts: planSet.target.supplierProductCount, linkedOffers: planSet.target.linkedOfferCount, authority: planSet.target.authority },
        planConcurrency: PLAN_CONCURRENCY,
        before: { ready: planSet.skipped.length, wouldPrepare: planSet.plans.length, blocked: planSet.blocked.length, canonicalRelatedBlocked: canonicalBlockerCount(planSet.blocked), blockerGroups: blockerGroups(planSet.blocked), unsupportedMarketBreakdown: unsupportedMarketBreakdown(planSet.blocked), bySupplier: { ready: supplierBreakdown(planSet.skipped), wouldPrepare: supplierBreakdown(planSet.plans), blocked: supplierBreakdown(planSet.blocked) } },
        globalPreflightReplay: { checked: planSet.plans.length, staleCount: globalPreflightStale.length, passed: globalPreflightStale.length === 0 },
        persistenceDryRun: { checked: persistenceDryRun.checked, ...persistenceDryRun.summary, passed: persistenceDryRun.failures.length === 0 },
        apply: { requested: APPLY, confirmed: CONFIRMED, attempted: applyResult.attempted, applied: applyResult.applied, auditRecords: applyResult.auditRecords, planHash },
        after: { ready: readyAfter, wouldPrepare: wouldPrepareAfter, blocked: blockedAfter, canonicalRelatedBlocked: canonicalBlockerCount(postPlanSet.blocked), unsupportedMarketBreakdown: unsupportedMarketBreakdown(postPlanSet.blocked), productsWithAtLeastOneReadyPackage: readyProducts.size, productsWithAtLeastOneReadyOrPreparablePackage: readyOrPreparableProducts.size, productsWithZeroReadyPackages: zeroReadyProducts.length, productsWithZeroReadyOrPreparablePackages: zeroReadyOrPreparableProducts.length, zeroReadyProducts, zeroReadyOrPreparableProducts, bySupplier: { ready: supplierBreakdown(postPlanSet.skipped), wouldPrepare: supplierBreakdown(postPlanSet.plans), blocked: supplierBreakdown(postPlanSet.blocked) } },
        remainingBlockers: blockerGroups(postPlanSet.blocked),
        protectedBusinessAuthoritiesUnchanged: true,
        mappingCommercialAuthorityUnchanged: true,
        mutationBoundary: { SupplierProductMappingTechnicalPreparation: APPLY ? applyResult.applied : 0, AdminAuditLog: APPLY ? applyResult.auditRecords : 0 },
        safety: { supplierOrderCalls: 0, supplierValidationCalls: 0, realPayments: 0, productionOrderMutations: 0, pricingMutations: 0, publicationMutations: 0, storefrontMutations: 0, ingestionRuns: 0, automaticFailovers: 0 }
    }, null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(JSON.stringify({ result: "ABORTED", code: error.code || error.name, message: error.message, details: error.details || {} }, null, 2));
        process.exitCode = 1;
    }).finally(async () => mongoose.disconnect().catch(() => null));
}

module.exports = Object.freeze({
    customerMarketsFor,
    createSnapshotPreparationService,
    buildPlanSetFromTarget,
    hasEffectiveTechnicalDelta,
    sourceLockDiff,
    collectStalePlanReplays,
    validateAllPlansBeforeFirstWrite,
    validatePlanPersistenceContracts,
    loadMappingsForPlans,
    assertPlanStillMatchesMapping,
    applyPlansAtomically
});
