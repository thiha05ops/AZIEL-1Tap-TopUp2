// frontend/js/header.js - AZIEL V2.5 Global Header + i18n

document.addEventListener("DOMContentLoaded", () => {
    initHeader();

    window.addEventListener("aziel:headerLoaded", initHeader);
    window.addEventListener("aziel:ready", renderHeader);
    window.addEventListener("aziel:userChanged", renderHeader);
    window.addEventListener("aziel:walletChanged", renderHeader);

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
    initProfileDropdown();
    initThemeButton();
    initHeaderLogout();
    initAutoRevealNav();
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

function initAutoRevealNav() {
    const header = document.querySelector(".az-header");
    const nav = document.querySelector(".az-nav");

    if (!header || !nav) return;
    if (header.dataset.navRevealReady === "true") return;

    header.dataset.navRevealReady = "true";

    let lastScrollY = window.scrollY;

    window.addEventListener("scroll", () => {
        const currentY = window.scrollY;

        if (currentY > 80 && currentY > lastScrollY) {
            header.classList.add("nav-hidden");
        }

        if (currentY < lastScrollY || currentY < 40) {
            header.classList.remove("nav-hidden");
        }

        lastScrollY = currentY;
    }, { passive: true });
}