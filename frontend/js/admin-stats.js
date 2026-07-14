// frontend/js/admin-stats.js
// AZIEL Admin V2.5 real operations dashboard

let adminDashboardTimer = null;
let adminDashboardRefreshTimer = null;
let lastAdminDashboard = null;

document.addEventListener("DOMContentLoaded", () => {
    initAdminDashboard();
});

function initAdminDashboard() {
    document.getElementById("refreshDashboardBtn")?.addEventListener("click", () => {
        loadAdminDashboard(true);
    });

    loadAdminDashboard();

    if (!adminDashboardTimer) {
        adminDashboardTimer = setInterval(() => {
            if (!document.hidden && isDashboardActive()) {
                loadAdminDashboard(false);
            }
        }, 45000);
    }

    [
        "admin:order-updated",
        "aziel:admin-dashboard-refresh",
        "wallet:topup-updated",
        "liveChatMessage",
        "supportUpdated"
    ].forEach(eventName => {
        window.addEventListener(eventName, scheduleAdminDashboardRefresh);
    });

    if (window.AZIEL?.realtime) {
        [
            "admin:order-updated",
            "adminNewUpdate",
            "liveChatMessage",
            "supportUpdated"
        ].forEach(eventName => {
            window.AZIEL.realtime.on(eventName, scheduleAdminDashboardRefresh, { role: "admin" });
        });
    }

    window.addEventListener("aziel:admin-locale-changed", () => {
        if (lastAdminDashboard) renderAdminDashboard(lastAdminDashboard);
    });
}

function scheduleAdminDashboardRefresh() {
    clearTimeout(adminDashboardRefreshTimer);
    adminDashboardRefreshTimer = setTimeout(() => {
        if (!document.hidden) loadAdminDashboard(false);
    }, 900);
}

async function loadAdminDashboard(showError = true) {
    try {
        if (typeof adminFetch !== "function") {
            console.error("adminFetch not found. Make sure admin-api.js is loaded first.");
            return;
        }

        if (showError) setDashboardLoading();

        const data = await adminFetch("/api/admin/stats");

        if (!data || !data.success) {
            if (showError) renderDashboardError(data?.message || adminT("something_went_wrong"));
            return;
        }

        lastAdminDashboard = data.dashboard || null;
        renderAdminDashboard(lastAdminDashboard, data);
    } catch (error) {
        console.log("Admin dashboard error:", error);
        if (showError) renderDashboardError(adminT("something_went_wrong"));
    }
}

function renderAdminDashboard(dashboard, legacy = {}) {
    if (!dashboard) {
        renderDashboardError(adminT("something_went_wrong"));
        return;
    }

    renderActionRequired(dashboard.actionRequired || {});
    renderToday(dashboard.today || {});
    renderRecentOperations(dashboard.recentOperations || []);

    setText("dashboardLastUpdated", `${adminT("last_updated")}: ${formatDateTime(dashboard.updatedAt)}`);

    setValue("totalOrders", legacy.totalOrders || 0);
    setValue("pendingOrders", legacy.pendingOrders || 0);
    setValue("processingOrders", legacy.processingOrders || 0);
    setValue("completedOrders", legacy.completedOrders || 0);
    setValue("totalUsers", legacy.totalUsers || 0);
}

function renderActionRequired(actionRequired) {
    const box = document.getElementById("actionRequiredList");
    if (!box) return;

    const items = [
        actionItemConfig("manualPaymentReviews", actionRequired.manualPaymentReviews),
        actionItemConfig("paidOrders", actionRequired.paidOrders),
        actionItemConfig("walletTopups", actionRequired.walletTopups),
        actionItemConfig("support", actionRequired.support),
        actionItemConfig("liveChat", actionRequired.liveChat),
        actionItemConfig("refunds", actionRequired.refunds)
    ].filter(Boolean);

    const visible = items.filter(item => item.count > 0);

    if (!visible.length) {
        box.innerHTML = `
            <div class="admin-all-clear">
                <strong>${escapeHTML(adminT("no_items_require_attention"))}</strong>
                <span>${escapeHTML(adminT("all_clear_operational"))}</span>
            </div>
        `;
        return;
    }

    box.innerHTML = visible.map(item => `
        <button class="admin-action-card ${escapeHTML(item.severity)}" type="button"
            data-section="${escapeHTML(item.target.section)}"
            data-params="${escapeHTML(JSON.stringify(item.target.params || {}))}">
            <span class="admin-action-icon">${item.icon}</span>
            <span>
                <strong>${escapeHTML(adminT(item.labelKey))}</strong>
                <small>${escapeHTML(item.copy(item.count))}</small>
            </span>
            <b>${Number(item.count || 0).toLocaleString()}</b>
            <em>${escapeHTML(adminT(item.actionKey))} →</em>
        </button>
    `).join("");

    box.querySelectorAll(".admin-action-card").forEach(card => {
        card.addEventListener("click", () => {
            let params = {};

            try {
                params = JSON.parse(card.dataset.params || "{}");
            } catch (error) {
                params = {};
            }

            window.openAdminSection?.(card.dataset.section, true, params);
        });
    });

    window.AZIEL_MOTION?.enter(box, "fast");
}

function actionItemConfig(key, value = {}) {
    const count = Number(value?.count || 0);
    const target = value?.target || {};

    const config = {
        manualPaymentReviews: {
            icon: "🧾",
            labelKey: "payment_slips",
            actionKey: "review",
            copy: number => `${number.toLocaleString()} ${adminT("waiting_for_verification")}`
        },
        paidOrders: {
            icon: "📦",
            labelKey: "paid_orders",
            actionKey: "process",
            copy: number => `${number.toLocaleString()} ${adminT("ready_to_process")}`
        },
        walletTopups: {
            icon: "💳",
            labelKey: "wallet_topups",
            actionKey: "review",
            copy: number => `${number.toLocaleString()} ${adminT("awaiting_review")}`
        },
        support: {
            icon: "🎧",
            labelKey: "support_tickets",
            actionKey: "open",
            copy: number => `${number.toLocaleString()} ${adminT("need_attention")}`
        },
        liveChat: {
            icon: "💬",
            labelKey: "live_chats",
            actionKey: "open",
            copy: number => `${number.toLocaleString()} ${adminT("unread_conversations")}`
        },
        refunds: {
            icon: "↩",
            labelKey: "refund_requests",
            actionKey: "review",
            copy: number => `${number.toLocaleString()} ${adminT("awaiting_decision")}`
        }
    }[key];

    if (!config || !target.section) return null;

    return {
        ...config,
        count,
        target,
        severity: value.severity || "info"
    };
}

function renderToday(today) {
    const values = today.completedOrderValue || {};

    setValue("ordersToday", today.orders || 0);
    setValue("completedToday", today.completedOrders || 0);
    setValue("failedToday", today.failedOrders || 0);
    setValue("newUsersToday", today.newUsers || 0);
    setText("completedValueMMK", `${Number(values.MMK || 0).toLocaleString()} MMK`);
    setText("completedValueTHB", `${Number(values.THB || 0).toLocaleString()} THB`);
}

function renderRecentOperations(items) {
    const box = document.getElementById("recentOperationsList");
    if (!box) return;

    if (!items.length) {
        box.innerHTML = `<p>${escapeHTML(adminT("no_recent_operations"))}</p>`;
        return;
    }

    box.innerHTML = items.map(item => `
        <button class="admin-recent-operation" type="button" data-section="orders" data-status="${escapeHTML(item.status || "")}">
            <span class="admin-status ${escapeHTML(normalizeStatus(item.status))}">
                ${escapeHTML(formatDashboardStatus(item.status))}
            </span>
            <strong>${escapeHTML(item.orderId || "-")}</strong>
            <small>${escapeHTML(item.game || "-")} · ${escapeHTML(item.username || "-")} · ${escapeHTML(formatDateTime(item.updatedAt))}</small>
        </button>
    `).join("");

    box.querySelectorAll(".admin-recent-operation").forEach(row => {
        row.addEventListener("click", () => {
            const status = row.dataset.status;
            window.openAdminSection?.("orders", true, status ? { status } : {});
        });
    });
}

function setDashboardLoading() {
    const box = document.getElementById("actionRequiredList");
    if (box) {
        box.innerHTML = `
            <div class="admin-dashboard-skeleton"></div>
            <div class="admin-dashboard-skeleton"></div>
            <div class="admin-dashboard-skeleton"></div>
        `;
    }
}

function renderDashboardError(message) {
    const box = document.getElementById("actionRequiredList");
    if (!box) return;

    box.innerHTML = `
        <div class="admin-dashboard-error">
            <strong>${escapeHTML(message)}</strong>
            <button type="button" id="retryDashboardBtn">${escapeHTML(adminT("try_again"))}</button>
        </div>
    `;

    document.getElementById("retryDashboardBtn")?.addEventListener("click", () => loadAdminDashboard(true));
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    if (typeof value === "string") {
        el.innerText = value;
        return;
    }

    animateCounter(el, Number(value || 0));
}

function animateCounter(element, target) {
    const start = Number(element.dataset.value || 0);
    const duration = 500;
    const startTime = performance.now();

    function update(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const current = Math.floor(start + (target - start) * progress);

        element.innerText = current.toLocaleString();

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.dataset.value = target;
        }
    }

    requestAnimationFrame(update);
}

function isDashboardActive() {
    const section = document.getElementById("section-dashboard");
    return !section || section.classList.contains("active");
}

function adminT(key, fallback = "") {
    return window.AZIEL_ADMIN_I18N?.t?.(key, fallback) || fallback || key;
}

function formatDashboardStatus(status) {
    return window.AZIEL_ADMIN_I18N?.t?.(status, status) || status || "-";
}

function normalizeStatus(status) {
    const value = String(status || "").toLowerCase();
    if (value === "pending_payment" || value === "refund_requested" || value === "refund_pending") return "pending";
    if (value === "failed" || value === "cancelled" || value === "refund_rejected") return "cancelled";
    if (value === "paid" || value === "completed" || value === "refunded") return "completed";
    return value || "info";
}

function formatDateTime(date) {
    if (!date) return "-";
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.loadAdminDashboard = loadAdminDashboard;
window.loadAdminStats = loadAdminDashboard;
