// frontend/js/admin-orders.js
// AZIEL Admin V2.5 Orders Controller

let allAdminOrders = [];
let ordersAutoRefreshTimer = null;

document.addEventListener("DOMContentLoaded", () => {
    initOrderFilters();
    initOrderModal();
    loadOrders();

    ordersAutoRefreshTimer = setInterval(() => {
        if (!document.hidden) loadOrders(false);
    }, 20000);
});

async function loadOrders(showLoading = true) {
    const body = document.getElementById("adminOrdersBody");
    if (!body) return;

    if (showLoading) {
        body.innerHTML = `<tr><td colspan="6">Loading orders...</td></tr>`;
    }

    try {
        const data = await adminFetch("/api/admin/orders");

        if (!data || !data.success) {
            body.innerHTML = `<tr><td colspan="6">${escapeHTML(data?.message || "Failed to load orders")}</td></tr>`;
            return;
        }

        allAdminOrders = Array.isArray(data.orders) ? data.orders : [];
        applyOrderFilter();

    } catch (error) {
        console.log("Load orders error:", error);
        body.innerHTML = `<tr><td colspan="6">Server error while loading orders</td></tr>`;
    }
}

function initOrderFilters() {
    document.getElementById("orderSearchInput")?.addEventListener("input", applyOrderFilter);
    document.getElementById("orderStatusFilter")?.addEventListener("change", applyOrderFilter);
}

function applyOrderFilter() {
    const keyword = (document.getElementById("orderSearchInput")?.value || "").trim().toLowerCase();
    const status = document.getElementById("orderStatusFilter")?.value || "all";

    const filtered = allAdminOrders.filter(order => {
        const text = `
            ${order.orderId || ""}
            ${order.username || ""}
            ${order.game || ""}
            ${order.packageName || ""}
            ${order.userId || ""}
            ${order.zoneId || ""}
            ${order.paymentMethod || ""}
            ${order.region || ""}
            ${order.currency || ""}
        `.toLowerCase();

        const matchText = !keyword || text.includes(keyword);
        const matchStatus = status === "all" || order.status === status;

        return matchText && matchStatus;
    });

    renderOrders(filtered);
}

function renderOrders(orders) {
    const body = document.getElementById("adminOrdersBody");
    if (!body) return;

    if (!orders.length) {
        body.innerHTML = `<tr><td colspan="6">No orders found</td></tr>`;
        return;
    }

    body.innerHTML = orders.map(order => {
        const id = escapeHTML(order._id || "");
        const status = order.status || "pending_payment";

        return `
            <tr>
                <td>
                    <button class="order-link-btn" data-action="view-order" data-id="${id}">
                        ${escapeHTML(order.orderId || "-")}
                    </button>
                </td>

                <td>${escapeHTML(order.username || "-")}</td>
                <td>${escapeHTML(order.game || "-")}</td>
                <td>${escapeHTML(order.packageName || "-")}</td>

                <td>
                    <span class="admin-status ${normalizeStatus(status)}">
                        ${formatStatus(status)}
                    </span>
                </td>

                <td>
                    <select class="admin-status-select" data-action="status-change" data-id="${id}">
                        <option value="pending_payment" ${status === "pending_payment" ? "selected" : ""}>Pending</option>
                        <option value="paid" ${status === "paid" ? "selected" : ""}>Paid</option>
                        <option value="processing" ${status === "processing" ? "selected" : ""}>Processing</option>
                        <option value="completed" ${status === "completed" ? "selected" : ""}>Completed</option>
                        <option value="cancelled" ${status === "cancelled" ? "selected" : ""}>Cancelled</option>
                        <option value="failed" ${status === "failed" ? "selected" : ""}>Failed</option>
                    </select>
                </td>
            </tr>
        `;
    }).join("");

    bindOrderActions();
}

function bindOrderActions() {
    document.querySelectorAll('[data-action="view-order"]').forEach(btn => {
        btn.addEventListener("click", () => {
            const order = allAdminOrders.find(o => String(o._id) === String(btn.dataset.id));
            if (order) openOrderModal(order);
        });
    });

    document.querySelectorAll('[data-action="status-change"]').forEach(select => {
        select.addEventListener("change", () => {
            updateOrderStatus(select.dataset.id, select.value, select);
        });
    });
}

async function updateOrderStatus(orderId, status, selectEl = null) {
    if (!orderId || !status) return;

    const oldValue = allAdminOrders.find(o => String(o._id) === String(orderId))?.status;

    try {
        if (selectEl) selectEl.disabled = true;

        const data = await adminFetch(`/api/admin/orders/${orderId}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
        });

        if (!data || !data.success) {
            showAdminToast?.(data?.message || "Update failed", "error");
            if (selectEl && oldValue) selectEl.value = oldValue;
            return;
        }

        showAdminToast?.(`Order changed to ${formatStatus(status)}`, "success");

        await loadOrders(false);
        loadAdminDashboard?.(false);

    } catch (error) {
        console.log("Update order error:", error);
        showAdminToast?.("Server error", "error");
        if (selectEl && oldValue) selectEl.value = oldValue;
    } finally {
        if (selectEl) selectEl.disabled = false;
    }
}

function initOrderModal() {
    document.getElementById("closeOrderModal")?.addEventListener("click", closeOrderModal);

    document.getElementById("orderDetailModal")?.addEventListener("click", e => {
        if (e.target.id === "orderDetailModal") closeOrderModal();
    });

    document.addEventListener("keydown", e => {
        if (e.key === "Escape") closeOrderModal();
    });
}

function openOrderModal(order) {
    const modal = document.getElementById("orderDetailModal");
    const content = document.getElementById("orderDetailContent");
    if (!modal || !content) return;

    const slip = order.paymentSlip || order.screenshot || "";

    content.innerHTML = `
        <div class="order-detail-grid">
            ${detailItem("Order ID", order.orderId)}
            ${detailItem("Username", order.username)}
            ${detailItem("Game", order.game)}
            ${detailItem("Package", order.packageName)}
            ${detailItem("User ID", order.userId || "-")}
            ${detailItem("Server ID", order.zoneId || "-")}
            ${detailItem("Amount", `${Number(order.amount || 0).toLocaleString()} ${order.currency || ""}`)}
            ${detailItem("Region", order.region || "-")}
            ${detailItem("Payment", order.paymentMethod || "-")}
            ${detailItem("Status", formatStatus(order.status))}
            ${detailItem("Note", order.note || "-")}
            ${detailItem("Created", formatDate(order.createdAt))}
        </div>

        ${slip ? `
            <div class="order-screenshot-box">
                <small>Payment Slip</small>
                <img src="${escapeHTML(getUploadUrl(slip))}" alt="Payment Slip">
            </div>
        ` : ""}
    `;

    modal.classList.add("show");
}

function closeOrderModal() {
    document.getElementById("orderDetailModal")?.classList.remove("show");
}

function detailItem(label, value) {
    return `
        <div class="order-detail-item">
            <small>${escapeHTML(label)}</small>
            <strong>${escapeHTML(value || "-")}</strong>
        </div>
    `;
}

function normalizeStatus(status) {
    const s = String(status || "").toLowerCase();

    if (s === "pending_payment") return "pending";
    if (s === "canceled") return "cancelled";
    if (s === "failed") return "cancelled";

    return s;
}

function formatStatus(status) {
    return {
        pending_payment: "Pending",
        paid: "Paid",
        processing: "Processing",
        completed: "Completed",
        cancelled: "Cancelled",
        canceled: "Cancelled",
        failed: "Failed"
    }[status] || status || "-";
}

function formatDate(date) {
    if (!date) return "-";

    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function getUploadUrl(path) {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return path;
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.loadOrders = loadOrders;