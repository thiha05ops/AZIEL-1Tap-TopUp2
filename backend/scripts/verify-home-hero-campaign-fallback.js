const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { isEligibleBanner } = require("../services/gameBannerService");
const { run: verifyHomeDiscoveryCards } = require("./verify-home-product-discovery-cards");
const { run: verifyStorefrontSystemTheme } = require("./verify-storefront-system-theme");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(source, needle, message) {
    assert(source.includes(needle), message || `Missing ${needle}`);
}

function notIncludes(source, needle, message) {
    assert(!source.includes(needle), message || `Unexpected ${needle}`);
}

function verifyEligibilityRules() {
    const now = new Date("2026-08-07T12:00:00.000Z");
    const active = {
        enabled: true,
        startsAt: new Date("2026-08-01T00:00:00.000Z"),
        endsAt: new Date("2026-08-31T00:00:00.000Z")
    };
    const expired = {
        enabled: true,
        startsAt: new Date("2026-07-01T00:00:00.000Z"),
        endsAt: new Date("2026-08-01T00:00:00.000Z")
    };
    const disabled = {
        enabled: false,
        startsAt: null,
        endsAt: null
    };
    const future = {
        enabled: true,
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: null
    };

    assert.strictEqual(isEligibleBanner(active, now), true, "Active Home campaign must be eligible.");
    assert.strictEqual(isEligibleBanner(expired, now), false, "Expired Home campaign must not be eligible.");
    assert.strictEqual(isEligibleBanner(disabled, now), false, "Disabled Home campaign must not be eligible.");
    assert.strictEqual(isEligibleBanner(future, now), false, "Future Home campaign must not be eligible.");
}

function verifyRuntimeFallbacks() {
    const runtime = read("frontend/js/home-banner-runtime.js");
    const homeHtml = read("frontend/home.html");
    const service = read("backend/services/homeBannerService.js");
    const routes = read("backend/routes/homeBanners.js");

    includes(runtime, 'const API_URL = "/api/home/banners"', "Hero runtime must use the Home campaign/banner API.");
    includes(runtime, "DEFAULT_HOME_HERO", "Hero runtime must own an independent default hero config.");
    includes(runtime, "assets/banners/hero-desktop-wide.webp?v=20260829-p4", "Default optimized desktop hero asset missing.");
    includes(runtime, "assets/banners/hero-mobile.webp?v=20260829-p4", "Default optimized mobile hero asset missing.");
    includes(runtime, "renderDefaultFallback(zone, track, dotsBox, \"api-unmanaged\")", "Unmanaged/no campaign API response must use default fallback.");
    includes(runtime, "renderDefaultFallback(zone, track, dotsBox, \"no-eligible-campaigns\")", "No eligible campaigns must use default fallback.");
    includes(runtime, "renderDefaultFallback(zone, track, dotsBox, \"api-failure\")", "API failure must use default fallback.");
    includes(runtime, "defaultHeroMarkup", "Default fallback must rebuild the default slide after managed slides existed.");
    includes(runtime, "data-home-banner-source=\"default\"", "Default slide must be identifiable.");
    includes(runtime, "zone.dataset.heroAuthority = \"campaign\"", "Active campaign state must be identifiable.");
    includes(runtime, "zone.dataset.heroAuthority = \"default\"", "Default fallback state must be identifiable.");
    includes(runtime, "bindManagedImageFallbacks", "Malformed/broken campaign media must fall back safely.");
    includes(runtime, "image.addEventListener(\"error\"", "Campaign media error handling missing.");
    includes(runtime, "image.src = DEFAULT_HOME_HERO.mobileImageUrl", "Broken mobile campaign media must fall back to default asset.");
    includes(runtime, "source.srcset = DEFAULT_HOME_HERO.desktopImageUrl", "Broken desktop campaign media must fall back to default asset.");
    includes(runtime, "banners.length === 1", "Single campaign must preserve non-carousel behavior.");
    includes(runtime, "bindManagedCarousel", "Multiple campaigns must preserve carousel behavior.");
    includes(runtime, "dotsBox.hidden = true", "Single/default banner must hide dots.");

    includes(homeHtml, "assets/banners/hero-desktop-wide.webp?v=20260829-p4", "HTML default desktop hero must remain available before JS.");
    includes(homeHtml, "assets/banners/hero-mobile.webp?v=20260829-p4", "HTML default mobile hero must remain available before JS.");
    includes(homeHtml, "data-managed-content-state=\"fallback\"", "HTML must start with safe fallback state.");

    includes(service, "isEligibleBanner(item, now)", "Home campaign selection must respect enabled/date eligibility.");
    includes(service, ".sort({ sortOrder: 1, _id: 1 })", "Home campaign selection must preserve existing order/priority source.");
    includes(service, ".filter(Boolean)", "Malformed/missing campaign media must not render blank records.");
    includes(routes, "router.get(\"/home/banners\"", "Public Home hero campaign endpoint missing.");
    includes(routes, "Cache-Control", "Public Home hero campaign endpoint must avoid stale eligibility.");

    notIncludes(runtime, "productCode", "Home hero runtime must not couple to product routing/catalog cards.");
    notIncludes(runtime, "checkout", "Home hero runtime must not touch checkout.");
    notIncludes(runtime, "pricing", "Home hero runtime must not touch pricing.");
}

async function run() {
    verifyEligibilityRules();
    verifyRuntimeFallbacks();
    await verifyHomeDiscoveryCards();
    verifyStorefrontSystemTheme();

    return {
        heroAuthoritySource: "/api/home/banners",
        activeSelection: "enabled Home banners within start/end schedule, ordered by sortOrder then _id",
        defaultFallbackSource: "DEFAULT_HOME_HERO using existing AZIEL banner assets",
        failureFallbacks: [
            "no eligible campaign",
            "disabled campaign",
            "expired campaign",
            "API failure",
            "malformed/missing campaign media",
            "broken image load"
        ],
        previousStepCoverage: [
            "Step 4 Home discovery cards",
            "Step 5 storefront system theme"
        ]
    };
}

if (require.main === module) {
    run()
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => {
            console.error(error?.message || error);
            process.exitCode = 1;
        });
}

module.exports = { run };
