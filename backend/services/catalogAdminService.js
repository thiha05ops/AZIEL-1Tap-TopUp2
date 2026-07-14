const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const {
    REGION_CURRENCIES,
    normalizePackageCode,
    normalizeProductCode,
    normalizeRegion
} = require("../catalog/catalogProjection");

class CatalogAdminError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "CatalogAdminError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const MAX_PRICE = 100000000;

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

module.exports = {
    CatalogAdminError,
    updatePackage,
    updateProduct
};
