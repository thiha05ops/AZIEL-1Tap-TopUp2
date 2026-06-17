// frontend/js/auth-check.js

document.addEventListener("DOMContentLoaded", () => {
    const token =
        localStorage.getItem("token") ||
        sessionStorage.getItem("token");

    const isLogin =
        localStorage.getItem("isLogin") === "true" ||
        sessionStorage.getItem("isLogin") === "true";

    if (!token || !isLogin) {
        localStorage.setItem("redirectAfterLogin", window.location.href);
        window.location.href = "login.html";
    }
});