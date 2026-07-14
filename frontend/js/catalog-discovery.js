// frontend/js/catalog-discovery.js
// Renders active customer discovery cards from the public catalog store.

(function () {
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

    function catalogUnavailableMarkup() {
        return `<p class="catalog-unavailable">${escapeHtml(t("catalogPricesUnavailable", "Prices are temporarily unavailable. Please try again shortly."))}</p>`;
    }

    async function loadCatalog() {
        if (!window.AZIEL_CATALOG) throw new Error("Catalog client unavailable");
        await window.AZIEL_CATALOG.load();
        return window.AZIEL_CATALOG;
    }

    function activeProducts(category = "") {
        return window.AZIEL_CATALOG
            .getProducts(category ? { category } : {})
            .filter(product => product.route);
    }

    function popularProducts() {
        const priority = ["mlbb", "pubg", "freefire", "hok"];
        const byCode = new Map(activeProducts().map(product => [product.productCode, product]));
        return priority.map(code => byCode.get(code)).filter(Boolean);
    }

    function featuredProducts(category = "mobile") {
        return activeProducts(category).filter(product => product.featured);
    }

    function posterProducts(category = "mobile") {
        return activeProducts(category).filter(product => !product.featured);
    }

    function renderPopularCard(product) {
        const fallback = product.fallbackImage || window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(product.productCode) || "";
        return `
            <a href="${escapeHtml(product.route)}" class="popular-game-card" data-product-code="${escapeHtml(product.productCode)}" data-name="${escapeHtml(product.name)}">
                <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}"${window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(fallback) || ""}>
                <h3>${escapeHtml(product.name)}</h3>
                <p>${escapeHtml(product.description || "Top Up")}</p>
            </a>
        `;
    }

    function renderCategoryCard(product) {
        const fallback = product.fallbackImage || window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(product.productCode) || "";
        return `
            <a href="${escapeHtml(product.route)}" data-product-code="${escapeHtml(product.productCode)}">
                <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}"${window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(fallback) || ""}>
                <span>${escapeHtml(product.name)}</span>
            </a>
        `;
    }

    function renderFeaturedCard(product) {
        const fallback = product.fallbackImage || window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(product.productCode) || "";
        return `
            <a href="${escapeHtml(product.route)}" class="az-featured-card ${escapeHtml(product.theme || "")}" data-product-code="${escapeHtml(product.productCode)}">
                <img src="${escapeHtml(normalizeImageSrc(product.image))}" alt="${escapeHtml(product.name)}"${window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(normalizeImageSrc(fallback)) || ""}>
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
                <img src="${escapeHtml(normalizeImageSrc(product.image))}" alt="${escapeHtml(product.name)}"${window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(normalizeImageSrc(fallback)) || ""}>
                <h3>${escapeHtml(product.name)}</h3>
                <p>${escapeHtml(product.description || "Top Up")}</p>
            </a>
        `;
    }

    function renderHomeGameCard(product) {
        const fallback = product.fallbackImage || window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(product.productCode) || "";
        return `
            <a href="${escapeHtml(product.route)}" class="home-game-card" data-product-code="${escapeHtml(product.productCode)}">
                <img src="${escapeHtml(normalizeImageSrc(product.image))}" alt="${escapeHtml(product.name)}"${window.AZIEL_CATALOG_PRESENTATION?.imageFallbackAttributes?.(normalizeImageSrc(fallback)) || ""}>
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
                `<a href="mobile-games.html"><span>All Games</span></a>`
            ].join("");
        }
    }

    function renderMobileGames() {
        const featuredGrid = document.querySelector(".az-featured-grid");
        const posterGrid = document.querySelector(".az-poster-grid");
        const featured = featuredProducts("mobile");
        const posters = posterProducts("mobile");

        if (featuredGrid) {
            featuredGrid.innerHTML = featured.length
                ? featured.map(renderFeaturedCard).join("")
                : catalogUnavailableMarkup();
        }

        if (posterGrid) {
            posterGrid.innerHTML = posters.length
                ? posters.map(renderPosterCard).join("")
                : "";
        }
    }

    function renderPcGames() {
        const grid = document.querySelector(".home-game-grid");
        const products = activeProducts("pc");
        if (!grid || !products.length) return;
        grid.innerHTML = products.map(renderHomeGameCard).join("");
    }

    function renderGiftCards() {
        const grid = document.querySelector(".home-game-grid");
        const products = activeProducts("gift-card");
        if (!grid) return;
        grid.innerHTML = products.length
            ? products.map(renderHomeGameCard).join("")
            : catalogUnavailableMarkup();
    }

    async function renderDiscovery() {
        const page = pageName();
        const supported = new Set(["home.html", "mobile-games.html", "pc-games.html", "gift-cards.html"]);

        if (!supported.has(page)) return;

        try {
            await loadCatalog();
        } catch (error) {
            if (page === "mobile-games.html") {
                document.querySelector(".az-featured-grid")?.replaceChildren();
                const posterGrid = document.querySelector(".az-poster-grid");
                if (posterGrid) posterGrid.innerHTML = catalogUnavailableMarkup();
            }
            return;
        }

        if (page === "home.html") renderHome();
        if (page === "mobile-games.html") renderMobileGames();
        if (page === "pc-games.html") renderPcGames();
        if (page === "gift-cards.html") renderGiftCards();
        window.AZIEL_CATALOG_PRESENTATION?.bindImageFallbacks?.();
    }

    onReady(renderDiscovery);
    document.addEventListener("aziel:catalog-updated", event => {
        if (event.detail?.status === "ready") renderDiscovery();
    });

    window.AZIEL_CATALOG_DISCOVERY = {
        renderDiscovery,
        activeProducts
    };
})();
