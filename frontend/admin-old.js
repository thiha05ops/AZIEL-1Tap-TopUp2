document.addEventListener("DOMContentLoaded", () => {
    const adminLoginBox = document.getElementById("adminLoginBox");
    const adminPanel = document.getElementById("adminPanel");
    const adminPassword = document.getElementById("adminPassword");
    const adminLoginBtn = document.getElementById("adminLoginBtn");
    const adminMsg = document.getElementById("adminMsg");
    const adminOrdersList = document.getElementById("adminOrdersList");
    const refreshOrdersBtn = document.getElementById("refreshOrdersBtn");

    let password = localStorage.getItem("adminPassword") || "";

    if (password) {
        adminLoginBox.style.display = "none";
        adminPanel.style.display = "block";
        loadOrders();
    }

    adminLoginBtn.addEventListener("click", () => {
        password = adminPassword.value.trim();

        if (!password) {
            adminMsg.innerText = "❌ Enter password";
            return;
        }

        localStorage.setItem("adminPassword", password);
        adminLoginBox.style.display = "none";
        adminPanel.style.display = "block";
        loadOrders();
    });

    refreshOrdersBtn.addEventListener("click", loadOrders);

    async function loadOrders() {
        adminOrdersList.innerHTML = "<p>Loading...</p>";

        try {
            const res = await fetch("/api/admin/orders", {
                headers: {
                    "x-admin-password": password
                }
            });

            const data = await res.json();

            if (!data.success) {
                adminOrdersList.innerHTML = `<p>❌ ${data.message}</p>`;
                return;
            }

            if (data.orders.length === 0) {
                adminOrdersList.innerHTML = "<p>No orders yet.</p>";
                return;
            }

            adminOrdersList.innerHTML = data.orders.map(order => `
        <div class="admin-order-card">
          <div>
            <h3>${order.packageName}</h3>
            <p><strong>User:</strong> ${order.username}</p>
            <p><strong>Game ID:</strong> ${order.userId} (${order.serverId})</p>
            <p><strong>Payment:</strong> ${order.paymentMethod || "-"}</p>
            <p><strong>Status:</strong> <span class="status-badge ${order.status}">${order.status}</span></p>
            <small>${new Date(order.createdAt).toLocaleString()}</small>
          </div>

          <div class="admin-actions">
            <button onclick="updateStatus('${order._id}', 'Pending')">Pending</button>
            <button onclick="updateStatus('${order._id}', 'Processing')">Processing</button>
            <button onclick="updateStatus('${order._id}', 'Done')">Done</button>
            <button onclick="updateStatus('${order._id}', 'Cancelled')">Cancel</button>
          </div>
        </div>
      `).join("");

        } catch (error) {
            adminOrdersList.innerHTML = "<p>❌ Server error</p>";
        }
    }

    window.updateStatus = async (orderId, status) => {
        try {
            const res = await fetch(`/api/admin/orders/${orderId}/status`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "x-admin-password": password
                },
                body: JSON.stringify({ status })
            });

            const data = await res.json();

            if (data.success) {
                loadOrders();
            } else {
                alert(data.message);
            }
        } catch (error) {
            alert("Server error");
        }
    };
});