// Home catalog selection: admin placement first, then enabled-catalog curated fallback.

(function () {
    const API_URL = "/api/site-placements/home";
    const FEATURED_MAX_ITEMS = 6;
    const ALL_MOBILE_MAX_ITEMS = 14;
    const SOCIAL_TOPUP_MAX_ITEMS = 2;
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

        renderPopularGames(products, placements?.HOME_POPULAR_GAMES, sections, selection, catalogReady);
        renderAllMobileGames(products, sections, selection);
        renderSocialTopUp(products, selection);

        lastSelection = selection;
        window.AZIEL_HOME_SELECTION = Object.freeze({
            getSnapshot: () => JSON.parse(JSON.stringify(lastSelection)),
            refresh: refreshHomeCatalog
        });
        document.dispatchEvent(new CustomEvent("aziel:home-groups-updated", {
            detail: JSON.parse(JSON.stringify(selection))
        }));
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

    function renderPopularGames(products, placement, sections, selection, catalogReady) {
        const section = document.getElementById("popularGames");
        const target = section?.querySelector(".popular-game-grid");
        if (!section || !target) return;

        if (!isSectionPublished(sections, "popular-game-topup")) {
            hideSection(section, target, "category-disabled");
            selection.groups.push(groupReport("popular-game-top-up", [], "category-disabled"));
            return;
        }

        if (placement?.managed === true && !(placement.items || []).length) {
            hideSection(section, target, "admin-disabled");
            selection.placements.HOME_POPULAR_GAMES = [];
            selection.groups.push(groupReport("popular-game-top-up", [], "admin-disabled"));
            return;
        }

        if (!catalogReady && !placement) {
            const staticItems = readRenderedProducts(target);
            section.hidden = !staticItems.length;
            selection.groups.push(groupReport("popular-game-top-up", staticItems, "static-fallback"));
            return;
        }

        const popularCodes = canonicalHomeCodes("popularMobileGames");
        const productPool = approvedProducts(products, popularCodes);
        const approvedCodes = new Set(popularCodes);
        const placed = placement?.managed === true
            ? (placement.items || []).map(displayProduct).filter(product => approvedCodes.has(codeOf(product)) && product.discoverable === true)
            : [];
        const selected = exactOrderedProducts([
            ...placed,
            ...productPool
        ], popularCodes).slice(0, FEATURED_MAX_ITEMS);

        if (!selected.length) {
            hideSection(section, target, "no-enabled-products");
            selection.groups.push(groupReport("popular-game-top-up", [], "no-enabled-products"));
            return;
        }

        target.innerHTML = selected.map(product => renderPopularGame(product, "popular-game-top-up")).join("");
        section.hidden = false;
        section.dataset.homeSelectionSource = placed.length ? "admin-plus-fallback" : "curated-fallback";
        window.AZIEL_CATALOG_PRESENTATION?.bindImageFallbacks?.(target);

        const placedCodes = placed.map(codeOf);
        const fallbackCodes = selected.map(codeOf).filter(code => !placedCodes.includes(code));
        section.dataset.adminProducts = placedCodes.join(",");
        section.dataset.fallbackProducts = fallbackCodes.join(",");
        selection.placements.HOME_POPULAR_GAMES = placedCodes;
        selection.fallbackProducts.push(...fallbackCodes);
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

        const mobileCodes = canonicalHomeCodes("mobileGames");
        const selected = exactOrderedProducts(approvedProducts(products, mobileCodes), mobileCodes)
            .slice(0, ALL_MOBILE_MAX_ITEMS);

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

        const socialCodes = canonicalHomeCodes("socialTopUp");
        const selected = exactOrderedProducts(approvedProducts(products, socialCodes), socialCodes)
            .slice(0, SOCIAL_TOPUP_MAX_ITEMS);

        if (!selected.length) {
            hideSection(section, target, "no-enabled-products");
            selection.groups.push(groupReport("social-topup", [], "no-enabled-products"));
            return;
        }

        target.innerHTML = selected.map(product => renderSocialTopUpProduct(product, "social-topup")).join("");
        section.hidden = false;
        section.dataset.homeSelectionSource = "canonical-catalog";
        window.AZIEL_CATALOG_PRESENTATION?.bindImageFallbacks?.(target);
        selection.groups.push(groupReport("social-topup", selected, "canonical-catalog"));
    }

    function approvedProducts(products, codes = []) {
        const byCode = new Map(products.map(product => [codeOf(product), product]));
        return codes
            .map(code => byCode.get(code))
            .filter(product => product?.discoverable === true && product.publicState !== "HIDDEN");
    }

    function exactOrderedProducts(products, codes = []) {
        const byCode = new Map(products.map(product => [codeOf(product), product]).filter(([code]) => codes.includes(code)));
        return codes.map(code => byCode.get(code)).filter(Boolean);
    }

    function presentationRecord(code) {
        return window.AZIEL_CATALOG_PRESENTATION?.getHomePresentationRecord?.(code) || null;
    }

    function canonicalHomeCodes(group = "") {
        return window.AZIEL_CATALOG_PRESENTATION?.getCanonicalHomeProductCodes?.(group) || [];
    }

    function displayProduct(product = {}) {
        return window.AZIEL_CATALOG_PRESENTATION?.buildDisplayProduct?.(product) || null;
    }

    function isMobileGameProduct(product = null) {
        return Boolean(product) && ["mobile", "game", "game-top-up", "mobile-game-topup", "mobile-game"].includes(categoryOf(product));
    }

    function inHomeSection(product = {}, section = "") {
        return Array.isArray(product.homepageSections) && product.homepageSections.includes(section);
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
            return `<img src="${escapeAttr(artwork)}" alt="${escapeAttr(product.imageAltText || product.name)}">`;
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
        const canonicalRoute = window.AZIEL_CATALOG_PRESENTATION?.resolveCanonicalProductRoute?.(codeOf(product), product.route) || product.route;
        if (canonicalRoute) return canonicalRoute;
        if (product.purchasable === true) return product.route;
        return `coming-soon.html?product=${encodeURIComponent(codeOf(product))}`;
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

    function readRenderedProducts(target) {
        return [...target.querySelectorAll("a[data-product-code], a[data-name]")].map(item => ({
            productCode: item.dataset.productCode || item.dataset.name || "",
            name: item.querySelector("h3, strong")?.textContent?.trim() || item.dataset.name || ""
        }));
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

    function categoryOf(product = {}) {
        return String(product.category || "").trim().toLowerCase().replaceAll("_", "-");
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

    ready(() => {
        refreshHomeCatalog();
        window.addEventListener("aziel:shopRegionChanged", refreshHomeCatalog);
        document.addEventListener("aziel:catalog-updated", event => {
            if (event.detail?.status === "ready") refreshHomeCatalog();
        });
    });
})();
