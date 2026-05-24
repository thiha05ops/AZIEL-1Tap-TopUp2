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

    const slides =
        document.querySelectorAll(".hero-slide");

    const dots =
        document.querySelectorAll(".dot");

    if (!slides.length) return;

    let current = 0;

    let timer = null;

    function showSlide(index) {

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

    function nextSlide() {

        let next =
            (current + 1) % slides.length;

        showSlide(next);

    }

    function startSlider() {

        clearInterval(timer);

        timer = setInterval(() => {

            nextSlide();

        }, 4500);

    }

    dots.forEach(dot => {

        dot.addEventListener("click", () => {

            const slideIndex =
                Number(dot.dataset.slide);

            showSlide(slideIndex);

            startSlider();

        });

    });

    showSlide(0);

    startSlider();

}