// frontend/js/tracking.js

let allTrackingOrders = [];
let selectedOrderId = "";
let lastStatus = "";

document.addEventListener("DOMContentLoaded", () => {
    loadMyOrders();

    document.getElementById("trackBtn")?.addEventListener("click", () => {
        const orderId = document.getElementById("orderIdInput").value.trim();
        if (!orderId) return alert("Please enter Order ID");

        selectedOrderId = orderId;
        trackOrder(orderId);
    });

    setInterval(checkLiveTracking, 5000);
});

async function loadMyOrders() {
    const username = localStorage.getItem("username");
    const result = document.getElementById("trackingResult");

    if (!username) {
        result.innerHTML = `<p class="error-msg">Please login first.</p>`;
        return;
    }

    try {
        const res = await fetch(`/api/history/${username}`);
        const data = await res.json();

        if (!data.success || !data.orders.length) {
            result.innerHTML = `<p class="error-msg">No orders found.</p>`;
            return;
        }

        allTrackingOrders = data.orders;

        result.innerHTML = `
            <div class="orders-track-list">
                <h2>My Orders</h2>

                ${allTrackingOrders.map(order => `
                    <div class="mini-order-card"
                         onclick="selectTrackingOrder('${order.orderId}')">
                        <b>${order.game}</b>
                        <span>${order.packageName}</span>
                        <small>${order.orderId}</small>
                        <em class="${statusClass(order.status)}">${order.status}</em>
                    </div>
                `).join("")}
            </div>
        `;

    } catch (error) {
        result.innerHTML = `<p class="error-msg">Server error.</p>`;
    }
}

function selectTrackingOrder(orderId) {
    selectedOrderId = orderId;
    document.getElementById("orderIdInput").value = orderId;
    trackOrder(orderId);
}

async function trackOrder(orderId) {
    const result = document.getElementById("trackingResult");

    result.innerHTML = `<p>Loading...</p>`;

    try {
        const res = await fetch(`/api/order/track/${orderId}`);
        const data = await res.json();

        if (!data.success || !data.order) {
            result.innerHTML = `<p class="error-msg">${data.message}</p>`;
            return;
        }

        const o = data.order;
        lastStatus = o.status;

        result.innerHTML = `
            <div class="track-card">
                <button class="back-orders-btn" onclick="loadMyOrders()">← Back Orders</button>

                <h2>${o.game}</h2>

                <p><b>Order ID:</b> ${o.orderId}</p>
                <p><b>User ID:</b> ${o.userId}</p>
                <p><b>Server:</b> ${o.zoneId || "-"}</p>
                <p><b>Package:</b> ${o.packageName}</p>
                <p><b>Amount:</b> ${o.amount} ${o.currency}</p>
                <p><b>Payment:</b> ${o.paymentMethod}</p>

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
                    ${o.note || "Please wait while we process your order."}
                </p>
            </div>
        `;

        updateTrackingSteps(o.status);

    } catch (error) {
        result.innerHTML = `<p class="error-msg">Server error.</p>`;
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
    if (!selectedOrderId) return;

    try {
        const res = await fetch(`/api/order/track/${selectedOrderId}`);
        const data = await res.json();

        if (!data.success || !data.order) return;

        if (data.order.status !== lastStatus) {
            lastStatus = data.order.status;
            showTrackingPopup(data.order.status);
            trackOrder(selectedOrderId);
        }

    } catch (error) {
        console.log("Live tracking error:", error);
    }
}

function updateTrackingSteps(status) {
    const steps = {
        pending_payment: ["stepPending"],
        paid: ["stepPending", "stepPaid"],
        processing: ["stepPending", "stepPaid", "stepProcessing"],
        completed: ["stepPending", "stepPaid", "stepProcessing", "stepCompleted"]
    };

    document.querySelectorAll(".tracking-step")
        .forEach(step => step.classList.remove("active"));

    (steps[status] || []).forEach(id => {
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

function statusClass(status) {
    if (status === "paid") return "status-paid";
    if (status === "processing") return "status-processing";
    if (status === "completed") return "status-completed";
    if (status === "cancelled" || status === "failed") return "status-failed";
    return "status-pending";
}