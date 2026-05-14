document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username");
    const list = document.getElementById("notifList");

    if (!list) return;

    if (!username) {
        list.innerHTML = "Please login first.";
        return;
    }

    const key = `aziel_notifications_${username}`;
    const notifications = JSON.parse(localStorage.getItem(key)) || [];

    if (!notifications.length) {
        list.innerHTML = "No notifications yet.";
        return;
    }

    list.innerHTML = notifications.map(n => `
        <div class="notif-item"
             onclick="window.location.href='tracking.html?orderId=${n.orderId}'">
            <b>${n.title || "Notification"}</b>
            <p>${n.message || ""}</p>
            <small>${n.time ? new Date(n.time).toLocaleString() : ""}</small>
        </div>
    `).join("");
});
// ======================
// LIVE NOTIFICATION PAGE
// ======================

document.addEventListener("DOMContentLoaded", () => {
    loadNotificationPage();
});

async function loadNotificationPage() {
    const username = localStorage.getItem("username");
    const list = document.getElementById("notificationsList");

    if (!list) return;

    if (!username) {
        list.innerHTML = `<div class="notification-empty">Please login first.</div>`;
        return;
    }

    try {
        const res = await fetch(`/api/notifications/${username}`);
        const data = await res.json();

        if (!data.success || !data.notifications.length) {
            list.innerHTML = `<div class="notification-empty">No notifications yet.</div>`;
            return;
        }

        list.innerHTML = data.notifications.map(n => `
            <div class="notification-card ${n.isRead ? "" : "unread"}">
                <div class="notification-card-title">🔔 ${n.title}</div>
                <div class="notification-card-message">${n.message}</div>
                <div class="notification-card-time">
                    ${new Date(n.createdAt).toLocaleString()}
                </div>
            </div>
        `).join("");

    } catch (error) {
        console.log(error);
        list.innerHTML = `<div class="notification-empty">Failed to load notifications.</div>`;
    }
}

function prependLiveNotification(data) {

    const list =
        document.getElementById(
            "notificationsList"
        );

    if (!list) return;

    const empty =
        list.querySelector(
            ".notification-empty"
        );

    if (empty) {
        empty.remove();
    }

    const item =
        document.createElement("div");

    item.className =
        "notification-card unread";

    item.innerHTML = `
        <div class="notification-card-title">
            🔔 ${data.title || "Notification"}
        </div>

        <div class="notification-card-message">
            ${data.message || ""}
        </div>

        <div class="notification-card-time">
            Just now
        </div>
    `;

    list.prepend(item);

}