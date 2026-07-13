const catalog = require("../catalog/catalog");

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

function normalizeProductCode(value = "") {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

function normalizePackageCode(value = "") {
    return String(value || "")
        .trim()
        .toUpperCase();
}

function normalizePackageName(value = "") {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function normalizeRegion(value = "") {
    return String(value || "MM").trim().toUpperCase();
}

function normalizeCurrency(value = "") {
    return String(value || "").trim().toUpperCase();
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

function getProductFromPayload(payload = {}) {
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

function getPackageFromPayload(product, payload = {}) {
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

function resolvePackagePrice(payload = {}) {
    const product = getProductFromPayload(payload);
    const item = getPackageFromPayload(product, payload);
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

function resolveOrderCatalog(payload = {}) {
    const canonical = resolvePackagePrice({
        productCode: payload.productCode || payload.gameKey,
        gameKey: payload.gameKey,
        game: payload.game,
        packageCode: payload.packageCode,
        packageName: payload.packageName || payload.package,
        package: payload.package,
        region: payload.region,
        clientAmount: payload.amount,
        clientCurrency: payload.currency
    });

    return {
        ...canonical,
        game: canonical.productName,
        selectedPackage: canonical.packageName
    };
}

function toPublicCatalog() {
    return catalog.products.map(product => ({
        productCode: product.productCode,
        name: product.name,
        enabled: Boolean(product.enabled),
        regions: catalog.supportedRegions,
        packages: (product.packages || []).map(item => ({
            packageCode: item.packageCode,
            name: item.name,
            enabled: Boolean(item.enabled),
            prices: item.prices
        }))
    }));
}

module.exports = {
    CatalogError,
    getProduct,
    getPackage,
    resolvePackagePrice,
    resolveOrderCatalog,
    toPublicCatalog,
    normalizeProductCode,
    normalizePackageCode,
    normalizeRegion
};
