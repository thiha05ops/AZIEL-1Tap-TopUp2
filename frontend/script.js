document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    const username = localStorage.getItem("username");
    const savedRegion = localStorage.getItem("region") || "MM";

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    const searchBtn = document.getElementById("searchBtn");
    const searchWrap = document.getElementById("searchWrap");
    const searchInput = document.getElementById("searchInput");
    const regionSelect = document.getElementById("regionSelect");
    const regionLabel = document.getElementById("regionLabel");
    const packageGrid = document.getElementById("packageGrid");

    const buyBtn = document.getElementById("buyBtn");
    const userIdInput = document.getElementById("userId");
    const serverIdInput = document.getElementById("serverId");
    const errorMsg = document.getElementById("errorMsg");
    const selectedText = document.getElementById("selectedText");

    const paymentMethod = document.getElementById("paymentMethod");
    const paymentInfo = document.getElementById("paymentInfo");
    const paymentScreenshot = document.getElementById("paymentScreenshot");

    let selectedPackage = null;

    const packages = [
        { name: "Weekly Pass", prices: { MM: "6800 Ks", TH: "55 THB" } },
        { name: "56 💎", prices: { MM: "3850 Ks", TH: "49 THB" } },
        { name: "70 💎", prices: { MM: "5400 Ks", TH: "65 THB" } },
        { name: "86 💎", prices: { MM: "5700 Ks", TH: "69 THB" } },
        { name: "172 💎", prices: { MM: "12400 Ks", TH: "149 THB" } },
        { name: "275 💎", prices: { MM: "21800 Ks", TH: "259 THB" } },
        { name: "336 💎", prices: { MM: "22500 Ks", TH: "269 THB" } },
        { name: "344 💎", prices: { MM: "22800 Ks", TH: "275 THB" } },
        { name: "570 💎", prices: { MM: "35000 Ks", TH: "419 THB" } },
        { name: "706 💎", prices: { MM: "43000 Ks", TH: "515 THB" } },
        { name: "716 💎", prices: { MM: "51000 Ks", TH: "599 THB" } },
        { name: "1007+156 💎", prices: { MM: "69900 Ks", TH: "829 THB" } },
        { name: "1160+186 💎", prices: { MM: "84500 Ks", TH: "999 THB" } },
        { name: "1360+335 💎", prices: { MM: "127000 Ks", TH: "1499 THB" } },
        { name: "2015+383 💎", prices: { MM: "137800 Ks", TH: "1599 THB" } }
    ];

    function renderPackages(region, keyword = "") {
        const filtered = packages.filter(item =>
            item.name.toLowerCase().includes(keyword.toLowerCase())
        );

        packageGrid.innerHTML = filtered.map(item => `
            <div class="package-card ${selectedPackage === item.name ? "active" : ""}" data-value="${item.name}">
                <div class="package-name">${item.name}</div>
                <div class="package-price">${item.prices[region]}</div>
            </div>
        `).join("");

        if (filtered.length === 0) {
            packageGrid.innerHTML = `<p class="no-result">No package found.</p>`;
        }

        document.querySelectorAll(".package-card").forEach(card => {
            card.addEventListener("click", () => {
                document.querySelectorAll(".package-card").forEach(c => c.classList.remove("active"));
                card.classList.add("active");
                selectedPackage = card.dataset.value;
                selectedText.innerText = "Selected: " + selectedPackage;
            });
        });

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
        renderPackages(region, searchInput.value.trim());
    });

    searchBtn?.addEventListener("click", () => {
        searchWrap.classList.toggle("show");
        if (searchWrap.classList.contains("show")) {
            searchInput.focus();
        }
    });

    searchInput?.addEventListener("input", () => {
        renderPackages(regionSelect.value, searchInput.value.trim());
    });

    paymentMethod?.addEventListener("change", () => {
        const method = paymentMethod.value;

        if (method === "WavePay") {
            paymentInfo.innerText = "WavePay Number: 09403630868";
        } else if (method === "SCB") {
            paymentInfo.innerText = "SCB Number: 4321919025";
        } else {
            paymentInfo.innerText = "";
        }
    });

    buyBtn?.addEventListener("click", async () => {
        const userId = userIdInput.value.trim();
        const serverId = serverIdInput.value.trim();
        const method = paymentMethod.value;
        const file = paymentScreenshot.files[0];

        errorMsg.innerText = "";

        if (!selectedPackage) {
            errorMsg.innerText = "❌ Please select a package!";
            return;
        }

        if (!userId) {
            errorMsg.innerText = "❌ Please enter User ID!";
            return;
        }

        if (!serverId) {
            errorMsg.innerText = "❌ Please enter Server Code!";
            return;
        }

        if (!method) {
            errorMsg.innerText = "❌ Please select payment method!";
            return;
        }

        if (!file) {
            errorMsg.innerText = "❌ Please upload payment screenshot!";
            return;
        }

        const formData = new FormData();
        formData.append("username", username || "User");
        formData.append("userId", userId);
        formData.append("serverId", serverId);
        formData.append("selectedPackage", selectedPackage);
        formData.append("paymentMethod", method);
        formData.append("screenshot", file);

        try {
            const res = await fetch("/api/order", {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + token
                },
                body: formData
            });

            const data = await res.json();

            if (data.success) {
                errorMsg.innerText = "✅ Order sent!";
                userIdInput.value = "";
                serverIdInput.value = "";
                paymentMethod.value = "";
                paymentInfo.innerText = "";
                paymentScreenshot.value = "";
                selectedText.innerText = "ဝယ်ယူလိုသော ပစ္စည်းကိုရွေးပါ";
                selectedPackage = null;
                renderPackages(regionSelect.value, searchInput.value.trim());
            } else {
                errorMsg.innerText = "❌ " + data.message;
            }

        } catch (error) {
            console.error(error);
            errorMsg.innerText = "❌ Server error!";
        }
    });
});