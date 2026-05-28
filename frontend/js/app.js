/* =========================
   APP START
========================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        initProfile();

        initHeroSlider();

    }
);

/* =========================
   PROFILE
========================= */

function initProfile() {

    const username =
        localStorage.getItem("username");

    const displayName =
        localStorage.getItem("displayName")
        || username;

    const avatar =
        document.getElementById("avatarText");

    const usernameText =
        document.getElementById("usernameText");

    if (!avatar || !usernameText) return;

    if (username) {

        avatar.innerText =
            displayName.charAt(0).toUpperCase();

        usernameText.innerText =
            displayName;

    } else {

        avatar.innerHTML =
            `<i class="fa-regular fa-user"></i>`;

        usernameText.innerText =
            "Login";

    }

}

/* =========================
   HERO SLIDER
========================= */

function initHeroSlider() {

    const slides =
        document.querySelectorAll(
            ".hero-slide"
        );

    const dots =
        document.querySelectorAll(
            ".dot"
        );

    if (!slides.length) return;

    let current = 0;

    function showSlide(index) {

        slides.forEach(slide =>
            slide.classList.remove("active")
        );

        dots.forEach(dot =>
            dot.classList.remove("active")
        );

        slides[index].classList.add(
            "active"
        );

        if (dots[index]) {

            dots[index].classList.add(
                "active"
            );

        }

        current = index;

    }

    dots.forEach(dot => {

        dot.addEventListener(
            "click",
            () => {

                showSlide(
                    Number(
                        dot.dataset.slide
                    )
                );

            }
        );

    });

    setInterval(() => {

        const next =
            (current + 1)
            % slides.length;

        showSlide(next);

    }, 4500);

}
document.addEventListener("click", e => {
    const link = e.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) return;

    const url = new URL(href, window.location.href);

    if (url.origin === window.location.origin) {
        e.preventDefault();
        window.location.href = url.pathname + url.search + url.hash;
    }
});