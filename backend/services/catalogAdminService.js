const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const {
    REGION_CURRENCIES,
    normalizePackageCode,
    normalizeProductCode,
    normalizeRegion
} = require("../catalog/catalogProjection");
const { assertAssetCategory } = require("./mediaService");

class CatalogAdminError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "CatalogAdminError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const MAX_PRICE = 100000000;
const MAX_SORT_ORDER = 1000000;

function assertNoImmutableFields(patch = {}, fields = []) {
    fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(patch, field)) {
            throw new CatalogAdminError(
                "CATALOG_PATCH_INVALID",
                `${field} cannot be changed.`
            );
        }
    });
}

function normalizeExpectedUpdatedAt(value) {
    if (value instanceof Date) {
        return value;
    }

    const raw = String(value || "").trim();
    if (!raw) {
        throw new CatalogAdminError(
            "CATALOG_PATCH_INVALID",
            "expectedUpdatedAt is required."
        );
    }

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
        throw new CatalogAdminError(
            "CATALOG_PATCH_INVALID",
            "expectedUpdatedAt is invalid."
        );
    }

    return date;
}

function assertFresh(document, expectedUpdatedAt) {
    const expected = normalizeExpectedUpdatedAt(expectedUpdatedAt);
    const current = new Date(document.updatedAt);

    if (current.getTime() !== expected.getTime()) {
        throw new CatalogAdminError(
            "CATALOG_CONFLICT",
            "Catalog changed since you opened it. Refresh and try again.",
            409
        );
    }
}

function parseBoolean(value, field) {
    if (typeof value !== "boolean") {
        throw new CatalogAdminError(
            "CATALOG_PATCH_INVALID",
            `${field} must be true or false.`
        );
    }

    return value;
}

function parsePrice(value) {
    if (value === "" || value === null || value === undefined) {
        throw new CatalogAdminError(
            "CATALOG_PRICE_INVALID",
            "Price amount is required."
        );
    }

    const amount = Number(value);

    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PRICE) {
        throw new CatalogAdminError(
            "CATALOG_PRICE_INVALID",
            "Price amount must be a finite positive number."
        );
    }

    return amount;
}

function parseSortOrder(value) {
    const order = Number(value ?? 0);

    if (!Number.isInteger(order) || Math.abs(order) > MAX_SORT_ORDER) {
        throw new CatalogAdminError(
            "CATALOG_SORT_ORDER_INVALID",
            "Sort order must be a finite integer within the supported range."
        );
    }

    return order;
}

function normalizePackageName(value) {
    const name = String(value || "").trim();

    if (!name || name.length > 120) {
        throw new CatalogAdminError(
            "CATALOG_PACKAGE_NAME_INVALID",
            "Package name is required."
        );
    }

    return name;
}

function buildCreateRegionalPrice(region, patch = {}) {
    const currency = REGION_CURRENCIES[region];
    const enabled = Boolean(patch?.enabled);

    if (!enabled) return undefined;

    return {
        amount: parsePrice(patch.amount),
        currency,
        enabled: true
    };
}

async function buildCreatePackagePayload(product, patch = {}) {
    const packageCode = normalizePackageCode(patch.packageCode);

    if (!packageCode) {
        throw new CatalogAdminError(
            "CATALOG_PACKAGE_CODE_INVALID",
            "Package code is required."
        );
    }

    const prices = {
        MM: buildCreateRegionalPrice("MM", patch.prices?.MM),
        TH: buildCreateRegionalPrice("TH", patch.prices?.TH)
    };

    if (!prices.MM && !prices.TH) {
        throw new CatalogAdminError(
            "CATALOG_REGION_PRICE_UNAVAILABLE",
            "At least one regional price must be available."
        );
    }

    const supportedRegions = product.supportedRegions || [];
    Object.keys(prices).forEach(region => {
        if (prices[region] && supportedRegions.length && !supportedRegions.includes(region)) {
            throw new CatalogAdminError(
                "CATALOG_REGION_PRICE_UNAVAILABLE",
                "This product does not support the selected region."
            );
        }
    });

    const iconAssetId = String(patch.iconAssetId || "").trim();
    if (iconAssetId) {
        await assertAssetCategory(iconAssetId, "package_icon");
    }

    return {
        productCode: product.productCode,
        packageCode,
        name: normalizePackageName(patch.name),
        enabled: Object.prototype.hasOwnProperty.call(patch, "enabled")
            ? parseBoolean(patch.enabled, "enabled")
            : true,
        prices,
        sortOrder: parseSortOrder(patch.sortOrder),
        iconAssetId,
        source: "admin"
    };
}

function buildProductPatch(patch = {}) {
    assertNoImmutableFields(patch, ["_id", "id", "productCode", "source", "createdAt", "updatedAt", "__v"]);

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
        updates.enabled = parseBoolean(patch.enabled, "enabled");
    }

    const allowed = new Set(["enabled", "expectedUpdatedAt"]);
    Object.keys(patch).forEach(key => {
        if (!allowed.has(key)) {
            throw new CatalogAdminError("CATALOG_PATCH_INVALID", `${key} is not editable.`);
        }
    });

    return updates;
}

function buildPackagePatch(document, patch = {}) {
    assertNoImmutableFields(patch, ["_id", "id", "productCode", "packageCode", "source", "createdAt", "updatedAt", "__v"]);

    const updates = {};
    const allowed = new Set(["enabled", "prices", "expectedUpdatedAt"]);

    Object.keys(patch).forEach(key => {
        if (!allowed.has(key)) {
            throw new CatalogAdminError("CATALOG_PATCH_INVALID", `${key} is not editable.`);
        }
    });

    if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
        updates.enabled = parseBoolean(patch.enabled, "enabled");
    }

    if (patch.prices !== undefined) {
        if (!patch.prices || typeof patch.prices !== "object" || Array.isArray(patch.prices)) {
            throw new CatalogAdminError("CATALOG_PATCH_INVALID", "prices must be an object.");
        }

        Object.entries(patch.prices).forEach(([regionKey, pricePatch]) => {
            const region = normalizeRegion(regionKey);
            const currency = REGION_CURRENCIES[region];

            if (!currency) {
                throw new CatalogAdminError("CATALOG_PATCH_INVALID", "Unsupported price region.");
            }

            if (!document.prices?.[region]) {
                throw new CatalogAdminError(
                    "CATALOG_REGION_PRICE_UNAVAILABLE",
                    "This regional price is not available for the package."
                );
            }

            if (!pricePatch || typeof pricePatch !== "object" || Array.isArray(pricePatch)) {
                throw new CatalogAdminError("CATALOG_PATCH_INVALID", "Regional price patch must be an object.");
            }

            const regionalAllowed = new Set(["amount"]);
            Object.keys(pricePatch).forEach(key => {
                if (!regionalAllowed.has(key)) {
                    throw new CatalogAdminError("CATALOG_PATCH_INVALID", `${key} is not editable.`);
                }
            });

            if (Object.prototype.hasOwnProperty.call(pricePatch, "amount")) {
                updates[`prices.${region}.amount`] = parsePrice(pricePatch.amount);
                updates[`prices.${region}.currency`] = currency;
                updates[`prices.${region}.enabled`] = true;
            }
        });
    }

    return updates;
}

function hasChanges(document, updates = {}) {
    return Object.entries(updates).some(([path, value]) => {
        const current = path.split(".").reduce((row, key) => row?.[key], document);
        return current !== value;
    });
}

async function updateProduct({ productCode, patch = {}, actor = "admin" }) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const product = await CatalogProduct.findOne({ productCode: normalizedProductCode });

    if (!product) {
        throw new CatalogAdminError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
    }

    assertFresh(product, patch.expectedUpdatedAt);
    const updates = buildProductPatch(patch);

    if (!Object.keys(updates).length || !hasChanges(product, updates)) {
        return { changed: false, product: product.toObject() };
    }

    Object.assign(product, updates);
    await product.save();
    console.log("Catalog product updated:", {
        action: "catalog.product.update",
        productCode: normalizedProductCode,
        changedFields: Object.keys(updates),
        actor,
        timestamp: new Date().toISOString()
    });

    return { changed: true, product: product.toObject() };
}

async function updatePackage({ productCode, packageCode, patch = {}, actor = "admin" }) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const normalizedPackageCode = normalizePackageCode(packageCode);
    const item = await CatalogPackage.findOne({
        productCode: normalizedProductCode,
        packageCode: normalizedPackageCode
    });

    if (!item) {
        throw new CatalogAdminError("CATALOG_PACKAGE_NOT_FOUND", "Package not found.", 404);
    }

    assertFresh(item, patch.expectedUpdatedAt);
    const updates = buildPackagePatch(item, patch);

    if (!Object.keys(updates).length || !hasChanges(item, updates)) {
        return { changed: false, package: item.toObject() };
    }

    Object.entries(updates).forEach(([path, value]) => {
        item.set(path, value);
    });
    await item.save();
    console.log("Catalog package updated:", {
        action: "catalog.package.update",
        productCode: normalizedProductCode,
        packageCode: normalizedPackageCode,
        changedFields: Object.keys(updates),
        actor,
        timestamp: new Date().toISOString()
    });

    return { changed: true, package: item.toObject() };
}

async function createPackage({ productCode, patch = {}, actor = "admin" } = {}) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const product = await CatalogProduct.findOne({ productCode: normalizedProductCode }).lean();

    if (!product) {
        throw new CatalogAdminError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
    }

    const payload = await buildCreatePackagePayload(product, patch);
    const exists = await CatalogPackage.findOne({
        productCode: payload.productCode,
        packageCode: payload.packageCode
    }).lean();

    if (exists) {
        throw new CatalogAdminError(
            "PACKAGE_ALREADY_EXISTS",
            "Package already exists for this product.",
            409
        );
    }

    try {
        const item = await CatalogPackage.create(payload);
        console.log("Catalog package created:", {
            action: "catalog.package.create",
            productCode: payload.productCode,
            packageCode: payload.packageCode,
            actor,
            timestamp: new Date().toISOString()
        });

        return { changed: true, package: item.toObject() };
    } catch (error) {
        if (error?.code === 11000) {
            throw new CatalogAdminError(
                "PACKAGE_ALREADY_EXISTS",
                "Package already exists for this product.",
                409
            );
        }

        throw error;
    }
}

module.exports = {
    CatalogAdminError,
    createPackage,
    updatePackage,
    updateProduct
};
