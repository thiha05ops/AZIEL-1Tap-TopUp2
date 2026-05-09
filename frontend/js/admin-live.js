// frontend/js/admin-live.js

let lastOrderIds = [];
let firstLoad = true;
let soundEnabled = false;

const ADMIN_LIVE_PASSWORD = "AZIEL2026";

document.addEventListener("click", () => {
    soundEnabled = true;
});

document.addEventListener("DOMContentLoaded", () => {
    checkAdminLiveOrders();
    setInterval(checkAdminLiveOrders, 5000);
});

async function checkAdminLiveOrders() {
    try {
        const res = await fetch("/api/admin/orders", {
            headers: {
                "x-admin-password": ADMIN_LIVE_PASSWORD
            }
        });

        const data = await res.json();
        const orders = data.orders || [];

        const currentIds = orders.map(order => order._id || order.orderId);

        if (!firstLoad) {
            const newOrders = orders.filter(order => {

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
            }
        }

        lastOrderIds = currentIds;
        firstLoad = false;

    } catch (error) {
        console.log("Admin live error:", error);
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
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
            <span>${text}</span>
            <button onclick="document.getElementById('adminLiveAlert').style.display='none'">
                Close
            </button>
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

    const btn = box.querySelector("button");
    btn.style.background = "#111827";
    btn.style.color = "#fff";
    btn.style.border = "0";
    btn.style.borderRadius = "10px";
    btn.style.padding = "8px 12px";
    btn.style.cursor = "pointer";

    setTimeout(() => {
        box.style.display = "none";
    }, 5000);
}

function playAdminBeep() {
    if (!soundEnabled) {
        console.log("Click admin page once to enable sound");
        return;
    }

    const audio = new Audio("assets/sounds/notify.mp3");
    audio.play().catch(err => {
        console.log("Sound blocked:", err);
    });
}