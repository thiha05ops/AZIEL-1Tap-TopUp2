// frontend/js/admin-live.js

let lastOrderIds = [];
let firstLoad = true;
let soundEnabled = false;

document.addEventListener("DOMContentLoaded", () => {
    const adminToken = localStorage.getItem("adminToken");

    if (!adminToken) {
        window.location.href = "admin-login.html";
        return;
    }

    // sound enable after first click
    document.addEventListener(
        "click",
        () => {
            soundEnabled = true;
        },
        { once: true }
    );

    // Socket live update
    if (typeof io !== "undefined") {
        const socket = io();

        socket.emit("joinAdmin");

        socket.on("adminNewUpdate", (data) => {
            showAdminAlert(
                `🔔 ${data.game || "New"} order is now ${data.status || "updated"}`
            );

            playAdminBeep();

            if (typeof loadOrders === "function") {
                loadOrders();
            }

            if (typeof loadWalletTopups === "function") {
                loadWalletTopups();
            }
        });
    }

    checkAdminLiveOrders();
    setInterval(checkAdminLiveOrders, 15000);
});

async function checkAdminLiveOrders() {
    try {
        if (typeof adminFetch !== "function") {
            console.log("adminFetch not loaded");
            return;
        }

        const data = await adminFetch("/api/admin/orders");

        if (!data || !data.success) return;

        const orders = data.orders || [];

        const currentIds = orders.map((order) => {
            return order._id || order.orderId;
        });

        if (!firstLoad) {
            const newOrders = orders.filter((order) => {
                const id = order._id || order.orderId;

                return (
                    !lastOrderIds.includes(id) &&
                    order.status !== "pending_payment"
                );
            });

            if (newOrders.length > 0) {
                showAdminAlert(
                    `🔔 New order sent! ${newOrders[0].game || ""}`
                );

                playAdminBeep();

                if (typeof loadOrders === "function") {
                    loadOrders();
                }
            }
        }

        firstLoad = false;
        lastOrderIds = currentIds;

    } catch (error) {
        console.log("Admin live orders error:", error);
    }
}

function showAdminAlert(text) {
    let box = document.getElementById("adminLiveAlert");

    if (!box) {
        box = document.createElement("div");
        box.id = "adminLiveAlert";
        document.body.appendChild(box);
    }

    box.innerHTML = `
        <div class="admin-live-alert-inner">
            <span>${text}</span>
            <button id="adminLiveCloseBtn">Close</button>
        </div>
    `;

    box.style.position = "fixed";
    box.style.top = "22px";
    box.style.right = "22px";
    box.style.background = "linear-gradient(135deg,#ffd700,#ffb800)";
    box.style.color = "#111";
    box.style.padding = "16px 20px";
    box.style.borderRadius = "16px";
    box.style.fontWeight = "900";
    box.style.zIndex = "99999";
    box.style.minWidth = "300px";
    box.style.boxShadow = "0 0 30px rgba(255,215,0,.45)";
    box.style.display = "block";

    const inner = box.querySelector(".admin-live-alert-inner");
    inner.style.display = "flex";
    inner.style.alignItems = "center";
    inner.style.justifyContent = "space-between";
    inner.style.gap = "16px";

    const btn = document.getElementById("adminLiveCloseBtn");
    btn.style.background = "#111827";
    btn.style.color = "#fff";
    btn.style.border = "0";
    btn.style.borderRadius = "10px";
    btn.style.padding = "8px 12px";
    btn.style.cursor = "pointer";

    btn.addEventListener("click", () => {
        box.style.display = "none";
    });

    setTimeout(() => {
        box.style.display = "none";
    }, 5000);
}

function playAdminBeep() {
    if (!soundEnabled) {
        console.log("Click admin page once to enable sound");
        return;
    }

    const audio = new Audio("/assets/sounds/notify.mp3");

    audio.play().catch((err) => {
        console.log("Sound blocked:", err);
    });
}
// ======================
// NOTIFICATION DROPDOWN
// ======================

const notifications = [];

document.addEventListener("DOMContentLoaded", () => {

    const bell =
        document.getElementById(
            "notificationBell"
        );

    const dropdown =
        document.getElementById(
            "notificationDropdown"
        );

    bell?.addEventListener("click", e => {

        e.stopPropagation();

        dropdown?.classList.toggle("show");

    });

    document.addEventListener("click", e => {

        if (
            dropdown &&
            !dropdown.contains(e.target)
        ) {

            dropdown.classList.remove("show");

        }

    });

});

function addNotificationToDropdown(data) {

    notifications.unshift({

        title:
            data.title || "Notification",

        message:
            data.message || "",

        time:
            new Date().toLocaleTimeString()

    });

    renderNotificationDropdown();

}

function renderNotificationDropdown() {

    const list =
        document.getElementById(
            "notificationList"
        );

    if (!list) return;

    if (!notifications.length) {

        list.innerHTML = `
            <div class="notification-empty">
                No notifications
            </div>
        `;

        return;
    }

    list.innerHTML =
        notifications.map(item => `

            <div class="notification-item">

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

}