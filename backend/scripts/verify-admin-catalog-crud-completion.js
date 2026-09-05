const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function includes(file, pattern, message) {
    assert(read(file).includes(pattern), `${file}: ${message}`);
}

function matches(file, pattern, message) {
    assert(pattern.test(read(file)), `${file}: ${message}`);
}

function assertBackendCrud() {
    includes("backend/models/CatalogProduct.js", "description", "product description field missing");
    includes("backend/models/CatalogProduct.js", "featured", "product featured field missing");
    includes("backend/models/CatalogProduct.js", "seo", "product SEO field missing");
    includes("backend/models/CatalogProduct.js", "deletedAt", "product soft delete field missing");
    includes("backend/models/CatalogPackage.js", "deletedAt", "package soft delete field missing");
    includes("backend/models/GameBanner.js", "deletedAt", "banner soft delete field missing");

    includes("backend/services/catalogService.js", "if (!includeDisabled && product.deletedAt) return null;", "public product projection must hide deleted products");
    includes("backend/services/catalogService.js", "if (!includeDisabled && item.deletedAt) return null;", "public package projection must hide deleted packages");
    includes("backend/services/catalogService.js", "if (product.deletedAt)", "purchase resolver must reject deleted products");
    includes("backend/services/catalogService.js", "if (item.deletedAt)", "purchase resolver must reject deleted packages");

    includes("backend/services/catalogAdminService.js", "function buildProductPatch", "product patch builder missing");
    includes("backend/services/catalogAdminService.js", "\"name\"", "product/package name editing missing");
    includes("backend/services/catalogAdminService.js", "\"supportedRegions\"", "supported region editing missing");
    includes("backend/services/catalogAdminService.js", "\"seo\"", "SEO editing missing");
    includes("backend/services/catalogAdminService.js", "async function softDeleteProduct", "product soft delete service missing");
    includes("backend/services/catalogAdminService.js", "async function restoreProduct", "product restore service missing");
    includes("backend/services/catalogAdminService.js", "async function softDeletePackage", "package soft delete service missing");
    includes("backend/services/catalogAdminService.js", "async function restorePackage", "package restore service missing");
    includes("backend/services/catalogAdminService.js", "assertAssetCategory(updates.iconAssetId, \"package_icon\")", "package icon edits must validate media category");

    includes("backend/services/gameBannerService.js", "async function restoreBanner", "banner restore service missing");
    includes("backend/services/gameBannerService.js", "banner.deletedAt", "banner public eligibility must check deletedAt");
    assert(!read("backend/services/gameBannerService.js").includes("GameBanner.deleteOne"), "banner delete must not hard-delete records");
}

function assertRoutes() {
    const routes = read("backend/routes/catalog.js");
    [
        "softDeleteProduct",
        "restoreProduct",
        "softDeletePackage",
        "restorePackage",
        "restoreBanner"
    ].forEach(symbol => assert(routes.includes(symbol), `catalog routes missing ${symbol}`));

    [
        'router.patch("/admin/catalog/products/:productCode/delete"',
        'router.patch("/admin/catalog/products/:productCode/restore"',
        'router.patch("/admin/catalog/products/:productCode/packages/:packageCode/delete"',
        'router.patch("/admin/catalog/products/:productCode/packages/:packageCode/restore"',
        'router.patch("/admin/catalog/products/:productCode/banners/:bannerId/restore"'
    ].forEach(pattern => assert(routes.includes(pattern), `catalog route missing ${pattern}`));

    includes("backend/services/adminAuditService.js", "CATALOG_PRODUCT_REMOVED", "product removal audit action missing");
    includes("backend/services/adminAuditService.js", "CATALOG_PACKAGE_RESTORED", "package restore audit action missing");
    includes("backend/services/adminAuditService.js", "GAME_BANNER_RESTORED", "banner restore audit action missing");
}

function assertAdminFrontend() {
    const adminCatalog = read("frontend/js/admin-catalog.js");

    [
        "openProductEditor",
        "saveProductEditor",
        "softDeleteProductRecord",
        "restoreProductRecord",
        "softDeletePackageRecord",
        "restorePackageRecord",
        "restoreBannerRecord",
        "catalogPackageStatusFilter === \"deleted\"",
        "catalogHighlightedPackageCode",
        "formatSupplierMapping"
    ].forEach(symbol => assert(adminCatalog.includes(symbol), `admin catalog frontend missing ${symbol}`));

    [
        "catalogProductName",
        "catalogProductDescription",
        "data-product-compatibility-market",
        "Product / account compatibility",
        "catalogProductFeatured",
        "catalogProductSeoTitle",
        "catalogProductSeoDescription",
        "catalogProductImageChange",
        "catalogProductPreviewChange",
        "catalogEditPackageName",
        "catalogEditMMEnabled",
        "catalogEditTHEnabled",
        "catalogEditIcon",
        "catalogEditSupplierMapping"
    ].forEach(id => assert(adminCatalog.includes(id), `admin catalog editor missing #${id}`));

    assert(!adminCatalog.includes("data-catalog-tab-jump=\"overview\""), "Edit Product must open the product editor, not jump to overview.");
    includes("frontend/css/admin/admin-design-system.css", ".catalog-package-row.is-deleted", "deleted package state CSS missing");
    includes("frontend/css/admin/admin-design-system.css", ".catalog-package-row.is-highlighted", "package highlight CSS missing");
    includes("frontend/css/admin/admin-design-system.css", ".catalog-edit-fieldset", "catalog editor fieldset CSS missing");
    matches("frontend/js/admin-catalog.js", /data-restore-package=[\s\S]*data-delete-package/, "package table must expose restore/delete controls");
}

function main() {
    assertBackendCrud();
    assertRoutes();
    assertAdminFrontend();
    console.log("Admin catalog CRUD completion verification passed.");
}

main();
