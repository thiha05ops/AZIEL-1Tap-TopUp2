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

    if (typeof io === "undefined") {
        console.log("Socket.IO not loaded");
        return;
    }

    const username =
        localStorage.getItem("username");

    if (!username) return;

    const socket = io();

    socket.emit("joinUser", username);

    socket.off("newNotificationPage");

    socket.on("newNotification", data => {

        console.log(
            "📩 Notification page live:",
            data
        );

        prependLiveNotification(data);

    });

});

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