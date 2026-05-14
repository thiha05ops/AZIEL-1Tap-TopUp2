// frontend/js/notification-live.js

let notifications = [];
let socketInitialized = false;

document.addEventListener("DOMContentLoaded", () => {
    if (socketInitialized) return;
    socketInitialized = true;

    setupNotificationDropdown();

    if (typeof io === "undefined") {
        console.log("Socket.IO not loaded");
        return;
    }

    const username = localStorage.getItem("username");

    if (!username) {
        console.log("No username found");
        return;
    }

    const socket = io();

    socket.emit("joinUser", username);

    loadNotifications(username);

    socket.off("newNotification");

    socket.on("newNotification", data => {
        console.log("🔔 Live Notification:", data);

        addNotificationToDropdown(data);
        updateUnreadBadge();
        showLiveNotification(data);
    });
});

async function loadNotifications(username) {
    try {
        const res = await fetch(`/api/notifications/${username}`);
        const data = await res.json();

        if (!data.success) return;

        notifications = (data.notifications || []).map(item => ({
            _id: item._id,
            title: item.title || "Notification",
            message: item.message || "",
            time: new Date(item.createdAt).toLocaleTimeString(),
            isRead: item.isRead || false
        }));

        renderNotificationDropdown();
        updateUnreadBadge();

    } catch (error) {
        console.log("Load notifications error:", error);
    }
}

function addNotificationToDropdown(data) {
    notifications.unshift({
        _id: data._id || data.id || "",
        title: data.title || "Notification",
        message: data.message || "",
        time: new Date().toLocaleTimeString(),
        isRead: data.isRead || false
    });

    renderNotificationDropdown();
}

function renderNotificationDropdown() {
    const list = document.getElementById("notificationList");

    if (!list) return;

    if (!notifications.length) {
        list.innerHTML = `
            <div class="notification-empty">
                No notifications
            </div>
        `;
        return;
    }

    list.innerHTML = notifications.map(item => `
        <div
            class="notification-item ${item.isRead ? "" : "unread"}"
            data-id="${item._id}"
        >
            <div class="notification-title">
                ${item.title}
            </div>

            <div class="notification-message">
                ${item.message}
            </div>

            <div class="notification-time">
                ${item.time}
            </div>
        </div>
    `).join("");

    document.querySelectorAll(".notification-item").forEach(el => {
        el.addEventListener("click", () => {
            markNotificationRead(el.dataset.id);
        });
    });
}

async function markNotificationRead(id) {
    if (!id) return;

    try {
        const res = await fetch(`/api/notifications/${id}/read`, {
            method: "PUT"
        });

        const data = await res.json();

        if (!data.success) return;

        const item = notifications.find(n => n._id === id);

        if (item) {
            item.isRead = true;
        }

        renderNotificationDropdown();
        updateUnreadBadge();

    } catch (error) {
        console.log("Mark notification read error:", error);
    }
}

function updateUnreadBadge() {
    const badge = document.getElementById("notificationCount");

    if (!badge) return;

    const unread = notifications.filter(n => !n.isRead).length;

    badge.innerText = unread;
}

function showLiveNotification(data) {
    const old = document.getElementById("liveNotificationPopup");

    if (old) old.remove();

    const popup = document.createElement("div");

    popup.id = "liveNotificationPopup";

    popup.innerHTML = `
        <strong>🔔 ${data.title || "Notification"}</strong>
        <br>
        ${data.message || ""}
    `;

    document.body.appendChild(popup);

    popup.style.position = "fixed";
    popup.style.top = "20px";
    popup.style.right = "-420px";
    popup.style.background = "linear-gradient(135deg,#2563eb,#1d4ed8)";
    popup.style.color = "#fff";
    popup.style.padding = "18px 20px";
    popup.style.borderRadius = "18px";
    popup.style.zIndex = "999999";
    popup.style.fontWeight = "700";
    popup.style.transition = ".4s";
    popup.style.boxShadow = "0 12px 40px rgba(0,0,0,.35)";
    popup.style.maxWidth = "320px";

    setTimeout(() => {
        popup.style.right = "20px";
    }, 100);

    setTimeout(() => {
        popup.style.right = "-420px";

        setTimeout(() => {
            if (popup.parentNode) {
                popup.remove();
            }
        }, 400);
    }, 5000);
}

function setupNotificationDropdown() {
    document.addEventListener("click", e => {
        const bell = document.getElementById("notificationBell");
        const dropdown = document.getElementById("notificationDropdown");

        if (!bell || !dropdown) return;

        if (bell.contains(e.target)) {
            e.stopPropagation();
            dropdown.classList.toggle("show");
            return;
        }

        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove("show");
        }
    });
}