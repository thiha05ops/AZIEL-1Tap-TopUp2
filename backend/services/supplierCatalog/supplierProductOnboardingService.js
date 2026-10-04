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
const PackageSupplierSelection = require("../../models/PackageSupplierSelection");
const AdminAuditLog = require("../../models/AdminAuditLog");
const { getSupplierAdapter } = require("../supplierAdapterRegistry");
const { READINESS_MODES, assessMappingReadiness } = require("../supplierMappingReadinessService");
const reconciliation = require("./supplierCatalogReconciliationService");

const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();
const id = value => clean(value?._id || value);
const hash = value => crypto.createHash("sha256").update(clean(value)).digest("hex");

class SupplierProductOnboardingError extends Error {
    constructor(code, message, statusCode = 400, details = {}) { super(message); this.name = "SupplierProductOnboardingError"; this.code = code; this.statusCode = statusCode; this.details = details; }
}

function canonicalEvidence(offer = {}) {
    const evidence = offer.reconciliationEvidence || {};
    const productCode = lower(evidence.canonicalProductCode || evidence.productCode);
    const packageCode = upper(evidence.canonicalPackageCode || evidence.packageCode);
    return productCode && packageCode ? { productCode, packageCode } : null;
}

function classifyOffer(offer, targetPackage) {
    if (upper(offer.catalogLifecycleState) !== "ACTIVE") return { classification: "BLOCKED", blockers: ["SUPPLIER_OFFER_NOT_ACTIVE"] };
    if (upper(offer.reconciliationState) === "EXACT_CANONICAL_MATCH" && canonicalEvidence(offer) && targetPackage) return { classification: "PROVEN_SAME", blockers: [] };
    const evidence = offer.reconciliationEvidence || {};
    if (upper(offer.reconciliationState) === "NO_CANONICAL_PACKAGE" && evidence.distinctEntitlement === true && lower(evidence.canonicalProductCode || evidence.productCode)) return { classification: "PROVEN_NEW", blockers: [] };
    return { classification: "AMBIGUOUS", blockers: ["CANONICAL_EQUIVALENCE_REVIEW_REQUIRED"] };
}

function createSupplierProductOnboardingService(dependencies = {}) {
    const M = { Supplier: dependencies.Supplier || Supplier, Product: dependencies.Product || SupplierCatalogProduct, Offer: dependencies.Offer || SupplierCatalogOffer, Availability: dependencies.Availability || SupplierOfferAvailability, Mapping: dependencies.Mapping || SupplierProductMapping, CatalogProduct: dependencies.CatalogProduct || CatalogProduct, CatalogPackage: dependencies.CatalogPackage || CatalogPackage, Selection: dependencies.Selection || PackageSupplierSelection, Audit: dependencies.Audit || AdminAuditLog };
    const reconcile = dependencies.reconciliation || reconciliation;
    const adapterResolver = dependencies.adapterResolver || getSupplierAdapter;
    const connection = dependencies.connection || mongoose.connection;
    const lean = query => query.lean();

    async function prepareCanonicalProduct(product, actor, requestId) {
        const authority = product.metadata?.onboardingCanonicalProduct;
        const productCode = lower(authority?.productCode);
        if (!productCode || authority?.authoritative !== true) return null;
        const existing = await lean(M.CatalogProduct.findOne({ productCode }));
        if (existing) return existing;
        const session = await connection.startSession();
        try {
            let created;
            await session.withTransaction(async () => {
                const replay = await M.CatalogProduct.findOne({ productCode }).session(session).lean();
                if (replay) { created = replay; return; }
                created = (await M.CatalogProduct.create([{ productCode, name: clean(authority.name || product.displayName || product.rawName || productCode), enabled: false, commerceState: "HIDDEN", publicDiscoveryEnabled: false, homepageEnabled: false, supportedRegions: [], source: "admin", metadata: { preparedFromSupplierCatalogProductId: id(product), onboardingPrepared: true } }], { session }))[0].toObject();
                await M.Audit.create([{ actorAdminId: actor?.id || actor?._id || null, actorUsernameSnapshot: actor?.username || "", actorRoleSnapshot: actor?.role || "", action: "SUPPLIER_PRODUCT_CANONICAL_PREPARED", resourceType: "CatalogProduct", resourceId: productCode, requestId, metadata: { supplierCatalogProductId: id(product), publicDiscoveryEnabled: false, commerceState: "HIDDEN" } }], { session });
            });
            return created;
        } finally { await session.endSession(); }
    }

    async function onboardSupplierProduct(input = {}, context = {}) {
        if (input.confirmed !== true) throw new SupplierProductOnboardingError("ONBOARDING_CONFIRMATION_REQUIRED", "Explicit Add to AZIEL confirmation is required.");
        const supplierProductId = clean(input.supplierCatalogProductId), markets = [...new Set((input.customerMarkets || [input.customerMarket || "TH"]).map(upper).filter(value => ["TH", "MM"].includes(value)))].sort();
        if (!supplierProductId || !markets.length) throw new SupplierProductOnboardingError("ONBOARDING_SCOPE_REQUIRED", "Supplier product and intended customer market are required.");
        const product = await lean(M.Product.findById(supplierProductId).select("_id supplierId catalogNamespace supplierProductCode supplierMarketCode displayName rawName supportState normalizedInputContract restrictions metadata rawSnapshotHash lastChangedAt sourceRevision"));
        if (!product) throw new SupplierProductOnboardingError("SUPPLIER_CATALOG_PRODUCT_NOT_FOUND", "Persisted supplier catalog product was not found.", 404);
        if (input.supplierId && id(product.supplierId) !== clean(input.supplierId)) throw new SupplierProductOnboardingError("SUPPLIER_SCOPE_MISMATCH", "Supplier product does not belong to the requested supplier.", 409);
        const supplier = await lean(M.Supplier.findById(product.supplierId).select("_id supplierCode name enabled mode configuration"));
        if (!supplier) throw new SupplierProductOnboardingError("SUPPLIER_NOT_FOUND", "Supplier was not found.", 404);
        const offers = await lean(M.Offer.find({ supplierCatalogProductId: product._id }).sort({ supplierOfferCode: 1 }).select("_id supplierCatalogProductId supplierId catalogNamespace supplierProductCode supplierOfferCode supplierOfferName rawName normalizedSemantics catalogLifecycleState reconciliationState reconciliationEvidence rawSnapshotHash sourceRevision lastChangedAt"));
        const offerIds = offers.map(row => row._id);
        const [availability, mappings] = await Promise.all([
            lean(M.Availability.find({ supplierCatalogOfferId: { $in: offerIds } }).select("supplierCatalogOfferId state coverageComplete evidenceCode observedAt staleAt")),
            lean(M.Mapping.find({ supplierId: product.supplierId, $or: [{ supplierCatalogOfferId: { $in: offerIds } }, { supplierProductCode: product.supplierProductCode, region: product.supplierMarketCode }] }))
        ]);
        await prepareCanonicalProduct(product, context.actor, context.requestId || "");
        const availabilityByOffer = new Map(availability.map(row => [id(row.supplierCatalogOfferId), row]));
        const outcomes = [];
        for (const offer of offers) {
            let mapping = mappings.find(row => id(row.supplierCatalogOfferId) === id(offer) || (clean(row.supplierProductCode) === clean(offer.supplierProductCode) && clean(row.supplierPackageCode) === clean(offer.supplierOfferCode) && upper(row.region) === upper(product.supplierMarketCode)));
            let action = mapping ? "REUSED_MAPPING" : "";
            let classification = mapping ? "PROVEN_SAME" : "";
            const evidence = canonicalEvidence(offer);
            const targetPackage = evidence ? await lean(M.CatalogPackage.findOne({ productCode: evidence.productCode, packageCode: evidence.packageCode, deletedAt: null }).select("_id productCode packageCode name enabled prices metadata")) : null;
            const assessed = classifyOffer(offer, targetPackage);
            classification ||= assessed.classification;
            let blockers = [...assessed.blockers];
            if (!mapping && ["PROVEN_SAME", "PROVEN_NEW"].includes(classification)) {
                try {
                    const expectedSource = reconcile.sourceLock({ offer, product, availability: availabilityByOffer.get(id(offer)) });
                    const decisionType = classification === "PROVEN_SAME" ? "LINK_TO_EXISTING_CANONICAL_PACKAGE" : "CREATE_CANONICAL_PACKAGE_AND_LINK";
                    const result = await reconcile.decide({ supplierCatalogOfferId: id(offer), decisionType, confirmed: true, canonicalPackageId: targetPackage?._id, canonicalProductCode: evidence?.productCode || lower(offer.reconciliationEvidence?.canonicalProductCode), canonicalPackageName: clean(offer.supplierOfferName || offer.rawName), region: upper(product.supplierMarketCode), reasonCode: "ADMIN_ADD_TO_AZIEL", reviewNotes: "Deterministic supplier-product onboarding", expectedSource, requestIdempotencyKey: hash(`${clean(input.requestIdempotencyKey || "onboard")}|${id(product)}|${id(offer)}|${decisionType}`) }, { actor: context.actor, requestId: context.requestId || "" });
                    mapping = result.mapping;
                    action = result.idempotentReplay ? "REUSED_DECISION" : classification === "PROVEN_SAME" ? "AUTO_LINKED" : "AUTO_CREATED";
                } catch (error) {
                    if (["CURRENT_DECISION_CONFLICT", "DUPLICATE_MAPPING_CONFLICT"].includes(error.code)) {
                        mapping = await lean(M.Mapping.findOne({ supplierCatalogOfferId: offer._id }));
                        if (mapping) action = "REUSED_MAPPING"; else blockers.push(error.code);
                    } else blockers.push(error.code || "RECONCILIATION_FAILED");
                }
            }
            if (mapping) {
                const readiness = assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping, supplier, offer, availability: availabilityByOffer.get(id(offer)), customerMarket: markets[0], adapter: adapterResolver(supplier) });
                blockers = readiness.blockers;
            }
            const state = mapping ? (blockers.length ? "NEEDS_SETUP" : "READY") : classification === "AMBIGUOUS" ? "NEEDS_REVIEW" : "BLOCKED";
            outcomes.push({ supplierCatalogOfferId: id(offer), supplierOfferCode: offer.supplierOfferCode, supplierOfferName: offer.supplierOfferName || offer.rawName, classification, state, action: action || "NONE", mappingId: id(mapping), canonical: mapping ? { productCode: mapping.productCode, packageCode: mapping.packageCode } : evidence, blockers: [...new Set(blockers)].sort(), reviewUrl: state === "NEEDS_REVIEW" ? `/api/admin/supplier-catalog/offers/${id(offer)}/reconciliation` : "" });
        }
        const counts = key => outcomes.filter(row => row.action === key || row.state === key).length;
        const summary = { total: outcomes.length, reusedMappings: counts("REUSED_MAPPING") + counts("REUSED_DECISION"), autoLinked: counts("AUTO_LINKED"), autoCreated: counts("AUTO_CREATED"), ready: counts("READY"), needsReview: counts("NEEDS_REVIEW"), blocked: counts("BLOCKED"), needsSetup: counts("NEEDS_SETUP") };
        const state = summary.needsReview || summary.blocked ? (summary.ready || summary.needsSetup || summary.reusedMappings || summary.autoLinked || summary.autoCreated ? "PARTIALLY_PREPARED" : "NEEDS_REVIEW") : "PREPARED";
        return { product: { supplierCatalogProductId: id(product), supplierId: id(supplier), supplierCode: supplier.supplierCode, supplierProductCode: product.supplierProductCode, name: product.displayName || product.rawName, supplierMarket: product.supplierMarketCode, onboardingState: state }, customerMarkets: markets, summary, offers: outcomes, safety: { publicationWrites: 0, customerPriceWrites: 0, packageSupplierSelectionWrites: 0, commerceOrderWrites: 0, fulfillmentAttemptWrites: 0, supplierExecutionCalls: 0 } };
    }
    return { onboardSupplierProduct };
}

const service = createSupplierProductOnboardingService();
module.exports = Object.freeze({ SupplierProductOnboardingError, canonicalEvidence, classifyOffer, createSupplierProductOnboardingService, onboardSupplierProduct: service.onboardSupplierProduct });
