// frontend/js/tracking.js
// AZIEL Tracking V3 - Conditional Order / Refund Timeline

let currentOrderId = "";
let currentTrackingOrder = null;
let lastStatus = "";
let liveTrackingTimer = null;

function trackingApiUrl(path) {
    if (window.AZIEL?.apiUrl) return window.AZIEL.apiUrl(path);

    const base = location.port === "5500"
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

    initRefundModal();
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

        currentTrackingOrder = order;
        lastStatus = order.status;

        result.innerHTML = `
            <div class="phone-track-card">
                <div class="order-top">
                    <div>
                        <span class="mini-label">
                            ${isRefundFlow(status) ? "REFUND STATUS" : "ORDER STATUS"}
                        </span>
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
                    ${infoItem("Amount", `${Number(order.amount || 0).toLocaleString()} ${order.currency || ""}`)}
                    ${infoItem("Payment", order.paymentMethod || "-")}

                    ${status === "refunded"
                ? infoItem("Refund", `${Number(order.refundAmount || order.amount || 0).toLocaleString()} ${order.currency || ""}`)
                : ""
            }

                    ${status === "refunded"
                ? infoItem("Refund Method", order.refundMethod || "wallet")
                : ""
            }
                </div>

                <div class="progress-wrap">
                    <div class="progress-title">
                        <h3>${isRefundFlow(status) ? "Refund Timeline" : "Progress"}</h3>
                        <span>${formatStatus(status)}</span>
                    </div>

                    <div class="track-timeline">
                        ${renderTimeline(status)}
                    </div>
                </div>

                ${renderRefundAction(order, status)}
                ${renderRefundStatusBox(order, status)}

                <div class="support-box">
                    <span>Need help?</span>
                    <a href="support.html">Contact Support</a>
                </div>

                <p class="order-note">
                    ${escapeHTML(order.note || getDefaultNote(status))}
                </p>
            </div>
        `;
    } catch (error) {
        console.log("Track order error:", error);
        showError("Server error.");
    }
}

function renderTimeline(status) {
    if (isRefundFlow(status)) {
        return renderRefundTimeline(status);
    }

    return renderOrderTimeline(status);
}

function isRefundFlow(status) {
    return [
        "refund_requested",
        "refund_rejected",
        "refunded"
    ].includes(status);
}

function renderOrderTimeline(status) {
    return `
        ${timelineStep("pending", "Order Received", "We received your order.", status)}
        ${timelineStep("paid", "Payment Confirmed", "Payment has been checked.", status)}
        ${timelineStep("processing", "Processing", "Your top-up is being processed.", status)}
        ${timelineStep("completed", "Completed", "Your order is completed.", status)}
        ${["failed", "cancelled"].includes(status)
            ? timelineStep("failed", "Failed / Cancelled", "Order failed or was cancelled.", status)
            : ""
        }
    `;
}

function renderRefundTimeline(status) {
    return `
        ${timelineStep("refund_requested", "Refund Requested", "Your refund request was submitted.", status)}
        ${timelineStep("refund_review", "Admin Review", "Admin is checking your refund request.", status)}
        ${status === "refund_rejected"
            ? timelineStep("refund_rejected", "Refund Rejected", "Your refund request was rejected.", status)
            : timelineStep("refunded", "Wallet Refunded", "Refund has been returned to your AZIEL Wallet.", status)
        }
    `;
}

function renderRefundAction(order, status) {
    if (!canRequestRefund(order, status)) return "";

    return `
        <div class="refund-action-box">
            <strong>Order issue?</strong>
            <p>You can request a wallet refund for failed or cancelled orders.</p>

            <button type="button" id="requestRefundBtn">
                Request Refund
            </button>
        </div>
    `;
}

function renderRefundStatusBox(order, status) {
    if (status === "refund_requested") {
        return `
            <div class="refund-box pending">
                <strong>Refund Requested</strong>
                <p>Admin is reviewing your refund request.</p>
                <small>${escapeHTML(order.refundRequestReason || "Refund request submitted.")}</small>
            </div>
        `;
    }

    if (status === "refund_rejected") {
        return `
            <div class="refund-box rejected">
                <strong>Refund Rejected</strong>
                <p>Your refund request was rejected.</p>
                <small>${escapeHTML(order.refundRejectedReason || "Please contact support for more details.")}</small>
            </div>
        `;
    }

    if (status === "refunded") {
        return `
            <div class="refund-box success">
                <strong>Wallet Refunded</strong>
                <p>
                    ${Number(order.refundAmount || order.amount || 0).toLocaleString()}
                    ${escapeHTML(order.currency || "")}
                    has been returned to your AZIEL Wallet.
                </p>
                <small>${escapeHTML(order.refundReason || "Refund completed.")}</small>
            </div>
        `;
    }

    return "";
}

document.addEventListener("click", e => {
    if (e.target?.id === "requestRefundBtn") {
        openRefundModal(currentTrackingOrder);
    }
});

function initRefundModal() {
    const modal = document.getElementById("refundRequestModal");
    const closeBtn = document.getElementById("closeRefundModal");
    const submitBtn = document.getElementById("submitRefundRequestBtn");

    closeBtn?.addEventListener("click", closeRefundModal);

    modal?.addEventListener("click", e => {
        if (e.target.id === "refundRequestModal") {
            closeRefundModal();
        }
    });

    submitBtn?.addEventListener("click", submitRefundRequest);
}

function openRefundModal(order) {
    if (!order) return;

    const modal = document.getElementById("refundRequestModal");
    const orderText = document.getElementById("refundModalOrderId");
    const reasonInput = document.getElementById("refundReasonInput");
    const msg = document.getElementById("refundRequestMsg");

    if (!modal) return;

    if (orderText) orderText.innerText = order.orderId || "-";
    if (reasonInput) reasonInput.value = "";
    if (msg) msg.innerHTML = "";

    modal.classList.add("show");
}

function closeRefundModal() {
    document.getElementById("refundRequestModal")?.classList.remove("show");
}

async function submitRefundRequest() {
    const order = currentTrackingOrder;
    const reasonInput = document.getElementById("refundReasonInput");
    const btn = document.getElementById("submitRefundRequestBtn");

    if (!order?.orderId) {
        setRefundMsg("Order not found.", "error");
        return;
    }

    const reason = reasonInput?.value.trim();

    if (!reason) {
        setRefundMsg("Please enter refund reason.", "error");
        return;
    }

    const username =
        window.AZIEL?.user?.username ||
        localStorage.getItem("username") ||
        "";

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerText = "Submitting...";
        }

        const res = await fetch(
            trackingApiUrl(`/api/order/${encodeURIComponent(order.orderId)}/refund-request`),
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username,
                    reason
                })
            }
        );

        const data = await res.json();

        if (!res.ok || !data.success) {
            setRefundMsg(data.message || "Refund request failed.", "error");
            return;
        }

        setRefundMsg("Refund request submitted.", "success");

        setTimeout(() => {
            closeRefundModal();
            trackOrder(order.orderId);
            loadRecentOrders();
        }, 800);

    } catch (error) {
        console.log("Refund request error:", error);
        setRefundMsg("Server error.", "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Submit Refund Request";
        }
    }
}

function setRefundMsg(message, type = "success") {
    const msg = document.getElementById("refundRequestMsg");
    if (!msg) return;

    msg.innerHTML = `
        <p class="${type === "error" ? "error-msg" : "success-msg"}">
            ${escapeHTML(message)}
        </p>
    `;
}

function canRequestRefund(order, status) {
    if (!order) return false;

    return (
        ["failed", "cancelled"].includes(status) &&
        !order.refundRequested &&
        !order.refunded
    );
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
    const orderFlows = {
        pending: ["pending"],
        paid: ["pending", "paid"],
        processing: ["pending", "paid", "processing"],
        completed: ["pending", "paid", "processing", "completed"],
        failed: ["pending", "paid", "processing", "failed"],
        cancelled: ["pending", "paid", "processing", "failed"]
    };

    const refundFlows = {
        refund_requested: ["refund_requested", "refund_review"],
        refund_rejected: ["refund_requested", "refund_review", "refund_rejected"],
        refunded: ["refund_requested", "refund_review", "refunded"]
    };

    if (isRefundFlow(status)) {
        return (refundFlows[status] || []).includes(step);
    }

    return (orderFlows[status] || ["pending"]).includes(step);
}

function normalizeStatus(status) {
    const s = String(status || "").toLowerCase();

    if (s === "pending_payment") return "pending";
    if (s === "pending") return "pending";
    if (s === "paid") return "paid";
    if (s === "processing") return "processing";
    if (s === "completed") return "completed";
    if (s === "failed") return "failed";
    if (s === "cancelled" || s === "canceled") return "cancelled";
    if (s === "refund_requested") return "refund_requested";
    if (s === "refund_pending") return "refund_requested";
    if (s === "refund_rejected") return "refund_rejected";
    if (s === "refunded") return "refunded";

    return "pending";
}

function formatStatus(status) {
    const map = {
        pending: "Pending",
        paid: "Paid",
        processing: "Processing",
        completed: "Completed",
        failed: "Failed",
        cancelled: "Cancelled",
        refund_requested: "Refund Requested",
        refund_rejected: "Refund Rejected",
        refunded: "Refunded"
    };

    return map[status] || "Pending";
}

function getStatusIcon(status) {
    const map = {
        pending: "⏳",
        paid: "💳",
        processing: "⚡",
        completed: "✅",
        failed: "❌",
        cancelled: "🚫",
        refund_requested: "💸",
        refund_rejected: "❌",
        refunded: "↩️"
    };

    return map[status] || "⏳";
}

function getDefaultNote(status) {
    const map = {
        pending: "Please wait while we confirm your payment.",
        paid: "Payment confirmed. Waiting for processing.",
        processing: "Your order is processing.",
        completed: "Your order has been completed.",
        failed: "Your order failed. You may request a wallet refund.",
        cancelled: "Your order was cancelled. You may request a wallet refund.",
        refund_requested: "Refund request submitted. Admin will review your request.",
        refund_rejected: "Refund request was rejected. Please contact support if needed.",
        refunded: "This order has been refunded to your AZIEL Wallet."
    };

    return map[status] || "Please wait while we process your order.";
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
    document.querySelector(".tracking-popup")?.remove();

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
        box.innerHTML = `<p class="empty-orders">Login required.</p>`;
        return;
    }

    try {
        const res = await fetch(
            trackingApiUrl(`/api/order/user/${encodeURIComponent(username)}`)
        );

        const data = await res.json();

        if (!data.success || !data.orders?.length) {
            box.innerHTML = `<p class="empty-orders">No recent orders.</p>`;
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

                <div class="recent-order-status ${normalizeStatus(order.status)}">
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

    if (input) input.value = orderId;

    trackOrder(orderId);

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}