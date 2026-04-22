document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    const username = localStorage.getItem("username");

    const welcomeText = document.getElementById("welcomeText");
    const logoutBtn = document.getElementById("logoutBtn");
    const mlbbCard = document.getElementById("mlbbCard");
    const comingSoonCard = document.getElementById("comingSoonCard");

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    if (welcomeText) {
        welcomeText.innerText = `Hello, ${username || "User"} 👋`;
    }

    mlbbCard?.addEventListener("click", () => {
        window.location.href = "shop.html";
    });

    comingSoonCard?.addEventListener("click", () => {
        alert("Coming Soon 🚀");
    });

    logoutBtn?.addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        localStorage.removeItem("isLoggedIn");

        window.location.href = "login.html";
    });
});