const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const NON_CANONICAL_CODES = Object.freeze([
    "aovid", "genshin", "valorant", "roblox", "steam-wallet", "google-play", "apple-gift-card", "discord-nitro"
]);

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertIncludes(source, needle, message) {
    assert(source.includes(needle), message || `Missing ${needle}`);
}

function assertNotIncludes(source, needle, message) {
    assert(!source.includes(needle), message || `Unexpected ${needle}`);
}

function functionSnippet(source, name) {
    const start = source.indexOf(`function ${name}`);
    assert(start >= 0, `${name} missing.`);
    const next = source.indexOf("\n    function ", start + 1);
    return source.slice(start, next > start ? next : undefined);
}

async function run() {
    const presentation = read("frontend/js/catalog-presentation.js");
    const home = read("frontend/home.html");
    const homeRuntime = read("frontend/js/home-placement-runtime.js");
    const css = read("frontend/css/home/marketplace-reference.css");
    const homeProductCss = read("frontend/css/home/home-product-system.css");
    const gamesCss = read("frontend/css/catalog/games.css");
    const supportHtml = read("frontend/support.html");
    const mobileGamesHtml = read("frontend/mobile-games.html");
    const footerRuntime = read("frontend/js/home-footer-accordion.js");

    assertNotIncludes(presentation, "CANONICAL_HOME_PRODUCT_GROUPS", "Presentation metadata must not own Home membership.");
    assertNotIncludes(presentation, "getCanonicalHomeProductCodes", "Presentation must not expose code-based Home membership.");

    assertIncludes(home, 'id="allMobileGames"', "Home must retain All Mobile Games section.");
    assertIncludes(home, 'id="socialTopUp"', "Home must render Social Top Up section.");
    assertNotIncludes(home, "coming-soon.html?product=marvel-rivals", "Static Marvel Rivals card must not route to fallback.");
    assertNotIncludes(home, "coming-soon.html?product=blood-strike", "Static Blood Strike card must not route to fallback.");

    assertIncludes(homeRuntime, "selectPopularProducts", "Popular cards must use projected Admin placement.");
    assertIncludes(homeRuntime, "selectAllMobileProducts", "All Mobile Games must use public category and Home eligibility.");
    assertIncludes(homeRuntime, "selectSocialProducts", "Social Top Up must use public category and Home eligibility.");
    assertNotIncludes(homeRuntime, "canonicalHomeCodes", "Home runtime must not use code allowlists.");
    assertNotIncludes(homeRuntime, "FEATURED_GAME_ORDER", "Home runtime must not own duplicate Popular product list.");
    assertNotIncludes(homeRuntime, "ALL_MOBILE_GAME_ORDER", "Home runtime must not own duplicate All Mobile product list.");
    assertIncludes(homeRuntime, "resolveProductRoute", "Home cards must consume the backend-projected route with a generic defensive fallback.");
    assertIncludes(homeRuntime, "renderSocialTopUp", "Social Top Up renderer missing.");
    assertIncludes(homeRuntime, "data-panel-size=\"${chunk.length}\"", "Home runtime must expose chunk sizes for panel verification.");
    assertNotIncludes(homeRuntime, "selected.slice(0", "Mobile Home rails must not artificially truncate renderable products.");
    assertIncludes(homeProductCss, "overflow-x: auto;", "Mobile Home product discovery must use native horizontal rails.");
    assertIncludes(homeProductCss, "scroll-snap-type: x proximity;", "Mobile Home rails may use restrained individual-card snapping.");
    assertIncludes(homeProductCss, "flex: 0 0 clamp(138px, 42vw, 156px);", "Mobile Home rail cards must show roughly two cards plus a partial peek.");
    assertIncludes(homeProductCss, "display: none;", "Mobile Home compact rail cards must remove description text.");
    assertIncludes(homeProductCss, "display: contents;", "Mobile Home must avoid a large enclosing product-panel card.");
    const popularSelection = functionSnippet(homeRuntime, "selectPopularProducts");
    assertIncludes(popularSelection, "product?.enabled !== false", "Popular placement must reject disabled products.");
    assertIncludes(popularSelection, "product.discoverable === true", "Popular placement must require computed discoverability.");
    assertIncludes(popularSelection, 'product.publicCategory === "mobile"', "Popular placement must remain Mobile-only.");

    const allCard = functionSnippet(homeRuntime, "renderAllMobileGame");
    const popularCard = functionSnippet(homeRuntime, "renderPopularGame");
    const socialCard = functionSnippet(homeRuntime, "renderSocialTopUpProduct");
    [allCard, popularCard, socialCard].forEach(snippet => {
        assertNotIncludes(snippet, "packageCode", "Home cards must not render package identities.");
        assertNotIncludes(snippet, "priceMarkup", "Home cards must not render package/pricing details.");
        assertNotIncludes(snippet, "authoritativePrice", "Home cards must not render package/pricing details.");
        assertNotIncludes(snippet, "coming-soon.html", "Canonical Home card renderers must not route to generic fallback.");
    });

    NON_CANONICAL_CODES.forEach(code => assertNotIncludes(homeRuntime, `"${code}"`, `${code} must not be a Home membership rule.`));

    assertIncludes(css, ".az-home #allMobileGames .home-mobile-game-tile img", "All Mobile Games artwork selector missing.");
    assertIncludes(css, "object-fit: cover !important;", "Artwork must use full-card cover treatment.");
    assertIncludes(css, ".az-home #popularGames .popular-game-card", "Popular card rules must remain present.");
    assertIncludes(css, "height: 204px !important;", "Popular cards must remain the larger featured surface on desktop.");
    assertIncludes(homeProductCss, "grid-template-columns: repeat(auto-fill, minmax(170px, 180px));", "Desktop Home grid must use stable card columns instead of product-count-specific rows.");
    assertIncludes(css, "grid-template-columns: repeat(auto-fill, minmax(170px, 180px)) !important;", "Legacy Home grid path must not force a 7+2 desktop composition.");
    assertNotIncludes(css, "repeat(7, minmax(0, 1fr))", "Home grid must not force seven columns.");
    assertIncludes(css, "height: 150px !important;", "Desktop All Mobile/Social cards must be compact.");
    assertIncludes(css, "grid-template-rows: minmax(0, 1fr) 42px", "Compact card must reserve dominant artwork area with smaller text body.");
    assertIncludes(css, "grid-template-columns: repeat(4, minmax(0, 1fr))", "Tablet compact catalog grid must increase density.");
    assertIncludes(css, "grid-template-columns: repeat(2, minmax(0, 1fr))", "Mobile grid must remain two-column.");
    assertIncludes(css, "height: 148px !important;", "Mobile compact cards must remain comfortable without becoming oversized image tiles.");
    assertIncludes(css, "@media (max-width: 480px)", "Narrow mobile compact polish must be scoped to <=480px.");
    const narrowMobileCssStart = css.indexOf("@media (max-width: 480px)");
    const narrowMobileCssEnd = css.indexOf("@media (prefers-reduced-motion", narrowMobileCssStart);
    const narrowMobileCss = css.slice(narrowMobileCssStart, narrowMobileCssEnd);
    assertNotIncludes(narrowMobileCss, "repeat(3", "375px compact catalog must never switch to three columns.");
    assertIncludes(css, "width: calc(100% - 32px) !important;", "Narrow mobile catalog sections must use 16px side gutters.");
    assertIncludes(css, "gap: 10px !important;", "Narrow mobile compact catalog grid must use balanced compact gutters.");
    assertIncludes(css, "height: 148px !important;", "Narrow mobile compact cards must keep consistent geometry.");
    assertIncludes(css, "grid-template-rows: 96px 52px", "Narrow mobile compact cards must use 96px media and 52px body rows.");
    assertIncludes(css, "height: 96px !important;", "Narrow mobile compact artwork must target a readable media height.");
    assertIncludes(css, ".az-home #availableCoupons[hidden]", "Empty Available Coupons section must stay fully hidden.");
    assertIncludes(css, ".az-home #newsPromotions[hidden]", "Empty Exclusive Offers section must stay fully hidden.");
    assertIncludes(css, "#socialTopUpList", "Social Top Up grid must share the same narrow mobile alignment rules.");
    assertIncludes(css, "#socialTopUp", "Social Top Up must share product discovery card treatment.");
    assertIncludes(css, "background: var(--page-bg, var(--bg)) !important;", "Home footer must use the storefront page-background authority.");
    assertNotIncludes(css, "body.theme-light .az-home + .site-footer {\n    background: var(--surface)", "Light Home footer must not become an isolated white surface.");
    assertIncludes(css, ".az-home + .site-footer .payment-logos img", "Home payment chips must have a scoped theme-safe surface.");
    assertIncludes(css, "background: var(--surface-strong) !important;", "Home payment chips must use a semantic theme surface.");
    assertIncludes(home, "marketplace-reference.css?v=20260907-storefront-polish", "Home must load the current shared Home stylesheet version.");
    assertIncludes(gamesCss, "grid-template-columns: repeat(auto-fill, minmax(158px, 176px));", "Mobile Games desktop catalog must use one coherent product-grid rhythm.");
    assertIncludes(gamesCss, "grid-template-columns: repeat(2, minmax(0, 1fr));", "Mobile Games mobile catalog must use compact two-column visual grids.");
    assertIncludes(gamesCss, ".az-poster-card p {\n        display: none;", "Mobile Games mobile cards must remove long descriptions.");
    assertIncludes(mobileGamesHtml, "/js/home-footer-accordion.js", "Mobile Games must use the shared mobile footer accordion runtime.");
    assertIncludes(supportHtml, "/js/home-footer-accordion.js", "Support must use the shared mobile footer accordion runtime.");
    assertIncludes(footerRuntime, 'document.querySelector(".site-footer, .support-footer")', "Shared footer accordion must support the Support footer variant.");
    assertIncludes(footerRuntime, "candidateRoots", "Shared footer accordion must support nested footer grids.");

    return {
        popularMobileGames: "Admin SitePlacement membership and order",
        allMobileGames: "eligible homepage-enabled publicCategory=mobile products",
        socialTopUp: "eligible homepage-enabled publicCategory=social products",
        visualTreatment: "artwork-first product discovery cards",
        mobile375Treatment: "individual-card horizontal rails, 16px gutters, partial next-card peek, no giant panels or truncation",
        canonicalRouting: true,
        packageLevelContent: false
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
