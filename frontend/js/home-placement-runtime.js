// Home catalog selection: persisted placement/category authority with presentation-only fallbacks.

(function () {
    const API_URL = "/api/site-placements/home";
    const FEATURED_LABELS = Object.freeze({
        mlbb: ["Mobile Legends", "Diamonds"],
        pubg: ["PUBG Mobile", "UC"],
        freefire: ["Free Fire", "Diamonds"],
        hok: ["Honor of Kings", "Tokens & Packages"],
        "marvel-rivals": ["Marvel Rivals", "Top Up"],
        "blood-strike": ["Blood Strike", "Golds, Pass"]
    });
    const ALL_MOBILE_LABELS = Object.freeze({
        "age-of-empires-mobile": ["Age of Empires Mobile", "Top Up"],
        "lineage-2m": ["Lineage 2M", "Top Up"],
        overmortal: ["OverMortal", "Voucher"],
        "magic-chess-go-go": ["Magic Chess: Go Go", "Top Up"],
        lifeafter: ["LifeAfter", "Credits & Packages"],
        pubgrp: ["PUBG Royale Pass", "Royale Pass Pack"],
        "mlbb-twilight-weekly-pass": ["MLBB Passes", "Twilight & Weekly Passes"],
        "blood-strike-pass": ["Blood Strike Pass", "Pass"],
        "marvel-rivals": ["Marvel Rivals", "Top Up"],
        pubg: ["PUBG Mobile", "UC"],
        freefire: ["Free Fire", "Diamonds"],
        hok: ["Honor of Kings", "Tokens & Packages"]
    });
    const WORDMARK_LABELS = Object.freeze({
        "marvel-rivals": "MARVEL RIVALS",
        "blood-strike": "BLOOD STRIKE",
        "age-of-empires-mobile": "AGE OF EMPIRES",
        "lineage-2m": "LINEAGE 2M",
        overmortal: "OVERMORTAL",
        "magic-chess-go-go": "MAGIC CHESS",
        lifeafter: "LIFEAFTER",
        "blood-strike-pass": "BLOOD STRIKE",
        "mlbb-twilight-weekly-pass": "MLBB PASSES"
    });

    let refreshSequence = 0;
    let refreshInFlight = null;
    let regionRefreshQueued = false;
    let lastSelection = { groups: [], placements: {}, fallbackProducts: [] };

    function ready(fn) {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
        else fn();
    }

    function currentRegion() {
        return window.AZIEL?.getRegion?.() ||
            localStorage.getItem("selectedRegion") ||
            localStorage.getItem("region") ||
            "MM";
    }

    async function refreshHomeCatalog() {
        const sequence = ++refreshSequence;
        const [catalogResult, sectionResult, placementResult] = await Promise.allSettled([
            window.AZIEL_CATALOG?.ensureFresh?.(),
            window.AZIEL_STOREFRONT_SECTIONS?.load?.(),
            loadPlacements()
        ]);
        if (sequence !== refreshSequence) return;

        const catalogReady = catalogResult.status === "fulfilled" && Boolean(window.AZIEL_CATALOG);
        const products = catalogReady ? catalogProducts() : [];
        const sections = sectionResult.status === "fulfilled" && Array.isArray(sectionResult.value)
            ? sectionResult.value
            : window.AZIEL_STOREFRONT_SECTIONS?.fallbackSections?.() || [];
        const placements = placementResult.status === "fulfilled" ? placementResult.value : null;

        const selection = {
            groups: [],
            placements: {},
            fallbackProducts: []
        };

        renderPopularGames(placements?.HOME_POPULAR_GAMES, sections, selection, catalogReady);
        renderAllMobileGames(products, sections, selection);
        renderSocialTopUp(products, selection);

        lastSelection = selection;
        window.AZIEL_HOME_SELECTION = Object.freeze({
            getSnapshot: () => JSON.parse(JSON.stringify(lastSelection)),
            refresh: scheduleHomeRefresh
        });
        document.dispatchEvent(new CustomEvent("aziel:home-groups-updated", {
            detail: JSON.parse(JSON.stringify(selection))
        }));
    }

    function scheduleHomeRefresh(options = {}) {
        if (refreshInFlight) {
            if (options.regionChanged) regionRefreshQueued = true;
            return refreshInFlight;
        }
        refreshInFlight = refreshHomeCatalog().finally(() => {
            refreshInFlight = null;
            if (regionRefreshQueued) {
                regionRefreshQueued = false;
                scheduleHomeRefresh();
            }
        });
        return refreshInFlight;
    }

    async function loadPlacements() {
        const params = new URLSearchParams({ region: currentRegion() });
        const response = await fetch(`${API_URL}?${params.toString()}`, {
            headers: { Accept: "application/json" },
            cache: "no-store"
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success || !data.placements) throw new Error("Home placements unavailable");
        return data.placements;
    }

    function catalogProducts() {
        return (window.AZIEL_CATALOG?.getProducts?.() || [])
            .map(displayProduct)
            .filter(product => product?.route && product.enabled !== false)
            .filter(product => product.homepageEnabled === true)
            .filter(product => product.discoverable === true)
            .sort((a, b) => Number(a.homepageOrder || 0) - Number(b.homepageOrder || 0));
    }

    function renderPopularGames(placement, sections, selection, catalogReady) {
        const section = document.getElementById("popularGames");
        const target = section?.querySelector(".popular-game-grid");
        if (!section || !target) return;

        if (!isSectionPublished(sections, "popular-game-topup")) {
            hideSection(section, target, "category-disabled");
            selection.groups.push(groupReport("popular-game-top-up", [], "category-disabled"));
            return;
        }

        if (placement?.managed !== true || !(placement.items || []).length) {
            hideSection(section, target, "admin-disabled");
            selection.placements.HOME_POPULAR_GAMES = [];
            selection.groups.push(groupReport("popular-game-top-up", [], "admin-disabled"));
            return;
        }

        if (!catalogReady) {
            hideSection(section, target, "catalog-unavailable");
            selection.groups.push(groupReport("popular-game-top-up", [], "catalog-unavailable"));
            return;
        }

        const selected = selectPopularProducts(placement);

        if (!selected.length) {
            hideSection(section, target, "no-enabled-products");
            selection.groups.push(groupReport("popular-game-top-up", [], "no-enabled-products"));
            return;
        }

        target.innerHTML = selected.map(product => renderPopularGame(product, "popular-game-top-up")).join("");
        section.hidden = false;
        section.dataset.homeSelectionSource = "admin-placement";
        window.AZIEL_CATALOG_PRESENTATION?.bindImageFallbacks?.(target);

        const placedCodes = selected.map(codeOf);
        section.dataset.adminProducts = placedCodes.join(",");
        section.dataset.fallbackProducts = "";
        selection.placements.HOME_POPULAR_GAMES = placedCodes;
        selection.groups.push(groupReport("popular-game-top-up", selected, section.dataset.homeSelectionSource));
    }

    function renderAllMobileGames(products, sections, selection) {
        ["popularGameCards", "popularPcGames", "newGameCards", "newGames", "trendingGames", "popularGiftCards", "digitalServices"].forEach(id => {
            const legacy = document.getElementById(id);
            if (legacy) legacy.hidden = true;
        });

        const section = document.getElementById("allMobileGames");
        const target = document.getElementById("allMobileGamesList");
        if (!section || !target) return;

        if (!isSectionPublished(sections, "popular-game-topup")) {
            hideSection(section, target, "category-disabled");
            selection.groups.push(groupReport("all-mobile-games", [], "category-disabled"));
            return;
        }

        const selected = selectAllMobileProducts(products);

        if (!selected.length) {
            hideSection(section, target, "no-enabled-products");
            selection.groups.push(groupReport("all-mobile-games", [], "no-enabled-products"));
            return;
        }

        target.innerHTML = selected.map(product => renderAllMobileGame(product, "all-mobile-games")).join("");
        section.hidden = false;
        section.dataset.homeSelectionSource = "catalog-classification";
        window.AZIEL_CATALOG_PRESENTATION?.bindImageFallbacks?.(target);
        selection.groups.push(groupReport("all-mobile-games", selected, "catalog-classification"));
    }

    function renderSocialTopUp(products, selection) {
        const section = document.getElementById("socialTopUp");
        const target = document.getElementById("socialTopUpList");
        if (!section || !target) return;

        const selected = selectSocialProducts(products);

        if (!selected.length) {
            hideSection(section, target, "no-enabled-products");
            selection.groups.push(groupReport("social-topup", [], "no-enabled-products"));
            return;
        }

        target.innerHTML = selected.map(product => renderSocialTopUpProduct(product, "social-topup")).join("");
        section.hidden = false;
        section.dataset.homeSelectionSource = "catalog-home-placement";
        window.AZIEL_CATALOG_PRESENTATION?.bindImageFallbacks?.(target);
        selection.groups.push(groupReport("social-topup", selected, "catalog-home-placement"));
    }

    function displayProduct(product = {}) {
        const canonical = window.AZIEL_CATALOG?.getProduct?.(codeOf(product)) || product;
        return window.AZIEL_CATALOG_PRESENTATION?.buildDisplayProduct?.(canonical) || null;
    }

    function selectPopularProducts(placement = {}) {
        if (placement.managed !== true) return [];
        return uniqueProducts((placement.items || [])
            .map(displayProduct)
            .filter(product => product?.enabled !== false && product.discoverable === true && product.publicState !== "HIDDEN")
            .filter(product => product.publicCategory === "mobile"));
    }

    function selectAllMobileProducts(products = []) {
        return products.filter(product => product.enabled !== false && product.homepageEnabled === true && product.discoverable === true && product.publicState !== "HIDDEN")
            .filter(product => product.publicCategory === "mobile");
    }

    function selectSocialProducts(products = []) {
        return products.filter(product => product.enabled !== false && product.homepageEnabled === true && product.discoverable === true && product.publicState !== "HIDDEN")
            .filter(product => product.publicCategory === "social");
    }


    function categoryFallback(groupId = "") {
        return ({
            "popular-game-cards": "assets/fallbacks/game-cards.svg",
            "popular-game-top-up": "assets/fallbacks/game-topup.svg",
            "pc-games": "assets/fallbacks/pc-games.svg",
            "gift-cards": "assets/fallbacks/gift-cards.svg",
            "all-mobile-games": "assets/fallbacks/game-topup.svg",
            "social-topup": "assets/fallbacks/digital-services.svg",
            "new-game-cards": "assets/fallbacks/gift-cards.svg",
            "new-games": "assets/fallbacks/game-topup.svg",
            "digital-services": "assets/fallbacks/digital-services.svg"
        })[groupId] || "assets/fallbacks/digital-services.svg";
    }

    function presentationArtwork(product = {}, groupId = "") {
        const image = String(product.image || "");
        return !image || image.includes("assets/logo/aziel-icon") || image.includes("assets/fallbacks/")
            ? categoryFallback(groupId)
            : image;
    }

    function isSectionPublished(sections, key) {
        const section = (sections || []).find(item => String(item.key || "").toLowerCase() === key);
        return Boolean(section && String(section.status || "").toUpperCase() === "PUBLISHED");
    }

    function renderPopularGame(product, groupId = "game-top-up") {
        const artwork = presentationArtwork(product, groupId);
        const [name, type] = FEATURED_LABELS[codeOf(product)] || [product.name, productType(product)];
        return `
            <a href="${escapeAttr(homeRoute(product))}" class="popular-game-card ${stateClass(product)}" data-name="${escapeAttr(product.name)}" data-product-code="${escapeAttr(codeOf(product))}" data-product-route="${escapeAttr(product.route)}" data-commerce-state="${escapeAttr(product.commerceState)}" data-purchasable="${product.purchasable === true}">
                ${renderProductArtwork(product, artwork, groupId, "popular")}
                <span class="home-card-copy">
                    <h3>${escapeHtml(name)}</h3>
                    ${readinessBadge(product)}
                    <p data-mobile-type="${escapeAttr(type)}">${escapeHtml(type)}</p>
                </span>
                <span class="home-card-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span>
            </a>
        `;
    }

    function renderAllMobileGame(product, groupId = "all-mobile-games") {
        const artwork = presentationArtwork(product, groupId);
        const [name, type] = ALL_MOBILE_LABELS[codeOf(product)] || [product.name, productType(product)];
        return `
            <a href="${escapeAttr(homeRoute(product))}" class="home-mobile-game-tile ${stateClass(product)}" data-name="${escapeAttr(product.name)}" data-product-code="${escapeAttr(codeOf(product))}" data-purchasable="${product.purchasable === true}">
                ${renderProductArtwork(product, artwork, groupId, "tile")}
                <span>
                    <strong>${escapeHtml(name)}</strong>
                    ${readinessBadge(product)}
                    <small data-mobile-type="${escapeAttr(type)}">${escapeHtml(type)}</small>
                </span>
                <span class="home-card-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span>
            </a>
        `;
    }

    function renderSocialTopUpProduct(product, groupId = "social-topup") {
        const artwork = presentationArtwork(product, groupId);
        const [name, type] = [product.name || codeOf(product), productType(product)];
        return `
            <a href="${escapeAttr(homeRoute(product))}" class="home-mobile-game-tile home-social-product-card ${stateClass(product)}" data-name="${escapeAttr(product.name)}" data-product-code="${escapeAttr(codeOf(product))}" data-purchasable="${product.purchasable === true}">
                ${renderProductArtwork(product, artwork, groupId, "tile")}
                <span>
                    <strong>${escapeHtml(name)}</strong>
                    ${readinessBadge(product)}
                    <small data-mobile-type="${escapeAttr(type)}">${escapeHtml(type)}</small>
                </span>
                <span class="home-card-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span>
            </a>
        `;
    }

    function renderProductArtwork(product, artwork, groupId, variant = "tile") {
        const code = codeOf(product);
        if (!isGenericArtwork(artwork)) {
            return `<img src="${escapeAttr(artwork)}" alt="${escapeAttr(product.imageAltText || product.name)}" loading="lazy" decoding="async">`;
        }
        const wordmark = WORDMARK_LABELS[code] || String(product.name || code).toUpperCase();
        return `
            <span class="home-product-wordmark home-product-wordmark--${escapeAttr(variant)}" data-art-code="${escapeAttr(code)}" aria-label="${escapeAttr(product.name || wordmark)}">
                <span>${escapeHtml(wordmark)}</span>
            </span>
        `;
    }

    function isGenericArtwork(artwork = "") {
        const value = String(artwork || "");
        return !value || value.includes("assets/fallbacks/") || value.includes("assets/logo/aziel-icon");
    }

    function homeRoute(product = {}) {
        return window.AZIEL_CATALOG_PRESENTATION?.resolveProductRoute?.(product.productRoute || product.route, codeOf(product)) || "";
    }

    function stateClass(product = {}) {
        return `is-${String(product.commerceState || "HIDDEN").toLowerCase().replaceAll("_", "-")}`;
    }

    function readinessBadge(product = {}) {
        return product.publicState === "COMING_SOON" || product.commerceState === "COMING_SOON"
            ? '<span class="home-product-state">Coming Soon</span>'
            : "";
    }

    function productType(product = {}) {
        return String(product.description || product.searchDescription || "Digital product").split(/[•·]/)[0].trim();
    }

    function authoritativePrice(product = {}) {
        if (product.purchasable !== true) return null;
        const region = currentRegion();
        const prices = (product.packages || []).map(pkg => pkg.prices?.[region])
            .filter(price => price?.enabled !== false && Number(price?.amount) > 0);
        if (!prices.length) return null;
        return prices.reduce((lowest, price) => Number(price.amount) < Number(lowest.amount) ? price : lowest);
    }

    function priceMarkup(product = {}) {
        const authoritative = authoritativePrice(product);
        const price = authoritative || (product.purchasable !== true ? product.previewPrice : null);
        if (!price || !(Number(price.amount) > 0) || !price.currency) return "";
        const labels = { PREVIEW_PRICE: "Preview", ESTIMATED: "Estimated", FROM: "From", NONE: "" };
        const label = authoritative ? "From " : `${labels[price.label] ?? "Preview"}${labels[price.label] === "" ? "" : " "}`;
        return `<span class="home-product-price${authoritative ? "" : " is-preview"}">${escapeHtml(label + formatMoney(price.amount, price.currency))}</span>`;
    }

    function promotionMarkup(product = {}) {
        const price = authoritativePrice(product);
        if (!price?.showDiscount || !(Number(price.referencePrice) > Number(price.amount))) return "";
        const calculated = Math.round((1 - Number(price.amount) / Number(price.referencePrice)) * 100);
        const label = String(price.discountLabel || "").trim() || (calculated > 0 ? `${calculated}% off` : "Offer");
        return `<span class="home-product-promo">${escapeHtml(label)}</span>`;
    }

    function formatMoney(amount, currency) {
        try {
            return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: currency === "MMK" ? 0 : 2 }).format(Number(amount));
        } catch {
            return `${currency} ${Number(amount).toLocaleString()}`;
        }
    }

    function uniqueProducts(products) {
        const seen = new Set();
        return products.filter(product => {
            const code = codeOf(product);
            if (!code || seen.has(code)) return false;
            seen.add(code);
            return true;
        });
    }

    function hideSection(section, target, reason) {
        section.hidden = true;
        section.dataset.homeHiddenReason = reason;
        target.innerHTML = "";
    }

    function groupReport(id, items, source) {
        return { id, source, itemCount: items.length, productCodes: items.map(codeOf).filter(Boolean) };
    }

    function codeOf(product = {}) {
        return String(product.productCode || "").trim().toLowerCase();
    }

    function fallbackAttr(fallback = "") {
        return window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(fallback) || "";
    }

    function escapeHtml(value = "") {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function escapeAttr(value = "") {
        return escapeHtml(value);
    }

    window.AZIEL_HOME_PLACEMENT_POLICY = Object.freeze({
        selectPopularProducts,
        selectAllMobileProducts,
        selectSocialProducts
    });

    ready(() => {
        scheduleHomeRefresh();
        window.addEventListener("aziel:shopRegionChanged", () => scheduleHomeRefresh({ regionChanged: true }));
        document.addEventListener("aziel:catalog-updated", event => {
            if (event.detail?.status === "ready") scheduleHomeRefresh();
        });
    });
})();
