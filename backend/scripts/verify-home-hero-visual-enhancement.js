const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function matches(file, pattern, message) {
    assert(pattern.test(read(file)), `${file}: ${message}`);
}

function notMatches(file, pattern, message) {
    assert(!pattern.test(read(file)), `${file}: ${message}`);
}

function verifyRuntimeCarouselEnhancement() {
    const runtime = read("frontend/js/home-banner-runtime.js");

    [
        "const AUTO_DELAY = 5600",
        "const DESKTOP_CAROUSEL_QUERY = \"(min-width: 1024px)\"",
        "const colorCache = new Map()",
        "ensureHeroArrows(zone)",
        "function ensureHeroArrows(zone)",
        "function bindHeroArrows(zone, goTo)",
        "az-banner-arrow az-banner-arrow--previous",
        "az-banner-arrow az-banner-arrow--next",
        "Show previous banner",
        "Show next banner",
        "setArrowVisibility(track.closest(\".az-banner-zone\"), true)",
        "window.matchMedia?.(DESKTOP_CAROUSEL_QUERY)?.matches === true",
        "getShortestOffset(index)",
        "card.classList.toggle(\"is-side\", isSide)",
        "card.classList.remove(\"is-side\", \"is-previous\", \"is-next\")",
        "scale(${isSide ? \".96\" : \"1\"})",
        "brightness(.58) saturate(.58)",
        "opacity = Math.abs(offset) > 1 ? \"0\" : (isSide ? \".68\" : \"1\")",
        "card.classList.toggle(\"is-previous\", isSide && offset < 0)",
        "card.classList.toggle(\"is-next\", isSide && offset > 0)",
        "if (card.matches(\"a\")) card.tabIndex = isActive ? 0 : -1",
        "track.addEventListener(\"mouseenter\", pauseAuto)",
        "track.addEventListener(\"mouseleave\", () => scheduleAuto(goTo))",
        "renderCards(dragCurrentX)",
        "FLICK_VELOCITY_THRESHOLD",
        "dragVelocity = (event.clientX - dragLastX) / elapsed",
        "track.classList.add(\"is-dragging\")",
        "track.classList.remove(\"is-dragging\")"
    ].forEach(snippet => assert(runtime.includes(snippet), `Managed hero runtime missing ${snippet}`));

    matches(
        "frontend/js/home-banner-runtime.js",
        /const goTo = index =>[\s\S]*?setArrowVisibility\(track\.closest\("\.az-banner-zone"\), true\);[\s\S]*?bindHeroArrows\(track\.closest\("\.az-banner-zone"\), goTo\);/,
        "Arrow binding must happen after goTo is initialized."
    );
    notMatches(
        "frontend/js/home-banner-runtime.js",
        /bindHeroArrows\(track\.closest\("\.az-banner-zone"\), goTo\);[\s\S]{0,120}const goTo = index =>/,
        "Arrow binding must not reference goTo before initialization."
    );
}

function verifyHeroAtmosphereSampling() {
    [
        "function updateHeroAtmosphere(zone, image, options = {})",
        "function resolveHeroColors(image, source)",
        "function sampleHeroImageColors(image)",
        "const width = 24",
        "const height = 12",
        "document.createElement(\"canvas\")",
        "getImageData(0, 0, width, height)",
        "colorCache.has(source)",
        "colorCache.set(source, colors)",
        "--home-hero-rgb-primary",
        "--home-hero-rgb-secondary",
        "--home-hero-atmosphere-opacity",
        "aziel:homeHeroAtmosphereChanged",
        "FALLBACK_HERO_COLORS",
        "applyFallbackHeroAtmosphere(home, source)"
    ].forEach(snippet => includes("frontend/js/home-banner-runtime.js", snippet, `Hero atmosphere runtime missing ${snippet}`));
}

function verifyFallbackAuthorityPreserved() {
    [
        "renderDefaultFallback(zone, track, dotsBox, \"api-unmanaged\")",
        "renderDefaultFallback(zone, track, dotsBox, \"no-eligible-campaigns\")",
        "renderDefaultFallback(zone, track, dotsBox, \"api-failure\")",
        "zone.dataset.heroAuthority = \"default\"",
        "zone.dataset.heroAuthority = \"campaign\"",
        "zone.dataset.bannerCount = \"1\"",
        "zone.dataset.bannerCount = String(banners.length)",
        "DEFAULT_HOME_HERO.desktopImageUrl",
        "DEFAULT_HOME_HERO.mobileImageUrl",
        "bindStaticBanner(activeTrack, activeDotsBox)"
    ].forEach(snippet => includes("frontend/js/home-banner-runtime.js", snippet, `Step 6 fallback authority missing ${snippet}`));
}

function verifyCssDesktopOnlyVisuals() {
    const css = read("frontend/css/home/marketplace-reference.css");

    [
        "--home-hero-rgb-primary: 139 92 246",
        "--home-hero-rgb-secondary: 59 130 246",
        "--home-hero-atmosphere-opacity",
        "rgb(var(--home-hero-rgb-primary) /",
        "rgb(var(--home-hero-rgb-secondary) /",
        ".az-home::before",
        "transition: background 820ms ease-out, opacity 820ms ease-out",
        "@media (min-width: 1024px)",
        "[data-home-banners-managed=\"active\"]:not([data-banner-count=\"1\"])",
        "height: clamp(250px, 24vw, 390px) !important",
        "width: 66% !important",
        "width: 14% !important",
        ".az-banner-card.is-side",
        "opacity: .68 !important",
        "display: inline-grid !important",
        "cursor: grabbing",
        "@media (max-width: 768px)"
    ].forEach(snippet => assert(css.includes(snippet), `Home enhancement CSS missing ${snippet}`));

    matches(
        "frontend/css/home/marketplace-reference.css",
        /@media \(max-width: 768px\)[\s\S]*?\.az-home \.az-home-hero\.az-banner-zone[\s\S]*?aspect-ratio:\s*16 \/ 9 !important;/,
        "Mobile hero must retain the approved 16:9 behavior."
    );
    matches(
        "frontend/css/home/marketplace-reference.css",
        /\.az-home-hero \.az-banner-arrow\s*\{[\s\S]*?display:\s*none !important;[\s\S]*?\}/,
        "Hero arrows must remain hidden by default outside desktop multi-banner mode."
    );
}

function verifyProductSectionsUntouchedByEnhancement() {
    const css = read("frontend/css/home/marketplace-reference.css");

    [
        ".az-home #popularGames .popular-game-card",
        "grid-template-columns: repeat(7, minmax(0, 1fr)) !important;",
        "@media (max-width: 480px)",
        "grid-template-rows: 88px 44px !important;",
        ".az-home #socialTopUp .home-merch-row"
    ].forEach(snippet => assert(css.includes(snippet), `Existing product discovery styling missing ${snippet}`));

    notMatches(
        "frontend/js/home-banner-runtime.js",
        /popularGames|allMobileGames|socialTopUp|canonicalProduct|productRoute/i,
        "Hero runtime must not own product discovery, catalog, or route behavior."
    );
}

function main() {
    verifyRuntimeCarouselEnhancement();
    verifyHeroAtmosphereSampling();
    verifyFallbackAuthorityPreserved();
    verifyCssDesktopOnlyVisuals();
    verifyProductSectionsUntouchedByEnhancement();
    console.log("Home hero visual enhancement verification passed.");
}

if (require.main === module) {
    main();
}

module.exports = { run: main };
