// Mobile-only Home category pager. Existing catalog and placement runtimes remain data owners.

(function () {
    const MOBILE_QUERY = window.matchMedia("(max-width: 768px)");
    const MAX_ITEMS = 6;
    let renderSequence = 0;
    let resizeFrame = 0;
    let mutationTimer = 0;
    let track = null;
    let dots = [];
    let pages = [];

    function ready(fn) {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
        else fn();
    }

    function t(key, fallback) {
        const translated = window.AZIEL_I18N?.t?.(key) || window.i18n?.t?.(key);
        return translated && translated !== key ? translated : fallback;
    }

    function normalizeCategory(value = "") {
        return String(value || "").trim().toLowerCase().replaceAll("_", "-");
    }

    function catalogProducts() {
        return (window.AZIEL_CATALOG?.getProducts?.() || [])
            .map(product => window.AZIEL_CATALOG_PRESENTATION?.buildDisplayProduct?.(product))
            .filter(product => product?.route && product.homepageEnabled === true)
            .filter(product => product.discoverable === true)
            .sort((a, b) => Number(a.homepageOrder || 0) - Number(b.homepageOrder || 0));
    }

    function existingPopularProducts() {
        return [...document.querySelectorAll("#popularGames .popular-game-card")].slice(0, MAX_ITEMS).map(row => ({
            route: row.getAttribute("href") || row.dataset.productRoute || "",
            name: row.querySelector("h3")?.textContent?.trim() || row.dataset.name || "",
            image: row.querySelector("img")?.getAttribute("src") || "",
            imageAltText: row.querySelector("img")?.getAttribute("alt") || "",
            fallbackImage: row.querySelector("img")?.dataset.fallbackSrc || "",
            subtitle: row.querySelector("p")?.dataset.mobileMeta || row.querySelector("p")?.textContent?.trim() || "",
            productType: row.querySelector("p")?.dataset.mobileType || row.querySelector("p")?.textContent?.trim() || "",
            priceText: row.querySelector(".home-product-price")?.textContent?.trim() || "",
            commerceState: row.dataset.commerceState || "PURCHASABLE",
            purchasable: row.dataset.purchasable !== "false"
        })).filter(product => product.route && product.name && product.image);
    }

    function giftCardProducts(products) {
        return products.filter(product => {
            const code = String(product.productCode || "").trim().toLowerCase();
            const category = normalizeCategory(product.category);
            return code !== "telegram" && (category === "gift-card" || category === "digital-card");
        }).slice(0, MAX_ITEMS);
    }

    function homeSectionProducts(products, section) {
        return products.filter(product => Array.isArray(product.homepageSections) && product.homepageSections.includes(section)).slice(0, MAX_ITEMS);
    }

    function pcGameProducts(products) {
        return products.filter(product => normalizeCategory(product.category) === "pc-game").slice(0, MAX_ITEMS);
    }

    function digitalServiceProducts(products) {
        return products.filter(product => {
            const category = normalizeCategory(product.category);
            return category === "digital-service" || category === "digital-services" || category === "service";
        }).slice(0, MAX_ITEMS);
    }

    function newGameProducts(products) {
        return products.filter(product => product.isNew === true || product.newRelease === true).slice(0, MAX_ITEMS);
    }

    function trendingProducts(products) {
        return products.filter(product => product.trending === true || product.isTrending === true).slice(0, MAX_ITEMS);
    }

    function categoryDefinitions(products) {
        return [
            {
                id: "popular-game-cards",
                title: t("popularGameCards", "Popular Game Cards"),
                route: "gift-cards.html",
                enabled: document.getElementById("popularGameCards")?.hidden !== true,
                items: homeSectionProducts(products, "POPULAR_GAME_CARDS")
            },
            {
                id: "popular-game-top-up",
                title: t("home_popular_game_topup", "Popular Game Top-Up"),
                route: "mobile-games.html",
                enabled: document.getElementById("popularGames")?.hidden !== true,
                items: homeSectionProducts(products, "POPULAR_GAME_TOPUP").length
                    ? homeSectionProducts(products, "POPULAR_GAME_TOPUP")
                    : existingPopularProducts()
            },
            {
                id: "pc-games",
                title: t("pcGames", "Popular PC Games"),
                route: "pc-games.html",
                enabled: document.getElementById("popularPcGames")?.hidden !== true,
                items: homeSectionProducts(products, "POPULAR_PC_GAMES")
            },
            {
                id: "gift-cards",
                title: t("home_popular_gift_cards", "Gift Cards"),
                route: "gift-cards.html",
                enabled: document.getElementById("popularGiftCards")?.hidden !== true,
                items: homeSectionProducts(products, "POPULAR_GIFT_CARDS")
            },
            {
                id: "new-game-cards",
                title: t("newGameCards", "New Game Cards"),
                route: "gift-cards.html",
                enabled: document.getElementById("newGameCards")?.hidden !== true,
                items: homeSectionProducts(products, "NEW_GAME_CARDS")
            },
            {
                id: "digital-services",
                title: t("digitalServices", "Digital Services"),
                route: "explore.html",
                enabled: document.getElementById("digitalServices")?.hidden !== true,
                items: homeSectionProducts(products, "DIGITAL_SERVICES")
            },
            {
                id: "new-games",
                title: t("newGames", "New Games"),
                route: "mobile-games.html",
                enabled: document.getElementById("newGames")?.hidden !== true,
                items: homeSectionProducts(products, "NEW_GAME_TOPUP")
            }
        ].filter(category => category.enabled && category.items.length);
    }

    function categoryFallback(categoryId = "") {
        return ({
            "popular-game-cards": "assets/fallbacks/game-cards.svg",
            "popular-game-top-up": "assets/fallbacks/game-topup.svg",
            "pc-games": "assets/fallbacks/pc-games.svg",
            "gift-cards": "assets/fallbacks/gift-cards.svg",
            "new-game-cards": "assets/fallbacks/gift-cards.svg",
            "digital-services": "assets/fallbacks/digital-services.svg",
            "new-games": "assets/fallbacks/game-topup.svg"
        })[categoryId] || "assets/fallbacks/digital-services.svg";
    }

    function renderProduct(product = {}, categoryId = "") {
        const categoryArtwork = categoryFallback(categoryId);
        const sourceArtwork = String(product.image || "");
        const artwork = !sourceArtwork || sourceArtwork.includes("assets/logo/aziel-icon") || sourceArtwork.includes("assets/fallbacks/")
            ? categoryArtwork
            : sourceArtwork;
        const fallback = categoryArtwork;
        const fallbackAttribute = fallback ? ` data-fallback-src="${escapeAttr(fallback)}"` : "";
        const target = window.AZIEL_CATALOG_PRESENTATION?.resolveCanonicalProductRoute?.(product.productCode, product.route) ||
            (product.purchasable === true
                ? product.route
                : `coming-soon.html?product=${encodeURIComponent(String(product.productCode || ""))}`);
        const state = String(product.commerceState || "HIDDEN").toLowerCase().replaceAll("_", "-");
        const priceText = product.priceText || productPriceText(product);
        return `
            <a class="mobile-home-product-row is-${escapeAttr(state)}" href="${escapeAttr(target)}" data-purchasable="${product.purchasable === true}">
                <span class="mobile-home-product-art">
                    <img src="${escapeAttr(artwork)}" alt="${escapeAttr(product.imageAltText || product.name)}"${fallbackAttribute}>
                </span>
                <span class="mobile-home-product-copy">
                    <strong>${escapeHtml(product.name)}</strong>
                    <small class="mobile-home-product-type">${escapeHtml(product.productType || String(product.description || "Digital product").split(/[•·]/)[0].trim())}</small>
                    ${priceText ? `<span class="mobile-home-product-price${product.purchasable === true ? "" : " is-preview"}">${escapeHtml(priceText)}</span>` : ""}
                </span>
            </a>
        `;
    }

    function productPriceText(product = {}) {
        const region = window.AZIEL?.getRegion?.() || localStorage.getItem("selectedRegion") || "MM";
        let price = null;
        let prefix = "";
        if (product.purchasable === true) {
            price = (product.packages || []).map(pkg => pkg.prices?.[region])
                .filter(item => item?.enabled !== false && Number(item?.amount) > 0)
                .sort((a, b) => Number(a.amount) - Number(b.amount))[0] || null;
        } else if (product.previewPrice?.amount > 0) {
            price = product.previewPrice;
            prefix = ({ PREVIEW_PRICE: "Preview", ESTIMATED: "Estimated", FROM: "From", NONE: "" })[price.label] ?? "Preview";
        }
        if (!price?.currency) return "";
        try {
            const value = new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency, maximumFractionDigits: price.currency === "MMK" ? 0 : 2 }).format(Number(price.amount));
            return product.purchasable === true ? `From ${value}` : (prefix ? `${prefix} ${value}` : value);
        } catch {
            return `${prefix ? `${prefix} ` : ""}${price.currency} ${Number(price.amount).toLocaleString()}`;
        }
    }

    function renderCategory(category, index) {
        return `
            <article class="mobile-home-category-page" data-category-id="${escapeAttr(category.id)}"
                aria-labelledby="mobileCategoryTitle${index}">
                <header class="mobile-home-category-head">
                    <a href="${escapeAttr(category.route)}" aria-label="${escapeAttr(`${category.title}: ${t("viewAll", "View All")}`)}">
                        <h2 id="mobileCategoryTitle${index}">${escapeHtml(category.title)}</h2>
                        <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                    </a>
                </header>
                <div class="mobile-home-product-list">
                    ${category.items.map(product => renderProduct(product, category.id)).join("")}
                </div>
            </article>
        `;
    }

    async function render() {
        if (!MOBILE_QUERY.matches) return;
        const host = document.getElementById("mobileHomeCategories");
        track = document.getElementById("mobileHomeCategoryTrack");
        const dotsBox = document.getElementById("mobileHomeCategoryDots");
        if (!host || !track || !dotsBox) return;

        const sequence = ++renderSequence;
        try {
            await window.AZIEL_CATALOG?.ensureFresh?.();
        } catch {
            // Existing static Popular Games remain a safe presentation fallback.
        }
        if (sequence !== renderSequence || !MOBILE_QUERY.matches) return;

        const categories = categoryDefinitions(catalogProducts());
        if (!categories.length) {
            host.hidden = true;
            track.innerHTML = "";
            dotsBox.innerHTML = "";
            return;
        }

        track.innerHTML = categories.map(renderCategory).join("");
        dotsBox.innerHTML = categories.map((category, index) => `
            <button type="button" aria-label="${escapeAttr(`${t("show", "Show")} ${category.title}`)}"
                aria-current="${index === 0 ? "true" : "false"}" data-category-index="${index}"></button>
        `).join("");
        host.hidden = false;
        pages = [...track.querySelectorAll(".mobile-home-category-page")];
        dots = [...dotsBox.querySelectorAll("button")];
        window.AZIEL_CATALOG_PRESENTATION?.bindImageFallbacks?.(track);
        bindControls();
        await synchronizePageHeights();
        host.dataset.renderedCategories = categories.map(category => `${category.id}:${category.items.length}`).join(",");
        document.dispatchEvent(new CustomEvent("aziel:mobile-home-categories-rendered", { detail: { categories } }));
    }

    function bindControls() {
        dots.forEach((dot, index) => {
            dot.addEventListener("click", () => track.scrollTo({
                left: Math.max(0, (pages[index]?.offsetLeft || 16) - 16),
                behavior: reducedMotion() ? "auto" : "smooth"
            }));
        });
        track.addEventListener("scroll", updateActiveDot, { passive: true });
    }

    function updateActiveDot() {
        if (!pages.length || !dots.length) return;
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
            const trackStart = track.getBoundingClientRect().left;
            let active = 0;
            let distance = Infinity;
            pages.forEach((page, index) => {
                const nextDistance = Math.abs(page.getBoundingClientRect().left - trackStart - 16);
                if (nextDistance < distance) {
                    distance = nextDistance;
                    active = index;
                }
            });
            dots.forEach((dot, index) => dot.setAttribute("aria-current", index === active ? "true" : "false"));
        });
    }

    async function synchronizePageHeights() {
        if (!track || !pages.length) return;
        pages.forEach(page => page.style.minHeight = "0px");
        await Promise.all([...track.querySelectorAll("img")].map(waitForImage));
        await document.fonts?.ready;
        await nextFrame();
        const tallest = Math.ceil(Math.max(...pages.map(page => page.scrollHeight), 0));
        pages.forEach(page => page.style.minHeight = `${tallest}px`);
        track.style.setProperty("--mobile-category-page-height", `${tallest}px`);
    }

    function waitForImage(image) {
        if (image.complete) return Promise.resolve();
        return new Promise(resolve => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
        });
    }

    function nextFrame() {
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    function reducedMotion() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function scheduleHeightSync() {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => synchronizePageHeights());
    }

    function observePopularPlacement() {
        const popular = document.querySelector("#popularGames .popular-game-grid");
        if (!popular) return;
        new MutationObserver(() => {
            clearTimeout(mutationTimer);
            mutationTimer = setTimeout(render, 80);
        }).observe(popular, { childList: true, subtree: true });
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
        if (MOBILE_QUERY.matches) render();
        observePopularPlacement();
        MOBILE_QUERY.addEventListener?.("change", event => {
            if (event.matches) render();
        });
        window.addEventListener("resize", scheduleHeightSync, { passive: true });
        window.addEventListener("aziel:shopRegionChanged", render);
        document.addEventListener("aziel:catalog-updated", event => {
            if (event.detail?.status === "ready") render();
        });
        document.addEventListener("aziel:languageChanged", render);
    });
})();
