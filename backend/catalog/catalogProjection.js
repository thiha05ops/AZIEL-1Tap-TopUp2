const staticCatalog = require("./catalog");

const REGION_CURRENCIES = Object.freeze({
    MM: "MMK",
    TH: "THB"
});

const MAX_PRICE = 100000000;
const MAX_DISCOUNT_LABEL = 40;

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

function normalizeOptionalPrice(value) {
    if (value === "" || value === null || value === undefined) {
        return null;
    }

    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_PRICE) {
        return null;
    }

    return amount;
}

function normalizeDiscountLabel(value = "") {
    return String(value || "")
        .trim()
        .slice(0, MAX_DISCOUNT_LABEL);
}

function deriveDiscountPricing(price = {}) {
    const amount = Number(price.amount);
    const referencePrice = normalizeOptionalPrice(price.referencePrice);

    const hasValidDiscount =
        Number.isFinite(amount) &&
        amount > 0 &&
        referencePrice !== null &&
        referencePrice > amount;

    const saveAmount = hasValidDiscount
        ? Math.max(0, referencePrice - amount)
        : 0;

    const discountPercent = hasValidDiscount
        ? Math.round((saveAmount / referencePrice) * 100)
        : 0;

    const showDiscount = price.showDiscount === true && hasValidDiscount;
    const showOriginalPrice =
        showDiscount &&
        price.showOriginalPrice !== false;
    const showSaveAmount =
        showDiscount &&
        price.showSaveAmount !== false;

    const customDiscountLabel = normalizeDiscountLabel(price.discountLabel);
    const resolvedDiscountLabel = showDiscount
        ? (customDiscountLabel || `${discountPercent}% OFF`)
        : "";

    return {
        referencePrice: hasValidDiscount ? referencePrice : null,
        saveAmount,
        discountPercent,
        showDiscount,
        showOriginalPrice,
        showSaveAmount,
        discountLabel: resolvedDiscountLabel
    };
}

function normalizePrice(region, price = {}) {
    const normalizedRegion = normalizeRegion(region);
    const currency = normalizeCurrency(
        price.currency || REGION_CURRENCIES[normalizedRegion]
    );
    const amount = Number(price.amount);

    const discount = deriveDiscountPricing({
        amount,
        referencePrice: price.referencePrice,
        showDiscount: price.showDiscount,
        showOriginalPrice: price.showOriginalPrice,
        showSaveAmount: price.showSaveAmount,
        discountLabel: price.discountLabel
    });

    return {
        amount,
        currency,
        enabled: price.enabled !== false,
        referencePrice: discount.referencePrice,
        saveAmount: discount.saveAmount,
        discountPercent: discount.discountPercent,
        showDiscount: discount.showDiscount,
        showOriginalPrice: discount.showOriginalPrice,
        showSaveAmount: discount.showSaveAmount,
        discountLabel: discount.discountLabel
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
        aliases: Array.isArray(product.aliases)
            ? product.aliases.filter(Boolean).map(String)
            : [],
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
    const price = item.prices?.[normalizeRegion(region)];

    if (!price) {
        return null;
    }

    return normalizePrice(region, price);
}

module.exports = {
    REGION_CURRENCIES,
    deriveDiscountPricing,
    getStaticCatalogSnapshot,
    normalizeCurrency,
    normalizeDiscountLabel,
    normalizePackage,
    normalizePackageCode,
    normalizePrice,
    normalizeProduct,
    normalizeProductCode,
    normalizeRegion,
    priceForRegion
};