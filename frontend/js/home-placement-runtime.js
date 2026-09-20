// AZIEL Home presentation plane: cached cards first, scoped revalidation second.
(function () {
    "use strict";
    const CACHE_PREFIX = "aziel.home.presentation.v1";
    const CONFIG = Object.freeze([
        { key: "POPULAR_MOBILE_GAMES", id: "popularGames", target: "popularGamesList", report: "popular-mobile-games" },
        { key: "ALL_MOBILE_GAMES", id: "allMobileGames", target: "allMobileGamesList", report: "all-mobile-games" },
        { key: "SOCIAL_TOPUP", id: "socialTopUp", target: "socialTopUpList", report: "social-topup" }
    ]);
    const MOBILE = "(max-width: 720px)";
    let sequence = 0;
    let lastPayload = null;

    function ready(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true }); else fn(); }
    function region() {
        const value = window.AZIEL?.getShopRegion?.()
            || localStorage.getItem("shopRegion")
            || localStorage.getItem("selectedRegion")
            || localStorage.getItem("region")
            || "MM";
        return ["TH", "MM"].includes(String(value).toUpperCase()) ? String(value).toUpperCase() : "MM";
    }
    function key(market) { return `${CACHE_PREFIX}.${market}`; }
    function validProduct(product) { return Boolean(product && typeof product === "object" && !Array.isArray(product) && String(product.productCode || "").trim() && String(product.displayName || "").trim() && String(product.route || "").trim()); }
    function validSnapshot(value, market) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        if (value.region !== market || !String(value.revision || "").trim() || !Array.isArray(value.sections)) return false;
        return value.sections.every(section => section && typeof section === "object" && !Array.isArray(section) && CONFIG.some(config => config.key === section.key) && Array.isArray(section.products) && section.products.every(validProduct));
    }
    function removeCache(market) { try { localStorage.removeItem(key(market)); } catch { /* storage is optional */ } }
    function readCache(market) {
        try {
            const value = JSON.parse(localStorage.getItem(key(market)) || "null");
            if (validSnapshot(value, market)) return value;
            if (value !== null) removeCache(market);
        } catch { removeCache(market); }
        return null;
    }
    function writeCache(payload, market) { try { localStorage.setItem(key(market), JSON.stringify(payload)); } catch { /* storage is optional */ } }
    function mark(name, detail = {}) {
        performance.mark?.(`aziel-home:${name}`);
        window.AZIEL_HOME_PERFORMANCE = { ...(window.AZIEL_HOME_PERFORMANCE || {}), [name]: { at: performance.now(), ...detail } };
    }

    async function refresh({ regionChanged = false } = {}) {
        const market = region();
        const requestId = ++sequence;
        let cached = readCache(market);
        if (cached) {
            try {
                render(cached, "local-cache");
                mark("presentation-cache-hit", { region: market });
            } catch {
                removeCache(market);
                cached = null;
                showSkeletons();
                mark("presentation-cache-invalid", { region: market });
            }
        }
        else { mark("presentation-cache-miss", { region: market }); if (regionChanged) showSkeletons(); }
        const headers = cached?.revision ? { "If-None-Match": `"home-${market}-${cached.revision}"` } : {};
        const startedAt = performance.now();
        try {
            const response = await fetch(`/api/public/home-presentation?region=${encodeURIComponent(market)}`, { headers, credentials: "same-origin" });
            mark("presentation-network-complete", { region: market, durationMs: Math.round(performance.now() - startedAt), status: response.status });
            if (requestId !== sequence) return;
            if (response.status === 304 && cached) return;
            if (!response.ok) throw new Error(`Presentation request failed (${response.status})`);
            const payload = await response.json();
            if (!payload?.success || !validSnapshot(payload, market)) throw new Error("Presentation response is invalid");
            writeCache(payload, market);
            if (!cached || cached.revision !== payload.revision) { render(payload, cached ? "network-reconcile" : "network"); mark("cards-reconciled", { region: market }); }
        } catch (error) {
            if (requestId !== sequence || cached) return;
            showUnavailable();
            if (["localhost", "127.0.0.1"].includes(location.hostname)) console.warn("Home presentation unavailable:", error.message);
        }
    }

    function render(payload, source) {
        lastPayload = payload;
        const groups = [];
        CONFIG.forEach(config => {
            const section = document.getElementById(config.id);
            const target = document.getElementById(config.target);
            if (!section || !target) return;
            const products = payload.sections.find(item => item.key === config.key)?.products || [];
            if (!products.length) { section.hidden = true; target.innerHTML = ""; }
            else { target.innerHTML = panels(products, config.report); target.removeAttribute("aria-busy"); section.hidden = false; section.dataset.homeSelectionSource = source; }
            groups.push({ id: config.report, source, itemCount: products.length, productCodes: products.map(item => item.productCode) });
        });
        const snapshot = { groups };
        window.AZIEL_HOME_SELECTION = Object.freeze({ getSnapshot: () => JSON.parse(JSON.stringify(snapshot)), refresh });
        document.dispatchEvent(new CustomEvent("aziel:home-groups-updated", { detail: snapshot }));
        mark("first-cards-rendered", { source });
    }

    function panels(products, groupId) {
        const size = window.matchMedia?.(MOBILE).matches ? products.length : 6;
        const result = [];
        for (let offset = 0; offset < products.length; offset += Math.max(1, size)) {
            const items = products.slice(offset, offset + Math.max(1, size));
            result.push(`<div class="home-product-panel" role="list" data-panel-size="${items.length}">${items.map((product, index) => productCard(product, groupId, offset + index)).join("")}</div>`);
        }
        return result.join("");
    }

    function productCard(product, groupId, index) {
        const art = product.artwork || {};
        const fallback = groupId === "social-topup" ? "/assets/fallbacks/digital-services.svg" : "/assets/fallbacks/game-topup.svg";
        const eager = groupId === "popular-mobile-games" && index < 2;
        return `<a href="${attr(resolveProductRoute(product.route, product.productCode))}" class="home-product-item is-${String(product.state || "presented").toLowerCase().replaceAll("_", "-")}" role="listitem" data-product-code="${attr(product.productCode)}">
            <img src="${attr(art.src || fallback)}"${art.srcset ? ` srcset="${attr(art.srcset)}" sizes="${attr(art.sizes || "")}"` : ""} width="${Number(art.width || 480)}" height="${Number(art.height || 480)}" alt="${attr(art.alt || product.displayName)}" loading="${eager ? "eager" : "lazy"}" decoding="async"${eager ? ' fetchpriority="high"' : ""}>
            <span class="home-product-copy"><strong>${html(product.displayName || product.productCode)}</strong>${product.state === "COMING_SOON" ? '<span class="home-product-state">Coming Soon</span>' : ""}${product.subtitle ? `<small class="home-product-description">${html(product.subtitle)}</small>` : ""}</span>
        </a>`;
    }

    function showSkeletons() { CONFIG.forEach(config => { const section = document.getElementById(config.id); if (section) section.hidden = config.key !== "POPULAR_MOBILE_GAMES"; }); }
    function showUnavailable() { const target = document.getElementById("popularGamesList"); if (target) { target.innerHTML = '<div class="home-catalog-empty"><strong>Products are temporarily unavailable.</strong></div>'; target.removeAttribute("aria-busy"); } }
    function resolveProductRoute(route = "", productCode = "") { const value = String(route || "").trim(); if (value && !/^(?:[a-z]+:|\/\/)/i.test(value) && !value.startsWith("javascript:")) return value; const code = String(productCode || "").trim().toLowerCase(); return code ? `product.html?product=${encodeURIComponent(code)}` : "#"; }
    function isHomeSafe(product = {}) { return Boolean(product.productRoute || product.route) && product.enabled !== false && product.homepageEnabled === true && product.discoverable !== false && product.publicState !== "HIDDEN"; }
    function belongsToSection(product = {}, section) { const aliases = { POPULAR_MOBILE_GAMES: ["POPULAR_MOBILE_GAMES", "POPULAR_GAME_TOPUP"], ALL_MOBILE_GAMES: ["ALL_MOBILE_GAMES", "POPULAR_GAME_TOPUP", "NEW_GAME_TOPUP"], SOCIAL_TOPUP: ["SOCIAL_TOPUP", "DIGITAL_SERVICES"] }; const values = (product.homepageSections || []).map(value => String(value).toUpperCase()); return (aliases[section] || [section]).some(value => values.includes(value)); }
    function selectProducts(products = [], section) { return products.filter(isHomeSafe).filter(product => belongsToSection(product, section)).sort((a, b) => Number(a.homepageOrder || 0) - Number(b.homepageOrder || 0) || String(a.productCode || "").localeCompare(String(b.productCode || ""))); }
    function selectPopularProducts(products = []) { return selectProducts(products, "POPULAR_MOBILE_GAMES").filter(product => product.publicCategory === "mobile"); }
    function selectAllMobileProducts(products = []) { return selectProducts(products, "ALL_MOBILE_GAMES").filter(product => product.publicCategory === "mobile"); }
    function selectSocialProducts(products = []) { return selectProducts(products, "SOCIAL_TOPUP"); }
    function chunkProducts(products = [], size = 6) { const chunks = []; for (let index = 0; index < products.length; index += Math.max(1, size)) chunks.push(products.slice(index, index + Math.max(1, size))); return chunks; }
    function html(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
    function attr(value = "") { return html(value); }

    window.AZIEL_HOME_PRESENTATION = Object.freeze({ refresh, getSnapshot: () => lastPayload ? JSON.parse(JSON.stringify(lastPayload)) : null });
    window.AZIEL_HOME_PLACEMENT_POLICY = Object.freeze({ isHomeSafe, belongsToSection, selectProducts, selectPopularProducts, selectAllMobileProducts, selectSocialProducts, chunkProducts });
    window.AZIEL_HOME_PRESENTATION_TESTING = Object.freeze({ region, validSnapshot, key });
    ready(() => {
        mark("shell-ready");
        refresh();
        window.addEventListener("aziel:shopRegionChanged", () => refresh({ regionChanged: true }));
        window.matchMedia?.(MOBILE).addEventListener?.("change", () => { if (lastPayload) render(lastPayload, "viewport-reflow"); });
    });
})();
