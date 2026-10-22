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
        "--az-mobile-gutter-xs",
        "--az-mobile-gutter",
        "--az-mobile-text-gutter",
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
    assert(
        /\.az-header\s*\{[^}]*position:\s*relative;[^}]*\}/.test(header),
        "Canonical public header must remain relative."
    );
    assert(
        !/\.az-header\s*\{[^}]*position:\s*fixed;[^}]*\}/.test(header),
        "Public header must not be fixed."
    );
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
        "zone.style.setProperty(\"--az-banner-ambient-image\""
    ].forEach(token => {
        const source = token.startsWith(".") || token.includes("100dvw") ? home : homeRuntime;
        assert(source.includes(token), `Home full-bleed ambient missing ${token}`);
    });

    assert(
        homeRuntime.includes("sampleHeroImageColors") &&
        homeRuntime.includes('const width = 24;') &&
        homeRuntime.includes('const height = 12;') &&
        homeRuntime.includes("return fallbackHeroColors();"),
        "Home color sampling must remain bounded and fail safely."
    );
    assert(home.includes("width: min(900px, 74%) !important;"), "Home desktop carousel V2.6 side-preview geometry missing.");
    assert(home.includes("width: 98% !important;"), "Home mobile dominant slide geometry missing.");
    assert(home.includes(".az-banner-zone,\n.az-trust-row,\n.az-section,\n.az-dashboard-grid,\n.az-footer"), "Home must constrain content inside a full-width hero shell.");
    assert(homeHtml.includes('id="latestPromotionsPanel"') && homeHtml.includes('id="latestPromotionsList"'), "Home Latest Promotions approved container must remain.");
    assert(homeHtml.includes('/notifications?filter=promotions'), "Home Latest Promotions View All must deep link to Promotions.");
    assert(
        homePromotionRuntime.includes('panel.dataset.promotionPreviewState = "loading"')
        && homePromotionRuntime.includes('panel.dataset.promotionPreviewState = "empty"')
        && homePromotionRuntime.includes('panel.dataset.promotionPreviewState = "error"')
        && homePromotionRuntime.includes("section.hidden = true"),
        "Latest Promotions must fail closed through explicit loading, empty, and error states without exposing an empty section."
    );
    assert(
        homePromotionRuntime.includes('class="home-exclusive-content"')
        && homePromotionRuntime.includes('class="home-exclusive-view"')
        && homePromotionRuntime.includes("fa-solid fa-angle-right")
        && homePromotionRuntime.indexOf('class="home-exclusive-content"') < homePromotionRuntime.indexOf('class="home-exclusive-view"'),
        "Latest Promotions must keep offer content before its trailing View Package action."
    );
    const marketplaceReference = read("frontend/css/home/marketplace-reference.css");
    assert(
        marketplaceReference.includes(".az-home .home-commerce-offer")
        && marketplaceReference.includes(".az-home .home-exclusive-content")
        && marketplaceReference.includes(".az-home .home-exclusive-view"),
        "Latest Promotions commerce-card geometry must remain in the active home stylesheet."
    );

    [
        "@media (max-width: 520px)",
        "width: calc(100% - (var(--az-mobile-gutter, 12px) * 2)) !important;",
        "width: calc(100% - (var(--az-mobile-gutter-xs, 8px) * 2)) !important;",
        "width: calc(100% - 16px) !important;",
        "width: calc(100% - 24px) !important;",
        "#popularGames.az-section",
        "width: 100dvw !important;",
        "padding-left: max(var(--az-mobile-text-gutter, 16px), env(safe-area-inset-left)) !important;",
        "padding: 4px max(var(--az-mobile-gutter, 12px), env(safe-area-inset-right)) 10px max(var(--az-mobile-gutter, 12px), env(safe-area-inset-left)) !important;",
        "scroll-padding-left: max(var(--az-mobile-gutter, 12px), env(safe-area-inset-left)) !important;",
        "scroll-padding-right: max(var(--az-mobile-gutter, 12px), env(safe-area-inset-right)) !important;"
    ].forEach(snippet => assert(home.includes(snippet), `Home mobile edge-to-edge width contract missing ${snippet}`));

    const smallPhoneBlock = read("frontend/css/theme/mobile.css").match(/@media \(max-width: 430px\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
    assert(smallPhoneBlock.includes(".az-home") && smallPhoneBlock.includes("padding-left: 0 !important;"), "Small-phone mobile CSS must neutralize Home shell padding.");
    assert(!/\.az-page,\s*\.az-home,\s*\.main-content/.test(smallPhoneBlock), "Generic small-phone padding must not double-pad .az-home.");
    const mobileCss = read("frontend/css/theme/mobile.css");
    [
        "body .az-home .az-banner-zone",
        "width: calc(100% - 16px) !important;",
        "body .az-home .az-trust-row",
        "body .az-home .az-section:not(#popularGames)",
        "width: calc(100% - 24px) !important;"
    ].forEach(snippet => assert(mobileCss.includes(snippet), `Final mobile Home edge-to-edge owner missing ${snippet}`));

    assert(search.includes("window.AZIEL_SEARCH"), "Search JS must expose canonical AZIEL_SEARCH owner.");
    assert(search.includes("window.AZIEL_CATALOG?.load") && search.includes("getProducts"), "Search must reuse the public catalog runtime.");
    assert(search.includes("/api/notifications/promotions/active"), "Search should include active public promotions where available.");
    assert(search.includes("localStorage.setItem(RECENT_KEY"), "Search must persist recent searches locally.");
    assert(search.includes("ArrowDown") && search.includes("ArrowUp") && search.includes("Enter") && search.includes("Escape"), "Search keyboard controls missing.");
    assert(search.includes('type="text" inputmode="search"'), "Search overlay input must be text/inputmode search to avoid native clear controls.");
    assert(search.includes('role="searchbox"'), "Search overlay input must expose searchbox semantics.");
    assert(search.includes('spellcheck="false"'), "Search overlay input must disable spellcheck.");
    assert((search.match(/id="azSearchClearBtn"/g) || []).length === 1, "Search overlay must create exactly one clear button.");
    assert((search.match(/id="azSearchCloseBtn"/g) || []).length === 1, "Search overlay must create exactly one close button.");
    assert(search.includes('class="az-search-clear"') && search.includes('hidden>'), "Search clear button must be hidden in the empty state.");
    assert(search.includes('class="az-search-close"'), "Search close button must be a distinct always-visible action.");
    assert(search.includes('t("search.placeholder", "Search games, gift cards...")'), "Search overlay must use the localized polished desktop placeholder.");
    assert(search.includes('t("search.placeholderCompact", "Search games...")'), "Search overlay must use the localized short placeholder on narrow mobile widths.");
    assert(search.includes("No results found") && search.includes("Mobile Legends") && search.includes("Weekly Pass"), "Search empty state suggestions missing.");
    assert(!search.includes("tracking.html"), "Search must not include order/private tracking destinations.");

    [
        "height: 56px;",
        ".az-search-overlay.show .az-search-panel",
        "transform: translateY(0) scale(1);",
        ".az-search-input-shell",
        ".az-search-input-shell:focus-within",
        "box-shadow: 0 0 0 1px rgba(139, 92, 246, .18);",
        ".az-search-panel input:focus-visible",
        "box-shadow: none;",
        "grid-template-columns: 50px minmax(0, 1fr) 22px;",
        ".az-search-result>i",
        "color: var(--primary, #7c3aed);",
        ".az-search-empty-list",
        "@media (max-width: 360px)"
    ].forEach(snippet => assert(header.includes(snippet), `Search overlay visual polish missing ${snippet}`));

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
