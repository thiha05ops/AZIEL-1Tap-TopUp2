"use strict";

const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierCatalogProduct = require("../models/SupplierCatalogProduct");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");
const { basicCandidateBlockers } = require("./supplierEligibilityRouteResolver");
const { setPackageMarketPublication } = require("./packageMarketPublicationService");

const COMMERCE_MARKETS = Object.freeze(["TH", "MM"]);
const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const lower = value => clean(value).toLowerCase();
const id = value => clean(value?._id || value);
const key = (...parts) => parts.map(clean).join("/");

class AdminProductActivationError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message);
        this.name = "AdminProductActivationError";
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

function eligibilityAllows(mapping, customerMarket) {
    const mode = upper(mapping?.fulfillmentEligibility?.mode);
    if (mode === "GLOBAL") return COMMERCE_MARKETS.includes(upper(customerMarket));
    return mode === "CUSTOMER_MARKET_ALLOWLIST" &&
        (mapping.fulfillmentEligibility?.allowedCustomerMarkets || []).map(upper).includes(upper(customerMarket));
}

function publicPrice(pkg, customerMarket) {
    const price = pkg?.prices?.[upper(customerMarket)];
    return price?.enabled === true && Number(price.amount) > 0 ? {
        amount: Number(price.amount), currency: price.currency || "", mode: price.publishedPriceMode || ""
    } : null;
}

function mappingAvailability({ mapping, supplier, pkg, offer }) {
    const blockers = [];
    if (mapping?.archivedAt) blockers.push("MAPPING_ARCHIVED");
    if (mapping?.enabled !== true) blockers.push("MAPPING_DISABLED");
    if (!pkg || pkg.deletedAt) blockers.push("CANONICAL_PACKAGE_MISSING");
    if (!supplier) blockers.push("SUPPLIER_MISSING");
    else if (upper(mapping?.supplierCode) !== upper(supplier.supplierCode)) blockers.push("SUPPLIER_IDENTITY_CONTRADICTION");
    if (!clean(mapping?.supplierProductCode) || !clean(mapping?.supplierPackageCode)) blockers.push("EXACT_MAPPING_INCOMPLETE");
    if (!mapping?.supplierCatalogOfferId) blockers.push("SUPPLIER_CATALOG_OFFER_REFERENCE_MISSING");
    else if (!offer) blockers.push("SUPPLIER_CATALOG_OFFER_MISSING");
    else {
        if (id(offer.supplierId) !== id(mapping.supplierId)) blockers.push("SUPPLIER_OFFER_SUPPLIER_CONTRADICTION");
        if (clean(offer.supplierOfferCode) !== clean(mapping.supplierPackageCode)) blockers.push("SUPPLIER_OFFER_IDENTITY_CONTRADICTION");
    }
    const unique = [...new Set(blockers)].sort();
    return { mapped: true, available: unique.length === 0, blockers: unique };
}

function mappingReadiness({ mapping, supplier, pkg, offer, availability, customerMarket, now = new Date() }) {
    const adapter = supplier ? getSupplierAdapter(supplier) : null;
    const assessment = basicCandidateBlockers({ mapping, supplier, pkg, customerMarket, now, adapter });
    const blockers = [...assessment.blockers];
    if (!COMMERCE_MARKETS.includes(upper(customerMarket))) blockers.push("CUSTOMER_COMMERCE_MARKET_UNSUPPORTED");
    if (!eligibilityAllows(mapping, customerMarket)) blockers.push(
        upper(mapping?.fulfillmentEligibility?.mode) === "UNKNOWN" ? "FULFILLMENT_ELIGIBILITY_UNKNOWN" : "CUSTOMER_MARKET_NOT_ELIGIBLE"
    );
    if (!offer) blockers.push("SUPPLIER_CATALOG_OFFER_MISSING");
    if (offer && offer.catalogLifecycleState !== "ACTIVE") blockers.push("SUPPLIER_OFFER_NOT_ACTIVE");
    if (!availability || availability.state !== "AVAILABLE") blockers.push("SUPPLIER_AVAILABILITY_NOT_CONFIRMED");
    if (availability && availability.coverageComplete !== true) blockers.push("SUPPLIER_AVAILABILITY_COVERAGE_UNPROVEN");
    return { ready: blockers.length === 0, blockers: [...new Set(blockers)].sort() };
}

function blockerActions(blockers = []) {
    const definitions = {
        CURRENT_SUPPLIER_COST_MISSING: ["REVIEW_SUPPLIER_COST", "Review and explicitly promote the observed supplier cost."],
        SUPPLIER_COST_AUTHORITY_STALE: ["REVIEW_SUPPLIER_COST", "Review the latest observed supplier cost."],
        MAPPING_DISABLED: ["OPEN_FULFILLMENT_MAPPING", "Enable the exact mapping in Fulfillment."],
        MAPPING_EXECUTION_NOT_API: ["OPEN_FULFILLMENT_MAPPING", "Review the supplier API mode and exact mapping in Fulfillment."],
        MAPPING_NOT_PRIMARY: ["SELECT_PRIMARY_ROUTE", "Select PRIMARY after all production readiness gates pass."],
        INPUT_NOT_READY: ["OPEN_FULFILLMENT_MAPPING", "Configure and verify the customer input contract."],
        FULFILLMENT_ELIGIBILITY_UNKNOWN: ["OPEN_FULFILLMENT_MAPPING", "Record reviewed customer-market eligibility evidence."],
        CUSTOMER_MARKET_NOT_ELIGIBLE: ["OPEN_FULFILLMENT_MAPPING", "Review supplier eligibility evidence for this customer market."],
        FULFILLMENT_NOT_READY: ["OPEN_FULFILLMENT_MAPPING", "Complete fulfillment readiness in Fulfillment."],
        PRICING_NOT_READY: ["OPEN_DAILY_PRICING", "Resolve pricing prerequisites in Daily Pricing."],
        CUSTOMER_MARKET_PRICE_NOT_PUBLISHED: ["OPEN_DAILY_PRICING", "Calculate, review, and explicitly publish the market price."],
        PROVIDER_FEATURE_GATE_OFF: ["PLATFORM_CONFIGURATION_REQUIRED", "Owner deployment configuration must enable the existing provider/product gate."],
        SUPPLIER_AUTO_FULFILLMENT_DISABLED: ["PLATFORM_CONFIGURATION_REQUIRED", "Owner deployment configuration must enable the supplier emergency gate."],
        SUPPLIER_ADAPTER_NOT_READY: ["PLATFORM_CONFIGURATION_REQUIRED", "Supplier credentials/adapter configuration is required; secrets remain outside Admin."],
        FULFILLMENT_PROCESSOR_NOT_READY: ["PLATFORM_IMPLEMENTATION_REQUIRED", "No existing production processor supports this exact product contract."],
        CUSTOMER_COMMERCE_MARKET_UNSUPPORTED: ["PAYMENT_MARKET_NOT_IN_SCOPE", "AZIEL commerce/payment support does not exist for this customer market."],
        SUPPLIER_AVAILABILITY_NOT_CONFIRMED: ["OPEN_SUPPLIER_OFFER", "Inspect stored provider availability evidence."],
        SUPPLIER_AVAILABILITY_COVERAGE_UNPROVEN: ["OPEN_SUPPLIER_OFFER", "Inspect stored provider coverage evidence."]
    };
    return [...new Map(blockers.map(code => [definitions[code]?.[0] || "INSPECT_BLOCKER", { code, action: definitions[code]?.[0] || "INSPECT_BLOCKER", label: definitions[code]?.[1] || "Inspect the server-authoritative blocker." }])).values()];
}

function projectActivation(data, { search = "", productCode = "", supplierMarket = "", customerMarket = "TH", now = new Date() } = {}) {
    const productByCode = new Map(data.products.map(item => [lower(item.productCode), item]));
    const packageByKey = new Map(data.packages.map(item => [key(lower(item.productCode), upper(item.packageCode)), item]));
    const supplierById = new Map(data.suppliers.map(item => [id(item), item]));
    const offerById = new Map(data.offers.map(item => [id(item), item]));
    const supplierProductById = new Map(data.supplierProducts.map(item => [id(item), item]));
    const availabilityByOffer = new Map(data.availability.map(item => [id(item.supplierCatalogOfferId), item]));
    const publicationByKey = new Map(data.publications.map(item => [key(lower(item.productCode), upper(item.packageCode), upper(item.customerMarket)), item]));
    const normalizedSearch = lower(search);
    const normalizedProduct = lower(productCode);
    const normalizedSupplierMarket = upper(supplierMarket);
    const market = upper(customerMarket || "TH");

    if (!normalizedProduct) {
        const publishedKeys = new Set(data.publications.filter(item => item.published === true).map(item => key(lower(item.productCode), upper(item.packageCode))));
        const productCodes = [...new Set(data.mappings.map(item => lower(item.productCode)))];
        const products = productCodes.map(code => {
            const product = productByCode.get(code) || {};
            const rows = data.mappings.filter(item => lower(item.productCode) === code);
            return {
                productCode: code, name: product.name || code, enabled: product.enabled === true,
                commerceState: product.commerceState || "HIDDEN", publicDiscoveryEnabled: product.publicDiscoveryEnabled === true,
                productFamily: product.metadata?.productFamily || product.catalogCategory || "",
                suppliers: [...new Set(rows.map(item => upper(item.supplierCode)).filter(Boolean))].sort(),
                supplierMarkets: [...new Set(rows.map(item => upper(item.region)).filter(Boolean))].sort(),
                packageCount: new Set(rows.map(item => upper(item.packageCode))).size,
                publishedPackageCount: new Set(rows.filter(item => publishedKeys.has(key(code, upper(item.packageCode)))).map(item => upper(item.packageCode))).size
            };
        }).filter(product => !normalizedSearch || [product.name, product.productCode, product.productFamily, ...product.suppliers].some(value => lower(value).includes(normalizedSearch)))
          .sort((a, b) => a.name.localeCompare(b.name));
        return {
            authority: { catalog: "CatalogProduct/CatalogPackage", route: "SupplierProductMapping.productionRole", cost: "SupplierProductMapping.supplierCostAuthority", pricing: "Daily Pricing/Pricing Engine", input: "SupplierCatalogProduct + mapping readiness", fulfillment: "supplier eligibility route resolver", publication: "PackageMarketPublication" },
            projectionMode: "NAVIGATION", customerMarket: market, commerceMarketSupported: COMMERCE_MARKETS.includes(market), products,
            markets: [], packages: [], automaticFailover: false, automaticPublicRepricing: false
        };
    }

    const mappingRows = data.mappings.filter(mapping => !mapping.archivedAt).map(mapping => {
        const product = productByCode.get(lower(mapping.productCode));
        const pkg = packageByKey.get(key(lower(mapping.productCode), upper(mapping.packageCode)));
        const supplier = supplierById.get(id(mapping.supplierId));
        const offer = offerById.get(id(mapping.supplierCatalogOfferId));
        const supplierProduct = offer ? supplierProductById.get(id(offer.supplierCatalogProductId)) : null;
        const availability = offer ? availabilityByOffer.get(id(offer)) : null;
        const publication = publicationByKey.get(key(lower(mapping.productCode), upper(mapping.packageCode), market));
        const readiness = mappingReadiness({ mapping, supplier, pkg, offer, availability, customerMarket: market, now });
        const setup = mappingAvailability({ mapping, supplier, pkg, offer });
        const masterCatalogBlockers = setup.blockers.filter(code => code !== "MAPPING_DISABLED");
        const cost = mapping.supplierCostAuthority || {};
        const approvedCostPresent = cost.rawSupplierCost != null && Number.isFinite(Number(cost.rawSupplierCost));
        const pricingPrepared = approvedCostPresent && Boolean(cost.supplierCurrency) && mapping.mappingMetadata?.readiness?.pricingReady === true;
        const fulfillmentPrepared = mapping.mappingMetadata?.readiness?.inputReady === true &&
            mapping.mappingMetadata?.readiness?.fulfillmentReady === true && eligibilityAllows(mapping, market);
        return {
            productCode: lower(mapping.productCode), productName: product?.name || mapping.productCode,
            productEnabled: product?.enabled === true, commerceState: product?.commerceState || "HIDDEN",
            publicDiscoveryEnabled: product?.publicDiscoveryEnabled === true,
            packageCode: upper(mapping.packageCode), packageName: pkg?.name || pkg?.displayName || mapping.packageCode,
            packageEnabled: pkg?.enabled === true, entitlementSemantics: pkg?.metadata?.entitlementSemantics || offer?.normalizedSemantics || {},
            mappingId: id(mapping), mappingUpdatedAt: mapping.updatedAt || null, mappingEnabled: mapping.enabled === true,
            productionRole: mapping.productionRole, executionMode: mapping.executionMode,
            supplierId: id(mapping.supplierId), supplierCode: supplier?.supplierCode || mapping.supplierCode,
            supplierName: supplier?.name || supplier?.supplierCode || mapping.supplierCode,
            supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode,
            supplierOfferName: offer?.supplierOfferName || offer?.rawName || mapping.supplierDisplayName || "",
            supplierCatalogOfferId: id(offer),
            supplierMarket: upper(mapping.region), supplierMarketEvidence: mapping.supplierMarketEvidence || null,
            inputContract: supplierProduct?.normalizedInputContract || {}, requiredFields: supplierProduct?.requiredFields || [],
            readinessFlags: mapping.mappingMetadata?.readiness || {}, fulfillmentEligibility: mapping.fulfillmentEligibility || { mode: "UNKNOWN", allowedCustomerMarkets: [] },
            supplierCost: cost.rawSupplierCost ?? null, supplierCurrency: cost.supplierCurrency || "", supplierCostCapturedAt: cost.capturedAt || null,
            observedSupplierCost: offer?.supplierCost || null,
            availability: availability ? { state: availability.state, evidenceCode: availability.evidenceCode, coverageComplete: availability.coverageComplete, observedAt: availability.observedAt } : { state: "UNKNOWN", evidenceCode: "MISSING", coverageComplete: false, observedAt: null },
            publishedPrice: publicPrice(pkg, market), publication: publication ? { published: publication.published === true, decisionVersion: publication.decisionVersion, decisionNote: publication.decisionNote || "" } : { published: false, decisionVersion: 0, decisionNote: "" },
            masterCatalog: { mapped: true, valid: masterCatalogBlockers.length === 0, blockers: masterCatalogBlockers },
            setup: { ...setup, productionMappingEnabled: mapping.enabled === true, pricingPrepared, fulfillmentPrepared, readyToPublish: readiness.ready, published: publication?.published === true },
            dailyPricing: { workspacePath: `/api/admin/pricing-engine/workspace?supplierId=${encodeURIComponent(id(mapping.supplierId))}&supplierMarket=${encodeURIComponent(upper(mapping.region))}&productCode=${encodeURIComponent(lower(mapping.productCode))}&region=${encodeURIComponent(market)}`, previewEligible: approvedCostPresent && mapping.mappingMetadata?.readiness?.supplierMapped === true },
            readiness: { ...readiness, actions: blockerActions(readiness.blockers) }
        };
    });

    const filtered = mappingRows.filter(row =>
        (!normalizedProduct || row.productCode === normalizedProduct) &&
        (!normalizedSupplierMarket || row.supplierMarket === normalizedSupplierMarket) &&
        (!normalizedSearch || [row.productName, row.productCode, row.supplierCode, row.supplierOfferName].some(value => lower(value).includes(normalizedSearch)))
    );
    const productCodes = [...new Set(mappingRows.map(row => row.productCode))];
    const products = productCodes.map(code => {
        const product = productByCode.get(code) || {};
        const rows = mappingRows.filter(row => row.productCode === code);
        return {
            productCode: code, name: product.name || code, enabled: product.enabled === true,
            commerceState: product.commerceState || "HIDDEN", publicDiscoveryEnabled: product.publicDiscoveryEnabled === true,
            productFamily: product.metadata?.productFamily || product.catalogCategory || "",
            suppliers: [...new Set(rows.map(row => row.supplierCode))].sort(),
            supplierMarkets: [...new Set(rows.map(row => row.supplierMarket))].sort(),
            packageCount: new Set(rows.map(row => row.packageCode)).size,
            publishedPackageCount: new Set(rows.filter(row => row.publication.published).map(row => row.packageCode)).size
        };
    }).filter(product => !normalizedSearch || [product.name, product.productCode, product.productFamily, ...product.suppliers].some(value => lower(value).includes(normalizedSearch)))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
        authority: { catalog: "CatalogProduct/CatalogPackage", route: "SupplierProductMapping.productionRole", cost: "SupplierProductMapping.supplierCostAuthority", pricing: "Daily Pricing/Pricing Engine", input: "SupplierCatalogProduct + mapping readiness", fulfillment: "supplier eligibility route resolver", publication: "PackageMarketPublication" },
        projectionMode: "READINESS", customerMarket: market, commerceMarketSupported: COMMERCE_MARKETS.includes(market), products,
        markets: normalizedProduct ? [...new Set(mappingRows.filter(row => row.productCode === normalizedProduct).map(row => row.supplierMarket))].sort() : [],
        packages: filtered, automaticFailover: false, automaticPublicRepricing: false
    };
}

function createAdminProductActivationService(models = {}) {
    const M = {
        CatalogProduct: models.CatalogProduct || CatalogProduct, CatalogPackage: models.CatalogPackage || CatalogPackage,
        Supplier: models.Supplier || Supplier, Mapping: models.Mapping || SupplierProductMapping,
        Offer: models.Offer || SupplierCatalogOffer, SupplierProduct: models.SupplierProduct || SupplierCatalogProduct,
        Availability: models.Availability || SupplierOfferAvailability, Publication: models.Publication || PackageMarketPublication
    };
    const lean = (query, session) => (session ? query.session(session) : query).lean();
    async function load(query = {}, session = null) {
        const productCode = lower(query.productCode);
        const supplierMarket = upper(query.supplierMarket);
        if (!productCode) {
            const [products, mappings, publications] = await Promise.all([
                lean(M.CatalogProduct.find({ deletedAt: null }).select("productCode name enabled commerceState publicDiscoveryEnabled catalogCategory metadata"), session),
                lean(M.Mapping.find({ archivedAt: null }).select("productCode packageCode supplierCode region"), session),
                lean(M.Publication.find({ customerMarket: upper(query.customerMarket || "TH"), published: true }).select("productCode packageCode customerMarket published decisionVersion decisionNote"), session)
            ]);
            return { products, packages: [], suppliers: [], mappings, offers: [], supplierProducts: [], availability: [], publications };
        }
        const mappingFilter = { productCode, archivedAt: null };
        if (supplierMarket) mappingFilter.region = supplierMarket;
        const mappings = await lean(M.Mapping.find(mappingFilter), session);
        const packageKeys = [...new Map(mappings.map(item => [key(item.productCode, item.packageCode), { productCode: item.productCode, packageCode: item.packageCode }])).values()];
        const offerIds = mappings.map(item => item.supplierCatalogOfferId).filter(Boolean);
        const supplierIds = [...new Set(mappings.map(item => id(item.supplierId)).filter(Boolean))];
        const [products, packages, suppliers, offers, availability, publications] = await Promise.all([
            lean(M.CatalogProduct.find({ productCode, deletedAt: null }), session),
            packageKeys.length ? lean(M.CatalogPackage.find({ $or: packageKeys, deletedAt: null }), session) : [],
            supplierIds.length ? lean(M.Supplier.find({ _id: { $in: supplierIds } }), session) : [],
            offerIds.length ? lean(M.Offer.find({ _id: { $in: offerIds } }), session) : [],
            offerIds.length ? lean(M.Availability.find({ supplierCatalogOfferId: { $in: offerIds } }), session) : [],
            packageKeys.length ? lean(M.Publication.find({ productCode, packageCode: { $in: packageKeys.map(item => item.packageCode) }, customerMarket: upper(query.customerMarket || "TH") }), session) : []
        ]);
        const supplierProductIds = [...new Set(offers.map(item => id(item.supplierCatalogProductId)).filter(Boolean))];
        const supplierProducts = supplierProductIds.length ? await lean(M.SupplierProduct.find({ _id: { $in: supplierProductIds } }), session) : [];
        return { products, packages, suppliers, mappings, offers, supplierProducts, availability, publications };
    }
    async function getWorkspace(query = {}, session = null) { return projectActivation(await load(query, session), query); }
    return { load, getWorkspace };
}

async function publishSelectedPackage({ productCode, packageCode, customerMarket, mappingId, published, expectedMappingUpdatedAt, expectedDecisionVersion, decisionNote, actor }) {
    const market = upper(customerMarket);
    if (published !== true) return setPackageMarketPublication({ productCode, packageCode, customerMarket: market, published: false, decisionNote, actor });
    if (!COMMERCE_MARKETS.includes(market)) throw new AdminProductActivationError("CUSTOMER_COMMERCE_MARKET_UNSUPPORTED", "AZIEL commerce does not support this customer market.", 409);
    const workspace = await defaultService.getWorkspace({ productCode, customerMarket: market });
    const row = workspace.packages.find(item => item.mappingId === clean(mappingId) && item.packageCode === upper(packageCode));
    if (!row) throw new AdminProductActivationError("ACTIVATION_MAPPING_NOT_FOUND", "The selected exact supplier mapping is unavailable.", 404);
    if (expectedMappingUpdatedAt && new Date(expectedMappingUpdatedAt).getTime() !== new Date(row.mappingUpdatedAt).getTime()) throw new AdminProductActivationError("ACTIVATION_STALE_STATE", "The supplier mapping changed after this activation view was loaded.", 409);
    if (Number(expectedDecisionVersion || 0) !== Number(row.publication.decisionVersion || 0)) throw new AdminProductActivationError("ACTIVATION_STALE_PUBLICATION", "The publication decision changed after this activation view was loaded.", 409);
    if (!row.readiness.ready) throw new AdminProductActivationError("ACTIVATION_NOT_READY", "Package activation is blocked by production readiness.", 409, { blockers: row.readiness.blockers });
    return setPackageMarketPublication({ productCode, packageCode, customerMarket: market, published: true, decisionNote, actor });
}

async function publishSelectedPackages({ productCode, customerMarket, selections = [], decisionNote, actor }) {
    const market = upper(customerMarket), normalizedProduct = lower(productCode);
    if (!COMMERCE_MARKETS.includes(market)) throw new AdminProductActivationError("CUSTOMER_COMMERCE_MARKET_UNSUPPORTED", "AZIEL commerce does not support this customer market.", 409);
    if (!normalizedProduct || !Array.isArray(selections) || selections.length < 1) throw new AdminProductActivationError("ACTIVATION_SELECTION_REQUIRED", "Select at least one package to publish.");
    const identities = selections.map(item => `${upper(item.packageCode)}/${clean(item.mappingId)}`);
    if (new Set(identities).size !== identities.length) throw new AdminProductActivationError("ACTIVATION_SELECTION_DUPLICATE", "The exact publication selection contains duplicates.");
    const session = await mongoose.startSession();
    try {
        let publications = [];
        await session.withTransaction(async () => {
            const workspace = await defaultService.getWorkspace({ productCode: normalizedProduct, customerMarket: market }, session);
            const rows = selections.map(selection => {
                const row = workspace.packages.find(item => item.mappingId === clean(selection.mappingId) && item.packageCode === upper(selection.packageCode));
                if (!row) throw new AdminProductActivationError("ACTIVATION_MAPPING_NOT_FOUND", "A selected exact supplier mapping is unavailable.", 404);
                if (selection.expectedMappingUpdatedAt && new Date(selection.expectedMappingUpdatedAt).getTime() !== new Date(row.mappingUpdatedAt).getTime()) throw new AdminProductActivationError("ACTIVATION_STALE_STATE", "A supplier mapping changed after this activation view was loaded.", 409);
                if (Number(selection.expectedDecisionVersion || 0) !== Number(row.publication.decisionVersion || 0)) throw new AdminProductActivationError("ACTIVATION_STALE_PUBLICATION", "A publication decision changed after this activation view was loaded.", 409);
                if (!row.readiness.ready) throw new AdminProductActivationError("ACTIVATION_NOT_READY", "Package activation is blocked by production readiness.", 409, { packageCode: row.packageCode, blockers: row.readiness.blockers });
                return row;
            });
            publications = [];
            for (const row of rows) publications.push(await setPackageMarketPublication({ productCode: normalizedProduct, packageCode: row.packageCode, customerMarket: market, published: true, decisionNote, actor, session }));
        });
        return { publications, publishedCount: publications.length };
    } finally { await session.endSession(); }
}

const defaultService = createAdminProductActivationService();
module.exports = Object.freeze({ COMMERCE_MARKETS, AdminProductActivationError, eligibilityAllows, mappingAvailability, mappingReadiness, blockerActions, projectActivation, createAdminProductActivationService, getWorkspace: defaultService.getWorkspace, publishSelectedPackage, publishSelectedPackages });
