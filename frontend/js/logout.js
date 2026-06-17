// frontend/js/logout.js

document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("logoutBtn");

    if (!btn) return;

    btn.addEventListener("click", () => {
        localStorage.clear();
        window.location.href = "login.html";
    });
});
function logout() {

    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("displayName");
    localStorage.removeItem("region");

    sessionStorage.clear();

    window.location.href = "login.html";
}
// frontend/js/logout.js

function logout() {
    localStorage.removeItem("isLogin");
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("displayName");
    localStorage.removeItem("region");

    sessionStorage.removeItem("isLogin");
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("username");
    sessionStorage.removeItem("displayName");
    sessionStorage.removeItem("region");

    window.location.href = "login.html";
}