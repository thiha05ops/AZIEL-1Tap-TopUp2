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
const SupplierCatalogReconciliationDecision = require("../../models/SupplierCatalogReconciliationDecision");
const { getSupplierAdapter } = require("../supplierAdapterRegistry");
const { READINESS_MODES, assessMappingReadiness } = require("../supplierMappingReadinessService");
const reconciliationModule = require("./supplierCatalogReconciliationService");
const routePreparation = require("./supplierRoutePreparationService");
const { assessCanonicalEquivalenceProof } = require("./canonicalEquivalenceProofService");
const canonicalProductAuthorityModule = require("./supplierCanonicalProductAuthorityService");

const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();
const id = value => clean(value?._id || value);
const hash = value => crypto.createHash("sha256").update(clean(value)).digest("hex");
const WIZARD_STATES = Object.freeze({ READY: "READY", PREPARABLE: "PREPARABLE", NEEDS_ATTENTION: "NEEDS_ATTENTION", UNAVAILABLE: "UNAVAILABLE" });
const UNAVAILABLE_BLOCKERS = new Set(["SUPPLIER_OFFER_NOT_ACTIVE", "SUPPLIER_NOT_API_READY", "SUPPLIER_AVAILABILITY_NOT_CONFIRMED", "CUSTOMER_MARKET_NOT_ELIGIBLE"]);

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

function wizardStateFor({ mapping, classification, blockers = [], equivalenceConflict = false } = {}) {
    if (equivalenceConflict || classification === "AMBIGUOUS") return WIZARD_STATES.NEEDS_ATTENTION;
    if (classification === "BLOCKED" || blockers.some(code => UNAVAILABLE_BLOCKERS.has(code))) return WIZARD_STATES.UNAVAILABLE;
    if (mapping && blockers.length === 0) return WIZARD_STATES.READY;
    if (mapping && mapping.mappingMetadata?.technicalPreparation && blockers.every(code => code === "MAPPING_DISABLED")) return WIZARD_STATES.PREPARABLE;
    if (!mapping && ["PROVEN_SAME", "PROVEN_NEW"].includes(classification) && blockers.length === 0) return WIZARD_STATES.PREPARABLE;
    return WIZARD_STATES.NEEDS_ATTENTION;
}

function createSupplierProductOnboardingService(dependencies = {}) {
    const M = { Supplier: dependencies.Supplier || Supplier, Product: dependencies.Product || SupplierCatalogProduct, Offer: dependencies.Offer || SupplierCatalogOffer, Availability: dependencies.Availability || SupplierOfferAvailability, Mapping: dependencies.Mapping || SupplierProductMapping, Decision: dependencies.Decision || SupplierCatalogReconciliationDecision, CatalogProduct: dependencies.CatalogProduct || CatalogProduct, CatalogPackage: dependencies.CatalogPackage || CatalogPackage, Selection: dependencies.Selection || PackageSupplierSelection, Audit: dependencies.Audit || AdminAuditLog };
    const canonicalProductAuthority = dependencies.canonicalProductAuthority || canonicalProductAuthorityModule;
    const reconcile = dependencies.reconciliation || reconciliationModule.createSupplierCatalogReconciliationService({ mutationsEnabled: () => canonicalProductAuthority.mutationsEnabled() === true });
    const prepareRoute = dependencies.routePreparation || routePreparation;
    const adapterResolver = dependencies.adapterResolver || getSupplierAdapter;
    const connection = dependencies.connection || mongoose.connection;
    const lean = query => query.lean();
    const assessRequestedMarkets = ({ mapping, supplier, offer, availability, markets }) => {
        const assessments = markets.map(customerMarket => assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping, supplier, offer, availability, customerMarket, adapter: adapterResolver(supplier) }));
        return { ready: assessments.every(item => item.ready), blockers: [...new Set(assessments.flatMap(item => item.blockers))].sort() };
    };

    async function onboardSupplierProduct(input = {}, context = {}) {
        if (input.confirmed !== true) throw new SupplierProductOnboardingError("ONBOARDING_CONFIRMATION_REQUIRED", "Explicit Add to AZIEL confirmation is required.");
        if (upper(context.actor?.role) !== "OWNER") throw new SupplierProductOnboardingError("OWNER_ONBOARDING_REQUIRED", "Only the Owner can prepare a supplier product for AZIEL.", 403);
        const supplierProductId = clean(input.supplierCatalogProductId), markets = [...new Set((input.customerMarkets || [input.customerMarket || "TH"]).map(upper).filter(value => ["TH", "MM"].includes(value)))].sort();
        if (!supplierProductId || !markets.length) throw new SupplierProductOnboardingError("ONBOARDING_SCOPE_REQUIRED", "Supplier product and intended customer market are required.");
        const product = await lean(M.Product.findById(supplierProductId).select("_id supplierId catalogNamespace supplierProductCode supplierMarketCode displayName rawName supportState normalizedInputContract restrictions metadata rawSnapshotHash lastChangedAt sourceRevision"));
        if (!product) throw new SupplierProductOnboardingError("SUPPLIER_CATALOG_PRODUCT_NOT_FOUND", "Persisted supplier catalog product was not found.", 404);
        if (input.supplierId && id(product.supplierId) !== clean(input.supplierId)) throw new SupplierProductOnboardingError("SUPPLIER_SCOPE_MISMATCH", "Supplier product does not belong to the requested supplier.", 409);
        const supplier = await lean(M.Supplier.findById(product.supplierId).select("_id supplierCode name enabled mode configuration"));
        if (!supplier) throw new SupplierProductOnboardingError("SUPPLIER_NOT_FOUND", "Supplier was not found.", 404);
        const offers = await lean(M.Offer.find({ supplierCatalogProductId: product._id }).sort({ supplierOfferCode: 1 }).select("_id supplierCatalogProductId supplierId catalogNamespace supplierProductCode supplierOfferCode supplierOfferName rawName normalizedSemantics catalogLifecycleState reconciliationState reconciliationEvidence rawSnapshotHash sourceRevision lastChangedAt"));
        const offerIds = offers.map(row => row._id);
        const [availability, mappings, decisions] = await Promise.all([
            lean(M.Availability.find({ supplierCatalogOfferId: { $in: offerIds } }).select("supplierCatalogOfferId state coverageComplete evidenceCode observedAt staleAt")),
            lean(M.Mapping.find({ supplierId: product.supplierId, $or: [{ supplierCatalogOfferId: { $in: offerIds } }, { supplierProductCode: product.supplierProductCode, region: product.supplierMarketCode }] })),
            lean(M.Decision.find({ supplierCatalogOfferId: { $in: offerIds }, isCurrent: true }))
        ]);
        let canonicalAuthority = product.metadata?.onboardingCanonicalProduct || null;
        const mappedProductCodes = [...new Set(mappings.map(item => lower(item.productCode)).filter(Boolean))];
        const exactEvidenceProductCodes = [...new Set(offers.filter(item => upper(item.reconciliationState) === "EXACT_CANONICAL_MATCH").map(item => canonicalEvidence(item)?.productCode).filter(Boolean))];
        const provenExistingCode = mappedProductCodes.length === 1 ? mappedProductCodes[0] : !mappedProductCodes.length && exactEvidenceProductCodes.length === 1 ? exactEvidenceProductCodes[0] : "";
        let canonicalProduct = canonicalAuthority?.productCode ? await lean(M.CatalogProduct.findOne({ productCode: lower(canonicalAuthority.productCode), deletedAt: null })) : await lean(M.CatalogProduct.findOne({ "metadata.preparedFromSupplierCatalogProductId": id(product), deletedAt: null }));
        if (!canonicalProduct && provenExistingCode) canonicalProduct = await lean(M.CatalogProduct.findOne({ productCode: provenExistingCode, deletedAt: null }));
        if (!canonicalProduct && input.canonicalProductApproval?.confirmed === true) {
            const approved = await canonicalProductAuthority.authorize({ ...input.canonicalProductApproval, supplierCatalogProductId: id(product), approvedOffers: input.offerApprovals || [] }, context);
            canonicalProduct = approved.canonicalProduct;
            canonicalAuthority = approved.authority || { authoritative: true, productCode: canonicalProduct.productCode };
        }
        if (!canonicalProduct) throw new SupplierProductOnboardingError("CANONICAL_PRODUCT_AUTHORITY_REQUIRED", "This product is new to AZIEL. Owner confirmation is required before packages can be prepared.", 409, { onboardingPlanRequired: true });
        const effectiveOfferApprovals = (input.offerApprovals || []).length ? input.offerApprovals : canonicalAuthority?.approvedOffers || [];
        const approvedOfferLocks = new Map(effectiveOfferApprovals.map(item => [clean(item.supplierCatalogOfferId), item.expectedSource]));
        const boundedNewProductApproval = input.canonicalProductApproval?.confirmed === true || canonicalAuthority?.authorityType === "OWNER_CREATE_NEW_CANONICAL_PRODUCT";
        const availabilityByOffer = new Map(availability.map(row => [id(row.supplierCatalogOfferId), row]));
        const decisionByOffer = new Map(decisions.map(row => [id(row.supplierCatalogOfferId), row]));
        const outcomes = [];
        for (const offer of offers) {
            let mapping = mappings.find(row => id(row.supplierCatalogOfferId) === id(offer) || (clean(row.supplierProductCode) === clean(offer.supplierProductCode) && clean(row.supplierPackageCode) === clean(offer.supplierOfferCode) && upper(row.region) === upper(product.supplierMarketCode)));
            let action = mapping ? "REUSED_MAPPING" : "";
            let classification = mapping ? "PROVEN_SAME" : "";
            const evidence = canonicalEvidence(offer);
            const targetPackage = evidence ? await lean(M.CatalogPackage.findOne({ productCode: evidence.productCode, packageCode: evidence.packageCode, deletedAt: null }).select("_id productCode packageCode name enabled prices metadata")) : null;
            const explicitlyApprovedNew = boundedNewProductApproval && approvedOfferLocks.has(id(offer)) && upper(offer.catalogLifecycleState) === "ACTIVE" && ["NO_CANONICAL_PACKAGE", "UNREVIEWED"].includes(upper(offer.reconciliationState));
            const assessed = explicitlyApprovedNew ? { classification: "PROVEN_NEW", blockers: [] } : classifyOffer(offer, targetPackage);
            let equivalenceConflict = false;
            let blockers;
            if (mapping) {
                const canonicalProduct = await lean(M.CatalogProduct.findOne({ productCode: lower(mapping.productCode), deletedAt: null }).select("_id productCode"));
                const canonicalPackages = await lean(M.CatalogPackage.find({ productCode: lower(mapping.productCode), packageCode: upper(mapping.packageCode), deletedAt: null }).select("_id productCode packageCode"));
                const proof = assessCanonicalEquivalenceProof({ supplierProduct: product, offer, mapping, reconciliationDecision: decisionByOffer.get(id(offer)), canonicalProduct, canonicalPackages });
                classification = proof.classification;
                blockers = [...proof.blockers];
                equivalenceConflict = !proof.proven;
            } else {
                classification ||= assessed.classification;
                blockers = [...assessed.blockers];
            }
            if (!mapping && ["PROVEN_SAME", "PROVEN_NEW"].includes(classification)) {
                try {
                    const expectedSource = approvedOfferLocks.get(id(offer)) || reconcile.sourceLock({ offer, product, availability: availabilityByOffer.get(id(offer)) });
                    const decisionType = classification === "PROVEN_SAME" ? "LINK_TO_EXISTING_CANONICAL_PACKAGE" : "CREATE_CANONICAL_PACKAGE_AND_LINK";
                    const result = await reconcile.decide({ supplierCatalogOfferId: id(offer), decisionType, confirmed: true, canonicalPackageId: targetPackage?._id, canonicalProductCode: evidence?.productCode || lower(offer.reconciliationEvidence?.canonicalProductCode) || lower(canonicalProduct.productCode), canonicalPackageName: clean(offer.supplierOfferName || offer.rawName), region: upper(product.supplierMarketCode), reasonCode: "ADMIN_ADD_TO_AZIEL", reviewNotes: "Bounded deterministic supplier-product onboarding", expectedSource, requestIdempotencyKey: hash(`${clean(input.requestIdempotencyKey || "onboard")}|${id(product)}|${id(offer)}|${decisionType}`) }, { actor: context.actor, requestId: context.requestId || "" });
                    mapping = result.mapping;
                    action = result.idempotentReplay ? "REUSED_DECISION" : classification === "PROVEN_SAME" ? "AUTO_LINKED" : "AUTO_CREATED";
                } catch (error) {
                    if (["CURRENT_DECISION_CONFLICT", "DUPLICATE_MAPPING_CONFLICT"].includes(error.code)) {
                        mapping = await lean(M.Mapping.findOne({ supplierCatalogOfferId: offer._id }));
                        if (mapping) action = "REUSED_MAPPING"; else blockers.push(error.code);
                    } else blockers.push(error.code || "RECONCILIATION_FAILED");
                }
            }
            if (mapping && !equivalenceConflict) {
                const initialReadiness = assessRequestedMarkets({ mapping, supplier, offer, availability: availabilityByOffer.get(id(offer)), markets });
                const existingContract = mapping.mappingMetadata?.fulfillmentContract;
                const intentionallyDisabled = action === "REUSED_MAPPING" && mapping.enabled === false && !mapping.mappingMetadata?.reconciliationDecision && !mapping.mappingMetadata?.technicalPreparation;
                if (!initialReadiness.ready && !intentionallyDisabled) {
                    try {
                        const plan = await prepareRoute.generateSupplierRoutePreparationPlan({ mappingId: id(mapping), customerMarkets: markets });
                        if (plan.outcome === "FULFILLMENT_READY" && plan.proposedChanges) {
                            if (existingContract && existingContract.fingerprint && plan.proposedChanges.fulfillmentContract?.fingerprint !== existingContract.fingerprint) {
                                blockers.push("ADOPTION_REVIEW_REQUIRED");
                            } else {
                                const prepared = await prepareRoute.applySupplierRoutePreparationPlan(plan, { actor: context.actor, confirmed: true });
                                mapping = await lean(M.Mapping.findById(prepared.mappingId || mapping._id));
                                action = prepared.idempotentReplay ? "REUSED_PREPARATION" : `${action || "REUSED_MAPPING"}_ROUTE_PREPARED`;
                            }
                        } else blockers.push(...(plan.blockers || []));
                    } catch (error) { blockers.push(error.code || "PREPARATION_FAILED"); }
                } else if (intentionallyDisabled) blockers.push("ADOPTION_REVIEW_REQUIRED");
                const readiness = assessRequestedMarkets({ mapping, supplier, offer, availability: availabilityByOffer.get(id(offer)), markets });
                blockers = [...blockers, ...readiness.blockers];
                if (intentionallyDisabled) blockers.push("ADOPTION_REVIEW_REQUIRED");
            }
            blockers = [...new Set(blockers)].sort();
            const state = wizardStateFor({ mapping, classification, blockers, equivalenceConflict });
            outcomes.push({ supplierCatalogOfferId: id(offer), supplierOfferCode: offer.supplierOfferCode, supplierOfferName: offer.supplierOfferName || offer.rawName, classification, state, selectable: [WIZARD_STATES.READY, WIZARD_STATES.PREPARABLE].includes(state), action: action || "NONE", mappingId: id(mapping), supplierMarket: upper(mapping?.region), canonical: mapping ? { productCode: mapping.productCode, packageCode: mapping.packageCode } : evidence, blockers: [...new Set(blockers)].sort(), reviewUrl: state === WIZARD_STATES.NEEDS_ATTENTION ? `/api/admin/supplier-catalog/offers/${id(offer)}/reconciliation` : "" });
        }
        const actionCount = key => outcomes.filter(row => row.action === key || row.action.startsWith(`${key}_`)).length;
        const stateCount = key => outcomes.filter(row => row.state === key).length;
        const summary = { total: outcomes.length, selectable: outcomes.filter(row => row.selectable).length, ready: stateCount(WIZARD_STATES.READY), preparable: stateCount(WIZARD_STATES.PREPARABLE), needsAttention: stateCount(WIZARD_STATES.NEEDS_ATTENTION), unavailable: stateCount(WIZARD_STATES.UNAVAILABLE), reusedMappings: actionCount("REUSED_MAPPING") + actionCount("REUSED_DECISION") + actionCount("REUSED_PREPARATION"), created: actionCount("AUTO_CREATED"), linked: actionCount("AUTO_LINKED") };
        if (summary.total !== summary.ready + summary.preparable + summary.needsAttention + summary.unavailable || summary.selectable !== summary.ready + summary.preparable) throw new SupplierProductOnboardingError("WIZARD_STATE_INVARIANT_FAILED", "Supplier package preparation state is internally inconsistent.", 500);
        const state = summary.selectable ? (summary.needsAttention || summary.unavailable ? "PARTIALLY_AVAILABLE" : "AVAILABLE") : summary.needsAttention ? WIZARD_STATES.NEEDS_ATTENTION : WIZARD_STATES.UNAVAILABLE;
        const prepared = outcomes.filter(row => row.mappingId && row.selectable && row.canonical?.productCode && row.canonical?.packageCode && row.supplierMarket);
        const productCodes = [...new Set(prepared.map(row => lower(row.canonical.productCode)))];
        const supplierMarkets = [...new Set(prepared.map(row => upper(row.supplierMarket)))];
        const continuation = {
            canContinue: prepared.length > 0 && productCodes.length === 1 && supplierMarkets.length === 1,
            productCode: productCodes.length === 1 ? productCodes[0] : "",
            supplierId: id(supplier), supplierMarket: supplierMarkets.length === 1 ? supplierMarkets[0] : "",
            mappingIds: prepared.map(row => row.mappingId), packageCodes: [...new Set(prepared.map(row => upper(row.canonical.packageCode)))].sort(),
            preparedCount: prepared.length, selectableCount: summary.selectable, exceptionCount: summary.needsAttention, needsAttentionCount: summary.needsAttention, unavailableCount: summary.unavailable
        };
        return { product: { supplierCatalogProductId: id(product), supplierId: id(supplier), supplierCode: supplier.supplierCode, supplierProductCode: product.supplierProductCode, name: product.displayName || product.rawName, supplierMarket: product.supplierMarketCode, onboardingState: state }, customerMarkets: markets, summary, continuation, offers: outcomes, safety: { publicationWrites: 0, customerPriceWrites: 0, packageSupplierSelectionWrites: 0, commerceOrderWrites: 0, fulfillmentAttemptWrites: 0, supplierExecutionCalls: 0 } };
    }
    return { onboardSupplierProduct };
}

const service = createSupplierProductOnboardingService();
module.exports = Object.freeze({ WIZARD_STATES, SupplierProductOnboardingError, canonicalEvidence, classifyOffer, wizardStateFor, createSupplierProductOnboardingService, onboardSupplierProduct: service.onboardSupplierProduct });
