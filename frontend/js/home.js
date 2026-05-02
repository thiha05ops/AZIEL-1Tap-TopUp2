// frontend/js/home.js

document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username");

    const btn = document.getElementById("profileBtn");

    if (!btn) return;

    if (username) {
        btn.innerText = "👤 " + username;
    } else {
        btn.innerText = "👤 Login";
    }
});

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


/* Toast Function */
function showToast(text) {

    let toast = document.getElementById("siteToast");

    toast.innerText = text;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    clearTimeout(window.toastTimer);

    window.toastTimer = setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(20px)";
    }, 2600);
}
/* Flash Sale Countdown */
let totalSeconds = 3 * 60 * 60 - 1; // 3 hours

setInterval(() => {

    const timer = document.getElementById("saleTimer");
    if (!timer) return;

    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");

    timer.innerText = `${h}:${m}:${s}`;

    if (totalSeconds > 0) {
        totalSeconds--;
    } else {
        totalSeconds = 3 * 60 * 60 - 1;
    }

}, 1000);