// frontend/js/home.js

document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username");
    const displayName = localStorage.getItem("displayName") || username;

    const avatarText = document.getElementById("avatarText");
    const usernameText = document.getElementById("usernameText");
    const profileBox = document.getElementById("profileBox");
    const profileDropdown = document.getElementById("profileDropdown");
    const logoutBtn = document.getElementById("logoutBtn");
    const notiBtn = document.getElementById("notiBtn");
    const notiCount = document.getElementById("notiCount");
    const searchInput = document.getElementById("searchInput");

    // Profile
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

    // Notification
    if (notiBtn) {
        notiBtn.addEventListener("click", (e) => {
            e.stopPropagation();

            if (!username) {
                window.location.href = "login.html";
                return;
            }

            window.location.href = "notifications.html";
        });
    }

    if (username && notiCount) {
        loadNotificationCount(username, notiCount);
        setInterval(() => loadNotificationCount(username, notiCount), 8000);
    }

    // Slider
    initHeroSlider();

    // Coming soon cards
    document.querySelectorAll(".coming-soon-card").forEach(card => {
        card.addEventListener("click", () => {
            showToast("Coming soon 🚀");
        });
    });

    // Active cards login guard
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

    // Search
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            const keyword = searchInput.value.toLowerCase().trim();
            const cards = document.querySelectorAll(".catalog-card, .offer-card");

            cards.forEach(card => {
                const name =
                    (card.dataset.name || card.innerText || "")
                        .toLowerCase();

                card.style.display = name.includes(keyword) ? "" : "none";
            });
        });
    }
});

function initHeroSlider() {
    const slides = document.querySelectorAll(".hero-slide");
    const dots = document.querySelectorAll(".dot");

    if (!slides.length) return;

    let current = 0;

    function showSlide(index) {
        slides.forEach(s => s.classList.remove("active"));
        dots.forEach(d => d.classList.remove("active"));

        slides[index].classList.add("active");
        if (dots[index]) dots[index].classList.add("active");

        current = index;
    }

    dots.forEach(dot => {
        dot.addEventListener("click", () => {
            showSlide(Number(dot.dataset.slide));
        });
    });

    setInterval(() => {
        const next = (current + 1) % slides.length;
        showSlide(next);
    }, 4500);
}

async function loadNotificationCount(username, badge) {
    try {
        const res = await fetch(`/api/history/${username}`);
        const data = await res.json();

        if (!data.success || !data.orders) {
            badge.innerText = "0";
            return;
        }

        const activeOrders = data.orders.filter(o => o.status !== "completed");
        badge.innerText = activeOrders.length;

    } catch (error) {
        badge.innerText = "0";
    }
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