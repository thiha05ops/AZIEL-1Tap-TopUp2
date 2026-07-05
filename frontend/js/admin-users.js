// frontend/js/admin-users.js

let allAdminUsers = [];

document.addEventListener("DOMContentLoaded", () => {
    loadAdminUsers();
});

async function loadAdminUsers() {
    const box = document.getElementById("adminUsersList");
    if (!box) return;

    box.innerHTML = `<div class="admin-list-empty">Loading users...</div>`;

    const data = await adminFetch("/api/admin/users");

    if (!data || !data.success) {
        box.innerHTML = `<div class="admin-list-empty">${data?.message || "Failed to load users"}</div>`;
        return;
    }

    allAdminUsers = Array.isArray(data.users) ? data.users : [];
    renderUsers(allAdminUsers);
}

function renderUsers(users) {
    const box = document.getElementById("adminUsersList");
    if (!box) return;

    if (!users.length) {
        box.innerHTML = `<div class="admin-list-empty">Users will appear here.</div>`;
        return;
    }

    box.innerHTML = users.map(user => {
        const id = escapeHTML(user._id || "");

        return `
            <div class="admin-user-card">
                <div class="user-top">
                    <div>
                        <h3>${escapeHTML(user.username || "Unknown")}</h3>
                        <span>${escapeHTML(user.region || "MM")}</span>
                        <p>${escapeHTML(user.email || "-")}</p>
                    </div>

                    <span class="user-badge ${user.isBlocked ? "blocked" : "active"}">
                        ${user.isBlocked ? "Blocked" : "Active"}
                    </span>
                </div>

                <div class="user-stats">
                    <div><small>Orders</small><strong>${Number(user.totalOrders || 0).toLocaleString()}</strong></div>
                    <div><small>Total Spent</small><strong>${Number(user.totalSpent || 0).toLocaleString()}</strong></div>
                    <div><small>MMK Wallet</small><strong>${Number(user.wallet?.MMK || 0).toLocaleString()}</strong></div>
                    <div><small>THB Wallet</small><strong>${Number(user.wallet?.THB || 0).toLocaleString()}</strong></div>
                </div>

                <div class="user-actions">
                    <button data-action="toggle-block" data-id="${id}">
                        ${user.isBlocked ? "Unblock" : "Block"}
                    </button>
                    <button data-action="delete-user" data-id="${id}">
                        Delete
                    </button>
                </div>
            </div>
        `;
    }).join("");

    bindUserActions();
}

function bindUserActions() {
    document.querySelectorAll('[data-action="toggle-block"]').forEach(btn => {
        btn.addEventListener("click", () => toggleUserBlock(btn.dataset.id));
    });

    document.querySelectorAll('[data-action="delete-user"]').forEach(btn => {
        btn.addEventListener("click", () => deleteUser(btn.dataset.id));
    });
}

async function toggleUserBlock(userId) {
    const data = await adminFetch(`/api/admin/users/${userId}/block`, {
        method: "PUT"
    });

    if (!data || !data.success) {
        showAdminToast?.(data?.message || "User update failed", "error");
        return;
    }

    showAdminToast?.("User updated", "success");
    loadAdminUsers();
}

async function deleteUser(userId) {
    if (!confirm("Delete this user?")) return;

    const data = await adminFetch(`/api/admin/users/${userId}`, {
        method: "DELETE"
    });

    if (!data || !data.success) {
        showAdminToast?.(data?.message || "Delete failed", "error");
        return;
    }

    showAdminToast?.("User deleted", "success");
    loadAdminUsers();
    loadAdminDashboard?.(false);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.loadAdminUsers = loadAdminUsers;