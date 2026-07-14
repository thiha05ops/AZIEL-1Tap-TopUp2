const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const { normalizePackageCode, normalizeProductCode } = require("../catalog/catalogProjection");
const { CatalogAdminError } = require("./catalogAdminService");
const { assertAssetCategory } = require("./mediaService");

function normalizeExpectedUpdatedAt(value) {
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

async function setProductPresentationAsset({
    productCode,
    assetId,
    expectedUpdatedAt,
    slot = "image",
    actor = "admin"
} = {}) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const product = await CatalogProduct.findOne({ productCode: normalizedProductCode });

    if (!product) {
        throw new CatalogAdminError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
    }

    assertFresh(product, expectedUpdatedAt);

    const path = slot === "banner" ? "presentation.bannerAssetId" : "presentation.imageAssetId";
    const expectedCategory = slot === "banner" ? "product_banner" : "product_image";

    await assertAssetCategory(assetId, expectedCategory);

    if (product.get(path) === assetId) {
        return { changed: false, product: product.toObject() };
    }

    product.set(path, assetId);
    await product.save();

    console.log("Catalog presentation updated:", {
        action: `catalog.product.${slot}.attach`,
        productCode: normalizedProductCode,
        assetId,
        actor,
        timestamp: new Date().toISOString()
    });

    return { changed: true, product: product.toObject() };
}

async function clearProductPresentationAsset({
    productCode,
    expectedUpdatedAt,
    slot = "image",
    actor = "admin"
} = {}) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const product = await CatalogProduct.findOne({ productCode: normalizedProductCode });

    if (!product) {
        throw new CatalogAdminError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
    }

    assertFresh(product, expectedUpdatedAt);

    const path = slot === "banner" ? "presentation.bannerAssetId" : "presentation.imageAssetId";

    if (!product.get(path)) {
        return { changed: false, product: product.toObject() };
    }

    product.set(path, "");
    await product.save();

    console.log("Catalog presentation updated:", {
        action: `catalog.product.${slot}.clear`,
        productCode: normalizedProductCode,
        actor,
        timestamp: new Date().toISOString()
    });

    return { changed: true, product: product.toObject() };
}

async function setPackageIconAsset({
    productCode,
    packageCode,
    assetId,
    expectedUpdatedAt,
    actor = "admin"
} = {}) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const normalizedPackageCode = normalizePackageCode(packageCode);
    const item = await CatalogPackage.findOne({
        productCode: normalizedProductCode,
        packageCode: normalizedPackageCode
    });

    if (!item) {
        throw new CatalogAdminError("CATALOG_PACKAGE_NOT_FOUND", "Package not found.", 404);
    }

    assertFresh(item, expectedUpdatedAt);
    await assertAssetCategory(assetId, "package_icon");

    if (item.iconAssetId === assetId) {
        return { changed: false, package: item.toObject() };
    }

    item.iconAssetId = assetId;
    await item.save();

    console.log("Catalog presentation updated:", {
        action: "catalog.package.icon.attach",
        productCode: normalizedProductCode,
        packageCode: normalizedPackageCode,
        assetId,
        actor,
        timestamp: new Date().toISOString()
    });

    return { changed: true, package: item.toObject() };
}

async function clearPackageIconAsset({
    productCode,
    packageCode,
    expectedUpdatedAt,
    actor = "admin"
} = {}) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const normalizedPackageCode = normalizePackageCode(packageCode);
    const item = await CatalogPackage.findOne({
        productCode: normalizedProductCode,
        packageCode: normalizedPackageCode
    });

    if (!item) {
        throw new CatalogAdminError("CATALOG_PACKAGE_NOT_FOUND", "Package not found.", 404);
    }

    assertFresh(item, expectedUpdatedAt);

    if (!item.iconAssetId) {
        return { changed: false, package: item.toObject() };
    }

    item.iconAssetId = "";
    await item.save();

    console.log("Catalog presentation updated:", {
        action: "catalog.package.icon.clear",
        productCode: normalizedProductCode,
        packageCode: normalizedPackageCode,
        actor,
        timestamp: new Date().toISOString()
    });

    return { changed: true, package: item.toObject() };
}

module.exports = {
    clearPackageIconAsset,
    clearProductPresentationAsset,
    setPackageIconAsset,
    setProductPresentationAsset
};
