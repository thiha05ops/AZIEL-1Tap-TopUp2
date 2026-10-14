"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const AdminAccount = require("../../models/AdminAccount");
const AdminSession = require("../../models/AdminSession");
const AdminAuditLog = require("../../models/AdminAuditLog");
const CatalogProduct = require("../../models/CatalogProduct");
const CatalogPackage = require("../../models/CatalogPackage");
const CommerceOrder = require("../../models/CommerceOrder");
const PackageMarketPublication = require("../../models/PackageMarketPublication");
const PackageSupplierSelection = require("../../models/PackageSupplierSelection");
const SupplierCatalogOffer = require("../../models/SupplierCatalogOffer");
const SupplierCatalogProduct = require("../../models/SupplierCatalogProduct");
const SupplierCatalogReconciliationDecision = require("../../models/SupplierCatalogReconciliationDecision");
const SupplierOfferAvailability = require("../../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const { createAdminOwnerAuthorizationService } = require("../adminOwnerAuthorizationService");
const { canonicalJson } = require("./supplierCatalogNormalization");
const { sourceLock } = require("./supplierCatalogReconciliationService");

const CUTOVER = Object.freeze({
    operation: "GLOBAL_WEEKLY_PASS_CANONICAL_CUTOVER_V1",
    mappingId: "6a94f2b21c1d128fed462604",
    supplierCode: "FAZERCARDS",
    supplierProductCode: "mobile_legends_global",
    supplierPackageCode: "weekly_pass",
    oldProductCode: "mlbb-twilight-weekly-pass",
    oldPackageCode: "MLBB-WEEKLY.PASS",
    newProductCode: "mlbb",
    newPackageCode: "MLBB_WEEKLY_PASS_C8B28141817AC4E6",
    packageName: "Weekly Pass",
    expectedHistoricalOrderCount: 4,
    confirmation: "REASSIGN GLOBAL WEEKLY PASS TO MLBB",
    refreshOperation: "GLOBAL_WEEKLY_PASS_SOURCE_REAPPROVAL_V1",
    refreshConfirmation: "REAPPROVE CURRENT GLOBAL WEEKLY PASS EVIDENCE",
    reviewedCost: Object.freeze({ amount: 1.4911, currency: "USD" }),
    reviewedExcludedMarkets: Object.freeze(["ID", "MY", "PH", "RU", "SG"])
});

class GlobalWeeklyPassCutoverError extends Error {
    constructor(code, message, statusCode = 409, details = {}) {
        super(message);
        this.name = "GlobalWeeklyPassCutoverError";
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

const clean = value => String(value == null ? "" : value).trim();
const id = value => clean(value?._id || value);
const dateIso = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};
const sha256 = value => crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const hash64 = value => /^[a-f0-9]{64}$/.test(clean(value).toLowerCase());

function normalizePreconditions(input = {}) {
    const expected = input.expected || {};
    const result = {
        mappingUpdatedAt: dateIso(expected.mappingUpdatedAt),
        mappingVersion: Number(expected.mappingVersion),
        decisionId: clean(expected.decisionId),
        decisionVersion: Number(expected.decisionVersion),
        sourceOfferHash: clean(expected.sourceOfferHash).toLowerCase(),
        sourceOfferRevision: clean(expected.sourceOfferRevision),
        sourceLastChangedAt: dateIso(expected.sourceLastChangedAt),
        sourceSemanticHash: clean(expected.sourceSemanticHash).toLowerCase(),
        sourceProductEvidenceHash: clean(expected.sourceProductEvidenceHash).toLowerCase(),
        sourceCostHash: clean(expected.sourceCostHash).toLowerCase()
    };
    if (!result.mappingUpdatedAt || !Number.isInteger(result.mappingVersion) || result.mappingVersion < 0 || !mongoose.Types.ObjectId.isValid(result.decisionId) || !Number.isInteger(result.decisionVersion) || result.decisionVersion < 1 || !hash64(result.sourceOfferHash) || !result.sourceOfferRevision || !result.sourceLastChangedAt || !hash64(result.sourceSemanticHash) || !hash64(result.sourceProductEvidenceHash) || !hash64(result.sourceCostHash)) {
        throw new GlobalWeeklyPassCutoverError("CUTOVER_PRECONDITIONS_INVALID", "Exact mapping and reconciliation source preconditions are required.", 400);
    }
    return Object.freeze(result);
}

function manifestFor(expected) {
    return Object.freeze({
        schemaVersion: 1,
        operation: CUTOVER.operation,
        source: {
            mappingId: CUTOVER.mappingId,
            supplierCode: CUTOVER.supplierCode,
            supplierProductCode: CUTOVER.supplierProductCode,
            supplierPackageCode: CUTOVER.supplierPackageCode,
            productCode: CUTOVER.oldProductCode,
            packageCode: CUTOVER.oldPackageCode
        },
        target: { productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode, packageName: CUTOVER.packageName },
        expected
    });
}

function sourceEvidence(expected) {
    return Object.freeze({
        sourceOfferHash: expected.sourceOfferHash,
        sourceOfferRevision: expected.sourceOfferRevision,
        sourceLastChangedAt: expected.sourceLastChangedAt,
        sourceSemanticHash: expected.sourceSemanticHash,
        sourceProductEvidenceHash: expected.sourceProductEvidenceHash,
        sourceCostHash: expected.sourceCostHash
    });
}

function refreshManifestFor(expected, previousSource) {
    return Object.freeze({
        schemaVersion: 1,
        operation: CUTOVER.refreshOperation,
        mappingId: CUTOVER.mappingId,
        nativeIdentity: { supplierCode: CUTOVER.supplierCode, supplierProductCode: CUTOVER.supplierProductCode, supplierPackageCode: CUTOVER.supplierPackageCode },
        preservedCanonicalTarget: { productCode: CUTOVER.oldProductCode, packageCode: CUTOVER.oldPackageCode },
        reviewedCost: CUTOVER.reviewedCost,
        expected,
        previousSource
    });
}

function normalizePreviousSource(value = {}) {
    const normalized = {
        sourceOfferHash: clean(value.sourceOfferHash).toLowerCase(),
        sourceOfferRevision: clean(value.sourceOfferRevision),
        sourceLastChangedAt: dateIso(value.sourceLastChangedAt),
        sourceSemanticHash: clean(value.sourceSemanticHash).toLowerCase(),
        sourceProductEvidenceHash: clean(value.sourceProductEvidenceHash).toLowerCase(),
        sourceCostHash: clean(value.sourceCostHash).toLowerCase()
    };
    if (!hash64(normalized.sourceOfferHash) || !normalized.sourceOfferRevision || !normalized.sourceLastChangedAt || !hash64(normalized.sourceSemanticHash) || !hash64(normalized.sourceProductEvidenceHash) || !hash64(normalized.sourceCostHash)) throw new GlobalWeeklyPassCutoverError("REFRESH_PREVIOUS_SOURCE_INVALID", "Exact prior reconciliation source preconditions are required.", 400);
    return Object.freeze(normalized);
}

function assertExactDecision(decision, expected) {
    if (!decision || id(decision) !== expected.decisionId || decision.isCurrent !== true || decision.decisionStatus !== "APPROVED" || Number(decision.decisionVersion) !== expected.decisionVersion || id(decision.mappingId) !== CUTOVER.mappingId || clean(decision.canonicalProductCode).toLowerCase() !== CUTOVER.oldProductCode || clean(decision.canonicalPackageCode).toUpperCase() !== CUTOVER.oldPackageCode || clean(decision.sourceOfferHash).toLowerCase() !== expected.sourceOfferHash || clean(decision.sourceOfferRevision) !== expected.sourceOfferRevision || dateIso(decision.sourceLastChangedAt) !== expected.sourceLastChangedAt || clean(decision.sourceSemanticHash).toLowerCase() !== expected.sourceSemanticHash || clean(decision.sourceProductEvidenceHash).toLowerCase() !== expected.sourceProductEvidenceHash || clean(decision.sourceCostHash).toLowerCase() !== expected.sourceCostHash) {
        throw new GlobalWeeklyPassCutoverError("RECONCILIATION_PRECONDITION_CONFLICT", "The current reconciliation decision no longer matches the reviewed source authority.");
    }
}

function assertExactSource(mapping, offer, expected) {
    if (!mapping || id(mapping) !== CUTOVER.mappingId || clean(mapping.supplierCode).toUpperCase() !== CUTOVER.supplierCode || clean(mapping.supplierProductCode) !== CUTOVER.supplierProductCode || clean(mapping.supplierPackageCode) !== CUTOVER.supplierPackageCode || clean(mapping.productCode).toLowerCase() !== CUTOVER.oldProductCode || clean(mapping.packageCode).toUpperCase() !== CUTOVER.oldPackageCode || mapping.archivedAt || mapping.enabled !== true || clean(mapping.region).toUpperCase() !== "GLOBAL" || clean(mapping.productionRole).toUpperCase() !== "PRIMARY" || clean(mapping.executionMode).toUpperCase() !== "API" || Number(mapping.__v || 0) !== expected.mappingVersion || dateIso(mapping.updatedAt) !== expected.mappingUpdatedAt) {
        throw new GlobalWeeklyPassCutoverError("MAPPING_PRECONDITION_CONFLICT", "The source mapping no longer matches the reviewed cutover preconditions.");
    }
    if (!offer || id(offer) !== id(mapping.supplierCatalogOfferId) || id(offer.supplierId) !== id(mapping.supplierId) || clean(offer.supplierProductCode) !== CUTOVER.supplierProductCode || clean(offer.supplierOfferCode) !== CUTOVER.supplierPackageCode || clean(offer.catalogLifecycleState).toUpperCase() !== "ACTIVE") {
        throw new GlobalWeeklyPassCutoverError("SUPPLIER_OFFER_PRECONDITION_CONFLICT", "The exact active supplier offer is unavailable or changed.");
    }
}

function createGlobalWeeklyPassCutoverService(dependencies = {}) {
    const M = {
        Admin: dependencies.Admin || AdminAccount,
        Audit: dependencies.Audit || AdminAuditLog,
        Product: dependencies.Product || CatalogProduct,
        Package: dependencies.Package || CatalogPackage,
        Order: dependencies.Order || CommerceOrder,
        Publication: dependencies.Publication || PackageMarketPublication,
        Selection: dependencies.Selection || PackageSupplierSelection,
        Offer: dependencies.Offer || SupplierCatalogOffer,
        SupplierProduct: dependencies.SupplierProduct || SupplierCatalogProduct,
        Availability: dependencies.Availability || SupplierOfferAvailability,
        Decision: dependencies.Decision || SupplierCatalogReconciliationDecision,
        Mapping: dependencies.Mapping || SupplierProductMapping
    };
    const connection = dependencies.connection || mongoose.connection;
    const ownerAuthorization = dependencies.ownerAuthorization || createAdminOwnerAuthorizationService({ AdminModel: M.Admin, SessionModel: dependencies.Session, clock: dependencies.clock });
    const clock = dependencies.clock || (() => new Date());
    const createAudit = dependencies.createAudit || (async (document, session) => (await M.Audit.create([document], { session }))[0]);

    async function refreshState(input = {}, { session = null } = {}) {
        const expected = normalizePreconditions(input);
        const previousSource = normalizePreviousSource(input.previousSource);
        const query = modelQuery => session ? modelQuery.session(session) : modelQuery;
        const mapping = await query(M.Mapping.findById(CUTOVER.mappingId)).lean();
        const currentDecision = await query(M.Decision.findOne({ mappingId: CUTOVER.mappingId, isCurrent: true })).lean();
        const offer = await query(M.Offer.findOne({ supplierId: mapping?.supplierId, supplierProductCode: CUTOVER.supplierProductCode, supplierOfferCode: CUTOVER.supplierPackageCode })).lean();
        const supplierProduct = offer ? await query(M.SupplierProduct.findById(offer.supplierCatalogProductId)).lean() : null;
        const availability = offer ? await query(M.Availability.findOne({ supplierCatalogOfferId: offer._id })).lean() : null;
        assertExactSource(mapping, offer, expected);
        if (!supplierProduct) throw new GlobalWeeklyPassCutoverError("SUPPLIER_PRODUCT_PRECONDITION_CONFLICT", "The exact supplier product evidence is missing.");
        const currentSource = sourceLock({ offer, product: supplierProduct, availability });
        for (const [key, value] of Object.entries(sourceEvidence(expected))) {
            const actual = key.endsWith("At") ? dateIso(currentSource[key]) : clean(currentSource[key]);
            if (actual !== value) throw new GlobalWeeklyPassCutoverError("SUPPLIER_SOURCE_PRECONDITION_CONFLICT", `Supplier source authority changed: ${key}.`, 409, { field: key });
        }
        const costAmount = Number(offer.supplierCost?.amount), costCurrency = clean(offer.supplierCost?.currency).toUpperCase();
        if (costAmount !== CUTOVER.reviewedCost.amount || costCurrency !== CUTOVER.reviewedCost.currency) throw new GlobalWeeklyPassCutoverError("REFRESH_REVIEWED_COST_CONFLICT", "The reviewed USD supplier cost changed.", 409);
        if (availability?.state !== "AVAILABLE" || availability?.coverageComplete !== true || clean(supplierProduct.supplierMarketCode).toUpperCase() !== "GLOBAL") throw new GlobalWeeklyPassCutoverError("REFRESH_AVAILABILITY_CONFLICT", "The reviewed Global supplier availability evidence changed.", 409);
        const weeklyRestriction = (supplierProduct.restrictions || []).find(item => Array.isArray(item.offerLabels) && item.offerLabels.some(label => clean(label).toLowerCase() === "weekly pass"));
        const excluded = [...new Set((weeklyRestriction?.excludedMarkets || []).map(value => clean(value).toUpperCase()))].sort();
        if (canonicalJson(excluded) !== canonicalJson([...CUTOVER.reviewedExcludedMarkets])) throw new GlobalWeeklyPassCutoverError("REFRESH_DESTINATION_RESTRICTION_CONFLICT", "The reviewed Weekly Pass destination restrictions changed.", 409);
        const planHash = sha256(refreshManifestFor(expected, previousSource));
        const alreadyRefreshed = currentDecision && currentDecision.reasonCode === "GLOBAL_WEEKLY_PASS_SOURCE_REAPPROVED" && Object.entries(sourceEvidence(expected)).every(([key, value]) => (key.endsWith("At") ? dateIso(currentDecision[key]) : clean(currentDecision[key])) === value);
        if (alreadyRefreshed) {
            const audit = await query(M.Audit.findOne({ action: CUTOVER.refreshOperation, resourceType: "SupplierCatalogReconciliationDecision", resourceId: id(currentDecision), "metadata.planHash": planHash })).lean();
            if (!audit) throw new GlobalWeeklyPassCutoverError("REFRESH_PARTIAL_STATE", "The evidence refresh is missing its mandatory audit record.");
            return { state: "COMPLETED", expected, previousSource, mapping, currentDecision, offer, supplierProduct, availability, planHash };
        }
        if (!currentDecision || id(currentDecision) !== expected.decisionId || Number(currentDecision.decisionVersion) !== expected.decisionVersion || currentDecision.decisionStatus !== "APPROVED" || currentDecision.isCurrent !== true || id(currentDecision.mappingId) !== CUTOVER.mappingId || clean(currentDecision.canonicalProductCode).toLowerCase() !== CUTOVER.oldProductCode || clean(currentDecision.canonicalPackageCode).toUpperCase() !== CUTOVER.oldPackageCode) throw new GlobalWeeklyPassCutoverError("REFRESH_DECISION_PRECONDITION_CONFLICT", "The current reconciliation decision no longer matches the reviewed mapped target.");
        for (const [key, value] of Object.entries(previousSource)) {
            const actual = key.endsWith("At") ? dateIso(currentDecision[key]) : clean(currentDecision[key]);
            if (actual !== value) throw new GlobalWeeklyPassCutoverError("REFRESH_PREVIOUS_DECISION_CONFLICT", `Prior reconciliation authority changed: ${key}.`, 409, { field: key });
        }
        return { state: "READY", expected, previousSource, mapping, currentDecision, offer, supplierProduct, availability, planHash };
    }

    async function refreshApproval(input = {}, context = {}) {
        if (input.confirmed !== true || clean(input.confirmation) !== CUTOVER.refreshConfirmation) throw new GlobalWeeklyPassCutoverError("EXPLICIT_OWNER_CONFIRMATION_REQUIRED", "The exact OWNER evidence-refresh confirmation is required.", 400);
        const expected = normalizePreconditions(input), previousSource = normalizePreviousSource(input.previousSource);
        const computedPlanHash = sha256(refreshManifestFor(expected, previousSource));
        if (!hash64(input.planHash) || clean(input.planHash).toLowerCase() !== computedPlanHash) throw new GlobalWeeklyPassCutoverError("REFRESH_PLAN_HASH_MISMATCH", "The approved immutable evidence-refresh plan hash does not match.");
        const owner = await ownerAuthorization.requireAuthenticatedOwner(context.actor || {});
        const session = await connection.startSession();
        let result;
        try {
            await session.withTransaction(async () => {
                const state = await refreshState({ expected, previousSource, planHash: computedPlanHash }, { session });
                if (state.state === "COMPLETED") { result = { applied: false, idempotentReplay: true, planHash: computedPlanHash, decisionId: id(state.currentDecision), decisionVersion: state.currentDecision.decisionVersion }; return; }
                const now = clock(), replacementId = new mongoose.Types.ObjectId();
                const priorFilter = { _id: state.currentDecision._id, mappingId: CUTOVER.mappingId, isCurrent: true, decisionStatus: "APPROVED", decisionVersion: expected.decisionVersion };
                for (const [key, value] of Object.entries(previousSource)) priorFilter[key] = key.endsWith("At") ? new Date(value) : value;
                const superseded = await M.Decision.updateOne(priorFilter, { $set: { decisionStatus: "SUPERSEDED", isCurrent: false, afterState: { ...(state.currentDecision.afterState || {}), supersededBy: id(replacementId), sourceRefreshPlanHash: computedPlanHash } } }, { session, runValidators: true });
                if (superseded.modifiedCount !== 1) throw new GlobalWeeklyPassCutoverError("REFRESH_CONCURRENT_CHANGE", "The prior reconciliation decision changed during refresh.");
                const actor = { adminId: owner.id, username: owner.username, role: owner.role };
                await M.Decision.create([{ _id: replacementId, supplierCatalogOfferId: state.offer._id, supplierIdentity: state.currentDecision.supplierIdentity, decisionType: state.currentDecision.decisionType, decisionStatus: "APPROVED", decisionVersion: expected.decisionVersion + 1, isCurrent: true, canonicalProductId: state.currentDecision.canonicalProductId || null, canonicalPackageId: state.currentDecision.canonicalPackageId || null, canonicalProductCode: CUTOVER.oldProductCode, canonicalPackageCode: CUTOVER.oldPackageCode, mappingId: state.mapping._id, reasonCode: "GLOBAL_WEEKLY_PASS_SOURCE_REAPPROVED", reviewNotes: "OWNER reapproved refreshed supplier evidence without changing the existing mapping or canonical target.", evidence: { operation: CUTOVER.refreshOperation, planHash: computedPlanHash, reviewedCost: CUTOVER.reviewedCost, destinationRestrictions: CUTOVER.reviewedExcludedMarkets, mappingImpact: "NONE", publicationImpact: "NONE", pricingImpact: "NONE" }, ...sourceEvidence(expected), reviewedBy: actor, reviewedAt: now, approvedBy: actor, approvedAt: now, supersedesDecisionId: state.currentDecision._id, idempotencyKey: `global-weekly-pass-source-refresh:${computedPlanHash}`, beforeState: { decisionId: id(state.currentDecision), decisionVersion: expected.decisionVersion, canonicalProductCode: CUTOVER.oldProductCode, canonicalPackageCode: CUTOVER.oldPackageCode }, afterState: { decisionId: id(replacementId), decisionVersion: expected.decisionVersion + 1, canonicalProductCode: CUTOVER.oldProductCode, canonicalPackageCode: CUTOVER.oldPackageCode, mappingImpact: "NONE" }, auditTrail: { actor, timestamp: now, requestId: clean(context.requestId), action: CUTOVER.refreshOperation, planHash: computedPlanHash, confirmation: CUTOVER.refreshConfirmation } }], { session });
                await createAudit({ actorAdminId: owner.id, actorUsernameSnapshot: owner.username, actorRoleSnapshot: owner.role, action: CUTOVER.refreshOperation, resourceType: "SupplierCatalogReconciliationDecision", resourceId: id(replacementId), requestId: clean(context.requestId), metadata: { planHash: computedPlanHash, mappingId: CUTOVER.mappingId, canonicalTarget: `${CUTOVER.oldProductCode}/${CUTOVER.oldPackageCode}`, supplierCode: CUTOVER.supplierCode, supplierProductCode: CUTOVER.supplierProductCode, supplierPackageCode: CUTOVER.supplierPackageCode, reviewedCost: CUTOVER.reviewedCost, destinationRestrictions: CUTOVER.reviewedExcludedMarkets, mappingChanged: false, pricesChanged: false, publicationsChanged: false } }, session);
                result = { applied: true, idempotentReplay: false, planHash: computedPlanHash, decisionId: id(replacementId), decisionVersion: expected.decisionVersion + 1 };
            });
        } finally { await session.endSession(); }
        return result;
    }

    async function inspect(input = {}, { session = null } = {}) {
        const expected = normalizePreconditions(input);
        const query = modelQuery => session ? modelQuery.session(session) : modelQuery;
        // MongoDB sessions permit only one in-flight operation. Keep these reads
        // sequential so the exact same inspection is safe inside the apply transaction.
        const mapping = await query(M.Mapping.findById(CUTOVER.mappingId)).lean();
        const targetProduct = await query(M.Product.findOne({ productCode: CUTOVER.newProductCode, deletedAt: null })).lean();
        const targetPackage = await query(M.Package.findOne({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode })).lean();
        const currentDecision = await query(M.Decision.findOne({ supplierCatalogOfferId: { $exists: true }, isCurrent: true, mappingId: CUTOVER.mappingId })).lean();
        const offer = await query(M.Offer.findOne({ supplierId: mapping?.supplierId, supplierProductCode: CUTOVER.supplierProductCode, supplierOfferCode: CUTOVER.supplierPackageCode })).lean();
        const supplierProduct = offer ? await query(M.SupplierProduct.findById(offer.supplierCatalogProductId)).lean() : null;
        const availability = offer ? await query(M.Availability.findOne({ supplierCatalogOfferId: offer._id })).lean() : null;
        const historicalOrders = await query(M.Order.find({ "fulfilment.routeSnapshot.supplierMappingId": CUTOVER.mappingId, "fulfilment.routeSnapshot.productCode": CUTOVER.oldProductCode, "fulfilment.routeSnapshot.packageCode": CUTOVER.oldPackageCode }).select("_id orderId status paymentStatus fulfilment.status updatedAt")).lean();
        const targetSelectionCount = await query(M.Selection.countDocuments({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode }));
        const targetPublicationCount = await query(M.Publication.countDocuments({ productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode }));
        const oldSelectionCount = await query(M.Selection.countDocuments({ productCode: CUTOVER.oldProductCode, packageCode: CUTOVER.oldPackageCode }));
        const oldPublicationCount = await query(M.Publication.countDocuments({ productCode: CUTOVER.oldProductCode, packageCode: CUTOVER.oldPackageCode }));
        if (!targetProduct) throw new GlobalWeeklyPassCutoverError("TARGET_PRODUCT_MISSING", "The mlbb canonical product is missing.");

        const completed = mapping && clean(mapping.productCode).toLowerCase() === CUTOVER.newProductCode && clean(mapping.packageCode).toUpperCase() === CUTOVER.newPackageCode;
        if (completed) {
            const completedPlanHash = hash64(input.planHash) ? clean(input.planHash).toLowerCase() : sha256(manifestFor(expected));
            const decision = await query(M.Decision.findOne({ mappingId: CUTOVER.mappingId, isCurrent: true })).lean();
            const audit = await query(M.Audit.findOne({ action: CUTOVER.operation, resourceType: "SupplierProductMapping", resourceId: CUTOVER.mappingId, "metadata.planHash": completedPlanHash })).lean();
            const exactPackage = targetPackage && targetPackage.enabled === false && !targetPackage.deletedAt && Object.keys(targetPackage.prices || {}).length === 0;
            const exactDecision = decision && decision.decisionStatus === "APPROVED" && clean(decision.canonicalProductCode).toLowerCase() === CUTOVER.newProductCode && clean(decision.canonicalPackageCode).toUpperCase() === CUTOVER.newPackageCode && id(decision.mappingId) === CUTOVER.mappingId;
            const exactNativeIdentity = clean(mapping.supplierCode).toUpperCase() === CUTOVER.supplierCode && clean(mapping.supplierProductCode) === CUTOVER.supplierProductCode && clean(mapping.supplierPackageCode) === CUTOVER.supplierPackageCode && id(mapping.supplierCatalogOfferId) === id(offer);
            if (exactPackage && exactDecision && exactNativeIdentity && audit && targetSelectionCount === 0 && targetPublicationCount === 0) return { state: "COMPLETED", expected, mapping, targetPackage, decision, historicalOrders, planHash: completedPlanHash };
            throw new GlobalWeeklyPassCutoverError("CUTOVER_PARTIAL_STATE", "The cutover is partially applied or conflicts with the approved target state.");
        }

        if (targetPackage || targetSelectionCount || targetPublicationCount || oldSelectionCount || oldPublicationCount) throw new GlobalWeeklyPassCutoverError("CUTOVER_CONFLICTING_STATE", "Package, selection, or publication state conflicts with the guarded cutover.", 409, { targetPackage: Boolean(targetPackage), targetSelectionCount, targetPublicationCount, oldSelectionCount, oldPublicationCount });
        assertExactSource(mapping, offer, expected);
        assertExactDecision(currentDecision, expected);
        if (!supplierProduct) throw new GlobalWeeklyPassCutoverError("SUPPLIER_PRODUCT_PRECONDITION_CONFLICT", "The exact supplier product evidence is missing.");
        const currentSource = sourceLock({ offer, product: supplierProduct, availability });
        for (const key of ["sourceOfferHash", "sourceOfferRevision", "sourceLastChangedAt", "sourceSemanticHash", "sourceProductEvidenceHash", "sourceCostHash"]) {
            const actual = key.endsWith("At") ? dateIso(currentSource[key]) : clean(currentSource[key]);
            if (actual !== expected[key]) throw new GlobalWeeklyPassCutoverError("SUPPLIER_SOURCE_PRECONDITION_CONFLICT", `Supplier source authority changed: ${key}.`, 409, { field: key });
        }
        if (id(currentDecision.supplierCatalogOfferId) !== id(offer)) throw new GlobalWeeklyPassCutoverError("RECONCILIATION_OFFER_CONFLICT", "The current decision does not reference the exact supplier offer.");
        if (historicalOrders.length !== CUTOVER.expectedHistoricalOrderCount) throw new GlobalWeeklyPassCutoverError("HISTORICAL_ORDER_PRECONDITION_CONFLICT", "The frozen historical-order inventory changed.", 409, { expected: CUTOVER.expectedHistoricalOrderCount, actual: historicalOrders.length });
        return { state: "READY", expected, mapping, targetProduct, targetPackage: null, currentDecision, offer, historicalOrders, planHash: sha256(manifestFor(expected)) };
    }

    async function apply(input = {}, context = {}) {
        if (input.confirmed !== true || clean(input.confirmation) !== CUTOVER.confirmation) throw new GlobalWeeklyPassCutoverError("EXPLICIT_OWNER_CONFIRMATION_REQUIRED", "The exact OWNER cutover confirmation is required.", 400);
        const expected = normalizePreconditions(input);
        const computedPlanHash = sha256(manifestFor(expected));
        if (!hash64(input.planHash) || clean(input.planHash).toLowerCase() !== computedPlanHash) throw new GlobalWeeklyPassCutoverError("CUTOVER_PLAN_HASH_MISMATCH", "The approved immutable cutover plan hash does not match.", 409, { computedPlanHash });
        const owner = await ownerAuthorization.requireAuthenticatedOwner(context.actor || {});
        const session = await connection.startSession();
        let result;
        try {
            await session.withTransaction(async () => {
                const state = await inspect({ expected, planHash: computedPlanHash }, { session });
                if (state.state === "COMPLETED") {
                    result = { applied: false, idempotentReplay: true, planHash: computedPlanHash, packageCode: CUTOVER.newPackageCode, mappingId: CUTOVER.mappingId, historicalOrdersPreserved: state.historicalOrders.length };
                    return;
                }
                const now = clock();
                const packageDocument = (await M.Package.create([{
                    productCode: CUTOVER.newProductCode,
                    packageCode: CUTOVER.newPackageCode,
                    name: CUTOVER.packageName,
                    enabled: false,
                    prices: {},
                    source: "admin",
                    metadata: {
                        entitlementSemantics: state.offer.normalizedSemantics || { repeatability: "REPEATABLE", passType: "WEEKLY" },
                        createdByGuardedCutover: true,
                        sourceSupplierCatalogOfferId: state.offer._id,
                        supplierCatalogAdoption: { supplierCatalogOfferId: state.offer._id, supplierProductCode: CUTOVER.supplierProductCode, supplierOfferCode: CUTOVER.supplierPackageCode, planHash: computedPlanHash }
                    }
                }], { session }))[0];

                const mappingWrite = await M.Mapping.updateOne({
                    _id: CUTOVER.mappingId,
                    supplierId: state.mapping.supplierId,
                    supplierCode: CUTOVER.supplierCode,
                    supplierProductCode: CUTOVER.supplierProductCode,
                    supplierPackageCode: CUTOVER.supplierPackageCode,
                    supplierCatalogOfferId: state.offer._id,
                    productCode: CUTOVER.oldProductCode,
                    packageCode: CUTOVER.oldPackageCode,
                    region: "GLOBAL",
                    productionRole: "PRIMARY",
                    enabled: true,
                    archivedAt: null,
                    updatedAt: new Date(expected.mappingUpdatedAt),
                    __v: expected.mappingVersion
                }, {
                    $set: {
                        productCode: CUTOVER.newProductCode,
                        packageCode: CUTOVER.newPackageCode,
                        "mappingMetadata.readiness.pricingReady": false,
                        "mappingMetadata.readiness.storefrontReady": false,
                        "mappingMetadata.canonicalCutover": { operation: CUTOVER.operation, planHash: computedPlanHash, previousProductCode: CUTOVER.oldProductCode, previousPackageCode: CUTOVER.oldPackageCode, changedAt: now, changedByAdminId: owner.id }
                    },
                    $inc: { __v: 1 },
                    $currentDate: { updatedAt: true }
                }, { session, runValidators: true });
                if (mappingWrite.modifiedCount !== 1) throw new GlobalWeeklyPassCutoverError("MAPPING_CONCURRENT_CHANGE", "The mapping changed during the cutover.");

                const replacementId = new mongoose.Types.ObjectId();
                const superseded = await M.Decision.updateOne({ _id: state.currentDecision._id, isCurrent: true, decisionStatus: "APPROVED", decisionVersion: expected.decisionVersion, sourceOfferHash: expected.sourceOfferHash, sourceOfferRevision: expected.sourceOfferRevision, sourceLastChangedAt: new Date(expected.sourceLastChangedAt), sourceSemanticHash: expected.sourceSemanticHash, sourceProductEvidenceHash: expected.sourceProductEvidenceHash, sourceCostHash: expected.sourceCostHash }, { $set: { decisionStatus: "SUPERSEDED", isCurrent: false, afterState: { ...(state.currentDecision.afterState || {}), supersededBy: id(replacementId), cutoverPlanHash: computedPlanHash } } }, { session, runValidators: true });
                if (superseded.modifiedCount !== 1) throw new GlobalWeeklyPassCutoverError("RECONCILIATION_CONCURRENT_CHANGE", "The reconciliation decision changed during the cutover.");

                const actor = { adminId: owner.id, username: owner.username, role: owner.role };
                await M.Decision.create([{
                    _id: replacementId,
                    supplierCatalogOfferId: state.offer._id,
                    supplierIdentity: state.currentDecision.supplierIdentity,
                    decisionType: "LINK_TO_EXISTING_CANONICAL_PACKAGE",
                    decisionStatus: "APPROVED",
                    decisionVersion: expected.decisionVersion + 1,
                    isCurrent: true,
                    canonicalProductId: state.targetProduct?._id || null,
                    canonicalPackageId: packageDocument._id,
                    canonicalProductCode: CUTOVER.newProductCode,
                    canonicalPackageCode: CUTOVER.newPackageCode,
                    mappingId: state.mapping._id,
                    reasonCode: "GLOBAL_WEEKLY_PASS_CANONICAL_CORRECTION",
                    reviewNotes: "OWNER-approved canonical correction. Historical frozen orders remain unchanged and fail closed against the reassigned mapping.",
                    evidence: { operation: CUTOVER.operation, planHash: computedPlanHash, nativeIdentityPreserved: true, historicalOrdersModified: 0 },
                    sourceOfferHash: expected.sourceOfferHash,
                    sourceOfferRevision: expected.sourceOfferRevision,
                    sourceLastChangedAt: state.currentDecision.sourceLastChangedAt,
                    sourceSemanticHash: expected.sourceSemanticHash,
                    sourceProductEvidenceHash: expected.sourceProductEvidenceHash,
                    sourceCostHash: expected.sourceCostHash,
                    reviewedBy: actor,
                    reviewedAt: now,
                    approvedBy: actor,
                    approvedAt: now,
                    supersedesDecisionId: state.currentDecision._id,
                    idempotencyKey: `global-weekly-pass-cutover:${computedPlanHash}`,
                    beforeState: { productCode: CUTOVER.oldProductCode, packageCode: CUTOVER.oldPackageCode, mappingId: CUTOVER.mappingId, decisionId: id(state.currentDecision) },
                    afterState: { productCode: CUTOVER.newProductCode, packageCode: CUTOVER.newPackageCode, mappingId: CUTOVER.mappingId, publicationImpact: "NONE", pricingImpact: "NONE", sellingImpact: "NONE" },
                    auditTrail: { actor, timestamp: now, requestId: clean(context.requestId), action: CUTOVER.operation, planHash: computedPlanHash, confirmation: CUTOVER.confirmation }
                }], { session });

                await createAudit({
                    actorAdminId: owner.id,
                    actorUsernameSnapshot: owner.username,
                    actorRoleSnapshot: owner.role,
                    action: CUTOVER.operation,
                    resourceType: "SupplierProductMapping",
                    resourceId: CUTOVER.mappingId,
                    requestId: clean(context.requestId),
                    metadata: { planHash: computedPlanHash, previousCanonicalTarget: `${CUTOVER.oldProductCode}/${CUTOVER.oldPackageCode}`, newCanonicalTarget: `${CUTOVER.newProductCode}/${CUTOVER.newPackageCode}`, supplierCode: CUTOVER.supplierCode, supplierProductCode: CUTOVER.supplierProductCode, supplierPackageCode: CUTOVER.supplierPackageCode, historicalOrderCount: state.historicalOrders.length, historicalOrdersModified: 0, pricesCreated: 0, publicationsCreated: 0, selectionsCreated: 0, costAuthorityChanged: false }
                }, session);
                result = { applied: true, idempotentReplay: false, planHash: computedPlanHash, packageCode: CUTOVER.newPackageCode, mappingId: CUTOVER.mappingId, historicalOrdersPreserved: state.historicalOrders.length };
            });
        } finally {
            await session.endSession();
        }
        return result;
    }

    return Object.freeze({ inspect, apply, inspectRefresh: refreshState, refreshApproval });
}

module.exports = Object.freeze({ CUTOVER, GlobalWeeklyPassCutoverError, normalizePreconditions, manifestFor, refreshManifestFor, createGlobalWeeklyPassCutoverService });
