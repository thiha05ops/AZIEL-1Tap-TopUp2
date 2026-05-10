// frontend/js/notifications-live.js

document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username");
    if (!username) return;

    setupNotificationUI();

    loadSavedNotifications();
    checkLiveNotifications();

    setInterval(checkLiveNotifications, 5000);
});

function setupNotificationUI() {
    const bell =
        document.getElementById("notifBell") ||
        document.getElementById("notiBtn");

    const panel =
        document.getElementById("notifPanel") ||
        document.getElementById("notiPanel");

    if (bell && panel) {
        bell.addEventListener("click", () => {
            panel.style.display =
                panel.style.display === "block" ? "none" : "block";

            markAllAsRead();
        });
    }
}

async function checkLiveNotifications() {
    const username = localStorage.getItem("username");
    if (!username) return;

    try {
        const res = await fetch(`/api/history/${username}`);
        const data = await res.json();

        if (!data.success || !data.orders) return;

        data.orders.forEach(order => {
            const key = `order_status_${order.orderId}`;
            const oldStatus = localStorage.getItem(key);

            if (!oldStatus) {
                localStorage.setItem(key, order.status);
                return;
            }

            if (oldStatus !== order.status) {
                addNotification({
                    title: "Order Status Updated",
                    message: `${order.game} - ${order.packageName} is now ${order.status}`,
                    orderId: order.orderId,
                    type: "order",
                    read: false,
                    time: new Date().toISOString()
                });

                localStorage.setItem(key, order.status);
            }
        });

        renderNotifications();

    } catch (error) {
        console.log("Live notification error:", error);
    }
}

function addNotification(item) {
    const username = localStorage.getItem("username");
    const key = `aziel_notifications_${username}`;

    const notifications = JSON.parse(localStorage.getItem(key)) || [];

    notifications.unshift(item);

    localStorage.setItem(key, JSON.stringify(notifications.slice(0, 30)));
}

function loadSavedNotifications() {
    renderNotifications();
}

function renderNotifications() {
    const username = localStorage.getItem("username");
    const key = `aziel_notifications_${username}`;

    const notifications = JSON.parse(localStorage.getItem(key)) || [];

    const countEl =
        document.getElementById("notifCount") ||
        document.getElementById("notiCount");

    const listEl =
        document.getElementById("notifList") ||
        document.getElementById("notiList");

    const unread = notifications.filter(n => !n.read).length;

    if (countEl) countEl.innerText = unread;

    if (listEl) {
        if (!notifications.length) {
            listEl.innerHTML = `<div class="notif-item">No notifications yet.</div>`;
            return;
        }

        listEl.innerHTML = notifications.map(n => `
            <div class="notif-item ${n.read ? "" : "unread"}"
                 onclick="window.location.href='tracking.html?orderId=${n.orderId}'">
                <b>${n.title}</b>
                <p>${n.message}</p>
                <small>${new Date(n.time).toLocaleString()}</small>
            </div>
        `).join("");
    }
}

function markAllAsRead() {
    const username = localStorage.getItem("username");
    const key = `aziel_notifications_${username}`;

    const notifications = JSON.parse(localStorage.getItem(key)) || [];

    notifications.forEach(n => n.read = true);

    localStorage.setItem(key, JSON.stringify(notifications));

    renderNotifications();
}