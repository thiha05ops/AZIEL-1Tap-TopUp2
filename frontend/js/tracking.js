// frontend/js/tracking.js
// AZIEL Tracking V3 - i18n Ready

let currentOrderId = "";
let currentTrackingOrder = null;
let lastStatus = "";
let liveTrackingTimer = null;

function t(key, fallback = "") {
    if (window.AZIEL_I18N?.t) {
        return window.AZIEL_I18N.t(key, fallback);
    }

    return fallback || key;
}

function trackingApiUrl(path) {
    if (window.AZIEL?.apiUrl) return window.AZIEL.apiUrl(path);

    const base = location.port === "5500"
        ? "http://localhost:3000"
        : "";

    return `${base}${path}`;
}

function getTrackingAuthHeaders(extra = {}) {
    return window.AZIEL?.authHeaders?.(extra) || extra;
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
            showError(t("trackingEnterOrderId", "Please enter Order ID."));
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

    result.innerHTML = `
        <div class="loading-card">
            ${t("trackingCheckingOrder", "Checking order...")}
        </div>
    `;

    try {
        const res = await fetch(
            trackingApiUrl(`/api/order/track/${encodeURIComponent(orderId)}`)
        );

        const data = await res.json();

        if (!data.success || !data.order) {
            showError(data.message || t("trackingOrderNotFound", "Order not found."));
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
                            ${isRefundFlow(status)
                ? t("refundStatusLabel", "REFUND STATUS")
                : t("orderStatusLabel", "ORDER STATUS")}
                        </span>

                        <h2>${formatStatus(status)}</h2>
                    </div>

                    <div class="status-orb ${status}">
                        ${getStatusIcon(status)}
                    </div>
                </div>

                <div class="order-id-box">
                    <small>${t("orderId", "Order ID")}</small>
                    <strong>${escapeHTML(order.orderId || "-")}</strong>
                </div>

                <div class="order-info-grid">
                    ${infoItem(t("game", "Game"), order.game || "-")}
                    ${infoItem(t("package", "Package"), order.packageName || order.selectedPackage || "-")}
                    ${infoItem(t("userId", "User ID"), order.userId || "-")}
                    ${infoItem(t("serverId", "Server ID"), order.zoneId || "-")}
                    ${infoItem(t("amount", "Amount"), `${Number(order.amount || 0).toLocaleString()} ${order.currency || ""}`)}
                    ${infoItem(t("payment", "Payment"), order.paymentMethod || "-")}

                    ${status === "refunded"
                ? infoItem(
                    t("refund", "Refund"),
                    `${Number(order.refundAmount || order.amount || 0).toLocaleString()} ${order.currency || ""}`
                )
                : ""
            }

                    ${status === "refunded"
                ? infoItem(
                    t("refundMethod", "Refund Method"),
                    order.refundMethod || "wallet"
                )
                : ""
            }
                </div>

                <div class="progress-wrap">
                    <div class="progress-title">
                        <h3>
                            ${isRefundFlow(status)
                ? t("refundTimeline", "Refund Timeline")
                : t("progress", "Progress")}
                        </h3>

                        <span>${formatStatus(status)}</span>
                    </div>

                    <div class="track-timeline">
                        ${renderTimeline(status)}
                    </div>
                </div>

                ${renderRefundAction(order, status)}
                ${renderRefundStatusBox(order, status)}

                <div class="support-box">
                    <span>${t("needHelp", "Need help?")}</span>
                    <a href="support.html">${t("contactSupport", "Contact Support")}</a>
                </div>

                <p class="order-note">
                    ${escapeHTML(order.note || getDefaultNote(status))}
                </p>
            </div>
        `;

        window.AZIEL_I18N?.translatePage?.(document);

    } catch (error) {
        console.log("Track order error:", error);
        showError(t("serverError", "Server error."));
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
        ${timelineStep(
        "pending",
        t("trackingStepOrderReceived", "Order Received"),
        t("trackingStepOrderReceivedText", "We received your order."),
        status
    )}

        ${timelineStep(
        "paid",
        t("trackingStepPaid", "Payment Confirmed"),
        t("trackingStepPaidText", "Payment has been checked."),
        status
    )}

        ${timelineStep(
        "processing",
        t("trackingStepProcessing", "Processing"),
        t("trackingStepProcessingText", "Your top-up is being processed."),
        status
    )}

        ${timelineStep(
        "completed",
        t("trackingStepCompleted", "Completed"),
        t("trackingStepCompletedText", "Your order is completed."),
        status
    )}

        ${["failed", "cancelled"].includes(status)
            ? timelineStep(
                "failed",
                t("trackingStepFailed", "Failed / Cancelled"),
                t("trackingStepFailedText", "Order failed or was cancelled."),
                status
            )
            : ""
        }
    `;
}

function renderRefundTimeline(status) {
    return `
        ${timelineStep(
        "refund_requested",
        t("refundRequested", "Refund Requested"),
        t("refundRequestedText", "Your refund request was submitted."),
        status
    )}

        ${timelineStep(
        "refund_review",
        t("refundReview", "Admin Review"),
        t("refundReviewText", "Admin is checking your refund request."),
        status
    )}

        ${status === "refund_rejected"
            ? timelineStep(
                "refund_rejected",
                t("refundRejected", "Refund Rejected"),
                t("refundRejectedText", "Your refund request was rejected."),
                status
            )
            : timelineStep(
                "refunded",
                t("walletRefunded", "Wallet Refunded"),
                t("walletRefundedText", "Refund has been returned to your AZIEL Wallet."),
                status
            )
        }
    `;
}

function renderRefundAction(order, status) {
    if (!canRequestRefund(order, status)) return "";

    return `
        <div class="refund-action-box">
            <strong>${t("refundActionTitle", "Order issue?")}</strong>

            <p>
                ${t(
        "refundActionText",
        "You can request a wallet refund for failed or cancelled orders."
    )}
            </p>

            <button type="button" id="requestRefundBtn">
                ${t("actionRequestRefund", "Request Refund")}
            </button>
        </div>
    `;
}

function renderRefundStatusBox(order, status) {
    if (status === "refund_requested") {
        return `
            <div class="refund-box pending">
                <strong>${t("refundRequested", "Refund Requested")}</strong>

                <p>
                    ${t("refundRequestedReviewText", "Admin is reviewing your refund request.")}
                </p>

                <small>
                    ${escapeHTML(order.refundRequestReason || t("refundRequestSubmitted", "Refund request submitted."))}
                </small>
            </div>
        `;
    }

    if (status === "refund_rejected") {
        return `
            <div class="refund-box rejected">
                <strong>${t("refundRejected", "Refund Rejected")}</strong>

                <p>
                    ${t("refundRejectedBoxText", "Your refund request was rejected.")}
                </p>

                <small>
                    ${escapeHTML(
            order.refundRejectedReason ||
            t("refundRejectedHelpText", "Please contact support for more details.")
        )}
                </small>
            </div>
        `;
    }

    if (status === "refunded") {
        return `
            <div class="refund-box success">
                <strong>${t("walletRefunded", "Wallet Refunded")}</strong>

                <p>
                    ${Number(order.refundAmount || order.amount || 0).toLocaleString()}
                    ${escapeHTML(order.currency || "")}
                    ${t("refundReturnedToWallet", "has been returned to your AZIEL Wallet.")}
                </p>

                <small>
                    ${escapeHTML(order.refundReason || t("refundCompleted", "Refund completed."))}
                </small>
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
        setRefundMsg(t("trackingOrderNotFound", "Order not found."), "error");
        return;
    }

    const reason = reasonInput?.value.trim();

    if (!reason) {
        setRefundMsg(t("refundEnterReason", "Please enter refund reason."), "error");
        return;
    }

    const username =
        window.AZIEL?.user?.username ||
        localStorage.getItem("username") ||
        "";

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerText = t("submitting", "Submitting...");
        }

        const res = await fetch(
            trackingApiUrl(`/api/order/${encodeURIComponent(order.orderId)}/refund-request`),
            {
                method: "POST",
                headers: getTrackingAuthHeaders({
                    "Content-Type": "application/json"
                }),
                body: JSON.stringify({
                    username,
                    reason
                })
            }
        );

        const data = await res.json();

        if (!res.ok || !data.success) {
            setRefundMsg(
                data.message || t("refundRequestFailed", "Refund request failed."),
                "error"
            );
            return;
        }

        setRefundMsg(
            t("refundRequestSubmitted", "Refund request submitted."),
            "success"
        );

        setTimeout(() => {
            closeRefundModal();
            trackOrder(order.orderId);
            loadRecentOrders();
        }, 800);

    } catch (error) {
        console.log("Refund request error:", error);
        setRefundMsg(t("serverError", "Server error."), "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = t("refundSubmit", "Submit Refund Request");
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
        pending: t("statusPending", "Pending"),
        paid: t("statusPaid", "Paid"),
        processing: t("statusProcessing", "Processing"),
        completed: t("statusCompleted", "Completed"),
        failed: t("statusFailed", "Failed"),
        cancelled: t("statusCancelled", "Cancelled"),
        refund_requested: t("statusRefundRequested", "Refund Requested"),
        refund_rejected: t("statusRefundRejected", "Refund Rejected"),
        refunded: t("statusRefunded", "Refunded")
    };

    return map[status] || t("statusPending", "Pending");
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
        pending: t("notePending", "Please wait while we confirm your payment."),
        paid: t("notePaid", "Payment confirmed. Waiting for processing."),
        processing: t("noteProcessing", "Your order is processing."),
        completed: t("noteCompleted", "Your order has been completed."),
        failed: t("noteFailed", "Your order failed. You may request a wallet refund."),
        cancelled: t("noteCancelled", "Your order was cancelled. You may request a wallet refund."),
        refund_requested: t("noteRefundRequested", "Refund request submitted. Admin will review your request."),
        refund_rejected: t("noteRefundRejected", "Refund request was rejected. Please contact support if needed."),
        refunded: t("noteRefunded", "This order has been refunded to your AZIEL Wallet.")
    };

    return map[status] || t("noteDefault", "Please wait while we process your order.");
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

    popup.innerHTML = `
        🔔 ${t("statusUpdated", "Status Updated")}:
        <b>${formatStatus(normalizeStatus(status))}</b>
    `;

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
                ${t("loginRequired", "Login required.")}
            </p>
        `;
        return;
    }

    try {
        const res = await fetch(
            trackingApiUrl(`/api/order/user/${encodeURIComponent(username)}`),
            {
                headers: getTrackingAuthHeaders()
            }
        );

        const data = await res.json();

        if (!data.success || !data.orders?.length) {
            box.innerHTML = `
                <p class="empty-orders">
                    ${t("noRecentOrders", "No recent orders.")}
                </p>
            `;
            return;
        }

        const recentOrders = data.orders.slice(0, 5);

        box.innerHTML = recentOrders.map(order => `
            <div class="recent-order-item"
                 onclick="trackRecentOrder('${escapeHTML(order.orderId)}')">

                <div class="recent-order-left">
                    <h4>${escapeHTML(order.game || t("game", "Game"))}</h4>
                    <p>${escapeHTML(order.packageName || "-")}</p>
                </div>

                <div class="recent-order-status ${normalizeStatus(order.status)}">
                    ${formatStatus(normalizeStatus(order.status))}
                </div>
            </div>
        `).join("");

    } catch (error) {
        console.log("Recent orders error:", error);
        box.innerHTML = `
            <p class="empty-orders">
                ${t("serverError", "Server error.")}
            </p>
        `;
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
