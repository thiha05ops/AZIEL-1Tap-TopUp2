// frontend/js/admin-users.js

let allAdminUsers = [];
const adminUsersPaging = {
    limit: 50,
    nextCursor: "",
    hasMore: false,
    loading: false,
    requestId: 0
};

document.addEventListener("DOMContentLoaded", () => {
    loadAdminUsers();
});

async function loadAdminUsers(options = {}) {
    const box = document.getElementById("adminUsersList");
    if (!box) return;

    const append = Boolean(options.append);
    if (append && (adminUsersPaging.loading || !adminUsersPaging.hasMore)) return;
    if (!append) {
        adminUsersPaging.nextCursor = "";
        adminUsersPaging.hasMore = false;
    }

    adminUsersPaging.loading = true;
    const requestId = ++adminUsersPaging.requestId;

    if (!append) box.innerHTML = `<div class="admin-list-empty">Loading users...</div>`;
    else renderUsers(allAdminUsers);

    try {
        const data = await adminFetch(buildAdminUsersEndpoint(append ? adminUsersPaging.nextCursor : ""));

        if (requestId !== adminUsersPaging.requestId) return;

        if (!data || !data.success) {
            box.innerHTML = `<div class="admin-list-empty">${data?.message || "Failed to load users"}</div>`;
            return;
        }

        const incoming = Array.isArray(data.users) ? data.users : Array.isArray(data.items) ? data.items : [];
        allAdminUsers = append ? mergeUsers(allAdminUsers, incoming) : incoming;
        adminUsersPaging.hasMore = Boolean(data.pagination?.hasMore);
        adminUsersPaging.nextCursor = data.pagination?.nextCursor || "";
        renderUsers(allAdminUsers);
    } finally {
        if (requestId === adminUsersPaging.requestId) {
            adminUsersPaging.loading = false;
            renderUsers(allAdminUsers);
        }
    }
}

function buildAdminUsersEndpoint(cursor = "") {
    const params = new URLSearchParams({ limit: String(adminUsersPaging.limit) });
    if (cursor) params.set("cursor", cursor);
    return `/api/admin/users?${params.toString()}`;
}

function mergeUsers(current = [], incoming = []) {
    const seen = new Set(current.map(user => String(user._id)));
    const merged = current.slice();
    incoming.forEach(user => {
        const id = String(user._id || "");
        if (!id || seen.has(id)) return;
        seen.add(id);
        merged.push(user);
    });
    return merged;
}

function renderUsers(users) {
    const box = document.getElementById("adminUsersList");
    if (!box) return;

    if (!users.length) {
        box.innerHTML = `<div class="admin-list-empty">Users will appear here.</div>`;
        return;
    }

    const cards = users.map(user => {
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

    const loadMore = adminUsersPaging.hasMore ? `
        <button class="admin-load-more-btn" id="adminUsersLoadMoreBtn" type="button" ${adminUsersPaging.loading ? "disabled" : ""}>
            ${adminUsersPaging.loading ? "Loading..." : "Load More"}
        </button>
    ` : "";

    box.innerHTML = cards + loadMore;

    window.AZIEL_MOTION?.enter(box, "fast");

    bindUserActions();
    document.getElementById("adminUsersLoadMoreBtn")?.addEventListener("click", () => loadAdminUsers({ append: true }));
}

function bindUserActions() {
    document.querySelectorAll('[data-action="toggle-block"]').forEach(btn => {
        btn.addEventListener("click", () => toggleUserBlock(btn.dataset.id));
    });

    document.querySelectorAll('[data-action="delete-user"]').forEach(btn => {
        btn.addEventListener("click", () => deleteUser(btn.dataset.id, btn));
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

async function deleteUser(userId, btn = null) {
    const confirmed = window.AZIEL_UI?.confirm
        ? await window.AZIEL_UI.confirm({
            title: "Delete user",
            message: "Delete this user?",
            confirmText: "Delete"
        })
        : confirm("Delete this user?");

    if (!confirmed) return;

    try {
        window.AZIEL_UI?.button?.setLoading(btn, { text: "Deleting..." });

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
    } finally {
        window.AZIEL_UI?.button?.reset(btn);
    }
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
