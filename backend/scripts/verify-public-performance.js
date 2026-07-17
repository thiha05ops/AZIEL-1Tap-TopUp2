const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function main() {
    const home = read("frontend/home.html");
    const header = read("frontend/js/header.js");
    const homeBanner = read("frontend/js/home-banner-runtime.js");
    const gameRuntime = read("frontend/js/game-presentation-runtime.js");
    const search = read("frontend/js/search.js");
    const headerCss = read("frontend/css/theme/aziel-header.css");
    const homeCss = read("frontend/css/home/aziel-home.css");

    assert(homeBanner.includes("banners.slice(0, 2).map"), "Home managed banners must preload only current and next hero.");
    assert(gameRuntime.includes("banners.slice(0, 2).map"), "Game managed banners must preload only current and next hero.");
    assert(homeBanner.includes('const loading = index < 2 ? "eager" : "lazy"'), "Home late banner images must lazy-load.");
    assert(gameRuntime.includes('const loading = index < 2 ? "eager" : "lazy"'), "Game late banner images must lazy-load.");
    assert(home.includes('fetchpriority="high"') && home.includes('width="860" height="300"'), "Static home hero must reserve dimensions and prioritize the first slide.");
    assert(header.includes('window.addEventListener("scroll"') && header.includes("{ passive: true }"), "Header scroll listener must be passive.");
    assert(header.includes("window.__azielCanonicalHeaderScrollReady"), "Header must guard duplicate scroll listener initialization.");
    assert(homeBanner.includes("ensureHomeAmbientBuffers") && homeBanner.includes("i < 2"), "Home ambient buffers must be capped at two.");
    assert(search.includes("DEBOUNCE_MS = 160"), "Search must keep debounced result rendering.");
    assert(search.includes('cache: "no-store"'), "Private/dynamic promotion search calls must avoid stale private cache.");
    assert(headerCss.includes("body.az-search-open") && headerCss.includes("overflow: hidden"), "Search overlay must own body scroll lock.");
    assert(homeCss.includes(".az-home-ambient-buffer"), "Home ambient buffer ownership must remain explicit.");
    assert(!/createElement\\(\"canvas\"\\)/.test(homeBanner), "Hero ambience must not use expensive canvas extraction.");

    console.log("Public performance verification passed.");
}

main();
