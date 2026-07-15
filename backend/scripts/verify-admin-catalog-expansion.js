const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(source, fragment, message) {
    assert.ok(source.includes(fragment), message || `Missing ${fragment}`);
}

const catalogAdminService = read("backend/services/catalogAdminService.js");
const gameBannerService = read("backend/services/gameBannerService.js");
const gameBannerModel = read("backend/models/GameBanner.js");
const mediaService = read("backend/services/mediaService.js");
const routes = read("backend/routes/catalog.js");
const adminCatalog = read("frontend/js/admin-catalog.js");
const gamePresentation = read("frontend/js/game-presentation-runtime.js");
const gameCss = read("frontend/css/game/game.css");
const adminCss = read("frontend/css/admin/admin-design-system.css");
const en = read("frontend/lang/admin/en.js");
const my = read("frontend/lang/admin/my.js");
const prices = read("frontend/js/prices.js");

[
    "mlbb.html",
    "pubg.html",
    "freefire.html",
    "hok.html",
    "aov-id.html",
    "pubg-rp.html",
    "telegram.html",
    "genshin.html",
    "roblox.html"
].forEach(file => {
    includes(read(`frontend/${file}`), "game-presentation-runtime.js", `${file} must load shared banner runtime`);
});

includes(catalogAdminService, "async function createPackage", "Package create service must exist");
includes(catalogAdminService, "CatalogProduct.findOne", "Package creation must require existing product");
includes(catalogAdminService, "PACKAGE_ALREADY_EXISTS", "Duplicate package identity must be rejected");
includes(catalogAdminService, "normalizePackageCode", "Package code must use canonical normalization");
includes(catalogAdminService, "normalizePackageName", "Package name validation must exist");
includes(catalogAdminService, "parseSortOrder", "Sort order validation must exist");
includes(catalogAdminService, "REGION_CURRENCIES[region]", "Region currency semantics must be backend-owned");
includes(catalogAdminService, "parsePrice", "Package create must reuse catalog price validation");
includes(catalogAdminService, "assertAssetCategory(iconAssetId, \"package_icon\")", "Package icon category must be backend validated");
includes(routes, "router.post(\"/admin/catalog/products/:productCode/packages\"", "Admin package create API must exist");
assert.ok(!/prices\.js.*createPackage/i.test(adminCatalog), "Admin package creation must not use prices.js as truth");
assert.ok(prices.includes("AZIEL_CATALOG"), "Customer packages must remain catalog-runtime backed");

includes(gameBannerModel, "productCode", "GameBanner product ownership field missing");
includes(gameBannerModel, "mediaAssetId", "GameBanner media reference missing");
includes(gameBannerService, "assertProduct(productCode)", "Banner product must exist");
includes(gameBannerService, "assertAssetCategory(payload.mediaAssetId, \"product_banner\")", "Banner image category must be product_banner");
includes(gameBannerService, "parseSchedule", "Banner schedule validation missing");
includes(gameBannerService, "javascript|data|vbscript", "Dangerous CTA schemes must be rejected");
includes(gameBannerService, "async function createBanner", "Banner create service missing");
includes(gameBannerService, "isEligibleBanner", "Active banner resolver missing");
includes(gameBannerService, "enabled !== true", "Disabled banners must be excluded");
includes(gameBannerService, "nowMs < start", "Future startsAt banners must be excluded");
includes(gameBannerService, "nowMs >= end", "Expired endsAt banners must be excluded");
includes(gameBannerService, ".sort({ sortOrder: 1, _id: 1 })", "Banner ordering must be deterministic");
includes(gameBannerService, "async function reorderBanners", "Banner reorder service missing");
includes(gameBannerService, "unique.size !== ids.length", "Duplicate reorder IDs must be rejected");
includes(gameBannerService, "banners.length !== ids.length", "Foreign banner reorder IDs must be rejected");
includes(gameBannerService, "deleteOne", "Remove must delete banner record");
assert.ok(!/deleteFile/.test(gameBannerService), "Removing banner must not delete MediaAsset");
includes(mediaService, "GameBanner.countDocuments", "Media safe-delete must count GameBanner references");

includes(routes, "router.get(\"/catalog/:productCode/banners\"", "Public banner API missing");
includes(routes, "router.get(\"/admin/catalog/products/:productCode/banners\"", "Admin banner list API missing");
includes(routes, "router.post(\"/admin/catalog/products/:productCode/banners\"", "Admin banner create API missing");
includes(routes, "router.patch(\"/admin/catalog/products/:productCode/banners/:bannerId\"", "Admin banner edit API missing");
includes(routes, "router.put(\"/admin/catalog/products/:productCode/banners/order\"", "Admin banner reorder API missing");
includes(routes, "router.delete(\"/admin/catalog/products/:productCode/banners/:bannerId\"", "Admin banner remove API missing");

includes(gamePresentation, "window.AZIEL_GAME_PRESENTATION", "Shared customer banner runtime missing");
includes(gamePresentation, "if (!data.managed) return", "Never-managed products must allow static fallback");
includes(gamePresentation, "game-banner-managed-empty", "Managed product with zero eligible banners must not resurrect static banners");
includes(gamePresentation, "fetch(`/api/catalog/${encodeURIComponent(productCode)}/banners`", "Shared runtime must use public banner API");
includes(gamePresentation, "javascript|data|vbscript", "Runtime CTA safety must exist");
includes(gameCss, ".game-banner-slide", "Customer banner slider CSS missing");
includes(gameCss, ".game-banner-dot", "Customer banner dots CSS missing");

includes(adminCatalog, "openPackageCreatePanel", "Admin Add Package UI missing");
includes(adminCatalog, "openBannerEditor", "Admin banner editor UI missing");
includes(adminCatalog, "moveBanner", "Mobile-safe banner reorder controls missing");
includes(adminCatalog, "AZIEL_ADMIN_MEDIA_SELECTOR?.open?.({ category: \"product_banner\" })", "Banner selector must use Media Library selector");
includes(adminCatalog, "AZIEL_ADMIN_MEDIA_SELECTOR?.open?.({ category: \"package_icon\" })", "Package icon selector must use Media Library selector");
includes(adminCss, "@media (max-width: 768px)", "Mobile breakpoint must remain centralized");
includes(adminCss, ".catalog-banner-row", "Banner rows/cards styling missing");

[
    "add_package",
    "package_code",
    "package_name",
    "mm_available",
    "th_available",
    "mmk_price",
    "thb_price",
    "sort_order",
    "select_package_icon",
    "add_banner",
    "banners",
    "banner_name",
    "banner_image",
    "select_banner_image",
    "cta_label",
    "cta_target",
    "start_date",
    "end_date",
    "enable",
    "disable",
    "remove",
    "move_up",
    "move_down"
].forEach(key => {
    includes(en, `${key}:`, `English dictionary missing ${key}`);
    includes(my, `${key}:`, `Myanmar dictionary missing ${key}`);
});

assert.ok(!/Campaign Manager|ENTRY_POPUP|promo code|supplier automation/i.test(adminCatalog + routes), "Phase 8.5 must not implement excluded scope");

console.log("Admin catalog expansion verification checks passed.");
