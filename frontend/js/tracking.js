document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const orderIdFromUrl = params.get("orderId");

    if (orderIdFromUrl) {
        document.getElementById("orderIdInput").value = orderIdFromUrl;
        trackOrder(orderIdFromUrl);
    }

    document.getElementById("trackBtn").addEventListener("click", () => {
        const orderId = document.getElementById("orderIdInput").value.trim();

        if (!orderId) {
            document.getElementById("trackingResult").innerHTML =
                `<p class="error-msg">Please enter Order ID.</p>`;
            return;
        }

        trackOrder(orderId);
    });
});

async function trackOrder(orderId) {
    const result = document.getElementById("trackingResult");

    result.innerHTML = `<p>Loading...</p>`;

    try {
        const res = await fetch(`/api/order/track/${orderId}`);
        const data = await res.json();

        if (!data.success) {
            result.innerHTML = `<p class="error-msg">${data.message}</p>`;
            return;
        }

        const o = data.order;

        result.innerHTML = `
            <div class="track-card">
                <h2>${o.game}</h2>
                <p><b>Order ID:</b> ${o.orderId}</p>
                <p><b>User ID:</b> ${o.userId}</p>
                <p><b>Server:</b> ${o.zoneId || "-"}</p>
                <p><b>Package:</b> ${o.packageName}</p>
                <p><b>Amount:</b> ${o.amount} ${o.currency}</p>
                <p><b>Payment:</b> ${o.paymentMethod}</p>
                <p><b>Status:</b> <span class="status ${statusClass(o.status)}">${o.status}</span></p>

                <div class="timeline">
                    ${stepItem("pending_payment", "Order Created", o.status)}
                    ${stepItem("paid", "Payment Received", o.status)}
                    ${stepItem("processing", "Processing TopUp", o.status)}
                    ${stepItem("completed", "Completed", o.status)}
                </div>

                <p class="track-note">${o.note || "Please wait while we process your order."}</p>
            </div>
        `;

    } catch (error) {
        result.innerHTML = `<p class="error-msg">Server error.</p>`;
    }
}

function stepItem(step, label, current) {
    const order = ["pending_payment", "paid", "processing", "completed"];
    const active = order.indexOf(current) >= order.indexOf(step);

    return `
        <div class="timeline-step ${active ? "active" : ""}">
            <span></span>
            <p>${label}</p>
        </div>
    `;
}

function statusClass(status) {
    if (status === "paid") return "status-paid";
    if (status === "processing") return "status-processing";
    if (status === "completed") return "status-completed";
    if (status === "cancelled" || status === "failed") return "status-failed";
    return "status-pending";
}