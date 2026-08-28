// frontend/js/home.js

document.addEventListener("DOMContentLoaded", () => {
    initUserHeader();
    initDrawer();
    initRegionPayments();
    initWalletPreview();
    initHomeHero();
});

function initHomeHero() {
    const searchButton = document.getElementById("homeHeroSearchBtn");
    if (!searchButton || searchButton.dataset.ready === "true") return;

    searchButton.dataset.ready = "true";
    searchButton.addEventListener("click", () => {
        if (window.AZIEL_SEARCH?.open) {
            window.AZIEL_SEARCH.open(searchButton);
            return;
        }

        window.addEventListener("aziel:searchReady", () => {
            window.AZIEL_SEARCH?.open?.(searchButton);
        }, { once: true });
    });
}

function initUserHeader() {
    const username = localStorage.getItem("username");
    const displayName = localStorage.getItem("displayName") || username;

    const avatarText = document.getElementById("avatarText");

    if (avatarText) {
        avatarText.innerText = username
            ? displayName.charAt(0).toUpperCase()
            : "👤";
    }
}

function initDrawer() {
    const mobileMenuBtn = document.getElementById("mobileMenuBtn");
    const mobileDrawer = document.getElementById("mobileDrawer");
    const mobileDrawerOverlay = document.getElementById("mobileDrawerOverlay");
    const closeDrawerBtn = document.getElementById("closeDrawerBtn");

    if (!mobileMenuBtn || !mobileDrawer || !mobileDrawerOverlay) return;

    function openMobileDrawer() {
        mobileDrawer.classList.add("show");
        mobileDrawerOverlay.classList.add("show");
        document.body.style.overflow = "hidden";
    }

    function closeMobileDrawer() {
        mobileDrawer.classList.remove("show");
        mobileDrawerOverlay.classList.remove("show");
        document.body.style.overflow = "";
    }

    mobileMenuBtn.addEventListener("click", openMobileDrawer);
    mobileDrawerOverlay.addEventListener("click", closeMobileDrawer);

    if (closeDrawerBtn) {
        closeDrawerBtn.addEventListener("click", closeMobileDrawer);
    }

    document.querySelectorAll(".az-mobile-drawer a").forEach(link => {
        link.addEventListener("click", closeMobileDrawer);
    });
}

function initRegionPayments() {
    const paymentLogos = document.getElementById("paymentLogos");
    if (!paymentLogos) return;

    const rawRegion =
        localStorage.getItem("selectedRegion") ||
        localStorage.getItem("region") ||
        localStorage.getItem("userRegion") ||
        localStorage.getItem("azielRegion") ||
        "MM";

    const region = rawRegion.toLowerCase();

    const isThailand =
        region.includes("thai") ||
        region.includes("thailand") ||
        region === "th" ||
        region.includes("ไทย");

    const logos = isThailand
        ? ["promptpay.png", "scb.png", "visa.png"]
        : ["kbzpay.png", "wavepay.png", "ayapay.png"];

    paymentLogos.innerHTML = logos.map(logo => `
        <img src="assets/payment/${logo}" alt="${logo}">
    `).join("");
}

function initWalletPreview() {
    const headerWalletText = document.getElementById("headerWalletText");

    if (!headerWalletText) return;

    const rawRegion =
        localStorage.getItem("selectedRegion") ||
        localStorage.getItem("region") ||
        "MM";

    const region = rawRegion.toLowerCase();

    const isThailand =
        region.includes("thai") ||
        region === "th" ||
        region.includes("ไทย");

    const currency = isThailand ? "THB" : "MMK";

    const walletMMK =
        localStorage.getItem("walletMMK") ||
        localStorage.getItem("balanceMMK") ||
        "48500";

    const walletTHB =
        localStorage.getItem("walletTHB") ||
        localStorage.getItem("balanceTHB") ||
        "0";

    const amount = isThailand ? walletTHB : walletMMK;

    headerWalletText.innerText = `${currency} ${Number(amount).toLocaleString()}`;
}
