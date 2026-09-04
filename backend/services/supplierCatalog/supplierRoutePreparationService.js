"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const Supplier = require("../../models/Supplier");
const SupplierCatalogProduct = require("../../models/SupplierCatalogProduct");
const SupplierCatalogOffer = require("../../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const CatalogProduct = require("../../models/CatalogProduct");
const CatalogPackage = require("../../models/CatalogPackage");
const AdminAuditLog = require("../../models/AdminAuditLog");
const { canonicalJson } = require("./supplierCatalogNormalization");
const { getSupplierAdapter } = require("../supplierAdapterRegistry");
const { supportsMapping } = require("../suppliers/supplierFulfillmentDispatcher");
const { contractFromSupplierCatalog, verifiedMappingContract } = require("../suppliers/fazercardsFulfillmentContractService");
const { supplierMarketCompatibility } = require("../supplierFulfillmentEligibilityService");
const { assessPreCommercialFulfillmentReadiness } = require("../fulfillmentCapabilityService");

const ACTION = "SUPPLIER_ROUTE_TECHNICALLY_PREPARED";
const OUTCOMES = Object.freeze({
    FULFILLMENT_READY: "FULFILLMENT_READY",
    MISSING_CANONICAL_LINK: "MISSING_CANONICAL_LINK",
    MISSING_MAPPING: "MISSING_MAPPING",
    MARKET_UNRESOLVED: "MARKET_UNRESOLVED",
    INPUT_CONTRACT_UNRESOLVED: "INPUT_CONTRACT_UNRESOLVED",
    PROTOCOL_UNSUPPORTED: "PROTOCOL_UNSUPPORTED",
    AVAILABILITY_UNPROVEN: "AVAILABILITY_UNPROVEN",
    REVIEW_REQUIRED: "REVIEW_REQUIRED",
    UNSUPPORTED: "UNSUPPORTED"
});
const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const id = value => clean(value?._id || value);
const sha = value => crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");

class SupplierRoutePreparationError extends Error {
    constructor(code, message, statusCode = 409, details = {}) { super(message); this.name = "SupplierRoutePreparationError"; this.code = code; this.statusCode = statusCode; this.details = details; }
}

function normalizeRequest(input = {}) {
    const request = { mappingId: clean(input.mappingId), customerMarkets: [...new Set((input.customerMarkets || []).map(upper))].filter(market => ["TH", "MM"].includes(market)).sort() };
    if (!request.mappingId) throw new SupplierRoutePreparationError("MAPPING_ID_REQUIRED", "Choose an exact supplier mapping.", 400);
    if (!request.customerMarkets.length) throw new SupplierRoutePreparationError("CUSTOMER_MARKET_REQUIRED", "Choose at least one supported customer market.", 400);
    return request;
}

function outcomeFor(blockers = []) {
    if (!blockers.length) return OUTCOMES.FULFILLMENT_READY;
    if (blockers.includes("MISSING_MAPPING")) return OUTCOMES.MISSING_MAPPING;
    if (blockers.some(code => ["MISSING_CANONICAL_LINK", "AMBIGUOUS_CANONICAL_IDENTITY"].includes(code))) return blockers.includes("AMBIGUOUS_CANONICAL_IDENTITY") ? OUTCOMES.REVIEW_REQUIRED : OUTCOMES.MISSING_CANONICAL_LINK;
    if (blockers.some(code => ["STALE_OR_WRONG_OFFER_LINKAGE", "SUPPLIER_IDENTITY_MISMATCH", "CANONICAL_EQUIVALENCE_REVIEW_REQUIRED"].includes(code))) return OUTCOMES.REVIEW_REQUIRED;
    if (blockers.includes("MARKET_UNRESOLVED")) return OUTCOMES.MARKET_UNRESOLVED;
    if (blockers.some(code => ["AVAILABILITY_UNPROVEN", "OFFER_NOT_ACTIVE"].includes(code))) return OUTCOMES.AVAILABILITY_UNPROVEN;
    if (blockers.some(code => ["INPUT_CONTRACT_UNRESOLVED", "INPUT_NOT_READY", "VALIDATION_NOT_READY"].includes(code))) return OUTCOMES.INPUT_CONTRACT_UNRESOLVED;
    if (blockers.some(code => ["PROTOCOL_UNSUPPORTED", "SUPPLIER_ADAPTER_NOT_READY", "SUPPLIER_AUTO_FULFILLMENT_DISABLED"].includes(code))) return OUTCOMES.PROTOCOL_UNSUPPORTED;
    if (blockers.some(code => ["SUPPLIER_UNSUPPORTED", "SUPPLIER_PRODUCT_UNSUPPORTED"].includes(code))) return OUTCOMES.UNSUPPORTED;
    return OUTCOMES.REVIEW_REQUIRED;
}

function sourceLock(state, runtime) {
    const { mapping, supplier, supplierProduct, offer, availability, canonicalProduct, canonicalPackages } = state;
    return {
        mapping: { id: id(mapping), updatedAt: mapping?.updatedAt || null, supplierId: id(mapping?.supplierId), supplierProductCode: clean(mapping?.supplierProductCode), supplierPackageCode: clean(mapping?.supplierPackageCode), supplierCatalogOfferId: id(mapping?.supplierCatalogOfferId), supplierMarket: upper(mapping?.region), enabled: mapping?.enabled === true, productionRole: upper(mapping?.productionRole), executionMode: upper(mapping?.executionMode), fulfillmentEligibility: mapping?.fulfillmentEligibility || null, readiness: mapping?.mappingMetadata?.readiness || {} },
        supplier: { id: id(supplier), code: upper(supplier?.supplierCode), updatedAt: supplier?.updatedAt || null },
        supplierProduct: { id: id(supplierProduct), code: clean(supplierProduct?.supplierProductCode), market: upper(supplierProduct?.supplierMarketCode), sourceRevision: clean(supplierProduct?.sourceRevision), sourceHash: clean(supplierProduct?.rawSnapshotHash), updatedAt: supplierProduct?.updatedAt || null },
        offer: { id: id(offer), code: clean(offer?.supplierOfferCode), lifecycle: upper(offer?.catalogLifecycleState), reconciliation: upper(offer?.reconciliationState), sourceRevision: clean(offer?.sourceRevision), sourceHash: clean(offer?.rawSnapshotHash), updatedAt: offer?.updatedAt || null },
        availability: { state: upper(availability?.state), coverageComplete: availability?.coverageComplete === true, observedAt: availability?.observedAt || null, updatedAt: availability?.updatedAt || null },
        canonical: { productId: id(canonicalProduct), productCode: clean(mapping?.productCode).toLowerCase(), packageIds: canonicalPackages.map(id).sort(), packageCode: upper(mapping?.packageCode), productUpdatedAt: canonicalProduct?.updatedAt || null, packageUpdatedAt: canonicalPackages[0]?.updatedAt || null },
        runtime: { adapterConfigured: runtime.adapterConfigured === true, autoFulfillmentEnabled: runtime.autoFulfillmentEnabled === true, processorSupported: runtime.processorSupported === true, protocol: clean(runtime.fulfillmentContract?.protocol), contractFingerprint: clean(runtime.fulfillmentContract?.fingerprint) }
    };
}

function proposedMapping(mapping, state, request, runtime) {
    const readiness = mapping.mappingMetadata?.readiness || {};
    return {
        ...mapping,
        executionMode: "API",
        supplierMarketEvidence: { normalizedMarket: upper(mapping.region), supplierMarketCode: upper(state.supplierProduct.supplierMarketCode), marketClassification: "REVIEWED_SUPPLIER_MARKET", restrictions: state.supplierProduct.restrictions || [], evidenceCode: "SOURCE_LOCKED_SUPPLIER_CATALOG", sourceProductHash: state.supplierProduct.rawSnapshotHash },
        fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: request.customerMarkets, evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: `Reviewed ${upper(mapping.region)} supplier route preparation`, verifiedAt: new Date(0), version: Number(mapping.fulfillmentEligibility?.version || 0) + 1 },
        mappingMetadata: { ...(mapping.mappingMetadata || {}), fulfillmentContract: runtime.fulfillmentContract, readiness: { ...readiness, supplierMapped: true, inputReady: true, validationReady: true, fulfillmentReady: true } }
    };
}

function assessExistingPreparedRoute(state = {}, customerMarkets = [], dependencies = {}) {
    const adapterResolver = dependencies.adapterResolver || getSupplierAdapter;
    const processorSupportResolver = dependencies.processorSupportResolver || supportsMapping;
    const mapping = state.mapping || null;
    let adapter = null;
    try { adapter = state.supplier ? adapterResolver(state.supplier) : null; } catch { adapter = null; }
    const fulfillmentContract = contractFromSupplierCatalog({ mapping, offer: state.offer, supplierProduct: state.supplierProduct }) || verifiedMappingContract(mapping || {});
    let adapterConfigured = false, autoFulfillmentEnabled = false, processorSupported = false;
    try { adapterConfigured = adapter?.isConfigured?.() === true; } catch { adapterConfigured = false; }
    try { autoFulfillmentEnabled = adapter?.isAutoFulfillmentEnabled?.(mapping?.productCode) === true; } catch { autoFulfillmentEnabled = false; }
    try { processorSupported = processorSupportResolver(mapping || {}) === true; } catch { processorSupported = false; }
    const assessment = assessPreCommercialFulfillmentReadiness({ ...state, mapping, customerMarkets, fulfillmentContract, adapterConfigured, autoFulfillmentEnabled, processorSupported });
    if (state.offer && upper(state.offer.reconciliationState) !== "EXACT_CANONICAL_MATCH") assessment.blockers.push("CANONICAL_EQUIVALENCE_REVIEW_REQUIRED");
    assessment.blockers = [...new Set(assessment.blockers)].sort();
    assessment.ready = assessment.blockers.length === 0;
    return { ...assessment, outcome: outcomeFor(assessment.blockers), fulfillmentContract, adapterConfigured, autoFulfillmentEnabled, processorSupported };
}

function defaultRepos() {
    const sessionize = (query, session) => session ? query.session(session) : query;
    return {
        transaction: async fn => { const session = await mongoose.startSession(); try { let value; await session.withTransaction(async () => { value = await fn(session); }); return value; } finally { await session.endSession(); } },
        mappingById: (value, session) => sessionize(SupplierProductMapping.findById(value), session).lean(),
        supplierById: (value, session) => sessionize(Supplier.findById(value), session).lean(),
        offerById: (value, session) => sessionize(SupplierCatalogOffer.findById(value), session).lean(),
        productById: (value, session) => sessionize(SupplierCatalogProduct.findById(value), session).lean(),
        availabilityByOffer: (value, session) => sessionize(SupplierOfferAvailability.findOne({ supplierCatalogOfferId: value }), session).lean(),
        canonicalProduct: (value, session) => sessionize(CatalogProduct.findOne({ productCode: value, deletedAt: null }), session).lean(),
        canonicalPackages: (productCode, packageCode, session) => sessionize(CatalogPackage.find({ productCode, packageCode, deletedAt: null }), session).lean(),
        auditByPlanHash: (planHash, session) => sessionize(AdminAuditLog.findOne({ action: ACTION, "metadata.planHash": planHash }), session).lean(),
        updateMapping: (mappingId, expectedUpdatedAt, update, session) => SupplierProductMapping.updateOne({ _id: mappingId, updatedAt: new Date(expectedUpdatedAt) }, { $set: update }, { session, runValidators: true }),
        createAudit: (document, session) => AdminAuditLog.create([document], { session })
    };
}

function createSupplierRoutePreparationService({ repos = defaultRepos(), adapterResolver = getSupplierAdapter, processorSupportResolver = supportsMapping, clock = () => new Date() } = {}) {
    async function load(request, session = null) {
        const mapping = await repos.mappingById(request.mappingId, session);
        if (!mapping) return { mapping: null, supplier: null, supplierProduct: null, offer: null, availability: null, canonicalProduct: null, canonicalPackages: [] };
        const [supplier, offer, canonicalProduct, canonicalPackages] = await Promise.all([repos.supplierById(mapping.supplierId, session), repos.offerById(mapping.supplierCatalogOfferId, session), repos.canonicalProduct(mapping.productCode, session), repos.canonicalPackages(mapping.productCode, mapping.packageCode, session)]);
        const [supplierProduct, availability] = await Promise.all([offer ? repos.productById(offer.supplierCatalogProductId, session) : null, offer ? repos.availabilityByOffer(offer._id, session) : null]);
        return { mapping, supplier, supplierProduct, offer, availability, canonicalProduct, canonicalPackages };
    }

    function runtimeFor(state, mapping) {
        const adapter = state.supplier ? adapterResolver(state.supplier) : null;
        const fulfillmentContract = contractFromSupplierCatalog({ mapping, offer: state.offer, supplierProduct: state.supplierProduct }) || verifiedMappingContract(mapping);
        let adapterConfigured = false, autoFulfillmentEnabled = false, processorSupported = false;
        try { adapterConfigured = adapter?.isConfigured?.() === true; } catch { adapterConfigured = false; }
        try { autoFulfillmentEnabled = adapter?.isAutoFulfillmentEnabled?.(mapping?.productCode) === true; } catch { autoFulfillmentEnabled = false; }
        try { processorSupported = processorSupportResolver(mapping) === true; } catch { processorSupported = false; }
        return { fulfillmentContract, adapterConfigured, autoFulfillmentEnabled, processorSupported };
    }

    async function generatePlan(input = {}, { session = null } = {}) {
        const request = normalizeRequest(input), state = await load(request, session);
        if (!state.mapping) {
            const body = { artifactType: "SUPPLIER_ROUTE_PREPARATION_PLAN", schemaVersion: 1, request, outcome: OUTCOMES.MISSING_MAPPING, blockers: ["MISSING_MAPPING"], sourceLock: sourceLock(state, {}), proposedChanges: null, safety: { enabledWrites: 0, roleWrites: 0, pricingWrites: 0, publicationWrites: 0, storefrontWrites: 0, supplierCalls: 0 } };
            return { ...body, sourceLockHash: sha(body.sourceLock), planHash: sha(body) };
        }
        const marketCompatible = request.customerMarkets.every(market => supplierMarketCompatibility(state.mapping.region, market).compatible);
        const initialRuntime = runtimeFor(state, state.mapping);
        const proposal = proposedMapping(state.mapping, state, request, initialRuntime);
        const runtime = runtimeFor(state, proposal);
        if (!marketCompatible) proposal.fulfillmentEligibility = { ...proposal.fulfillmentEligibility, mode: "UNKNOWN", allowedCustomerMarkets: [] };
        const assessment = assessPreCommercialFulfillmentReadiness({ ...state, mapping: proposal, customerMarkets: request.customerMarkets, ...runtime });
        if (upper(state.offer?.reconciliationState) !== "EXACT_CANONICAL_MATCH") assessment.blockers.push("CANONICAL_EQUIVALENCE_REVIEW_REQUIRED");
        if (!marketCompatible) assessment.blockers.push("MARKET_UNRESOLVED");
        assessment.blockers = [...new Set(assessment.blockers)].sort(); assessment.ready = assessment.blockers.length === 0;
        const lock = sourceLock(state, runtime);
        const proposedChanges = assessment.ready ? {
            executionMode: "API", supplierMarketEvidence: proposal.supplierMarketEvidence, fulfillmentEligibility: proposal.fulfillmentEligibility,
            fulfillmentContract: runtime.fulfillmentContract,
            readiness: { supplierMapped: true, inputReady: true, validationReady: true, fulfillmentReady: true }
        } : null;
        const body = { artifactType: "SUPPLIER_ROUTE_PREPARATION_PLAN", schemaVersion: 1, request, outcome: outcomeFor(assessment.blockers), blockers: assessment.blockers, evidence: { supplierCode: upper(state.supplier?.supplierCode), supplierProductCode: clean(state.supplierProduct?.supplierProductCode), supplierOfferCode: clean(state.offer?.supplierOfferCode), supplierMarket: upper(state.mapping.region), customerMarkets: request.customerMarkets, canonicalProductCode: clean(state.mapping.productCode), canonicalPackageCode: upper(state.mapping.packageCode), protocol: clean(runtime.fulfillmentContract?.protocol) }, sourceLock: lock, proposedChanges, safety: { enabledWrites: 0, roleWrites: 0, pricingWrites: 0, publicationWrites: 0, storefrontWrites: 0, supplierCalls: 0 } };
        return { ...body, sourceLockHash: sha(lock), planHash: sha(body) };
    }

    async function applyPlan(plan, { actor = null, confirmed = false } = {}) {
        if (upper(actor?.role) !== "OWNER") throw new SupplierRoutePreparationError("OWNER_PREPARATION_REQUIRED", "Only the Owner can apply reviewed supplier-route preparation.", 403);
        if (confirmed !== true) throw new SupplierRoutePreparationError("PREPARATION_CONFIRMATION_REQUIRED", "Explicit Owner confirmation is required.", 400);
        const suppliedHash = clean(plan?.planHash), body = { ...plan }; delete body.planHash; delete body.sourceLockHash;
        const expectedBody = { ...body };
        if (!suppliedHash || sha(expectedBody) !== suppliedHash) throw new SupplierRoutePreparationError("PREPARATION_PLAN_HASH_MISMATCH", "The reviewed preparation plan hash is invalid.");
        if (plan.outcome !== OUTCOMES.FULFILLMENT_READY || !plan.proposedChanges) throw new SupplierRoutePreparationError("PREPARATION_NOT_READY", "This supplier route is not eligible for technical preparation.", 409, { blockers: plan.blockers || [] });
        const replay = await repos.auditByPlanHash(suppliedHash, null);
        if (replay) return { applied: 0, idempotentReplay: true, planHash: suppliedHash, mappingId: plan.request.mappingId };
        return repos.transaction(async session => {
            const insideReplay = await repos.auditByPlanHash(suppliedHash, session);
            if (insideReplay) return { applied: 0, idempotentReplay: true, planHash: suppliedHash, mappingId: plan.request.mappingId };
            const fresh = await generatePlan(plan.request, { session });
            if (fresh.planHash !== suppliedHash || fresh.sourceLockHash !== plan.sourceLockHash) throw new SupplierRoutePreparationError("PREPARATION_SOURCE_STALE", "Supplier, catalog, mapping, contract, adapter, or availability evidence changed after review.");
            const now = clock(), currentMetadata = (await repos.mappingById(plan.request.mappingId, session)).mappingMetadata || {};
            const update = {
                executionMode: "API",
                supplierMarketEvidence: plan.proposedChanges.supplierMarketEvidence,
                fulfillmentEligibility: { ...plan.proposedChanges.fulfillmentEligibility, verifiedAt: now },
                mappingMetadata: { ...currentMetadata, fulfillmentContract: plan.proposedChanges.fulfillmentContract, readiness: { ...(currentMetadata.readiness || {}), ...plan.proposedChanges.readiness }, technicalPreparation: { authority: ACTION, planHash: suppliedHash, sourceLockHash: plan.sourceLockHash, reviewedCustomerMarkets: plan.request.customerMarkets, protocol: plan.evidence.protocol, preparedAt: now, preparedBy: clean(actor.username) } }
            };
            const write = await repos.updateMapping(plan.request.mappingId, plan.sourceLock.mapping.updatedAt, update, session);
            if (write.matchedCount !== 1) throw new SupplierRoutePreparationError("PREPARATION_SOURCE_STALE", "The supplier mapping changed during preparation.");
            await repos.createAudit({ actorAdminId: actor.id || actor._id || null, actorUsernameSnapshot: clean(actor.username), actorRoleSnapshot: upper(actor.role), action: ACTION, resourceType: "SupplierProductMapping", resourceId: plan.request.mappingId, metadata: { planHash: suppliedHash, sourceLockHash: plan.sourceLockHash, customerMarkets: plan.request.customerMarkets, supplierCode: plan.evidence.supplierCode, supplierProductCode: plan.evidence.supplierProductCode, supplierOfferCode: plan.evidence.supplierOfferCode, canonicalProductCode: plan.evidence.canonicalProductCode, canonicalPackageCode: plan.evidence.canonicalPackageCode, before: { enabled: plan.sourceLock.mapping.enabled, productionRole: plan.sourceLock.mapping.productionRole, executionMode: plan.sourceLock.mapping.executionMode }, mutations: ["executionMode", "supplierMarketEvidence", "fulfillmentEligibility", "mappingMetadata.fulfillmentContract", "mappingMetadata.readiness"] } }, session);
            return { applied: 1, idempotentReplay: false, planHash: suppliedHash, mappingId: plan.request.mappingId, outcome: OUTCOMES.FULFILLMENT_READY };
        });
    }
    return { generatePlan, applyPlan };
}

const service = createSupplierRoutePreparationService();
module.exports = Object.freeze({ ACTION, OUTCOMES, SupplierRoutePreparationError, normalizeRequest, outcomeFor, sourceLock, proposedMapping, assessExistingPreparedRoute, createSupplierRoutePreparationService, generateSupplierRoutePreparationPlan: service.generatePlan, applySupplierRoutePreparationPlan: service.applyPlan });
