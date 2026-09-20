// frontend/js/auth-check.js

document.addEventListener("DOMContentLoaded", () => {
    const token =
        window.AZIEL?.getToken?.() ||
        localStorage.getItem("token") ||
        sessionStorage.getItem("token");

    const protectedPages = [
        "/account",
        "/wallet",
        "/notifications",
        "/orders"
    ];

    const currentPage =
        (window.location.pathname || "/").replace(/\/$/, "") || "/";

    if (!protectedPages.includes(currentPage)) return;

    if (!token) {
        localStorage.setItem(
            "redirectAfterLogin",
            window.location.href
        );

        window.location.href = "/login";
    }
});
