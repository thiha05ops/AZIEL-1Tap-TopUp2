(function () {
    const FALLBACK_SECTIONS = [
        { key: "mobile-games", displayName: "Mobile Games", icon: "mobile", path: "/mobile-games.html", status: "PUBLISHED", showInGamesMenu: true, sortOrder: 1 },
        { key: "pc-games", displayName: "PC Games", icon: "desktop", path: "/pc-games.html", status: "COMING_SOON", showInGamesMenu: true, sortOrder: 2 },
        { key: "gift-cards", displayName: "Gift Cards", icon: "gift", path: "/gift-cards.html", status: "PUBLISHED", showInGamesMenu: true, sortOrder: 3 },
        { key: "social-topup", displayName: "Social Top Up", icon: "telegram", path: "/social-topup.html", status: "COMING_SOON", showInGamesMenu: true, sortOrder: 4 },
        { key: "coming-soon", displayName: "Coming Soon", icon: "clock", path: "/coming-soon.html", status: "HIDDEN", showInGamesMenu: false, sortOrder: 5 },
        { key: "popular-game-cards", displayName: "Popular Game Cards", icon: "gift", path: "/gift-cards.html", status: "PUBLISHED", showInGamesMenu: false, sortOrder: 10 },
        { key: "popular-game-topup", displayName: "Popular Game Top-Up", icon: "mobile", path: "/mobile-games.html", status: "PUBLISHED", showInGamesMenu: false, sortOrder: 11 },
        { key: "popular-pc-games", displayName: "Popular PC Games", icon: "desktop", path: "/pc-games.html", status: "PUBLISHED", showInGamesMenu: false, sortOrder: 12 },
        { key: "popular-gift-cards", displayName: "Popular Gift Cards", icon: "gift", path: "/gift-cards.html", status: "PUBLISHED", showInGamesMenu: false, sortOrder: 13 },
        { key: "new-game-cards", displayName: "New Game Cards", icon: "gift", path: "/gift-cards.html", status: "PUBLISHED", showInGamesMenu: false, sortOrder: 14 },
        { key: "new-game-topup", displayName: "New Game Top-Up", icon: "mobile", path: "/mobile-games.html", status: "PUBLISHED", showInGamesMenu: false, sortOrder: 15 },
        { key: "digital-services-home", displayName: "Digital Services", icon: "telegram", path: "/explore.html", status: "PUBLISHED", showInGamesMenu: false, sortOrder: 16 },
        { key: "news-promotions", displayName: "News & Promotions", icon: "gift", path: "/notifications.html?filter=promotions", status: "PUBLISHED", showInGamesMenu: false, sortOrder: 17 }
    ];

    let sections = null;
    let loadingPromise = null;
    const STARTUP_RETRY_DELAYS_MS = Object.freeze([750, 1500, 3000]);

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizePath(path = "") {
        const value = String(path || "").trim();
        if (!value) return "";
        return value.startsWith("/") ? value : `/${value}`;
    }

    function normalizeStatus(status = "") {
        const value = String(status || "").trim().toUpperCase();
        return ["PUBLISHED", "COMING_SOON", "HIDDEN"].includes(value) ? value : "HIDDEN";
    }

    function normalizeSection(section = {}, fallback = {}) {
        return {
            key: String(section.key || fallback.key || "").trim().toLowerCase(),
            displayName: String(section.displayName || fallback.displayName || "").trim(),
            icon: String(section.icon || fallback.icon || "gift").trim().toLowerCase(),
            path: normalizePath(section.path || fallback.path || ""),
            status: normalizeStatus(section.status || fallback.status),
            showInGamesMenu: section.showInGamesMenu === true,
            sortOrder: Number(section.sortOrder || fallback.sortOrder || 0)
        };
    }

    function fallbackSections() {
        return clone(FALLBACK_SECTIONS);
    }

    function wait(delayMs) {
        return new Promise(resolve => setTimeout(resolve, delayMs));
    }

    async function fetchSections(attempt = 0) {
        const response = await fetch("/api/public/storefront-sections", {
            cache: "no-store",
            headers: { Accept: "application/json" }
        });
        const data = await response.json().catch(() => ({}));
        const startupUnavailable = response.status === 503 && data?.code === "SERVICE_TEMPORARILY_UNAVAILABLE";
        if (startupUnavailable && attempt < STARTUP_RETRY_DELAYS_MS.length) {
            await wait(STARTUP_RETRY_DELAYS_MS[attempt]);
            return fetchSections(attempt + 1);
        }
        return { response, data };
    }

    async function load(options = {}) {
        if (sections && !options.force) return sections;
        if (loadingPromise && !options.force) return loadingPromise;

        loadingPromise = fetchSections()
            .then(({ response, data }) => {
                if (!response.ok || !data.success || !Array.isArray(data.sections)) {
                    throw new Error(data.message || "Storefront sections unavailable");
                }

                const fallbackByKey = new Map(FALLBACK_SECTIONS.map(item => [item.key, item]));
                sections = data.sections
                    .map(item => normalizeSection(item, fallbackByKey.get(String(item.key || "").toLowerCase()) || {}))
                    .filter(item => item.key && item.path)
                    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
                window.dispatchEvent(new CustomEvent("aziel:storefront-sections-updated", { detail: { sections: clone(sections) } }));
                return sections;
            })
            .catch(() => {
                sections = fallbackSections();
                window.dispatchEvent(new CustomEvent("aziel:storefront-sections-updated", { detail: { sections: clone(sections), fallback: true } }));
                return sections;
            })
            .finally(() => {
                loadingPromise = null;
            });

        return loadingPromise;
    }

    function getMenuSections() {
        const source = sections || fallbackSections();
        return source
            .filter(section => section.showInGamesMenu && section.status !== "HIDDEN")
            .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
            .map(clone);
    }

    function getSection(key) {
        const normalized = String(key || "").trim().toLowerCase();
        return clone((sections || fallbackSections()).find(section => section.key === normalized) || null);
    }

    function renderUnavailableState(target, section, kind) {
        if (!target || !section) return;
        const isComingSoon = kind === "COMING_SOON";
        const t = (key, fallback) => window.AZIEL_LOCALE?.t?.(key, fallback) || fallback;
        const state = document.createElement("section");
        state.className = "az-section-state";
        state.dataset.storefrontState = isComingSoon ? "coming-soon" : "hidden";
        const iconWrap = document.createElement("span");
        iconWrap.className = "az-section-state-icon";
        const icon = document.createElement("i");
        icon.className = `fa-${isComingSoon ? "regular" : "solid"} fa-${isComingSoon ? "clock" : "lock"}`;
        icon.setAttribute("aria-hidden", "true");
        iconWrap.appendChild(icon);
        const eyebrow = document.createElement("p");
        eyebrow.textContent = t("storefront.gamesBreadcrumb", "AZIEL / Games");
        const heading = document.createElement("h1");
        heading.textContent = !section.displayName || section.displayName === "Unavailable"
            ? t("storefront.unavailable", "Unavailable")
            : section.displayName;
        const message = document.createElement("span");
        message.textContent = isComingSoon
            ? t("storefront.sectionPreparing", "Products are being prepared for this section.")
            : t("storefront.sectionUnavailable", "This section is currently unavailable.");
        const link = document.createElement("a");
        link.href = "/mobile-games.html";
        link.textContent = t("storefront.exploreGames", "Explore available games");
        state.append(iconWrap, eyebrow, heading, message, link);
        target.replaceChildren(state);
    }

    async function applyPageAccess(sectionKey, options = {}) {
        const target = document.querySelector(options.targetSelector || "main");
        const loaded = await load().catch(() => fallbackSections());
        const section = loaded.find(item => item.key === String(sectionKey || "").trim().toLowerCase());

        if (!section || section.status === "HIDDEN") {
            renderUnavailableState(target, section || { displayName: "Unavailable" }, "HIDDEN");
            return { status: "HIDDEN", section };
        }

        if (section.status === "COMING_SOON") {
            renderUnavailableState(target, section, "COMING_SOON");
            return { status: "COMING_SOON", section };
        }

        return { status: "PUBLISHED", section };
    }

    function escapeHtml(value = "") {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    window.AZIEL_STOREFRONT_SECTIONS = {
        applyPageAccess,
        fallbackSections,
        getMenuSections,
        getSection,
        load
    };

    document.addEventListener("DOMContentLoaded", () => {
        load().catch(() => fallbackSections());
    });
})();
