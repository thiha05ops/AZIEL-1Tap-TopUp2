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
    includes("backend/models/HomeBanner.js", "mongoose.model(\"HomeBanner\"", "HomeBanner model must exist.");
    includes("backend/models/HomeBannerState.js", "mongoose.model(\"HomeBannerState\"", "HomeBanner managed-state model must exist.");
    includes("backend/services/homeBannerService.js", "require(\"../models/HomeBanner\")", "HomeBanner service must own HomeBanner data.");
    includes("backend/services/homeBannerService.js", "require(\"../models/HomeBannerState\")", "HomeBanner service must preserve managed-empty state.");
    includes("backend/services/homeBannerService.js", "assertAssetCategory(payload.mediaAssetId, \"home_banner\")", "HomeBanner media must require home_banner assets.");
    includes("backend/services/homeBannerService.js", "parseCtaTarget", "HomeBanner service must reuse shared CTA validation.");
    includes("backend/services/homeBannerService.js", "parseSchedule", "HomeBanner service must reuse shared schedule validation.");
    includes("backend/services/homeBannerService.js", "isEligibleBanner", "HomeBanner service must use shared active interval eligibility.");
    includes("backend/services/gameBannerService.js", "parseCtaTarget,", "GameBanner service must export shared CTA validation.");
    includes("backend/services/gameBannerService.js", "parseSchedule,", "GameBanner service must export shared schedule validation.");
}

function verifyRoutes() {
    const routes = read("backend/routes/homeBanners.js");

    [
        "router.get(\"/admin/home-banners\", adminMiddleware",
        "router.post(\"/admin/home-banners\", adminMiddleware",
        "router.patch(\"/admin/home-banners/:bannerId\", adminMiddleware",
        "router.delete(\"/admin/home-banners/:bannerId\", adminMiddleware",
        "router.put(\"/admin/home-banners/order\", adminMiddleware",
        "router.get(\"/home/banners\""
    ].forEach(pattern => {
        assert(routes.includes(pattern), `backend/routes/homeBanners.js: missing ${pattern}`);
    });

    includes("backend/server.js", "const homeBannerRoutes = require(\"./routes/homeBanners\");", "Server must import HomeBanner routes.");
    includes("backend/server.js", "app.use(\"/api\", homeBannerRoutes);", "Server must mount HomeBanner routes.");
}

function verifyMediaCategoryAndSafeDelete() {
    includes("backend/models/MediaAsset.js", "\"home_banner\"", "MediaAsset enum must include home_banner.");
    includes("backend/services/mediaService.js", "\"home_banner\"", "Media service category contract must include home_banner.");
    includes("backend/services/mediaService.js", "const HomeBanner = require(\"../models/HomeBanner\");", "Media safe-delete must import HomeBanner.");
    includes("backend/services/mediaService.js", "HomeBanner.countDocuments({ mediaAssetId: assetId })", "Media safe-delete must count HomeBanner references.");
    includes("backend/services/mediaService.js", "homeBanners,", "Media reference projection must expose homeBanners count.");
}

function verifyAdminUi() {
    includes("frontend/admin.html", "data-section=\"site-content\"", "Admin nav must expose Site Content.");
    includes("frontend/admin.html", "id=\"section-site-content\"", "Admin section must exist.");
    includes("frontend/admin.html", "id=\"adminHomeBannersList\"", "Admin Home Banners list must exist.");
    includes("frontend/admin.html", "value=\"home_banner\"", "Admin Media Library must expose home_banner category.");
    includes("frontend/admin.html", "/js/admin-home-banners.js", "Admin page must load HomeBanner controller.");
    includes("frontend/js/admin-app.js", "\"site-content\"", "Admin section titles must register site-content.");
    includes("frontend/js/admin-home-banners.js", "/api/admin/home-banners", "Admin controller must call HomeBanner APIs.");
    includes("frontend/js/admin-home-banners.js", "category: \"home_banner\"", "Admin media selector must filter home_banner assets.");
    includes("frontend/js/admin-media.js", "value=\"home_banner\"", "Media upload modal must allow home_banner.");
    includes("frontend/css/admin/admin-design-system.css", ".home-banner-row", "Admin CSS must style HomeBanner rows.");
    matches("frontend/css/admin/admin-design-system.css", /@media\s*\(max-width:\s*768px\)[\s\S]*\.home-banner-row/, "Admin HomeBanner rows must have mobile rules.");
}

function verifyCustomerRuntime() {
    includes("frontend/home.html", "/js/home-banner-runtime.js", "Home page must load managed HomeBanner runtime.");
    includes("frontend/js/home-banner-runtime.js", "/api/home/banners", "Home runtime must call public HomeBanner API.");
    includes("frontend/js/home-banner-runtime.js", "data.managed !== true", "Home runtime must preserve static fallback for never-managed state.");
    includes("frontend/js/home-banner-runtime.js", "renderDefaultFallback(zone, track, dotsBox, \"no-eligible-campaigns\")", "Home runtime must render the default hero for managed-empty state.");
    includes("frontend/js/home-banner-runtime.js", "az-banner-card", "Home runtime must preserve existing carousel card class.");
    includes("frontend/js/home-banner-runtime.js", "azBannerDots", "Home runtime must preserve existing dots container.");
}

function verifyNoFakeControls() {
    const adminHomeBanners = read("frontend/js/admin-home-banners.js");
    const homeService = read("backend/services/homeBannerService.js");

    ["ENTRY_POPUP", "Campaign Manager", "promoCode", "supplier"].forEach(term => {
        assert(!adminHomeBanners.includes(term), `frontend/js/admin-home-banners.js: must not add fake ${term} controls.`);
        assert(!homeService.includes(term), `backend/services/homeBannerService.js: must not add fake ${term} ownership.`);
    });
}

function main() {
    verifyBackendOwnership();
    verifyRoutes();
    verifyMediaCategoryAndSafeDelete();
    verifyAdminUi();
    verifyCustomerRuntime();
    verifyNoFakeControls();
    console.log("Admin Home Banners verification passed.");
}

main();
