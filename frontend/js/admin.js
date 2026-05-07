// frontend/js/admin.js

let ADMIN_PASSWORD = "";
let allOrders = [];

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("loginBtn").addEventListener("click", () => {
        ADMIN_PASSWORD = document.getElementById("adminPassword").value.trim();

        if (!ADMIN_PASSWORD) {
            alert("Enter admin password");
            return;
        }

        loadOrders();
    });

    document.getElementById("refreshBtn")?.addEventListener("click", loadOrders);
    document.getElementById("searchOrder")?.addEventListener("input", renderOrders);
    document.getElementById("statusFilter")?.addEventListener("change", renderOrders);
});

async function loadOrders() {
    try {
        const res = await fetch("/api/admin/orders", {
            headers: { "x-admin-password": ADMIN_PASSWORD }
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.message || "Wrong admin password");
            return;
        }

        allOrders = data.orders || [];

        document.getElementById("loginBox").style.display = "none";
        document.getElementById("adminContent").style.display = "block";

        renderStats();
        renderOrders();

    } catch (error) {
        alert("Server error");
    }
}

function renderStats() {
    document.getElementById("totalOrders").innerText = allOrders.length;
    document.getElementById("paidOrders").innerText =
        allOrders.filter(o => o.status === "paid").length;
    document.getElementById("processingOrders").innerText =
        allOrders.filter(o => o.status === "processing").length;
    document.getElementById("completedOrders").innerText =
        allOrders.filter(o => o.status === "completed").length;
}

function renderOrders() {
    const list = document.getElementById("ordersList");
    const search = (document.getElementById("searchOrder")?.value || "").toLowerCase();
    const filter = document.getElementById("statusFilter")?.value || "all";

    let orders = [...allOrders];

    if (filter !== "all") {
        orders = orders.filter(o => o.status === filter);
    }

    if (search) {
        orders = orders.filter(o =>
            String(o.orderId || "").toLowerCase().includes(search) ||
            String(o.username || "").toLowerCase().includes(search) ||
            String(o.game || "").toLowerCase().includes(search) ||
            String(o.userId || "").toLowerCase().includes(search)
        );
    }

    if (!orders.length) {
        list.innerHTML = `
            <tr>
                <td colspan="9">No orders found</td>
            </tr>
        `;
        return;
    }

    list.innerHTML = orders.map(order => `
        <tr>
            <td>
                <b>${order.orderId}</b><br>
                <small>${formatDate(order.createdAt)}</small>
            </td>

            <td>${order.username || "guest"}</td>

            <td>
                ${order.game}<br>
                <small>ID: ${order.userId || "-"}</small><br>
                <small>Server: ${order.zoneId || "-"}</small>
            </td>

            <td>${order.packageName}</td>

            <td>${order.amount || 0} ${order.currency || ""}</td>

            <td>${order.paymentMethod || "-"}</td>

            <td>
                <span class="status-badge ${statusClass(order.status)}">
                    ${order.status}
                </span>
            </td>

            <td>
                ${order.paymentSlip
            ? `<img src="/uploads/${order.paymentSlip}" class="slip-img" onclick="window.open('/uploads/${order.paymentSlip}','_blank')">`
            : "-"
        }
            </td>

            <td>
                <div class="action-grid">
                    <button class="btn-paid" onclick="updateStatus('${order._id}','paid')">Paid</button>
                    <button class="btn-processing" onclick="updateStatus('${order._id}','processing')">Process</button>
                    <button class="btn-completed" onclick="updateStatus('${order._id}','completed')">Done</button>
                    <button class="btn-cancel" onclick="updateStatus('${order._id}','cancelled')">Cancel</button>
                </div>
            </td>
        </tr>
    `).join("");
}

async function updateStatus(id, status) {
    try {
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

        await loadOrders();

    } catch (error) {
        alert("Server error");
    }
}

function statusClass(status) {
    if (status === "paid") return "status-paid";
    if (status === "processing") return "status-processing";
    if (status === "completed") return "status-completed";
    if (status === "cancelled" || status === "failed") return "status-failed";
    return "status-pending";
}

function formatDate(date) {
    if (!date) return "-";
    return new Date(date).toLocaleString();
}