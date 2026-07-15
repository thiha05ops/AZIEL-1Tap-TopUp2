// frontend/js/home-placement-runtime.js
// Runtime owner for Admin-managed Home placement membership and order.

(function () {
    const API_URL = "/api/site-placements/home";
    const PLACEMENT_SELECTORS = {
        HOME_POPULAR_GAMES: {
            section: "#popularGames",
            target: "#popularGames .popular-game-grid",
            render: renderPopularGames
        },
        HOME_TOPUP_SHORTCUTS: {
            section: "#topUpCategoriesPanel",
            target: "#topUpCategoryGrid",
            render: renderTopUpShortcuts
        },
        HOME_LATEST_PROMOTIONS: {
            section: "#latestPromotionsPanel",
            target: "#latestPromotionsList",
            render: renderLatestPromotions
        }
    };

    function ready(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn);
        } else {
            fn();
        }
    }

    function currentRegion() {
        return (
            window.AZIEL?.getRegion?.() ||
            localStorage.getItem("selectedRegion") ||
            localStorage.getItem("region") ||
            "MM"
        );
    }

    async function loadHomePlacements() {
        try {
            const params = new URLSearchParams({ region: currentRegion() });
            const response = await fetch(`${API_URL}?${params.toString()}`, {
                headers: { Accept: "application/json" },
                cache: "no-store"
            });
            const data = await response.json();

            if (!response.ok || !data?.success || !data.placements) return;

            Object.entries(PLACEMENT_SELECTORS).forEach(([placementCode, config]) => {
                applyPlacement(config, data.placements[placementCode]);
            });
        } catch (error) {
            // Keep source-code static fallback when managed placement data is unavailable.
        }
    }

    function applyPlacement(config, placement = {}) {
        if (placement.managed !== true) return;

        const section = document.querySelector(config.section);
        const target = document.querySelector(config.target);
        if (!section || !target) return;

        const items = Array.isArray(placement.items) ? placement.items : [];
        if (!items.length) {
            section.hidden = true;
            section.setAttribute("data-site-placement-managed", "empty");
            target.innerHTML = "";
            return;
        }

        section.hidden = false;
        section.setAttribute("data-site-placement-managed", "active");
        target.innerHTML = config.render(items);
        window.AZIEL_CATALOG_PRESENTATION?.bindImageFallbacks?.(target);
    }

    function displayProduct(product = {}) {
        const display = window.AZIEL_CATALOG_PRESENTATION?.buildDisplayProduct?.(product);
        if (display) return display;

        const productCode = String(product.productCode || "").trim().toLowerCase();
        const route = window.AZIEL_CATALOG_PRESENTATION?.getProductRoute?.(productCode) || "";
        if (!route) return null;

        const fallbackImage = window.AZIEL_CATALOG_PRESENTATION?.getProductImage?.(productCode) || product.imageUrl || "";
        return {
            ...product,
            route,
            image: product.imageUrl || fallbackImage,
            fallbackImage,
            description: "Top Up"
        };
    }

    function renderPopularGames(items = []) {
        return items.map(displayProduct).filter(Boolean).map(product => `
            <a href="${escapeAttr(product.route)}" class="popular-game-card" data-name="${escapeAttr(product.name)}">
                <img src="${escapeAttr(product.image)}" alt="${escapeAttr(product.imageAltText || product.name)}"${fallbackAttr(product.fallbackImage)}>
                <h3>${escapeHtml(product.name)}</h3>
                <p>${escapeHtml(product.description || "Top Up")}</p>
            </a>
        `).join("");
    }

    function renderTopUpShortcuts(items = []) {
        return items.map(displayProduct).filter(Boolean).map(product => `
            <a href="${escapeAttr(product.route)}">
                <img src="${escapeAttr(product.image)}" alt="${escapeAttr(product.imageAltText || product.name)}"${fallbackAttr(product.fallbackImage)}>
                <span>${escapeHtml(product.name)}</span>
            </a>
        `).join("");
    }

    function renderLatestPromotions(items = []) {
        return items.map(promo => `
            <div class="promo-item" data-promo-code="${escapeAttr(promo.promoCode)}">
                <div>
                    <strong>${escapeHtml(promo.name || promo.promoCode)}</strong>
                    <span>${escapeHtml(promo.discountLabel || promo.promoCode || "Promo")}</span>
                    <small>${escapeHtml(formatPromoWindow(promo))}</small>
                </div>
                <i class="fa-solid fa-ticket"></i>
            </div>
        `).join("");
    }

    function formatPromoWindow(promo = {}) {
        const starts = formatDate(promo.startsAt);
        const ends = formatDate(promo.endsAt);
        if (starts && ends) return `${starts} - ${ends}`;
        if (ends) return `Ends ${ends}`;
        if (starts) return `Starts ${starts}`;
        return promo.promoCode || "Active promo";
    }

    function formatDate(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric"
        });
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
        loadHomePlacements();
        window.addEventListener("aziel:shopRegionChanged", loadHomePlacements);
    });
})();
