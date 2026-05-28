// frontend/js/user-info.js

document.addEventListener("DOMContentLoaded", () => {

    const userBox = document.getElementById("userBox");
    const username = localStorage.getItem("username");

    if (userBox && username) {

        userBox.innerHTML = `👤 ${username}`;

    }

});
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