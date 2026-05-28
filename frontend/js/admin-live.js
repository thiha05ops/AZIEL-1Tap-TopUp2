// frontend/js/admin-live.js

document.addEventListener("DOMContentLoaded", () => {
    startAdminLiveSystem();
});

let adminUnreadCount = 0;

function startAdminLiveSystem() {
    if (window.__adminLiveStarted) return;
    window.__adminLiveStarted = true;

    if (typeof io === "undefined") {
        console.log("Socket.IO not loaded");
        return;
    }

    const socket = io();

    socket.emit("joinAdminRoom");
    socket.emit("joinAdmin");

    socket.on("adminNewUpdate", data => {
        console.log("🔥 Admin Update:", data);
        handleAdminUpdate(data);
    });

    socket.on("liveChatMessage", data => {
        handleAdminUpdate({
            type: "live_chat",
            username: data.username || "Guest",
            message: data.message || data.text || ""
        });
    });

    unlockAdminSound();
}

function handleAdminUpdate(data) {
    if (!data || !data.type) return;

    if (data.type === "support_ticket") {
        increaseAdminUnread();

        showAdminPopup({
            title: "🎫 New Support Ticket",
            message: `${data.username || "User"} submitted a support request`
        });

        prependAdminActivity("Support Ticket", data.username || "User");
        playAdminSound();
        refreshSupportPage();
        return;
    }

    if (data.type === "live_chat") {
        increaseAdminUnread();

        showAdminPopup({
            title: "💬 Live Chat Message",
            message: `${data.username || "Guest"}: ${data.message || ""}`
        });

        prependAdminActivity("Live Chat", data.username || "Guest");
        playAdminSound();
        return;
    }

    if (data.type === "new_order") {
        showAdminPopup({
            title: "📦 New Order",
            message: `${data.username || "User"} placed a new order`
        });

        prependAdminActivity("New Order", data.orderId || data.username || "Order");
        playAdminSound();
        refreshOrdersPage();
        refreshAdminStats();
        return;
    }

    if (data.type === "order_status") {
        showAdminPopup({
            title: "⚡ Order Updated",
            message: `${data.orderId || "Order"} → ${data.status || "updated"}`
        });

        prependAdminActivity("Order Updated", `${data.orderId || ""} ${data.status || ""}`);
        refreshOrdersPage();
        refreshAdminStats();
        return;
    }

    if (data.type === "wallet_topup") {
        showAdminPopup({
            title: "💳 Wallet Topup",
            message: `${data.username || "User"} submitted wallet topup`
        });

        prependAdminActivity("Wallet Topup", data.username || "User");
        playAdminSound();
        refreshAdminStats();
        return;
    }
}

function increaseAdminUnread() {
    adminUnreadCount++;
    updateAdminUnread();
}

function updateAdminUnread() {
    let badge = document.getElementById("adminUnreadBadge");

    if (!badge) {
        badge = document.createElement("div");
        badge.id = "adminUnreadBadge";
        document.body.appendChild(badge);
    }

    badge.innerText = adminUnreadCount;
    badge.style.display = adminUnreadCount > 0 ? "flex" : "none";
}

function prependAdminActivity(title, text) {

    const list =
        document.getElementById(
            "recentActivity"
        );

    if (!list) return;

    // remove placeholder
    if (
        list.innerText.includes(
            "Waiting for live activity"
        )
    ) {

        list.innerHTML = "";

    }

    const item =
        document.createElement("div");

    item.className =
        "live-activity-item";

    item.innerHTML = `

        <div class="live-dot"></div>

        <div class="live-content">

            <strong>
                ${title}
            </strong>

            <p>
                ${text}
            </p>

            <small>
                Just now
            </small>

        </div>

    `;

    list.prepend(item);

    // max 8 items
    const items =
        list.querySelectorAll(
            ".live-activity-item"
        );

    if (items.length > 8) {

        items[
            items.length - 1
        ].remove();

    }

}

function showAdminPopup(data) {
    const old = document.getElementById("adminLivePopup");
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.id = "adminLivePopup";

    popup.innerHTML = `
        <strong>${data.title}</strong>
        <br>
        ${data.message}
    `;

    document.body.appendChild(popup);

    setTimeout(() => {
        popup.classList.add("show");
    }, 80);

    setTimeout(() => {
        popup.classList.remove("show");
        setTimeout(() => popup.remove(), 350);
    }, 5000);
}

function unlockAdminSound() {
    document.addEventListener(
        "click",
        () => {
            window.__adminSoundUnlocked = true;
        },
        { once: true }
    );
}

function playAdminSound() {
    if (!window.__adminSoundUnlocked) return;

    const audio = new Audio("/assets/sounds/notify.mp3");
    audio.volume = 0.9;
    audio.play().catch(() => { });
}

function refreshSupportPage() {
    if (typeof loadSupportTickets === "function") {
        loadSupportTickets();
    }
}

function refreshOrdersPage() {
    if (typeof loadOrders === "function") {
        loadOrders();
    }
}

function refreshAdminStats() {
    if (typeof loadAdminStats === "function") {
        loadAdminStats();
    }
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