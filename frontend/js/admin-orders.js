function renderOrders(orders) {
    const body = document.getElementById("adminOrdersBody");
    if (!body) return;

    if (!orders.length) {
        body.innerHTML = `
            <tr>
                <td colspan="6">No orders found</td>
            </tr>
        `;
        return;
    }

    body.innerHTML = orders.map(order => {
        const safeOrder = encodeURIComponent(JSON.stringify(order));

        return `
            <tr>
                <td onclick="openOrderModal(JSON.parse(decodeURIComponent('${safeOrder}')))">
                    ${order.orderId || "-"}
                </td>

                <td>${order.username || "-"}</td>
                <td>${order.game || "-"}</td>
                <td>${order.packageName || "-"}</td>

                <td>
                    <span class="admin-status ${normalizeStatus(order.status)}">
                        ${formatStatus(order.status)}
                    </span>
                </td>

                <td>
                    <select
                        onchange="updateOrderStatus('${order._id}', this.value)"
                        class="admin-status-select">

                        <option value="pending_payment" ${order.status === "pending_payment" ? "selected" : ""}>Pending</option>
                        <option value="paid" ${order.status === "paid" ? "selected" : ""}>Paid</option>
                        <option value="processing" ${order.status === "processing" ? "selected" : ""}>Processing</option>
                        <option value="completed" ${order.status === "completed" ? "selected" : ""}>Completed</option>
                        <option value="cancelled" ${order.status === "cancelled" ? "selected" : ""}>Cancelled</option>
                    </select>
                </td>
            </tr>
        `;
    }).join("");
}