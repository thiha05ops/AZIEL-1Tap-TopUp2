// frontend/js/shop.js

document.addEventListener("DOMContentLoaded", () => {

    console.log("Shop Page Loaded ✅");

    // hero animation
    const title = document.querySelector(".shop-hero h1");

    if (title) {
        title.style.opacity = "0";
        title.style.transform = "translateY(20px)";

        setTimeout(() => {
            title.style.transition = "0.8s ease";
            title.style.opacity = "1";
            title.style.transform = "translateY(0)";
        }, 150);
    }

    // game cards effect
    const cards = document.querySelectorAll(".card");

    cards.forEach(card => {

        card.addEventListener("mouseenter", () => {
            card.style.transform = "translateY(-6px)";
            card.style.boxShadow = "0 12px 28px rgba(0,0,0,.15)";
        });

        card.addEventListener("mouseleave", () => {
            card.style.transform = "translateY(0)";
            card.style.boxShadow = "0 6px 18px rgba(0,0,0,.08)";
        });

        card.addEventListener("click", () => {
            card.style.transform = "scale(.97)";
            setTimeout(() => {
                card.style.transform = "translateY(-6px)";
            }, 120);
        });

    });

    // active nav
    const links = document.querySelectorAll(".topbar nav a");

    links.forEach(link => {
        const file = link.getAttribute("href");

        if (window.location.pathname.includes(file)) {
            link.style.color = "#ffd700";
            link.style.fontWeight = "bold";
        }
    });

    // logo click to top
    const logo = document.querySelector(".logo");

    if (logo) {
        logo.addEventListener("click", () => {
            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });
        });
    }

});