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
            image: "assets/mlbb.jpg",
            desc: "MLBB Diamonds Top Up",
            link: "shop.html",
            className: "mlbb-card",
            badge: "HOT"
        },
        {
            name: "PUBG Mobile",
            image: "assets/pubg.jpg",
            desc: "UC Top Up Coming Soon",
            link: "pubg.html",
            className: "pubg-card",
            badge: "NEW"
        },
        {
            name: "Free Fire",
            image: "assets/freefire.jpg",
            desc: "Diamond Top Up Coming Soon",
            link: "freefire.html",
            className: "ff-card",
            badge: "SOON"
        },
        {
            name: "Honor of Kings",
            image: "assets/hok.jpg",
            desc: "Tokens Top Up Coming Soon",
            link: "hok.html",
            className: "hok-card",
            badge: "SOON"
        }
    ];

    setTimeout(() => {
        loader?.classList.add("hide");
    }, 900);

    featuredGrid.innerHTML = filtered.map(game => `
    <a href="${game.link}" class="game-card ultra-game-card ${game.className}">
        <div class="game-image-wrap">
            <img src="${game.image}" alt="${game.name}" class="game-img">
            <span class="game-badge">${game.badge}</span>
            <div class="game-shine"></div>
        </div>

        <div class="game-card-body">
            <h4>${game.name}</h4>
            <p>${game.desc}</p>
            <span class="open-btn">Open</span>
        </div>
    </a>
`).join("");
    featuredGrid.innerHTML = filtered.map(game => `
    <a href="${game.link}" class="game-card">
        <img src="${game.image}" alt="${game.name}" class="game-img">
        <div class="game-card-body">
            <h4>${game.name}</h4>
            <p>${game.desc}</p>
            <span>Open</span>
        </div>
    </a>
 `).join("");

    if (filtered.length === 0) {
        featuredGrid.innerHTML = `< p class="no-result" > No game found.</p > `;
    }
});
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
