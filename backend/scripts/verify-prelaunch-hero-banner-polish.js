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

function verifyHomeBannerPolish() {
    const css = read("frontend/css/home/aziel-home.css");
    const runtime = read("frontend/js/home-banner-runtime.js");
    const legacyHome = read("frontend/js/home.js");

    [
        "--az-banner-ambient-image",
        "--az-banner-active-position",
        "--az-banner-transition-duration",
        ".az-home::before",
        ".az-home-ambient-buffer",
        ".az-banner-zone::before",
        "aspect-ratio: 16 / 4.75",
        "object-fit: cover",
        "mask-image: radial-gradient",
        "mask-image: linear-gradient",
        "@keyframes azHeroKenBurns",
        "@media (prefers-reduced-motion: reduce)"
    ].forEach(snippet => assert(css.includes(snippet), `Home banner CSS missing ${snippet}`));

    [
        "commitBannerVisualState",
        "zone.style.setProperty(\"--az-banner-ambient-image\"",
        "home?.style.setProperty(\"--az-banner-ambient-image\"",
        "zone.style.setProperty(\"--az-banner-active-position\"",
        "home?.style.setProperty(\"--az-banner-active-position\"",
        "commitHomeAmbientBuffer",
        "ensureHomeAmbientBuffers",
        "resolveObjectPosition",
        "preloadImages(banners.map(banner => banner.imageUrl))"
    ].forEach(snippet => assert(runtime.includes(snippet), `Home banner runtime missing ${snippet}`));

    assert(!runtime.includes("createElement(\"canvas\")"), "Home managed banner runtime must not use canvas color extraction.");
    assert(!legacyHome.includes("createElement(\"canvas\")"), "Home static carousel must not use canvas color extraction.");
    assert(css.includes("body::after") && css.includes("background: none !important"), "Home CSS must remove hard header color strip.");
}

function verifyGameBannerPolish() {
    const css = read("frontend/css/game/game.css");
    const runtime = read("frontend/js/game-presentation-runtime.js");

    [
        "--game-banner-ambient-image",
        "--game-banner-active-position",
        "--game-banner-transition-duration",
        ".game-page::before",
        ".game-banner::before",
        "min-height: 292px",
        "align-items: stretch",
        "object-fit: cover",
        "mask-image: radial-gradient",
        "mask-image: linear-gradient",
        "@keyframes gameBannerKenBurns",
        "@media (prefers-reduced-motion: reduce)"
    ].forEach(snippet => assert(css.includes(snippet), `Game banner CSS missing ${snippet}`));

    [
        "--game-mobile-gutter: 14px",
        "grid-template-columns: minmax(0, 2.1fr) minmax(280px, .9fr) !important;",
        "height: 100% !important;",
        "padding:",
        "max(var(--game-mobile-gutter), env(safe-area-inset-right))",
        "max(var(--game-mobile-gutter), env(safe-area-inset-left))",
        "width: 100% !important;",
        "box-sizing: border-box !important;"
    ].forEach(snippet => assert(css.includes(snippet), `Game layout alignment CSS missing ${snippet}`));

    [
        "commitBannerVisualState(root, slides[next])",
        "root.style.setProperty(\"--game-banner-ambient-image\"",
        "page?.style.setProperty(\"--game-banner-ambient-image\"",
        "root.style.setProperty(\"--game-banner-active-position\"",
        "page?.style.setProperty(\"--game-banner-active-position\"",
        "commitStaticFallbackState(root)",
        "resolveObjectPosition",
        "preloadImages(banners.map(banner => banner.imageUrl))"
    ].forEach(snippet => assert(runtime.includes(snippet), `Game banner runtime missing ${snippet}`));

    assert(!runtime.includes("createElement(\"canvas\")"), "Game banner runtime must not use canvas color extraction.");
    assert(!/\.game-banner-slide\s*\{[\s\S]*?inset:\s*18px/.test(css), "Managed game slides must not keep the old inset card gap.");
}

function verifySharedGamePages() {
    [
        "frontend/mlbb.html",
        "frontend/pubg.html",
        "frontend/freefire.html",
        "frontend/hok.html",
        "frontend/aov-id.html",
        "frontend/pubg-rp.html",
        "frontend/telegram.html",
        "frontend/genshin.html",
        "frontend/roblox.html"
    ].forEach(file => {
        includes(file, "game-presentation-runtime.js", "Game page must use shared game banner runtime.");
        includes(file, 'class="game-banner" data-managed-content-state="resolving"', "Game page must reserve shared managed banner state.");
    });
}

function verifyLiveChatMobile() {
    const css = read("frontend/css/support/live-chat.css");

    [
        "width: 54px !important;",
        "height: 54px !important;",
        "right: max(14px, env(safe-area-inset-right)) !important;",
        "bottom: max(14px, env(safe-area-inset-bottom)) !important;",
        "body.az-payment-sheet-open .chat-ball",
        "body.az-payment-sheet-open .live-chat-panel",
        "height: min(70vh, calc(100dvh - 112px - env(safe-area-inset-bottom))) !important;"
    ].forEach(snippet => assert(css.includes(snippet), `Live chat CSS missing ${snippet}`));
}

function verifyOverflowSafety() {
    const files = [
        "frontend/css/home/aziel-home.css",
        "frontend/css/game/game.css",
        "frontend/css/support/live-chat.css"
    ];

    files.forEach(file => {
        const css = read(file);
        assert(css.includes("max-width: 100%") || file.includes("live-chat"), `${file}: touched banner surfaces should cap nested widths.`);
        notMatches(file, /width:\s*100vw[\s\S]{0,120}padding-(left|right|inline)|padding-(left|right|inline)[\s\S]{0,120}width:\s*100vw/i, "must not combine width:100vw with horizontal padding.");
    });
}

function verifyHomeMobileAndAmbientOwnership() {
    const css = read("frontend/css/home/aziel-home.css");
    const runtime = read("frontend/js/home-banner-runtime.js");
    const legacyHome = read("frontend/js/home.js");

    [
        ".az-home::before",
        ".az-home-ambient-buffer",
        "width: 100dvw;",
        "height: min(560px, 70svh) !important;",
        "body.theme-dark .az-home::before",
        "width: 98% !important;",
        "max-width: calc(100% - 4px) !important;",
        "object-position: var(--az-banner-object-position, var(--az-banner-active-position)) !important;"
    ].forEach(snippet => assert(css.includes(snippet), `Home mobile/ambient ownership missing ${snippet}`));

    assert(runtime.includes("home?.style.setProperty(\"--az-banner-ambient-image\""), "Managed Home ambient must update the page-level ambient owner.");
    assert(runtime.includes("commitHomeAmbientBuffer(home, imageUrl, objectPosition)"), "Managed Home ambient must use dual ambient buffers.");
    assert(legacyHome.includes("home?.style.setProperty("), "Static Home fallback must update the page-level ambient owner.");
}

function main() {
    verifyHomeBannerPolish();
    verifyGameBannerPolish();
    verifySharedGamePages();
    verifyLiveChatMobile();
    verifyHomeMobileAndAmbientOwnership();
    verifyOverflowSafety();
    console.log("Pre-launch hero/banner/live-chat polish verification passed.");
}

main();
