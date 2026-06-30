// frontend/js/auth-check.js

document.addEventListener("DOMContentLoaded", () => {
    const token =
        window.AZIEL?.getToken?.() ||
        localStorage.getItem("token") ||
        sessionStorage.getItem("token");

    const protectedPages = [
        "account.html",
        "wallet.html",
        "notifications.html",
        "tracking.html"
    ];

    const currentPage =
        window.location.pathname.split("/").pop() || "home.html";

    if (!protectedPages.includes(currentPage)) return;

    if (!token) {
        localStorage.setItem(
            "redirectAfterLogin",
            window.location.href
        );

        window.location.href = "login.html";
    }
});