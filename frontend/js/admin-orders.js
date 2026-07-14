// frontend/js/admin-orders.js
// AZIEL Admin V2.5 Orders Command Center

let allAdminOrders = [];
let selectedAdminOrderId = "";
let ordersAutoRefreshTimer = null;
let ordersRefreshDebounce = null;
let adminOrdersInitialized = false;
let currentOrderContext = {};

const ORDER_QUEUE_FILTERS = new Set([
    "all",
    "manual_review",
    "paid",
    "processing",
    "refund_requested",
    "completed",
    "failed"
]);

document.addEventListener("DOMContentLoaded", () => {
    initAdminOrdersController();
});

function initAdminOrdersController() {
    if (adminOrdersInitialized) return;
    adminOrdersInitialized = true;

    bindOrderCommandControls();
    initOrderModal();
    bindOrderRealtimeRefresh();

    if (isAdminSectionActive("orders") || !document.getElementById("section-orders")) {
        applyOrderNavigationContext(getAdminHashContext("orders"));
        loadOrders();
    }

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "orders") {
            applyOrderNavigationContext(event.detail.context || {});
            loadOrders(false);
        }
    });

    ordersAutoRefreshTimer = setInterval(() => {
        if (!document.hidden && isAdminSectionActive("orders")) loadOrders(false);
    }, 30000);

    window.addEventListener("aziel:admin-locale-changed", () => {
        renderOrderQueue(allAdminOrders);
        renderSelectedOrder();
    });
}

function bindOrderCommandControls() {
    document.querySelectorAll(".orders-queue-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            const filter = btn.dataset.orderFilter || "all";
            currentOrderContext = contextForFilter(filter);
            selectedAdminOrderId = "";
            updateOrderHash();
            syncOrderTabs();
        });
    });

    document.getElementById("orderSearchBtn")?.addEventListener("click", () => {
        currentOrderContext.q = document.getElementById("orderSearchInput")?.value.trim() || "";
        selectedAdminOrderId = "";
        updateOrderHash();
    });

    document.getElementById("orderClearSearchBtn")?.addEventListener("click", () => {
        const input = document.getElementById("orderSearchInput");
        if (input) input.value = "";
        delete currentOrderContext.q;
        selectedAdminOrderId = "";
        updateOrderHash();
    });

    document.getElementById("orderSearchInput")?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            document.getElementById("orderSearchBtn")?.click();
        }
    });
}

function bindOrderRealtimeRefresh() {
    window.addEventListener("aziel:admin-dashboard-refresh", scheduleOrdersRefresh);

    if (window.AZIEL?.realtime) {
        ["admin:order-updated", "adminNewUpdate"].forEach(eventName => {
            window.AZIEL.realtime.on(eventName, scheduleOrdersRefresh, { role: "admin" });
        });
    }
}

function scheduleOrdersRefresh() {
    if (!isAdminSectionActive("orders")) return;

    clearTimeout(ordersRefreshDebounce);
    ordersRefreshDebounce = setTimeout(() => loadOrders(false), 700);
}

async function loadOrders(showLoading = true) {
    const box = document.getElementById("adminOrdersQueue");
    if (!box) return;

    if (showLoading) {
        box.innerHTML = `
            <div class="admin-dashboard-skeleton"></div>
            <div class="admin-dashboard-skeleton"></div>
            <div class="admin-dashboard-skeleton"></div>
        `;
    }

    try {
        const data = await adminFetch(buildOrdersEndpoint());

        if (!data || !data.success) {
            renderOrdersError(data?.message || adminT("something_went_wrong"));
            return;
        }

        allAdminOrders = Array.isArray(data.orders) ? data.orders : [];
        reconcileSelectedOrder();
        renderOrderQueue(allAdminOrders);
        renderSelectedOrder();
    } catch (error) {
        console.log("Load orders error:", error);
        renderOrdersError(adminT("something_went_wrong"));
    }
}

function reconcileSelectedOrder() {
    if (selectedAdminOrderId && allAdminOrders.some(order => String(order._id) === String(selectedAdminOrderId))) {
        return;
    }

    selectedAdminOrderId = allAdminOrders[0]?._id || "";
}

function renderOrderQueue(orders) {
    const box = document.getElementById("adminOrdersQueue");
    if (!box) return;

    syncOrderTabs();

    if (!orders.length) {
        box.innerHTML = `
            <div class="admin-empty-box orders-empty-state">
                ${escapeHTML(emptyMessageForCurrentFilter())}
            </div>
        `;
        return;
    }

    box.innerHTML = orders.map(order => {
        const selected = String(order._id) === String(selectedAdminOrderId);
        const evidenceText = order.hasPaymentEvidence ? adminT("slip_attached") : adminT("no_payment_evidence");

        return `
            <button class="orders-queue-row ${selected ? "active" : ""}" type="button" data-id="${escapeHTML(order._id)}">
                <span class="orders-row-main">
                    <strong>${escapeHTML(order.orderId || "-")}</strong>
                    <small>${escapeHTML(order.username || "-")} · ${escapeHTML(order.game || "-")}</small>
                </span>

                <span class="orders-row-package">
                    <b>${escapeHTML(order.packageName || "-")}</b>
                    <small>${escapeHTML(order.paymentMethod || "-")} · ${escapeHTML(evidenceText)}</small>
                </span>

                <span class="orders-row-amount">
                    <b>${Number(order.amount || 0).toLocaleString()} ${escapeHTML(order.currency || "")}</b>
                    <small>${escapeHTML(formatRelativeTime(order.createdAt))}</small>
                </span>

                <span class="admin-status ${escapeHTML(normalizeStatus(order.status))}">
                    ${escapeHTML(formatStatus(order.status))}
                </span>
            </button>
        `;
    }).join("");

    box.querySelectorAll(".orders-queue-row").forEach(row => {
        row.addEventListener("click", () => {
            selectedAdminOrderId = row.dataset.id || "";
            renderOrderQueue(allAdminOrders);
            renderSelectedOrder();
        });
    });
}

function renderSelectedOrder() {
    const panel = document.getElementById("adminOrderDetailPanel");
    if (!panel) return;

    const order = getSelectedOrder();

    if (!order) {
        panel.innerHTML = `
            <div class="order-detail-empty">
                <strong>${escapeHTML(adminT("select_order_to_review"))}</strong>
            </div>
        `;
        return;
    }

    panel.innerHTML = `
        <div class="order-detail-head">
            <div>
                <span>${escapeHTML(adminT("order_details"))}</span>
                <h3>${escapeHTML(order.orderId || "-")}</h3>
            </div>
            <span class="admin-status ${escapeHTML(normalizeStatus(order.status))}">
                ${escapeHTML(formatStatus(order.status))}
            </span>
        </div>

        ${renderOrderActions(order)}

        <div class="order-detail-grid">
            ${renderDetailSection("order_identity", [
        ["order_id", order.orderId],
        ["status", formatStatus(order.status)],
        ["payment_status", formatStatus(order.paymentStatus || "-")],
        ["created", formatDate(order.createdAt)],
        ["updated", formatDate(order.updatedAt)]
    ])}
            ${renderDetailSection("customer", [
        ["username", order.username],
        ["user_id", order.userId],
        ["region", order.region]
    ])}
            ${renderDetailSection("product", [
        ["product", order.productName || order.game],
        ["package", order.packageName],
        ["package_code", order.packageCode || "-"],
        ["server_id", order.zoneId || "-"]
    ])}
            ${renderDetailSection("financial", [
        ["amount", Number(order.amount || 0).toLocaleString()],
        ["currency", order.currency],
        ["payment_method", order.paymentMethod],
        ["reference", order.transactionId || order.manualPaymentAttemptId || "-"]
    ])}
        </div>

        <div class="order-detail-section">
            <h4>${escapeHTML(adminT("payment_evidence"))}</h4>
            ${renderEvidence(order)}
        </div>

        <div class="order-detail-section">
            <h4>${escapeHTML(adminT("order_timeline"))}</h4>
            ${renderTimeline(order.timeline || [])}
        </div>
    `;

    bindDetailActions(panel, order);
}

function renderDetailSection(titleKey, rows) {
    return `
        <section class="order-detail-section">
            <h4>${escapeHTML(adminT(titleKey))}</h4>
            ${rows.map(([labelKey, value]) => `
                <p>
                    <span>${escapeHTML(adminT(labelKey))}</span>
                    <b>${escapeHTML(value || "-")}</b>
                </p>
            `).join("")}
        </section>
    `;
}

function renderEvidence(order) {
    const url = getOrderEvidenceUrl(order);

    if (!url) {
        return `<div class="order-evidence-empty">${escapeHTML(adminT("no_payment_evidence"))}</div>`;
    }

    if (isAdminUploadedImageFailed(url)) {
        return `<div class="order-evidence-empty">${escapeHTML(adminT("payment_evidence_unavailable"))}</div>`;
    }

    return `
        <div class="order-evidence-preview">
            <img src="${escapeHTML(url)}" data-src="${escapeHTML(url)}" alt="${escapeHTML(adminT("payment_evidence"))}" onerror="handleAdminOrderImageError(this)">
            <button type="button" data-action="view-evidence" data-src="${escapeHTML(url)}">
                ${escapeHTML(adminT("view_full_image"))}
            </button>
        </div>
    `;
}

function renderTimeline(timeline) {
    if (!timeline.length) {
        return `<div class="order-evidence-empty">${escapeHTML(adminT("no_timeline_entries"))}</div>`;
    }

    return `
        <div class="order-timeline-list">
            ${timeline.slice().reverse().map(item => `
                <div class="order-timeline-item">
                    <span class="admin-status ${escapeHTML(normalizeStatus(item.status))}">
                        ${escapeHTML(formatStatus(item.status))}
                    </span>
                    <p>
                        ${item.previousStatus ? `${escapeHTML(formatStatus(item.previousStatus))} → ` : ""}
                        ${escapeHTML(formatStatus(item.status))}
                    </p>
                    <small>
                        ${escapeHTML(adminT("payment_status"))}: ${escapeHTML(formatStatus(item.paymentStatus || "-"))}
                        · ${escapeHTML(item.source || "-")}
                        · ${escapeHTML(item.actorType || "-")}
                        ${item.reason ? `· ${escapeHTML(item.reason)}` : ""}
                    </small>
                    <time>${escapeHTML(formatDate(item.at))}</time>
                </div>
            `).join("")}
        </div>
    `;
}

function renderOrderActions(order) {
    const actions = getOrderActions(order);

    if (!actions.length) {
        return `<div class="order-action-row muted">${escapeHTML(adminT("view_details_only"))}</div>`;
    }

    return `
        <div class="order-action-row">
            ${actions.map(action => `
                <button class="${escapeHTML(action.className)}" type="button" data-action="${escapeHTML(action.action)}">
                    ${escapeHTML(adminT(action.labelKey))}
                </button>
            `).join("")}
        </div>
    `;
}

function getOrderActions(order) {
    const allowed = new Set(order.allowedNextStatuses || []);
    const status = String(order.status || "");
    const actions = [];

    if (status === "pending_payment" && order.hasPaymentEvidence && allowed.has("paid")) {
        actions.push({ action: "confirm-paid", labelKey: "confirm_paid", className: "order-primary-action" });
    }

    if (status === "paid" && allowed.has("processing")) {
        actions.push({ action: "start-processing", labelKey: "start_processing", className: "order-primary-action" });
    }

    if (status === "processing" && allowed.has("completed")) {
        actions.push({ action: "complete-order", labelKey: "complete_order", className: "order-primary-action" });
    }

    if ((status === "paid" || status === "processing") && allowed.has("failed")) {
        actions.push({ action: "fail-order", labelKey: "fail_order", className: "order-danger-action" });
    }

    if (status === "refund_requested") {
        actions.push({ action: "approve-refund", labelKey: "approve_refund", className: "order-primary-action" });
        actions.push({ action: "reject-refund", labelKey: "reject_refund", className: "order-danger-action" });
    }

    return actions;
}

function bindDetailActions(panel, order) {
    panel.querySelector('[data-action="view-evidence"]')?.addEventListener("click", event => {
        openSlipModal(event.currentTarget.dataset.src || "");
    });

    panel.querySelector('[data-action="confirm-paid"]')?.addEventListener("click", () => confirmOrderPaid(order));
    panel.querySelector('[data-action="start-processing"]')?.addEventListener("click", () => transitionSelectedOrder(order, "processing"));
    panel.querySelector('[data-action="complete-order"]')?.addEventListener("click", () => transitionSelectedOrder(order, "completed"));
    panel.querySelector('[data-action="fail-order"]')?.addEventListener("click", () => transitionSelectedOrder(order, "failed"));
    panel.querySelector('[data-action="approve-refund"]')?.addEventListener("click", () => approveRefundToWallet(order._id));
    panel.querySelector('[data-action="reject-refund"]')?.addEventListener("click", () => rejectRefund(order._id));
}

async function confirmOrderPaid(order) {
    const confirmed = await confirmOrderAction({
        title: adminT("confirm_payment"),
        message: `${adminT("mark_this_order_paid")}\n\n${order.orderId}\n${Number(order.amount || 0).toLocaleString()} ${order.currency || ""}\n${order.paymentMethod || "-"}`
    });

    if (!confirmed) return;

    await transitionSelectedOrder(order, "paid", { skipConfirm: true });
}

async function transitionSelectedOrder(order, status, options = {}) {
    if (!order?._id || !status) return;

    if (!options.skipConfirm) {
        const confirmed = await confirmOrderAction({
            title: adminT(status === "failed" ? "fail_order" : "update_order"),
            message: `${adminT("update_order_to")} ${formatStatus(status)}?\n\n${order.orderId}`
        });

        if (!confirmed) return;
    }

    const btn = document.querySelector(`#adminOrderDetailPanel [data-action]`);

    try {
        window.AZIEL_UI?.button?.setLoading(btn, { text: adminT("loading") });

        const data = await adminFetch(`/api/admin/orders/${encodeURIComponent(order._id)}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
        });

        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("something_went_wrong"), "error");
            return;
        }

        showAdminToast?.(adminT("order_updated"), "success");
        dispatchDashboardRefresh();
        await loadOrders(false);
    } catch (error) {
        console.log("Transition order error:", error);
        showAdminToast?.(adminT("something_went_wrong"), "error");
    } finally {
        window.AZIEL_UI?.button?.reset(btn);
    }
}

async function approveRefundToWallet(orderId, btn = null) {
    const order = allAdminOrders.find(o => String(o._id) === String(orderId));

    if (!order) {
        showAdminToast?.("Order not found", "error");
        return;
    }

    const reason = prompt(
        `Approve refund ${Number(order.amount || 0).toLocaleString()} ${order.currency || ""} to ${order.username}'s wallet?\n\nAdmin note/reason:`
    );

    if (!reason || !reason.trim()) {
        showAdminToast?.("Refund reason is required", "error");
        return;
    }

    const confirmed = await confirmOrderAction({
        title: adminT("approve_refund"),
        message: `${adminT("approve_refund")}?\n\n${order.orderId}`
    });

    if (!confirmed) return;

    try {
        window.AZIEL_UI?.button?.setLoading(btn, { text: "Approving..." });

        const data = await adminFetch(`/api/admin/orders/${orderId}/refund/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: reason.trim() })
        });

        if (!data || !data.success) {
            showAdminToast?.(data?.message || "Refund failed", "error");
            return;
        }

        showAdminToast?.("Refund approved to wallet", "success");
        dispatchDashboardRefresh();
        await loadOrders(false);
    } catch (error) {
        console.log("Approve refund error:", error);
        showAdminToast?.("Server error", "error");
    } finally {
        window.AZIEL_UI?.button?.reset(btn);
    }
}

async function rejectRefund(orderId, btn = null) {
    const order = allAdminOrders.find(o => String(o._id) === String(orderId));

    if (!order) {
        showAdminToast?.("Order not found", "error");
        return;
    }

    const reason = prompt("Enter reject reason:");

    if (!reason || !reason.trim()) {
        showAdminToast?.("Reject reason is required", "error");
        return;
    }

    const confirmed = await confirmOrderAction({
        title: adminT("reject_refund"),
        message: `${adminT("reject_refund")}?\n\n${order.orderId}`
    });

    if (!confirmed) return;

    try {
        window.AZIEL_UI?.button?.setLoading(btn, { text: "Rejecting..." });

        const data = await adminFetch(`/api/admin/orders/${orderId}/refund/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: reason.trim() })
        });

        if (!data || !data.success) {
            showAdminToast?.(data?.message || "Reject failed", "error");
            return;
        }

        showAdminToast?.("Refund rejected", "success");
        dispatchDashboardRefresh();
        await loadOrders(false);
    } catch (error) {
        console.log("Reject refund error:", error);
        showAdminToast?.("Server error", "error");
    } finally {
        window.AZIEL_UI?.button?.reset(btn);
    }
}

async function confirmOrderAction({ title, message }) {
    if (window.AZIEL_UI?.confirm) {
        return window.AZIEL_UI.confirm({
            title,
            message,
            confirmText: title,
            cancelText: adminT("cancel")
        });
    }

    showAdminToast?.(message || title, "info");
    return false;
}

function dispatchDashboardRefresh() {
    window.dispatchEvent(new CustomEvent("aziel:admin-dashboard-refresh"));
    loadAdminDashboard?.(false);
}

function renderOrdersError(message) {
    const box = document.getElementById("adminOrdersQueue");
    if (!box) return;

    box.innerHTML = `
        <div class="admin-dashboard-error">
            <strong>${escapeHTML(message)}</strong>
            <button type="button" id="retryOrdersBtn">${escapeHTML(adminT("retry"))}</button>
        </div>
    `;

    document.getElementById("retryOrdersBtn")?.addEventListener("click", () => loadOrders(true));
}

function applyOrderNavigationContext(context = {}) {
    const next = context.filter === "manual_review"
        ? "manual_review"
        : context.status || "all";

    currentOrderContext = context.filter === "manual_review"
        ? { filter: "manual_review", q: context.q || "" }
        : context.status
            ? { status: context.status, q: context.q || "" }
            : { q: context.q || "" };

    if (!currentOrderContext.q) delete currentOrderContext.q;

    const input = document.getElementById("orderSearchInput");
    if (input) input.value = currentOrderContext.q || "";

    setActiveQueueTab(ORDER_QUEUE_FILTERS.has(next) ? next : "all");
}

function buildOrdersEndpoint() {
    const params = new URLSearchParams();

    if (currentOrderContext.filter) params.set("filter", currentOrderContext.filter);
    if (currentOrderContext.status) params.set("status", currentOrderContext.status);
    if (currentOrderContext.q) params.set("q", currentOrderContext.q);

    const query = params.toString();
    return query ? `/api/admin/orders?${query}` : "/api/admin/orders";
}

function contextForFilter(filter) {
    const q = document.getElementById("orderSearchInput")?.value.trim() || currentOrderContext.q || "";
    const context = {};

    if (filter === "manual_review") {
        context.filter = "manual_review";
    } else if (filter !== "all") {
        context.status = filter;
    }

    if (q) context.q = q;
    return context;
}

function updateOrderHash() {
    window.openAdminSection?.("orders", true, currentOrderContext);
}

function syncOrderTabs() {
    const current = currentOrderContext.filter === "manual_review"
        ? "manual_review"
        : currentOrderContext.status || "all";

    setActiveQueueTab(current);
}

function setActiveQueueTab(current) {
    document.querySelectorAll(".orders-queue-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.orderFilter === current);
    });
}

function emptyMessageForCurrentFilter() {
    if (currentOrderContext.filter === "manual_review") return adminT("no_manual_payments_waiting");
    if (currentOrderContext.status === "paid") return adminT("no_paid_orders");
    if (currentOrderContext.status === "refund_requested") return adminT("no_refund_requests");
    return adminT("no_orders_found");
}

function getSelectedOrder() {
    return allAdminOrders.find(order => String(order._id) === String(selectedAdminOrderId));
}

function getOrderEvidenceUrl(order) {
    const evidence = order?.paymentEvidence || {};
    const raw = evidence.url || evidence.key || evidence.storageKey || order?.paymentSlip || "";

    return getAdminUploadedImageUrl(raw, { folder: "orders" });
}

function initOrderModal() {
    document.getElementById("closeOrderModal")?.addEventListener("click", closeOrderModal);
    document.getElementById("closeSlipModal")?.addEventListener("click", closeSlipModal);

    document.getElementById("orderDetailModal")?.addEventListener("click", e => {
        if (e.target.id === "orderDetailModal") closeOrderModal();
    });

    document.getElementById("slipModal")?.addEventListener("click", e => {
        if (e.target.id === "slipModal") closeSlipModal();
    });

    document.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            closeOrderModal();
            closeSlipModal();
        }
    });
}

function openSlipModal(src) {
    const modal = document.getElementById("slipModal");
    const img = document.getElementById("slipModalImg");

    if (!modal || !img || !src) return;

    img.src = src;
    modal.classList.add("show");
}

function closeOrderModal() {
    document.getElementById("orderDetailModal")?.classList.remove("show");
}

function closeSlipModal() {
    document.getElementById("slipModal")?.classList.remove("show");
}

function handleAdminOrderImageError(img) {
    handleAdminUploadedImageError(img, adminT("payment_evidence_unavailable"));
}

function normalizeStatus(status) {
    const s = String(status || "").toLowerCase();

    if (s === "pending_payment") return "pending";
    if (s === "refund_requested") return "pending";
    if (s === "refund_pending") return "pending";
    if (s === "refund_rejected") return "cancelled";
    if (s === "canceled") return "cancelled";
    if (s === "failed") return "cancelled";
    if (s === "refunded") return "completed";

    return s || "info";
}

function formatStatus(status) {
    const keyByStatus = {
        pending_payment: "pending_payment",
        paid: "paid",
        processing: "processing",
        completed: "completed",
        cancelled: "cancelled",
        canceled: "cancelled",
        failed: "failed",
        expired: "expired",
        refund_requested: "refund_requested",
        refund_pending: "refund_pending",
        refund_rejected: "refund_rejected",
        refunded: "refunded",
        pending: "pending"
    };
    const key = keyByStatus[String(status || "").toLowerCase()] || "";

    return window.AZIEL_ADMIN_I18N?.t?.(key, status) || status || "-";
}

function formatDate(date) {
    if (!date) return "-";
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function formatRelativeTime(date) {
    if (!date) return "-";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "-";

    const seconds = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
    if (seconds < 60) return adminT("just_now");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return parsed.toLocaleDateString();
}

function isAdminSectionActive(section) {
    const sectionEl = document.getElementById(`section-${section}`);
    return !sectionEl || sectionEl.classList.contains("active");
}

function getAdminHashContext(sectionName) {
    const raw = window.location.hash ? window.location.hash.slice(1) : "";
    const [section = "", query = ""] = raw.split("?");

    if (section !== sectionName) return {};

    return Object.fromEntries(new URLSearchParams(query));
}

function adminT(key, fallback = "") {
    return window.AZIEL_ADMIN_I18N?.t?.(key, fallback) || fallback || key;
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
window.approveRefundToWallet = approveRefundToWallet;
window.rejectRefund = rejectRefund;
window.handleAdminOrderImageError = handleAdminOrderImageError;
