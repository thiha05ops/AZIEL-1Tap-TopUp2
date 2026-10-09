document.addEventListener("DOMContentLoaded", async () => {
    const username = localStorage.getItem("username") || "guest";
    const box = document.getElementById("notiList");

    try {
        const res = await fetch(`/api/history/${username}`);
        const data = await res.json();

        if (!data.success || !data.orders || data.orders.length === 0) {
            box.innerHTML = `<p>No notifications</p>`;
            return;
        }

        box.innerHTML = "";

        data.orders.forEach(order => {
            box.innerHTML += `
                <div class="history-card" onclick="window.location.href='tracking.html?orderId=${order.orderId}'">
                    <b>${order.game}</b>
                    <p>${order.packageName}</p>
                    <p><small>${order.orderId}</small></p>
                    <p>Status: <span class="status ${statusClass(order.status)}">${order.status}</span></p>
                </div>
            `;
        });

    } catch (error) {
        box.innerHTML = `<p>Server error</p>`;
    }
});

function statusClass(status) {
    if (status === "paid") return "status-paid";
    if (status === "processing") return "status-processing";
    if (status === "completed") return "status-completed";
    if (status === "cancelled" || status === "failed") return "status-failed";
    return "status-pending";
}