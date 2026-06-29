// frontend/js/header-loader.js

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

async function loadAZIELHeader() {
    const mount = document.getElementById("azHeaderMount");
    if (!mount) return;

    const navType = mount.dataset.nav || "home";

    try {
        const res = await fetch("components/header.html?v=2026062905");
        if (!res.ok) throw new Error(`Header fetch failed: ${res.status}`);

        mount.innerHTML = await res.text();

        renderHeaderNav(navType);

        window.dispatchEvent(new Event("aziel:headerLoaded"));

        console.log("AZIEL header loaded ✅");

    } catch (err) {
        console.error("Header load error:", err);
    }
}

function renderHeaderNav(navType) {
    const nav = document.getElementById("azHeaderNav");
    if (!nav) return;

    const items = AZIEL_NAV_ITEMS[navType] || AZIEL_NAV_ITEMS.home;

    nav.innerHTML = items
        .map(([href, label]) => `<a href="${href}">${label}</a>`)
        .join("");
}

window.loadAZIELHeader = loadAZIELHeader;
window.renderHeaderNav = renderHeaderNav;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadAZIELHeader);
} else {
    loadAZIELHeader();
}