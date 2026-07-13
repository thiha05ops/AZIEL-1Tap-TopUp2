/* =========================
   LIVE SEARCH
========================= */

document.addEventListener("DOMContentLoaded", () => {
    initLiveSearch();
});

const searchItems = [
    {
        name: "Mobile Legends Diamonds",
        desc: "Instant Top Up",
        img: "assets/games/mlbb.webp",
        link: "mlbb.html"
    },
    {
        name: "PUBG Mobile UC",
        desc: "Global / Thailand",
        img: "assets/games/pubg.webp",
        link: "pubg.html"
    },
    {
        name: "Free Fire Diamonds",
        desc: "Fast Delivery",
        img: "assets/games/freefire.webp",
        link: "freefire.html"
    },
    {
        name: "Honor of Kings Tokens",
        desc: "MOBA Top Up",
        img: "assets/games/hok.webp",
        link: "hok.html"
    }
];

function initLiveSearch() {
    const input = document.getElementById("searchInput");
    const dropdown = document.getElementById("searchDropdown");

    if (!input || !dropdown) return;

    input.addEventListener("input", () => {
        const keyword = input.value.toLowerCase().trim();

        if (!keyword) {
            dropdown.classList.remove("show");
            dropdown.innerHTML = "";
            return;
        }

        const results = searchItems.filter(item =>
            item.name.toLowerCase().includes(keyword) ||
            item.desc.toLowerCase().includes(keyword)
        );

        if (!results.length) {
            dropdown.innerHTML = `<div class="no-search">No result found</div>`;
            dropdown.classList.add("show");
            return;
        }

        dropdown.innerHTML = results.map(item => `
            <a href="${item.link}" class="search-item">
                <img src="${item.img}" alt="${item.name}">
                <div>
                    <h4>${item.name}</h4>
                    <p>${item.desc}</p>
                </div>
            </a>
        `).join("");

        dropdown.classList.add("show");
    });

    document.addEventListener("click", e => {
        if (!e.target.closest(".search-box")) {
            dropdown.classList.remove("show");
        }
    });
}
