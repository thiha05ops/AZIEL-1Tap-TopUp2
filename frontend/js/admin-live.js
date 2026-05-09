let lastOrderCount = 0;
let lastTopupCount = 0;
let firstLoad = true;
let soundEnabled = false;

const ADMIN_PASSWORD = "AZIEL2026";

document.addEventListener("click", () => {
    soundEnabled = true;
});

document.addEventListener("DOMContentLoaded", () => {
    checkAdminNotifications();
    setInterval(checkAdminNotifications, 5000);
});

async function checkAdminNotifications() {
    try {
        const orderRes = await fetch("/api/admin/orders", {
            headers: { "x-admin-password": ADMIN_PASSWORD }
        });

        const orderData = await orderRes.json();
        const orders = orderData.orders || [];

        const topupRes = await fetch("/api/admin/wallet/topups", {
            headers: { "x-admin-password": ADMIN_PASSWORD }
        });

        const topupData = await topupRes.json();
        const topups = topupData.topups || [];

        if (!firstLoad) {
            if (orders.length > lastOrderCount) {
                showAdminAlert("🔔 New Order Received!");
                playBeep();
            }

            if (topups.length > lastTopupCount) {
                showAdminAlert("💰 New Wallet Topup Request!");
                playBeep();
            }
        }

        lastOrderCount = orders.length;
        lastTopupCount = topups.length;
        firstLoad = false;

    } catch (error) {
        console.log("Admin live error:", error);
    }
}

function showAdminAlert(text) {
    let alertBox = document.getElementById("adminLiveAlert");

    if (!alertBox) {
        alertBox = document.createElement("div");
        alertBox.id = "adminLiveAlert";
        document.body.appendChild(alertBox);
    }

    alertBox.innerText = text;

    alertBox.style.position = "fixed";
    alertBox.style.top = "20px";
    alertBox.style.right = "20px";
    alertBox.style.background = "linear-gradient(135deg,#ffd700,#ffb800)";
    alertBox.style.color = "#111";
    alertBox.style.padding = "16px 22px";
    alertBox.style.borderRadius = "16px";
    alertBox.style.fontWeight = "900";
    alertBox.style.zIndex = "99999";
    alertBox.style.boxShadow = "0 0 30px rgba(255,215,0,.45)";

    setTimeout(() => {
        alertBox.remove();
    }, 4000);
}

function playBeep() {
    if (!soundEnabled) {
        console.log("Click admin page once to enable sound");
        return;
    }

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    oscillator.connect(gain);
    gain.connect(audioCtx.destination);

    oscillator.frequency.value = 880;
    oscillator.type = "sine";

    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.25);
}