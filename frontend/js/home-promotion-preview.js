// frontend/js/home-promotion-preview.js
// Artwork-first Home promotions sourced from Admin-published notifications.

(function () {
    const ENDPOINT = "/api/notifications/promotions/active";
    const LIMIT = 8;

    function ready(fn) {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
        else fn();
    }

    function apiUrl(path) {
        return window.AZIEL?.apiUrl ? window.AZIEL.apiUrl(path) : path;
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
        const section = document.getElementById("newsPromotions");
        const panel = document.getElementById("latestPromotionsPanel");
        const list = document.getElementById("latestPromotionsList");
        const viewAll = document.getElementById("latestPromotionsViewAll");
        if (!section || !panel || !list) return;

        section.hidden = true;
        panel.dataset.promotionPreviewState = "loading";
        list.innerHTML = "";
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
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data?.success !== true) throw new Error(data?.message || "Could not load promotions");

            const promotions = (Array.isArray(data.promotions) ? data.promotions : [])
                .filter(promotion => String(promotion.imageUrl || "").trim())
                .slice(0, LIMIT);

            if (!promotions.length) {
                panel.dataset.promotionPreviewState = "empty";
                return;
            }

            list.innerHTML = promotions.map(renderPromotionCard).join("");
            panel.dataset.promotionPreviewState = "active";
            section.hidden = false;
            window.AZIEL_MOTION?.enter?.(list, "fast");
        } catch {
            panel.dataset.promotionPreviewState = "error";
            list.innerHTML = "";
            section.hidden = true;
        }
    }

    function renderPromotionCard(promotion = {}) {
        const action = safeAction(promotion.action || { label: promotion.ctaLabel, url: promotion.ctaUrl });
        const body = `
            <img src="${escapeAttr(promotion.imageUrl)}" alt="${escapeAttr(promotion.imageAltText || promotion.title || "AZIEL promotion")}" loading="lazy" decoding="async">
            <strong>${escapeHtml(promotion.title || "AZIEL promotion")}</strong>
            ${promotion.summary ? `<p>${escapeHtml(promotion.summary)}</p>` : ""}
            <small>${escapeHtml(formatRange(promotion.startsAt, promotion.endsAt) || "Limited time")}</small>
        `;
        return action
            ? `<a class="home-promotion-card" href="${escapeAttr(action.url)}"${action.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${body}</a>`
            : `<article class="home-promotion-card">${body}</article>`;
    }

    function safeAction(action = null) {
        if (!action?.url) return null;
        const url = String(action.url || "").trim();
        if (/^\s*(javascript|data|vbscript):/i.test(url)) return null;
        if (!url.startsWith("/") && !/^[a-z0-9_-]+\.html/i.test(url) && !/^https?:\/\//i.test(url)) return null;
        return {
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
        return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
