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

function verifyCarouselGeometry() {
    const css = read("frontend/css/home/aziel-home.css");

    [
        "width: min(900px, 74%) !important;",
        "width: 82% !important;",
        "width: 98% !important;",
        ".az-home::before",
        ".az-home-ambient-buffer",
        "overflow: visible !important;",
        "overflow: hidden !important;",
        "touch-action: pan-y !important;",
        "--az-banner-ambient-image",
        "background-image: var(--az-banner-ambient-image)",
        "z-index: 0",
        "z-index: 1",
        "width: 100dvw;",
        "height: min(560px, 70svh) !important;",
        "mask-image: radial-gradient",
        "mask-image: linear-gradient",
        "@media (max-width: 420px)"
    ].forEach(snippet => assert(css.includes(snippet), `Home carousel CSS missing ${snippet}`));

    assert(css.includes("width: min(900px, 74%) !important;"), "Slide cards must stay narrower than the viewport.");
    assert(css.includes("overflow: hidden !important;"), "Slide cards must own clipping.");
    notMatches("frontend/css/home/aziel-home.css", /\.az-banner-card\s*\{[^}]*width:\s*100%\s*!important;/, "Home carousel active slide must not be forced to full viewport width.");
    notMatches("frontend/css/home/aziel-home.css", /width:\s*100vw[\s\S]{0,120}padding-(left|right|inline)|padding-(left|right|inline)[\s\S]{0,120}width:\s*100vw/i, "Home carousel must not introduce 100vw plus padding overflow.");
}

function verifyManagedRuntimeInteraction() {
    const runtime = read("frontend/js/home-banner-runtime.js");

    [
        "listen(track, \"pointerdown\"",
        "listen(track, \"pointermove\"",
        "listen(track, \"pointerup\"",
        "listen(track, \"pointercancel\"",
        "track.setPointerCapture",
        "track.releasePointerCapture",
        "DRAG_THRESHOLD",
        "clampDrag",
        "finishDrag",
        "scheduleGestureRender(dragCurrentX)",
        "pauseAuto",
        "scheduleAuto",
        "listen(document, \"visibilitychange\"",
        "listen(track, \"mouseenter\"",
        "listen(track, \"mouseleave\"",
        "listen(track, \"keydown\"",
        "ArrowLeft",
        "ArrowRight",
        "event.preventDefault()",
        "listen(track, \"click\"",
        "listen(track, \"dragstart\"",
        "commitBannerVisualState(track.closest(\".az-banner-zone\"))",
        "zone.style.setProperty(\"--az-banner-ambient-image\"",
        "zone.style.setProperty(\"--az-banner-active-position\""
    ].forEach(snippet => assert(runtime.includes(snippet), `Home managed carousel runtime missing ${snippet}`));

    assert(runtime.includes("AbortController") && runtime.includes("cleanupCarouselController"), "Carousel listeners and timers must have one cleanup owner.");
    assert(runtime.includes("requestAnimationFrame") && runtime.includes("carouselMetrics"), "Pointer rendering must be frame-batched and use cached geometry.");
}

function verifyStaticRuntimeFallback() {
    const runtime = read("frontend/js/home.js");
    assert(!runtime.includes("initAzielBanner"), "home.js must not retain duplicate carousel ownership.");
    assert(!runtime.includes("pointermove"), "home.js must not bind a second drag controller.");
    assert(read("frontend/css/home/aziel-home.css").includes("touch-action: pan-y"), "Canonical carousel must preserve native vertical touch scrolling.");
}

function main() {
    verifyCarouselGeometry();
    verifyManagedRuntimeInteraction();
    verifyStaticRuntimeFallback();
    console.log("Home carousel interaction verification passed.");
}

main();
