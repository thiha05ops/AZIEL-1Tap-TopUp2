// frontend/js/home.js

document.addEventListener("DOMContentLoaded", () => {

    /* Region Save */
    const homeRegionSelect = document.getElementById("homeRegionSelect");

    if (homeRegionSelect) {
        const savedRegion = localStorage.getItem("region") || "MM";
        homeRegionSelect.value = savedRegion;

        homeRegionSelect.addEventListener("change", () => {
            localStorage.setItem("region", homeRegionSelect.value);

            showToast("Region updated ✅");
        });
    }

    /* Login gate for game cards */
    const gameCards = document.querySelectorAll(".game-card");

    gameCards.forEach(card => {
        card.addEventListener("click", (e) => {

            const isLogin = localStorage.getItem("isLogin");

            if (isLogin !== "true") {
                e.preventDefault();

                showToast("Please login first 🔐");

                setTimeout(() => {
                    window.location.href = "login.html";
                }, 900);
            }
        });
    });

    /* Recent fake orders popup */
    const fakeOrders = [
        "Thiha topped up MLBB 570 Diamonds",
        "Aung bought PUBG 325 UC",
        "Moe purchased Free Fire 520 Diamonds",
        "KoKo ordered HOK 400 Tokens"
    ];

    let orderIndex = 0;

    setInterval(() => {
        showToast("🔥 " + fakeOrders[orderIndex]);

        orderIndex++;

        if (orderIndex >= fakeOrders.length) {
            orderIndex = 0;
        }

    }, 9000);

});

/* Toast Function */
function showToast(text) {

    let toast = document.getElementById("siteToast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "siteToast";
        document.body.appendChild(toast);

        toast.style.position = "fixed";
        toast.style.bottom = "25px";
        toast.style.right = "25px";
        toast.style.background = "linear-gradient(90deg,#7c3aed,#4f46e5)";
        toast.style.color = "#fff";
        toast.style.padding = "14px 18px";
        toast.style.borderRadius = "14px";
        toast.style.fontWeight = "700";
        toast.style.zIndex = "99999";
        toast.style.boxShadow = "0 12px 28px rgba(0,0,0,.25)";
        toast.style.opacity = "0";
        toast.style.transition = ".3s";
        toast.style.maxWidth = "320px";
    }

    toast.innerText = text;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    clearTimeout(window.toastTimer);

    window.toastTimer = setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(20px)";
    }, 2600);
}