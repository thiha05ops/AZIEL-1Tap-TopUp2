// frontend/js/header-loader.js
// AZIEL V2.5 Header Loader + i18n

const AZIEL_NAV_ITEMS = {
    home: [
        ["explore.html", "nav_explore"],
        ["home.html", "nav_home"],
        ["home.html#popularGames", "nav_games"],
        ["home.html#categories", "nav_topup"],
        ["wallet.html", "nav_wallet"],
        ["tracking.html", "nav_transactions"],
        ["support.html", "nav_support"]
    ],

    game: [
        ["home.html", "nav_home"],
        ["home.html#popularGames", "nav_games"],
        ["wallet.html", "nav_wallet"],
        ["tracking.html", "nav_orders"],
        ["support.html", "nav_support"]
    ],

    account: [
        ["home.html", "nav_home"],
        ["wallet.html", "nav_wallet"],
        ["tracking.html", "nav_orders"],
        ["support.html", "nav_support"]
    ],

    explore: [
        ["home.html", "nav_home"],
        ["explore.html", "nav_explore"],
        ["explore.html#features", "nav_features"],
        ["explore.html#platform", "nav_platform"],
        ["support.html", "nav_support"]
    ]
};

let azielHeaderLoading = false;
let azielHeaderLoaded = false;

async function loadAZIELHeader() {
    const mount = document.getElementById("azHeaderMount");
    if (!mount) return;

    if (azielHeaderLoading || azielHeaderLoaded) {
        renderHeaderNav(mount.dataset.nav || "home");
        translateHeaderContent();
        return;
    }

    azielHeaderLoading = true;

    const navType = mount.dataset.nav || "home";

    try {
        const res = await fetch("/components/header.html?v=20260706-i18n");

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

        console.log("AZIEL header loaded ✅");

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
    const currentPage = location.pathname.split("/").pop() || "home.html";
    const currentHash = location.hash || "";

    nav.innerHTML = items
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
        nav_features: "Features",
        nav_platform: "Platform"
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
