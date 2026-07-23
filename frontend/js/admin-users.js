// frontend/js/admin-users.js

let allAdminUsers = [];
let selectedCustomerId = "";
let selectedCustomerDetail = null;
let customerCrmActiveTab = "overview";
let customerSearchTimer = null;

const adminUsersPaging = {
    limit: 50,
    nextCursor: "",
    hasMore: false,
    loading: false,
    requestId: 0
};

document.addEventListener("DOMContentLoaded", () => {
    initCustomerCrm();
    loadAdminUsers();
});

function initCustomerCrm() {
    document.getElementById("refreshCustomersBtn")?.addEventListener("click", () => loadAdminUsers());
    document.getElementById("customerSearchInput")?.addEventListener("input", () => {
        clearTimeout(customerSearchTimer);
        customerSearchTimer = setTimeout(() => loadAdminUsers(), 250);
    });
    ["customerRegionFilter", "customerStatusFilter", "customerSortSelect"].forEach(id => {
        document.getElementById(id)?.addEventListener("change", () => loadAdminUsers());
    });

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section !== "users") return;
        if (event.detail?.context?.search) {
            const input = document.getElementById("customerSearchInput");
            if (input) input.value = event.detail.context.search;
        }
        loadAdminUsers();
    });
}

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

    if (!append) box.innerHTML = crmSkeletonRows();
    else renderUsers(allAdminUsers);

    try {
        const data = await adminFetch(buildAdminUsersEndpoint(append ? adminUsersPaging.nextCursor : ""));

        if (requestId !== adminUsersPaging.requestId) return;

        if (!data || !data.success) {
            box.innerHTML = crmEmptyState(data?.message || "Failed to load customers.", "Try refreshing the customer list.");
            return;
        }

        const incoming = Array.isArray(data.users) ? data.users : Array.isArray(data.items) ? data.items : [];
        allAdminUsers = append ? mergeUsers(allAdminUsers, incoming) : incoming;
        adminUsersPaging.hasMore = Boolean(data.pagination?.hasMore);
        adminUsersPaging.nextCursor = data.pagination?.nextCursor || "";
        renderUsers(allAdminUsers);

        if (!selectedCustomerId && allAdminUsers[0]?._id) {
            selectCustomer(allAdminUsers[0]._id);
        } else if (selectedCustomerId && !allAdminUsers.some(user => String(user._id) === String(selectedCustomerId))) {
            selectedCustomerId = "";
            selectedCustomerDetail = null;
            renderCustomerWorkspace();
        }
    } finally {
        if (requestId === adminUsersPaging.requestId) {
            adminUsersPaging.loading = false;
            renderUsers(allAdminUsers);
        }
    }
}

function buildAdminUsersEndpoint(cursor = "") {
    const params = new URLSearchParams({ limit: String(adminUsersPaging.limit) });
    const search = document.getElementById("customerSearchInput")?.value?.trim() || "";
    const region = document.getElementById("customerRegionFilter")?.value || "all";
    const status = document.getElementById("customerStatusFilter")?.value || "all";
    const sort = document.getElementById("customerSortSelect")?.value || "newest";
    if (cursor) params.set("cursor", cursor);
    if (search) params.set("q", search);
    params.set("region", region);
    params.set("status", status);
    params.set("sort", sort);
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
    const listScrollTop = box.scrollTop;

    if (!users.length) {
        box.innerHTML = crmEmptyState("No customers found.", "Try a different search or filter.");
        return;
    }

    const rows = users.map(user => `
        <button class="customer-row ${String(user._id) === String(selectedCustomerId) ? "active" : ""}" type="button" data-customer-id="${escapeHTML(user._id || "")}">
            <span class="customer-avatar">${avatarMarkup(user)}</span>
            <span class="customer-row-main">
                <strong>${escapeHTML(user.username || "Unknown")}</strong>
                <small>${escapeHTML(regionLabel(user.region))} · ${escapeHTML(formatDate(user.lastActivityAt || user.createdAt))}</small>
                <span class="customer-tags">${renderTagBadges(user.tags || [], 3)}</span>
            </span>
            <span class="customer-row-metrics">
                <b>${escapeHTML(formatMoney(user.totalSpend?.MMK, "MMK"))}</b>
                <b>${escapeHTML(formatMoney(user.totalSpend?.THB, "THB"))}</b>
                <small>${Number(user.totalOrders || 0).toLocaleString()} orders</small>
            </span>
            <span class="admin-status-pill ${user.isBlocked ? "is-danger" : "is-ok"}">${user.isBlocked ? "Blocked" : "Active"}</span>
        </button>
    `).join("");

    const loadMore = adminUsersPaging.hasMore ? `
        <button class="admin-load-more-btn" id="adminUsersLoadMoreBtn" type="button" ${adminUsersPaging.loading ? "disabled" : ""}>
            ${adminUsersPaging.loading ? "Loading..." : "Load More"}
        </button>
    ` : "";

    box.innerHTML = rows + loadMore;
    box.scrollTop = listScrollTop;
    box.querySelectorAll(".customer-row").forEach(row => {
        row.addEventListener("click", () => selectCustomer(row.dataset.customerId));
    });
    document.getElementById("adminUsersLoadMoreBtn")?.addEventListener("click", () => loadAdminUsers({ append: true }));
    window.AZIEL_MOTION?.enter(box, "fast");
}

async function selectCustomer(userId) {
    if (!userId) return;
    selectedCustomerId = userId;
    customerCrmActiveTab = customerCrmActiveTab || "overview";
    renderUsers(allAdminUsers);
    renderCustomerLoading();

    const data = await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/crm`);
    if (!data || !data.success) {
        selectedCustomerDetail = null;
        renderCustomerError(data?.message || "Customer details unavailable.");
        return;
    }

    selectedCustomerDetail = data;
    renderCustomerWorkspace();
    window.AZIEL_ADMIN_LAYOUT?.showDetail?.("users");
}

function renderCustomerWorkspace() {
    const box = document.getElementById("customerCrmWorkspace");
    if (!box) return;
    if (!selectedCustomerDetail?.customer) {
        box.innerHTML = `
            <div class="customer-crm-empty">
                <strong>Select a customer</strong>
                <span>Customer summary, orders, wallet history, activity, and notes will appear here.</span>
            </div>
        `;
        return;
    }

    const customer = selectedCustomerDetail.customer;
    const tabs = ["overview", "orders", "wallet", "activity", "notes"];
    box.innerHTML = `
        <header class="customer-profile-header">
            <button class="admin-secondary-btn customer-mobile-back" type="button" data-customer-back>Customers</button>
            <div class="customer-profile-identity">
                <span class="customer-avatar large">${avatarMarkup(customer)}</span>
                <div>
                    <h3>${escapeHTML(customer.displayName || customer.username)}</h3>
                    <p>${escapeHTML(customer.email || "No email")} · ${escapeHTML(regionLabel(customer.region))}</p>
                    <div class="customer-tags">${renderTagBadges(customer.tags || [], 8)}</div>
                </div>
            </div>
            <span class="admin-status-pill ${customer.isBlocked ? "is-danger" : "is-ok"}">${customer.isBlocked ? "Blocked" : "Active"}</span>
        </header>
        <div class="customer-tabs" role="tablist" aria-label="Customer workspace">
            ${tabs.map(tab => `<button type="button" class="${customerCrmActiveTab === tab ? "active" : ""}" data-customer-tab="${tab}">${titleCase(tab)}</button>`).join("")}
        </div>
        <div class="customer-tab-panel">${renderCustomerTab(customerCrmActiveTab)}</div>
    `;

    box.querySelectorAll("[data-customer-tab]").forEach(button => {
        button.addEventListener("click", () => {
            customerCrmActiveTab = button.dataset.customerTab || "overview";
            renderCustomerWorkspace();
        });
    });
    box.querySelector("[data-customer-back]")?.addEventListener("click", () => window.AZIEL_ADMIN_LAYOUT?.showList?.("users"));
    bindCustomerWorkspaceActions(box);
}

function renderCustomerTab(tab) {
    if (tab === "orders") return renderCustomerOrders();
    if (tab === "wallet") return renderCustomerWallet();
    if (tab === "activity") return renderCustomerActivity();
    if (tab === "notes") return renderCustomerNotes();
    return renderCustomerOverview();
}

function renderCustomerOverview() {
    const customer = selectedCustomerDetail.customer;
    const summary = customer.summary || {};
    const reward = customer.reward || { eligible: false, reasons: [] };
    const metrics = [
        ["Member Since", formatDate(customer.memberSince)],
        ["Last Login", formatDate(customer.lastLogin)],
        ["Last Purchase", formatDate(summary.lastPurchaseAt)],
        ["Total Orders", Number(summary.totalOrders || 0).toLocaleString()],
        ["Completed Orders", Number(summary.completedOrders || 0).toLocaleString()],
        ["Failed Orders", Number(summary.failedOrders || 0).toLocaleString()],
        ["Refund Count", Number(summary.refundCount || 0).toLocaleString()],
        ["Wallet Balance MMK", formatMoney(customer.wallet?.MMK, "MMK")],
        ["Wallet Balance THB", formatMoney(customer.wallet?.THB, "THB")],
        ["Total Spend MMK", formatMoney(summary.totalSpend?.MMK, "MMK")],
        ["Total Spend THB", formatMoney(summary.totalSpend?.THB, "THB")],
        ["Average Order MMK", formatMoney(summary.averageOrder?.MMK, "MMK")],
        ["Average Order THB", formatMoney(summary.averageOrder?.THB, "THB")],
        ["Lifetime Value MMK", formatMoney(summary.lifetimeValue?.MMK, "MMK")],
        ["Lifetime Value THB", formatMoney(summary.lifetimeValue?.THB, "THB")],
        ["Favorite Game", summary.favoriteGame || "None"],
        ["Favorite Payment", summary.favoritePaymentMethod || "None"]
    ];

    return `
        <div class="customer-summary-grid">
            ${metrics.map(([label, value]) => `<div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value || "-")}</strong></div>`).join("")}
        </div>
        <div class="customer-reward-panel">
            <strong>${reward.eligible ? "Reward Eligible" : "Not Eligible"}</strong>
            <span>${escapeHTML((reward.reasons || []).join(" · "))}</span>
            <small>Display only. No reward is sent from this workspace.</small>
        </div>
    `;
}

function renderCustomerOrders() {
    const orders = selectedCustomerDetail.orders || [];
    if (!orders.length) return crmEmptyState("No customer orders.", "Orders will appear here after checkout.");
    return `<div class="customer-record-list">${orders.map(order => `
        <button class="customer-record-row" type="button" data-open-order-id="${escapeHTML(order.orderId || "")}">
            <span><strong>${escapeHTML(order.orderId)}</strong><small>${escapeHTML(order.game)} · ${escapeHTML(order.packageName)}</small></span>
            <b>${escapeHTML(formatMoney(order.amount, order.currency))}</b>
            <span class="admin-status ${escapeHTML(statusClass(order.status))}">${escapeHTML(order.status || "-")}</span>
            <small>${escapeHTML(formatDate(order.date))}</small>
        </button>
    `).join("")}</div>`;
}

function renderCustomerWallet() {
    const customer = selectedCustomerDetail.customer;
    const rows = selectedCustomerDetail.wallet || [];
    return `
        <div class="customer-wallet-balances">
            <div><span>MMK Balance</span><strong>${escapeHTML(formatMoney(customer.wallet?.MMK, "MMK"))}</strong></div>
            <div><span>THB Balance</span><strong>${escapeHTML(formatMoney(customer.wallet?.THB, "THB"))}</strong></div>
        </div>
        ${rows.length ? `<div class="customer-record-list">${rows.map(item => `
            <div class="customer-record-row">
                <span><strong>${escapeHTML(item.type || "Wallet")}</strong><small>${escapeHTML(item.description || item.transactionId || "")}</small></span>
                <b>${escapeHTML(formatMoney(item.amount, item.currency))}</b>
                <span class="admin-status ${escapeHTML(statusClass(item.status))}">${escapeHTML(item.status || "-")}</span>
                <small>${escapeHTML(formatDate(item.date))}</small>
            </div>
        `).join("")}</div>` : crmEmptyState("No wallet history.", "Top-ups, debits, refunds, and adjustments will appear here.")}
    `;
}

function renderCustomerActivity() {
    const rows = selectedCustomerDetail.activity || [];
    if (!rows.length) return crmEmptyState("No activity yet.", "Customer events will appear here.");
    return `<div class="customer-timeline">${rows.map(item => `
        <div class="customer-timeline-item">
            <i></i>
            <span><strong>${escapeHTML(item.title || item.type)}</strong><small>${escapeHTML(item.description || "")}</small></span>
            ${item.amount ? `<b>${escapeHTML(formatMoney(item.amount, item.currency))}</b>` : ""}
            <em>${escapeHTML(formatDate(item.date))}</em>
        </div>
    `).join("")}</div>`;
}

function renderCustomerNotes() {
    const notes = selectedCustomerDetail.notes || [];
    return `
        <form id="customerNoteForm" class="customer-note-form">
            <textarea id="customerNoteInput" rows="3" placeholder="Add a private admin note"></textarea>
            <button class="admin-primary-btn" type="submit">Add Note</button>
        </form>
        ${notes.length ? `<div class="customer-notes-list">${notes.map(note => `
            <article class="customer-note-card">
                <textarea data-note-body="${escapeHTML(note._id)}">${escapeHTML(note.body)}</textarea>
                <div>
                    <span>${escapeHTML(note.adminName || "Admin")} · ${escapeHTML(formatDate(note.createdAt))}</span>
                    <button class="admin-secondary-btn" type="button" data-save-note="${escapeHTML(note._id)}">Save</button>
                    <button class="admin-danger-btn" type="button" data-delete-note="${escapeHTML(note._id)}">Delete</button>
                </div>
            </article>
        `).join("")}</div>` : crmEmptyState("No notes yet.", "Private admin notes will appear here.")}
    `;
}

function bindCustomerWorkspaceActions(root) {
    root.querySelectorAll("[data-open-order-id]").forEach(button => {
        button.addEventListener("click", () => {
            window.openAdminSection?.("orders", true, button.dataset.openOrderId ? { q: button.dataset.openOrderId } : {});
        });
    });

    root.querySelector("#customerNoteForm")?.addEventListener("submit", async event => {
        event.preventDefault();
        const input = document.getElementById("customerNoteInput");
        const body = input?.value?.trim() || "";
        if (!body) return;
        const data = await adminFetch(`/api/admin/users/${encodeURIComponent(selectedCustomerId)}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body })
        });
        if (!data || !data.success) {
            showAdminToast?.(data?.message || "Note could not be saved.", "error");
            return;
        }
        showAdminToast?.("Note added", "success");
        selectCustomer(selectedCustomerId);
    });

    root.querySelectorAll("[data-save-note]").forEach(button => {
        button.addEventListener("click", async () => saveCustomerNote(button.dataset.saveNote));
    });
    root.querySelectorAll("[data-delete-note]").forEach(button => {
        button.addEventListener("click", async () => deleteCustomerNote(button.dataset.deleteNote));
    });
}

async function saveCustomerNote(noteId) {
    const input = Array.from(document.querySelectorAll("[data-note-body]"))
        .find(item => item.dataset.noteBody === noteId);
    const body = input?.value?.trim() || "";
    if (!body) return;
    const data = await adminFetch(`/api/admin/users/${encodeURIComponent(selectedCustomerId)}/notes/${encodeURIComponent(noteId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body })
    });
    showAdminToast?.(data?.success ? "Note saved" : data?.message || "Note update failed", data?.success ? "success" : "error");
    if (data?.success) selectCustomer(selectedCustomerId);
}

async function deleteCustomerNote(noteId) {
    const confirmed = window.AZIEL_UI?.confirm
        ? await window.AZIEL_UI.confirm({ title: "Delete note", message: "Delete this private note?", confirmText: "Delete" })
        : confirm("Delete this private note?");
    if (!confirmed) return;
    const data = await adminFetch(`/api/admin/users/${encodeURIComponent(selectedCustomerId)}/notes/${encodeURIComponent(noteId)}`, { method: "DELETE" });
    showAdminToast?.(data?.success ? "Note deleted" : data?.message || "Note delete failed", data?.success ? "success" : "error");
    if (data?.success) selectCustomer(selectedCustomerId);
}

function renderCustomerLoading() {
    const box = document.getElementById("customerCrmWorkspace");
    if (box) box.innerHTML = `<div class="admin-dashboard-skeleton"></div><div class="admin-dashboard-skeleton"></div>`;
}

function renderCustomerError(message) {
    const box = document.getElementById("customerCrmWorkspace");
    if (box) box.innerHTML = `<div class="admin-dashboard-error"><strong>${escapeHTML(message)}</strong></div>`;
}

async function toggleUserBlock(userId) {
    const data = await adminFetch(`/api/admin/users/${userId}/block`, { method: "PUT" });
    showAdminToast?.(data?.success ? "Customer updated" : data?.message || "Customer update failed", data?.success ? "success" : "error");
    if (data?.success) loadAdminUsers();
}

async function deleteUser(userId, btn = null) {
    const confirmed = window.AZIEL_UI?.confirm
        ? await window.AZIEL_UI.confirm({ title: "Delete customer", message: "Delete this customer?", confirmText: "Delete" })
        : confirm("Delete this customer?");

    if (!confirmed) return;

    try {
        window.AZIEL_UI?.button?.setLoading(btn, { text: "Deleting..." });
        const data = await adminFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
        showAdminToast?.(data?.success ? "Customer deleted" : data?.message || "Delete failed", data?.success ? "success" : "error");
        if (data?.success) {
            selectedCustomerId = "";
            selectedCustomerDetail = null;
            loadAdminUsers();
            loadAdminDashboard?.(false);
        }
    } finally {
        window.AZIEL_UI?.button?.reset(btn);
    }
}

function avatarMarkup(user) {
    if (user.avatar) return `<img src="${escapeHTML(user.avatar)}" alt="">`;
    return escapeHTML(String(user.username || "?").trim().slice(0, 1).toUpperCase() || "?");
}

function renderTagBadges(tags = [], limit = 4) {
    const visible = tags.slice(0, limit);
    const extra = tags.length - visible.length;
    return visible.map(tag => `<em>${escapeHTML(tag)}</em>`).join("") + (extra > 0 ? `<em>+${extra}</em>` : "");
}

function crmSkeletonRows() {
    return `<div class="admin-dashboard-skeleton"></div><div class="admin-dashboard-skeleton"></div><div class="admin-dashboard-skeleton"></div>`;
}

function crmEmptyState(title, description) {
    return `<div class="admin-empty-state customer-empty-state"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(description || "")}</span></div>`;
}

function titleCase(value) {
    return String(value || "").replace(/(^|\s)\S/g, letter => letter.toUpperCase());
}

function statusClass(status) {
    const value = String(status || "").toLowerCase();
    if (["completed", "paid", "approved", "committed"].includes(value)) return "completed";
    if (["failed", "cancelled", "rejected", "reversed"].includes(value)) return "cancelled";
    if (["processing", "pending"].includes(value)) return "processing";
    return "info";
}

function regionLabel(region) {
    return String(region || "").toUpperCase() === "TH" ? "Thailand" : "Myanmar";
}

function formatMoney(value, currency) {
    return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: currency === "THB" ? 2 : 0 })} ${currency}`;
}

function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
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
