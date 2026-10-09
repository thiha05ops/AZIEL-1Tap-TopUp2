"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function main() {
    const header = read("frontend/js/header.js");
    const shim = read("frontend/js/header-scroll.js");
    const css = read("frontend/css/theme/aziel-header.css");
    const mobileCss = read("frontend/css/theme/mobile.css");
    const preferences = read("frontend/js/locale-switcher.js");

    [
        "initCanonicalHeaderScroll",
        "window.__azielCanonicalHeaderScrollReady",
        'header.dataset.scrollController = "canonical"',
        'mount.dataset.scrollController = "canonical"',
        'const mobileQuery = window.matchMedia("(max-width: 900px)")',
        "const COLLAPSE_AFTER_Y = 72",
        "const RESTORE_AT_Y = 8",
        "requestAnimationFrame",
        "hasOpenHeaderSurface",
        "forceVisible",
        "collapseUtility",
        "az-utility-collapsed",
        "aziel:headerSurfaceChanged"
    ].forEach(token => assert(header.includes(token), `frontend/js/header.js missing canonical header token: ${token}`));

    assert.strictEqual((header.match(/window\.addEventListener\("scroll"/g) || []).length, 1, "header.js must own exactly one scroll listener");
    assert(!header.includes("function hideHeader"), "Mobile scrolling must not hide the full header");
    assert(!header.includes('mount.classList.add("az-header-hidden")'), "Mobile scrolling must keep the main header visible");
    assert(shim.includes("compatibility shim") && !shim.includes('addEventListener("scroll"'), "header-scroll.js must remain a non-owning compatibility shim");

    assert(css.includes("#azHeaderMount") && css.includes("position: sticky;"), "Header mount must remain sticky and in flow");
    assert(css.includes("overflow-anchor: none;"), "Header mount must avoid scroll anchoring jumps");
    assert(css.includes('"utility utility utility utility"') && css.includes('"menu logo search profile"'), "Mobile header must place the utility row above the main controls");
    assert(css.includes("#azHeaderMount.az-utility-collapsed") && css.includes("max-height: 0"), "Utility collapse must use a CSS class transition");
    assert(css.includes(".az-header > .az-nav > .az-nav-home") && css.includes("display: none !important"), "Mobile drawer must omit the redundant Home row");
    assert(header.includes('<a class="az-mobile-drawer-brand" href="/" aria-label="AZIEL Home">'), "Drawer logo must navigate Home semantically");
    assert(header.includes('utility.id = "mobilePreferenceBtn"') && header.includes("data-mobile-preference-summary"), "Utility row must reuse the existing preference trigger and dynamic summary");
    assert(preferences.includes("const mobile = `${region.flag} ${region.name} · ${lang.compact} · ${region.symbol}`") && preferences.includes("el.textContent = mobile"), "Mobile utility values must come from the canonical preference state");
    assert(!header.includes("az-mobile-preference-footer"), "Preference controls must not remain duplicated in the drawer");
    assert(css.includes("@media (min-width: 901px)") && css.includes(".az-mobile-market-utility"), "Desktop must hide the mobile-only utility row");
    assert(css.includes("overflow-x: clip;") && mobileCss.includes("overflow-x: clip !important;"), "Mobile header must not introduce horizontal overflow");
    assert(css.includes("--az-z-header-dropdown"), "Header dropdown layering must remain intact");

    console.log("Header scroll ownership verification passed.");
}

main();
