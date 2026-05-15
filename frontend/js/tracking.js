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
        lastStatus = order.status;

        result.innerHTML = `
            <div class="track-card">
                <h2>${order.game || "Order"}</h2>

                <p><b>Order ID:</b> ${order.orderId || "-"}</p>
                <p><b>User:</b> ${order.username || "-"}</p>
                <p><b>User ID:</b> ${order.userId || "-"}</p>
                <p><b>Server:</b> ${order.zoneId || "-"}</p>
                <p><b>Package:</b> ${order.packageName || order.selectedPackage || "-"}</p>
                <p><b>Amount:</b> ${order.amount || 0} ${order.currency || ""}</p>
                <p><b>Payment:</b> ${order.paymentMethod || "-"}</p>

                <div class="tracking-timeline">
                    ${stepHTML("stepPending", "Pending")}
                    <div class="tracking-line"></div>
                    ${stepHTML("stepPaid", "Paid")}
                    <div class="tracking-line"></div>
                    ${stepHTML("stepProcessing", "Processing")}
                    <div class="tracking-line"></div>
                    ${stepHTML("stepCompleted", "Completed")}
                </div>

                <p class="track-note">
                    ${order.note || "Please wait while we process your order."}
                </p>
            </div>
        `;

        updateTrackingSteps(order.status);

    } catch (error) {
        console.log("Track order error:", error);
        showError("Server error.");
    }
}

function stepHTML(id, label) {
    return `
        <div class="tracking-step" id="${id}">
            <div class="tracking-circle"></div>
            <span>${label}</span>
        </div>
    `;
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

function updateTrackingSteps(status) {
    const steps = {
        pending_payment: ["stepPending"],
        pending: ["stepPending"],
        paid: ["stepPending", "stepPaid"],
        processing: ["stepPending", "stepPaid", "stepProcessing"],
        completed: ["stepPending", "stepPaid", "stepProcessing", "stepCompleted"]
    };

    document.querySelectorAll(".tracking-step")
        .forEach(step => step.classList.remove("active"));

    (steps[status] || ["stepPending"]).forEach(id => {
        document.getElementById(id)?.classList.add("active");
    });
}

function showTrackingPopup(status) {
    const old = document.querySelector(".tracking-popup");
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.className = "tracking-popup";
    popup.innerHTML = `🔔 Order Status Updated: <b>${status}</b>`;

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