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
            <div class="notification-title">${escapeHTML(formatNotificationText(item, "title"))}</div>
            <div class="notification-message">${escapeHTML(formatNotificationText(item, "message"))}</div>
            <div class="notification-time">${escapeHTML(formatNotificationTime(item.createdAt))}</div>
        </div>
    `).join("");

    list.querySelectorAll(".notification-item").forEach(item => {
        item.addEventListener("click", async () => {
            window.AZIEL_NOTIFICATIONS.markRead(item.dataset.id);
            if (item.dataset.resumePayment) {
                await resumePaymentFromLiveNotification(item.dataset.resumePayment);
            }
        });
    });
}

async function resumePaymentFromLiveNotification(attemptId) {
    try {
        const runtime = await window.ensurePendingPaymentRecoveryRuntime?.();
        if (!runtime?.resumeAttempt) {
            throw new Error("Payment recovery runtime unavailable");
        }
        await runtime.resumeAttempt(attemptId);
    } catch (error) {
        window.AZIEL_UI?.toast?.error?.(t(
            "payment_recovery_unavailable",
            "Payment recovery is still loading. Please try again."
        ));
    }
}

function getRecoveryAttemptId(item = {}) {
    const metadata = item.metadata || {};
    const actionType = metadata.notificationActionType || item.action?.type || "";
    return actionType === "resume_manual_payment" ? String(metadata.manualPaymentAttemptId || "") : "";
}

function formatNotificationText(item = {}, field = "title") {
    const metadata = item.metadata || {};
    const key = field === "message" ? metadata.i18nMessageKey : metadata.i18nTitleKey;
    const fallback = item[field] || "";
    const text = key ? t(key, fallback) : fallback;

    return String(text || fallback || "").replace("{game}", metadata.game || "your order");
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
        <strong>${escapeHTML(formatNotificationText(data, "title") || "Notification")}</strong>
        <br>
        ${escapeHTML(formatNotificationText(data, "message") || "")}
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

function t(key, fallback) {
    const translated = window.AZIEL_I18N?.t?.(key, fallback);
    if (translated && translated !== key && translated !== fallback) return translated;
    const lang = window.AZIEL_I18N?.getLang?.() ||
        localStorage.getItem("azielLanguage") ||
        document.documentElement?.lang ||
        "en";
    return window.AZIEL_LANG?.[lang]?.[key] ||
        window.AZIEL_LANG?.en?.[key] ||
        translated ||
        fallback ||
        key;
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
