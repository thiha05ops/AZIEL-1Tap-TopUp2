// AZIEL Home products: persisted catalog placement is the only membership authority.
(function () {
    const HOME_SECTIONS = Object.freeze({
        POPULAR_MOBILE_GAMES: ["POPULAR_MOBILE_GAMES", "POPULAR_GAME_TOPUP"],
        ALL_MOBILE_GAMES: ["ALL_MOBILE_GAMES", "POPULAR_GAME_TOPUP", "NEW_GAME_TOPUP"],
        SOCIAL_TOPUP: ["SOCIAL_TOPUP", "DIGITAL_SERVICES"]
    });
    const SECTION_CONFIG = Object.freeze([
        { key: "POPULAR_MOBILE_GAMES", id: "popularGames", target: "popularGamesList", report: "popular-mobile-games" },
        { key: "ALL_MOBILE_GAMES", id: "allMobileGames", target: "allMobileGamesList", report: "all-mobile-games" },
        { key: "SOCIAL_TOPUP", id: "socialTopUp", target: "socialTopUpList", report: "social-topup" }
    ]);
    const DESKTOP_PANEL_SIZE = 6;
    const MOBILE_QUERY = "(max-width: 720px)";
    const MOBILE_GROUP_RAIL_ID = "homeMobileGroupRail";
    let refreshSequence = 0;
    let refreshInFlight = null;
    let regionRefreshQueued = false;
    let lastSelection = { groups: [] };
    let lastProducts = [];
    let lastCatalogReady = false;
    let mobileLayoutActive = null;

    function ready(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn); else fn(); }
    async function refreshHomeCatalog() {
        const sequence = ++refreshSequence;
        const result = await Promise.allSettled([window.AZIEL_CATALOG?.ensureFresh?.()]);
        if (sequence !== refreshSequence) return;
        syncMobileGroupRail();
        const catalogReady = result[0].status === "fulfilled" && Boolean(window.AZIEL_CATALOG);
        const products = catalogReady ? catalogProducts() : [];
        lastProducts = products;
        lastCatalogReady = catalogReady;
        renderHomeSections(products, catalogReady);
    }
    function renderHomeSections(products, catalogReady) {
        const selection = { groups: [] };
        SECTION_CONFIG.forEach(config => renderSection(config, products, selection, catalogReady));
        lastSelection = selection;
        window.AZIEL_HOME_SELECTION = Object.freeze({ getSnapshot: () => JSON.parse(JSON.stringify(lastSelection)), refresh: scheduleHomeRefresh });
        document.dispatchEvent(new CustomEvent("aziel:home-groups-updated", { detail: JSON.parse(JSON.stringify(selection)) }));
    }
    function scheduleHomeRefresh(options = {}) {
        if (refreshInFlight) { if (options.regionChanged) regionRefreshQueued = true; return refreshInFlight; }
        refreshInFlight = refreshHomeCatalog().finally(() => {
            refreshInFlight = null;
            if (regionRefreshQueued) { regionRefreshQueued = false; scheduleHomeRefresh(); }
        });
        return refreshInFlight;
    }
    function catalogProducts() {
        return uniqueProducts((window.AZIEL_CATALOG?.getProducts?.() || []).map(displayProduct).filter(isHomeSafe)).sort(compareHomeOrder);
    }
    function isHomeSafe(product = {}) {
        return Boolean(product?.route) && product.enabled !== false && product.homepageEnabled === true && product.discoverable === true && product.publicState !== "HIDDEN";
    }
    function belongsToSection(product = {}, section) {
        const persisted = new Set((product.homepageSections || []).map(value => String(value).trim().toUpperCase()));
        return (HOME_SECTIONS[section] || []).some(value => persisted.has(value));
    }
    function selectProducts(products = [], section) {
        return uniqueProducts(products.filter(isHomeSafe).filter(product => belongsToSection(product, section))).sort(compareHomeOrder);
    }
    function selectPopularProducts(products = []) { return selectProducts(products, "POPULAR_MOBILE_GAMES"); }
    function selectAllMobileProducts(products = []) { return selectProducts(products, "ALL_MOBILE_GAMES"); }
    function selectSocialProducts(products = []) { return selectProducts(products, "SOCIAL_TOPUP"); }
    function renderSection(config, products, selection, catalogReady) {
        const section = document.getElementById(config.id);
        const target = document.getElementById(config.target);
        if (!section || !target) return;
        const selected = catalogReady ? selectProducts(products, config.key) : [];
        if (!selected.length) {
            hideSection(section, target, catalogReady ? "no-admin-placement" : "catalog-unavailable");
            selection.groups.push(groupReport(config.report, [], section.dataset.homeHiddenReason));
            return;
        }
        target.innerHTML = renderPanels(selected, config.report, isMobileViewport() ? selected.length : DESKTOP_PANEL_SIZE);
        target.removeAttribute("aria-busy");
        section.hidden = false;
        section.dataset.homeSelectionSource = "catalog-homepage-sections";
        delete section.dataset.homeHiddenReason;
        window.AZIEL_CATALOG_PRESENTATION?.bindImageFallbacks?.(target);
        selection.groups.push(groupReport(config.report, selected, "catalog-homepage-sections"));
    }
    function chunkProducts(products = [], size = DESKTOP_PANEL_SIZE) {
        const chunkSize = Math.max(1, Number(size) || DESKTOP_PANEL_SIZE);
        const chunks = [];
        for (let index = 0; index < products.length; index += chunkSize) chunks.push(products.slice(index, index + chunkSize));
        return chunks;
    }
    function renderPanels(products, groupId, panelSize = DESKTOP_PANEL_SIZE) {
        const panels = [];
        chunkProducts(products, panelSize).forEach(chunk => {
            const items = chunk.map(product => renderProduct(product, groupId)).join("");
            panels.push(`<div class="home-product-panel" role="list">${items}</div>`);
        });
        return panels.join("");
    }
    function isMobileViewport() { return window.matchMedia?.(MOBILE_QUERY).matches === true; }
    function syncMobileGroupRail() {
        const main = document.querySelector?.("main.az-home");
        const sections = SECTION_CONFIG.map(config => document.getElementById(config.id)).filter(Boolean);
        if (!main || !sections.length) return;
        let rail = document.getElementById(MOBILE_GROUP_RAIL_ID);
        const mobile = isMobileViewport();
        if (mobileLayoutActive === mobile && (mobile ? Boolean(rail) : !rail)) return;
        mobileLayoutActive = mobile;
        if (mobile) {
            if (!rail) {
                rail = document.createElement("div");
                rail.id = MOBILE_GROUP_RAIL_ID;
                rail.className = "home-mobile-group-rail";
                sections[0].before(rail);
            }
            sections.forEach(section => rail.append(section));
            return;
        }
        const anchor = document.getElementById("newsPromotions");
        sections.forEach(section => main.insertBefore(section, anchor || null));
        rail?.remove();
    }
    function renderProduct(product, groupId) {
        return `<a href="${escapeAttr(homeRoute(product))}" class="home-product-item ${stateClass(product)}" role="listitem" data-product-code="${escapeAttr(codeOf(product))}" data-commerce-state="${escapeAttr(product.commerceState)}" data-purchasable="${product.purchasable === true}">
            <img src="${escapeAttr(presentationArtwork(product, groupId))}" alt="${escapeAttr(product.imageAltText || product.name)}" loading="lazy" decoding="async">
            <span class="home-product-copy"><strong>${escapeHtml(product.name || codeOf(product))}</strong>${readinessBadge(product)}<small>${escapeHtml(productType(product))}</small></span>
        </a>`;
    }
    function displayProduct(product = {}) {
        const canonical = window.AZIEL_CATALOG?.getProduct?.(codeOf(product)) || product;
        return window.AZIEL_CATALOG_PRESENTATION?.buildDisplayProduct?.(canonical) || null;
    }
    function presentationArtwork(product = {}, groupId = "") {
        const image = String(product.image || "");
        if (image && !image.includes("assets/brand/aziel-icon")) return image;
        return groupId === "social-topup" ? "assets/fallbacks/digital-services.svg" : "assets/fallbacks/game-topup.svg";
    }
    function homeRoute(product = {}) { return window.AZIEL_CATALOG_PRESENTATION?.resolveProductRoute?.(product.productRoute || product.route, codeOf(product)) || ""; }
    function stateClass(product = {}) { return `is-${String(product.commerceState || "HIDDEN").toLowerCase().replaceAll("_", "-")}`; }
    function readinessBadge(product = {}) { return product.publicState === "COMING_SOON" || product.commerceState === "COMING_SOON" ? '<span class="home-product-state">Coming Soon</span>' : ""; }
    function productType(product = {}) { return String(product.description || product.searchDescription || "Digital product").split(/[•·]/)[0].trim(); }
    function compareHomeOrder(a, b) { return Number(a.homepageOrder || 0) - Number(b.homepageOrder || 0) || codeOf(a).localeCompare(codeOf(b)); }
    function uniqueProducts(products) { const seen = new Set(); return products.filter(product => { const code = codeOf(product); if (!code || seen.has(code)) return false; seen.add(code); return true; }); }
    function hideSection(section, target, reason) { section.hidden = true; section.dataset.homeHiddenReason = reason; target.innerHTML = ""; }
    function groupReport(id, items, source) { return { id, source, itemCount: items.length, productCodes: items.map(codeOf).filter(Boolean) }; }
    function codeOf(product = {}) { return String(product.productCode || "").trim().toLowerCase(); }
    function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
    function escapeAttr(value = "") { return escapeHtml(value); }

    window.AZIEL_HOME_PLACEMENT_POLICY = Object.freeze({ HOME_SECTIONS, isHomeSafe, belongsToSection, selectProducts, selectPopularProducts, selectAllMobileProducts, selectSocialProducts, chunkProducts });
    ready(() => {
        scheduleHomeRefresh();
        window.addEventListener("aziel:shopRegionChanged", () => scheduleHomeRefresh({ regionChanged: true }));
        document.addEventListener("aziel:catalog-updated", event => { if (event.detail?.status === "ready") scheduleHomeRefresh(); });
        window.matchMedia?.(MOBILE_QUERY).addEventListener?.("change", () => {
            syncMobileGroupRail();
            renderHomeSections(lastProducts, lastCatalogReady);
        });
    });
})();
