// frontend/js/auth-check.js

document.addEventListener("DOMContentLoaded", async () => {

    const protectedPages = [
        "/account",
        "/wallet",
        "/notifications",
        "/orders"
    ];

    const currentPage =
        (window.location.pathname || "/").replace(/\/$/, "") || "/";

    if (!protectedPages.includes(currentPage)) return;

    const user = window.AZIEL?.user || await window.AZIEL?.loadUser?.();
    if (!user) {
        localStorage.setItem(
            "redirectAfterLogin",
            window.location.href
        );

        window.location.href = "/login";
    }
});
