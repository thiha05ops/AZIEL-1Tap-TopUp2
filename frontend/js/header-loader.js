// frontend/js/header-loader.js
// AZIEL V2.5 Header Loader + i18n

(function markStandaloneBeforeHeaderPaint() {
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;
    document.documentElement.classList.toggle("az-pwa-standalone", Boolean(standalone));
})();

(function loadAzielLoadingManagerOnce() {
    if (window.__AZIEL_LOADING_SCRIPT_LOADER__) return;
    window.__AZIEL_LOADING_SCRIPT_LOADER__ = true;
    if (!document.querySelector('link[data-aziel-native-ux="true"]')) {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = "/css/core/loading-progress.css?v=20261025-native-ux-v2";
        stylesheet.dataset.azielNativeUx = "true";
        document.head.appendChild(stylesheet);
    }
    const bootstrapState = window.__AZIEL_LOADING_BOOTSTRAP__ ||= { pending: new Set(), sequence: 0 };
    if (!window.AZIEL_LOADING) {
        window.AZIEL_LOADING = Object.freeze({
            start(label = "operation") {
                const token = `bootstrap:${label}:${++bootstrapState.sequence}`;
                bootstrapState.pending.add(token);
                return token;
            },
            finish(token) {
                return bootstrapState.pending.delete(token);
            },
            track(value, label) {
                const token = `bootstrap:${label || "operation"}:${++bootstrapState.sequence}`;
                bootstrapState.pending.add(token);
                return Promise.resolve(value).finally(() => bootstrapState.pending.delete(token));
            },
            isActive: () => bootstrapState.pending.size > 0
        });
    }
    if (document.querySelector('script[data-aziel-loading-manager="true"]')) return;
    const script = document.createElement("script");
    script.src = "/js/loading-manager.js?v=20261025-native-ux-v2";
    script.defer = true;
    script.dataset.azielLoadingManager = "true";
    document.head.appendChild(script);
})();

(function loadAzielPwaInstallOnce() {
    if (window.__AZIEL_PWA_INSTALL_SCRIPT_LOADER__) return;
    window.__AZIEL_PWA_INSTALL_SCRIPT_LOADER__ = true;
    if (document.querySelector('script[data-aziel-pwa-install="true"]')) return;
    const script = document.createElement("script");
    script.src = "/js/pwa-install.js?v=20261027-pwa-phase2-v1";
    script.defer = true;
    script.dataset.azielPwaInstall = "true";
    document.head.appendChild(script);
})();

(function loadAzielAnalyticsOnce() {
    if (window.__AZIEL_ANALYTICS_LOADER__) return;
    window.__AZIEL_ANALYTICS_LOADER__ = true;
    if (document.querySelector('script[data-aziel-analytics="true"]')) return;
    const script = document.createElement("script");
    script.src = "/js/analytics.js?v=20261027-pwa-phase2-v1";
    script.defer = true;
    script.dataset.azielAnalytics = "true";
    document.head.appendChild(script);
})();

const AZIEL_NAV_ITEMS = {
    home: [
        ["/explore", "nav_explore"],
        ["/", "nav_home"],
        ["/#popularGames", "nav_games"],
        ["/#categories", "nav_topup"],
        ["money-transfer.html", "nav_money_transfer"],
        ["/wallet", "nav_wallet"],
        ["/orders", "nav_transactions"],
        ["/support", "nav_support"]
    ],

    game: [
        ["/", "nav_home"],
        ["/#popularGames", "nav_games"],
        ["money-transfer.html", "nav_money_transfer"],
        ["/wallet", "nav_wallet"],
        ["/orders", "nav_orders"],
        ["/support", "nav_support"]
    ],

    account: [
        ["/", "nav_home"],
        ["money-transfer.html", "nav_money_transfer"],
        ["/wallet", "nav_wallet"],
        ["/orders", "nav_orders"],
        ["/support", "nav_support"]
    ],

    explore: [
        ["/", "nav_home"],
        ["/explore", "nav_explore"],
        ["money-transfer.html", "nav_money_transfer"],
        ["/explore#features", "nav_features"],
        ["/explore#platform", "nav_platform"],
        ["/support", "nav_support"]
    ]
};

let azielHeaderLoading = false;
let azielHeaderLoaded = false;

async function loadAZIELHeader() {
    const mount = document.getElementById("azHeaderMount");
    if (!mount) return;

    // Public pages ship the canonical visual shell in their HTML so the header
    // belongs to the first paint. Reconcile that shell in place; the component
    // fetch remains a compatibility fallback for pages not migrated yet.
    if (mount.dataset.headerCanonical === "true" && mount.querySelector(":scope > .az-header")) {
        renderHeaderNav(mount.dataset.nav || "home");
        azielHeaderLoaded = true;
        translateHeaderContent();
        window.dispatchEvent(new Event("aziel:headerLoaded"));
        return;
    }

    if (azielHeaderLoading || azielHeaderLoaded) {
        renderHeaderNav(mount.dataset.nav || "home");
        translateHeaderContent();
        return;
    }

    azielHeaderLoading = true;

    const navType = mount.dataset.nav || "home";

    try {
        const res = await fetch("/components/header.html?v=20260822-mobile-drawer-hero-final");

        if (!res.ok) {
            throw new Error(`Header fetch failed: ${res.status}`);
        }

        mount.innerHTML = await res.text();

        const headers = document.querySelectorAll(".az-header");

        if (headers.length > 1) {
            headers.forEach((header, index) => {
                if (index > 0) header.remove();
            });
        }

        renderHeaderNav(navType);

        azielHeaderLoaded = true;

        translateHeaderContent();

        window.dispatchEvent(new Event("aziel:headerLoaded"));

    } catch (err) {
        console.error("Header load error:", err);
    } finally {
        azielHeaderLoading = false;
    }
}

function renderHeaderNav(navType) {
    const nav = document.getElementById("azHeaderNav");
    if (!nav) return;

    const items = AZIEL_NAV_ITEMS[navType] || AZIEL_NAV_ITEMS.home;
    const currentPage = (location.pathname || "/").replace(/\/$/, "") || "/";
    const currentHash = location.hash || "";

    nav.innerHTML = `
        <div class="az-mobile-drawer-head">
            <div class="az-mobile-drawer-brand" aria-hidden="true">
                <img src="/assets/brand/aziel-logo-primary.svg" alt="AZIEL">
            </div>
            <button class="az-mobile-drawer-close" type="button" aria-label="Close menu">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
        </div>` + items
        .map(([href, key]) => {
            const [hrefPage, hrefHashRaw] = href.split("#");
            const hrefHash = hrefHashRaw ? `#${hrefHashRaw}` : "";

            let activeClass = "";

            if (hrefHash) {
                activeClass =
                    hrefPage === currentPage && hrefHash === currentHash
                        ? "active"
                        : "";
            } else {
                activeClass =
                    hrefPage === currentPage && !currentHash
                        ? "active"
                        : "";
            }

            const fallback = getFallbackLabel(key);

            return `
                <a href="${href}"
                   class="${activeClass}"
                   data-i18n="${key}">
                    ${fallback}
                </a>
            `;
        })
        .join("");

    translateHeaderContent();
}

function translateHeaderContent() {
    if (window.AZIEL_I18N?.translatePage) {
        window.AZIEL_I18N.translatePage(document);
    }
}

function getFallbackLabel(key) {
    const labels = {
        nav_explore: "Explore",
        nav_home: "Home",
        nav_games: "Games",
        nav_topup: "Top Up",
        nav_wallet: "Wallet",
        nav_transactions: "Transactions",
        nav_orders: "Orders",
        nav_support: "Support",
        pwa_install_action: "Install AZIEL",
        nav_features: "Features",
        nav_platform: "Platform",
        nav_money_transfer: "Money Transfer"
    };

    return labels[key] || key;
}

window.loadAZIELHeader = loadAZIELHeader;
window.renderHeaderNav = renderHeaderNav;

window.addEventListener("aziel:languageChanged", () => {
    translateHeaderContent();
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadAZIELHeader, { once: true });
} else {
    loadAZIELHeader();
}
