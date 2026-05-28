// frontend/js/notification-live.js

// ======================
// GLOBAL STATE
// ======================

let notifications = [];


// ======================
// START SYSTEM
// ======================

document.addEventListener(
    "DOMContentLoaded",
    () => {

        startNotificationSystem();

    }
);


// ======================
// MAIN SYSTEM
// ======================

function startNotificationSystem() {

    // prevent duplicate start
    if (
        window.__notificationSystemStarted
    ) {
        return;
    }

    window.__notificationSystemStarted =
        true;

    // socket check
    if (
        typeof io === "undefined"
    ) {

        console.log(
            "Socket.IO not loaded"
        );

        return;
    }

    const username =
        localStorage.getItem(
            "username"
        );

    if (!username) {

        console.log(
            "No username"
        );

        return;
    }

    // socket
    const socket = io();

    socket.emit(
        "joinUser",
        username
    );

    // load old notifications
    loadNotifications(username);

    // realtime
    socket.on(
        "newNotification",

        data => {

            console.log(
                "🔔 Notification:",
                data
            );

            addNotification(data);

            showNotificationPopup(
                data
            );

            playNotificationSound();

        }

    );

    // dropdown
    setupNotificationDropdown();

    // sound unlock
    unlockNotificationSound();

}


// ======================
// LOAD NOTIFICATIONS
// ======================

async function loadNotifications(
    username
) {

    try {

        const res =
            await fetch(
                `/api/notifications/${username}`
            );

        const data =
            await res.json();

        if (
            !data.success
        ) return;

        notifications =
            data.notifications || [];

        renderNotifications();

        updateUnreadCount();

    } catch (error) {

        console.log(
            "Load notifications error:",
            error
        );

    }

}


// ======================
// ADD NOTIFICATION
// ======================

function addNotification(data) {

    notifications.unshift({

        _id:
            data._id ||
            Date.now(),

        title:
            data.title ||
            "Notification",

        message:
            data.message || "",

        isRead:
            false,

        createdAt:
            new Date()

    });

    renderNotifications();

    updateUnreadCount();

}


// ======================
// RENDER
// ======================

function renderNotifications() {

    const list =
        document.getElementById(
            "notificationList"
        );

    if (!list) return;

    if (
        !notifications.length
    ) {

        list.innerHTML = `
            <div class="notification-empty">
                No notifications
            </div>
        `;

        return;
    }

    list.innerHTML =
        notifications.map(item => `

            <div
                class="notification-item
                ${item.isRead ? "" : "unread"}"

                data-id="${item._id}"
            >

                <div class="notification-title">
                    ${item.title}
                </div>

                <div class="notification-message">
                    ${item.message}
                </div>

                <div class="notification-time">
                    ${formatNotificationTime(
            item.createdAt
        )}
                </div>

            </div>

        `).join("");

    // click read
    document
        .querySelectorAll(
            ".notification-item"
        )
        .forEach(item => {

            item.addEventListener(
                "click",
                () => {

                    markAsRead(
                        item.dataset.id
                    );

                }
            );

        });

}


// ======================
// READ
// ======================

async function markAsRead(id) {

    const target =
        notifications.find(
            n => String(n._id) === String(id)
        );

    if (!target) return;

    target.isRead = true;

    renderNotifications();

    updateUnreadCount();

    try {

        await fetch(
            `/api/notifications/${id}/read`,
            {
                method: "PUT"
            }
        );

    } catch (error) {

        console.log(error);

    }

}


// ======================
// BADGE
// ======================

function updateUnreadCount() {

    const badge =
        document.getElementById(
            "notificationCount"
        );

    if (!badge) return;

    const unread =
        notifications.filter(
            n => !n.isRead
        ).length;

    badge.innerText =
        unread;

}


// ======================
// POPUP
// ======================

function showNotificationPopup(
    data
) {

    const old =
        document.getElementById(
            "liveNotificationPopup"
        );

    if (old) old.remove();

    const popup =
        document.createElement(
            "div"
        );

    popup.id =
        "liveNotificationPopup";

    popup.innerHTML = `
        <strong>
            🔔 ${data.title}
        </strong>

        <br>

        ${data.message}
    `;

    document.body.appendChild(
        popup
    );

    popup.style.position =
        "fixed";

    popup.style.top =
        "20px";

    popup.style.right =
        "-420px";

    popup.style.background =
        "linear-gradient(135deg,#2563eb,#1d4ed8)";

    popup.style.color =
        "#fff";

    popup.style.padding =
        "18px 20px";

    popup.style.borderRadius =
        "18px";

    popup.style.zIndex =
        "999999";

    popup.style.fontWeight =
        "700";

    popup.style.transition =
        ".4s";

    popup.style.boxShadow =
        "0 12px 40px rgba(0,0,0,.35)";

    popup.style.maxWidth =
        "320px";

    setTimeout(() => {

        popup.style.right =
            "20px";

    }, 100);

    setTimeout(() => {

        popup.style.right =
            "-420px";

        setTimeout(() => {

            popup.remove();

        }, 400);

    }, 5000);

}


// ======================
// SOUND
// ======================

function unlockNotificationSound() {

    document.addEventListener(
        "click",

        () => {

            window.__notificationSoundUnlocked =
                true;

        },

        { once: true }
    );

}

function playNotificationSound() {

    if (
        !window.__notificationSoundUnlocked
    ) {

        return;
    }

    const audio =
        new Audio(
            "/assets/sounds/notify.mp3"
        );

    audio.volume = 0.9;

    audio.play().catch(() => { });

}


// ======================
// DROPDOWN
// ======================

function setupNotificationDropdown() {

    document.addEventListener(
        "click",

        e => {

            const bell =
                document.getElementById(
                    "notificationBell"
                );

            const dropdown =
                document.getElementById(
                    "notificationDropdown"
                );

            if (
                !bell ||
                !dropdown
            ) return;

            // open
            if (
                bell.contains(
                    e.target
                )
            ) {

                e.stopPropagation();

                dropdown.classList.toggle(
                    "show"
                );

                return;

            }

            // close
            if (
                !dropdown.contains(
                    e.target
                )
            ) {

                dropdown.classList.remove(
                    "show"
                );

            }

        }

    );

}


// ======================
// TIME FORMAT
// ======================

function formatNotificationTime(
    date
) {

    return new Date(date)
        .toLocaleString();

}
document.addEventListener("click", e => {
    const link = e.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) return;

    const url = new URL(href, window.location.href);

    if (url.origin === window.location.origin) {
        e.preventDefault();
        window.location.href = url.pathname + url.search + url.hash;
    }
});