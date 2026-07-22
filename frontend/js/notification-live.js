// frontend/js/notification-live.js
// Thin compatibility adapter. AZIEL_NOTIFICATIONS owns state.

document.addEventListener("DOMContentLoaded", () => {
    startNotificationSystem();
});

function startNotificationSystem() {
    if (window.__notificationSystemStarted) return;
    window.__notificationSystemStarted = true;

    if (!window.AZIEL_NOTIFICATIONS) {
        console.log("Notification store not loaded");
        return;
    }

    let previousIds = new Set();

    window.AZIEL_NOTIFICATIONS.subscribe(state => {
        updateHeaderDropdown(state.notifications);
        updateLegacyBadge(state.unreadCount);

        const latest = state.notifications[0];

        if (
            latest &&
            !previousIds.has(latest.id) &&
            previousIds.size > 0 &&
            !latest.read
        ) {
            showNotificationPopup(latest);
            playNotificationSound();
        }

        previousIds = new Set(state.notifications.map(item => item.id));
    });

    window.AZIEL_NOTIFICATIONS.init();
    setupNotificationDropdown();
    unlockNotificationSound();
}

function updateHeaderDropdown(notifications) {
    const list = document.getElementById("notificationList");
    if (!list) return;

    const items = notifications.slice(0, 8);

    if (!items.length) {
        list.innerHTML = `<div class="notification-empty">No notifications</div>`;
        return;
    }

    list.innerHTML = items.map(item => `
        <div class="notification-item ${item.read ? "" : "unread"}" data-id="${escapeHTML(item.id)}" data-resume-payment="${escapeHTML(getRecoveryAttemptId(item))}">
            <div class="notification-title">${escapeHTML(item.title)}</div>
            <div class="notification-message">${escapeHTML(item.message)}</div>
            <div class="notification-time">${escapeHTML(formatNotificationTime(item.createdAt))}</div>
        </div>
    `).join("");

    list.querySelectorAll(".notification-item").forEach(item => {
        item.addEventListener("click", () => {
            window.AZIEL_NOTIFICATIONS.markRead(item.dataset.id);
            if (item.dataset.resumePayment && window.AZIEL_PENDING_PAYMENT_RECOVERY?.resumeAttempt) {
                window.AZIEL_PENDING_PAYMENT_RECOVERY.resumeAttempt(item.dataset.resumePayment);
            }
        });
    });
}

function getRecoveryAttemptId(item = {}) {
    const metadata = item.metadata || {};
    const actionType = metadata.notificationActionType || item.action?.type || "";
    return actionType === "resume_manual_payment" ? String(metadata.manualPaymentAttemptId || "") : "";
}

function updateLegacyBadge(unreadCount) {
    const badge = document.getElementById("notificationCount");
    if (!badge) return;

    const count = Number(unreadCount || 0);
    const nextText = count > 99 ? "99+" : String(count);
    const changed = badge.innerText !== nextText;

    badge.innerText = nextText;
    badge.style.display = count > 0 ? "flex" : "none";

    if (changed && count > 0) {
        window.AZIEL_MOTION?.emphasize(badge, "badge");
    }
}

function showNotificationPopup(data) {
    const old = document.getElementById("liveNotificationPopup");
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.id = "liveNotificationPopup";
    popup.innerHTML = `
        <strong>${escapeHTML(data.title || "Notification")}</strong>
        <br>
        ${escapeHTML(data.message || "")}
    `;

    document.body.appendChild(popup);
    popup.classList.add("show");
    window.AZIEL_MOTION?.enter(popup, "fast");

    setTimeout(() => {
        popup.classList.remove("show");
        setTimeout(() => popup.remove(), 350);
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

    const audio = new Audio(
        location.port === "5500"
            ? "assets/sounds/notify.mp3"
            : "/assets/sounds/notify.mp3"
    );
    audio.volume = 0.9;
    audio.play().catch(() => {});
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
