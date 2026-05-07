// frontend/js/logout.js

document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("logoutBtn");

    if (!btn) return;

    btn.addEventListener("click", () => {
        localStorage.clear();
        window.location.href = "login.html";
    });
});