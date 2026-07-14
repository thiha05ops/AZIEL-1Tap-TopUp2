const staticCatalog = require("./catalog");

const REGION_CURRENCIES = Object.freeze({
    MM: "MMK",
    TH: "THB"
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

function normalizeRegion(value = "") {
    return String(value || "MM").trim().toUpperCase();
}

function normalizeCurrency(value = "") {
    return String(value || "").trim().toUpperCase();
}

function normalizePrice(region, price = {}) {
    const normalizedRegion = normalizeRegion(region);
    const currency = normalizeCurrency(price.currency || REGION_CURRENCIES[normalizedRegion]);

    return {
        amount: Number(price.amount),
        currency,
        enabled: price.enabled !== false
    };
}

function normalizeProduct(product = {}, sortOrder = 0) {
    return {
        productCode: normalizeProductCode(product.productCode),
        name: String(product.name || "").trim(),
        enabled: product.enabled !== false,
        supportedRegions: Array.from(new Set(
            Object.keys(REGION_CURRENCIES).filter(region => {
                const packages = product.packages || [];
                return packages.some(item => item.prices?.[region]);
            })
        )),
        aliases: Array.isArray(product.aliases) ? product.aliases.filter(Boolean).map(String) : [],
        sortOrder,
        source: "seeded",
        metadata: {}
    };
}

function normalizePackage(product = {}, item = {}, sortOrder = 0) {
    const prices = {};

    Object.entries(REGION_CURRENCIES).forEach(([region]) => {
        if (item.prices?.[region]) {
            prices[region] = normalizePrice(region, item.prices[region]);
        }
    });

    return {
        productCode: normalizeProductCode(product.productCode),
        packageCode: normalizePackageCode(item.packageCode),
        name: String(item.name || "").trim(),
        enabled: item.enabled !== false,
        prices,
        sortOrder,
        source: "seeded",
        metadata: {}
    };
}

function getStaticCatalogSnapshot(source = staticCatalog) {
    const products = [];
    const packages = [];

    (source.products || []).forEach((product, productIndex) => {
        products.push(normalizeProduct(product, productIndex));

        (product.packages || []).forEach((item, packageIndex) => {
            packages.push(normalizePackage(product, item, packageIndex));
        });
    });

    return {
        products,
        packages,
        regionCurrencies: { ...REGION_CURRENCIES },
        supportedRegions: Object.keys(REGION_CURRENCIES)
    };
}

function priceForRegion(item = {}, region) {
    return item.prices?.[normalizeRegion(region)] || null;
}

module.exports = {
    REGION_CURRENCIES,
    getStaticCatalogSnapshot,
    normalizeCurrency,
    normalizePackage,
    normalizePackageCode,
    normalizePrice,
    normalizeProduct,
    normalizeProductCode,
    normalizeRegion,
    priceForRegion
};
