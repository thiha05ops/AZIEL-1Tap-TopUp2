const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function includes(file, pattern, message) {
    const content = read(file);
    assert(content.includes(pattern), `${file}: ${message}`);
}

function matches(file, pattern, message) {
    const content = read(file);
    assert(pattern.test(content), `${file}: ${message}`);
}

function verifyBackendOwnership() {
    includes("backend/models/SitePlacement.js", "mongoose.model(\"SitePlacement\"", "SitePlacement model must exist.");
    includes("backend/models/SitePlacement.js", "placementCode", "SitePlacement must key by placement code.");
    includes("backend/models/SitePlacement.js", "managed", "SitePlacement must preserve managed/fallback state.");
    includes("backend/models/SitePlacement.js", "HOME_POPULAR_GAMES", "Popular Games placement must be supported.");
    includes("backend/models/SitePlacement.js", "HOME_TOPUP_SHORTCUTS", "Top Up Shortcuts placement must be supported.");
    includes("backend/models/SitePlacement.js", "HOME_LATEST_PROMOTIONS", "Latest Promotions placement must be supported.");
    includes("backend/services/sitePlacementService.js", "require(\"../models/SitePlacement\")", "SitePlacement service must own placement records.");
    includes("backend/services/sitePlacementService.js", "require(\"../models/CatalogProduct\")", "SitePlacement service must validate Catalog product references.");
    includes("backend/services/sitePlacementService.js", "require(\"../models/PromoCode\")", "SitePlacement service must validate PromoCode references.");
    includes("backend/services/sitePlacementService.js", "toPublicCatalog", "SitePlacement public projection must reuse catalog projection.");
    includes("backend/services/sitePlacementService.js", "SITE_PLACEMENT_DUPLICATE_PRODUCT", "Product duplicates must be rejected.");
    includes("backend/services/sitePlacementService.js", "SITE_PLACEMENT_DUPLICATE_PROMO", "Promo duplicates must be rejected.");
}

function verifyRoutes() {
    const routes = read("backend/routes/sitePlacements.js");

    [
        "router.get(\"/site-placements/home\"",
        "router.get(\"/admin/site-placements\", adminMiddleware",
        "router.get(\"/admin/site-placements/:placementCode\", adminMiddleware",
        "router.put(\"/admin/site-placements/:placementCode\", adminMiddleware"
    ].forEach(pattern => {
        assert(routes.includes(pattern), `backend/routes/sitePlacements.js: missing ${pattern}`);
    });

    includes("backend/server.js", "const sitePlacementRoutes = require(\"./routes/sitePlacements\");", "Server must import SitePlacement routes.");
    includes("backend/server.js", "app.use(\"/api\", sitePlacementRoutes);", "Server must mount SitePlacement routes.");
}

function verifyPublicProjectionSafety() {
    const service = read("backend/services/sitePlacementService.js");

    assert(service.includes("doc?.managed") && service.includes("return projectPublicPlacement(placementCode, doc, []);"), "Service must preserve never-managed static fallback.");
    assert(service.includes("includeDisabled: false"), "Public product placements must exclude disabled catalog products.");
    assert(service.includes("isPromoEligibleForRegion"), "Public promo placements must use active region eligibility.");
    assert(service.includes("promo.regions.includes(region)"), "Public promo placements must filter by region.");
    assert(service.includes("!promo.archivedAt") && service.includes("promo.enabled === true"), "Public promo placements must exclude archived/disabled promos.");
    assert(!/usageLimit|perUserLimit|consumedCount|reservedCount/.test(service), "Public SitePlacement service must not expose promo usage counters.");
}

function verifyAdminUi() {
    includes("frontend/admin.html", "id=\"adminSitePlacementsList\"", "Admin Site Content must render SitePlacement list.");
    includes("frontend/admin.html", "/js/admin-site-placements.js", "Admin page must load SitePlacement controller.");
    includes("frontend/js/admin-site-placements.js", "/api/admin/site-placements", "Admin controller must use SitePlacement APIs.");
    includes("frontend/js/admin-site-placements.js", "activeSitePlacement.itemType", "Admin controller must respect backend item type.");
    includes("frontend/js/admin-site-placements.js", "managed: true", "Saving a placement must mark it managed.");
    includes("frontend/css/admin/admin-design-system.css", ".site-placement-row", "Admin CSS must style SitePlacement rows.");
    matches("frontend/css/admin/admin-design-system.css", /@media\s*\(max-width:\s*768px\)[\s\S]*\.site-placement-row/, "SitePlacement admin UI must include mobile rules.");
    includes("frontend/lang/admin/en.js", "home_placements", "English admin locale must include Home Placements.");
    includes("frontend/lang/admin/my.js", "home_placements", "Myanmar admin locale must include Home Placements.");
}

function verifyCustomerRuntime() {
    includes("frontend/home.html", "/js/home-placement-runtime.js", "Home page must load SitePlacement runtime.");
    includes("frontend/home.html", "id=\"popularGames\"", "Home Popular Games placement must have a stable target.");
    includes("frontend/home.html", "id=\"allMobileGamesList\"", "Catalog-owned All Mobile Games must have a stable target.");
    includes("frontend/home.html", "id=\"latestPromotionsPanel\"", "Home Latest Promotions panel must have a stable target.");
    includes("frontend/js/home-placement-runtime.js", "/api/site-placements/home", "Home runtime must call public SitePlacement API.");
    includes("frontend/js/home-placement-runtime.js", "if (!catalogReady && !placement)", "Home runtime must preserve static fallback when Catalog and placement data are unavailable.");
    includes("frontend/js/home-placement-runtime.js", "placement?.managed === true", "Managed placement intent must remain distinct from Catalog fallback.");
    includes("frontend/js/home-placement-runtime.js", "hideSection(section, target", "Home runtime must hide managed-empty sections.");
    includes("frontend/js/home-placement-runtime.js", "AZIEL_CATALOG_PRESENTATION", "Home runtime must reuse catalog presentation mapping.");
    includes("frontend/js/home-placement-runtime.js", "aziel:shopRegionChanged", "Home runtime must refetch on region changes.");
}

function verifyNoOwnershipBleed() {
    const model = read("backend/models/SitePlacement.js");
    const admin = read("frontend/js/admin-site-placements.js");
    const runtime = read("frontend/js/home-placement-runtime.js");

    ["amount", "price", "currency", "balance", "wallet"].forEach(term => {
        assert(!model.includes(term), `backend/models/SitePlacement.js: must not own ${term}.`);
    });

    ["HomeBanner", "ENTRY_POPUP", "PromoRedemption", "PromoUsageState", "Manual Payment", "Omise"].forEach(term => {
        assert(!admin.includes(term), `frontend/js/admin-site-placements.js: must not add ${term} controls.`);
        assert(!runtime.includes(term), `frontend/js/home-placement-runtime.js: must not add ${term} runtime.`);
    });
}

function main() {
    verifyBackendOwnership();
    verifyRoutes();
    verifyPublicProjectionSafety();
    verifyAdminUi();
    verifyCustomerRuntime();
    verifyNoOwnershipBleed();
    console.log("Admin Site Placements verification passed.");
}

main();
