document.addEventListener("DOMContentLoaded", async () => {
    const token = localStorage.getItem("token");
    const username = localStorage.getItem("username");

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    const historyList = document.getElementById("historyList");

    async function loadHistory() {
        try {
            const res = await fetch(`/api/history/${username}`);
            const data = await res.json();

            if (data.success && data.orders.length > 0) {
                historyList.innerHTML = data.orders.map(order => `
          <div class="history-card">
            <p>💎 ${order.packageName}</p>
            <p>ID: ${order.userId} (${order.serverId})</p>
            <p>Status: <span class="status-badge ${order.status}">${order.status}</span></p>
            <p>${order.note || ""}</p>
            <small>${new Date(order.createdAt).toLocaleString()}</small>
          </div>
        `).join("");
            } else {
                historyList.innerHTML = "<p>No orders yet.</p>";
            }
        } catch (error) {
            historyList.innerHTML = "<p>Server error</p>";
        }
    }

    loadHistory();

    // auto refresh every 10 seconds
    setInterval(loadHistory, 10000);
});