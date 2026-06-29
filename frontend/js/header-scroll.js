// frontend/js/header-scroll.js

(function () {
    let lastScrollY = window.scrollY;
    let ticking = false;

    function bindHeaderScroll() {
        const header = document.querySelector(".az-header");
        if (!header) return;

        window.addEventListener("scroll", () => {
            if (window.innerWidth > 768) return;

            if (!ticking) {
                window.requestAnimationFrame(() => {
                    const currentY = window.scrollY;

                    if (currentY < 40) {
                        header.classList.remove("nav-hidden");
                    } else if (currentY > lastScrollY) {
                        header.classList.add("nav-hidden");
                    } else {
                        header.classList.remove("nav-hidden");
                    }

                    lastScrollY = currentY;
                    ticking = false;
                });

                ticking = true;
            }
        }, { passive: true });
    }

    document.addEventListener("DOMContentLoaded", bindHeaderScroll);
    window.addEventListener("aziel:headerLoaded", bindHeaderScroll);
})();