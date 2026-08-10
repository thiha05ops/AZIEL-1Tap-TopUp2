/* =========================
   AZIEL PUBLIC STOREFRONT SEARCH
========================= */

(function () {
    if (window.AZIEL_SEARCH) {
        window.dispatchEvent(new Event("aziel:searchReady"));
        return;
    }

    const RECENT_KEY = "azielRecentSearches";
    const SEARCH_LIMIT = 8;
    const DEBOUNCE_MS = 160;
    const t = (key, fallback, params = {}) => window.AZIEL_I18N?.t?.(key, fallback, params) || fallback;

    const state = {
        open: false,
        query: "",
        loading: false,
        error: "",
        activeIndex: -1,
        results: [],
        index: [],
        lastFocused: null,
        debounceTimer: null
    };

    const staticResults = () => [
        item(t("search.mobileGames", "Mobile Games"), t("search.category", "Category"), t("search.mobileGamesHelp", "Browse mobile game top-ups"), "mobile-games.html", "mobile"),
        item(t("search.pcGames", "PC Games"), t("search.category", "Category"), t("search.pcGamesHelp", "Browse PC game services"), "pc-games.html", "desktop"),
        item(t("search.giftCards", "Gift Cards"), t("search.category", "Category"), t("search.giftCardsHelp", "Browse gift cards"), "gift-cards.html", "gift"),
        item(t("search.socialTopUp", "Social Top Up"), t("search.category", "Category"), t("search.socialTopUpHelp", "Telegram and social services"), "social-topup.html", "telegram"),
        item(t("search.supportCenter", "Support Center"), t("search.support", "Support"), t("search.supportHelp", "Get help with orders, payments, wallet, and account issues"), "support.html", "support"),
        item(t("search.faq", "FAQ"), t("search.support", "Support"), t("search.faqHelp", "Common questions and answers"), "faq.html", "help"),
        item(t("search.contact", "Contact"), t("search.company", "Company"), t("search.contactHelp", "General and business inquiries"), "contact.html", "message")
    ];

    function item(title, category, subtitle, url, icon = "search", image = "") {
        return {
            id: `${category}:${title}:${url}`.toLowerCase(),
            title,
            category,
            subtitle,
            url,
            icon,
            image,
            keywords: [title, category, subtitle, url].join(" ").toLowerCase()
        };
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

    function ensureOverlay() {
        let overlay = document.getElementById("azSearchOverlay");
        if (overlay) return overlay;

        overlay = document.createElement("div");
        overlay.id = "azSearchOverlay";
        overlay.className = "az-search-overlay";
        overlay.setAttribute("aria-hidden", "true");
        overlay.innerHTML = `
            <div class="az-search-backdrop" data-search-close></div>
            <section class="az-search-panel" role="dialog" aria-modal="true" aria-labelledby="azSearchTitle" aria-describedby="azSearchHint">
                <div class="az-search-head">
                    <div class="az-search-input-shell">
                        <i class="fa-solid fa-magnifying-glass"></i>
                        <label id="azSearchTitle" class="sr-only" for="azSearchInput">${escapeHtml(t("search.title", "Search AZIEL"))}</label>
                        <p id="azSearchHint" class="sr-only">${escapeHtml(t("search.keyboardHelp", "Use arrow keys to move through results, Enter to open a result, and Escape to close search."))}</p>
                        <input id="azSearchInput" type="text" inputmode="search" autocomplete="off" spellcheck="false" placeholder="${escapeAttr(t("search.placeholder", "Search games, gift cards..."))}" role="searchbox" aria-autocomplete="list" aria-controls="azSearchBody" aria-expanded="false">
                        <button id="azSearchClearBtn" class="az-search-clear" type="button" aria-label="${escapeAttr(t("search.clear", "Clear search"))}" hidden>
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <button id="azSearchCloseBtn" class="az-search-close" type="button" aria-label="${escapeAttr(t("search.close", "Close search"))}">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div id="azSearchBody" class="az-search-body" role="listbox" aria-label="${escapeAttr(t("search.results", "Search results"))}"></div>
            </section>
        `;
        document.body.appendChild(overlay);
        bindOverlay(overlay);
        return overlay;
    }

    function bindOverlay(overlay) {
        overlay.querySelector("#azSearchInput")?.addEventListener("input", event => {
            state.query = event.target.value.trim();
            scheduleSearch();
        });

        updatePlaceholder(overlay);
        const compactPlaceholderQuery = typeof window.matchMedia === "function"
            ? window.matchMedia("(max-width: 360px)")
            : null;
        if (compactPlaceholderQuery && compactPlaceholderQuery.addEventListener) {
            compactPlaceholderQuery.addEventListener("change", () => updatePlaceholder(overlay));
        } else if (compactPlaceholderQuery && compactPlaceholderQuery.addListener) {
            compactPlaceholderQuery.addListener(() => updatePlaceholder(overlay));
        }

        overlay.querySelector("#azSearchClearBtn")?.addEventListener("click", () => {
            const input = overlay.querySelector("#azSearchInput");
            input.value = "";
            state.query = "";
            state.activeIndex = -1;
            render();
            input.focus();
        });

        overlay.querySelector("#azSearchCloseBtn")?.addEventListener("click", close);
        overlay.querySelector("[data-search-close]")?.addEventListener("click", close);

        overlay.addEventListener("click", event => {
            const result = event.target.closest("[data-search-result]");
            if (!result) return;

            const url = result.getAttribute("href");
            const title = result.dataset.title || "";
            if (title) saveRecent(title);
            close();
            if (url) window.location.href = url;
            event.preventDefault();
        });

        overlay.addEventListener("keydown", event => {
            if (event.key === "Tab") {
                trapFocus(event, overlay);
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                close();
                return;
            }

            if (event.key === "ArrowDown") {
                event.preventDefault();
                moveActive(1);
                return;
            }

            if (event.key === "ArrowUp") {
                event.preventDefault();
                moveActive(-1);
                return;
            }

            if (event.key === "Enter") {
                const active = getResultLinks()[state.activeIndex];
                if (active) {
                    event.preventDefault();
                    active.click();
                }
            }
        });
    }

    async function buildIndex() {
        const results = [...staticResults()];

        try {
            await ensureCatalogRuntime();
            await window.AZIEL_CATALOG?.load?.();
            const products = window.AZIEL_CATALOG?.getProducts?.() || [];
            products
                .filter(product => product.route)
                .forEach(product => {
                    const category = product.category === "pc"
                            ? t("search.pcGames", "PC Games")
                        : product.category === "gift_card"
                                ? t("search.giftCards", "Gift Cards")
                            : product.category === "social"
                                    ? t("search.socialTopUp", "Social Top Up")
                                : t("search.games", "Games");
                    results.push(item(
                        product.name || product.productCode,
                        category,
                        product.searchDescription || product.description || t("search.topUp", "Top Up"),
                        product.route,
                        "game",
                        window.AZIEL_CATALOG_PRESENTATION?.resolveProductImage?.(product) || product.image || ""
                    ));
                });
        } catch (error) {
            state.error = t("search.catalogPartial", "Catalog search is partially unavailable.");
        }

        try {
            const params = new URLSearchParams({ region: currentRegion(), limit: "6" });
            const response = await fetch(apiUrl(`/api/notifications/promotions/active?${params.toString()}`), {
                headers: authHeaders({ Accept: "application/json" }),
                cache: "no-store"
            });
            const data = await response.json();
            if (response.ok && data?.success) {
                (data.promotions || []).forEach(promotion => {
                    results.push(item(
                        promotion.title || t("search.promotion", "Promotion"),
                        t("search.promotions", "Promotions"),
                        promotion.summary || promotion.message || t("search.activeOffer", "Active offer"),
                        promotion.ctaUrl || "/notifications.html?filter=promotions",
                        "gift",
                        promotion.imageUrl || ""
                    ));
                });
            }
        } catch (error) {
            // Promotions are optional in search; catalog/support results still render.
        }

        state.index = uniqueByUrlTitle(results);
        return state.index;
    }

    async function ensureCatalogRuntime() {
        if (window.AZIEL_CATALOG) return;
        await loadScriptOnce("/js/catalog-presentation.js?v=20260714-phase7", "aziel-catalog-presentation");
        await loadScriptOnce("/js/catalog-runtime.js?v=20260714-phase7", "aziel-catalog-runtime");
    }

    function loadScriptOnce(src, key) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[data-${key}="true"]`) || document.querySelector(`script[src^="${src.split("?")[0]}"]`)) {
                resolve();
                return;
            }

            const script = document.createElement("script");
            script.src = src;
            script.setAttribute(`data-${key}`, "true");
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function uniqueByUrlTitle(results) {
        const seen = new Set();
        return results.filter(result => {
            const key = `${result.url}:${result.title}`.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async function open(trigger = null) {
        const overlay = ensureOverlay();
        state.lastFocused = trigger || document.activeElement;
        state.open = true;
        state.query = "";
        state.activeIndex = -1;
        state.loading = !state.index.length;
        document.body.classList.add("az-search-open");
        overlay.classList.add("show");
        overlay.setAttribute("aria-hidden", "false");
        const input = overlay.querySelector("#azSearchInput");
        updatePlaceholder(overlay);
        input.value = "";
        input.setAttribute("aria-expanded", "true");
        input.removeAttribute("aria-activedescendant");
        render();

        if (!state.index.length) {
            await buildIndex().catch(() => {});
        }

        state.loading = false;
        render();
        requestAnimationFrame(() => overlay.querySelector("#azSearchInput")?.focus());
    }

    function close() {
        const overlay = document.getElementById("azSearchOverlay");
        if (!overlay) return;

        state.open = false;
        state.activeIndex = -1;
        document.body.classList.remove("az-search-open");
        overlay.classList.remove("show");
        overlay.setAttribute("aria-hidden", "true");
        const input = overlay.querySelector("#azSearchInput");
        input?.setAttribute("aria-expanded", "false");
        input?.removeAttribute("aria-activedescendant");

        if (state.lastFocused?.focus) {
            state.lastFocused.focus({ preventScroll: true });
        }
    }

    function scheduleSearch() {
        clearTimeout(state.debounceTimer);
        state.loading = true;
        render();
        state.debounceTimer = setTimeout(() => {
            state.loading = false;
            state.activeIndex = -1;
            render();
        }, DEBOUNCE_MS);
    }

    function getResults() {
        const query = state.query.toLowerCase();
        if (!query) return [];

        return state.index
            .map(result => ({
                ...result,
                score: scoreResult(result, query)
            }))
            .filter(result => result.score > 0)
            .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
            .slice(0, SEARCH_LIMIT);
    }

    function scoreResult(result, query) {
        const title = result.title.toLowerCase();
        const category = result.category.toLowerCase();
        if (title === query) return 100;
        if (title.startsWith(query)) return 80;
        if (title.includes(query)) return 60;
        if (category.includes(query)) return 45;
        if (result.keywords.includes(query)) return 25;
        return 0;
    }

    function render() {
        const body = document.getElementById("azSearchBody");
        const clear = document.getElementById("azSearchClearBtn");
        const input = document.getElementById("azSearchInput");
        if (!body) return;

        if (clear) {
            clear.hidden = !state.query;
            clear.setAttribute("aria-label", t("search.clear", "Clear search"));
        }
        input?.setAttribute("aria-expanded", state.open ? "true" : "false");

        if (state.loading) {
            body.innerHTML = renderSkeletons();
            input?.removeAttribute("aria-activedescendant");
            return;
        }

        if (!state.query) {
            body.innerHTML = renderIdle();
            bindRecentButtons();
            updateActive();
            return;
        }

        const results = getResults();
        state.results = results;

        if (!results.length) {
            body.innerHTML = renderEmptyState();
            input?.removeAttribute("aria-activedescendant");
            return;
        }

        body.innerHTML = `
            <div class="az-search-section-label">${escapeHtml(t("search.resultsShort", "Results"))}</div>
            ${results.map((result, index) => renderResult(result, index)).join("")}
        `;
        updateActive();
    }

    function renderIdle() {
        const recent = getRecent();
        const suggested = state.index.slice(0, 5);

        return `
            ${recent.length ? `
                <div class="az-search-section-label">${escapeHtml(t("search.recent", "Recent"))}</div>
                <div class="az-search-recents">
                    ${recent.map(value => `<button type="button" data-recent-search="${escapeAttr(value)}">${escapeHtml(value)}</button>`).join("")}
                </div>
            ` : ""}
            <div class="az-search-section-label">${escapeHtml(t("search.suggestions", "Suggestions"))}</div>
            ${suggested.map((result, index) => renderResult(result, index)).join("")}
        `;
    }

    function renderResult(result, index) {
        return `
            <a id="azSearchResult-${index}" class="az-search-result" href="${escapeAttr(result.url)}" data-search-result data-title="${escapeAttr(result.title)}" role="option" aria-selected="${index === state.activeIndex ? "true" : "false"}">
                ${result.image ? `
                    <img src="${escapeAttr(result.image)}" alt="">
                ` : `
                    <span class="az-search-result-icon">${iconFor(result.icon, result.category)}</span>
                `}
                <span>
                    <strong>${escapeHtml(result.title)}</strong>
                    <small>${escapeHtml(result.category)} · ${escapeHtml(result.subtitle)}</small>
                </span>
                <i class="fa-solid fa-arrow-right"></i>
            </a>
        `;
    }

    function renderSkeletons() {
        return `
            <div class="az-search-section-label">${escapeHtml(t("search.searching", "Searching"))}</div>
            ${Array.from({ length: 4 }).map(() => `
                <div class="az-search-result skeleton" aria-hidden="true">
                    <span class="az-search-result-icon"></span>
                    <span>
                        <strong></strong>
                        <small></small>
                    </span>
                </div>
            `).join("")}
        `;
    }

    function renderEmptyState() {
        return `
            <div class="az-empty-state az-search-empty">
                <i class="fa-solid fa-magnifying-glass"></i>
                <strong>${escapeHtml(t("search.noResults", "No results found"))}</strong>
                <span>${escapeHtml(t("search.trySearching", "Try searching for:"))}</span>
                <ul class="az-search-empty-list">
                    <li>Mobile Legends</li>
                    <li>PUBG</li>
                    <li>Google Play</li>
                    <li>Weekly Pass</li>
                </ul>
            </div>
        `;
    }

    function updatePlaceholder(overlay = document.getElementById("azSearchOverlay")) {
        const input = overlay ? overlay.querySelector("#azSearchInput") : null;
        if (!input) return;
        const compact = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 360px)").matches;
        input.placeholder = compact ? t("search.placeholderCompact", "Search games...") : t("search.placeholder", "Search games, gift cards...");
    }

    function bindRecentButtons() {
        document.querySelectorAll("[data-recent-search]").forEach(btn => {
            btn.addEventListener("click", () => {
                const input = document.getElementById("azSearchInput");
                state.query = btn.dataset.recentSearch || "";
                input.value = state.query;
                scheduleSearch();
                input.focus();
            });
        });
    }

    function moveActive(delta) {
        const links = getResultLinks();
        if (!links.length) return;
        state.activeIndex = (state.activeIndex + delta + links.length) % links.length;
        updateActive();
        links[state.activeIndex]?.scrollIntoView({ block: "nearest" });
    }

    function updateActive() {
        const input = document.getElementById("azSearchInput");
        getResultLinks().forEach((link, index) => {
            link.classList.toggle("active", index === state.activeIndex);
            link.setAttribute("aria-selected", index === state.activeIndex ? "true" : "false");
        });
        const active = getResultLinks()[state.activeIndex];
        if (active) {
            input?.setAttribute("aria-activedescendant", active.id);
        } else {
            input?.removeAttribute("aria-activedescendant");
        }
    }

    function getResultLinks() {
        return Array.from(document.querySelectorAll("#azSearchBody [data-search-result]"));
    }

    function trapFocus(event, overlay) {
        if (!state.open) return;
        const panel = overlay.querySelector(".az-search-panel");
        if (!panel) return;

        const focusable = Array.from(panel.querySelectorAll([
            "a[href]",
            "button:not([disabled]):not([hidden])",
            "input:not([disabled])",
            "[tabindex]:not([tabindex='-1'])"
        ].join(","))).filter(element => element.offsetParent !== null);

        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus({ preventScroll: true });
            return;
        }

        if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
    }

    function getRecent() {
        try {
            return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 5);
        } catch {
            return [];
        }
    }

    function saveRecent(value) {
        const clean = String(value || "").trim();
        if (!clean) return;
        const next = [clean, ...getRecent().filter(item => item !== clean)].slice(0, 6);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    }

    function iconFor(icon, category) {
        const value = `${icon} ${category}`.toLowerCase();
        if (value.includes("mobile")) return '<i class="fa-solid fa-mobile-screen-button"></i>';
        if (value.includes("desktop") || value.includes("pc")) return '<i class="fa-solid fa-desktop"></i>';
        if (value.includes("gift") || value.includes("promo")) return '<i class="fa-solid fa-gift"></i>';
        if (value.includes("support") || value.includes("help")) return '<i class="fa-solid fa-headset"></i>';
        if (value.includes("telegram")) return '<i class="fa-brands fa-telegram"></i>';
        if (value.includes("orders")) return '<i class="fa-solid fa-box"></i>';
        return '<i class="fa-solid fa-magnifying-glass"></i>';
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

    function initLegacySearchBridge() {
        const input = document.getElementById("searchInput");
        if (!input || input.dataset.azielGlobalBridge === "true") return;
        input.dataset.azielGlobalBridge = "true";
        input.addEventListener("focus", () => open(input));
        input.addEventListener("click", () => open(input));
    }

    window.AZIEL_SEARCH = {
        close,
        open,
        refresh: buildIndex
    };

    window.addEventListener("aziel:locale-changed", () => {
        state.index = [];
        document.getElementById("azSearchOverlay")?.remove();
        if (state.open) open(state.lastFocused);
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initLegacySearchBridge);
    } else {
        initLegacySearchBridge();
    }

    window.dispatchEvent(new Event("aziel:searchReady"));
})();
