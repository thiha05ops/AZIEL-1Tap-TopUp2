let ADMIN_PASSWORD = "";

document.getElementById("loginBtn").addEventListener("click", () => {
    ADMIN_PASSWORD = document.getElementById("adminPassword").value.trim();

    if (!ADMIN_PASSWORD) {
        alert("Enter admin password");
        return;
    }

    loadOrders();
});

async function loadOrders() {
    const res = await fetch("/api/admin/orders", {
        headers: {
            "x-admin-password": ADMIN_PASSWORD
        }
    });

    const data = await res.json();

    if (!data.success) {
        alert(data.message || "Wrong password");
        return;
    }

    document.getElementById("adminContent").style.display = "block";

    const box = document.getElementById("ordersList");
    box.innerHTML = "";

    data.orders.forEach(order => {
        box.innerHTML += `
            <div class="track-card">
                <h3>${order.orderId}</h3>
                <p><b>User:</b> ${order.username}</p>
                <p><b>Game:</b> ${order.game}</p>
                <p><b>User ID:</b> ${order.userId}</p>
                <p><b>Server:</b> ${order.zoneId || "-"}</p>
                <p><b>Package:</b> ${order.packageName}</p>
                <p><b>Amount:</b> ${order.amount} ${order.currency}</p>
                <p><b>Payment:</b> ${order.paymentMethod}</p>
                <p><b>Status:</b> ${order.status}</p>

                ${order.paymentSlip ? `<img src="/uploads/${order.paymentSlip}" style="width:140px;border-radius:10px;">` : ""}

                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px;">
                    <button onclick="updateStatus('${order._id}','paid')">Paid</button>
                    <button onclick="updateStatus('${order._id}','processing')">Processing</button>
                    <button onclick="updateStatus('${order._id}','completed')">Completed</button>
                    <button onclick="updateStatus('${order._id}','cancelled')">Cancel</button>
                </div>
            </div>
        `;
    });
}

async function updateStatus(id, status) {
    const res = await fetch(`/api/admin/orders/${id}/status`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "x-admin-password": ADMIN_PASSWORD
        },
        body: JSON.stringify({ status })
    });

    const data = await res.json();

    if (!data.success) {
        alert(data.message || "Update failed");
        return;
    }

    loadOrders();
}