const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function assertOrder(source, before, after, message) {
    const left = source.indexOf(before);
    const right = source.indexOf(after);
    assert(left >= 0, `${message}: missing ${before}`);
    assert(right >= 0, `${message}: missing ${after}`);
    assert(left < right, message);
}

function assertBackend() {
    const model = read("backend/models/StorefrontSection.js");
    const service = read("backend/services/storefrontSectionService.js");
    const catalogRoutes = read("backend/routes/catalog.js");
    const catalogAdminService = read("backend/services/catalogAdminService.js");
    const packageModel = read("backend/models/CatalogPackage.js");
    const bannerModel = read("backend/models/GameBanner.js");

    ["key", "displayName", "icon", "path", "status", "showInGamesMenu", "sortOrder", "isSystem"].forEach(field => {
        assert(model.includes(field), `StorefrontSection model must include ${field}`);
    });
    assert(service.includes("$setOnInsert"), "storefront section seed must be idempotent and not overwrite edits");
    assert(service.includes("PUBLISHED") && service.includes("COMING_SOON") && service.includes("HIDDEN"), "section statuses must be explicit");
    assert(service.includes("SYSTEM_SECTIONS"), "system section definitions must be canonical");
    assert(service.includes("Mobile Games") && service.includes("PC Games") && service.includes("Gift Cards") && service.includes("Social Top Up") && service.includes("Coming Soon"), "default sections must exist");

    assert(packageModel.includes("sortOrder"), "CatalogPackage must keep server-authoritative sortOrder");
    assert(bannerModel.includes("sortOrder"), "GameBanner must keep server-authoritative sortOrder");
    assert(catalogAdminService.includes("async function reorderPackages"), "catalog admin service must expose package reorder");
    assert(catalogAdminService.includes("orderedPackageCodes"), "package reorder must use explicit ordered package codes");
    assert(catalogAdminService.includes("Package order must include every package"), "package reorder must require a full product-scoped list");

    assert(catalogRoutes.includes('router.get("/public/storefront-sections"'), "public storefront sections endpoint missing");
    assert(catalogRoutes.includes('router.get("/public/storefront-sections/:key"'), "public storefront section endpoint missing");
    assert(catalogRoutes.includes('router.get("/admin/catalog/storefront-sections", adminMiddleware'), "admin storefront read endpoint must be protected");
    assert(catalogRoutes.includes('router.patch("/admin/catalog/storefront-sections/reorder", adminMiddleware'), "admin storefront reorder endpoint must be protected");
    assert(catalogRoutes.includes('router.patch("/admin/catalog/storefront-sections/:key", adminMiddleware'), "admin storefront update endpoint must be protected");
    assert(catalogRoutes.includes('router.patch("/admin/catalog/products/:productCode/packages/reorder", adminMiddleware'), "package reorder endpoint must be protected");
    assertOrder(
        catalogRoutes,
        'router.patch("/admin/catalog/products/:productCode/packages/reorder"',
        'router.patch("/admin/catalog/products/:productCode/packages/:packageCode"',
        "package reorder route must precede packageCode route"
    );
    assertOrder(
        catalogRoutes,
        'router.patch("/admin/catalog/storefront-sections/reorder"',
        'router.patch("/admin/catalog/storefront-sections/:key"',
        "storefront reorder route must precede key route"
    );
}

function assertAdminFrontend() {
    const adminHtml = read("frontend/admin.html");
    const adminCatalog = read("frontend/js/admin-catalog.js");
    const adminCss = read("frontend/css/admin/admin-design-system.css");

    assert(adminHtml.includes('data-catalog-view="products"'), "admin catalog must expose Products top-level view");
    assert(adminHtml.includes('data-catalog-view="storefront"'), "admin catalog must expose Storefront Sections top-level view");
    assert(adminHtml.includes("adminStorefrontSections"), "admin storefront section mount missing");
    assert(adminCatalog.includes("activeCatalogTab"), "product workspace tab state missing");
    assert(adminCatalog.includes("renderCatalogTabPanel"), "product workspace tab renderer missing");
    assert(adminCatalog.includes("bindPackageDrag"), "package drag handler missing");
    assert(adminCatalog.includes("persistPackageOrder"), "package order persistence missing");
    assert(adminCatalog.includes("/packages/reorder"), "frontend must call package reorder endpoint");
    assert(adminCatalog.includes("loadStorefrontSections"), "admin storefront section loader missing");
    assert(adminCatalog.includes("persistStorefrontSectionOrder"), "storefront order persistence missing");
    assert(adminCatalog.includes("/storefront-sections/reorder"), "frontend must call storefront reorder endpoint");
    assert(adminCss.includes(".catalog-workspace-tabs"), "workspace tab CSS missing");
    assert(adminCss.includes(".catalog-storefront-row"), "storefront row CSS missing");
    assert(adminCss.includes(".catalog-drag-handle"), "drag handle CSS missing");
}

function assertPublicFrontend() {
    const header = read("frontend/js/header.js");
    const runtime = read("frontend/js/storefront-sections.js");
    const gamesCss = read("frontend/css/catalog/games.css");

    assert(header.includes("/api/public/storefront-sections"), "header must fetch public storefront section configuration");
    assert(header.includes("renderGamesDropdownItems"), "header must render dropdown from section data");
    assert(!header.includes("<span>PC Games</span>\\n                </a>\\n\\n                <a href=\"gift-cards.html\""), "header must not rely on only the old hardcoded dropdown");
    assert(runtime.includes("applyPageAccess"), "category access controller missing");
    assert(runtime.includes("COMING_SOON") && runtime.includes("HIDDEN"), "category access states missing");
    assert(gamesCss.includes(".az-section-state"), "public coming soon/unavailable state CSS missing");

    [
        ["frontend/mobile-games.html", "mobile-games"],
        ["frontend/pc-games.html", "pc-games"],
        ["frontend/gift-cards.html", "gift-cards"],
        ["frontend/social-topup.html", "social-topup"],
        ["frontend/coming-soon.html", "coming-soon"]
    ].forEach(([file, key]) => {
        const source = read(file);
        assert(source.includes("/js/storefront-sections.js"), `${file} must load storefront section runtime`);
        assert(source.includes(`applyPageAccess?.("${key}")`), `${file} must apply section access for ${key}`);
    });
}

function main() {
    assertBackend();
    assertAdminFrontend();
    assertPublicFrontend();
    console.log("Catalog workspace and storefront section verification passed.");
}

main();
