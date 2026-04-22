document.addEventListener("DOMContentLoaded", async () => {

    const token = localStorage.getItem("token");
    const username = localStorage.getItem("username");

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    const historyList = document.getElementById("historyList");

    try {
        const res = await fetch(`/api/history/${username}`);
        const data = await res.json();

        if (data.success && data.orders.length > 0) {

            historyList.innerHTML = data.orders.map(order => `
                <div class="history-card">
                    <p>💎 ${order.packageName}</p>
                    <p>ID: ${order.userId} (${order.serverId})</p>
                    <p>Status: ${order.status}</p>
                    <small>${new Date(order.createdAt).toLocaleString()}</small>
                </div>
            `).join("");

        } else {
            historyList.innerHTML = "<p>No orders yet.</p>";
        }

    } catch (error) {
        historyList.innerHTML = "<p>Server error</p>";
    }

});