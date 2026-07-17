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

    [
        "initCanonicalHeaderScroll",
        "window.__azielCanonicalHeaderScrollReady",
        "header.dataset.scrollController = \"canonical\"",
        "mount.dataset.scrollController = \"canonical\"",
        "requestAnimationFrame",
        "header.classList.remove(\"nav-hidden\")",
        "const mobileQuery = window.matchMedia(\"(max-width: 900px)\")",
        "const MIN_DELTA = 6",
        "const HIDE_AFTER = 32",
        "const SHOW_AFTER = 8",
        "const TOP_VISIBLE_Y = 20",
        "hasOpenHeaderSurface",
        "forceVisible",
        "hideNavRow",
        "az-nav-hidden",
        "az-nav-visible"
    ].forEach(token => {
        if (token === "visibilitychange") return;
        assert(header.includes(token), `frontend/js/header.js missing canonical header token: ${token}`);
    });

    assert(!header.includes("initAutoRevealNav();"), "header.js must not call the old duplicate auto reveal controller.");
    assert(!header.includes("header.classList.add(\"nav-hidden\")"), "header.js must not use legacy nav-hidden ownership.");
    assert(!header.includes("az-header-hidden"), "header.js must not hide the full header.");
    assert(!header.includes("az-header-visible"), "header.js must not use full-header visible state.");
    assert((header.match(/window\.addEventListener\(\"scroll\"/g) || []).length === 1, "header.js must own exactly one scroll listener.");
    assert(shim.includes("compatibility shim"), "header-scroll.js should remain a shim only.");
    assert(!shim.includes("addEventListener(\"scroll\""), "header-scroll.js must not own scroll events.");
    assert(css.includes("#azHeaderMount") && css.includes("position: sticky;"), "Header mount must use sticky in-flow public ownership.");
    assert(css.includes("overflow-anchor: none;"), "Header mount should not trigger scroll anchoring jumps.");
    assert(css.includes(".az-header") && css.includes("position: relative;"), "Header element should be relative inside the sticky mount.");
    assert(!/\.az-header\s*\{[\s\S]*?position:\s*fixed;/.test(css), "Public header must not be fixed.");
    assert(css.includes("transform var(--motion-standard"), "Nav row CSS must animate transform in the canonical path.");
    assert(css.includes("#azHeaderMount.az-nav-hidden .az-nav") && css.includes("transform: translateY(-100%) !important;"), "Mobile hidden state must transform only the nav row.");
    assert(!css.includes("#azHeaderMount.az-header-hidden .az-header"), "CSS must not hide the full header.");
    assert(css.includes("@media (min-width: 901px)") && css.includes("#azHeaderMount.az-nav-hidden .az-nav"), "Desktop must force the nav row visible.");
    assert(css.includes("#azHeaderMount:focus-within .az-nav"), "Focused header controls must force nav row visible.");
    assert(css.includes("#azHeaderMount:has(.az-nav-dropdown.show) .az-nav"), "Open nav dropdown must force nav row visible.");
    assert(css.includes("#azHeaderMount:has(.az-profile-dropdown.show) .az-nav"), "Open profile menu must force nav row visible.");
    assert(!/body:has\(\.az-header\.nav-hidden\)\s*\{[\s\S]*padding-top:\s*calc/.test(css), "Hidden header state must not inject body padding.");
    assert(!/body[\s\S]{0,80}az-nav-hidden[\s\S]{0,180}padding-top/.test(css), "Nav hidden state must not mutate body padding.");
    assert(!/main[\s\S]{0,80}az-nav-hidden[\s\S]{0,180}padding-top/.test(css), "Nav hidden state must not mutate main padding.");
    assert(!/az-nav-hidden[\s\S]{0,180}margin-top/.test(css), "Nav hidden state must not mutate content margin.");
    assert(!/az-nav-hidden[\s\S]{0,180}display:\s*none/.test(css), "Nav hidden state must not use display:none.");
    assert(!/height:\s*calc\(64px \+ env\(safe-area-inset-top\)\)/.test(css), "Hidden header state must not change reserved header height.");
    assert(mobileCss.includes("overflow-x: clip !important;"), "Mobile global overflow guard must use clip so sticky header is not trapped.");
    assert(!/html,\s*body\s*\{[\s\S]*overflow-x:\s*hidden\s*!important;/.test(mobileCss), "Mobile global overflow guard must not use sticky-hostile hidden overflow.");

    console.log("Header scroll ownership verification passed.");
}

main();
