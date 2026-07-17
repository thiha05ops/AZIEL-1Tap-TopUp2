// frontend/js/home-promotion-preview.js
// Home preview for Admin-published promotion notifications.

(function () {
    const ENDPOINT = "/api/notifications/promotions/active";
    const LIMIT = 3;

    function ready(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn);
        } else {
            fn();
        }
    }

    function apiUrl(path) {
        if (window.AZIEL?.apiUrl) return window.AZIEL.apiUrl(path);
        return path;
    }

    function authHeaders(extra = {}) {
        return window.AZIEL?.authHeaders?.(extra) || extra;
    }

    function currentRegion() {
        return (
            window.AZIEL?.getShopRegion?.() ||
            window.AZIEL?.getRegion?.() ||
            localStorage.getItem("selectedRegion") ||
            localStorage.getItem("region") ||
            "MM"
        );
    }

    async function loadPromotionPreview() {
        const panel = document.getElementById("latestPromotionsPanel");
        const list = document.getElementById("latestPromotionsList");
        const count = document.getElementById("latestPromotionsCount");
        const viewAll = document.getElementById("latestPromotionsViewAll");

        if (!panel || !list) return;

        panel.dataset.promotionPreviewState = "loading";
        list.innerHTML = renderSkeleton();
        if (viewAll) viewAll.href = "/notifications.html?filter=promotions";

        try {
            const params = new URLSearchParams({
                region: currentRegion(),
                limit: String(LIMIT)
            });
            const response = await fetch(apiUrl(`${ENDPOINT}?${params.toString()}`), {
                headers: authHeaders({ Accept: "application/json" }),
                cache: "no-store"
            });
            const data = await response.json();

            if (!response.ok || !data?.success) {
                throw new Error(data?.message || "Could not load promotions");
            }

            const promotions = Array.isArray(data.promotions) ? data.promotions : [];
            const activeCount = Number(data.count || promotions.length || 0);
            if (count) {
                count.textContent = data.countLabel || (activeCount > 9 ? "9+" : String(activeCount));
                count.hidden = activeCount <= 0;
            }

            if (!promotions.length) {
                panel.dataset.promotionPreviewState = "empty";
                list.innerHTML = `
                    <div class="promo-empty-state">
                        <strong>No active promotions</strong>
                        <span>New offers will appear here when they are published.</span>
                    </div>
                `;
                return;
            }

            panel.dataset.promotionPreviewState = "active";
            list.innerHTML = promotions.map(renderPromotionRow).join("");
            window.AZIEL_MOTION?.enter?.(list, "fast");
        } catch (error) {
            panel.dataset.promotionPreviewState = "error";
            if (count) count.hidden = true;
            list.innerHTML = `
                <div class="promo-empty-state">
                    <strong>Promotions unavailable</strong>
                    <span>Check back shortly for the latest offers.</span>
                </div>
            `;
        }
    }

    function renderPromotionRow(promotion = {}) {
        const action = safeAction(promotion.action || {
            label: promotion.ctaLabel,
            url: promotion.ctaUrl
        });
        const range = formatRange(promotion.startsAt, promotion.endsAt);

        return `
            <article class="promo-item promotion-preview-item" data-promotion-id="${escapeAttr(promotion.id)}" aria-label="${escapeAttr(promotion.title || "Promotion")}">
                <div>
                    <strong>${escapeHtml(promotion.title || "Promotion")}</strong>
                    <span>${escapeHtml(promotion.summary || promotion.message || "")}</span>
                    <small>${escapeHtml([range, promotion.promoCode ? `Code: ${promotion.promoCode}` : ""].filter(Boolean).join(" · "))}</small>
                </div>
                ${action ? `
                    <a class="promotion-preview-cta" href="${escapeAttr(action.url)}" aria-label="${escapeAttr(`${action.label || "View"} ${promotion.title || "promotion"}`)}"${action.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(action.label || "View")}</a>
                ` : ""}
                ${promotion.imageUrl ? `
                    <img class="promotion-preview-image" src="${escapeAttr(promotion.imageUrl)}" alt="" aria-hidden="true">
                ` : `
                    <i class="fa-solid fa-gift" aria-hidden="true"></i>
                `}
            </article>
        `;
    }

    function renderSkeleton() {
        return Array.from({ length: 2 }).map(() => `
            <div class="promo-item skeleton" aria-hidden="true"></div>
        `).join("");
    }

    function safeAction(action = null) {
        if (!action?.url) return null;
        const url = String(action.url || "").trim();
        if (/^\s*javascript:/i.test(url)) return null;
        if (!url.startsWith("/") && !/^[a-z0-9_-]+\.html/i.test(url) && !/^https?:\/\//i.test(url)) return null;
        return {
            label: action.label || "View",
            url,
            external: /^https?:\/\//i.test(url)
        };
    }

    function formatRange(startsAt, endsAt) {
        const start = formatDate(startsAt);
        const end = formatDate(endsAt);
        if (start && end) return `${start} - ${end}`;
        if (end) return `Ends ${end}`;
        if (start) return `Starts ${start}`;
        return "";
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

    function escapeHtml(value = "") {
        return String(value ?? "")
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
        loadPromotionPreview();
        window.addEventListener("aziel:shopRegionChanged", loadPromotionPreview);
        window.addEventListener("aziel:userChanged", loadPromotionPreview);
    });
})();
