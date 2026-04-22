document.addEventListener("DOMContentLoaded", () => {
    const isLoggedIn = localStorage.getItem("isLoggedIn");
    const username = localStorage.getItem("username");
    const welcomeText = document.getElementById("welcomeText");
    const logoutBtn = document.getElementById("logoutBtn");
    const mlbbCard = document.getElementById("mlbbCard");
    const comingSoonCard = document.getElementById("comingSoonCard");

    if (isLoggedIn !== "true") {
        window.location.href = "login.html";
        return;
    }

    welcomeText.innerText = `Hello, ${username || "User"} 👋`;

    mlbbCard.addEventListener("click", () => {
        window.location.href = "shop.html";
    });

    comingSoonCard.addEventListener("click", () => {
        alert("Coming Soon 🚀");
    });

    logoutBtn.addEventListener("click", () => {
        localStorage.removeItem("isLoggedIn");
        localStorage.removeItem("username");
        window.location.href = "login.html";
    });
}); document.addEventListener("DOMContentLoaded", () => {
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
        localStorage.removeItem("isLoggedIn");
        localStorage.removeItem("username");
        localStorage.removeItem("token");
        window.location.href = "login.html";
    });
});