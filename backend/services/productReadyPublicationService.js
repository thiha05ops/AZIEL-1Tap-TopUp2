"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const Supplier = require("../models/Supplier");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("./adminAuditService");
const { storeCatalogSelectionMode } = require("./catalogService");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");
const { supplierCapabilityProductCode } = require("./fulfillmentCapabilityService");
const { READINESS_MODES, assessMappingReadiness } = require("./supplierMappingReadinessService");
const { isProductPubliclyEligible, productSupportsRegion } = require("../catalog/productRegionAuthority");
const { publishPackageMarketBatch } = require("./packageMarketPublicationService");

const MARKETS = Object.freeze(["TH", "MM"]);
const clean = value => String(value == null ? "" : value).trim();
const lower = value => clean(value).toLowerCase();
const upper = value => clean(value).toUpperCase();
const objectId = value => clean(value?._id || value);

const BLOCKER_LABELS = Object.freeze({
    PRODUCT_NOT_SELLABLE: "Product is not publicly sellable",
    PRODUCT_MARKET_UNAVAILABLE: "Product is not available in this customer market",
    PACKAGE_DELETED: "Canonical package is deleted",
    PACKAGE_DISABLED: "Canonical package is disabled",
    NO_VALID_PRICE: "No valid enabled customer price",
    STORE_CATALOG_AUTHORITY_REQUIRED: "Package is not in the active Store Catalog for this market",
    PACKAGE_SUPPLIER_SELECTION_REQUIRED: "No fulfillment supplier is selected",
    NO_EXACT_SUPPLIER_MAPPING: "No exact supplier mapping exists",
    SELECTED_MAPPING_INVALID: "Selected supplier mapping does not belong to this package",
    FULFILLMENT_NOT_READY: "Selected supplier route is not ready"
});

class ProductReadyPublicationError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message);
        this.name = "ProductReadyPublicationError";
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

function normalizeMarkets(values = MARKETS) {
    const markets = [...new Set((Array.isArray(values) ? values : [values]).map(upper).filter(Boolean))];
    if (!markets.length || markets.some(market => !MARKETS.includes(market))) {
        throw new ProductReadyPublicationError("PUBLICATION_MARKETS_INVALID", "Requested markets must contain TH, MM, or both.");
    }
    return MARKETS.filter(market => markets.includes(market));
}

function blocker(code) {
    return { code, label: BLOCKER_LABELS[code] || code.replaceAll("_", " ").toLowerCase() };
}

function stableHash(value) {
    return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function adapterReadinessProjection(mapping = {}, supplier = null, adapter = null) {
    let configured = false;
    let featureEnabled = false;
    try { configured = adapter?.isConfigured?.() === true; } catch { configured = false; }
    const capabilityProductCode = supplierCapabilityProductCode(mapping, { supplierCode: supplier?.supplierCode || mapping.supplierCode });
    try { featureEnabled = adapter?.isAutoFulfillmentEnabled?.(capabilityProductCode) === true; } catch { featureEnabled = false; }
    let processorSupported = true;
    if (upper(supplier?.supplierCode || mapping.supplierCode) === "FAZERCARDS") {
        try { processorSupported = require("./suppliers/fazercardsFulfillmentProcessor").supportsFazerCardsMapping(mapping) === true; } catch { processorSupported = false; }
    }
    return { configured, featureEnabled, processorSupported, capabilityProductCode: clean(capabilityProductCode) };
}

function projectProductReadyPublication(data = {}, { markets = MARKETS, adapterFor = getSupplierAdapter, storeCatalogMode = storeCatalogSelectionMode() } = {}) {
    const product = data.product || null;
    if (!product) throw new ProductReadyPublicationError("PRODUCT_NOT_FOUND", "Product not found.", 404);
    const productCode = lower(product.productCode);
    const requestedMarkets = normalizeMarkets(markets);
    const suppliers = new Map((data.suppliers || []).map(item => [objectId(item), item]));
    const mappings = new Map((data.mappings || []).map(item => [objectId(item), item]));
    const offers = new Map((data.offers || []).map(item => [objectId(item), item]));
    const availability = new Map((data.availability || []).map(item => [objectId(item.supplierCatalogOfferId), item]));
    const publications = new Map((data.publications || []).map(item => [`${upper(item.customerMarket)}:${upper(item.packageCode)}`, item]));
    const selections = new Map((data.selections || []).map(item => [`${upper(item.customerMarket)}:${upper(item.packageCode)}`, item]));
    const mappedPackageCodes = new Set((data.mappings || []).filter(item => lower(item.productCode) === productCode).map(item => upper(item.packageCode)));
    const storeAuthorities = new Map();
    for (const selection of data.storeSelections || []) {
        if (selection.status !== "ACTIVE" || lower(selection.productCode) !== productCode) continue;
        const visible = new Set((selection.visibleRegions || []).map(upper));
        for (const market of (selection.sellingRegions || []).map(upper).filter(value => visible.has(value))) {
            for (const item of selection.packages || []) {
                const key = `${market}:${upper(item.packageCode)}`;
                if (!storeAuthorities.has(key)) storeAuthorities.set(key, []);
                storeAuthorities.get(key).push(selection);
            }
        }
    }
    const storeExplicit = upper(storeCatalogMode) === "EXPLICIT";
    const result = { productCode, generatedAt: new Date().toISOString(), markets: {} };

    for (const market of requestedMarkets) {
        const rows = (data.packages || []).map(pkg => {
            const packageCode = upper(pkg.packageCode);
            const publication = publications.get(`${market}:${packageCode}`) || null;
            const selection = selections.get(`${market}:${packageCode}`) || null;
            const selectedMapping = selection ? mappings.get(objectId(selection.supplierMappingId)) || null : null;
            let readinessSupplier = null;
            let readinessOffer = null;
            let readinessAvailability = null;
            let readinessAdapter = null;
            let adapterReadiness = null;
            const blockers = [];
            if (!isProductPubliclyEligible(product)) blockers.push("PRODUCT_NOT_SELLABLE");
            if (!productSupportsRegion(product, market)) blockers.push("PRODUCT_MARKET_UNAVAILABLE");
            if (pkg.deletedAt) blockers.push("PACKAGE_DELETED");
            if (pkg.enabled !== true) blockers.push("PACKAGE_DISABLED");
            const price = pkg.prices?.[market];
            if (!price || price.enabled !== true || !(Number(price.amount) > 0)) blockers.push("NO_VALID_PRICE");
            const matchingStoreAuthorities = storeAuthorities.get(`${market}:${packageCode}`) || [];
            if (storeExplicit && !matchingStoreAuthorities.length) blockers.push("STORE_CATALOG_AUTHORITY_REQUIRED");
            if (!selection) blockers.push("PACKAGE_SUPPLIER_SELECTION_REQUIRED");
            if (!mappedPackageCodes.has(packageCode)) blockers.push("NO_EXACT_SUPPLIER_MAPPING");
            if (selection && (!selectedMapping || lower(selectedMapping.productCode) !== productCode || upper(selectedMapping.packageCode) !== packageCode)) blockers.push("SELECTED_MAPPING_INVALID");
            if (selectedMapping && lower(selectedMapping.productCode) === productCode && upper(selectedMapping.packageCode) === packageCode) {
                readinessSupplier = suppliers.get(objectId(selectedMapping.supplierId)) || null;
                readinessOffer = offers.get(objectId(selectedMapping.supplierCatalogOfferId)) || null;
                readinessAvailability = availability.get(objectId(selectedMapping.supplierCatalogOfferId)) || null;
                readinessAdapter = readinessSupplier ? adapterFor(readinessSupplier) : null;
                adapterReadiness = adapterReadinessProjection(selectedMapping, readinessSupplier, readinessAdapter);
                const assessment = assessMappingReadiness({
                    mode: READINESS_MODES.NEW_ORDER_SELECTABLE,
                    mapping: selectedMapping,
                    supplier: readinessSupplier,
                    offer: readinessOffer,
                    availability: readinessAvailability,
                    customerMarket: market,
                    adapter: readinessAdapter
                });
                if (!assessment.ready) blockers.push("FULFILLMENT_NOT_READY", ...assessment.blockers);
            }
            const uniqueBlockers = [...new Set(blockers)];
            const published = publication?.published === true;
            const sourceVersion = stableHash({
                packageUpdatedAt: pkg.updatedAt || null,
                packageEnabled: pkg.enabled === true,
                packageDeletedAt: pkg.deletedAt || null,
                price: price ? { amount: price.amount, currency: price.currency, enabled: price.enabled } : null,
                publication: publication ? { id: objectId(publication), decisionVersion: publication.decisionVersion, updatedAt: publication.updatedAt, published: publication.published } : null,
                selection: selection ? { id: objectId(selection), supplierMappingId: objectId(selection.supplierMappingId), decisionVersion: selection.decisionVersion, updatedAt: selection.updatedAt } : null,
                selectedMapping: selectedMapping ? {
                    id: objectId(selectedMapping),
                    updatedAt: selectedMapping.updatedAt || null,
                    enabled: selectedMapping.enabled === true,
                    archivedAt: selectedMapping.archivedAt || null,
                    executionMode: upper(selectedMapping.executionMode),
                    supplierId: objectId(selectedMapping.supplierId),
                    supplierCode: upper(selectedMapping.supplierCode),
                    offerId: objectId(selectedMapping.supplierCatalogOfferId),
                    supplierProductCode: clean(selectedMapping.supplierProductCode),
                    supplierPackageCode: clean(selectedMapping.supplierPackageCode),
                    readiness: {
                        supplierMapped: selectedMapping.mappingMetadata?.readiness?.supplierMapped === true,
                        inputReady: selectedMapping.mappingMetadata?.readiness?.inputReady === true,
                        fulfillmentReady: selectedMapping.mappingMetadata?.readiness?.fulfillmentReady === true
                    },
                    fulfillmentEligibility: {
                        mode: upper(selectedMapping.fulfillmentEligibility?.mode),
                        allowedCustomerMarkets: (selectedMapping.fulfillmentEligibility?.allowedCustomerMarkets || []).map(upper).sort(),
                        evidenceCode: upper(selectedMapping.fulfillmentEligibility?.evidenceCode),
                        evidenceSource: clean(selectedMapping.fulfillmentEligibility?.evidenceSource),
                        verifiedAt: selectedMapping.fulfillmentEligibility?.verifiedAt || null,
                        version: Number(selectedMapping.fulfillmentEligibility?.version || 0)
                    }
                } : null,
                supplier: readinessSupplier ? { id: objectId(readinessSupplier), supplierCode: upper(readinessSupplier.supplierCode), enabled: readinessSupplier.enabled === true, mode: upper(readinessSupplier.mode), updatedAt: readinessSupplier.updatedAt || null } : null,
                offer: readinessOffer ? { id: objectId(readinessOffer), supplierId: objectId(readinessOffer.supplierId), supplierProductCode: clean(readinessOffer.supplierProductCode), supplierOfferCode: clean(readinessOffer.supplierOfferCode), catalogLifecycleState: upper(readinessOffer.catalogLifecycleState), updatedAt: readinessOffer.updatedAt || null, revision: readinessOffer.revision || readinessOffer.sourceRevision || null, rawSnapshotHash: clean(readinessOffer.rawSnapshotHash) } : null,
                availability: readinessAvailability ? { id: objectId(readinessAvailability), supplierCatalogOfferId: objectId(readinessAvailability.supplierCatalogOfferId), state: upper(readinessAvailability.state), staleAt: readinessAvailability.staleAt || null, observedAt: readinessAvailability.observedAt || null, updatedAt: readinessAvailability.updatedAt || null } : null,
                adapterReadiness,
                storeAuthorities: matchingStoreAuthorities.map(item => ({ id: objectId(item), decisionVersion: item.decisionVersion, updatedAt: item.updatedAt })).sort((a, b) => a.id.localeCompare(b.id))
            });
            return {
                packageCode,
                packageName: clean(pkg.name || packageCode),
                state: published ? "PUBLIC" : uniqueBlockers.length ? "BLOCKED" : "READY_TO_PUBLISH",
                blockers: uniqueBlockers.map(blocker),
                liveBlockers: published ? uniqueBlockers.map(blocker) : [],
                expectedDecisionVersion: Number(publication?.decisionVersion || 0),
                sourceVersion
            };
        }).sort((a, b) => a.packageCode.localeCompare(b.packageCode));
        const tokenPayload = rows.map(row => ({ packageCode: row.packageCode, state: row.state, blockers: row.blockers.map(item => item.code), expectedDecisionVersion: row.expectedDecisionVersion, sourceVersion: row.sourceVersion }));
        const marketPlanToken = stableHash({ productCode, market, productSource: { updatedAt: product.updatedAt || null, enabled: product.enabled, deletedAt: product.deletedAt || null, publicDiscoveryEnabled: product.publicDiscoveryEnabled, commerceState: product.commerceState, lifecycleStatus: product.lifecycleStatus, supportedRegions: product.supportedRegions || [] }, rows: tokenPayload });
        result.markets[market] = {
            total: rows.length,
            public: rows.filter(row => row.state === "PUBLIC").length,
            ready: rows.filter(row => row.state === "READY_TO_PUBLISH").length,
            blocked: rows.filter(row => row.state === "BLOCKED").length,
            marketPlanToken,
            publicPackages: rows.filter(row => row.state === "PUBLIC"),
            readyPackages: rows.filter(row => row.state === "READY_TO_PUBLISH"),
            blockedPackages: rows.filter(row => row.state === "BLOCKED")
        };
    }
    return result;
}

function createProductReadyPublicationService(models = {}, dependencies = {}) {
    const M = {
        Product: models.Product || CatalogProduct,
        Package: models.Package || CatalogPackage,
        Publication: models.Publication || PackageMarketPublication,
        Selection: models.Selection || PackageSupplierSelection,
        StoreSelection: models.StoreSelection || StoreCatalogSelection,
        Supplier: models.Supplier || Supplier,
        Offer: models.Offer || SupplierCatalogOffer,
        Availability: models.Availability || SupplierOfferAvailability,
        Mapping: models.Mapping || SupplierProductMapping
    };
    const lean = (query, session) => (session && query.session ? query.session(session) : query).lean();
    const loadAuthority = dependencies.loadAuthority || (async ({ productCode, markets }, session = null) => {
        const marketList = normalizeMarkets(markets);
        const product = await lean(M.Product.findOne({ productCode: lower(productCode) }), session);
        if (!product) return { product: null, packages: [], publications: [], selections: [], storeSelections: [], mappings: [], suppliers: [], offers: [], availability: [] };
        const packages = await lean(M.Package.find({ productCode: lower(productCode) }).sort({ sortOrder: 1, packageCode: 1 }), session);
        const publications = await lean(M.Publication.find({ productCode: lower(productCode), customerMarket: { $in: marketList } }), session);
        const selections = await lean(M.Selection.find({ productCode: lower(productCode), customerMarket: { $in: marketList } }), session);
        const storeSelections = await lean(M.StoreSelection.find({ productCode: lower(productCode), status: "ACTIVE" }), session);
        const mappings = await lean(M.Mapping.find({ productCode: lower(productCode) }), session);
        const supplierIds = [...new Set(mappings.map(item => objectId(item.supplierId)).filter(Boolean))];
        const offerIds = [...new Set(mappings.map(item => objectId(item.supplierCatalogOfferId)).filter(Boolean))];
        const suppliers = supplierIds.length ? await lean(M.Supplier.find({ _id: { $in: supplierIds } }), session) : [];
        const offers = offerIds.length ? await lean(M.Offer.find({ _id: { $in: offerIds } }), session) : [];
        const availability = offerIds.length ? await lean(M.Availability.find({ supplierCatalogOfferId: { $in: offerIds } }), session) : [];
        return { product, packages, publications, selections, storeSelections, mappings, suppliers, offers, availability };
    });
    const transaction = dependencies.transaction || (async callback => {
        const session = await mongoose.startSession();
        try {
            let result;
            await session.withTransaction(async () => { result = await callback(session); });
            return result;
        } finally { await session.endSession(); }
    });
    const batchPublish = dependencies.batchPublish || publishPackageMarketBatch;
    const audit = dependencies.audit || writeAdminAudit;
    const adapterFor = dependencies.adapterFor || getSupplierAdapter;
    const mode = dependencies.storeCatalogMode || (() => storeCatalogSelectionMode());

    async function plan({ productCode, markets = MARKETS } = {}, session = null) {
        const normalizedProduct = lower(productCode);
        if (!normalizedProduct) throw new ProductReadyPublicationError("PRODUCT_REQUIRED", "Product is required.");
        const requestedMarkets = normalizeMarkets(markets);
        return projectProductReadyPublication(await loadAuthority({ productCode: normalizedProduct, markets: requestedMarkets }, session), { markets: requestedMarkets, adapterFor, storeCatalogMode: mode() });
    }

    async function apply({ productCode, markets, marketPlanTokens = {}, decisionNote = "Publish all ready packages" } = {}, context = {}) {
        const normalizedProduct = lower(productCode);
        const requestedMarkets = normalizeMarkets(markets);
        const initial = await plan({ productCode: normalizedProduct, markets: requestedMarkets });
        const result = { productCode: normalizedProduct, generatedAt: initial.generatedAt, markets: {} };
        for (const market of requestedMarkets) {
            try {
                result.markets[market] = await transaction(async session => {
                    const current = await plan({ productCode: normalizedProduct, markets: [market] }, session);
                    const marketPlan = current.markets[market];
                    const expectedToken = clean(marketPlanTokens?.[market]);
                    if (!expectedToken || expectedToken !== marketPlan.marketPlanToken) {
                        return { status: "CONFLICT", published: 0, alreadyPublic: marketPlan.public, blocked: marketPlan.blocked, conflicted: marketPlan.ready, marketPlanToken: marketPlan.marketPlanToken, blockedPackages: marketPlan.blockedPackages, conflictCode: "PUBLICATION_READY_PLAN_STALE" };
                    }
                    const ready = marketPlan.readyPackages;
                    if (ready.length) {
                        await batchPublish({ productCode: normalizedProduct, customerMarket: market, packages: ready, actor: context.actor?.username || "admin", decisionNote, session });
                    }
                    await audit({
                        actor: context.actor || null,
                        req: context.req || null,
                        action: ADMIN_AUDIT_ACTIONS.PRODUCT_READY_PACKAGES_PUBLISHED,
                        resourceType: "CatalogProduct",
                        resourceId: `${normalizedProduct}:${market}`,
                        session,
                        metadata: { productCode: normalizedProduct, customerMarket: market, publishedCount: ready.length, alreadyPublicCount: marketPlan.public, blockedCount: marketPlan.blocked, conflictCount: 0, marketPlanToken: marketPlan.marketPlanToken }
                    });
                    return { status: "APPLIED", published: ready.length, alreadyPublic: marketPlan.public, blocked: marketPlan.blocked, conflicted: 0, marketPlanToken: marketPlan.marketPlanToken, publishedPackages: ready.map(item => ({ packageCode: item.packageCode, packageName: item.packageName })), blockedPackages: marketPlan.blockedPackages };
                });
            } catch (error) {
                result.markets[market] = { status: "FAILED", published: 0, alreadyPublic: initial.markets[market]?.public || 0, blocked: initial.markets[market]?.blocked || 0, conflicted: initial.markets[market]?.ready || 0, blockedPackages: initial.markets[market]?.blockedPackages || [], conflictCode: error.code || "PUBLICATION_READY_APPLY_FAILED" };
            }
        }
        return result;
    }
    return { plan, apply };
}

const defaultService = createProductReadyPublicationService();

module.exports = {
    BLOCKER_LABELS,
    MARKETS,
    ProductReadyPublicationError,
    adapterReadinessProjection,
    createProductReadyPublicationService,
    normalizeMarkets,
    projectProductReadyPublication,
    getProductReadyPublicationPlan: defaultService.plan,
    applyProductReadyPublicationPlan: defaultService.apply
};
