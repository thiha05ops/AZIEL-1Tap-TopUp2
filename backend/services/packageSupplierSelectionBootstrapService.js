"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const Supplier = require("../models/Supplier");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("./adminAuditService");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");
const { supplierCapabilityProductCode } = require("./fulfillmentCapabilityService");
const { READINESS_MODES, assessMappingReadiness } = require("./supplierMappingReadinessService");
const { productSupportsRegion } = require("../catalog/productRegionAuthority");

const MARKETS = Object.freeze(["TH", "MM"]);
const STATES = Object.freeze(["SAFE_TO_CREATE", "ALREADY_SELECTED", "BLOCKED", "AMBIGUOUS", "INELIGIBLE", "PROTECTED_EXISTING_SELECTION"]);
const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();
const id = value => clean(value?._id || value);
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const date = value => value ? new Date(value).toISOString() : null;

class PackageSupplierSelectionBootstrapError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message);
        this.name = "PackageSupplierSelectionBootstrapError";
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

function normalizeMarkets(values = MARKETS) {
    const requested = [...new Set((Array.isArray(values) ? values : [values]).map(upper).filter(Boolean))];
    if (!requested.length || requested.some(value => !MARKETS.includes(value))) throw new PackageSupplierSelectionBootstrapError("SUPPLIER_SELECTION_BOOTSTRAP_MARKETS_INVALID", "Requested markets must contain TH, MM, or both.");
    return MARKETS.filter(market => requested.includes(market));
}

function adapterFingerprint(mapping, supplier, adapter) {
    let configured = false;
    let featureEnabled = false;
    try { configured = adapter?.isConfigured?.() === true; } catch { configured = false; }
    const capabilityProductCode = supplierCapabilityProductCode(mapping, { supplierCode: supplier?.supplierCode || mapping?.supplierCode });
    try { featureEnabled = adapter?.isAutoFulfillmentEnabled?.(capabilityProductCode) === true; } catch { featureEnabled = false; }
    return { configured, featureEnabled, capabilityProductCode: clean(capabilityProductCode) };
}

function authorityFingerprint({ product, pkg, authorities, selection, mapping, supplier, offer, availability, adapterState }) {
    return {
        product: product ? { id: id(product), productCode: lower(product.productCode), enabled: product.enabled === true, deletedAt: date(product.deletedAt), supportedRegions: (product.supportedRegions || []).map(upper).sort(), updatedAt: date(product.updatedAt) } : null,
        package: pkg ? { id: id(pkg), packageCode: upper(pkg.packageCode), enabled: pkg.enabled === true, deletedAt: date(pkg.deletedAt), updatedAt: date(pkg.updatedAt) } : null,
        storeAuthorities: authorities.map(item => ({ selectionId: id(item.selection), decisionVersion: Number(item.selection.decisionVersion || 0), updatedAt: date(item.selection.updatedAt), supplierId: id(item.selection.supplierId), supplierCode: upper(item.selection.supplierCode), supplierMarket: upper(item.selection.supplierMarket), sellingRegions: (item.selection.sellingRegions || []).map(upper).sort(), mappingId: id(item.mappingId) })).sort((a, b) => `${a.selectionId}:${a.mappingId}`.localeCompare(`${b.selectionId}:${b.mappingId}`)),
        selection: selection ? { id: id(selection), mappingId: id(selection.supplierMappingId), decisionVersion: Number(selection.decisionVersion), updatedAt: date(selection.updatedAt) } : null,
        mapping: mapping ? { id: id(mapping), productCode: lower(mapping.productCode), packageCode: upper(mapping.packageCode), supplierId: id(mapping.supplierId), supplierCode: upper(mapping.supplierCode), supplierCatalogOfferId: id(mapping.supplierCatalogOfferId), supplierProductCode: clean(mapping.supplierProductCode), supplierPackageCode: clean(mapping.supplierPackageCode), region: upper(mapping.region), enabled: mapping.enabled === true, archivedAt: date(mapping.archivedAt), executionMode: upper(mapping.executionMode), readiness: mapping.mappingMetadata?.readiness || null, fulfillmentEligibility: mapping.fulfillmentEligibility || null, updatedAt: date(mapping.updatedAt) } : null,
        supplier: supplier ? { id: id(supplier), supplierCode: upper(supplier.supplierCode), enabled: supplier.enabled === true, mode: upper(supplier.mode), configurationStatus: upper(supplier.configurationStatus), updatedAt: date(supplier.updatedAt) } : null,
        offer: offer ? { id: id(offer), supplierId: id(offer.supplierId), supplierProductCode: clean(offer.supplierProductCode), supplierOfferCode: clean(offer.supplierOfferCode), lifecycle: upper(offer.catalogLifecycleState), revision: clean(offer.sourceRevision), rawSnapshotHash: clean(offer.rawSnapshotHash), updatedAt: date(offer.updatedAt) } : null,
        availability: availability ? { id: id(availability), offerId: id(availability.supplierCatalogOfferId), state: upper(availability.state), observedAt: date(availability.observedAt), staleAt: date(availability.staleAt), updatedAt: date(availability.updatedAt) } : null,
        adapter: adapterState || null
    };
}

function projectBootstrapPlan(data = {}, { markets = MARKETS, adapterFor = getSupplierAdapter } = {}) {
    const requestedMarkets = normalizeMarkets(markets);
    const product = data.product || null;
    if (!product) throw new PackageSupplierSelectionBootstrapError("PRODUCT_NOT_FOUND", "Product not found.", 404);
    const productCode = lower(product.productCode);
    const mappingById = new Map((data.mappings || []).map(item => [id(item), item]));
    const supplierById = new Map((data.suppliers || []).map(item => [id(item), item]));
    const offerById = new Map((data.offers || []).map(item => [id(item), item]));
    const availabilityByOffer = new Map((data.availability || []).map(item => [id(item.supplierCatalogOfferId), item]));
    const selectionByKey = new Map((data.selections || []).map(item => [`${upper(item.customerMarket)}:${upper(item.packageCode)}`, item]));
    const result = { productCode, generatedAt: new Date().toISOString(), markets: {} };

    for (const market of requestedMarkets) {
        const rows = (data.packages || []).map(pkg => {
            const packageCode = upper(pkg.packageCode);
            const selection = selectionByKey.get(`${market}:${packageCode}`) || null;
            const authorities = (data.storeSelections || []).flatMap(store => {
                if (store.status !== "ACTIVE" || lower(store.productCode) !== productCode || !(store.sellingRegions || []).map(upper).includes(market)) return [];
                return (store.packages || []).filter(item => upper(item.packageCode) === packageCode).map(item => ({ selection: store, mappingId: item.supplierProductMappingId }));
            });
            const authorityMappingIds = [...new Set(authorities.map(item => id(item.mappingId)).filter(Boolean))];
            const intendedMapping = authorityMappingIds.length === 1 ? mappingById.get(authorityMappingIds[0]) || null : null;
            const supplier = intendedMapping ? supplierById.get(id(intendedMapping.supplierId)) || null : null;
            const offer = intendedMapping ? offerById.get(id(intendedMapping.supplierCatalogOfferId)) || null : null;
            const availability = intendedMapping ? availabilityByOffer.get(id(intendedMapping.supplierCatalogOfferId)) || null : null;
            const adapter = supplier ? adapterFor(supplier) : null;
            const adapterState = intendedMapping ? adapterFingerprint(intendedMapping, supplier, adapter) : null;
            let state = "BLOCKED";
            let blockers = [];

            if (selection) {
                state = intendedMapping && id(selection.supplierMappingId) === id(intendedMapping) ? "ALREADY_SELECTED" : "PROTECTED_EXISTING_SELECTION";
                if (state === "PROTECTED_EXISTING_SELECTION") blockers.push("EXISTING_SELECTION_PRESERVED");
            } else if (product.enabled !== true || product.deletedAt || !productSupportsRegion(product, market)) {
                state = "INELIGIBLE";
                blockers.push("PRODUCT_MARKET_UNAVAILABLE");
            } else if (pkg.enabled !== true || pkg.deletedAt) {
                blockers.push(pkg.deletedAt ? "PACKAGE_DELETED" : "PACKAGE_DISABLED");
            } else if (authorityMappingIds.length > 1) {
                state = "AMBIGUOUS";
                blockers.push("MULTIPLE_DURABLE_MAPPING_AUTHORITIES");
            } else if (!authorityMappingIds.length) {
                blockers.push("STORE_CATALOG_MAPPING_AUTHORITY_MISSING");
            } else if (!intendedMapping) {
                blockers.push("SUPPLIER_MAPPING_NOT_FOUND");
            } else if (lower(intendedMapping.productCode) !== productCode || upper(intendedMapping.packageCode) !== packageCode || !authorities.every(item => id(item.selection.supplierId) === id(intendedMapping.supplierId))) {
                blockers.push("STORE_CATALOG_MAPPING_SCOPE_MISMATCH");
            } else {
                blockers = assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping: intendedMapping, supplier, offer, availability, customerMarket: market, adapter }).blockers;
                if (!blockers.length) state = "SAFE_TO_CREATE";
                else if (blockers.some(code => code.startsWith("FULFILLMENT_ELIGIBILITY_") || code === "CUSTOMER_MARKET_NOT_ELIGIBLE")) state = "INELIGIBLE";
            }
            blockers = [...new Set(blockers)].sort();
            const sourceVersion = hash(authorityFingerprint({ product, pkg, authorities, selection, mapping: intendedMapping, supplier, offer, availability, adapterState }));
            return { packageCode, packageName: clean(pkg.name || packageCode), customerMarket: market, state, blockers, intendedSupplierMappingId: id(intendedMapping), existingSupplierMappingId: id(selection?.supplierMappingId), sourceStoreCatalogSelectionIds: [...new Set(authorities.map(item => id(item.selection)))].sort(), sourceVersion };
        }).sort((a, b) => a.packageCode.localeCompare(b.packageCode));
        const counts = Object.fromEntries(STATES.map(state => [state, rows.filter(row => row.state === state).length]));
        const marketPlanToken = hash({ productCode, customerMarket: market, rows: rows.map(row => ({ packageCode: row.packageCode, state: row.state, blockers: row.blockers, intendedSupplierMappingId: row.intendedSupplierMappingId, existingSupplierMappingId: row.existingSupplierMappingId, sourceVersion: row.sourceVersion })) });
        result.markets[market] = { customerMarket: market, marketPlanToken, counts, packages: rows };
    }
    return result;
}

function createPackageSupplierSelectionBootstrapService(models = {}, dependencies = {}) {
    const M = { Product: models.Product || CatalogProduct, Package: models.Package || CatalogPackage, StoreSelection: models.StoreSelection || StoreCatalogSelection, Selection: models.Selection || PackageSupplierSelection, Mapping: models.Mapping || SupplierProductMapping, Supplier: models.Supplier || Supplier, Offer: models.Offer || SupplierCatalogOffer, Availability: models.Availability || SupplierOfferAvailability };
    const adapterFor = dependencies.getSupplierAdapter || getSupplierAdapter;
    const audit = dependencies.writeAdminAudit || writeAdminAudit;
    const transaction = dependencies.transaction || (async callback => { const session = await mongoose.startSession(); try { let value; await session.withTransaction(async () => { value = await callback(session); }); return value; } finally { await session.endSession(); } });
    const lean = (query, session) => (session && query.session ? query.session(session) : query).lean();
    const loadAuthority = dependencies.loadAuthority || (async ({ productCode, markets }, session = null) => {
        const product = await lean(M.Product.findOne({ productCode: lower(productCode), deletedAt: null }), session);
        if (!product) return { product: null, packages: [], storeSelections: [], selections: [], mappings: [], suppliers: [], offers: [], availability: [] };
        const packages = await lean(M.Package.find({ productCode: lower(productCode) }).sort({ sortOrder: 1, packageCode: 1 }), session);
        const storeSelections = await lean(M.StoreSelection.find({ productCode: lower(productCode), status: "ACTIVE" }), session);
        const selections = await lean(M.Selection.find({ productCode: lower(productCode), customerMarket: { $in: normalizeMarkets(markets) } }), session);
        const mappingIds = [...new Set(storeSelections.flatMap(item => item.packages || []).map(item => id(item.supplierProductMappingId)).filter(Boolean))];
        const mappings = mappingIds.length ? await lean(M.Mapping.find({ _id: { $in: mappingIds } }), session) : [];
        const supplierIds = [...new Set(mappings.map(item => id(item.supplierId)).filter(Boolean))];
        const offerIds = [...new Set(mappings.map(item => id(item.supplierCatalogOfferId)).filter(Boolean))];
        const suppliers = supplierIds.length ? await lean(M.Supplier.find({ _id: { $in: supplierIds } }), session) : [];
        const offers = offerIds.length ? await lean(M.Offer.find({ _id: { $in: offerIds } }), session) : [];
        const availability = offerIds.length ? await lean(M.Availability.find({ supplierCatalogOfferId: { $in: offerIds } }), session) : [];
        return { product, packages, storeSelections, selections, mappings, suppliers, offers, availability };
    });
    const createSelection = dependencies.createSelection || (async (document, session) => (await M.Selection.create([document], { session }))[0].toObject());

    async function plan({ productCode, markets = MARKETS } = {}, session = null) {
        const normalizedProduct = lower(productCode);
        if (!normalizedProduct) throw new PackageSupplierSelectionBootstrapError("PRODUCT_REQUIRED", "Product is required.");
        const normalizedMarkets = normalizeMarkets(markets);
        return projectBootstrapPlan(await loadAuthority({ productCode: normalizedProduct, markets: normalizedMarkets }, session), { markets: normalizedMarkets, adapterFor });
    }

    async function apply(input = {}, context = {}, externalSession = null) {
        const productCode = lower(input.productCode);
        const markets = normalizeMarkets(input.markets);
        const decisionNote = clean(input.decisionNote).slice(0, 500);
        const actor = context.actor || {};
        const results = { productCode, markets: {} };
        const applyMarket = async (market, session) => {
            const current = await plan({ productCode, markets: [market] }, session);
            const marketPlan = current.markets[market];
            if (clean(input.marketPlanTokens?.[market]) !== marketPlan.marketPlanToken) throw new PackageSupplierSelectionBootstrapError("SUPPLIER_SELECTION_BOOTSTRAP_PLAN_STALE", "Supplier selection bootstrap authorities changed. Refresh and review again.", 409, { customerMarket: market });
            const safe = marketPlan.packages.filter(row => row.state === "SAFE_TO_CREATE");
            const created = [];
            for (const row of safe) {
                try {
                    const saved = await createSelection({ productCode, packageCode: row.packageCode, customerMarket: market, supplierMappingId: row.intendedSupplierMappingId, selectedByAdminId: actor.id || actor.adminId || actor._id || null, selectedByUsernameSnapshot: clean(actor.username || "admin"), selectedAt: new Date(), decisionVersion: 1, reason: decisionNote || "Bootstrapped from exact Store Catalog supplier provenance" }, session);
                    created.push({ packageCode: row.packageCode, supplierMappingId: id(saved.supplierMappingId || row.intendedSupplierMappingId) });
                } catch (error) {
                    if (error?.code === 11000) throw new PackageSupplierSelectionBootstrapError("SUPPLIER_SELECTION_BOOTSTRAP_CONFLICT", "A supplier selection was created concurrently. Refresh and review again.", 409, { customerMarket: market, packageCode: row.packageCode });
                    throw error;
                }
            }
            await audit({ actor, req: context.req || null, action: ADMIN_AUDIT_ACTIONS.PACKAGE_SUPPLIER_SELECTIONS_BOOTSTRAPPED, resourceType: "CatalogProduct", resourceId: `${productCode}:${market}`, session, metadata: { productCode, customerMarket: market, sourceStoreCatalogSelectionIds: [...new Set(marketPlan.packages.flatMap(row => row.sourceStoreCatalogSelectionIds))].sort(), createdSelectionCount: created.length, alreadySelectedCount: marketPlan.counts.ALREADY_SELECTED, blockedCount: marketPlan.counts.BLOCKED, ambiguousCount: marketPlan.counts.AMBIGUOUS, ineligibleCount: marketPlan.counts.INELIGIBLE, protectedCount: marketPlan.counts.PROTECTED_EXISTING_SELECTION, mappingIdsCreated: created.map(item => item.supplierMappingId), planVersion: marketPlan.marketPlanToken, decisionNote } });
            return { status: "APPLIED", created: created.length, createdSelections: created, counts: marketPlan.counts, marketPlanToken: marketPlan.marketPlanToken };
        };
        for (const market of markets) {
            if (externalSession) {
                results.markets[market] = await applyMarket(market, externalSession);
            } else {
                try { results.markets[market] = await transaction(session => applyMarket(market, session)); }
                catch (error) { results.markets[market] = { status: error instanceof PackageSupplierSelectionBootstrapError && /STALE|CONFLICT/.test(error.code) ? "CONFLICT" : "FAILED", created: 0, code: error.code || "SUPPLIER_SELECTION_BOOTSTRAP_FAILED", message: error.message }; }
            }
        }
        return results;
    }

    return { plan, apply };
}

const service = createPackageSupplierSelectionBootstrapService();
async function reconcileAutomaticPackageSupplierSelections(input = {}, context = {}, session = null) {
    const markets = normalizeMarkets(input.markets || MARKETS);
    const plan = await service.plan({ productCode: input.productCode, markets }, session);
    const actionable = markets.filter(market => Number(plan.markets?.[market]?.counts?.SAFE_TO_CREATE || 0) > 0);
    if (!actionable.length) {
        return { productCode: plan.productCode, markets: Object.fromEntries(markets.map(market => [market, { status: "UNCHANGED", created: 0 }])) };
    }
    return service.apply({
        productCode: plan.productCode,
        markets: actionable,
        marketPlanTokens: Object.fromEntries(actionable.map(market => [market, plan.markets[market].marketPlanToken])),
        decisionNote: clean(input.decisionNote || "Automatic sellability lifecycle reconciliation")
    }, context, session);
}

module.exports = { MARKETS, STATES, PackageSupplierSelectionBootstrapError, adapterFingerprint, authorityFingerprint, normalizeMarkets, projectBootstrapPlan, createPackageSupplierSelectionBootstrapService, getPackageSupplierSelectionBootstrapPlan: service.plan, applyPackageSupplierSelectionBootstrapPlan: service.apply, reconcileAutomaticPackageSupplierSelections };
