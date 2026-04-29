function getStatusClass(status) {
    if (status === "paid") return "status-paid";
    if (status === "processing") return "status-processing";
    if (status === "completed") return "status-completed";
    return "status-pending";
}

async function loadOrders() {

    const res = await fetch("/api/admin/orders", {
        headers: { "x-admin-password": ADMIN_PASSWORD }
    });

    const data = await res.json();

    if (!data.success) {
        alert("Wrong password");
        return;
    }

    document.getElementById("adminContent").style.display = "block";

    const box = document.getElementById("ordersList");
    box.innerHTML = "";

    data.orders.forEach(order => {

        box.innerHTML += `
        <tr>
            <td>${order.orderId}</td>
            <td>${order.game}</td>
            <td>${order.amount} ${order.currency}</td>

            <td>
                <span class="status-badge ${getStatusClass(order.status)}">
                    ${order.status}
                </span>
            </td>

            <td>
                ${order.paymentSlip ? `<img src="/uploads/${order.paymentSlip}" class="slip-img">` : "-"}
            </td>

            <td>
                <button class="btn small" onclick="updateStatus('${order._id}','processing')">Processing</button>
                <button class="btn small success" onclick="updateStatus('${order._id}','completed')">Done</button>
            </td>
        </tr>
        `;
    });
}