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

    async function load(options = {}) {
        if (sections && !options.force) return sections;
        if (loadingPromise && !options.force) return loadingPromise;

        loadingPromise = fetch("/api/public/storefront-sections", {
            cache: "no-store",
            headers: { Accept: "application/json" }
        })
            .then(async response => {
                const data = await response.json().catch(() => ({}));
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
        target.innerHTML = `
            <section class="az-section-state" data-storefront-state="${isComingSoon ? "coming-soon" : "hidden"}">
                <span class="az-section-state-icon">
                    <i class="fa-${isComingSoon ? "regular" : "solid"} fa-${isComingSoon ? "clock" : "lock"}"></i>
                </span>
                <p>AZIEL / Games</p>
                <h1>${escapeHtml(section.displayName)}</h1>
                <span>${isComingSoon ? "Products are being prepared for this section." : "This section is currently unavailable."}</span>
                <a href="/mobile-games.html">Explore available games</a>
            </section>
        `;
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
