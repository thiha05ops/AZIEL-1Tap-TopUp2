// frontend/js/header.js - AZIEL V2.5 Global Header + i18n

document.addEventListener("DOMContentLoaded", () => {
    initHeader();

    window.addEventListener("aziel:headerLoaded", initHeader);
    window.addEventListener("aziel:ready", renderHeader);
    window.addEventListener("aziel:userChanged", renderHeader);
    window.addEventListener("aziel:walletChanged", renderHeader);
    window.addEventListener("aziel:notificationsChanged", event => {
        renderNotificationBadge(event.detail?.unreadCount || 0);
    });

    window.addEventListener("aziel:languageChanged", () => {
        translateHeader();
    });

    window.addEventListener("aziel:shopRegionChanged", async () => {
        renderHeader();

        if (window.AZIEL?.loadWallet) {
            await window.AZIEL.loadWallet();
        }

        renderHeader();
    });
});

function initHeader() {
    renderHeader();
    renderHeaderNav();
    initNotificationBadge();
    initProfileDropdown();
    initHeaderSearchTrigger();
    initThemeButton();
    initMobileRefreshButton();
    initHeaderLogout();
    initCanonicalHeaderScroll();
    translateHeader();
}

function renderHeader() {
    const walletText = document.getElementById("headerWalletText");
    const avatarText = document.getElementById("avatarText");
    const localeFlag = document.getElementById("localeFlag");

    const region = window.AZIEL?.getShopRegion?.() || "MM";
    const symbol =
        window.AZIEL?.getShopSymbol?.() ||
        (region === "TH" ? "฿" : "Ks");

    const user = window.AZIEL?.user || null;
    const wallet = window.AZIEL?.wallet || null;

    if (localeFlag) {
        localeFlag.innerText = region === "TH" ? "🇹🇭" : "🇲🇲";
    }

    if (!user) {
        if (walletText) walletText.innerText = `0 ${symbol}`;
        if (avatarText) avatarText.innerText = "G";
        translateHeader();
        return;
    }

    const name =
        window.AZIEL?.getDisplayName?.(user) ||
        user.displayName ||
        user.username ||
        "User";

    if (avatarText) {
        avatarText.innerText = name.charAt(0).toUpperCase();
    }

    const balance = Number(wallet?.balance || 0);

    if (walletText) {
        walletText.innerText = `${balance.toLocaleString()} ${symbol}`;
    }

    translateHeader();
}

function initHeaderSearchTrigger() {
    const btn = document.getElementById("azHeaderSearchBtn");

    if (btn && btn.dataset.ready !== "true") {
        btn.dataset.ready = "true";
        btn.addEventListener("click", () => {
            openHeaderSearch(btn);
        });
    }

    if (window.__azielHeaderSearchShortcutReady) return;
    window.__azielHeaderSearchShortcutReady = true;

    document.addEventListener("keydown", event => {
        const key = String(event.key || "").toLowerCase();
        const editable = event.target?.closest?.("input, textarea, select, [contenteditable='true']");

        if ((event.metaKey || event.ctrlKey) && key === "k") {
            event.preventDefault();
            openHeaderSearch(document.getElementById("azHeaderSearchBtn"));
            return;
        }

        if (key === "/" && !editable && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            openHeaderSearch(document.getElementById("azHeaderSearchBtn"));
        }
    });
}

function openHeaderSearch(trigger = null) {
    if (window.AZIEL_SEARCH?.open) {
        window.AZIEL_SEARCH.open(trigger || document.activeElement);
        return;
    }

    if (document.querySelector('script[data-aziel-search="true"]')) {
        window.addEventListener("aziel:searchReady", () => {
            window.AZIEL_SEARCH?.open?.(trigger || document.activeElement);
        }, { once: true });
        return;
    }

    const script = document.createElement("script");
    script.src = "/js/search.js?v=20260717-v26-search";
    script.dataset.azielSearch = "true";
    script.onload = () => {
        window.AZIEL_SEARCH?.open?.(trigger || document.activeElement);
    };
    document.head.appendChild(script);
}

function initNotificationBadge() {
    ensureNotificationStore(() => {
        if (!window.AZIEL_NOTIFICATIONS) return;

        if (window.__azielHeaderNotificationSubscribed) {
            renderNotificationBadge(window.AZIEL_NOTIFICATIONS.getState().unreadCount);
            return;
        }

        window.__azielHeaderNotificationSubscribed = true;

        window.AZIEL_NOTIFICATIONS.subscribe(state => {
            renderNotificationBadge(state.unreadCount);
        });

        window.AZIEL_NOTIFICATIONS.init();
    });
}

function ensureNotificationStore(callback) {
    if (window.AZIEL_NOTIFICATIONS) {
        callback();
        return;
    }

    if (document.querySelector('script[data-aziel-notification-store="true"]')) {
        window.addEventListener("aziel:notificationStoreLoaded", callback, { once: true });
        return;
    }

    const script = document.createElement("script");
    script.src = "/js/notification-store.js?v=20260712-m5";
    script.dataset.azielNotificationStore = "true";
    script.onload = () => {
        window.dispatchEvent(new Event("aziel:notificationStoreLoaded"));
        callback();
    };

    document.head.appendChild(script);
}

function renderNotificationBadge(unreadCount) {
    const badge = document.getElementById("headerNotificationCount");
    if (!badge) return;

    const count = Number(unreadCount || 0);
    const nextText = count > 99 ? "99+" : String(count);
    const changed = badge.textContent !== nextText;

    badge.textContent = nextText;
    badge.style.display = count > 0 ? "flex" : "none";

    if (changed && count > 0) {
        window.AZIEL_MOTION?.emphasize(badge, "badge");
    }
}

function renderHeaderNav() {
    const nav = document.getElementById("azHeaderNav");
    if (!nav) return;

    if (nav.dataset.rendered === "true") {
        translateHeader();
        return;
    }

    nav.dataset.rendered = "true";

    nav.innerHTML = `
        <a href="home.html" data-i18n="nav_home">Home</a>

        <div class="az-nav-dropdown" id="gamesNavDropdown">
            <button class="az-nav-drop-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="azGamesDropdownMenu">
                <span data-i18n="nav_games">Games</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>

            <div class="az-nav-drop-menu" id="azGamesDropdownMenu" role="menu" aria-label="Game categories">
                ${renderGamesDropdownItems(getFallbackStorefrontSections())}
            </div>
        </div>

        <a href="wallet.html" data-i18n="nav_wallet">Wallet</a>
        <a href="tracking.html" data-i18n="nav_orders">Orders</a>
        <a href="support.html" data-i18n="nav_support">Support</a>
    `;

    const active = document.getElementById("azHeaderMount")?.dataset?.nav;

    nav.querySelectorAll("a").forEach(link => {
        const href = link.getAttribute("href") || "";

        if (
            (active === "home" && href.includes("home")) ||
            (active === "games" && (
                href.includes("mobile-games") ||
                href.includes("pc-games") ||
                href.includes("gift-cards") ||
                href.includes("social-topup") ||
                href.includes("coming-soon")
            )) ||
            (active === "wallet" && href.includes("wallet")) ||
            (active === "orders" && href.includes("tracking")) ||
            (active === "support" && href.includes("support"))
        ) {
            link.classList.add("active");
        }
    });

    if (active === "games") {
        document.querySelector(".az-nav-drop-btn")?.classList.add("active");
    }

    initGamesDropdown();
    loadStorefrontSectionsForHeader();
    translateHeader();
}

function getFallbackStorefrontSections() {
    return [
        { key: "mobile-games", displayName: "Mobile Games", icon: "mobile", path: "/mobile-games.html", status: "PUBLISHED", showInGamesMenu: true, sortOrder: 1 },
        { key: "pc-games", displayName: "PC Games", icon: "desktop", path: "/pc-games.html", status: "COMING_SOON", showInGamesMenu: true, sortOrder: 2 },
        { key: "gift-cards", displayName: "Gift Cards", icon: "gift", path: "/gift-cards.html", status: "PUBLISHED", showInGamesMenu: true, sortOrder: 3 },
        { key: "social-topup", displayName: "Social Top Up", icon: "telegram", path: "/social-topup.html", status: "COMING_SOON", showInGamesMenu: true, sortOrder: 4 }
    ];
}

function sectionIconClass(icon = "") {
    const map = {
        mobile: "fa-solid fa-mobile-screen-button",
        desktop: "fa-solid fa-desktop",
        gift: "fa-solid fa-gift",
        telegram: "fa-brands fa-telegram",
        clock: "fa-regular fa-clock"
    };
    return map[String(icon || "").toLowerCase()] || "fa-solid fa-layer-group";
}

function renderGamesDropdownItems(sections = []) {
    return sections
        .filter(section => section?.showInGamesMenu !== false && section?.status !== "HIDDEN")
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
        .map(section => `
            <a href="${escapeHeaderHtml(section.path || "/mobile-games.html")}" role="menuitem" data-storefront-section="${escapeHeaderHtml(section.key || "")}">
                <i class="${escapeHeaderHtml(sectionIconClass(section.icon))}"></i>
                <span>${escapeHeaderHtml(section.displayName || "Games")}</span>
            </a>
        `).join("");
}

function escapeHeaderHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function loadStorefrontSectionsForHeader() {
    const menu = document.getElementById("azGamesDropdownMenu");
    if (!menu || menu.dataset.dynamicReady === "true") return;

    try {
        const sections = window.AZIEL_STOREFRONT_SECTIONS
            ? await window.AZIEL_STOREFRONT_SECTIONS.load()
            : await fetch("/api/public/storefront-sections", {
                cache: "no-store",
                headers: { Accept: "application/json" }
            }).then(async response => {
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data.success || !Array.isArray(data.sections)) {
                    throw new Error("Storefront sections unavailable");
                }
                return data.sections;
            });
        const items = renderGamesDropdownItems(sections);
        if (items) {
            menu.innerHTML = items;
            menu.dataset.dynamicReady = "true";
            markActiveHeaderLinks();
            initGamesDropdown({ refreshItems: true });
        }
    } catch (error) {
        menu.dataset.dynamicReady = "fallback";
    }
}

function markActiveHeaderLinks() {
    const nav = document.getElementById("azHeaderNav");
    const active = document.getElementById("azHeaderMount")?.dataset?.nav;
    if (!nav) return;

    nav.querySelectorAll("a").forEach(link => {
        const href = link.getAttribute("href") || "";
        link.classList.toggle("active", (
            (active === "home" && href.includes("home")) ||
            (active === "games" && (
                href.includes("mobile-games") ||
                href.includes("pc-games") ||
                href.includes("gift-cards") ||
                href.includes("social-topup") ||
                href.includes("coming-soon")
            )) ||
            (active === "wallet" && href.includes("wallet")) ||
            (active === "orders" && href.includes("tracking")) ||
            (active === "support" && href.includes("support"))
        ));
    });
}

function initGamesDropdown(options = {}) {
    const dropdown = document.getElementById("gamesNavDropdown");
    const btn = dropdown?.querySelector(".az-nav-drop-btn");
    const menu = dropdown?.querySelector(".az-nav-drop-menu");

    if (!dropdown || !btn || !menu) return;
    if (dropdown.dataset.ready === "true" && !options.refreshItems) return;

    dropdown.dataset.ready = "true";
    let menuItems = Array.from(menu.querySelectorAll("a"));

    if (options.refreshItems) {
        dropdown.dataset.menuVersion = String(Date.now());
        return;
    }

    const syncDropdownA11y = () => {
        btn.setAttribute("aria-expanded", dropdown.classList.contains("show") ? "true" : "false");
    };

    const emitDropdownState = () => {
        window.dispatchEvent(new CustomEvent("aziel:headerSurfaceChanged", {
            detail: {
                open: dropdown.classList.contains("show"),
                source: "games-dropdown"
            }
        }));
    };

    const releaseMobileDropdownFocus = () => {
        if (!window.matchMedia("(max-width: 900px)").matches) return;
        if (document.activeElement && dropdown.contains(document.activeElement)) {
            document.activeElement.blur();
        }
    };

    const closeDropdown = ({ restoreFocus = false } = {}) => {
        const wasOpen = dropdown.classList.contains("show");
        dropdown.classList.remove("show");
        syncDropdownA11y();
        if (wasOpen) {
            releaseMobileDropdownFocus();
            emitDropdownState();
            if (restoreFocus) {
                btn.focus({ preventScroll: true });
            }
        }
    };

    const openDropdown = ({ focusFirst = false } = {}) => {
        menuItems = Array.from(menu.querySelectorAll("a"));
        dropdown.classList.add("show");
        syncDropdownA11y();
        emitDropdownState();
        if (focusFirst) {
            menuItems[0]?.focus({ preventScroll: true });
        }
    };

    const toggleDropdown = () => {
        if (dropdown.classList.contains("show")) {
            closeDropdown();
            return;
        }
        openDropdown();
    };

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    btn.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleDropdown();
            return;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            openDropdown({ focusFirst: true });
        }
    });

    dropdown.addEventListener("click", (e) => {
        e.stopPropagation();
    });

    menuItems.forEach(link => {
        link.addEventListener("click", closeDropdown);
    });

    menu.addEventListener("keydown", event => {
        const currentIndex = menuItems.indexOf(document.activeElement);

        if (event.key === "Escape") {
            event.preventDefault();
            closeDropdown({ restoreFocus: true });
            return;
        }

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            const fallbackIndex = direction > 0 ? 0 : menuItems.length - 1;
            const nextIndex = currentIndex >= 0
                ? (currentIndex + direction + menuItems.length) % menuItems.length
                : fallbackIndex;
            menuItems[nextIndex]?.focus({ preventScroll: true });
            return;
        }

        if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const nextIndex = event.key === "Home" ? 0 : menuItems.length - 1;
            menuItems[nextIndex]?.focus({ preventScroll: true });
        }
    });

    document.addEventListener("click", () => {
        closeDropdown();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeDropdown({ restoreFocus: dropdown.classList.contains("show") });
        }
    });

    syncDropdownA11y();
}

function translateHeader() {
    if (window.AZIEL_I18N?.translatePage) {
        window.AZIEL_I18N.translatePage(document);
    }
    const refreshBtn = document.getElementById("mobileRefreshBtn");
    if (refreshBtn) {
        refreshBtn.setAttribute("aria-label", window.AZIEL_I18N?.t?.("pwa_refresh_label", "Refresh page") || "Refresh page");
    }
}

function initProfileDropdown() {
    const btn = document.getElementById("profileMenuBtn");
    const dropdown = document.getElementById("profileDropdown");

    if (!btn || !dropdown) return;
    if (btn.dataset.ready === "true") return;

    btn.dataset.ready = "true";

    btn.addEventListener("click", (e) => {
        e.stopPropagation();

        const user = window.AZIEL?.user || null;

        if (!user) {
            window.location.href = "login.html";
            return;
        }

        dropdown.classList.toggle("show");
    });

    dropdown.addEventListener("click", (e) => {
        e.stopPropagation();
    });

    document.addEventListener("click", () => {
        dropdown.classList.remove("show");
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            dropdown.classList.remove("show");
        }
    });
}

function initThemeButton() {
    const btn = document.getElementById("themeToggleBtn");
    if (!btn) return;
    if (btn.dataset.ready === "true") return;

    btn.dataset.ready = "true";

    btn.addEventListener("click", () => {
        if (window.AZIEL?.toggleTheme) {
            window.AZIEL.toggleTheme();
            return;
        }

        document.body.classList.toggle("theme-dark");
        document.body.classList.toggle("theme-light");
    });
}

function initMobileRefreshButton() {
    const btn = document.getElementById("mobileRefreshBtn");
    if (!btn) return;
    if (btn.dataset.ready === "true") return;

    btn.dataset.ready = "true";
    btn.setAttribute("aria-label", window.AZIEL_I18N?.t?.("pwa_refresh_label", "Refresh page") || "Refresh page");

    btn.addEventListener("click", () => {
        document.getElementById("profileDropdown")?.classList.remove("show");
        if (window.AZIEL_PWA_REFRESH?.requestRefresh) {
            window.AZIEL_PWA_REFRESH.requestRefresh();
            return;
        }
        window.location.reload();
    });
}

function initHeaderLogout() {
    const btn = document.getElementById("logoutBtn");
    if (!btn) return;
    if (btn.dataset.ready === "true") return;

    btn.dataset.ready = "true";

    btn.addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("azielToken");
        localStorage.removeItem("user");
        localStorage.removeItem("azielUser");

        window.AZIEL = window.AZIEL || {};
        window.AZIEL.user = null;
        window.AZIEL.wallet = null;

        window.dispatchEvent(new Event("aziel:userChanged"));

        window.location.href = "login.html";
    });
}

function initCanonicalHeaderScroll() {
    const header = document.querySelector(".az-header");
    const mount = document.getElementById("azHeaderMount");

    if (!header || !mount) return;
    if (window.__azielCanonicalHeaderScrollReady) return;

    window.__azielCanonicalHeaderScrollReady = true;
    header.dataset.scrollController = "canonical";
    mount.dataset.scrollController = "canonical";

    const mobileQuery = window.matchMedia("(max-width: 900px)");
    const TOP_VISIBLE_Y = 20;
    const MIN_DELTA = 6;
    const HIDE_AFTER = 32;
    const SHOW_AFTER = 8;

    let previousY = Math.max(0, window.scrollY || 0);
    let eventY = previousY;
    let downwardDelta = 0;
    let upwardDelta = 0;
    let hidden = false;

    let ticking = false;

    const forceVisible = () => {
        hidden = false;
        previousY = Math.max(0, eventY);
        downwardDelta = 0;
        upwardDelta = 0;
        mount.classList.add("az-nav-visible");
        mount.classList.remove("az-nav-hidden");
        header.classList.remove("nav-hidden");
    };

    const hideNavRow = () => {
        if (!mobileQuery.matches) {
            forceVisible();
            return;
        }

        hidden = true;
        previousY = Math.max(0, eventY);
        mount.classList.add("az-nav-hidden");
        mount.classList.remove("az-nav-visible");
        header.classList.remove("nav-hidden");
    };

    const hasOpenHeaderSurface = () =>
        Boolean(
            mount.querySelector(".az-nav-dropdown.show") ||
            mount.querySelector(".az-profile-dropdown.show") ||
            document.querySelector(".az-locale-modal.show, .az-locale-modal[open], .az-locale-modal.active") ||
            mount.contains(document.activeElement)
        );

    const updateHeaderScrollState = () => {
        const currentY = Math.max(0, eventY);
        previousY = currentY;

        header.classList.toggle("scrolled", currentY > 12);
        header.classList.remove("nav-hidden");

        if (!mobileQuery.matches || currentY <= TOP_VISIBLE_Y || hasOpenHeaderSurface()) {
            forceVisible();
            return;
        }

        if (!hidden && downwardDelta >= HIDE_AFTER) {
            hideNavRow();
            return;
        }

        if (hidden && upwardDelta >= SHOW_AFTER) {
            forceVisible();
        }
    };

    const scheduleHeaderUpdate = () => {
        if (ticking) return;
        ticking = true;

        window.requestAnimationFrame(() => {
            updateHeaderScrollState();
            ticking = false;
        });
    };

    forceVisible();

    window.addEventListener("scroll", () => {
        const currentY = Math.max(0, window.scrollY || 0);
        const eventDelta = currentY - eventY;
        eventY = currentY;

        if (Math.abs(eventDelta) >= MIN_DELTA) {
            if (eventDelta > 0) {
                downwardDelta += eventDelta;
                upwardDelta = 0;
            } else {
                upwardDelta += Math.abs(eventDelta);
                downwardDelta = 0;

                if (hidden && upwardDelta >= SHOW_AFTER) {
                    forceVisible();
                    return;
                }
            }
        }

        scheduleHeaderUpdate();
    }, { passive: true });

    window.addEventListener("resize", () => {
        eventY = Math.max(0, window.scrollY || 0);
        previousY = eventY;
        forceVisible();
    });

    document.addEventListener("focusin", event => {
        if (mount.contains(event.target)) forceVisible();
    });

    document.addEventListener("click", () => {
        window.requestAnimationFrame(() => {
            if (hasOpenHeaderSurface()) forceVisible();
        });
    });

    window.addEventListener("aziel:headerSurfaceChanged", event => {
        eventY = Math.max(0, window.scrollY || 0);
        previousY = eventY;
        downwardDelta = 0;
        upwardDelta = 0;

        if (event.detail?.open || hasOpenHeaderSurface()) {
            forceVisible();
        }
    });

    if (typeof mobileQuery.addEventListener === "function") {
        mobileQuery.addEventListener("change", forceVisible);
    } else if (typeof mobileQuery.addListener === "function") {
        mobileQuery.addListener(forceVisible);
    }
}
