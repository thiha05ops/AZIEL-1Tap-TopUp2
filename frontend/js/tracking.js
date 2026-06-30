// frontend/js/tracking.js

let currentOrderId = "";
let lastStatus = "";
let liveTrackingTimer = null;

function trackingApiUrl(path) {
    if (window.AZIEL?.apiUrl) {
        return window.AZIEL.apiUrl(path);
    }

    const base =
        location.port === "5500"
            ? "http://localhost:3000"
            : "";

    return `${base}${path}`;
}

document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const orderIdFromUrl = params.get("orderId");

    const input = document.getElementById("orderIdInput");
    const btn = document.getElementById("trackBtn");

    if (orderIdFromUrl && input) {
        input.value = orderIdFromUrl;
        trackOrder(orderIdFromUrl);
    }

    btn?.addEventListener("click", () => {
        const orderId = input?.value.trim();

        if (!orderId) {
            showError("Please enter Order ID.");
            return;
        }

        trackOrder(orderId);
    });

    loadRecentOrders();

    liveTrackingTimer = setInterval(checkLiveTracking, 5000);
});

window.addEventListener("beforeunload", () => {
    if (liveTrackingTimer) {
        clearInterval(liveTrackingTimer);
        liveTrackingTimer = null;
    }
});

async function trackOrder(orderId) {
    const result = document.getElementById("trackingResult");
    if (!result) return;

    currentOrderId = orderId;
    result.innerHTML = `<div class="loading-card">Checking order...</div>`;

    try {
        const res = await fetch(
            trackingApiUrl(`/api/order/track/${encodeURIComponent(orderId)}`)
        );

        const data = await res.json();

        if (!data.success || !data.order) {
            showError(data.message || "Order not found.");
            return;
        }

        const order = data.order;
        const status = normalizeStatus(order.status);
        lastStatus = order.status;

        result.innerHTML = `
            <div class="phone-track-card">
                <div class="order-top">
                    <div>
                        <span class="mini-label">ORDER STATUS</span>
                        <h2>${formatStatus(status)}</h2>
                    </div>

                    <div class="status-orb ${status}">
                        ${getStatusIcon(status)}
                    </div>
                </div>

                <div class="order-id-box">
                    <small>Order ID</small>
                    <strong>${escapeHTML(order.orderId || "-")}</strong>
                </div>

                <div class="order-info-grid">
                    ${infoItem("Game", order.game || "-")}
                    ${infoItem("Package", order.packageName || order.selectedPackage || "-")}
                    ${infoItem("User ID", order.userId || "-")}
                    ${infoItem("Server", order.zoneId || "-")}
                    ${infoItem("Amount", `${order.amount || 0} ${order.currency || ""}`)}
                    ${infoItem("Payment", order.paymentMethod || "-")}
                </div>

                <div class="progress-wrap">
                    <div class="progress-title">
                        <h3>Progress</h3>
                        <span>${formatStatus(status)}</span>
                    </div>

                    <div class="track-timeline">
                        ${timelineStep("pending", "Order Received", "We received your order.", status)}
                        ${timelineStep("paid", "Payment Confirmed", "Payment has been checked.", status)}
                        ${timelineStep("processing", "Processing", "Your top-up is being processed.", status)}
                        ${timelineStep("completed", "Completed", "Your order is completed.", status)}
                    </div>
                </div>

                <div class="support-box">
                    <span>Need help?</span>
                    <a href="support.html">Contact Support</a>
                </div>

                <p class="order-note">
                    ${escapeHTML(order.note || "Please wait while we process your order.")}
                </p>
            </div>
        `;
    } catch (error) {
        console.log("Track order error:", error);
        showError("Server error.");
    }
}

function infoItem(label, value) {
    return `
        <div class="order-info-item">
            <small>${escapeHTML(label)}</small>
            <strong>${escapeHTML(value)}</strong>
        </div>
    `;
}

function timelineStep(step, title, text, currentStatus) {
    const active = isStepActive(step, currentStatus) ? "active" : "";

    return `
        <div class="track-step ${active}">
            <div class="step-dot"></div>
            <div>
                <h4>${escapeHTML(title)}</h4>
                <p>${escapeHTML(text)}</p>
            </div>
        </div>
    `;
}

function isStepActive(step, status) {
    const list = ["pending", "paid", "processing", "completed"];
    return list.indexOf(step) <= list.indexOf(status);
}

function normalizeStatus(status) {
    const s = String(status || "").toLowerCase();

    if (s === "pending_payment") return "pending";
    if (s === "pending") return "pending";
    if (s === "paid") return "paid";
    if (s === "processing") return "processing";
    if (s === "completed") return "completed";

    return "pending";
}

function formatStatus(status) {
    const map = {
        pending: "Pending",
        paid: "Paid",
        processing: "Processing",
        completed: "Completed"
    };

    return map[status] || "Pending";
}

function getStatusIcon(status) {
    const map = {
        pending: "⏳",
        paid: "💳",
        processing: "⚡",
        completed: "✅"
    };

    return map[status] || "⏳";
}

async function checkLiveTracking() {
    if (!currentOrderId) return;

    try {
        const res = await fetch(
            trackingApiUrl(`/api/order/track/${encodeURIComponent(currentOrderId)}`)
        );

        const data = await res.json();

        if (!data.success || !data.order) return;

        if (data.order.status !== lastStatus) {
            lastStatus = data.order.status;
            showTrackingPopup(data.order.status);
            trackOrder(currentOrderId);
        }
    } catch (error) {
        console.log("Live tracking error:", error);
    }
}

function showTrackingPopup(status) {
    const old = document.querySelector(".tracking-popup");
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.className = "tracking-popup";
    popup.innerHTML = `🔔 Status Updated: <b>${formatStatus(normalizeStatus(status))}</b>`;

    document.body.appendChild(popup);

    setTimeout(() => popup.classList.add("show"), 100);

    setTimeout(() => {
        popup.classList.remove("show");
        setTimeout(() => popup.remove(), 400);
    }, 4000);
}

function showError(message) {
    const result = document.getElementById("trackingResult");
    if (!result) return;

    result.innerHTML = `
        <div class="error-msg">
            ${escapeHTML(message)}
        </div>
    `;
}

async function loadRecentOrders() {
    const box = document.getElementById("recentTrackOrders");
    if (!box) return;

    const username =
        window.AZIEL?.user?.username ||
        localStorage.getItem("username");

    if (!username) {
        box.innerHTML = `
            <p class="empty-orders">
                Login required.
            </p>
        `;
        return;
    }

    try {
        const res = await fetch(
            trackingApiUrl(`/api/order/user/${encodeURIComponent(username)}`)
        );

        const data = await res.json();

        if (!data.success || !data.orders?.length) {
            box.innerHTML = `
                <p class="empty-orders">
                    No recent orders.
                </p>
            `;
            return;
        }

        const recentOrders = data.orders.slice(0, 5);

        box.innerHTML = recentOrders.map(order => `
            <div class="recent-order-item"
                 onclick="trackRecentOrder('${escapeHTML(order.orderId)}')">
                <div class="recent-order-left">
                    <h4>${escapeHTML(order.game || "Game")}</h4>
                    <p>${escapeHTML(order.packageName || "-")}</p>
                </div>

                <div class="recent-order-status">
                    ${formatStatus(normalizeStatus(order.status))}
                </div>
            </div>
        `).join("");
    } catch (error) {
        console.log("Recent orders error:", error);
    }
}

function trackRecentOrder(orderId) {
    const input = document.getElementById("orderIdInput");

    if (input) {
        input.value = orderId;
    }

    trackOrder(orderId);

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}