// frontend/js/tracking.js

let currentOrderId = "";
let lastStatus = "";

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
        const orderId = input.value.trim();

        if (!orderId) {
            showError("Please enter Order ID.");
            return;
        }

        trackOrder(orderId);
    });

    setInterval(checkLiveTracking, 5000);
});

async function trackOrder(orderId) {
    const result = document.getElementById("trackingResult");

    currentOrderId = orderId;
    result.innerHTML = `<p class="loading-text">Checking order...</p>`;

    try {
        const res = await fetch(`/api/order/track/${orderId}`);
        const data = await res.json();

        if (!data.success || !data.order) {
            showError(data.message || "Order not found.");
            return;
        }

        const order = data.order;
        const status = normalizeStatus(order.status);

        lastStatus = order.status;

        result.innerHTML = `
            <div class="order-track-card">
                <div class="track-head">
                    <div>
                        <span class="track-mini">AZIEL ORDER TRACKING</span>
                        <h2>${order.game || "Game TopUp Order"}</h2>
                    </div>

                    <span class="track-status status-${status}">
                        ${formatStatus(status)}
                    </span>
                </div>

                <div class="track-info-grid">
                    ${infoItem("Order ID", order.orderId || "-")}
                    ${infoItem("Username", order.username || "-")}
                    ${infoItem("User ID", order.userId || "-")}
                    ${infoItem("Server", order.zoneId || "-")}
                    ${infoItem("Package", order.packageName || order.selectedPackage || "-")}
                    ${infoItem("Amount", `${order.amount || 0} ${order.currency || ""}`)}
                    ${infoItem("Payment", order.paymentMethod || "-")}
                    ${infoItem("Region", order.region || "-")}
                </div>

                <div class="timeline">
                    ${timelineItem("pending", "Pending", "Order received", status)}
                    ${timelineItem("paid", "Paid", "Payment confirmed", status)}
                    ${timelineItem("processing", "Processing", "Your order is being processed", status)}
                    ${timelineItem("completed", "Completed", "Order completed successfully", status)}
                </div>

                <div class="track-note-box">
                    ${order.note || "Please wait while we process your order."}
                </div>
            </div>
        `;

    } catch (error) {
        console.log("Track order error:", error);
        showError("Server error.");
    }
}

function infoItem(label, value) {
    return `
        <div class="track-info-item">
            <small>${label}</small>
            <strong>${value}</strong>
        </div>
    `;
}

function timelineItem(step, title, text, currentStatus) {
    const active = isStepActive(step, currentStatus) ? "active" : "";

    return `
        <div class="timeline-item ${active}">
            <h3>${title}</h3>
            <p>${text}</p>
        </div>
    `;
}

function isStepActive(step, status) {
    const order = ["pending", "paid", "processing", "completed"];
    return order.indexOf(step) <= order.indexOf(status);
}

function normalizeStatus(status) {
    if (!status) return "pending";

    const s = String(status).toLowerCase();

    if (s === "pending_payment") return "pending";
    if (s === "pending") return "pending";
    if (s === "paid") return "paid";
    if (s === "processing") return "processing";
    if (s === "completed") return "completed";

    return "pending";
}

async function checkLiveTracking() {
    if (!currentOrderId) return;

    try {
        const res = await fetch(`/api/order/track/${currentOrderId}`);
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

function formatStatus(status) {
    const map = {
        pending: "PENDING",
        paid: "PAID",
        processing: "PROCESSING",
        completed: "COMPLETED"
    };

    return map[status] || "PENDING";
}

function showTrackingPopup(status) {
    const old = document.querySelector(".tracking-popup");
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.className = "tracking-popup";
    popup.innerHTML = `🔔 Order Status Updated: <b>${formatStatus(normalizeStatus(status))}</b>`;

    document.body.appendChild(popup);

    setTimeout(() => popup.classList.add("show"), 100);

    setTimeout(() => {
        popup.classList.remove("show");
        setTimeout(() => popup.remove(), 400);
    }, 4000);
}

function showError(message) {
    const result = document.getElementById("trackingResult");

    result.innerHTML = `
        <p class="error-msg">
            ${message}
        </p>
    `;
}