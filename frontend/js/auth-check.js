// frontend/js/auth-check.js

document.addEventListener("DOMContentLoaded", () => {

    const isLogin = localStorage.getItem("isLogin");

    // pages that need login
    const protectedPages = [
        "shop.html",
        "mlbb.html",
        "pubg.html",
        "freefire.html",
        "hok.html"
    ];

    const currentPage = window.location.pathname.split("/").pop();

    if (protectedPages.includes(currentPage)) {

        if (isLogin !== "true") {
            window.location.href = "login.html";
        }

    }

});