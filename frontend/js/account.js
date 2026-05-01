// frontend/js/account.js

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("notiBtn").onclick = () => {
        const panel = document.getElementById("notiPanel");
        panel.style.display =
            panel.style.display === "block" ? "none" : "block";

        loadBellOrders(); // 🔥 important
    };
    const username = localStorage.getItem("username") || "guest";
    const region = localStorage.getItem("region") || "MM";

    document.getElementById("profileName").innerText =
        localStorage.getItem("displayName") || username;

    document.getElementById("avatarText").innerText =
        username.charAt(0).toUpperCase();

    document.getElementById("profileRegion").innerText =
        "Region: " + region;

    document.getElementById("displayName").value =
        localStorage.getItem("displayName") || username;

    document.getElementById("accountRegion").value = region;

    document.querySelectorAll(".side-link").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".side-link").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

            btn.classList.add("active");
            document.getElementById(btn.dataset.tab).classList.add("active");

            if (btn.dataset.tab === "history") loadHistory();
        });
    });

    document.getElementById("saveProfileBtn").addEventListener("click", () => {
        localStorage.setItem("displayName", document.getElementById("displayName").value.trim() || username);
        localStorage.setItem("region", document.getElementById("accountRegion").value);

        alert("Profile saved ✅");
        location.reload();
    });

    document.getElementById("notiBtn").addEventListener("click", () => {
        const panel = document.getElementById("notiPanel");
        panel.style.display = panel.style.display === "block" ? "none" : "block";
        loadBellOrders();
    });

    loadHistory();
    loadBellOrders();

    setInterval(() => {
        loadHistory();
        loadBellOrders();
    }, 8000);
});

async function loadHistory() {
    const username = localStorage.getItem("username") || "guest";
    const box = document.getElementById("historyList");

    try {
        const res = await fetch(`/api/history/${username}`);
        const data = await res.json();

        if (!data.success) {
            box.innerHTML = `<p>No history found.</p>`;
            return;
        }

        renderStats(data.orders);
        renderHistory(data.orders);

    } catch (error) {
        box.innerHTML = `<p>Server error.</p>`;
    }
}

function renderStats(orders) {
    document.getElementById("totalOrders").innerText = orders.length;
    document.getElementById("pendingOrders").innerText =
        orders.filter(o => o.status !== "completed").length;
    document.getElementById("completedOrders").innerText =
        orders.filter(o => o.status === "completed").length;
}

function renderHistory(orders) {
    const box = document.getElementById("historyList");
    box.innerHTML = "";

    if (orders.length === 0) {
        box.innerHTML = `<p>No orders yet.</p>`;
        return;
    }

    orders.forEach(order => {
        box.innerHTML += `
            <div class="history-card">
                <b>${order.orderId}</b>
                <p>${order.game} - ${order.packageName}</p>
                <p>${order.amount} ${order.currency}</p>
                <p>Status: <span class="status ${statusClass(order.status)}">${order.status}</span></p>
                <a href="tracking.html?orderId=${order.orderId}">Track Order</a>
            </div>
        `;
    });
}

async function loadBellOrders() {
    const username = localStorage.getItem("username") || "guest";
    const panel = document.getElementById("notiPanel");
    const count = document.getElementById("notiCount");

    try {
        const res = await fetch(`/api/history/${username}`);
        const data = await res.json();

        if (!data.success || data.orders.length === 0) {
            count.innerText = "0";
            panel.innerHTML = `<div class="noti-item">No order notifications</div>`;
            return;
        }

        const activeOrders = data.orders.filter(o => o.status !== "completed");

        count.innerText = activeOrders.length;

        panel.innerHTML = "";

        data.orders.slice(0, 8).forEach(order => {
            panel.innerHTML += `
                <div class="noti-item" onclick="window.location.href='tracking.html?orderId=${order.orderId}'">
                    🔔 <b>${order.game}</b><br>
                    ${order.packageName}<br>
                    <small>${order.orderId}</small><br>
                    <span class="status ${statusClass(order.status)}">${order.status}</span>
                </div>
            `;
        });

    } catch (error) {
        panel.innerHTML = `<div class="noti-item">Server error</div>`;
    }
}

function statusClass(status) {
    if (status === "paid") return "status-paid";
    if (status === "processing") return "status-processing";
    if (status === "completed") return "status-completed";
    if (status === "cancelled" || status === "failed") return "status-failed";
    return "status-pending";
}
setInterval(() => {
    loadBellOrders();
}, 5000);