// frontend/js/notification-live.js

let notifications = [];

function notificationLiveApiUrl(path) {
    if (window.AZIEL?.apiUrl) {
        return window.AZIEL.apiUrl(path);
    }

    const base =
        location.port === "5500"
            ? "http://localhost:3000"
            : "";

    return `${base}${path}`;
}

document.addEventListener("DOMContentLoaded", () => {
    startNotificationSystem();
});

function startNotificationSystem() {
    if (window.__notificationSystemStarted) return;

    window.__notificationSystemStarted = true;

    const username =
        window.AZIEL?.user?.username ||
        localStorage.getItem("username");

    if (!username) {
        console.log("No username");
        return;
    }

    if (typeof io !== "undefined") {
        const socket =
            location.port === "5500"
                ? io("http://localhost:3000")
                : io();

        socket.emit("joinUser", username);

        socket.on("newNotification", data => {
            console.log("🔔 Notification:", data);

            addNotification(data);
            showNotificationPopup(data);
            playNotificationSound();

            if (typeof prependLiveNotification === "function") {
                prependLiveNotification(data);
            }
        });
    } else {
        console.log("Socket.IO not loaded");
    }

    loadNotifications(username);
    setupNotificationDropdown();
    unlockNotificationSound();
}

async function loadNotifications(username) {
    try {
        const res = await fetch(
            notificationLiveApiUrl(`/api/notifications/${encodeURIComponent(username)}`)
        );

        const data = await res.json();

        if (!data.success) return;

        notifications = data.notifications || [];

        renderNotifications();
        updateUnreadCount();
    } catch (error) {
        console.log("Load notifications error:", error);
    }
}

function addNotification(data) {
    notifications.unshift({
        _id: data._id || Date.now(),
        title: data.title || "Notification",
        message: data.message || "",
        type: data.type || "general",
        orderId: data.orderId || "",
        isRead: false,
        createdAt: new Date()
    });

    renderNotifications();
    updateUnreadCount();
}

function renderNotifications() {
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
        <div class="notification-item ${item.isRead ? "" : "unread"}"
             data-id="${escapeHTML(item._id)}">
            <div class="notification-title">
                ${escapeHTML(item.title)}
            </div>

            <div class="notification-message">
                ${escapeHTML(item.message)}
            </div>

            <div class="notification-time">
                ${escapeHTML(formatNotificationTime(item.createdAt))}
            </div>
        </div>
    `).join("");

    document.querySelectorAll(".notification-item").forEach(item => {
        item.addEventListener("click", () => {
            markAsRead(item.dataset.id);
        });
    });
}

async function markAsRead(id) {
    const target = notifications.find(
        n => String(n._id) === String(id)
    );

    if (!target) return;

    target.isRead = true;

    renderNotifications();
    updateUnreadCount();

    try {
        await fetch(
            notificationLiveApiUrl(`/api/notifications/${encodeURIComponent(id)}/read`),
            { method: "PUT" }
        );
    } catch (error) {
        console.log("Mark notification read error:", error);
    }
}

function updateUnreadCount() {
    const badge = document.getElementById("notificationCount");
    if (!badge) return;

    const unread = notifications.filter(n => !n.isRead).length;

    badge.innerText = unread;
    badge.style.display = unread > 0 ? "flex" : "none";
}

function showNotificationPopup(data) {
    const old = document.getElementById("liveNotificationPopup");
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.id = "liveNotificationPopup";

    popup.innerHTML = `
        <strong>🔔 ${escapeHTML(data.title || "Notification")}</strong>
        <br>
        ${escapeHTML(data.message || "")}
    `;

    document.body.appendChild(popup);

    popup.style.position = "fixed";
    popup.style.top = "20px";
    popup.style.right = "-420px";
    popup.style.background = "linear-gradient(135deg,#7c3aed,#4f46e5)";
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
            popup.remove();
        }, 400);
    }, 5000);
}

function unlockNotificationSound() {
    document.addEventListener(
        "click",
        () => {
            window.__notificationSoundUnlocked = true;
        },
        { once: true }
    );
}

function playNotificationSound() {
    if (!window.__notificationSoundUnlocked) return;

    const soundPath =
        location.port === "5500"
            ? "assets/sounds/notify.mp3"
            : "/assets/sounds/notify.mp3";

    const audio = new Audio(soundPath);
    audio.volume = 0.9;

    audio.play().catch(() => { });
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

function formatNotificationTime(date) {
    if (!date) return "";
    return new Date(date).toLocaleString();
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}