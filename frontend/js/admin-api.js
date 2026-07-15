// frontend/js/admin-api.js
// AZIEL Admin V2.5 API Helper

function getAdminToken() {
    return localStorage.getItem("adminToken");
}

async function adminLogout(message = "") {
    const token = localStorage.getItem("adminToken");

    if (token) {
        try {
            await fetch("/api/admin/logout", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (error) {
            console.warn("Admin server logout failed; clearing local session only.");
        }
    }

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

class AdminApiError extends Error {
    constructor(options = {}) {
        super(options.message || "Admin request failed");
        this.name = "AdminApiError";
        this.status = Number(options.status || 0);
        this.code = options.code || "";
        this.details = options.details || null;
    }
}

function normalizeAdminApiError(response = null, body = {}) {
    return new AdminApiError({
        status: response?.status || body?.status || 0,
        code: body?.code || body?.error || "",
        message: body?.message || "Admin request failed",
        details: body?.details || null
    });
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

    if (res.status === 403 && !options.skipPermissionToast) {
        const message = data.message || "Admin permission denied.";
        if (window.AZIEL_UI?.toast) {
            window.AZIEL_UI.toast.error(message);
        } else {
            console.error(message);
        }
        return data;
    }

    if (res.status === 401 || data.forceLogout) {
        adminLogout(data.message || "Admin session expired.");
        return null;
    }

    return data;
}

window.AZIEL_ADMIN_API = {
    AdminApiError,
    normalizeError: normalizeAdminApiError
};

function showAdminLogoutMessage() {
    const msg = localStorage.getItem("adminLogoutMessage");

    if (!msg) return;

    localStorage.removeItem("adminLogoutMessage");

    setTimeout(() => {
        if (typeof showAdminToast === "function") {
            showAdminToast(msg, "error");
        } else if (window.AZIEL_UI?.toast) {
            window.AZIEL_UI.toast.error(msg);
        } else {
            console.error(msg);
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
