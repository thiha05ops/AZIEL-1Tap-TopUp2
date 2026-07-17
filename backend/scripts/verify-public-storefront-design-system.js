const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function includes(file, token, message) {
    assert(read(file).includes(token), `${file}: ${message}`);
}

function main() {
    const design = read("frontend/css/theme/aziel-design-system.css");
    const header = read("frontend/css/theme/aziel-header.css");
    const headerJs = read("frontend/js/header.js");
    const headerShim = read("frontend/js/header-scroll.js");
    const home = read("frontend/css/home/aziel-home.css");
    const homeHtml = read("frontend/home.html");
    const homePromotionRuntime = read("frontend/js/home-promotion-preview.js");
    const homeRuntime = read("frontend/js/home-banner-runtime.js");
    const search = read("frontend/js/search.js");
    const game = read("frontend/css/game/game.css");
    const gameRuntime = read("frontend/js/game-presentation-runtime.js");
    const liveChat = read("frontend/css/support/live-chat.css");

    [
        "--public-page-max",
        "--public-gutter-desktop",
        "--public-gutter-mobile",
        "--public-content-gap",
        "--type-display",
        "--type-page-title",
        "--type-section-title",
        "--type-subsection-title",
        "--surface-liquid",
        "--surface-blur",
        "--motion-ease-premium",
        "--ambient-home-opacity-light",
        "--ambient-game-opacity-dark",
        "--safe-bottom"
    ].forEach(token => assert(design.includes(token), `Shared public token missing ${token}`));

    assert(headerJs.includes("initCanonicalHeaderScroll"), "Header JS must own canonical header state.");
    assert(headerJs.includes("initHeaderSearchTrigger"), "Header JS must initialize the global search trigger.");
    assert(headerJs.includes("openHeaderSearch"), "Header JS must lazy-open the canonical search overlay.");
    includes("frontend/components/header.html", "azHeaderSearchBtn", "Shared header must expose the search trigger.");
    assert(headerJs.includes("header.classList.remove(\"nav-hidden\")"), "Header JS must actively prevent legacy nav-hidden ownership.");
    assert(headerJs.includes("az-nav-hidden"), "Header JS must own mobile nav-row auto-hide.");
    assert(!headerJs.includes("az-header-hidden"), "Header JS must not hide the full header.");
    assert(!headerJs.includes("header.classList.add(\"nav-hidden\")"), "Header JS must not use legacy nav-hidden ownership.");
    assert(header.includes("#azHeaderMount") && header.includes("position: sticky;"), "Public header mount must use sticky in-flow ownership.");
    assert(header.includes(".az-header") && header.includes("position: relative;"), "Header element should be relative inside the sticky mount.");
    const headerBlock = header.match(/\.az-header\s*\{[\s\S]*?\}/)?.[0] || "";
    assert(headerBlock.includes("position: relative;"), "Public header must remain relative.");
    assert(!headerBlock.includes("position: fixed;"), "Public header must not be fixed.");
    assert(headerShim.includes("compatibility shim"), "Legacy header-scroll.js must be a no-op shim.");
    assert(!headerShim.includes("addEventListener(\"scroll\""), "Legacy header-scroll.js must not bind scroll events.");
    assert(header.includes("#azHeaderMount.az-nav-hidden .az-nav"), "CSS must expose canonical nav-row hidden state.");
    assert(header.includes("#azHeaderMount.az-nav-visible .az-nav"), "CSS must expose canonical nav-row visible state.");
    assert(header.includes(".az-search-overlay") && header.includes("var(--az-z-search-overlay"), "Global search overlay styling/layer token missing.");
    assert(header.includes("body.az-search-open") && header.includes("overflow: hidden !important;"), "Global search must lock body scroll while open.");
    assert(header.includes(".az-empty-state"), "Shared empty-state primitive missing.");
    assert(header.includes(".az-skeleton-line"), "Shared skeleton primitive missing.");
    assert(header.includes("#azHeaderMount:has(.az-nav-dropdown.show) .az-nav"), "Open Games dropdown must keep the mobile nav row visible and unclipped.");
    assert(header.includes("z-index: var(--az-z-header-dropdown, 100000) !important;"), "Games dropdown must use the canonical header dropdown layer.");
    assert(!header.includes("#azHeaderMount.az-header-hidden .az-header"), "CSS must not hide the full header.");
    assert(!headerJs.includes("header.classList.add(\"nav-hidden\")"), "Header JS must not use legacy nav-hidden ownership.");
    assert(!/body:has\(\.az-header\.nav-hidden\)\s*\{[\s\S]*padding-top:\s*calc/.test(header), "Hidden header state must not mutate body padding.");

    [
        ".az-home-ambient-buffer",
        "width: 100dvw;",
        "commitHomeAmbientBuffer",
        "ensureHomeAmbientBuffers",
        "home?.style.setProperty(\"--az-banner-ambient-image\""
    ].forEach(token => {
        const source = token.startsWith(".") || token.includes("100dvw") ? home : homeRuntime;
        assert(source.includes(token), `Home full-bleed ambient missing ${token}`);
    });

    assert(!homeRuntime.includes("createElement(\"canvas\")"), "Home runtime must not use canvas RGB extraction.");
    assert(home.includes("width: min(900px, 74%) !important;"), "Home desktop carousel V2.6 side-preview geometry missing.");
    assert(home.includes("width: 98% !important;"), "Home mobile dominant slide geometry missing.");
    assert(home.includes(".az-banner-zone,\n.az-trust-row,\n.az-section,\n.az-dashboard-grid,\n.az-footer"), "Home must constrain content inside a full-width hero shell.");
    assert(homeHtml.includes('id="latestPromotionsPanel"') && homeHtml.includes('id="latestPromotionsList"'), "Home Latest Promotions approved container must remain.");
    assert(homeHtml.includes('/notifications.html?filter=promotions'), "Home Latest Promotions View All must deep link to Promotions.");
    assert(homePromotionRuntime.includes("promo-empty-state") && homePromotionRuntime.includes("promo-item skeleton"), "Latest Promotions must preserve compact empty and skeleton states inside the approved container.");
    assert(homePromotionRuntime.includes("fa-solid fa-gift") && homePromotionRuntime.indexOf("<div>") < homePromotionRuntime.indexOf("fa-solid fa-gift"), "Latest Promotions must keep text-first rows with the icon on the right.");
    assert(home.includes(".promotion-preview-item") && home.includes("grid-template-columns: minmax(0, 1fr) auto auto"), "Latest Promotions compact row geometry must be preserved.");

    assert(search.includes("window.AZIEL_SEARCH"), "Search JS must expose canonical AZIEL_SEARCH owner.");
    assert(search.includes("window.AZIEL_CATALOG?.load") && search.includes("getProducts"), "Search must reuse the public catalog runtime.");
    assert(search.includes("/api/notifications/promotions/active"), "Search should include active public promotions where available.");
    assert(search.includes("localStorage.setItem(RECENT_KEY"), "Search must persist recent searches locally.");
    assert(search.includes("ArrowDown") && search.includes("ArrowUp") && search.includes("Enter") && search.includes("Escape"), "Search keyboard controls missing.");
    assert(!search.includes("tracking.html"), "Search must not include order/private tracking destinations.");

    includes("frontend/css/game/game.css", "--game-mobile-gutter: 14px", "Game mobile gutter token missing.");
    includes("frontend/css/game/game.css", ".game-page::before", "Game full-width ambient region missing.");
    includes("frontend/css/game/game.css", "align-items: stretch !important", "Game desktop hero row must stretch.");
    includes("frontend/css/game/game.css", "grid-template-columns: minmax(0, 2.1fr) minmax(280px, .9fr) !important;", "Game desktop hero must use V2.6 balanced proportions.");
    includes("frontend/css/game/game.css", ".game-howto-toggle", "Game mobile How To disclosure styling missing.");
    assert(gameRuntime.includes("initHowToAccordion"), "Game runtime must initialize mobile How To accordion.");
    assert(gameRuntime.includes("aria-expanded"), "Game How To accordion must own aria-expanded.");

    assert(liveChat.includes("width: 54px !important;"), "Mobile Live Chat launcher must collapse to icon size.");
    assert(liveChat.includes(".aziel-support-tab span") && liveChat.includes("display: none !important;"), "Mobile Live Chat text span must be display:none.");
    assert(liveChat.includes("body.az-payment-sheet-open .aziel-support-tab"), "Payment/modal hide behavior must remain.");

    [home, game, liveChat].forEach((css, index) => {
        const label = ["home", "game", "live-chat"][index];
        assert(!/width:\s*100vw[\s\S]{0,120}padding-(left|right|inline)|padding-(left|right|inline)[\s\S]{0,120}width:\s*100vw/i.test(css), `${label}: width:100vw plus padding overflow pattern found.`);
    });

    console.log("Public storefront design system verification passed.");
}

main();
