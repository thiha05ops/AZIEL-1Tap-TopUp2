// frontend/js/admin-live.js

document.addEventListener(
    "DOMContentLoaded",
    () => {

        startAdminLiveSystem();

    }
);


// ======================
// START
// ======================

function startAdminLiveSystem() {

    // prevent duplicate
    if (
        window.__adminLiveStarted
    ) {
        return;
    }

    window.__adminLiveStarted =
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

    const socket = io();

    // join admin room
    socket.emit(
        "joinAdminRoom"
    );

    // realtime updates
    socket.on(
        "adminNewUpdate",

        data => {

            console.log(
                "🔥 Admin Update:",
                data
            );

            handleAdminUpdate(
                data
            );

        }

    );

    // unlock sound
    unlockAdminSound();

}


// ======================
// HANDLE UPDATE
// ======================

function handleAdminUpdate(
    data
) {

    // SUPPORT
    if (
        data.type ===
        "support_ticket"
    ) {

        showAdminPopup({

            title:
                "🎫 New Support Ticket",

            message:
                `${data.username} submitted a support request`

        });

        playAdminSound();

        refreshSupportPage();

        return;

    }

    // ORDER
    if (
        data.type ===
        "new_order"
    ) {

        showAdminPopup({

            title:
                "📦 New Order",

            message:
                `${data.username} placed a new order`

        });

        playAdminSound();

        refreshOrdersPage();

        return;

    }

    // ORDER STATUS
    if (
        data.type ===
        "order_status"
    ) {

        showAdminPopup({

            title:
                "⚡ Order Updated",

            message:
                `${data.orderId} → ${data.status}`

        });

        refreshOrdersPage();

    }

}


// ======================
// POPUP
// ======================

function showAdminPopup(
    data
) {

    const old =
        document.getElementById(
            "adminLivePopup"
        );

    if (old) old.remove();

    const popup =
        document.createElement(
            "div"
        );

    popup.id =
        "adminLivePopup";

    popup.innerHTML = `
        <strong>
            ${data.title}
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

    popup.style.padding =
        "18px 20px";

    popup.style.borderRadius =
        "18px";

    popup.style.background =
        "linear-gradient(135deg,#7c3aed,#6d28d9)";

    popup.style.color =
        "#fff";

    popup.style.fontWeight =
        "800";

    popup.style.zIndex =
        "999999";

    popup.style.transition =
        ".4s";

    popup.style.boxShadow =
        "0 12px 40px rgba(0,0,0,.35)";

    popup.style.maxWidth =
        "340px";

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

function unlockAdminSound() {

    document.addEventListener(
        "click",

        () => {

            window.__adminSoundUnlocked =
                true;

        },

        { once: true }
    );

}

function playAdminSound() {

    if (
        !window.__adminSoundUnlocked
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
// AUTO REFRESH
// ======================

function refreshSupportPage() {

    if (
        window.location.pathname.includes(
            "admin-support"
        )
    ) {

        if (
            typeof loadSupportTickets ===
            "function"
        ) {

            loadSupportTickets();

        }

    }

}

function refreshOrdersPage() {

    if (
        typeof loadOrders ===
        "function"
    ) {

        loadOrders();

    }

}
// ======================================
// LIVE CHAT COUNTER
// ======================================

let adminUnreadCount = 0;

function updateAdminUnread() {

    let badge =
        document.getElementById(
            "adminUnreadBadge"
        );

    if (!badge) {

        badge =
            document.createElement("div");

        badge.id =
            "adminUnreadBadge";

        document.body.appendChild(
            badge
        );

        badge.style.position =
            "fixed";

        badge.style.top =
            "18px";

        badge.style.right =
            "18px";

        badge.style.width =
            "28px";

        badge.style.height =
            "28px";

        badge.style.borderRadius =
            "50%";

        badge.style.background =
            "#ef4444";

        badge.style.color =
            "#fff";

        badge.style.display =
            "flex";

        badge.style.alignItems =
            "center";

        badge.style.justifyContent =
            "center";

        badge.style.fontWeight =
            "900";

        badge.style.zIndex =
            "999999";

        badge.style.boxShadow =
            "0 0 18px rgba(239,68,68,.7)";
    }

    badge.innerText =
        adminUnreadCount;

}

// ======================================
// LIVE MESSAGE TRACKER
// ======================================

function handleAdminUpdate(data) {

    // EXISTING SUPPORT
    if (
        data.type ===
        "support_ticket"
    ) {

        adminUnreadCount++;

        updateAdminUnread();

        showAdminPopup({

            title:
                "🎫 New Support Ticket",

            message:
                `${data.username} submitted a support request`

        });

        playAdminSound();

        refreshSupportPage();

        return;

    }

    // LIVE CHAT MESSAGE
    if (
        data.type ===
        "live_chat"
    ) {

        adminUnreadCount++;

        updateAdminUnread();

        showAdminPopup({

            title:
                "💬 Live Chat Message",

            message:
                `${data.username}: ${data.message}`

        });

        playAdminSound();

        return;

    }

}