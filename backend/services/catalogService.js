const catalog = require("../catalog/catalog");
const MediaAsset = require("../models/MediaAsset");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
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
        !product.supportedRegions?.includes(region) ||
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
    const source = options.source || getCatalogSource();

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

function projectCatalogPackage(item = {}, { includeDisabled = true, mediaMap = new Map(), includeAssetProjection = false, includeAdminPricing = false } = {}) {
    if (!includeDisabled && item.deletedAt) return null;
    if (!includeDisabled && item.enabled === false) return null;

    const prices = {};

    Object.entries(REGION_CURRENCIES).forEach(([region, currency]) => {
        const price = priceForRegion(item, region);

        if (!price || (!includeDisabled && price.enabled === false)) return;

        prices[region] = {
            amount: Number(price.amount),
            currency: price.currency || currency,
            enabled: price.enabled !== false
        };

        if (includeAdminPricing) {
            prices[region].supplierCost = price.supplierCost == null ? null : Number(price.supplierCost);
            prices[region].supplierCurrency = price.supplierCurrency || "";
            prices[region].supplierName = price.supplierName || "";
            prices[region].supplierVersion = price.supplierVersion || "";
            prices[region].supplierCostTimestamp = price.supplierCostTimestamp || null;
            prices[region].pricingNote = price.pricingNote || "";
        }
    });

    const iconAsset = item.iconAssetId ? mediaMap.get(item.iconAssetId) : null;
    const projection = {
        productCode: item.productCode,
        packageCode: item.packageCode,
        name: item.name,
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
        projection.supplierCostHistory = Array.isArray(item.supplierCostHistory)
            ? item.supplierCostHistory.slice(-20).map(entry => ({
                region: entry.region || "",
                previousSupplierCost: entry.previousSupplierCost == null ? null : Number(entry.previousSupplierCost),
                newSupplierCost: entry.newSupplierCost == null ? null : Number(entry.newSupplierCost),
                previousSupplierCurrency: entry.previousSupplierCurrency || "",
                newSupplierCurrency: entry.newSupplierCurrency || "",
                supplierName: entry.supplierName || "",
                supplierVersion: entry.supplierVersion || "",
                supplierCostTimestamp: entry.supplierCostTimestamp || null,
                pricingNote: entry.pricingNote || "",
                changedBy: entry.changedBy || "",
                changedAt: entry.changedAt || null
            }))
            : [];
    }

    return projection;
}

function projectCatalogProduct(product = {}, packages = [], { includeDisabled = true, mediaMap = new Map(), includeAssetProjection = false, includeAdminPricing = false } = {}) {
    if (!includeDisabled && product.deletedAt) return null;
    if (!includeDisabled && product.enabled === false) return null;

    const publicPackages = packages
        .map(item => projectCatalogPackage(item, { includeDisabled, mediaMap, includeAssetProjection, includeAdminPricing }))
        .filter(Boolean);
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
        enabled: product.enabled !== false,
        featured: product.featured === true,
        deleted: Boolean(product.deletedAt),
        deletedAt: product.deletedAt || null,
        supportedRegions: Array.isArray(product.supportedRegions)
            ? product.supportedRegions
            : Object.keys(REGION_CURRENCIES),
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

function toStaticPublicCatalog({ includeDisabled = true } = {}) {
    const snapshot = getStaticCatalogSnapshot();

    return snapshot.products
        .map(product => {
            const packages = snapshot.packages.filter(item => item.productCode === product.productCode);
            return projectCatalogProduct(product, packages, { includeDisabled });
        })
        .filter(Boolean);
}

async function toDatabasePublicCatalog({ includeDisabled = true, includeAssetProjection = false, includeAdminPricing = false } = {}) {
    const [products, packages] = await Promise.all([
        CatalogProduct.find().sort({ sortOrder: 1, productCode: 1 }).lean(),
        CatalogPackage.find().sort({ productCode: 1, sortOrder: 1, packageCode: 1 }).lean()
    ]);
    const mediaMap = await loadMediaAssetMap(products, packages);

    return products
        .map(product => {
            const productPackages = packages.filter(item => item.productCode === product.productCode);
            return projectCatalogProduct(product, productPackages, {
                includeDisabled,
                mediaMap,
                includeAssetProjection,
                includeAdminPricing
            });
        })
        .filter(Boolean);
}

async function toPublicCatalog(options = {}) {
    const source = options.source || getCatalogSource();

    if (source === "database") {
        return toDatabasePublicCatalog({
            includeDisabled: options.includeDisabled !== false,
            includeAssetProjection: Boolean(options.includeAssetProjection),
            includeAdminPricing: Boolean(options.includeAdminPricing)
        });
    }

    return toStaticPublicCatalog({ includeDisabled: options.includeDisabled !== false });
}

async function getCatalogProductDetail(productCode, options = {}) {
    const source = options.source || getCatalogSource();
    const normalizedCode = normalizeProductCode(productCode);

    if (source === "database") {
        const product = await CatalogProduct.findOne({ productCode: normalizedCode }).lean();
        if (!product) return null;
        const packages = await CatalogPackage.find({ productCode: normalizedCode })
            .sort({ sortOrder: 1, packageCode: 1 })
            .lean();
        const mediaMap = await loadMediaAssetMap([product], packages);
        return projectCatalogProduct(product, packages, {
            includeDisabled: options.includeDisabled !== false,
            mediaMap,
            includeAssetProjection: Boolean(options.includeAssetProjection),
            includeAdminPricing: Boolean(options.includeAdminPricing)
        });
    }

    const product = toStaticPublicCatalog({ includeDisabled: options.includeDisabled !== false })
        .find(item => item.productCode === normalizedCode);
    return product || null;
}

module.exports = {
    CatalogError,
    getCatalogProductDetail,
    getCatalogSource,
    getPackage,
    getProduct,
    normalizePackageCode,
    normalizeProductCode,
    normalizeRegion,
    resolveDatabasePackagePriceFromRows,
    resolveOrderCatalog,
    resolvePackagePrice,
    toPublicCatalog
};
