// frontend/js/home.js

document.addEventListener("DOMContentLoaded", () => {

    console.log("AZIEL Home Loaded ✅");

    // hero animation
    const hero = document.querySelector(".hero h1");
    if (hero) {
        hero.style.opacity = "0";
        hero.style.transform = "translateY(25px)";

        setTimeout(() => {
            hero.style.transition = "0.8s ease";
            hero.style.opacity = "1";
            hero.style.transform = "translateY(0)";
        }, 200);
    }

    // card hover click effect
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

    // active menu
    const links = document.querySelectorAll(".topbar nav a");

    links.forEach(link => {
        const file = link.getAttribute("href");

        if (window.location.pathname.includes(file)) {
            link.style.color = "#ffd700";
            link.style.fontWeight = "bold";
        }
    });

    // logo click top
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