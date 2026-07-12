// frontend/js/admin-api.js
// AZIEL Admin V2.5 API Helper

function getAdminToken() {
    return localStorage.getItem("adminToken");
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

    if (res.status === 401 || res.status === 403 || data.forceLogout) {
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

const adminUploadFailedUrls = new Set();

function getAdminUploadedImageUrl(path, options = {}) {
    const value = String(path || "").trim();
    if (!value) return "";

    if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/uploads/")) {
        return value;
    }

    if (value.startsWith("QR-")) return `/uploads/payments/${value}`;
    if (value.startsWith("SLIP-")) return `/uploads/orders/${value}`;
    if (value.startsWith("wallet-")) return `/uploads/slips/${value}`;

    if (options.folder) {
        return `/uploads/${options.folder}/${value}`;
    }

    return `/uploads/${value}`;
}

function isAdminUploadedImageFailed(url) {
    return Boolean(url && adminUploadFailedUrls.has(url));
}

function markAdminUploadedImageFailed(url) {
    if (url) adminUploadFailedUrls.add(url);
}

function adminMissingImageHTML(message = "Image unavailable", tag = "p") {
    return `<${tag} class="admin-missing-image">${message}</${tag}>`;
}

function handleAdminUploadedImageError(img, message = "Image unavailable") {
    const src = img?.dataset?.src || img?.currentSrc || img?.src || "";
    markAdminUploadedImageFailed(src);

    const fallback = document.createElement("p");
    fallback.className = "admin-missing-image";
    fallback.textContent = message;
    img.replaceWith(fallback);
}

setInterval(checkAdminToken, 60000);
checkAdminToken();

document.addEventListener("DOMContentLoaded", () => {
    showAdminLogoutMessage();
});
