// frontend/js/tracking.js

document.addEventListener("DOMContentLoaded", () => {

    const trackBtn = document.getElementById("trackBtn");
    const orderIdInput = document.getElementById("orderIdInput");
    const result = document.getElementById("trackingResult");

    trackBtn.addEventListener("click", async () => {

        const orderId = orderIdInput.value.trim();

        if (!orderId) {
            result.innerHTML = `<p class="error-msg">Please enter Order ID.</p>`;
            return;
        }

        try {
            const res = await fetch(`/api/order/track/${orderId}`);
            const data = await res.json();

            if (!data.success) {
                result.innerHTML = `<p class="error-msg">${data.message}</p>`;
                return;
            }

            const order = data.order;

            result.innerHTML = `
                <div class="track-card">
                    <h2>Order Found ✅</h2>
                    <p><b>Order ID:</b> ${order.orderId}</p>
                    <p><b>Game:</b> ${order.game}</p>
                    <p><b>Package:</b> ${order.packageName}</p>
                    <p><b>Amount:</b> ${order.amount} ${order.currency}</p>
                    <p><b>Payment:</b> ${order.paymentMethod}</p>
                    <p><b>Status:</b> <span class="status">${order.status}</span></p>
                </div>
            `;

        } catch (error) {
            result.innerHTML = `<p class="error-msg">Server error.</p>`;
        }

    });

});