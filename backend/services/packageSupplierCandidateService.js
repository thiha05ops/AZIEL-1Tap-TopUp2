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
const { getSupplierAdapter } = require("./supplierAdapterRegistry");
const { supplierCapabilityProductCode } = require("./fulfillmentCapabilityService");
const { validateFulfillmentEligibility } = require("./supplierFulfillmentEligibilityService");
const { READINESS_MODES, assessMappingReadiness } = require("./supplierMappingReadinessService");
const { resolveFulfillmentRoutingMode, FULFILLMENT_ROUTING_MODES } = require("../config/fulfillmentRoutingMode");
const { productSupportsRegion } = require("../catalog/productRegionAuthority");

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

function evaluatePackageSupplierCandidates({ productCode, packageCode, customerMarket, product = null, pkg, publication = null, selection = null, mappings = [], suppliers = [], offers = [], availabilityRows = [], iconAsset = null, adapterFor = getSupplierAdapter } = {}) {
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
    if (product && (product.enabled !== true || product.deletedAt || !productSupportsRegion(product, market))) publicationBlockers.push("PRODUCT_MARKET_UNAVAILABLE");
    if (pkg.deletedAt) publicationBlockers.push("PACKAGE_DELETED");
    if (pkg.enabled === false) publicationBlockers.push("PACKAGE_DISABLED");
    if (!price || price.enabled === false || !Number.isFinite(Number(price.amount)) || Number(price.amount) <= 0) publicationBlockers.push("NO_VALID_PRICE");
    const selectedAuthority = resolveFulfillmentRoutingMode() === FULFILLMENT_ROUTING_MODES.SELECTED;
    if (selectedAuthority && !selection) publicationBlockers.push("PACKAGE_SUPPLIER_SELECTION_REQUIRED");
    if (selectedAuthority ? !candidates.some(item => item.selected && item.readiness.selectable) : !candidates.some(item => item.readiness.selectable)) publicationBlockers.push("FULFILLMENT_NOT_READY");
    const selectedCandidate = candidates.find(item => item.selected) || null;
    const fulfillmentBlockers = selectedAuthority
        ? selectedCandidate?.readiness?.blockerCodes || []
        : [...new Set(candidates.flatMap(item => item.readiness?.blockerCodes || []))];
    const operationalFulfillmentBlockers = !selection
        ? ["PACKAGE_SUPPLIER_SELECTION_REQUIRED"]
        : selectedCandidate?.readiness?.selectable === true
            ? []
            : ["FULFILLMENT_NOT_READY", ...(selectedCandidate?.readiness?.blockerCodes || [])];
    const operationalBlockers = [...new Set([
        ...publicationBlockers.filter(code => !["PACKAGE_SUPPLIER_SELECTION_REQUIRED", "FULFILLMENT_NOT_READY"].includes(code)),
        ...operationalFulfillmentBlockers,
        ...(publicationBlockers.includes("FULFILLMENT_NOT_READY") ? fulfillmentBlockers : [])
    ])];
    const published = publication?.published === true;
    const operationalState = operationalBlockers.length ? "BLOCKED" : "LIVE";
    return {
        package: { productCode: normalizedProduct, packageCode: normalizedPackage, name: pkg.name, iconUrl: iconAsset?.secureUrl || iconAsset?.url || "", iconAltText: iconAsset?.altText || "", updatedAt: pkg.updatedAt || null },
        customerMarket: market,
        publication: { published, historical: true, state: published ? "RECORDED" : "NOT_RECORDED", blockers: [] },
        operational: {
            state: operationalState,
            blockerCodes: operationalBlockers,
            nextActions: [...new Set(operationalBlockers.map(code => ({
                PACKAGE_SUPPLIER_SELECTION_REQUIRED: "SELECT_SUPPLIER",
                FULFILLMENT_NOT_READY: "REVIEW_SUPPLIER_READINESS",
                NO_VALID_PRICE: "OPEN_PRICING",
                PACKAGE_DISABLED: "REVIEW_PACKAGE_AVAILABILITY",
                PACKAGE_DELETED: "REVIEW_PACKAGE_AVAILABILITY"
            })[code]).filter(Boolean))]
        },
        customerPrice: price ? { amount: Number(price.amount), currency: price.currency || (market === "MM" ? "MMK" : "THB"), enabled: price.enabled !== false, publishedPriceMode: price.publishedPriceMode || "", supplierId: objectId(price.supplierId), supplierCode: upper(price.supplierCode), supplierName: clean(price.supplierName), supplierCost: price.supplierCost == null ? null : Number(price.supplierCost), supplierCurrency: upper(price.supplierCurrency), supplierCostTimestamp: price.supplierCostTimestamp || null } : null,
        selection: selection ? { supplierMappingId: selectedId, decisionVersion: Number(selection.decisionVersion), selectedAt: selection.selectedAt, selectedBy: selection.selectedByUsernameSnapshot } : null,
        candidates
    };
}

async function getProductPackageSupplierOverview({ productCode, customerMarket } = {}) {
    const normalizedProduct = lower(productCode);
    const market = normalizeCustomerMarket(customerMarket);
    if (!normalizedProduct) throw new PackageSupplierCandidateError("PACKAGE_IDENTITY_REQUIRED", "Product is required.");
    const [product, packages, publications, selections, mappings] = await Promise.all([
        CatalogProduct.findOne({ productCode: normalizedProduct }).lean(),
        CatalogPackage.find({ productCode: normalizedProduct, deletedAt: null }).sort({ sortOrder: 1, packageCode: 1 }).lean(),
        PackageMarketPublication.find({ productCode: normalizedProduct, customerMarket: market }).lean(),
        PackageSupplierSelection.find({ productCode: normalizedProduct, customerMarket: market }).lean(),
        SupplierProductMapping.find({ productCode: normalizedProduct }).sort({ packageCode: 1, supplierCode: 1, region: 1, _id: 1 }).lean()
    ]);
    const supplierIds = [...new Set(mappings.map(item => objectId(item.supplierId)).filter(Boolean))];
    const offerIds = [...new Set(mappings.map(item => objectId(item.supplierCatalogOfferId)).filter(Boolean))];
    const assetIds = [...new Set(packages.map(item => clean(item.iconAssetId)).filter(Boolean))];
    const [suppliers, offers, availabilityRows, iconAssets] = await Promise.all([
        supplierIds.length ? Supplier.find({ _id: { $in: supplierIds } }).lean() : [],
        offerIds.length ? SupplierCatalogOffer.find({ _id: { $in: offerIds } }).lean() : [],
        offerIds.length ? SupplierOfferAvailability.find({ supplierCatalogOfferId: { $in: offerIds } }).lean() : [],
        assetIds.length ? MediaAsset.find({ assetId: { $in: assetIds }, status: "active" }).lean() : []
    ]);
    const byPackage = rows => rows.reduce((map, item) => {
        const key = upper(item.packageCode);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
        return map;
    }, new Map());
    const publicationByPackage = new Map(publications.map(item => [upper(item.packageCode), item]));
    const selectionByPackage = new Map(selections.map(item => [upper(item.packageCode), item]));
    const mappingsByPackage = byPackage(mappings);
    const assetById = new Map(iconAssets.map(item => [clean(item.assetId), item]));
    return {
        productCode: normalizedProduct,
        customerMarket: market,
        packages: packages.map(pkg => evaluatePackageSupplierCandidates({
            productCode: normalizedProduct,
            packageCode: pkg.packageCode,
            customerMarket: market,
            product,
            pkg,
            publication: publicationByPackage.get(upper(pkg.packageCode)) || null,
            selection: selectionByPackage.get(upper(pkg.packageCode)) || null,
            mappings: mappingsByPackage.get(upper(pkg.packageCode)) || [],
            suppliers,
            offers,
            availabilityRows,
            iconAsset: assetById.get(clean(pkg.iconAssetId)) || null
        }))
    };
}

function createPackageSupplierCandidateService(models = {}, dependencies = {}) {
    const M = {
        Package: models.Package || CatalogPackage,
        Product: Object.keys(models).length ? (models.Product || null) : CatalogProduct,
        Media: models.Media || MediaAsset,
        Publication: models.Publication || PackageMarketPublication,
        Selection: models.Selection || PackageSupplierSelection,
        Supplier: models.Supplier || Supplier,
        Offer: models.Offer || SupplierCatalogOffer,
        Availability: models.Availability || SupplierOfferAvailability,
        Mapping: models.Mapping || SupplierProductMapping
    };
    const adapterFor = dependencies.getSupplierAdapter || getSupplierAdapter;

    return async function getPackageSupplierCandidates({ productCode, packageCode, customerMarket } = {}) {
        const normalizedProduct = lower(productCode);
        const normalizedPackage = upper(packageCode);
        const market = normalizeCustomerMarket(customerMarket);
        if (!normalizedProduct || !normalizedPackage) {
            throw new PackageSupplierCandidateError("PACKAGE_IDENTITY_REQUIRED", "Product and package are required.");
        }
        const [product, pkg, publication, selection, mappings] = await Promise.all([
            M.Product ? M.Product.findOne({ productCode: normalizedProduct }).lean() : Promise.resolve(null),
            M.Package.findOne({ productCode: normalizedProduct, packageCode: normalizedPackage, deletedAt: null }).lean(),
            M.Publication.findOne({ productCode: normalizedProduct, packageCode: normalizedPackage, customerMarket: market }).lean(),
            M.Selection.findOne({ productCode: normalizedProduct, packageCode: normalizedPackage, customerMarket: market }).lean(),
            M.Mapping.find({ productCode: normalizedProduct, packageCode: normalizedPackage }).sort({ supplierCode: 1, region: 1, _id: 1 }).lean()
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
        return evaluatePackageSupplierCandidates({ productCode: normalizedProduct, packageCode: normalizedPackage, customerMarket: market, product, pkg, publication, selection, mappings, suppliers, offers, availabilityRows, iconAsset, adapterFor });
    };
}

const getPackageSupplierCandidates = createPackageSupplierCandidateService();

module.exports = {
    PackageSupplierCandidateError,
    candidateBlockers,
    costProjection,
    createPackageSupplierCandidateService,
    evaluatePackageSupplierCandidates,
    getProductPackageSupplierOverview,
    getPackageSupplierCandidates,
    normalizeCustomerMarket,
    readinessSummary
};
