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
    initThemeButton();
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
            <button class="az-nav-drop-btn" type="button">
                <span data-i18n="nav_games">Games</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>

            <div class="az-nav-drop-menu">
                <a href="mobile-games.html">
                    <i class="fa-solid fa-mobile-screen-button"></i>
                    <span>Mobile Games</span>
                </a>

                <a href="pc-games.html">
                    <i class="fa-solid fa-desktop"></i>
                    <span>PC Games</span>
                </a>

                <a href="gift-cards.html">
                    <i class="fa-solid fa-gift"></i>
                    <span>Gift Cards</span>
                </a>

                <a href="social-topup.html">
                    <i class="fa-brands fa-telegram"></i>
                    <span>Social Top Up</span>
                </a>

                <a href="coming-soon.html">
                    <i class="fa-regular fa-clock"></i>
                    <span>Coming Soon</span>
                </a>
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
    translateHeader();
}

function initGamesDropdown() {
    const dropdown = document.getElementById("gamesNavDropdown");
    const btn = dropdown?.querySelector(".az-nav-drop-btn");

    if (!dropdown || !btn) return;
    if (dropdown.dataset.ready === "true") return;

    dropdown.dataset.ready = "true";

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
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

function translateHeader() {
    if (window.AZIEL_I18N?.translatePage) {
        window.AZIEL_I18N.translatePage(document);
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

    if (typeof mobileQuery.addEventListener === "function") {
        mobileQuery.addEventListener("change", forceVisible);
    } else if (typeof mobileQuery.addListener === "function") {
        mobileQuery.addListener(forceVisible);
    }
}
