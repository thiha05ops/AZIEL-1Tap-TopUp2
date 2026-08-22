// frontend/js/catalog-discovery.js
// Renders active customer discovery cards from the public catalog store.

(function () {
    let renderInFlight = null;

    function onReady(callback) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", callback);
        } else {
            callback();
        }
    }

    function pageName() {
        return window.location.pathname.split("/").pop() || "home.html";
    }

    function escapeHtml(value = "") {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll('"', "&quot;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
    }

    function t(key, fallback) {
        return window.AZIEL_I18N?.t?.(key) || window.i18n?.t?.(key) || fallback;
    }

    function catalogFailureMarkup() {
        return `<p class="catalog-unavailable">${escapeHtml(t("catalogUnavailable", "Catalog is temporarily unavailable. Please try again shortly."))}</p>`;
    }

    function emptyCategoryMarkup() {
        return `<p class="catalog-empty">${escapeHtml(t("catalogCategoryEmpty", "No products are available in this category yet."))}</p>`;
    }

    async function loadCatalog() {
        if (!window.AZIEL_CATALOG) throw new Error("Catalog client unavailable");
        await window.AZIEL_CATALOG.load();
        return window.AZIEL_CATALOG;
    }

    function activeProducts(category = "") {
        const products = window.AZIEL_CATALOG.getProducts();
        return products
            .filter(product => product.route)
            .filter(product => !category || (
                category === "all"
                    ? ["mobile", "pc"].includes(product.publicCategory)
                    : product.publicCategory === category
            ));
    }

    function popularProducts() {
        return activeProducts()
            .filter(product => product.homepageEnabled === true)
            .filter(product => (product.homepageSections || []).some(section => (
                ["POPULAR_MOBILE_GAMES", "POPULAR_GAME_TOPUP"].includes(String(section || "").trim().toUpperCase())
            )))
            .sort((a, b) => Number(a.homepageOrder || 0) - Number(b.homepageOrder || 0));
    }

    function renderPopularCard(product) {
        const fallback = product.fallbackImage || window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(product.productCode) || "";
        return `
            <a href="${escapeHtml(product.route)}" class="popular-game-card" data-product-code="${escapeHtml(product.productCode)}" data-name="${escapeHtml(product.name)}">
                <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async"${window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(fallback) || ""}>
                <h3>${escapeHtml(product.name)}</h3>
                <p>${escapeHtml(product.description || "Top Up")}</p>
            </a>
        `;
    }

    function renderCategoryCard(product) {
        const fallback = product.fallbackImage || window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(product.productCode) || "";
        return `
            <a href="${escapeHtml(product.route)}" data-product-code="${escapeHtml(product.productCode)}">
                <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async"${window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(fallback) || ""}>
                <span>${escapeHtml(product.name)}</span>
            </a>
        `;
    }

    function renderFeaturedCard(product) {
        const fallback = product.fallbackImage || window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(product.productCode) || "";
        return `
            <a href="${escapeHtml(product.route)}" class="az-featured-card ${escapeHtml(product.theme || "")}" data-product-code="${escapeHtml(product.productCode)}">
                <img src="${escapeHtml(normalizeImageSrc(product.image))}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async"${window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(normalizeImageSrc(fallback)) || ""}>
                <div>
                    <h3>${escapeHtml(product.name)}</h3>
                    <p>${escapeHtml(product.description || "Top Up")}</p>
                </div>
            </a>
        `;
    }

    function renderPosterCard(product) {
        const fallback = product.fallbackImage || window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(product.productCode) || "";
        return `
            <a href="${escapeHtml(product.route)}" class="az-poster-card" data-product-code="${escapeHtml(product.productCode)}">
                <img src="${escapeHtml(normalizeImageSrc(product.image))}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async"${window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(normalizeImageSrc(fallback)) || ""}>
                <h3>${escapeHtml(product.name)}</h3>
                <p>${escapeHtml(product.description || "Top Up")}</p>
            </a>
        `;
    }

    function renderHomeGameCard(product) {
        const fallback = product.fallbackImage || window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(product.productCode) || "";
        return `
            <a href="${escapeHtml(product.route)}" class="home-game-card" data-product-code="${escapeHtml(product.productCode)}">
                <img src="${escapeHtml(normalizeImageSrc(product.image))}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async"${window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(normalizeImageSrc(fallback)) || ""}>
                <div>
                    <h3>${escapeHtml(product.name)}</h3>
                    <p>${escapeHtml(product.description || "Top Up")}</p>
                </div>
            </a>
        `;
    }

    function normalizeImageSrc(src = "") {
        const value = String(src || "").trim();
        if (!value || /^https?:\/\//i.test(value) || value.startsWith("/")) return value;
        return `/${value.replace(/^\/+/, "")}`;
    }

    function renderHome() {
        const popularGrid = document.querySelector(".popular-game-grid");
        const categoryGrid = document.querySelector(".category-grid");
        const products = popularProducts();

        if (popularGrid && products.length) {
            popularGrid.innerHTML = products.map(renderPopularCard).join("");
        }

        if (categoryGrid) {
            const categoryProducts = activeProducts()
                .filter(product => ["mobile", "gift-card"].includes(product.category));

            categoryGrid.innerHTML = [
                ...categoryProducts.map(renderCategoryCard),
                `<a href="all-games.html"><span>All Games</span></a>`
            ].join("");
        }
    }

    function renderMobileGames() {
        const featuredGrid = document.querySelector(".az-featured-grid");
        const posterGrid = document.querySelector(".az-poster-grid");
        const products = activeProducts("mobile");
        const featured = products.filter(product => product.featured);
        const posters = products.filter(product => !product.featured);

        if (featuredGrid) {
            featuredGrid.innerHTML = featured.map(renderFeaturedCard).join("");
        }

        if (posterGrid) {
            posterGrid.innerHTML = products.length
                ? posters.map(renderPosterCard).join("")
                : emptyCategoryMarkup();
        }
    }

    function renderProductCategory(category) {
        const grid = document.querySelector(".home-game-grid");
        const products = activeProducts(category);
        if (!grid) return;
        grid.innerHTML = products.length
            ? products.map(renderHomeGameCard).join("")
            : emptyCategoryMarkup();
    }

    function renderCatalogFailure(page) {
        if (page === "home.html") {
            const categoryGrid = document.querySelector(".category-grid");
            if (categoryGrid) categoryGrid.innerHTML = catalogFailureMarkup();
            return;
        }
        if (page === "mobile-games.html") {
            document.querySelector(".az-featured-grid")?.replaceChildren();
            const posterGrid = document.querySelector(".az-poster-grid");
            if (posterGrid) posterGrid.innerHTML = catalogFailureMarkup();
            return;
        }
        const grid = document.querySelector(".home-game-grid");
        if (grid) grid.innerHTML = catalogFailureMarkup();
    }

    async function renderDiscovery() {
        const page = pageName();
        const supported = new Set(["home.html", "all-games.html", "mobile-games.html", "pc-games.html", "gift-cards.html", "social-topup.html"]);

        if (!supported.has(page)) return;

        try {
            await loadCatalog();
        } catch (error) {
            renderCatalogFailure(page);
            return;
        }

        if (page === "home.html") renderHome();
        if (page === "all-games.html") renderProductCategory("all");
        if (page === "mobile-games.html") renderMobileGames();
        if (page === "pc-games.html") renderProductCategory("pc");
        if (page === "gift-cards.html") renderProductCategory("gift-card");
        if (page === "social-topup.html") renderProductCategory("social");
        window.AZIEL_CATALOG_PRESENTATION?.bindImageFallbacks?.();
    }

    function scheduleDiscoveryRender() {
        if (renderInFlight) return renderInFlight;
        renderInFlight = renderDiscovery().finally(() => {
            renderInFlight = null;
        });
        return renderInFlight;
    }

    onReady(scheduleDiscoveryRender);
    document.addEventListener("aziel:catalog-updated", event => {
        if (event.detail?.status === "ready") scheduleDiscoveryRender();
    });

    window.AZIEL_CATALOG_DISCOVERY = {
        renderDiscovery,
        scheduleDiscoveryRender,
        activeProducts,
        catalogFailureMarkup,
        emptyCategoryMarkup
    };
})();
