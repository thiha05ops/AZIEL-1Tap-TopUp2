// frontend/js/header-loader.js - AZIEL V2.5 Header Component Loader

const AZIEL_NAV_ITEMS = {
    home: [
        ["explore.html", "Explore"],
        ["home.html", "Home"],
        ["home.html#popularGames", "Games"],
        ["home.html#categories", "Top Up"],
        ["wallet.html", "Wallet"],
        ["tracking.html", "Transactions"],
        ["support.html", "Support"]
    ],
    game: [
        ["home.html", "Home"],
        ["home.html#popularGames", "Games"],
        ["wallet.html", "Wallet"],
        ["tracking.html", "Orders"],
        ["support.html", "Support"]
    ],
    account: [
        ["home.html", "Home"],
        ["wallet.html", "Wallet"],
        ["tracking.html", "Orders"],
        ["support.html", "Support"]
    ],
    explore: [
        ["home.html", "Home"],
        ["explore.html", "Explore"],
        ["explore.html#features", "Features"],
        ["explore.html#platform", "Platform"],
        ["support.html", "Support"]
    ]
};

document.addEventListener("DOMContentLoaded", loadAZIELHeader);

async function loadAZIELHeader() {
    const mount = document.getElementById("azHeaderMount");
    if (!mount) return;

    const navType = mount.dataset.nav || "home";

    try {
        const res = await fetch("/components/header.html?v=20260629");

        if (!res.ok) {
            throw new Error(`Header fetch failed: ${res.status}`);
        }

        const html = await res.text();

        mount.innerHTML = html;

        renderHeaderNav(navType);

        setTimeout(() => {
            window.renderHeader?.();
            window.dispatchEvent(new Event("aziel:headerLoaded"));
        }, 0);

    } catch (error) {
        console.error("Header load error:", error);
    }
}

function renderHeaderNav(navType) {
    const nav = document.getElementById("azHeaderNav");
    if (!nav) return;

    const items = AZIEL_NAV_ITEMS[navType] || AZIEL_NAV_ITEMS.home;

    nav.innerHTML = items.map(([href, label]) => {
        return `<a href="${href}">${label}</a>`;
    }).join("");
}