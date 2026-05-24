// frontend/js/home.js

document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username");
    const displayName = localStorage.getItem("displayName") || username;

    const avatarText = document.getElementById("avatarText");
    const usernameText = document.getElementById("usernameText");
    const profileBox = document.getElementById("profileBox");
    const profileDropdown = document.getElementById("profileDropdown");
    const logoutBtn = document.getElementById("logoutBtn");
    const searchInput = document.getElementById("searchInput");

    if (avatarText && usernameText) {
        if (username) {
            avatarText.innerText = displayName.charAt(0).toUpperCase();
            usernameText.innerText = displayName;
        } else {
            avatarText.innerText = "👤";
            usernameText.innerText = "Login";
        }
    }

    if (profileBox && profileDropdown) {
        profileBox.addEventListener("click", (e) => {
            e.stopPropagation();

            if (!username) {
                window.location.href = "login.html";
                return;
            }

            profileDropdown.style.display =
                profileDropdown.style.display === "flex" ? "none" : "flex";
        });

        document.addEventListener("click", () => {
            profileDropdown.style.display = "none";
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            localStorage.clear();
            window.location.href = "login.html";
        });
    }

    initHeroSlider();
    loadRegionPayments();

    document.querySelectorAll(".coming-soon-card").forEach(card => {
        card.addEventListener("click", () => {
            showToast("Coming soon 🚀");
        });
    });

    document.querySelectorAll(".active-card").forEach(card => {
        card.addEventListener("click", (e) => {
            if (!username) {
                e.preventDefault();
                showToast("Please login first 🔐");

                setTimeout(() => {
                    window.location.href = "login.html";
                }, 700);
            }
        });
    });

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            const keyword = searchInput.value.toLowerCase().trim();

            document
                .querySelectorAll(".compact-card, .catalog-card, .offer-card")
                .forEach(card => {
                    const name =
                        (card.dataset.name || card.innerText || "")
                            .toLowerCase();

                    card.style.display = name.includes(keyword) ? "" : "none";
                });
        });
    }
});

function initHeroSlider() {
    const slides = document.querySelectorAll(".hero-swiper .hero-slide");
    const dots = document.querySelectorAll(".hero-swiper .dot");

    if (!slides.length) return;

    let current = 0;
    let timer = null;

    function showSlide(index) {
        if (!slides[index]) return;

        slides.forEach(slide => {
            slide.classList.remove("active");
        });

        dots.forEach(dot => {
            dot.classList.remove("active");
        });

        slides[index].classList.add("active");

        if (dots[index]) {
            dots[index].classList.add("active");
        }

        current = index;
    }

    function startAutoSlide() {
        clearInterval(timer);

        timer = setInterval(() => {
            const next = (current + 1) % slides.length;
            showSlide(next);
        }, 4500);
    }

    dots.forEach(dot => {
        dot.addEventListener("click", () => {
            showSlide(Number(dot.dataset.slide));
            startAutoSlide();
        });
    });

    showSlide(0);
    startAutoSlide();
}

function showToast(text) {
    let toast = document.getElementById("siteToast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "siteToast";
        document.body.appendChild(toast);
    }

    toast.innerText = text;
    toast.style.position = "fixed";
    toast.style.bottom = "25px";
    toast.style.right = "25px";
    toast.style.background = "linear-gradient(135deg,#7c3aed,#9333ea)";
    toast.style.color = "#fff";
    toast.style.padding = "14px 18px";
    toast.style.borderRadius = "14px";
    toast.style.fontWeight = "800";
    toast.style.zIndex = "99999";
    toast.style.boxShadow = "0 0 25px rgba(168,85,247,.45)";
    toast.style.opacity = "1";
    toast.style.transition = ".3s";

    clearTimeout(window.toastTimer);

    window.toastTimer = setTimeout(() => {
        toast.style.opacity = "0";
    }, 2200);
}
function loadRegionPayments() {
    const box = document.getElementById("paymentLogos");
    const regionText = document.getElementById("paymentRegionText");

    if (!box) return;

    const rawRegion =
        localStorage.getItem("selectedRegion") ||
        localStorage.getItem("region") ||
        localStorage.getItem("userRegion") ||
        localStorage.getItem("azielRegion") ||
        "myanmar";

    const region = rawRegion.toLowerCase();

    const isThailand =
        region.includes("thai") ||
        region.includes("thailand") ||
        region.includes("th") ||
        region.includes("ไทย");

    const logos = isThailand
        ? ["promptpay.png", "scb.png"]
        : ["kbzpay.png", "wavepay.png", "ayapay.png"];

    regionText.innerText = isThailand ? "Thailand" : "Myanmar";

    box.innerHTML = logos.map(logo => `
        <img src="assets/payment/${logo}" alt="${logo}">
    `).join("");
}