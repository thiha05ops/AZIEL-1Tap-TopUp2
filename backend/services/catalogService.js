const catalog = require("../catalog/catalog");
const MediaAsset = require("../models/MediaAsset");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const Supplier = require("../models/Supplier");
const PackageInventoryState = require("../models/PackageInventoryState");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const { getCanonicalProduct, isCanonicalProductCode, resolveCanonicalProductRoute } = require("../catalog/canonicalOperationalCatalog");
const {
    REGION_CURRENCIES,
    getStaticCatalogSnapshot,
    normalizeCurrency,
    normalizePackageCode,
    normalizeProductCode,
    normalizeRegion,
    priceForRegion
} = require("../catalog/catalogProjection");
const { projectMediaAsset, projectPublicMediaAsset } = require("./mediaService");
const { normalizeProductKnowledge, normalizeCustomerNote, normalizeCustomerNoteLocales } = require("../catalog/productKnowledge");
const { resolvePublicProductReadiness } = require("../catalog/publicProductReadiness");
const { publicCustomerInputContract, verifiedMappingContract } = require("./suppliers/fazercardsFulfillmentContractService");
const { normalizeProductRegions, productSupportsRegion } = require("../catalog/productRegionAuthority");
const { assessProductionReadyFulfillmentMapping, isManualFulfillmentAllowed, isProductionReadyFulfillmentMapping, isSupplierMappedAutoTopupThScope } = require("./fulfillmentCapabilityService");
const { publicCategoryFor } = require("../catalog/catalogTaxonomy");
const {
    applyPublicationMetadata,
    comparePublicationSets,
    explicitPublishedPackages,
    publicationMode,
    stripPublicationMetadata
} = require("./packageMarketPublicationService");

class CatalogError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "CatalogError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const productIndex = new Map();
const aliasIndex = new Map();

catalog.products.forEach(product => {
    const normalizedProductCode = normalizeProductCode(product.productCode);
    productIndex.set(normalizedProductCode, product);

    [product.productCode, product.name, ...(product.aliases || [])]
        .filter(Boolean)
        .forEach(alias => aliasIndex.set(normalizeProductCode(alias), normalizedProductCode));
});

function normalizePackageName(value = "") {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function getCatalogSource(env = process.env) {
    const source = String(env.CATALOG_SOURCE || "static").trim().toLowerCase();

    if (source === "static" || source === "database") {
        return source;
    }

    throw new CatalogError(
        "CATALOG_SOURCE_INVALID",
        "Catalog source configuration is invalid.",
        500
    );
}

function storeCatalogSelectionMode(env = process.env) {
    const mode = String(env.STORE_CATALOG_SELECTION_MODE || "LEGACY").trim().toUpperCase();
    return mode === "EXPLICIT" ? "EXPLICIT" : "LEGACY";
}

function getProduct(productCodeOrAlias) {
    const key = normalizeProductCode(productCodeOrAlias);
    const canonicalCode = aliasIndex.get(key) || key;
    return productIndex.get(canonicalCode) || null;
}

function getPackage(productCodeOrAlias, packageCodeOrName) {
    const product = getProduct(productCodeOrAlias);
    if (!product) return null;

    const packageCode = normalizePackageCode(packageCodeOrName);
    const packageName = normalizePackageName(packageCodeOrName);

    return (product.packages || []).find(item => (
        normalizePackageCode(item.packageCode) === packageCode ||
        normalizePackageName(item.name) === packageName
    )) || null;
}

function assertClientCompatibility(payload, canonical) {
    if (payload.clientAmount != null && payload.clientAmount !== "") {
        const clientAmount = Number(payload.clientAmount);

        if (!Number.isFinite(clientAmount)) {
            throw new CatalogError(
                "PRICE_MISMATCH",
                "Price has changed. Please refresh and select the package again."
            );
        }

        if (Math.abs(clientAmount - Number(canonical.amount)) > 0.000001) {
            throw new CatalogError(
                "PRICE_MISMATCH",
                "Price has changed. Please refresh and select the package again."
            );
        }
    }

    if (payload.clientCurrency) {
        const clientCurrency = normalizeCurrency(payload.clientCurrency);

        if (clientCurrency && clientCurrency !== canonical.currency) {
            throw new CatalogError(
                "CURRENCY_MISMATCH",
                "Currency has changed. Please refresh and select the package again."
            );
        }
    }
}

function getStaticProductFromPayload(payload = {}) {
    const product =
        getProduct(payload.productCode) ||
        getProduct(payload.gameKey) ||
        getProduct(payload.game);

    if (!product) {
        throw new CatalogError(
            "PRODUCT_NOT_FOUND",
            "Product is not available."
        );
    }

    if (!isCanonicalProductCode(product.productCode)) {
        throw new CatalogError(
            "PRODUCT_NOT_FOUND",
            "Product is not available."
        );
    }

    if (!product.enabled) {
        throw new CatalogError(
            "PRODUCT_DISABLED",
            "This product is not available for purchase."
        );
    }

    return product;
}

function getStaticPackageFromPayload(product, payload = {}) {
    const packageRef = payload.packageCode || payload.selectedPackageCode || payload.packageName || payload.package;

    if (!packageRef) {
        throw new CatalogError(
            "PACKAGE_NOT_FOUND",
            "Package is required."
        );
    }

    const item = getPackage(product.productCode, packageRef);

    if (!item) {
        throw new CatalogError(
            "PACKAGE_NOT_FOUND",
            "Package is not available."
        );
    }

    if (!item.enabled) {
        throw new CatalogError(
            "PACKAGE_DISABLED",
            "This package is not available for purchase."
        );
    }

    return item;
}

function resolveStaticPackagePrice(payload = {}) {
    const product = getStaticProductFromPayload(payload);
    const item = getStaticPackageFromPayload(product, payload);
    const region = normalizeRegion(payload.region);
    const price = item.prices?.[region];

    if (!price) {
        throw new CatalogError(
            "REGION_NOT_SUPPORTED",
            "This package is not available in the selected region."
        );
    }

    const canonical = {
        productCode: product.productCode,
        productName: product.name,
        packageCode: item.packageCode,
        packageName: item.name,
        region,
        currency: price.currency,
        amount: Number(price.amount)
    };

    assertClientCompatibility(payload, canonical);

    return canonical;
}

function getDatabaseProductFromRows(payload = {}, products = []) {
    const refs = [payload.productCode, payload.gameKey, payload.game]
        .filter(Boolean)
        .map(value => normalizeProductCode(value));

    if (!refs.length) {
        throw new CatalogError(
            "PRODUCT_NOT_FOUND",
            "Product is not available."
        );
    }

    const product = products.find(item => {
        const aliases = [item.productCode, item.name, ...(item.aliases || [])];
        return aliases.some(alias => refs.includes(normalizeProductCode(alias)));
    });

    if (!product) {
        throw new CatalogError(
            "PRODUCT_NOT_FOUND",
            "Product is not available."
        );
    }

    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(String(product.productCode || "").trim().toLowerCase())) {
        throw new CatalogError(
            "PRODUCT_NOT_FOUND",
            "Product is not available."
        );
    }

    if (product.deletedAt) {
        throw new CatalogError(
            "PRODUCT_DISABLED",
            "This product is not available for purchase."
        );
    }

    if (!product.enabled) {
        throw new CatalogError(
            "PRODUCT_DISABLED",
            "This product is not available for purchase."
        );
    }

    return product;
}

function getDatabasePackageFromRows(product, payload = {}, packages = []) {
    const packageRef = payload.packageCode || payload.selectedPackageCode || payload.packageName || payload.package;

    if (!packageRef) {
        throw new CatalogError(
            "PACKAGE_NOT_FOUND",
            "Package is required."
        );
    }

    const packageCode = normalizePackageCode(packageRef);
    const packageName = normalizePackageName(packageRef);
    const item = packages.find(row => (
        row.productCode === product.productCode &&
        (
            normalizePackageCode(row.packageCode) === packageCode ||
            normalizePackageName(row.name) === packageName
        )
    ));

    if (!item) {
        throw new CatalogError(
            "PACKAGE_NOT_FOUND",
            "Package is not available."
        );
    }

    if (item.deletedAt) {
        throw new CatalogError(
            "PACKAGE_DISABLED",
            "This package is not available for purchase."
        );
    }

    if (!item.enabled) {
        throw new CatalogError(
            "PACKAGE_DISABLED",
            "This package is not available for purchase."
        );
    }

    return item;
}

function resolveDatabasePackagePriceFromRows(payload = {}, rows = {}) {
    const product = getDatabaseProductFromRows(payload, rows.products || []);
    const item = getDatabasePackageFromRows(product, payload, rows.packages || []);
    const region = normalizeRegion(payload.region);
    const price = priceForRegion(item, region);

    if (
        !productSupportsRegion(product, region) ||
        !price ||
        price.enabled === false
    ) {
        throw new CatalogError(
            "REGION_NOT_SUPPORTED",
            "This package is not available in the selected region."
        );
    }

    const expectedCurrency = REGION_CURRENCIES[region];

    if (price.currency !== expectedCurrency) {
        throw new CatalogError(
            "CATALOG_PRICE_INVALID",
            "Catalog price configuration is invalid.",
            500
        );
    }

    const canonical = {
        productCode: product.productCode,
        productName: product.name,
        packageCode: item.packageCode,
        packageName: item.name,
        region,
        currency: price.currency,
        amount: Number(price.amount)
    };

    assertClientCompatibility(payload, canonical);

    return canonical;
}

async function resolveDatabasePackagePrice(payload = {}) {
    let products;
    let packages;

    try {
        if (storeCatalogSelectionMode() === "EXPLICIT") {
            const region = normalizeRegion(payload.region);
            const publicProducts = await toDatabasePublicCatalog({ includeDisabled: false, includeAssetProjection: false, includeAdminPricing: false, customerMarket: region, publicationProjectionMode: "EXPLICIT" });
            const refs = [payload.productCode, payload.gameKey, payload.game].filter(Boolean).map(normalizeProductCode);
            const product = publicProducts.find(item => [item.productCode,item.name,...(item.aliases||[])].some(alias=>refs.includes(normalizeProductCode(alias))));
            if (!product) throw new CatalogError("PRODUCT_NOT_OFFERED", "This product is not currently offered.");
            const packageRef = payload.packageCode || payload.selectedPackageCode || payload.packageName || payload.package;
            const pkg = (product.packages||[]).find(item=>normalizePackageCode(item.packageCode)===normalizePackageCode(packageRef)||normalizePackageName(item.name)===normalizePackageName(packageRef));
            if (!pkg) throw new CatalogError("PACKAGE_NOT_OFFERED", "This package is not currently available.");
            const price = pkg.prices?.[region];
            if (!price||price.enabled===false||!Number.isFinite(Number(price.amount))||Number(price.amount)<=0)throw new CatalogError("PRICE_NOT_AVAILABLE","Pricing is not ready for this selling region.");
            const canonical={productCode:product.productCode,productName:product.name,packageCode:pkg.packageCode,packageName:pkg.name,region,currency:price.currency,amount:Number(price.amount)};
            assertClientCompatibility(payload,canonical);return canonical;
        }
        products = await CatalogProduct.find().sort({ sortOrder: 1, productCode: 1 }).lean();
        const product = getDatabaseProductFromRows(payload, products);
        packages = await CatalogPackage.find({ productCode: product.productCode })
            .sort({ sortOrder: 1, packageCode: 1 })
            .lean();

        return resolveDatabasePackagePriceFromRows(payload, { products: [product], packages });
    } catch (error) {
        if (error instanceof CatalogError) throw error;

        throw new CatalogError(
            "CATALOG_UNAVAILABLE",
            "Catalog is temporarily unavailable.",
            500
        );
    }
}

async function resolvePackagePrice(payload = {}, options = {}) {
    const source = storeCatalogSelectionMode() === "EXPLICIT" ? "database" : (options.source || getCatalogSource());

    if (source === "database") {
        return resolveDatabasePackagePrice(payload);
    }

    return resolveStaticPackagePrice(payload);
}

async function resolveOrderCatalog(payload = {}, options = {}) {
    const canonical = await resolvePackagePrice({
        productCode: payload.productCode || payload.gameKey,
        gameKey: payload.gameKey,
        game: payload.game,
        packageCode: payload.packageCode,
        packageName: payload.packageName || payload.package,
        package: payload.package,
        region: payload.region,
        clientAmount: payload.amount,
        clientCurrency: payload.currency
    }, options);

    return {
        ...canonical,
        game: canonical.productName,
        selectedPackage: canonical.packageName
    };
}

function collectMediaAssetIds(products = [], packages = []) {
    const ids = new Set();

    products.forEach(product => {
        if (product?.presentation?.imageAssetId) ids.add(product.presentation.imageAssetId);
        if (product?.presentation?.bannerAssetId) ids.add(product.presentation.bannerAssetId);
        if (product?.presentation?.mobilePackagePreview?.assetId) {
            ids.add(product.presentation.mobilePackagePreview.assetId);
        }
    });

    packages.forEach(item => {
        if (item?.iconAssetId) ids.add(item.iconAssetId);
    });

    return Array.from(ids);
}

async function loadMediaAssetMap(products = [], packages = []) {
    const ids = collectMediaAssetIds(products, packages);
    if (!ids.length) return new Map();

    const assets = await MediaAsset.find({
        assetId: { $in: ids },
        status: "active"
    }).lean();

    return new Map(assets.map(asset => [asset.assetId, asset]));
}

function mediaUrl(asset) {
    return asset?.secureUrl || asset?.url || "";
}

function projectCatalogPackage(
    item = {},
    {
        includeDisabled = true,
        mediaMap = new Map(),
        includeAssetProjection = false,
        includeAdminPricing = false
    } = {}
) {
    if (!includeDisabled && item.deletedAt) return null;
    if (!includeDisabled && item.enabled === false) return null;

    const prices = {};

    Object.entries(REGION_CURRENCIES).forEach(([region, currency]) => {
        const price = priceForRegion(item, region);

        if (!price || (!includeDisabled && price.enabled === false)) return;

        prices[region] = {
            amount: Number(price.amount),
            currency: price.currency || currency,
            enabled: price.enabled !== false,

            referencePrice:
                price.referencePrice == null
                    ? null
                    : Number(price.referencePrice),

            saveAmount:
                Number.isFinite(Number(price.saveAmount))
                    ? Number(price.saveAmount)
                    : 0,

            discountPercent:
                Number.isFinite(Number(price.discountPercent))
                    ? Number(price.discountPercent)
                    : 0,

            showDiscount: price.showDiscount === true,
            showOriginalPrice: price.showOriginalPrice === true,
            showSaveAmount: price.showSaveAmount === true,
            discountLabel: price.discountLabel || ""
        };

        if (includeAdminPricing) {
            prices[region].publishedPriceMode =
                price.publishedPriceMode || "LEGACY_COMPATIBILITY_PRICE";

            prices[region].manualOverrideReason =
                price.manualOverrideReason || "";

            prices[region].supplierCost =
                price.supplierCost == null
                    ? null
                    : Number(price.supplierCost);

            prices[region].supplierCurrency =
                price.supplierCurrency || "";

            prices[region].supplierName =
                price.supplierName || "";

            prices[region].supplierVersion =
                price.supplierVersion || "";

            prices[region].supplierCostTimestamp =
                price.supplierCostTimestamp || null;

            prices[region].rawSupplierCost = price.rawSupplierCost == null ? null : Number(price.rawSupplierCost);
            prices[region].rawSupplierCurrency = price.rawSupplierCurrency || "";
            prices[region].supplierCostSource = price.supplierCostSource || "";
            prices[region].providerProductCode = price.providerProductCode || "";
            prices[region].providerOfferCode = price.providerOfferCode || "";
            prices[region].fxRate = price.fxRate == null ? null : Number(price.fxRate);
            prices[region].fxRateSource = price.fxRateSource || "";
            prices[region].fxRateCapturedAt = price.fxRateCapturedAt || null;
            prices[region].fxRateEffectiveAt = price.fxRateEffectiveAt || null;
            prices[region].fxRateExpiresAt = price.fxRateExpiresAt || null;
            prices[region].fxRateMaxAgeSeconds = price.fxRateMaxAgeSeconds == null ? null : Number(price.fxRateMaxAgeSeconds);
            prices[region].fxConvertedCost = price.fxConvertedCost == null ? null : Number(price.fxConvertedCost);
            prices[region].fundingCost = price.fundingCost == null ? 0 : Number(price.fundingCost);
            prices[region].otherAcquisitionCost = price.otherAcquisitionCost == null ? 0 : Number(price.otherAcquisitionCost);
            prices[region].landedCost = price.landedCost == null ? null : Number(price.landedCost);
            prices[region].landedCurrency = price.landedCurrency || "";

            prices[region].pricingNote =
                price.pricingNote || "";
        }
    });

    const iconAsset = item.iconAssetId
        ? mediaMap.get(item.iconAssetId)
        : null;

    const projection = {
        productCode: item.productCode,
        packageCode: item.packageCode,
        name: item.name,
        packageFamily: item.packageFamily?.code ? { code: item.packageFamily.code, name: item.packageFamily.name, sortOrder: Number(item.packageFamily.sortOrder || 0), parentCode: item.packageFamily.parentCode || "" } : null,
        customerNote: normalizeCustomerNote(item.customerNote),
        customerNoteLocales: normalizeCustomerNoteLocales(item.customerNoteLocales, item.customerNote),
        enabled: item.enabled !== false,
        deleted: Boolean(item.deletedAt),
        deletedAt: item.deletedAt || null,
        prices,
        sortOrder: Number(item.sortOrder || 0),
        iconUrl: mediaUrl(iconAsset),
        iconAltText: iconAsset?.altText || "",
        updatedAt: item.updatedAt || null
    };

    if (includeAssetProjection) {
        projection.iconAsset = projectMediaAsset(iconAsset);
    }

    if (includeAdminPricing) {
        projection.supplierCostHistory = Array.isArray(
            item.supplierCostHistory
        )
            ? item.supplierCostHistory
                .slice(-20)
                .map(entry => ({
                    region: entry.region || "",
                    previousSupplierCost:
                        entry.previousSupplierCost == null
                            ? null
                            : Number(entry.previousSupplierCost),
                    newSupplierCost:
                        entry.newSupplierCost == null
                            ? null
                            : Number(entry.newSupplierCost),
                    previousSupplierCurrency:
                        entry.previousSupplierCurrency || "",
                    newSupplierCurrency:
                        entry.newSupplierCurrency || "",
                    supplierName:
                        entry.supplierName || "",
                    supplierVersion:
                        entry.supplierVersion || "",
                    supplierCostTimestamp:
                        entry.supplierCostTimestamp || null,
                    pricingNote:
                        entry.pricingNote || "",
                    changedBy:
                        entry.changedBy || "",
                    changedAt:
                        entry.changedAt || null
                }))
            : [];
    }

    return projection;
}

function projectCatalogProduct(product = {}, packages = [], {
    includeDisabled = true,
    mediaMap = new Map(),
    includeAssetProjection = false,
    includeAdminPricing = false,
    publicProjection = !includeAdminPricing
} = {}) {
    if (!includeDisabled && product.deletedAt) return null;
    if (!includeDisabled && product.enabled === false) return null;

    const supportedRegions = normalizeProductRegions(product);
    const publicPackages = packages
        .map(item => projectCatalogPackage(item, { includeDisabled, mediaMap, includeAssetProjection, includeAdminPricing }))
        .filter(Boolean)
        .map(pkg => {
            if (!publicProjection) return pkg;
            pkg.prices = Object.fromEntries(Object.entries(pkg.prices || {})
                .filter(([region]) => supportedRegions.includes(region)));
            return pkg;
        });
    const imageAsset = product.presentation?.imageAssetId
        ? mediaMap.get(product.presentation.imageAssetId)
        : null;
    const bannerAsset = product.presentation?.bannerAssetId
        ? mediaMap.get(product.presentation.bannerAssetId)
        : null;
    const mobilePackagePreviewAsset = product.presentation?.mobilePackagePreview?.assetId
        ? mediaMap.get(product.presentation.mobilePackagePreview.assetId)
        : null;

    const projection = {
        productCode: product.productCode,
        name: product.name,
        description: product.description || "",
        productKnowledge: normalizeProductKnowledge(product.productKnowledge),
        fulfillment: {
            manualAllowedRegions: Array.isArray(product.fulfillment?.manualAllowedRegions)
                ? product.fulfillment.manualAllowedRegions.filter(region => ["MM", "TH"].includes(region))
                : []
        },
        enabled: product.enabled !== false,
        featured: product.featured === true,
        catalogCategory: product.catalogCategory || "",
        publicCategory: publicCategoryFor(product.catalogCategory),
        lifecycleStatus: product.lifecycleStatus || "ACTIVE",
        comingSoon: product.lifecycleStatus === "COMING_SOON",
        requestedCommerceState: product.commerceState || "HIDDEN",
        commerceState: product.commerceState || "HIDDEN",
        publicDiscoveryEnabled: product.publicDiscoveryEnabled === true,
        homepageEnabled: product.homepageEnabled === true,
        homepageCategory: product.homepageCategory || product.catalogCategory || "",
        homepageOrder: Number(product.homepageOrder || 0),
        homepageFlags: Array.isArray(product.homepageFlags) ? product.homepageFlags : [],
        homepageSections: Array.isArray(product.homepageSections) ? product.homepageSections : [],
        productRoute: resolveCanonicalProductRoute(product.productCode),
        artworkPath: product.artworkPath || "",
        marketScope: product.presentation?.marketScope || "MULTI_REGION",
        displayMarketLabel: product.presentation?.displayMarketLabel || "",
        previewPrice: product.presentation?.previewPrice?.amount == null ? null : {
            amount: Number(product.presentation.previewPrice.amount),
            currency: product.presentation.previewPrice.currency || "",
            label: product.presentation.previewPrice.label || "PREVIEW_PRICE",
            isPreviewPrice: true
        },
        deleted: Boolean(product.deletedAt),
        deletedAt: product.deletedAt || null,
        supportedRegions,
        packageCount: packages.length,
        packages: publicPackages,
        sortOrder: Number(product.sortOrder || 0),
        imageUrl: mediaUrl(imageAsset),
        imageAltText: imageAsset?.altText || "",
        bannerUrl: mediaUrl(bannerAsset),
        bannerAltText: bannerAsset?.altText || "",
        mobilePackagePreview: {
            url: mediaUrl(mobilePackagePreviewAsset),
            publicId: mobilePackagePreviewAsset?.publicId || "",
            altText: mobilePackagePreviewAsset?.altText || ""
        },
        mobilePackagePreviewUrl: mediaUrl(mobilePackagePreviewAsset),
        seo: {
            title: product.seo?.title || "",
            description: product.seo?.description || ""
        },
        updatedAt: product.updatedAt || null
    };

    if (includeAssetProjection) {
        projection.imageAsset = projectMediaAsset(imageAsset);
        projection.bannerAsset = projectMediaAsset(bannerAsset);
        projection.mobilePackagePreviewAsset = projectMediaAsset(mobilePackagePreviewAsset);
    } else {
        const publicImageAsset = projectPublicMediaAsset(imageAsset);
        const publicBannerAsset = projectPublicMediaAsset(bannerAsset);
        const publicMobilePackagePreviewAsset = projectPublicMediaAsset(mobilePackagePreviewAsset);
        if (publicImageAsset) projection.publicImageAsset = publicImageAsset;
        if (publicBannerAsset) projection.publicBannerAsset = publicBannerAsset;
        if (publicMobilePackagePreviewAsset) {
            projection.mobilePackagePreview.asset = publicMobilePackagePreviewAsset;
        }
    }

    return projection;
}

function isAdminCanonicalCatalogProduct(product = {}) {
    return /^[a-z0-9][a-z0-9-]{0,79}$/.test(String(product.productCode || "").trim().toLowerCase()) && product.deleted !== true;
}

function projectCommerceReadiness(product = {}, packages = [], mappings = [], inventoryStates = [], suppliers = [], eligibilityContext = {}) {
    const enabledPackages = packages.filter(item => item.enabled !== false && !item.deletedAt);
    const regions = Array.isArray(product.supportedRegions) ? product.supportedRegions : [];
    const unavailablePackageIds = new Set(inventoryStates
        .filter(item => item.availabilityState && item.availabilityState !== "AVAILABLE")
        .flatMap(item => [String(item.packageRef || ""), String(item.packageId || item.packageCode || "").toUpperCase()]));
    const packageAvailable = item => !unavailablePackageIds.has(String(item._id || "")) &&
        !unavailablePackageIds.has(String(item.packageCode || "").toUpperCase());
    const supplierById = new Map(suppliers.map(item => [String(item._id), item]));
    const mappingMatches = (item, region) => mappings.some(mapping =>
        mapping.enabled !== false &&
        String(mapping.productCode || "").toLowerCase() === String(product.productCode || "").toLowerCase() &&
        String(mapping.packageCode || "").toUpperCase() === String(item.packageCode || "").toUpperCase() &&
        (!isSupplierMappedAutoTopupThScope({ productCode: product.productCode, region }) || isProductionReadyFulfillmentMapping(mapping, supplierById.get(String(mapping.supplierId)), {
            ...eligibilityContext, productCode: product.productCode, packageCode: item.packageCode, region
        }))
    );
    const regional = Object.fromEntries(["MM", "TH"].map(region => {
        const supported = regions.includes(region);
        const pricedPackages = enabledPackages.filter(item => {
            const price = item.prices?.[region];
            return supported && price?.enabled !== false && Number.isFinite(Number(price?.amount)) && Number(price.amount) > 0;
        });
        const manualFulfillmentAllowed = isSupplierMappedAutoTopupThScope({ productCode: product.productCode, region }) ? false : isManualFulfillmentAllowed(product, region);
        const fulfillmentPackages = pricedPackages.filter(item => manualFulfillmentAllowed || mappingMatches(item, region));
        const availablePackages = pricedPackages.filter(packageAvailable);
        return [region, {
            supported,
            pricing: pricedPackages.length > 0,
            fulfillment: fulfillmentPackages.length > 0,
            availability: availablePackages.length > 0,
            pricedPackageCount: pricedPackages.length,
            fulfillmentPackageCount: fulfillmentPackages.length,
            manualFulfillmentAllowed,
            availablePackageCount: availablePackages.length
        }];
    }));
    const pricing = Object.values(regional).some(item => item.pricing);
    const fulfillment = Object.values(regional).some(item => item.fulfillment);
    const availability = Object.values(regional).some(item => item.availability);
    const checks = {
        catalog: product.enabled !== false && !product.deletedAt,
        packages: enabledPackages.length > 0,
        region: regions.length > 0,
        pricing,
        fulfillment,
        availability,
        route: Boolean(resolveCanonicalProductRoute(product.productCode)),
        artwork: Boolean(String(product.artworkPath || "").trim() || product.presentation?.imageAssetId)
    };
    const missing = Object.entries(checks).filter(([, valid]) => !valid).map(([key]) => key);
    return { ready: missing.length === 0, checks, missing, regions: regional };
}

function applyPackageFulfillmentReadiness(projection, mappings = [], inventoryStates = [], suppliers = [], eligibilityContext = {}) {
    if (!projection || !Array.isArray(projection.packages)) return projection;
    const unavailablePackageIds = new Set(inventoryStates
        .filter(item => item.availabilityState && item.availabilityState !== "AVAILABLE")
        .flatMap(item => [String(item.packageRef || ""), String(item.packageId || item.packageCode || "").toUpperCase()]));
    const supplierById = new Map(suppliers.map(item => [String(item._id), item]));
    projection.packages.forEach(pkg => {
        const available = !unavailablePackageIds.has(String(pkg._id || "")) &&
            !unavailablePackageIds.has(String(pkg.packageCode || "").toUpperCase());
        pkg.fulfillmentRegions = Object.fromEntries(["MM", "TH"].map(region => {
            const supplierMappedScope = isSupplierMappedAutoTopupThScope({ productCode: projection.productCode, region });
            const mapped = mappings.some(mapping => mapping.enabled !== false &&
                String(mapping.productCode || "").toLowerCase() === String(projection.productCode || "").toLowerCase() &&
                String(mapping.packageCode || "").toUpperCase() === String(pkg.packageCode || "").toUpperCase() &&
                (!supplierMappedScope || isProductionReadyFulfillmentMapping(mapping, supplierById.get(String(mapping.supplierId)), {
                    ...eligibilityContext, productCode: projection.productCode, packageCode: pkg.packageCode, region
                })));
            const manual = !supplierMappedScope && isManualFulfillmentAllowed(projection, region);
            return [region, productSupportsRegion(projection, region) && available && (manual || mapped)];
        }));
    });
    return projection;
}

function applyAdminSupplierSupport(projection, mappings = [], suppliers = [], eligibilityContext = {}) {
    if (!projection || !["mlbb", "freefire"].includes(projection.productCode) || !Array.isArray(projection.packages)) return projection;
    const productCode = projection.productCode;
    const supplierById = new Map(suppliers.map(item => [String(item._id), item]));
    projection.packages.forEach(pkg => {
        const exact = mappings.filter(mapping =>
            String(mapping.productCode || "").toLowerCase() === productCode &&
            String(mapping.packageCode || "").toUpperCase() === String(pkg.packageCode || "").toUpperCase() &&
            Boolean(String(mapping.supplierPackageCode || "").trim()) &&
            String(mapping.executionMode || "").toUpperCase() === "API"
        );
        const details = exact.map(mapping => {
            const assessment = assessProductionReadyFulfillmentMapping(mapping, supplierById.get(String(mapping.supplierId)), {
                ...eligibilityContext, productCode, packageCode: pkg.packageCode, region: "TH"
            });
            return { supplierCode: String(mapping.supplierCode || "").toUpperCase(), ready: assessment.ready, blockers: assessment.blockers };
        });
        const readyMappings = details.filter(item => item.ready);
        const price = pkg.prices?.TH;
        pkg.supplierSupport = {
            TH: {
                status: readyMappings.length && pkg.enabled !== false && price?.enabled !== false ? "SUPPORTED" : exact.length ? "NOT_READY" : "UNSUPPORTED",
                mappingCount: exact.length,
                eligibleMappingCount: readyMappings.length,
                blocker: !exact.length ? "NO_SUPPLIER_MAPPING" : !readyMappings.length ? "NO_ELIGIBLE_SUPPLIER_MAPPING" : pkg.enabled === false ? "PACKAGE_DISABLED" : price?.enabled === false || !price ? "TH_PRICE_DISABLED" : "",
                suppliers: details
            }
        };
    });
    return projection;
}

function applyAdminProductionAttribution(projection, mappings = [], suppliers = [], publications = [], customerMarket = "TH") {
    if (!projection || !Array.isArray(projection.packages)) return projection;
    const market = String(customerMarket || "TH").trim().toUpperCase();
    const supplierById = new Map(suppliers.map(item => [String(item._id), item]));
    const publicationByPackage = new Map(publications.filter(item => String(item.customerMarket || "").toUpperCase() === market).map(item => [String(item.packageCode || "").toUpperCase(), item]));
    projection.packages.forEach(pkg => {
        const packageCode = String(pkg.packageCode || "").toUpperCase();
        const publication = publicationByPackage.get(packageCode);
        const candidates = mappings.filter(mapping => !mapping.archivedAt && mapping.enabled === true && supplierById.has(String(mapping.supplierId)) &&
            String(mapping.productionRole || "").toUpperCase() === "PRIMARY" && String(mapping.executionMode || "").toUpperCase() === "API" &&
            String(mapping.productCode || "").toLowerCase() === String(projection.productCode || "").toLowerCase() &&
            String(mapping.packageCode || "").toUpperCase() === packageCode
        ).map(mapping => {
            const supplier = supplierById.get(String(mapping.supplierId));
            return { mapping, supplier, assessment: assessProductionReadyFulfillmentMapping(mapping, supplier, { productCode: projection.productCode, packageCode, region: market }) };
        });
        const selected = candidates.length === 1 ? candidates[0] : null;
        const price = pkg.prices?.[market], published = publication?.published === true;
        const selling = Boolean(published && selected?.assessment.ready && pkg.enabled !== false && price?.enabled === true && Number(price.amount) > 0);
        pkg.productionAttribution = {
            customerMarket: market, publication: { published, decisionVersion: Number(publication?.decisionVersion || 0) },
            status: selling ? "SELLING" : published && !selected ? "PRODUCTION_SUPPLIER_MARKET_UNRESOLVED" : published && selected ? "PUBLISHED_ROUTE_NOT_READY" : "NOT_SELLING",
            publishedPrice: price?.enabled === true && Number(price.amount) > 0 ? { amount: Number(price.amount), currency: price.currency || "" } : null,
            supplier: selected ? { id: String(selected.supplier?._id || selected.mapping.supplierId), code: selected.supplier?.supplierCode || selected.mapping.supplierCode, name: selected.supplier?.name || selected.mapping.supplierCode } : null,
            supplierMarket: selected ? String(selected.mapping.region || "").toUpperCase() : null,
            supplierProductCode: selected?.mapping.supplierProductCode || null, supplierPackageCode: selected?.mapping.supplierPackageCode || null,
            productionRole: selected?.mapping.productionRole || null, mappingEnabled: selected?.mapping.enabled === true,
            fulfillmentReady: selected?.assessment.ready === true, mappingId: selected ? String(selected.mapping._id) : null,
            blockers: selected ? selected.assessment.blockers : [...new Set(candidates.flatMap(item => item.assessment.blockers))].sort()
        };
    });
    const publishedAttributions = projection.packages.map(pkg => pkg.productionAttribution).filter(item => item?.publication?.published);
    const attributedPublished = publishedAttributions.filter(item => item.mappingId);
    const selling = attributedPublished.filter(item => item.status === "SELLING");
    projection.productionSummary = { customerMarkets: publishedAttributions.length ? [market] : [], publishedPackageCount: publishedAttributions.length, productionSuppliers: [...new Set(attributedPublished.map(item => item.supplier?.code).filter(Boolean))].sort(), productionSupplierMarkets: [...new Set(attributedPublished.map(item => item.supplierMarket).filter(Boolean))].sort(), sellingPackageCount: selling.length, unresolvedPackageCodes: projection.packages.filter(pkg => pkg.productionAttribution?.status === "PRODUCTION_SUPPLIER_MARKET_UNRESOLVED").map(pkg => pkg.packageCode) };
    return projection;
}

function applyPublicPackageEligibility(projection) {
    if (!projection || !["mlbb", "freefire"].includes(projection.productCode) || !Array.isArray(projection.packages)) return projection;
    projection.packages = projection.packages.filter(pkg =>
        pkg.enabled !== false &&
        pkg.fulfillmentRegions?.TH === true &&
        pkg.prices?.TH?.enabled !== false &&
        Number.isFinite(Number(pkg.prices?.TH?.amount)) &&
        Number(pkg.prices.TH.amount) > 0
    );
    projection.packageCount = projection.packages.length;
    return projection;
}

function applyPublicReadiness(projection, product, packages, commerceReadiness) {
    projection.publicReadiness = resolvePublicProductReadiness(product, packages, commerceReadiness);
    projection.publicState = projection.publicReadiness.state;
    projection.purchasable = projection.publicState === "AVAILABLE";
    projection.comingSoon = projection.publicState === "COMING_SOON";
    projection.discoverable = projection.publicState !== "HIDDEN";
    projection.commerceState = projection.purchasable ? "PURCHASABLE" : (projection.comingSoon ? "COMING_SOON" : "HIDDEN");
    projection.availabilityCode = projection.publicReadiness.availabilityCode;
    projection.availabilityReason = projection.publicReadiness.availabilityReason;
    return projection;
}

function applyCustomerInputContract(projection, mappings = []) {
    const contracts = mappings
        .filter(mapping => mapping.enabled === true && String(mapping.productionRole || "").toUpperCase() === "PRIMARY")
        .map(verifiedMappingContract)
        .filter(Boolean);
    const fingerprints = new Set(contracts.map(contract => contract.fingerprint));
    projection.customerInputContract = fingerprints.size === 1 ? publicCustomerInputContract(contracts[0]) : null;
    return projection;
}

function toStaticPublicCatalog({ includeDisabled = true } = {}) {
    const snapshot = getStaticCatalogSnapshot();

    return snapshot.products
        .map(product => {
            const canonical = getCanonicalProduct(product.productCode);
            const projectionProduct = canonical
                ? { ...product, catalogCategory: canonical.catalogCategory }
                : product;
            const packages = snapshot.packages.filter(item => item.productCode === product.productCode);
            const projection = projectCatalogProduct(projectionProduct, packages, { includeDisabled });
            if (!projection) return null;
            const readiness = projectCommerceReadiness(projectionProduct, packages, [], []);
            projection.commerceReadiness = readiness;
            return applyPublicReadiness(projection, projectionProduct, packages, readiness);
        })
        .filter(Boolean);
}

async function toDatabasePublicCatalog({ includeDisabled = true, includeAssetProjection = false, includeAdminPricing = false, customerMarket = "TH", publicationProjectionMode } = {}) {
    const mode = publicationProjectionMode || publicationMode();
    const storeSelectionExplicit = storeCatalogSelectionMode() === "EXPLICIT";
    const [products, packages, mappings, inventoryStates, enabledSuppliers, publications, storeSelections] = await Promise.all([
        CatalogProduct.find().sort({ sortOrder: 1, productCode: 1 }).lean(),
        CatalogPackage.find().sort({ productCode: 1, sortOrder: 1, packageCode: 1 }).lean(),
        SupplierProductMapping.find({ enabled: true }).lean(),
        PackageInventoryState.find().lean(),
        Supplier.find({ enabled: true }).lean(),
        PackageMarketPublication.find({ customerMarket }).lean(),
        StoreCatalogSelection.find({ status: "ACTIVE", sellingRegions: String(customerMarket).toUpperCase(), visibleRegions:String(customerMarket).toUpperCase() }).lean()
    ]);
    const enabledSupplierIds = new Set(enabledSuppliers.map(item => String(item._id)));
    const activeMappings = mappings.filter(item => enabledSupplierIds.has(String(item.supplierId)));
    const mediaMap = await loadMediaAssetMap(products, packages);

    const legacyProducts = products
        .map(product => {
            const productPackages = packages.filter(item => item.productCode === product.productCode);
            const projection = projectCatalogProduct(product, productPackages, {
                includeDisabled,
                mediaMap,
                includeAssetProjection,
                includeAdminPricing
            });
            if (!projection) return null;
            projection.commerceReadiness = projectCommerceReadiness(
                product,
                productPackages,
                activeMappings.filter(item => item.productCode === product.productCode),
                inventoryStates.filter(item => productPackages.some(pkg => String(pkg._id) === String(item.packageRef) || pkg.packageCode === item.packageCode)),
                enabledSuppliers
            );
            applyPackageFulfillmentReadiness(projection, activeMappings.filter(item => item.productCode === product.productCode), inventoryStates, enabledSuppliers);
            applyCustomerInputContract(projection, activeMappings.filter(item => item.productCode === product.productCode));
            if (!includeAdminPricing) applyPublicPackageEligibility(projection);
            if (includeAdminPricing) applyPublicationMetadata(projection, publications, customerMarket);
            applyPublicReadiness(projection, product, productPackages, projection.commerceReadiness);
            if (!includeDisabled && !projection.discoverable) return null;
            return projection;
        })
        .filter(Boolean);

    if (includeAdminPricing) return legacyProducts;
    if (!storeSelectionExplicit && mode === "LEGACY") return legacyProducts;
    const recordsByProduct = new Map(products.map(product => [product.productCode, publications.filter(item => item.productCode === product.productCode)]));
    const proposedProducts = products
        .map(product => {
            const selectedCodes = new Set(storeSelections.filter(item => item.productCode === product.productCode).flatMap(item => item.packages || []).map(item => String(item.packageCode).toUpperCase()));
            const sourcePackages = packages.filter(item => item.productCode === product.productCode && (!storeSelectionExplicit || selectedCodes.has(String(item.packageCode).toUpperCase())));
            if (!sourcePackages.length) return null;
            const projection = projectCatalogProduct(product, sourcePackages, {
                includeDisabled,
                mediaMap,
                includeAssetProjection,
                includeAdminPricing: false
            });
            if (!projection) return null;
            const productMappings = activeMappings.filter(item => item.productCode === product.productCode);
            const productInventory = inventoryStates.filter(item => sourcePackages.some(pkg => String(pkg._id) === String(item.packageRef) || pkg.packageCode === item.packageCode));
            applyPackageFulfillmentReadiness(projection, productMappings, productInventory, enabledSuppliers);
            applyCustomerInputContract(projection, productMappings);
            applyPublicationMetadata(projection, recordsByProduct.get(product.productCode) || [], customerMarket);
            projection.packages = explicitPublishedPackages(projection);
            projection.packageCount = projection.packages.length;
            if (!projection.packages.length) return null;
            const publishedCodes = new Set(projection.packages.map(pkg => String(pkg.packageCode || "").toUpperCase()));
            const publishedSourcePackages = sourcePackages.filter(pkg => publishedCodes.has(String(pkg.packageCode || "").toUpperCase()));
            projection.commerceReadiness = projectCommerceReadiness(product, publishedSourcePackages, productMappings, productInventory, enabledSuppliers);
            applyPublicReadiness(projection, product, publishedSourcePackages, projection.commerceReadiness);
            if (!includeDisabled && !projection.discoverable) return null;
            return projection;
        })
        .filter(Boolean);
    if (mode === "SHADOW") {
        const comparison = comparePublicationSets(legacyProducts, proposedProducts, customerMarket);
        console.log("Package market publication shadow comparison:", comparison);
        return legacyProducts;
    }
    return proposedProducts.map(stripPublicationMetadata);
}

async function toPublicCatalog(options = {}) {
    const source = storeCatalogSelectionMode() === "EXPLICIT" ? "database" : (options.source || getCatalogSource());

    if (source === "database") {
        return toDatabasePublicCatalog({
            includeDisabled: options.includeDisabled !== false,
            includeAssetProjection: Boolean(options.includeAssetProjection),
            includeAdminPricing: Boolean(options.includeAdminPricing),
            customerMarket: options.customerMarket || "TH",
            publicationProjectionMode: options.publicationProjectionMode
        });
    }

    return toStaticPublicCatalog({ includeDisabled: options.includeDisabled !== false });
}

async function getCatalogProductDetail(productCode, options = {}) {
    const source = options.source || getCatalogSource();
    const requestedCode = String(productCode || "").trim().toLowerCase();
    const normalizedCode = getCanonicalProduct(requestedCode)?.productCode || requestedCode;
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(normalizedCode)) return null;

    if (source === "database") {
        const product = await CatalogProduct.findOne({ productCode: normalizedCode }).lean();
        if (!product) {
            if (!options.allowCanonicalFallback) return null;
            const canonical = getCanonicalProduct(normalizedCode);
            if (!canonical) return null;
            const fallback = {
                ...canonical,
                enabled: true,
                featured: false,
                lifecycleStatus: "ACTIVE",
                commerceState: "HIDDEN",
                publicDiscoveryEnabled: false,
                homepageEnabled: false,
                homepageOrder: 0,
                homepageFlags: [],
                homepageSections: [],
                packages: [],
                packageCount: 0,
                description: "",
                productKnowledge: normalizeProductKnowledge(),
                seo: { title: "", description: "" },
                metadataRecordMissing: true
            };
            fallback.commerceReadiness = projectCommerceReadiness(fallback, [], [], []);
            fallback.purchasable = false;
            fallback.discoverable = false;
            fallback.comingSoon = false;
            fallback.temporarilyUnavailable = false;
            return fallback;
        }
        const [packages, mappings, inventoryStates, publications] = await Promise.all([
            CatalogPackage.find({ productCode: normalizedCode }).sort({ sortOrder: 1, packageCode: 1 }).lean(),
            SupplierProductMapping.find({ productCode: normalizedCode, enabled: true }).lean(),
            PackageInventoryState.find().lean(),
            PackageMarketPublication.find({ productCode: normalizedCode, customerMarket: options.customerMarket || "TH" }).lean()
        ]);
        const mediaMap = await loadMediaAssetMap([product], packages);
        const enabledSuppliers = await Supplier.find({
            _id: { $in: mappings.map(item => item.supplierId) },
            enabled: true
        }).lean();
        const enabledSupplierIds = new Set(enabledSuppliers.map(item => String(item._id)));
        const activeMappings = mappings.filter(item => enabledSupplierIds.has(String(item.supplierId)));
        const projection = projectCatalogProduct(product, packages, {
            includeDisabled: options.includeDisabled !== false,
            mediaMap,
            includeAssetProjection: Boolean(options.includeAssetProjection),
            includeAdminPricing: Boolean(options.includeAdminPricing)
        });
        if (!projection) return null;
        const packageIds = new Set(packages.map(item => String(item._id)));
        projection.commerceReadiness = projectCommerceReadiness(
            product,
            packages,
            activeMappings,
            inventoryStates.filter(item => packageIds.has(String(item.packageRef)) || packages.some(pkg => pkg.packageCode === item.packageCode)),
            enabledSuppliers
        );
        applyPackageFulfillmentReadiness(projection, activeMappings, inventoryStates, enabledSuppliers);
        applyPublicationMetadata(projection, publications, options.customerMarket || "TH");
        if (!options.includeAdminPricing) applyPublicPackageEligibility(projection);
        applyPublicReadiness(projection, product, packages, projection.commerceReadiness);
        if (options.includeDisabled === false && !projection.discoverable) return null;
        return projection;
    }

    const product = toStaticPublicCatalog({ includeDisabled: options.includeDisabled !== false })
        .find(item => item.productCode === normalizedCode);
    return product || null;
}

async function resolveAdminCatalogProduct(productCode, options = {}) {
    const canonical = getCanonicalProduct(productCode);
    const canonicalCode = canonical?.productCode || String(productCode || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(canonicalCode)) return null;
    const findProduct = options.findProduct || (code => CatalogProduct.findOne({ productCode: code }).lean());
    const findPackages = options.findPackages || (code => CatalogPackage.find({ productCode: code }).sort({ sortOrder: 1, packageCode: 1 }).lean());
    const findMappings = options.findMappings || (code => SupplierProductMapping.find({ productCode: code }).lean());
    const findInventoryStates = options.findInventoryStates || (() => PackageInventoryState.find().lean());
    const findPublications = options.findPublications || (options.findMappings
        ? (() => [])
        : (code => PackageMarketPublication.find({ productCode: code, customerMarket: options.customerMarket || "TH" }).lean()));
    const findStoreSelections = options.findStoreSelections || (code => StoreCatalogSelection.find({
        productCode: code,
        status: "ACTIVE"
    }).select("packages.packageCode").lean());
    const product = await findProduct(canonicalCode);
    if (!product && !canonical) return null;
    const [canonicalPackages, mappings, inventoryStates, publications, storeSelections] = await Promise.all([
        findPackages(canonicalCode),
        findMappings(canonicalCode),
        findInventoryStates(),
        findPublications(canonicalCode),
        options.storeCatalogPackageScope === true ? findStoreSelections(canonicalCode) : Promise.resolve([])
    ]);
    const selectedPackageCodes = new Set(storeSelections.flatMap(selection => selection.packages || [])
        .map(item => String(item.packageCode || "").trim().toUpperCase())
        .filter(Boolean));
    const packages = options.storeCatalogPackageScope === true
        ? canonicalPackages.filter(item => selectedPackageCodes.has(String(item.packageCode || "").trim().toUpperCase()))
        : canonicalPackages;
    const foundation = product ? {
        ...(canonical || {}),
        ...product,
        productCode: canonicalCode,
        name: product.name || canonical?.name || canonicalCode,
        supportedRegions: Array.isArray(product.supportedRegions) ? product.supportedRegions : (canonical?.supportedRegions || [])
    } : {
        ...canonical,
        enabled: true,
        featured: false,
        lifecycleStatus: "ACTIVE",
        commerceState: "HIDDEN",
        publicDiscoveryEnabled: false,
        homepageEnabled: false,
        homepageOrder: 0,
        homepageFlags: [],
        homepageSections: [],
        description: "",
        productKnowledge: normalizeProductKnowledge(),
        seo: { title: "", description: "" }
    };
    const mediaMap = options.loadMediaMap
        ? await options.loadMediaMap([foundation], packages)
        : await loadMediaAssetMap([foundation], packages);
    const enabledSuppliers = options.findSuppliers
        ? await options.findSuppliers(mappings)
        : options.findMappings
            ? mappings.map(item => ({ _id: item.supplierId, supplierCode: item.supplierCode, enabled: true, mode: item.executionMode, supportedRegions: [item.region] }))
            : await Supplier.find({
            _id: { $in: mappings.map(item => item.supplierId) },
            enabled: true
        }).lean();
    const enabledSupplierIds = new Set(enabledSuppliers.map(item => String(item._id)));
    const activeMappings = mappings.filter(item => item.enabled === true && enabledSupplierIds.has(String(item.supplierId || "")));
    const projection = projectCatalogProduct(foundation, packages, {
        includeDisabled: true,
        mediaMap,
        includeAssetProjection: options.includeAssetProjection !== false,
        includeAdminPricing: options.includeAdminPricing !== false,
        publicProjection: false
    });
    projection.canonicalMarket = canonical?.market || foundation.market || "";
    const packageIds = new Set(packages.map(item => String(item._id)));
    projection.commerceReadiness = projectCommerceReadiness(
        foundation,
        packages,
        activeMappings,
        inventoryStates.filter(item => packageIds.has(String(item.packageRef)) || packages.some(pkg => pkg.packageCode === item.packageCode)),
        enabledSuppliers
    );
    applyPackageFulfillmentReadiness(projection, activeMappings, inventoryStates, enabledSuppliers);
    applyPublicationMetadata(projection, publications, options.customerMarket || "TH");
    applyAdminSupplierSupport(projection, mappings, enabledSuppliers);
    applyAdminProductionAttribution(projection, mappings, enabledSuppliers, publications, options.customerMarket || "TH");
    applyPublicReadiness(projection, foundation, packages, projection.commerceReadiness);
    projection.metadataRecordMissing = !product;
    return projection;
}

module.exports = {
    applyPackageFulfillmentReadiness,
    applyCustomerInputContract,
    applyAdminProductionAttribution,
    applyAdminSupplierSupport,
    applyPublicPackageEligibility,
    CatalogError,
    storeCatalogSelectionMode,
    getCatalogProductDetail,
    resolveAdminCatalogProduct,
    getCatalogSource,
    getPackage,
    getProduct,
    normalizePackageCode,
    normalizeProductCode,
    normalizeRegion,
    projectCatalogProduct,
    resolveDatabasePackagePriceFromRows,
    resolveOrderCatalog,
    resolvePackagePrice,
    projectCommerceReadiness,
    applyPublicReadiness,
    isAdminCanonicalCatalogProduct,
    toPublicCatalog
};
