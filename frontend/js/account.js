// frontend/js/account.js

document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username") || "guest";
    const region = localStorage.getItem("region") || "MM";

    const profileName = document.getElementById("profileName");
    const avatarText = document.getElementById("avatarText");
    const profileRegion = document.getElementById("profileRegion");
    const displayName = document.getElementById("displayName");
    const accountRegion = document.getElementById("accountRegion");

    if (profileName) profileName.innerText = localStorage.getItem("displayName") || username;
    if (avatarText) avatarText.innerText = username.charAt(0).toUpperCase();
    if (profileRegion) profileRegion.innerText = "Region: " + region;
    if (displayName) displayName.value = localStorage.getItem("displayName") || username;
    if (accountRegion) accountRegion.value = region;

    // Sidebar tabs
    document.querySelectorAll(".side-link").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".side-link").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

            btn.classList.add("active");

            const panel = document.getElementById(btn.dataset.tab);
            if (panel) panel.classList.add("active");

            if (btn.dataset.tab === "history") {
                loadHistory();
            }
        });
    });

    // Save profile
    const saveProfileBtn = document.getElementById("saveProfileBtn");

    if (saveProfileBtn) {
        saveProfileBtn.addEventListener("click", () => {
            localStorage.setItem(
                "displayName",
                document.getElementById("displayName").value.trim() || username
            );

            localStorage.setItem(
                "region",
                document.getElementById("accountRegion").value
            );

            alert("Profile saved ✅");
            location.reload();
        });
    }

    // Bell click
    const notiBtn = document.getElementById("notiBtn");

    if (notiBtn) {
        notiBtn.addEventListener("click", () => {
            const panel = document.getElementById("notiPanel");

            if (!panel) return;

            panel.style.display =
                panel.style.display === "block" ? "none" : "block";

            loadBellOrders();
        });
    }

    loadHistory();
    loadBellOrders();

    // Auto refresh
    setInterval(() => {
        loadBellOrders();
        loadHistory();
    }, 5000);
});

async function loadHistory() {
    const username = localStorage.getItem("username") || "guest";
    const box = document.getElementById("historyList");

    if (!box) return;

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
        console.log("History error:", error);
        box.innerHTML = `<p>Server error.</p>`;
    }
}

function renderStats(orders) {
    const totalOrders = document.getElementById("totalOrders");
    const pendingOrders = document.getElementById("pendingOrders");
    const completedOrders = document.getElementById("completedOrders");

    if (totalOrders) totalOrders.innerText = orders.length;

    if (pendingOrders) {
        pendingOrders.innerText = orders.filter(o => o.status !== "completed").length;
    }

    if (completedOrders) {
        completedOrders.innerText = orders.filter(o => o.status === "completed").length;
    }
}

function renderHistory(orders) {
    const box = document.getElementById("historyList");

    if (!box) return;

    box.innerHTML = "";

    if (!orders || orders.length === 0) {
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

    if (!panel || !count) return;

    try {
        const res = await fetch(`/api/history/${username}`);
        const data = await res.json();

        if (!data.success || !data.orders || data.orders.length === 0) {
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
        console.log("Bell error:", error);
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
const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {

        localStorage.removeItem("username");
        localStorage.removeItem("token");

        alert("Logged out");

        window.location.href = "login.html";
    });
}