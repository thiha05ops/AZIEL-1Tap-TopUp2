"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const SupplierCatalogProduct = require("../../models/SupplierCatalogProduct");
const SupplierCatalogOffer = require("../../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const CatalogProduct = require("../../models/CatalogProduct");
const AdminAuditLog = require("../../models/AdminAuditLog");
const { canonicalJson } = require("./supplierCatalogNormalization");
const { sourceLock: reconciliationSourceLock, validateSourceLock: validateReconciliationSourceLock } = require("./supplierCatalogReconciliationService");

const clean = value => String(value == null ? "" : value).trim();
const lower = value => clean(value).toLowerCase();
const id = value => clean(value?._id || value);
const sha = value => crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const mutationsEnabled = () => process.env.SUPPLIER_PRODUCT_ONBOARDING_MUTATIONS_ENABLED === "true";

class SupplierCanonicalProductAuthorityError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message);
        this.name = "SupplierCanonicalProductAuthorityError";
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

function sourceLock(product = {}) {
    return {
        supplierCatalogProductId: id(product),
        supplierId: id(product.supplierId),
        catalogNamespace: clean(product.catalogNamespace).toUpperCase(),
        supplierProductCode: clean(product.supplierProductCode),
        sourceRevision: clean(product.sourceRevision || product.rawSnapshotHash),
        sourceHash: clean(product.rawSnapshotHash),
        sourceLastChangedAt: product.lastChangedAt ? new Date(product.lastChangedAt).toISOString() : ""
    };
}

function validateSourceLock(expected, current) {
    for (const field of ["supplierCatalogProductId", "supplierId", "catalogNamespace", "supplierProductCode", "sourceRevision", "sourceHash", "sourceLastChangedAt"]) {
        if (clean(expected?.[field]) !== clean(current?.[field])) {
            throw new SupplierCanonicalProductAuthorityError("SUPPLIER_PRODUCT_SOURCE_STALE", "Supplier changed this product since it was reviewed. Review again.", 409, { field });
        }
    }
}

function deterministicProductCode(product = {}) {
    const base = clean(product.displayName || product.rawName || product.supplierProductCode)
        .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "supplier-product";
    const suffix = sha([id(product.supplierId), clean(product.catalogNamespace).toUpperCase(), clean(product.supplierProductCode)].join("|")).slice(0, 10);
    return `${base}-${suffix}`.slice(0, 64);
}

function offerLock(offer = {}) {
    return {
        supplierCatalogOfferId: id(offer),
        supplierCatalogProductId: id(offer.supplierCatalogProductId),
        supplierId: id(offer.supplierId),
        catalogNamespace: clean(offer.catalogNamespace).toUpperCase(),
        supplierProductCode: clean(offer.supplierProductCode),
        supplierOfferCode: clean(offer.supplierOfferCode),
        sourceRevision: clean(offer.sourceRevision || offer.rawSnapshotHash),
        sourceHash: clean(offer.rawSnapshotHash),
        sourceLastChangedAt: offer.lastChangedAt ? new Date(offer.lastChangedAt).toISOString() : ""
    };
}

function offerDisposition(offer = {}) {
    const state = clean(offer.reconciliationState).toUpperCase();
    const active = clean(offer.catalogLifecycleState).toUpperCase() === "ACTIVE";
    const safeNew = active && ["NO_CANONICAL_PACKAGE", "UNREVIEWED"].includes(state);
    return safeNew ? "READY_TO_CREATE" : "REVIEW_REQUIRED";
}

function offerWizardState(offer = {}) {
    if (clean(offer.catalogLifecycleState).toUpperCase() !== "ACTIVE") return "UNAVAILABLE";
    return offerDisposition(offer) === "READY_TO_CREATE" ? "PREPARABLE" : "NEEDS_ATTENTION";
}

function defaultRepos() {
    const sessionize = (query, session) => session ? query.session(session) : query;
    return {
        transaction: async fn => {
            const session = await mongoose.startSession();
            try { let result; await session.withTransaction(async () => { result = await fn(session); }); return result; }
            finally { await session.endSession(); }
        },
        productById: (value, session) => sessionize(SupplierCatalogProduct.findById(value), session).lean(),
        offersByProduct: (value, session) => sessionize(SupplierCatalogOffer.find({ supplierCatalogProductId: value }).sort({ supplierOfferCode: 1 }), session).lean(),
        availabilityByOffers: (values, session) => sessionize(SupplierOfferAvailability.find({ supplierCatalogOfferId: { $in: values } }), session).lean(),
        mappingsByProduct: (product, offerIds, session) => sessionize(SupplierProductMapping.find({ supplierId: product.supplierId, $or: [{ supplierCatalogOfferId: { $in: offerIds } }, { supplierProductCode: product.supplierProductCode }] }), session).lean(),
        canonicalByCode: (value, session) => sessionize(CatalogProduct.findOne({ productCode: value }), session).lean(),
        canonicalBySourceProduct: (value, session) => sessionize(CatalogProduct.findOne({ "metadata.preparedFromSupplierCatalogProductId": id(value), deletedAt: null }), session).lean(),
        auditForAuthority: (productCode, supplierCatalogProductId, idempotencyKey, session) => sessionize(AdminAuditLog.findOne({ action: "SUPPLIER_CANONICAL_PRODUCT_CREATED", resourceType: "CatalogProduct", resourceId: productCode, "metadata.supplierCatalogProductId": id(supplierCatalogProductId), "metadata.idempotencyKey": clean(idempotencyKey) }), session).lean(),
        createCanonical: async (document, session) => (await CatalogProduct.create([document], { session }))[0].toObject(),
        updateProductAuthority: (productId, expectedHash, authority, session) => SupplierCatalogProduct.updateOne(
            { _id: productId, rawSnapshotHash: expectedHash, "metadata.onboardingCanonicalProduct": { $exists: false } },
            { $set: { "metadata.onboardingCanonicalProduct": authority } },
            { session, runValidators: true }
        ),
        createAudit: async (document, session) => (await AdminAuditLog.create([document], { session }))[0].toObject()
    };
}

function createSupplierCanonicalProductAuthorityService({ repos = defaultRepos(), gate = mutationsEnabled, clock = () => new Date(), routePlanner = null } = {}) {
    const concurrencyCodes = new Set([11000, 112, 244, 251]);
    function isConcurrentMongoFailure(error) {
        const labels = Array.isArray(error?.errorLabels) ? error.errorLabels : [];
        return concurrencyCodes.has(Number(error?.code)) || labels.includes("TransientTransactionError") || labels.includes("UnknownTransactionCommitResult") || error?.hasErrorLabel?.("TransientTransactionError") === true || error?.hasErrorLabel?.("UnknownTransactionCommitResult") === true;
    }
    function normalizedApprovedOffers(input) {
        return (Array.isArray(input.approvedOffers) ? input.approvedOffers : []).map(item => ({ supplierCatalogOfferId: clean(item.supplierCatalogOfferId), expectedSource: item.expectedSource })).sort((a, b) => a.supplierCatalogOfferId.localeCompare(b.supplierCatalogOfferId));
    }
    async function recoverConcurrentAuthority(input) {
        const product = await repos.productById(input.supplierCatalogProductId, null);
        if (!product) throw new SupplierCanonicalProductAuthorityError("SUPPLIER_CATALOG_PRODUCT_NOT_FOUND", "Persisted supplier catalog product was not found.", 404);
        validateSourceLock(input.expectedSource, sourceLock(product));
        const productCode = lower(input.productCode || deterministicProductCode(product));
        const prior = await repos.canonicalBySourceProduct(product._id, null);
        const collision = await repos.canonicalByCode(productCode, null);
        if (!prior) {
            if (collision) throw new SupplierCanonicalProductAuthorityError("CANONICAL_PRODUCT_CODE_CONFLICT", "The proposed canonical product code belongs to another product.", 409);
            return null;
        }
        const authority = product.metadata?.onboardingCanonicalProduct;
        const requestedOffers = normalizedApprovedOffers(input);
        const exactAuthority = authority?.authoritative === true
            && authority.authorityType === "OWNER_CREATE_NEW_CANONICAL_PRODUCT"
            && lower(prior.productCode) === productCode
            && id(prior.metadata?.preparedFromSupplierCatalogProductId) === id(product)
            && clean(authority.productCode) === productCode
            && id(authority.supplierCatalogProductId) === id(product)
            && id(authority.supplierId) === id(product.supplierId)
            && clean(authority.catalogNamespace).toUpperCase() === clean(product.catalogNamespace).toUpperCase()
            && clean(authority.supplierProductCode) === clean(product.supplierProductCode)
            && clean(authority.sourceHash) === clean(product.rawSnapshotHash)
            && clean(authority.sourceRevision) === clean(product.sourceRevision || product.rawSnapshotHash)
            && clean(authority.idempotencyKey) === clean(input.idempotencyKey)
            && canonicalJson(authority.approvedOffers || []) === canonicalJson(requestedOffers)
            && clean(prior.metadata?.onboardingAuthorityHash) === sha(authority);
        if (!exactAuthority) throw new SupplierCanonicalProductAuthorityError("CANONICAL_PRODUCT_IDENTITY_CONFLICT", "Concurrent canonical product authority does not match this exact supplier product request.", 409);
        const audit = typeof repos.auditForAuthority === "function" ? await repos.auditForAuthority(productCode, product._id, authority.idempotencyKey, null) : null;
        if (!audit) throw new SupplierCanonicalProductAuthorityError("CANONICAL_PRODUCT_AUTHORITY_AUDIT_MISSING", "Canonical product authority exists without its mandatory creation audit.", 409);
        return { canonicalProduct: prior, authority, idempotentReplay: true, concurrentReplay: true };
    }
    async function plan(productId, options = {}) {
        const product = await repos.productById(productId, null);
        if (!product) throw new SupplierCanonicalProductAuthorityError("SUPPLIER_CATALOG_PRODUCT_NOT_FOUND", "Persisted supplier catalog product was not found.", 404);
        const offers = await repos.offersByProduct(product._id, null);
        const availability = typeof repos.availabilityByOffers === "function" ? await repos.availabilityByOffers(offers.map(item => item._id), null) : [];
        const availabilityByOffer = new Map(availability.map(item => [id(item.supplierCatalogOfferId), item]));
        const mappings = typeof repos.mappingsByProduct === "function" ? await repos.mappingsByProduct(product, offers.map(item => item._id), null) : [];
        const authority = product.metadata?.onboardingCanonicalProduct || null;
        const mappedCodes = [...new Set(mappings.map(item => lower(item.productCode)).filter(Boolean))];
        const exactCodes = [...new Set(offers.filter(item => clean(item.reconciliationState).toUpperCase() === "EXACT_CANONICAL_MATCH").map(item => lower(item.reconciliationEvidence?.canonicalProductCode || item.reconciliationEvidence?.productCode)).filter(Boolean))];
        const identityConflict = mappedCodes.length > 1 || exactCodes.length > 1 || (mappedCodes.length === 1 && exactCodes.length === 1 && mappedCodes[0] !== exactCodes[0]);
        const provenCode = mappedCodes.length === 1 ? mappedCodes[0] : !mappedCodes.length && exactCodes.length === 1 ? exactCodes[0] : "";
        let existing = authority?.productCode ? await repos.canonicalByCode(lower(authority.productCode), null) : await repos.canonicalBySourceProduct(product._id, null);
        if (!existing && provenCode) existing = await repos.canonicalByCode(provenCode, null);
        const proposedProductCode = lower(authority?.productCode || existing?.productCode || deterministicProductCode(product));
        const collision = await repos.canonicalByCode(proposedProductCode, null);
        const collisionConflict = Boolean(collision && id(collision.metadata?.preparedFromSupplierCatalogProductId) !== id(product));
        const mappingByOffer = new Map(mappings.filter(item => id(item.supplierCatalogOfferId)).map(item => [id(item.supplierCatalogOfferId), item]));
        const requestedMarkets = [...new Set((options.customerMarkets || []).map(value => clean(value).toUpperCase()).filter(value => ["TH", "MM"].includes(value)))].sort();
        const projectedOffers = [];
        for (const offer of offers) {
            const baseState = offerWizardState(offer), mapping = mappingByOffer.get(id(offer));
            let state = baseState, disposition = offerDisposition(offer), blockers = [];
            if (mapping && clean(offer.catalogLifecycleState).toUpperCase() === "ACTIVE" && clean(offer.reconciliationState).toUpperCase() === "EXACT_CANONICAL_MATCH") {
                if (routePlanner && requestedMarkets.length) {
                    const routePlan = await routePlanner({ mappingId: id(mapping), customerMarkets: requestedMarkets });
                    blockers = [...new Set(routePlan.blockers || [])].sort();
                    const readiness = mapping.mappingMetadata?.readiness || {};
                    const liveReady = mapping.enabled === true && clean(mapping.productionRole).toUpperCase() === "PRIMARY" && readiness.inputReady === true && readiness.validationReady === true && readiness.fulfillmentReady === true;
                    state = routePlan.outcome === "FULFILLMENT_READY" ? (liveReady ? "READY" : "PREPARABLE") : "NEEDS_ATTENTION";
                    disposition = routePlan.outcome === "FULFILLMENT_READY" ? "READY_TO_PREPARE" : "REVIEW_REQUIRED";
                } else {
                    blockers = mapping.mappingMetadata?.technicalPreparation ? ["MAPPING_DISABLED"] : ["TECHNICAL_PREPARATION_REQUIRED"];
                    state = mapping.mappingMetadata?.technicalPreparation ? "PREPARABLE" : "NEEDS_ATTENTION";
                    disposition = mapping.mappingMetadata?.technicalPreparation ? "READY_TO_PREPARE" : "REVIEW_REQUIRED";
                }
            } else if (baseState === "NEEDS_ATTENTION") blockers = ["CANONICAL_EQUIVALENCE_REVIEW_REQUIRED"];
            if (baseState === "UNAVAILABLE") blockers = ["SUPPLIER_OFFER_NOT_ACTIVE"];
            projectedOffers.push({ supplierCatalogOfferId: id(offer), supplierOfferCode: offer.supplierOfferCode, name: clean(offer.supplierOfferName || offer.rawName || offer.supplierOfferCode), state, disposition, blockers, mappingId: id(mapping), sourceLock: reconciliationSourceLock({ offer, product, availability: availabilityByOffer.get(id(offer)) }) });
        }
        return {
            capability: { mutationEnabled: gate() === true, ownerConfirmationRequired: true },
            product: { supplierCatalogProductId: id(product), name: clean(product.displayName || product.rawName || product.supplierProductCode), supplierId: id(product.supplierId), catalogNamespace: product.catalogNamespace, supplierProductCode: product.supplierProductCode, supplierMarket: product.supplierMarketCode, sourceLock: sourceLock(product) },
            canonical: { exists: Boolean(existing), productCode: existing?.productCode || proposedProductCode, name: existing?.name || clean(product.displayName || product.rawName || product.supplierProductCode), collisionConflict },
            state: identityConflict ? "CANONICAL_PRODUCT_IDENTITY_CONFLICT" : existing ? "EXISTING_CANONICAL_PRODUCT" : collisionConflict ? "CANONICAL_PRODUCT_CODE_CONFLICT" : "NEW_TO_AZIEL",
            offers: projectedOffers
        };
    }

    async function authorize(input = {}, context = {}) {
        if (!gate()) throw new SupplierCanonicalProductAuthorityError("SUPPLIER_PRODUCT_ONBOARDING_MUTATIONS_DISABLED", "Supplier product onboarding mutations are disabled.", 403);
        if (input.confirmed !== true) throw new SupplierCanonicalProductAuthorityError("CANONICAL_PRODUCT_CONFIRMATION_REQUIRED", "Explicit Owner confirmation is required.");
        const actor = context.actor || {};
        const actorId = id(actor._id || actor.id);
        if (!actorId || !clean(actor.username) || !clean(actor.role)) throw new SupplierCanonicalProductAuthorityError("AUDIT_ACTOR_REQUIRED", "Authenticated Owner identity is required.", 403);
        try { return await repos.transaction(async session => {
            const product = await repos.productById(input.supplierCatalogProductId, session);
            if (!product) throw new SupplierCanonicalProductAuthorityError("SUPPLIER_CATALOG_PRODUCT_NOT_FOUND", "Persisted supplier catalog product was not found.", 404);
            const currentLock = sourceLock(product);
            validateSourceLock(input.expectedSource, currentLock);
            const requestedOffers = Array.isArray(input.approvedOffers) ? input.approvedOffers : [];
            const productOffers = await repos.offersByProduct(product._id, session);
            const productOfferById = new Map(productOffers.map(item => [id(item), item]));
            const availability = typeof repos.availabilityByOffers === "function" ? await repos.availabilityByOffers(requestedOffers.map(item => item.supplierCatalogOfferId), session) : [];
            const availabilityByOffer = new Map(availability.map(item => [id(item.supplierCatalogOfferId), item]));
            for (const approved of requestedOffers) {
                const offer = productOfferById.get(clean(approved.supplierCatalogOfferId));
                if (!offer) throw new SupplierCanonicalProductAuthorityError("ONBOARDING_OFFER_SCOPE_CONFLICT", "An approved offer does not belong to the selected supplier product.", 409);
                if (offerDisposition(offer) !== "READY_TO_CREATE") throw new SupplierCanonicalProductAuthorityError("ONBOARDING_OFFER_REVIEW_REQUIRED", "An ambiguous or inactive offer cannot be included in bounded product creation.", 409, { supplierCatalogOfferId: id(offer) });
                try { validateReconciliationSourceLock(approved.expectedSource, reconciliationSourceLock({ offer, product, availability: availabilityByOffer.get(id(offer)) })); }
                catch (error) { throw new SupplierCanonicalProductAuthorityError(error.code || "SUPPLIER_OFFER_SOURCE_STALE", "Supplier changed an included offer since it was reviewed. Review again.", error.statusCode || 409, error.details || {}); }
            }
            const productCode = lower(input.productCode || deterministicProductCode(product));
            if (productCode !== deterministicProductCode(product)) throw new SupplierCanonicalProductAuthorityError("CANONICAL_PRODUCT_CODE_OVERRIDE_REQUIRED", "The proposed product identity changed. Review the conflict explicitly.", 409);
            const prior = await repos.canonicalBySourceProduct(product._id, session);
            if (prior) {
                if (lower(prior.productCode) !== productCode) throw new SupplierCanonicalProductAuthorityError("CANONICAL_PRODUCT_IDENTITY_CONFLICT", "This supplier product already has a different canonical product authority.", 409);
                const authority = product.metadata?.onboardingCanonicalProduct;
                const requestedOffers = normalizedApprovedOffers(input);
                const exactReplay = authority?.authoritative === true
                    && clean(authority.productCode) === productCode
                    && id(authority.supplierCatalogProductId) === id(product)
                    && id(authority.supplierId) === id(product.supplierId)
                    && clean(authority.catalogNamespace).toUpperCase() === clean(product.catalogNamespace).toUpperCase()
                    && clean(authority.supplierProductCode) === clean(product.supplierProductCode)
                    && clean(authority.sourceHash) === clean(product.rawSnapshotHash)
                    && clean(authority.sourceRevision) === clean(product.sourceRevision || product.rawSnapshotHash)
                    && clean(authority.idempotencyKey) === clean(input.idempotencyKey)
                    && canonicalJson(authority.approvedOffers || []) === canonicalJson(requestedOffers)
                    && clean(prior.metadata?.onboardingAuthorityHash) === sha(authority);
                if (!exactReplay) throw new SupplierCanonicalProductAuthorityError("CANONICAL_PRODUCT_IDENTITY_CONFLICT", "Existing canonical product authority does not match this exact request.", 409);
                const audit = typeof repos.auditForAuthority === "function" ? await repos.auditForAuthority(productCode, product._id, authority.idempotencyKey, session) : null;
                if (!audit) throw new SupplierCanonicalProductAuthorityError("CANONICAL_PRODUCT_AUTHORITY_AUDIT_MISSING", "Canonical product authority exists without its mandatory creation audit.", 409);
                return { canonicalProduct: prior, authority, idempotentReplay: true };
            }
            const collision = await repos.canonicalByCode(productCode, session);
            if (collision) throw new SupplierCanonicalProductAuthorityError("CANONICAL_PRODUCT_CODE_CONFLICT", "The proposed canonical product code belongs to another product.", 409);
            const now = clock();
            const approvedOffers = normalizedApprovedOffers(input);
            const authority = { authoritative: true, authorityType: "OWNER_CREATE_NEW_CANONICAL_PRODUCT", productCode, name: clean(input.name || product.displayName || product.rawName || productCode), supplierCatalogProductId: id(product), supplierId: id(product.supplierId), catalogNamespace: product.catalogNamespace, supplierProductCode: product.supplierProductCode, sourceHash: product.rawSnapshotHash, sourceRevision: product.sourceRevision || product.rawSnapshotHash, approvedOfferIds: approvedOffers.map(item => item.supplierCatalogOfferId), approvedOffers, idempotencyKey: clean(input.idempotencyKey), reviewedBy: { adminId: actorId, username: actor.username, role: actor.role }, reviewedAt: now };
            const updated = await repos.updateProductAuthority(product._id, product.rawSnapshotHash, authority, session);
            if (Number(updated?.modifiedCount ?? updated?.nModified ?? 0) !== 1) throw new SupplierCanonicalProductAuthorityError("CANONICAL_PRODUCT_AUTHORITY_CLAIM_CONFLICT", "Canonical product authority was claimed concurrently or the supplier source changed.", 409);
            const canonicalProduct = await repos.createCanonical({ productCode, name: authority.name, enabled: false, commerceState: "HIDDEN", publicDiscoveryEnabled: false, homepageEnabled: false, supportedRegions: [], source: "admin", metadata: { preparedFromSupplierCatalogProductId: id(product), onboardingPrepared: true, onboardingAuthorityHash: sha(authority) } }, session);
            await repos.createAudit({ actorAdminId: actorId, actorUsernameSnapshot: actor.username, actorRoleSnapshot: actor.role, action: "SUPPLIER_CANONICAL_PRODUCT_CREATED", resourceType: "CatalogProduct", resourceId: productCode, requestId: clean(context.requestId), metadata: { supplierCatalogProductId: id(product), supplierId: id(product.supplierId), catalogNamespace: product.catalogNamespace, supplierProductCode: product.supplierProductCode, sourceHash: product.rawSnapshotHash, approvedOfferIds: authority.approvedOfferIds, idempotencyKey: authority.idempotencyKey, commercialImpact: "NONE" } }, session);
            return { canonicalProduct, authority, idempotentReplay: false };
        }); } catch (error) {
            if (!isConcurrentMongoFailure(error) && error?.code !== "CANONICAL_PRODUCT_AUTHORITY_CLAIM_CONFLICT") throw error;
            const recovered = await recoverConcurrentAuthority(input);
            if (recovered) return recovered;
            throw new SupplierCanonicalProductAuthorityError("CANONICAL_PRODUCT_AUTHORITY_RACE_UNRESOLVED", "Concurrent canonical product authority did not produce a verifiable committed winner. Retry safely.", 409, { retryable: true, mongoCode: Number.isFinite(Number(error?.code)) ? Number(error.code) : undefined });
        }
    }

    return { plan, authorize, sourceLock, validateSourceLock, deterministicProductCode, offerLock, offerDisposition, offerWizardState, mutationsEnabled: gate, isConcurrentMongoFailure, recoverConcurrentAuthority };
}

const service = createSupplierCanonicalProductAuthorityService({ routePlanner: require("./supplierRoutePreparationService").generateSupplierRoutePreparationPlan });
module.exports = Object.freeze({ SupplierCanonicalProductAuthorityError, createSupplierCanonicalProductAuthorityService, sourceLock, validateSourceLock, deterministicProductCode, offerLock, offerDisposition, offerWizardState, mutationsEnabled, plan: service.plan, authorize: service.authorize });
