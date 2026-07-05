// frontend/js/admin-api.js
// AZIEL Admin V2.5 API Helper

function getAdminToken() {
    return (
        localStorage.getItem("adminToken") ||
        localStorage.getItem("token")
    );
}

function adminLogout(message = "") {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUsername");
    localStorage.removeItem("adminRole");

    if (message) {
        localStorage.setItem("adminLogoutMessage", message);
    }

    window.location.href = "admin-login.html";
}

function isAdminTokenExpired(token) {
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));

        if (!payload.exp) return false;

        return payload.exp * 1000 < Date.now();

    } catch (error) {
        return true;
    }
}

function checkAdminToken() {
    const token = getAdminToken();

    if (!token) return;

    if (isAdminTokenExpired(token)) {
        adminLogout("Admin session expired. Please login again.");
    }
}

async function adminFetch(url, options = {}) {
    checkAdminToken();

    const token = getAdminToken();

    if (!token) {
        adminLogout("Admin login required.");
        return null;
    }

    const headers = {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
    };

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
        adminLogout(data.message || "Admin session expired.");
        return null;
    }

    return data;
}

function showAdminLogoutMessage() {
    const msg = localStorage.getItem("adminLogoutMessage");

    if (!msg) return;

    localStorage.removeItem("adminLogoutMessage");

    setTimeout(() => {
        if (typeof showAdminToast === "function") {
            showAdminToast(msg, "error");
        } else {
            alert(msg);
        }
    }, 300);
}

setInterval(checkAdminToken, 60000);
checkAdminToken();

document.addEventListener("DOMContentLoaded", () => {
    showAdminLogoutMessage();
});