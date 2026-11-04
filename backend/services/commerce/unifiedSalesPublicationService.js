"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const CatalogProduct = require("../../models/CatalogProduct");
const CatalogPackage = require("../../models/CatalogPackage");
const Supplier = require("../../models/Supplier");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const SupplierCatalogOffer = require("../../models/SupplierCatalogOffer");
const SupplierCatalogProduct = require("../../models/SupplierCatalogProduct");
const SupplierOfferAvailability = require("../../models/SupplierOfferAvailability");
const SupplierCatalogLatestCost = require("../../models/SupplierCatalogLatestCost");
const SupplierCatalogIngestionRun = require("../../models/SupplierCatalogIngestionRun");
const StoreCatalogSelection = require("../../models/StoreCatalogSelection");
const PackageSupplierSelection = require("../../models/PackageSupplierSelection");
const PackageMarketPublication = require("../../models/PackageMarketPublication");
const FulfillmentAttempt = require("../../models/FulfillmentAttempt");
const AdminAuditLog = require("../../models/AdminAuditLog");
const { validateLatestRow } = require("../supplierCatalog/supplierLatestCostService");
const { assessExistingPreparedRoute } = require("../supplierCatalog/supplierRoutePreparationService");
const { READINESS_MODES, assessMappingReadiness } = require("../supplierMappingReadinessService");
const { getSupplierAdapter } = require("../supplierAdapterRegistry");

const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const id = value => clean(value?._id || value);
const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const UNVERIFIED_LAUNCH_STATUS = "OWNER_APPROVED_UNVERIFIED_LAUNCH";
const UNVERIFIED_LAUNCH_ACKNOWLEDGEMENT = "OWNER APPROVES PUBG AUTO LAUNCH WITHOUT PRIOR SUCCESS";

class UnifiedSalesPublicationError extends Error {
    constructor(code, message, statusCode = 409, details = {}) { super(message); this.name = "UnifiedSalesPublicationError"; this.code = code; this.statusCode = statusCode; this.details = details; }
}
const fail = (condition, code, message, details) => { if (!condition) throw new UnifiedSalesPublicationError(code, message, 409, details); };

function validReviewedPrices(regions = [], pricePatches = {}) {
    return regions.length > 0 && regions.every(region => {
        const price = pricePatches[region];
        return price && price.enabled !== false && Number.isFinite(Number(price.amount)) && Number(price.amount) > 0 && upper(price.currency) === (region === "TH" ? "THB" : "MMK");
    });
}

function exactAuthority(mapping, latest, run, now, maximumAgeMs) {
    const authority = mapping?.supplierCostAuthority || {};
    const observedAt = new Date(authority.observedAt || authority.capturedAt).getTime();
    const latestAt = new Date(latest?.validatedObservedAt).getTime();
    const blockers = [];
    if (upper(authority.verificationMode) !== "AUTOMATIC_VERIFIED_API") blockers.push("SUPPLIER_COST_VERIFICATION_INVALID");
    if (!(Number(authority.rawSupplierCost) > 0) || !upper(authority.supplierCurrency)) blockers.push("SUPPLIER_COST_AUTHORITY_MISSING");
    if (!Number.isFinite(observedAt) || now - observedAt > maximumAgeMs || observedAt > now + 300000) blockers.push("SUPPLIER_COST_AUTHORITY_STALE");
    if (!latest || !run) blockers.push("LATEST_COST_EVIDENCE_MISSING");
    else {
        try { validateLatestRow(latest, run); } catch (error) { blockers.push(error.code || "LATEST_COST_EVIDENCE_INVALID"); }
        if (id(latest.ingestionRunId) !== id(authority.ingestionRunId)) blockers.push("LATEST_COST_RUN_MISMATCH");
        if (id(latest.supplierId) !== id(mapping.supplierId) || clean(latest.supplierProductCode) !== clean(mapping.supplierProductCode) || clean(latest.supplierOfferCode) !== clean(mapping.supplierPackageCode)) blockers.push("SUPPLIER_COST_IDENTITY_MISMATCH");
        if (Number(latest.amount) !== Number(authority.rawSupplierCost) || upper(latest.currency) !== upper(authority.supplierCurrency)) blockers.push("SUPPLIER_COST_REVIEW_REQUIRED");
        if (clean(latest.rawSnapshotHash) !== clean(authority.rawSnapshotHash) || clean(latest.observedCostHash) !== clean(authority.observedCostHash)) blockers.push("LATEST_COST_HASH_MISMATCH");
        if (!Number.isFinite(latestAt) || now - latestAt > maximumAgeMs) blockers.push("LATEST_COST_EVIDENCE_STALE");
    }
    return [...new Set(blockers)];
}

function createUnifiedSalesPublicationService(models = {}, dependencies = {}) {
    const M = {
        Product: models.Product || CatalogProduct, Package: models.Package || CatalogPackage, Supplier: models.Supplier || Supplier,
        Mapping: models.Mapping || SupplierProductMapping, Offer: models.Offer || SupplierCatalogOffer, SupplierProduct: models.SupplierProduct || SupplierCatalogProduct,
        Availability: models.Availability || SupplierOfferAvailability, LatestCost: models.LatestCost || SupplierCatalogLatestCost, Run: models.Run || SupplierCatalogIngestionRun,
        StoreSelection: models.StoreSelection || StoreCatalogSelection, PackageSelection: models.PackageSelection || PackageSupplierSelection,
        Publication: models.Publication || PackageMarketPublication, Attempt: models.Attempt || FulfillmentAttempt, Audit: models.Audit || AdminAuditLog
    };
    const adapterFor = dependencies.adapterFor || getSupplierAdapter;
    const technicalAssessment = dependencies.technicalAssessment || assessExistingPreparedRoute;
    const readinessAssessment = dependencies.readinessAssessment || assessMappingReadiness;
    const clock = dependencies.clock || (() => new Date());
    const transaction = dependencies.transaction || (async callback => { const session = await mongoose.startSession(); try { let value; await session.withTransaction(async () => { value = await callback(session); }); return value; } finally { await session.endSession(); } });
    const lean = (query, session) => (session && query.session ? query.session(session) : query).lean();

    async function load(input, session = null) {
        const mapping = await lean(M.Mapping.findById(input.mappingId), session);
        if (!mapping) return { mapping: null };
        const [product, pkg, supplier, offer, availability, latest, controlled] = await Promise.all([
            lean(M.Product.findOne({ productCode: mapping.productCode }), session),
            lean(M.Package.findOne({ productCode: mapping.productCode, packageCode: mapping.packageCode }), session),
            lean(M.Supplier.findById(mapping.supplierId), session),
            lean(M.Offer.findById(mapping.supplierCatalogOfferId), session),
            lean(M.Availability.findOne({ supplierCatalogOfferId: mapping.supplierCatalogOfferId }), session),
            lean(M.LatestCost.findById(mapping.supplierCatalogOfferId), session),
            lean(M.Attempt.findOne({ supplierMappingId: mapping._id, status: "SUCCEEDED", supplierReference: { $ne: "" } }), session)
        ]);
        const run = latest ? await lean(M.Run.findById(latest.ingestionRunId), session) : null;
        const supplierProduct = offer ? await lean(M.SupplierProduct.findById(offer.supplierCatalogProductId), session) : null;
        return { mapping, product, pkg, supplier, offer, availability, latest, run, supplierProduct, controlled };
    }

    async function preflight(input, { session = null } = {}) {
        const state = await load(input, session), blockers = [];
        if (!state.mapping) blockers.push("SUPPLIER_MAPPING_REQUIRED");
        if (!state.product || state.product.enabled !== true || state.product.deletedAt) blockers.push("CANONICAL_PRODUCT_DISABLED");
        if (!state.pkg || state.pkg.enabled !== true || state.pkg.deletedAt) blockers.push("CANONICAL_PACKAGE_DISABLED");
        if (state.mapping && (id(state.mapping.supplierCatalogOfferId) !== id(state.offer) || id(state.mapping.supplierId) !== id(state.supplier) || clean(state.mapping.supplierProductCode) !== clean(state.offer?.supplierProductCode) || clean(state.mapping.supplierPackageCode) !== clean(state.offer?.supplierOfferCode))) blockers.push("EXACT_SUPPLIER_IDENTITY_MISMATCH");
        const now = clock().getTime(), maximumAgeMs = Math.min(Number(input.maximumObservationAgeMs || 86400000), 86400000);
        if (state.mapping) blockers.push(...exactAuthority(state.mapping, state.latest, state.run, now, maximumAgeMs));
        const availabilityAt = new Date(state.availability?.observedAt).getTime();
        if (upper(state.offer?.catalogLifecycleState) !== "ACTIVE" || upper(state.availability?.state) !== "AVAILABLE" || state.availability?.staleAt || !Number.isFinite(availabilityAt) || now - availabilityAt > maximumAgeMs) blockers.push("SUPPLIER_AVAILABILITY_NOT_CURRENT");
        if (state.latest && state.availability && id(state.availability.observationRunId) !== id(state.latest.ingestionRunId)) blockers.push("COST_AVAILABILITY_RUN_MISMATCH");
        if (state.latest && state.offer && (id(state.latest.supplierCatalogProductId) !== id(state.offer.supplierCatalogProductId) || upper(state.latest.catalogNamespace) !== upper(state.offer.catalogNamespace))) blockers.push("SUPPLIER_CATALOG_IDENTITY_MISMATCH");
        if (!validReviewedPrices(input.regions || [], input.pricePatches || {})) blockers.push("REVIEWED_PRICES_INVALID");
        if ((input.regions || []).some(region => (input.regionalPreviews?.[region]?.blockingErrors || []).length)) blockers.push("PRICING_FINANCIAL_FLOOR_BLOCKED");
        let technical = null;
        if (state.mapping && state.supplier && state.offer && state.supplierProduct) {
            technical = technicalAssessment({ mapping: state.mapping, supplier: state.supplier, supplierProduct: state.supplierProduct, offer: state.offer, availability: state.availability, canonicalProduct: state.product, canonicalPackages: state.pkg ? [state.pkg] : [] }, input.regions, { adapterResolver: adapterFor });
            blockers.push(...(technical.blockers || []));
        }
        const unverifiedPubgAutoLaunch = clean(state.mapping?.supplierProductCode) === "pubg_mobile_auto" && !state.controlled;
        if (unverifiedPubgAutoLaunch && !(input.ownerApprovedUnverifiedLaunch === true && clean(input.unverifiedLaunchAcknowledgement) === UNVERIFIED_LAUNCH_ACKNOWLEDGEMENT)) blockers.push("OWNER_UNVERIFIED_LAUNCH_APPROVAL_REQUIRED");
        const manifest = { mappingId: id(state.mapping), mappingUpdatedAt: state.mapping?.updatedAt || null, packageUpdatedAt: state.pkg?.updatedAt || null, offerHash: state.offer?.rawSnapshotHash || "", availabilityObservedAt: state.availability?.observedAt || null, costHash: state.latest?.observedCostHash || "", launchStatus: unverifiedPubgAutoLaunch ? UNVERIFIED_LAUNCH_STATUS : "PROVEN_OR_NOT_REQUIRED", prices: input.pricePatches, regions: input.regions };
        return { ready: blockers.length === 0, blockers: [...new Set(blockers)].sort(), planHash: sha(manifest), manifest, state, technical };
    }

    async function publish(input = {}, context = {}) {
        fail(upper(context.actor?.role) === "OWNER", "OWNER_PUBLICATION_REQUIRED", "Only the Owner can publish a sellable package.");
        fail(input.confirmed === true, "PUBLICATION_CONFIRMATION_REQUIRED", "Explicit Owner publication confirmation is required.");
        const result = await transaction(async session => {
            const plan = await preflight(input, { session });
            fail(plan.ready, "PACKAGE_NOT_SELLABLE", "Package cannot be published safely.", { blockers: plan.blockers });
            const { state } = plan, mapping = await M.Mapping.findById(state.mapping._id).session(session), pkg = await M.Package.findById(state.pkg._id).session(session);
            fail(mapping && pkg && new Date(mapping.updatedAt).getTime() === new Date(plan.manifest.mappingUpdatedAt).getTime() && new Date(pkg.updatedAt).getTime() === new Date(plan.manifest.packageUpdatedAt).getTime(), "PUBLICATION_SOURCE_STALE", "Package or route changed during publication.");
            const currentStore = await lean(M.StoreSelection.findOne({ productCode: mapping.productCode, supplierMarket: upper(mapping.region) }), session);
            fail(!currentStore || id(currentStore.supplierId) === id(mapping.supplierId), "STORE_CATALOG_SUPPLIER_CONFLICT", "Existing Store Catalog packages use a different supplier for this supplier market.");
            const otherPrimaries = await M.Mapping.find({ _id: { $ne: mapping._id }, productCode: mapping.productCode, packageCode: mapping.packageCode, region: mapping.region, productionRole: "PRIMARY", archivedAt: null }).session(session);
            for (const other of otherPrimaries) { other.enabled = false; other.productionRole = "DISABLED"; other.mappingMetadata = { ...(other.mappingMetadata || {}), readiness: { ...(other.mappingMetadata?.readiness || {}), storefrontReady: false } }; await other.save({ session }); }
            mapping.enabled = true; mapping.productionRole = "PRIMARY"; mapping.executionMode = "API";
            const unverifiedPubgAutoLaunch = clean(mapping.supplierProductCode) === "pubg_mobile_auto" && !state.controlled;
            const launchVerification = unverifiedPubgAutoLaunch ? { status: UNVERIFIED_LAUNCH_STATUS, approvedAt: clock(), approvedBy: clean(context.actor.username), acknowledgement: UNVERIFIED_LAUNCH_ACKNOWLEDGEMENT, evidence: "OWNER_RISK_ACCEPTANCE_NO_PRIOR_SUCCESS" } : { status: state.controlled ? "PROVEN_FULFILLMENT_SUCCESS" : "NOT_REQUIRED", verifiedAt: clock() };
            mapping.mappingMetadata = { ...(mapping.mappingMetadata || {}), fulfillmentContract: plan.technical.fulfillmentContract, fulfillmentVerification: launchVerification, readiness: { ...(mapping.mappingMetadata?.readiness || {}), supplierMapped: true, inputReady: true, validationReady: true, fulfillmentReady: true, pricingReady: true, storefrontReady: true }, unifiedPublication: { planHash: plan.planHash, publishedAt: clock(), publishedBy: clean(context.actor.username) } };
            await mapping.save({ session });
            if (unverifiedPubgAutoLaunch) await M.Audit.create([{ actorAdminId: context.actor.id || context.actor._id || null, actorUsernameSnapshot: clean(context.actor.username), actorRoleSnapshot: "OWNER", action: UNVERIFIED_LAUNCH_STATUS, resourceType: "SupplierProductMapping", resourceId: id(mapping), requestId: clean(context.requestId), method: "POST", route: "unified-sales-publication", metadata: { planHash: plan.planHash, productCode: mapping.productCode, packageCode: mapping.packageCode, supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode, acknowledgement: UNVERIFIED_LAUNCH_ACKNOWLEDGEMENT, successfulFulfillmentObserved: false } }], { session, ordered: true });
            await M.PackageSelection.findOneAndUpdate({ productCode: mapping.productCode, packageCode: mapping.packageCode, customerMarket: "GLOBAL" }, { $set: { supplierMappingId: mapping._id, selectedByAdminId: context.actor.id || context.actor._id || null, selectedByUsernameSnapshot: clean(context.actor.username), selectedAt: clock(), reason: "Unified Daily Pricing publication" }, $inc: { decisionVersion: 1 } }, { upsert: true, new: true, session, setDefaultsOnInsert: true, runValidators: true });
            const packages = [...(currentStore?.packages || []).filter(item => upper(item.packageCode) !== upper(mapping.packageCode)), { packageCode: mapping.packageCode, supplierProductMappingId: mapping._id }];
            const sellingRegions = [...new Set([...(currentStore?.sellingRegions || []), ...input.regions])];
            const visibleRegions = [...new Set([...(currentStore?.visibleRegions || []), ...input.regions])];
            await M.StoreSelection.findOneAndUpdate({ productCode: mapping.productCode, supplierMarket: upper(mapping.region) }, { $set: { supplierId: mapping.supplierId, supplierCode: mapping.supplierCode, sellingRegions, visibleRegions, packages, status: "ACTIVE", selectedBy: clean(context.actor.username), selectedAt: clock(), removedBy: "", removedAt: null, provenance: { source: "UNIFIED_DAILY_PRICING", sourceHash: plan.planHash, planHash: plan.planHash, reversible: true } }, $inc: { decisionVersion: 1 } }, { upsert: true, new: true, session, setDefaultsOnInsert: true, runValidators: true });
            const publishedAt = clock();
            const history = [];
            for (const region of input.regions) {
                const previousPublishedPrice = pkg.prices?.[region]?.amount == null ? null : Number(pkg.prices[region].amount);
                pkg.set(`prices.${region}`, input.pricePatches[region]);
                const evidence = (input.pricingPublicationEvidence || []).find(item => item.region === region) || {};
                history.push({ ...evidence, region, previousPublishedPrice, newPublishedPrice: Number(input.pricePatches[region].amount), currency: input.pricePatches[region].currency, publishedBy: clean(context.actor.username), publishedAt });
            }
            pkg.pricingPublicationHistory = (Array.isArray(pkg.pricingPublicationHistory) ? pkg.pricingPublicationHistory : []).concat(history).slice(-100);
            await pkg.save({ session });
            await M.Publication.findOneAndUpdate({ productCode: mapping.productCode, packageCode: mapping.packageCode, customerMarket: "GLOBAL" }, { $set: { published: true, publishedAt: clock(), publishedBy: clean(context.actor.username), unpublishedAt: null, unpublishedBy: "", decisionNote: "Unified Daily Pricing publication", provenance: { source: "UNIFIED_DAILY_PRICING", metadata: { planHash: plan.planHash, mappingId: id(mapping) } } }, $inc: { decisionVersion: 1 } }, { upsert: true, new: true, session, setDefaultsOnInsert: true, runValidators: true });
            const [verifiedSelection, verifiedStore, verifiedPublication] = await Promise.all([
                lean(M.PackageSelection.findOne({ productCode: mapping.productCode, packageCode: mapping.packageCode, customerMarket: "GLOBAL" }), session),
                lean(M.StoreSelection.findOne({ productCode: mapping.productCode, supplierMarket: upper(mapping.region), status: "ACTIVE" }), session),
                lean(M.Publication.findOne({ productCode: mapping.productCode, packageCode: mapping.packageCode, customerMarket: "GLOBAL", published: true }), session)
            ]);
            fail(id(verifiedSelection?.supplierMappingId) === id(mapping), "POST_PUBLICATION_SELECTION_INVALID", "The checkout supplier selection was not persisted atomically.");
            fail((verifiedStore?.packages || []).some(item => upper(item.packageCode) === upper(mapping.packageCode) && id(item.supplierProductMappingId) === id(mapping)), "POST_PUBLICATION_STORE_SELECTION_INVALID", "The Store Catalog selection was not persisted atomically.");
            fail(Boolean(verifiedPublication), "POST_PUBLICATION_MARKET_STATE_INVALID", "The package market publication was not persisted atomically.");
            const projected = mapping.toObject({ minimize: false }), adapter = adapterFor(state.supplier);
            for (const market of input.regions) {
                const assessment = readinessAssessment({ mode: READINESS_MODES.PUBLIC_PURCHASABLE, mapping: projected, supplier: state.supplier, offer: state.offer, availability: state.availability, customerMarket: market, adapter, pkg: pkg.toObject({ minimize: false }) });
                fail(assessment.ready, "POST_PUBLICATION_NOT_PURCHASABLE", "Post-publication route verification failed.", { market, blockers: assessment.blockers });
            }
            return { published: true, planHash: plan.planHash, mappingId: id(mapping), productCode: mapping.productCode, packageCode: mapping.packageCode, regions: input.regions, purchasable: true };
        });
        require("../catalogService").clearPublicCatalogCaches(result.productCode);
        return result;
    }
    return Object.freeze({ preflight, publish });
}

const service = createUnifiedSalesPublicationService();
module.exports = Object.freeze({ UNVERIFIED_LAUNCH_STATUS, UNVERIFIED_LAUNCH_ACKNOWLEDGEMENT, UnifiedSalesPublicationError, exactAuthority, validReviewedPrices, createUnifiedSalesPublicationService, publishEligiblePackage: service.publish, preflightEligiblePackage: service.preflight });
