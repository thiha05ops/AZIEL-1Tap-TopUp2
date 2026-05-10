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