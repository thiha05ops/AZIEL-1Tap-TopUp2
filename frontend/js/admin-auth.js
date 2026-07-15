// frontend/js/admin-auth.js
// Shared Admin identity and permission helper. Backend remains authorization truth.

(function () {
    const state = {
        admin: null,
        permissions: [],
        currentSession: null,
        loaded: false
    };

    function hasPermission(permission) {
        return state.permissions.includes(permission);
    }

    async function loadMe() {
        if (!localStorage.getItem("adminToken")) return null;

        const data = await adminFetch("/api/admin/me", { skipPermissionToast: true });
        if (!data?.success) return null;

        state.admin = data.admin || null;
        state.permissions = Array.isArray(data.permissions) ? data.permissions : [];
        state.currentSession = data.currentSession || null;
        state.loaded = true;
        localStorage.setItem("adminUsername", state.admin?.username || "");
        localStorage.setItem("adminRole", state.admin?.role || "");

        applyPermissionVisibility();
        window.dispatchEvent(new CustomEvent("aziel:admin-auth-ready", { detail: { admin: state.admin } }));
        return state.admin;
    }

    function applyPermissionVisibility(root = document) {
        root.querySelectorAll("[data-admin-permission]").forEach(element => {
            const required = String(element.dataset.adminPermission || "").split(",").map(item => item.trim()).filter(Boolean);
            const allowed = required.length === 0 || required.some(hasPermission);
            element.hidden = !allowed;
            element.classList.toggle("admin-permission-hidden", !allowed);
        });
    }

    function requirePermission(permission) {
        return hasPermission(permission);
    }

    window.AZIEL_ADMIN_AUTH = {
        state,
        applyPermissionVisibility,
        hasPermission,
        loadMe,
        requirePermission
    };

    document.addEventListener("DOMContentLoaded", () => {
        if (document.body?.classList.contains("admin-body")) {
            loadMe();
        }
    });
})();
