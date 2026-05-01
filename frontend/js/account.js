// frontend/js/account.js

document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username") || "guest";
    const region = localStorage.getItem("region") || "MM";

    const profileName = document.getElementById("profileName");
    const avatarText = document.getElementById("avatarText");
    const profileRegion = document.getElementById("profileRegion");
    const displayName = document.getElementById("displayName");
    const accountRegion = document.getElementById("accountRegion");

    profileName.innerText = localStorage.getItem("displayName") || username;
    avatarText.innerText = username.charAt(0).toUpperCase();
    profileRegion.innerText = "Region: " + region;

    displayName.value = localStorage.getItem("displayName") || username;
    accountRegion.value = region;

    // Tabs
    document.querySelectorAll(".side-link").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".side-link").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

            btn.classList.add("active");
            document.getElementById(btn.dataset.tab).classList.add("active");

            if (btn.dataset.tab === "history") {
                loadHistory();
            }
        });
    });

    // Save profile
    document.getElementById("saveProfileBtn").addEventListener("click", () => {
        localStorage.setItem("displayName", displayName.value.trim() || username);
        localStorage.setItem("region", accountRegion.value);

        profileName.innerText = localStorage.getItem("displayName");
        profileRegion.innerText = "Region: " + accountRegion.value;

        alert("Profile saved ✅");
    });

    // Notification bell
    document.getElementById("notiBtn").addEventListener("click", () => {
        const panel = document.getElementById("notiPanel");
        panel.style.display = panel.style.display === "block" ? "none" : "block";
        loadNotifications();
    });

    loadHistory();
    loadNotifications();
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

        document.getElementById("totalOrders").innerText = data.orders.length;
        document.getElementById("pendingOrders").innerText =
            data.orders.filter(o => o.status !== "completed").length;
        document.getElementById("completedOrders").innerText =
            data.orders.filter(o => o.status === "completed").length;

        box.innerHTML = "";

        data.orders.forEach(order => {
            box.innerHTML += `
                <div class="history-card">
                    <b>${order.orderId || order._id}</b>
                    <p>${order.game} - ${order.packageName}</p>
                    <p>${order.amount || ""} ${order.currency || ""}</p>
                    <p>Status: <b>${order.status}</b></p>
                    <a href="tracking.html?orderId=${order.orderId || order._id}">Track Order</a>
                </div>
            `;
        });

    } catch (error) {
        box.innerHTML = `<p>Server error.</p>`;
    }
}

function loadNotifications() {
    const notiBox = document.getElementById("notiPanel");
    const count = document.getElementById("notiCount");

    const localNoti = JSON.parse(localStorage.getItem("noti")) || [];

    count.innerText = localNoti.length;

    if (localNoti.length === 0) {
        notiBox.innerHTML = `<div class="noti-item">No notifications</div>`;
        return;
    }

    notiBox.innerHTML = "";

    localNoti.forEach(n => {
        notiBox.innerHTML += `
            <div class="noti-item">
                🔔 ${n.text}<br>
                <small>${n.time}</small><br>
                ${n.id ? `<a href="tracking.html?orderId=${n.id}">Track</a>` : ""}
            </div>
        `;
    });
}