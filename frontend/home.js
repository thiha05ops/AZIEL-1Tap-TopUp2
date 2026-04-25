document.addEventListener("DOMContentLoaded", () => {
    const loader = document.getElementById("pageLoader");
    const searchBtn = document.getElementById("searchBtn");
    const searchWrap = document.getElementById("searchWrap");
    const searchInput = document.getElementById("searchInput");
    const featuredGrid = document.getElementById("featuredGrid");
    const regionSelect = document.getElementById("regionSelect");
    const loginBtn = document.getElementById("loginBtn");

    const token = localStorage.getItem("token");
    const username = localStorage.getItem("username");
    const savedRegion = localStorage.getItem("region") || "MM";

    const games = [
        {
            name: "Mobile Legends",
            icon: "💎",
            desc: "MLBB Diamonds Top Up",
            link: "shop.html"
        },
        {
            name: "PUBG Mobile",
            icon: "🔫",
            desc: "UC Top Up Coming Soon",
            link: "pubg.html"
        },
        {
            name: "Free Fire",
            icon: "🔥",
            desc: "Diamond Top Up Coming Soon",
            link: "freefire.html"
        },
        {
            name: "Honor of Kings",
            icon: "👑",
            desc: "Tokens Top Up Coming Soon",
            link: "hok.html"
        }
    ];

    setTimeout(() => {
        loader?.classList.add("hide");
    }, 900);

    function renderGames(keyword = "") {
        const filtered = games.filter(game =>
            game.name.toLowerCase().includes(keyword.toLowerCase())
        );

        featuredGrid.innerHTML = filtered.map(game => `
            <a href="${game.link}" class="game-card">
                <div class="game-icon">${game.icon}</div>
                <h4>${game.name}</h4>
                <p>${game.desc}</p>
                <span>Open</span>
            </a>
        `).join("");

        if (filtered.length === 0) {
            featuredGrid.innerHTML = `<p class="no-result">No game found.</p>`;
        }
    }

    regionSelect.value = savedRegion;
    regionSelect.addEventListener("change", () => {
        localStorage.setItem("region", regionSelect.value);
        renderGames(searchInput.value.trim());
    });

    searchBtn?.addEventListener("click", () => {
        searchWrap.classList.toggle("show");
        if (searchWrap.classList.contains("show")) {
            searchInput.focus();
        }
    });

    searchInput?.addEventListener("input", () => {
        renderGames(searchInput.value.trim());
    });

    if (token && username) {
        loginBtn.innerText = username;
        loginBtn.href = "account.html";
    }

    renderGames();
});