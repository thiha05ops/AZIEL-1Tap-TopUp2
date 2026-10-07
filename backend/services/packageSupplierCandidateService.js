"use strict";

const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const MediaAsset = require("../models/MediaAsset");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const Supplier = require("../models/Supplier");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");
const { READINESS_MODES, assessMappingReadiness } = require("./supplierMappingReadinessService");

class PackageSupplierCandidateError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "PackageSupplierCandidateError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();
const objectId = value => clean(value?._id || value);

function normalizeCustomerMarket(value) {
    const market = upper(value);
    if (!["TH", "MM"].includes(market)) {
        throw new PackageSupplierCandidateError("CUSTOMER_MARKET_INVALID", "Customer market must be TH or MM.");
    }
    return market;
}

function costProjection(mapping = {}, offer = null, now = Date.now()) {
    const authority = mapping.supplierCostAuthority || {};
    const offerCost = offer?.supplierCost || {};
    const validAmount = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
    const authorityHasAmount = validAmount(authority.rawSupplierCost);
    const offerHasAmount = validAmount(offerCost.amount);
    const amount = authorityHasAmount ? Number(authority.rawSupplierCost) : offerHasAmount ? Number(offerCost.amount) : null;
    const currency = upper(authority.supplierCurrency || offerCost.currency);
    const capturedAt = authority.capturedAt || offerCost.observedAt || null;
    const capturedTime = capturedAt ? new Date(capturedAt).getTime() : NaN;
    const maximumAgeSeconds = Number(mapping.mappingMetadata?.costAuthorityMaximumAgeSeconds || 86400);
    const stale = !Number.isFinite(capturedTime) || now - capturedTime > maximumAgeSeconds * 1000;
    return {
        amount,
        currency,
        capturedAt,
        stale,
        source: clean(authorityHasAmount ? authority.source : offerHasAmount ? "supplier_catalog_offer" : authority.source),
        state: amount == null ? "UNAVAILABLE" : stale ? "STALE" : "CURRENT"
    };
}

function candidateBlockers({ mapping = {}, supplier = null, offer = null, availability = null, customerMarket = "", adapter = null } = {}) {
    return assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping, supplier, offer, availability, customerMarket, adapter }).blockers;
}

function readinessSummary(blockers = []) {
    if (!blockers.length) return "Ready";
    if (blockers.includes("SUPPLIER_AVAILABILITY_NOT_CONFIRMED")) return "Unavailable";
    if (blockers.includes("CUSTOMER_MARKET_NOT_ELIGIBLE")) return "Not available in this customer market";
    if (blockers.includes("MAPPING_DISABLED") || blockers.includes("MAPPING_ARCHIVED")) return "Mapping unavailable";
    return "Fulfillment not ready";
}

function resolveEffectiveSupplierCandidate(candidates = [], selection = null) {
    const selectable = candidates.filter(candidate => candidate.readiness?.selectable === true);
    if (selection) {
        const selected = candidates.find(candidate => candidate.supplierMappingId === objectId(selection.supplierMappingId)) || null;
        return selected?.readiness?.selectable === true
            ? { candidate: selected, source: "OWNER_SELECTION", blockers: [] }
            : { candidate: selected, source: "OWNER_SELECTION", blockers: selected?.readiness?.blockerCodes?.length ? selected.readiness.blockerCodes : ["SELECTED_MAPPING_INVALID"] };
    }
    if (selectable.length === 1) return { candidate: selectable[0], source: "UNIQUE_EXECUTABLE_ROUTE", blockers: [] };
    if (selectable.length > 1) return { candidate: null, source: "AMBIGUOUS", blockers: ["AMBIGUOUS_EXECUTABLE_SUPPLIER_ROUTES"] };
    const exactBlockers = [...new Set(candidates.flatMap(candidate => candidate.readiness?.blockerCodes || []))];
    return { candidate: null, source: "NONE", blockers: exactBlockers.length ? exactBlockers : ["NO_EXECUTABLE_SUPPLIER_ROUTE"] };
}

function effectivePackageSalesState({ product = null, storeCatalogMember = false, pkg = null, publication = null, customerMarket = "TH", candidates = [], selection = null } = {}) {
    const market = normalizeCustomerMarket(customerMarket);
    if (publication?.published !== true) return { state: "DISABLED", blockers: [], route: resolveEffectiveSupplierCandidate(candidates, selection) };
    const blockers = [];
    if (!storeCatalogMember) blockers.push("NOT_IN_STORE_CATALOG");
    if (!product || product.deletedAt || product.enabled === false || product.publicDiscoveryEnabled !== true || upper(product.commerceState) !== "PURCHASABLE") blockers.push("PRODUCT_NOT_PURCHASABLE");
    if (!pkg || pkg.deletedAt || pkg.enabled === false) blockers.push("PACKAGE_DISABLED");
    const price = pkg?.prices?.[market];
    if (!price || price.enabled === false || !(Number(price.amount) > 0)) blockers.push("NO_VALID_PRICE");
    const route = resolveEffectiveSupplierCandidate(candidates, selection);
    blockers.push(...route.blockers);
    return { state: blockers.length ? "BLOCKED" : "LIVE", blockers: [...new Set(blockers)], route };
}

function evaluatePackageSupplierCandidates({ productCode, packageCode, customerMarket, product = null, storeCatalogMember = false, pkg, publication = null, selection = null, mappings = [], suppliers = [], offers = [], availabilityRows = [], iconAsset = null, adapterFor = getSupplierAdapter } = {}) {
    const normalizedProduct = lower(productCode);
    const normalizedPackage = upper(packageCode);
    const market = normalizeCustomerMarket(customerMarket);
    if (!normalizedProduct || !normalizedPackage) throw new PackageSupplierCandidateError("PACKAGE_IDENTITY_REQUIRED", "Product and package are required.");
    if (!pkg) throw new PackageSupplierCandidateError("CATALOG_PACKAGE_NOT_FOUND", "Package not found.", 404);
    const supplierById = new Map(suppliers.map(item => [objectId(item), item]));
    const offerById = new Map(offers.map(item => [objectId(item), item]));
    const availabilityByOfferId = new Map(availabilityRows.map(item => [objectId(item.supplierCatalogOfferId), item]));
    const selectedId = objectId(selection?.supplierMappingId);
    const candidates = mappings.map(mapping => {
        const supplier = supplierById.get(objectId(mapping.supplierId)) || null;
        const offer = offerById.get(objectId(mapping.supplierCatalogOfferId)) || null;
        const availability = availabilityByOfferId.get(objectId(mapping.supplierCatalogOfferId)) || null;
        const blockerCodes = candidateBlockers({ mapping, supplier, offer, availability, customerMarket: market, adapter: supplier ? adapterFor(supplier) : null });
        return {
            supplierMappingId: objectId(mapping),
            supplier: { supplierId: objectId(supplier || mapping.supplierId), supplierCode: upper(supplier?.supplierCode || mapping.supplierCode), name: clean(supplier?.name || mapping.supplierCode) },
            supplierMarket: upper(mapping.region),
            productionRole: upper(mapping.productionRole || "DISABLED"),
            providerIdentity: {
                productCode: clean(mapping.supplierProductCode),
                packageCode: clean(mapping.supplierPackageCode)
            },
            eligibility: {
                mode: clean(mapping.fulfillmentEligibility?.mode || "UNKNOWN"),
                allowedCustomerMarkets: Array.isArray(mapping.fulfillmentEligibility?.allowedCustomerMarkets) ? mapping.fulfillmentEligibility.allowedCustomerMarkets.map(upper) : [],
                evidenceCode: clean(mapping.fulfillmentEligibility?.evidenceCode),
                verifiedAt: mapping.fulfillmentEligibility?.verifiedAt || null
            },
            offer: {
                offerId: objectId(offer || mapping.supplierCatalogOfferId),
                label: clean(offer?.name || offer?.displayName || offer?.supplierOfferCode || mapping.supplierPackageCode)
            },
            cost: costProjection(mapping, offer),
            availability: { state: upper(availability?.state || "UNKNOWN"), observedAt: availability?.observedAt || null, staleAt: availability?.staleAt || null },
            readiness: { selectable: blockerCodes.length === 0, summary: readinessSummary(blockerCodes), blockerCodes, legacyProductionRole: upper(mapping.productionRole || "DISABLED") },
            selected: Boolean(selectedId && selectedId === objectId(mapping))
        };
    });
    const price = pkg.prices?.[market];
    const publicationBlockers = [];
    if (pkg.deletedAt) publicationBlockers.push("PACKAGE_DELETED");
    if (pkg.enabled === false) publicationBlockers.push("PACKAGE_DISABLED");
    if (!price || price.enabled === false || !Number.isFinite(Number(price.amount)) || Number(price.amount) <= 0) publicationBlockers.push("NO_VALID_PRICE");
    const effectiveState = effectivePackageSalesState({ product, storeCatalogMember, pkg, publication, customerMarket: market, candidates, selection });
    publicationBlockers.push(...effectiveState.blockers);
    const published = publication?.published === true;
    return {
        package: { productCode: normalizedProduct, packageCode: normalizedPackage, name: pkg.name, iconUrl: iconAsset?.secureUrl || iconAsset?.url || "", iconAltText: iconAsset?.altText || "", updatedAt: pkg.updatedAt || null },
        customerMarket: market,
        publication: { published, state: !published ? "PRIVATE" : publicationBlockers.length ? "SUPPRESSED" : "PUBLISHED", blockers: published ? publicationBlockers : [] },
        customerPrice: price ? { amount: Number(price.amount), currency: price.currency || (market === "MM" ? "MMK" : "THB"), enabled: price.enabled !== false, publishedPriceMode: price.publishedPriceMode || "", supplierId: objectId(price.supplierId), supplierCode: upper(price.supplierCode), supplierName: clean(price.supplierName), supplierCost: price.supplierCost == null ? null : Number(price.supplierCost), supplierCurrency: upper(price.supplierCurrency), supplierCostTimestamp: price.supplierCostTimestamp || null } : null,
        selection: selection ? { supplierMappingId: selectedId, decisionVersion: Number(selection.decisionVersion), selectedAt: selection.selectedAt, selectedBy: selection.selectedByUsernameSnapshot } : null,
        effectiveState: { state: effectiveState.state, blockers: effectiveState.blockers, supplierMappingId: effectiveState.route.candidate?.supplierMappingId || "", supplierResolution: effectiveState.route.source },
        candidates
    };
}

function createPackageSupplierCandidateService(models = {}, dependencies = {}) {
    const M = {
        Package: models.Package || CatalogPackage,
        Media: models.Media || MediaAsset,
        Publication: models.Publication || PackageMarketPublication,
        Selection: models.Selection || PackageSupplierSelection,
        Supplier: models.Supplier || Supplier,
        Offer: models.Offer || SupplierCatalogOffer,
        Availability: models.Availability || SupplierOfferAvailability,
        Mapping: models.Mapping || SupplierProductMapping,
        Product: models.Product || CatalogProduct,
        StoreSelection: models.StoreSelection || StoreCatalogSelection
    };
    const adapterFor = dependencies.getSupplierAdapter || getSupplierAdapter;

    return async function getPackageSupplierCandidates({ productCode, packageCode, customerMarket } = {}) {
        const normalizedProduct = lower(productCode);
        const normalizedPackage = upper(packageCode);
        const market = normalizeCustomerMarket(customerMarket);
        if (!normalizedProduct || !normalizedPackage) {
            throw new PackageSupplierCandidateError("PACKAGE_IDENTITY_REQUIRED", "Product and package are required.");
        }
        const [product, pkg, publication, selection, mappings, storeCatalogMember] = await Promise.all([
            M.Product.findOne({ productCode: normalizedProduct }).lean(),
            M.Package.findOne({ productCode: normalizedProduct, packageCode: normalizedPackage, deletedAt: null }).lean(),
            M.Publication.findOne({ productCode: normalizedProduct, packageCode: normalizedPackage, customerMarket: market }).lean(),
            M.Selection.findOne({ productCode: normalizedProduct, packageCode: normalizedPackage, customerMarket: market }).lean(),
            M.Mapping.find({ productCode: normalizedProduct, packageCode: normalizedPackage }).sort({ supplierCode: 1, region: 1, _id: 1 }).lean(),
            M.StoreSelection.exists({ productCode: normalizedProduct, status: "ACTIVE", sellingRegions: market, "packages.packageCode": normalizedPackage })
        ]);
        if (!pkg) throw new PackageSupplierCandidateError("CATALOG_PACKAGE_NOT_FOUND", "Package not found.", 404);

        const supplierIds = [...new Set(mappings.map(item => objectId(item.supplierId)).filter(Boolean))];
        const offerIds = [...new Set(mappings.map(item => objectId(item.supplierCatalogOfferId)).filter(Boolean))];
        const [suppliers, offers, availabilityRows, iconAsset] = await Promise.all([
            supplierIds.length ? M.Supplier.find({ _id: { $in: supplierIds } }).lean() : [],
            offerIds.length ? M.Offer.find({ _id: { $in: offerIds } }).lean() : [],
            offerIds.length ? M.Availability.find({ supplierCatalogOfferId: { $in: offerIds } }).lean() : [],
            pkg.iconAssetId ? M.Media.findOne({ assetId: pkg.iconAssetId, status: "active" }).lean() : null
        ]);
        return evaluatePackageSupplierCandidates({ productCode: normalizedProduct, packageCode: normalizedPackage, customerMarket: market, product, storeCatalogMember: Boolean(storeCatalogMember), pkg, publication, selection, mappings, suppliers, offers, availabilityRows, iconAsset, adapterFor });
    };
}

const getPackageSupplierCandidates = createPackageSupplierCandidateService();

module.exports = {
    PackageSupplierCandidateError,
    candidateBlockers,
    costProjection,
    createPackageSupplierCandidateService,
    evaluatePackageSupplierCandidates,
    effectivePackageSalesState,
    getPackageSupplierCandidates,
    normalizeCustomerMarket,
    resolveEffectiveSupplierCandidate,
    readinessSummary
};
