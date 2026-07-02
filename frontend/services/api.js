// frontend/js/api.js

function getToken() {
    return (
        localStorage.getItem("token") ||
        sessionStorage.getItem("token")
    );
}

function logoutUser(message = "") {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("isLogin");
    localStorage.removeItem("displayName");
    localStorage.removeItem("email");
    localStorage.removeItem("role");

    sessionStorage.removeItem("token");
    sessionStorage.removeItem("username");

    if (message) {
        localStorage.setItem("logoutMessage", message);
    }

    window.location.href = "login.html";
}

function isTokenExpired(token) {
    try {
        const payload = JSON.parse(
            atob(token.split(".")[1])
        );

        if (!payload.exp) {
            return false;
        }

        return payload.exp * 1000 < Date.now();

    } catch (error) {
        return true;
    }
}

function checkToken() {
    const token = getToken();

    if (!token) {
        return;
    }

    if (isTokenExpired(token)) {
        logoutUser("Session expired. Please login again.");
    }
}

async function apiFetch(url, options = {}) {
    checkToken();

    const token = getToken();

    const headers = {
        ...(options.headers || {})
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url, {
        ...options,
        headers
    });

    let data = {};

    try {
        data = await res.json();
    } catch (error) {
        data = {};
    }

    if (res.status === 401 || data.forceLogout) {
        const message =
            data.reason === "another_device"
                ? "Your account was logged in on another device."
                : data.reason === "inactive"
                    ? "Your session expired because this account was inactive for 15 days."
                    : data.message || "Login expired. Please login again.";

        logoutUser(message);
        return null;
    }

    return data;
}

function showLogoutMessage() {
    const msg = localStorage.getItem("logoutMessage");

    if (!msg) {
        return;
    }

    alert(msg);
    localStorage.removeItem("logoutMessage");
}

// AUTO CHECK EVERY 1 MINUTE
setInterval(checkToken, 60000);

// CHECK ON PAGE LOAD
checkToken();

document.addEventListener("DOMContentLoaded", () => {
    showLogoutMessage();
});