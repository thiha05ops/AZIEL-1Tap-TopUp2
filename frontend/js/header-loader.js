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

let azielHeaderLoading = false;
let azielHeaderLoaded = false;

async function loadAZIELHeader() {
    const mount = document.getElementById("azHeaderMount");
    if (!mount) return;

    if (azielHeaderLoading || azielHeaderLoaded) {
        renderHeaderNav(mount.dataset.nav || "home");
        return;
    }

    azielHeaderLoading = true;

    const navType = mount.dataset.nav || "home";

    try {
        const res = await fetch("components/header.html?v=20260702");

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
        .map(([href, label]) => {
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

            return `<a href="${href}" class="${activeClass}">${label}</a>`;
        })
        .join("");
}

window.loadAZIELHeader = loadAZIELHeader;
window.renderHeaderNav = renderHeaderNav;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadAZIELHeader, { once: true });
} else {
    loadAZIELHeader();
}