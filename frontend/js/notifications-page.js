// frontend/js/notifications-page.js

document.addEventListener("DOMContentLoaded", () => {
    loadNotificationPage();
    initNotificationActions();
});

let pageNotifications = [];

function notificationApiUrl(path) {
    if (window.AZIEL?.apiUrl) {
        return window.AZIEL.apiUrl(path);
    }

    const base =
        location.port === "5500"
            ? "http://localhost:3000"
            : "";

    return `${base}${path}`;
}

async function loadNotificationPage() {
    const username =
        window.AZIEL?.user?.username ||
        localStorage.getItem("username");

    const list = document.getElementById("notificationsList");
    if (!list) return;

    if (!username) {
        list.innerHTML = `<div class="empty-noti">Please login first.</div>`;
        return;
    }

    try {
        const res = await fetch(
            notificationApiUrl(`/api/notifications/${encodeURIComponent(username)}`)
        );

        const data = await res.json();

        if (!data.success) {
            list.innerHTML = `<div class="empty-noti">Failed to load notifications.</div>`;
            return;
        }

        pageNotifications = data.notifications || [];
        renderNotificationGroups();
    } catch (error) {
        console.log("Notification page error:", error);
        list.innerHTML = `<div class="empty-noti">Failed to load notifications.</div>`;
    }
}

function renderNotificationGroups() {
    const list = document.getElementById("notificationsList");
    if (!list) return;

    const visible = pageNotifications.filter(n => !n.deletedByUser);

    if (!visible.length) {
        list.innerHTML = `<div class="empty-noti">No notifications yet.</div>`;
        return;
    }

    const groups = [
        { key: "orders", title: "Order Updates" },
        { key: "announcements", title: "Admin Announcements" },
        { key: "promotions", title: "Promotions & Discounts" },
        { key: "system", title: "System" }
    ];

    list.innerHTML = groups.map(group => {
        const items = visible.filter(n =>
            (n.category || "system") === group.key
        );

        if (!items.length) return "";

        return `
            <section class="category-block">
                <h2 class="category-title">${escapeHTML(group.title)}</h2>
                ${items.map(renderNotificationItem).join("")}
            </section>
        `;
    }).join("");
}

function renderNotificationItem(n) {
    const status = n.isRead ? "" : "unread";
    const id = String(n._id || "");

    return `
        <div class="notif-item ${status}" data-id="${escapeHTML(id)}">
            <div class="notif-main"
                 onclick="openNotification('${escapeHTML(id)}')">
                <h3>
                    ${getTypeIcon(n.type)} ${escapeHTML(n.title || "Notification")}
                </h3>

                <p>${escapeHTML(n.message || "")}</p>

                <small>${escapeHTML(formatNotificationTime(n.createdAt))}</small>
            </div>

            <div class="notif-actions">
                <button onclick="markOneRead('${escapeHTML(id)}')" title="Mark as read">
                    ✓
                </button>

                <button onclick="deleteNotification('${escapeHTML(id)}')" title="Delete">
                    ×
                </button>
            </div>
        </div>
    `;
}

async function openNotification(id) {
    const n = pageNotifications.find(item => String(item._id) === String(id));
    if (!n) return;

    await markOneRead(id);

    if (n.orderId) {
        window.location.href =
            `tracking.html?orderId=${encodeURIComponent(n.orderId)}`;
    }
}

async function markOneRead(id) {
    const n = pageNotifications.find(item => String(item._id) === String(id));

    if (n) n.isRead = true;

    renderNotificationGroups();

    try {
        await fetch(notificationApiUrl(`/api/notifications/${encodeURIComponent(id)}/read`), {
            method: "PUT"
        });
    } catch (error) {
        console.log("Mark read error:", error);
    }
}

async function deleteNotification(id) {
    pageNotifications = pageNotifications.filter(
        item => String(item._id) !== String(id)
    );

    renderNotificationGroups();

    try {
        await fetch(notificationApiUrl(`/api/notifications/${encodeURIComponent(id)}`), {
            method: "DELETE"
        });
    } catch (error) {
        console.log("Delete notification error:", error);
    }
}

function initNotificationActions() {
    const markAllBtn = document.getElementById("markAllReadBtn");

    if (markAllBtn) {
        markAllBtn.addEventListener("click", markAllRead);
    }
}

async function markAllRead() {
    const username =
        window.AZIEL?.user?.username ||
        localStorage.getItem("username");

    if (!username) return;

    pageNotifications.forEach(n => {
        n.isRead = true;
    });

    renderNotificationGroups();

    try {
        await fetch(
            notificationApiUrl(`/api/notifications/${encodeURIComponent(username)}/read-all`),
            { method: "PUT" }
        );
    } catch (error) {
        console.log("Mark all read error:", error);
    }
}

function getTypeIcon(type) {
    const map = {
        order_completed: "✅",
        topup_delayed: "⚠️",
        announcement: "📢",
        promo: "🎁",
        system: "🔔",
        general: "🔔"
    };

    return map[type] || "🔔";
}

function formatNotificationTime(date) {
    if (!date) return "";
    return new Date(date).toLocaleString();
}

// Live socket can call this
function prependLiveNotification(data) {
    pageNotifications.unshift({
        _id: data._id || Date.now(),
        title: data.title || "Notification",
        message: data.message || "",
        type: data.type || "general",
        category: data.category || "system",
        orderId: data.orderId || "",
        isRead: false,
        createdAt: new Date()
    });

    renderNotificationGroups();
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}