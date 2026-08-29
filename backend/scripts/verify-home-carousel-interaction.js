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
    const markup = read("frontend/home.html");
    const heroCss = read("frontend/css/home/marketplace-reference.css");
    const headerCss = read("frontend/css/theme/aziel-header.css");

    [
        "listen(track, \"pointerdown\"",
        "listen(track, \"pointermove\"",
        "listen(track, \"pointerup\"",
        "listen(track, \"pointercancel\"",
        "track.setPointerCapture",
        "track.releasePointerCapture",
        "finishDrag",
        "scheduleGestureRender(dragVirtualPosition)",
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
    assert(!markup.includes('class="az-banner-arrow'), "Home markup must not provide a legacy second arrow pair.");
    assert(!runtime.includes("az-banner-arrow"), "Canonical runtime must not render arrow controls.");
    assert(!heroCss.includes("az-banner-arrow"), "Canonical Home CSS must not retain arrow-control presentation.");
    assert(heroCss.includes("height: clamp(330px, 26.5vw, 390px) !important") && heroCss.includes("height: clamp(280px, 28vw, 330px) !important") && heroCss.includes("height: clamp(240px, 27vw, 280px) !important") && heroCss.includes("aspect-ratio: 16 / 9 !important"), "Hero height must be stable and substantial within each breakpoint.");
    assert(!runtime.includes("syncBannerAspectRatio") && !heroCss.includes("--az-active-banner-aspect-ratio"), "Banner source ratios must not change carousel geometry.");
    assert(!heroCss.includes("perspective:") && !runtime.includes("rotateY("), "The film strip must remain flat without 3D-card treatment.");
    assert(heroCss.includes("display: flex !important") && heroCss.includes("gap: var(--az-banner-slide-gap") && heroCss.includes("flex: 0 0 var(--az-banner-slide-width"), "Managed banners must form one continuous flex track.");
    assert(runtime.includes("track.style.transform = `translate3d(${x}px, 0, 0)`") && runtime.includes("const renderedPosition = moduloPosition(pendingVirtualPosition)") && runtime.includes("renderPhysicalPosition(renderedPosition, false)"), "Pointer drag must translate the track directly through the rAF path.");
    assert.strictEqual((runtime.match(/card\.style\.transform/g) || []).length, 1, "Only the single static fallback may position an individual card.");
    assert(!runtime.includes("dataset.carouselSlot"), "Navigation must not identity-swap individual cards.");
    assert(runtime.includes('dataset.carouselClone = "first"') && runtime.includes('dataset.carouselClone = "last"'), "Infinite looping must use temporary edge clones.");
    assert(runtime.includes('listen(track, "transitionend"') && runtime.includes("normalizeSettledPosition") && runtime.includes("renderPhysicalPosition(current, false)"), "Loop edges must normalize without an animated visible jump.");
    assert(runtime.includes("fraction = viewportWidth >= 1200 ? .72 : viewportWidth >= 1024 ? .76") && runtime.includes("viewportWidth > 768 ? .9 : 1"), "Desktop, tablet, and mobile must share the responsive continuous-track model.");
    assert(heroCss.includes("background: transparent !important") && heroCss.includes("object-fit: cover !important"), "Managed images must fill each slide edge-to-edge without a nested image frame.");
    assert(heroCss.includes(".az-home::before") && heroCss.includes("content: none !important") && heroCss.includes("radial-gradient(ellipse at 50% 46%"), "Ambient treatment must remain restrained behind the hero instead of coloring the page.");
    const ambientRuntime = runtime.slice(runtime.indexOf("function commitBannerVisualState"), runtime.indexOf("function commitHomeAmbientBuffer"));
    const pointerMoveRuntime = runtime.slice(runtime.indexOf('listen(track, "pointermove"'), runtime.indexOf('listen(track, "pointerup"'));
    assert(ambientRuntime.includes("const activeCard = cards[current]") && !ambientRuntime.includes("carouselClone"), "Ambient authority must come from the active original banner.");
    assert(ambientRuntime.includes("ambientAuthoritySource = source") && ambientRuntime.includes("ambientAuthoritySource !== source"), "Stale asynchronous samples must not overwrite the latest logical banner color.");
    assert(ambientRuntime.includes("colorCache.has(source)") && ambientRuntime.includes("colorCache.set(source, colors)"), "Each unique image identity, including fallback results, must be cached.");
    assert(ambientRuntime.includes("const width = 24") && ambientRuntime.includes("const height = 12") && ambientRuntime.includes("getImageData"), "Representative color extraction must use a tiny downscaled canvas.");
    assert(ambientRuntime.includes("alpha < 180") && ambientRuntime.includes("max < 28") && ambientRuntime.includes("r > 235"), "Sampling must reject transparent, near-black, and near-white pixels.");
    assert(ambientRuntime.includes("normalizedSaturation") && ambientRuntime.includes("normalizedLightness") && ambientRuntime.includes("hslToRgb"), "Sampled color must be saturation/lightness bounded for the dark storefront.");
    assert(ambientRuntime.includes("catch") && ambientRuntime.includes("fallbackHeroColors"), "Canvas and decode failures must fall back without breaking the hero.");
    assert(!pointerMoveRuntime.includes("canvas") && !pointerMoveRuntime.includes("updateHeroAtmosphere") && !pointerMoveRuntime.includes("getImageData"), "Pointermove must never perform ambient extraction work.");
    assert(heroCss.includes("@property --home-hero-ambient-primary") && heroCss.includes("560ms ease") && heroCss.includes("color-mix(in srgb, var(--home-hero-ambient-primary)"), "Ambient CSS must smoothly transition layered banner-derived gradients.");
    assert(!runtime.includes("brightness(.58)") && !runtime.includes("saturate(.58)"), "Side-card treatment must not use animated image filters.");
    assert(runtime.includes("const normalized = (index + cards.length) % cards.length") && runtime.includes("virtualPosition") && runtime.includes("nearestEquivalentPosition"), "Autoplay, gestures, dots, and keyboard navigation must retain logical and virtual loop state.");
    assert(runtime.includes("dragVirtualPosition = dragStartVirtual - (dragCurrentX / carouselMetrics.step)") && !runtime.includes("clampDrag") && !runtime.includes("DRAG_LIMIT"), "Pointer drag must remain unbounded and may cross multiple logical cycles.");
    assert(runtime.includes("activePointerId = event.pointerId") && runtime.includes("event.pointerId !== activePointerId"), "Drag movement must belong to the initiating pointer.");
    assert(runtime.includes('activePointerType === "mouse" && (event.buttons & 1) === 0'), "Mouse movement must defensively terminate when the primary button is no longer held.");
    assert(runtime.includes("const finalizeActiveDrag") && runtime.includes('listen(track, "lostpointercapture"') && runtime.includes('listen(window, "blur"'), "All interrupted pointer lifecycles must use one canonical finalizer.");
    assert(runtime.includes("if (!isDragging) return false") && runtime.includes("activePointerId = null") && runtime.includes("track.hasPointerCapture"), "Drag finalization must be idempotent and safely clear pointer capture and identity.");
    assert(runtime.includes("if (isDragging) return") && runtime.includes("event.isPrimary === false") && runtime.includes("event.button !== 0"), "Secondary pointers and non-primary mouse buttons must not start a drag.");
    assert(heroCss.includes("@media (min-width: 1024px)") && heroCss.includes("@media (max-width: 768px)"), "Three-panel desktop and single-panel mobile boundaries must remain explicit.");
    assert(markup.includes('<body class="az-home-page">'), "Home header sizing must remain scoped to the Home page.");
    assert(heroCss.includes("margin-top: 0 !important;"), "The in-flow sticky header must not be followed by a duplicate header-height Home offset.");
    assert(headerCss.includes("--az-header-height: 72px") && headerCss.includes("--az-header-mobile-height: 66px") && headerCss.includes("--az-header-mobile-height: 60px"), "Home header must retain the approved desktop, tablet, and mobile heights.");
}

function verifyStaticRuntimeFallback() {
    const runtime = read("frontend/js/home.js");
    assert(!runtime.includes("initAzielBanner"), "home.js must not retain duplicate carousel ownership.");
    assert(!runtime.includes("pointermove"), "home.js must not bind a second drag controller.");
    assert(read("frontend/css/home/aziel-home.css").includes("touch-action: pan-y"), "Canonical carousel must preserve native vertical touch scrolling.");
}

function verifyUnboundedLogicalDragModel() {
    const count = 4;
    const step = 100;
    const modulo = value => ((value % count) + count) % count;
    const logical = value => ((Math.round(value) % count) + count) % count;

    [5500, -5500, 12340, -12340].forEach(pointerDelta => {
        const virtualPosition = -(pointerDelta / step);
        const renderedPosition = modulo(virtualPosition);
        const snappedVirtual = Math.round(virtualPosition);
        assert(renderedPosition >= 0 && renderedPosition < count, "Extreme drag must always rebase inside the bounded rendering cycle.");
        assert.strictEqual(logical(snappedVirtual), modulo(Math.round(virtualPosition)), "Extreme drag must snap back to an original logical banner.");
        assert(Math.abs(snappedVirtual) > count, "Extreme drag must cross more than one complete logical cycle.");
    });

    assert.strictEqual(logical(4), 0, "Last-to-first logical order must loop.");
    assert.strictEqual(logical(-1), 3, "First-to-last reverse logical order must loop.");
}

function verifyPointerLifecycleModel() {
    const state = { dragging: false, pointerId: null, pointerType: "", moves: 0, settles: 0, autoplayResumes: 0 };
    const down = ({ id, type = "mouse", button = 0, primary = true }) => {
        if (state.dragging || !primary || button !== 0) return false;
        state.dragging = true;
        state.pointerId = id;
        state.pointerType = type;
        return true;
    };
    const finalize = id => {
        if (!state.dragging || (id !== undefined && id !== state.pointerId)) return false;
        state.dragging = false;
        state.pointerId = null;
        state.pointerType = "";
        state.settles += 1;
        state.autoplayResumes += 1;
        return true;
    };
    const move = ({ id, buttons = 0 }) => {
        if (!state.dragging || id !== state.pointerId) return false;
        if (state.pointerType === "mouse" && (buttons & 1) === 0) return finalize(id);
        state.moves += 1;
        return true;
    };

    assert.strictEqual(move({ id: 1, buttons: 0 }), false, "Pointermove without pointerdown must not move.");
    assert.strictEqual(down({ id: 1, button: 2 }), false, "Right click must not start dragging.");
    assert.strictEqual(down({ id: 1, button: 1 }), false, "Middle click must not start dragging.");
    assert(down({ id: 1 }) && move({ id: 1, buttons: 1 }), "Primary mouse drag must move while held.");
    assert(finalize(1) && !move({ id: 1, buttons: 0 }), "Movement after pointerup must remain inactive.");
    assert(down({ id: 2 }) && move({ id: 2, buttons: 0 }) && !state.dragging, "Missing pointerup must recover when mouse buttons becomes zero.");
    assert(down({ id: 3 }) && finalize(3) && !finalize(3), "Pointercancel/lost capture finalization must be idempotent.");
    assert(down({ id: 4, type: "touch" }) && move({ id: 4, buttons: 0 }) && state.dragging, "Touch drag must not depend on mouse buttons.");
    finalize(4);
    assert.strictEqual(state.settles, state.autoplayResumes, "Every completed interaction must restore autoplay through one path.");
}

function main() {
    verifyCarouselGeometry();
    verifyManagedRuntimeInteraction();
    verifyStaticRuntimeFallback();
    verifyUnboundedLogicalDragModel();
    verifyPointerLifecycleModel();
    console.log("Home carousel interaction verification passed.");
}

main();
