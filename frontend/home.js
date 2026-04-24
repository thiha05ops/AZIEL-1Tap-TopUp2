document.addEventListener("DOMContentLoaded", () => {
    const searchBtn = document.getElementById("searchBtn");
    const searchWrap = document.getElementById("searchWrap");
    const searchInput = document.getElementById("searchInput");
    const featuredGrid = document.getElementById("featuredGrid");
    const regionSelect = document.getElementById("regionSelect");
    const regionLabel = document.getElementById("regionLabel");
    const loginBtn = document.getElementById("loginBtn");
    async function loadNotificationCount() {
        const token = localStorage.getItem("token");
        const username = localStorage.getItem("username");
        const notiCount = document.getElementById("notiCount");

        if (!token || !username || !notiCount) return;

        try {
            const res = await fetch(`/api/history/${username}`);
            const data = await res.json();

            if (data.success) {
                const activeOrders = data.orders.filter(o => o.status !== "Done" && o.status !== "Cancelled");
                notiCount.innerText = activeOrders.length;
            }
        } catch (error) {
            console.log(error);
        }
    }

    loadNotificationCount();
    setInterval(loadNotificationCount, 10000);

    const token = localStorage.getItem("token");
    const username = localStorage.getItem("username");
    const savedRegion = localStorage.getItem("region") || "MM";

    const packages = [
        {
            name: "Weekly Pass",
            prices: { MM: "6800 Ks", TH: "55 THB" }
        },
        {
            name: "86 💎",
            prices: { MM: "5700 Ks", TH: "45 THB" }
        },
        {
            name: "172 💎",
            prices: { MM: "12400 Ks", TH: "88 THB" }
        },
        {
            name: "275 💎",
            prices: { MM: "21800 Ks", TH: "159 THB" }
        },
        {
            name: "570 💎",
            prices: { MM: "35000 Ks", TH: "274 THB" }
        },
        {
            name: "1007+156 💎",
            prices: { MM: "69900 Ks", TH: "545 THB" }
        }
    ];

    function renderPackages(region) {
        featuredGrid.innerHTML = packages.map(item => `
            <div class="featured-item">
                <div class="featured-name">${item.name}</div>
                <div class="featured-price">${item.prices[region]}</div>
                <a href="shop.html" class="featured-buy">Buy Now</a>
            </div>
        `).join("");

        regionLabel.innerText =
            region === "MM"
                ? "Showing prices for Myanmar"
                : "Showing prices for Thailand";
    }

    regionSelect.value = savedRegion;
    renderPackages(savedRegion);

    regionSelect.addEventListener("change", () => {
        const region = regionSelect.value;
        localStorage.setItem("region", region);
        renderPackages(region);
    });

    searchBtn?.addEventListener("click", () => {
        searchWrap.classList.toggle("show");

        if (searchWrap.classList.contains("show")) {
            searchInput.focus();
        }
    });

    searchInput?.addEventListener("input", () => {
        const keyword = searchInput.value.toLowerCase().trim();
        const region = regionSelect.value;

        const filtered = packages.filter(item =>
            item.name.toLowerCase().includes(keyword)
        );

        featuredGrid.innerHTML = filtered.map(item => `
            <div class="featured-item">
                <div class="featured-name">${item.name}</div>
                <div class="featured-price">${item.prices[region]}</div>
                <a href="shop.html" class="featured-buy">Buy Now</a>
            </div>
        `).join("");

        if (filtered.length === 0) {
            featuredGrid.innerHTML = `<p class="no-result">No package found.</p>`;
        }
    });

    if (token && username) {
        loginBtn.innerText = username;
        loginBtn.href = "account.html";
    }
});