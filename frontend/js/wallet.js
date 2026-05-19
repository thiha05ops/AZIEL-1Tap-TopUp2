// frontend/js/wallet.js

document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username");

    if (!username) {
        window.location.href = "login.html";
        return;
    }

    loadWallet();
    initWalletQrPreview();

    document.getElementById("submitTopupBtn")
        ?.addEventListener("click", submitTopup);
});

async function loadWallet() {
    const username = localStorage.getItem("username");

    const region =
        localStorage.getItem("region") ||
        localStorage.getItem("selectedRegion") ||
        "MM";

    const currency = region === "TH" ? "฿" : "Ks";
    const symbol = currency === "THB" ? "THB" : "MMK";

    try {
        const res = await fetch(`/api/wallet/${username}?currency=${currency}`);
        const data = await res.json();

        if (!data.success) return;

        document.getElementById("walletBalance").innerText =
            `${Number(data.balance || 0).toLocaleString()} ${symbol}`;

        renderWalletHistory(data.topups || []);

    } catch (error) {
        console.log("Wallet load error:", error);
    }
}

function renderWalletHistory(topups) {
    const box = document.getElementById("walletHistory");
    if (!box) return;

    if (!topups.length) {
        box.innerHTML = `<p class="empty-text">No wallet history yet.</p>`;
        return;
    }

    box.innerHTML = topups.map(item => `
        <div class="wallet-history-item">
            <strong>${Number(item.amount).toLocaleString()} ${item.currency}</strong>
            <p>${item.paymentMethod}</p>
            <p class="status-${item.status}">${item.status}</p>
        </div>
    `).join("");
}

async function submitTopup() {
    const username = localStorage.getItem("username");

    const amount = document.getElementById("topupAmount")?.value;
    const paymentMethod = document.getElementById("paymentMethod")?.value;
    const slip = document.getElementById("topupSlip")?.files[0];

    const region =
        localStorage.getItem("region") ||
        localStorage.getItem("selectedRegion") ||
        "MM";

    const currency = region === "TH" ? "THB" : "MMK";

    if (!amount || !paymentMethod || !slip) {
        alert("Please fill amount, payment and slip.");
        return;
    }

    const formData = new FormData();
    formData.append("username", username);
    formData.append("amount", amount);
    formData.append("currency", currency);
    formData.append("paymentMethod", paymentMethod);
    formData.append("slip", slip);

    const btn = document.getElementById("submitTopupBtn");
    btn.disabled = true;
    btn.innerText = "Submitting...";

    try {

        const data = await apiFetch(
            "/api/wallet/topup",
            {
                method: "POST",
                body: formData
            }
        );

        if (!data.success) {

            alert(data.message || "Topup failed");

            btn.disabled = false;

            btn.innerText = "Submit Top Up";

            return;
        }

        alert("Wallet topup submitted ✅");

        window.location.reload();

    } catch (error) {

        console.log(error);

    }
}

function initWalletQrPreview() {
    const qrBox = document.getElementById("walletQrBox");
    const qrImg = document.getElementById("walletQrImage");
    const qrTitle = document.getElementById("walletQrTitle");
    const paymentInput = document.getElementById("paymentMethod");

    if (!qrBox || !qrImg || !qrTitle || !paymentInput) {
        console.log("Wallet QR elements missing");
        return;
    }

    const qrData = {
        kbzpay: { name: "KBZPay", qr: "assets/payment/kbzpay-qr.png" },
        wavepay: { name: "WavePay", qr: "assets/payment/wavepay-qr.png" },
        ayapay: { name: "AYA Pay", qr: "assets/payment/ayapay-qr.png" },
        promptpay: { name: "PromptPay", qr: "assets/payment/promptpay-qr.png" },
        scb: { name: "SCB", qr: "assets/payment/scb-qr.png" }
    };

    function showQr() {
        const method = paymentInput.value;

        if (!method || !qrData[method]) {
            qrBox.style.display = "none";
            return;
        }

        qrTitle.innerText = qrData[method].name + " QR";
        qrImg.src = qrData[method].qr;
        qrBox.style.display = "block";
    }

    document.addEventListener("paymentChanged", showQr);

    document.addEventListener("click", (e) => {
        if (e.target.closest(".pay-card")) {
            setTimeout(showQr, 100);
        }
    });

    showQr();
}
const socket = io();

const username =
    localStorage.getItem("username");

if (username) {

    socket.emit(
        "joinUserRoom",
        username
    );

}

socket.on(
    "walletUpdated",
    (data) => {

        const balanceEl =
            document.getElementById(
                "walletBalance"
            );

        if (balanceEl) {

            balanceEl.innerText =
                data.amount;
            localStorage.setItem(
                "walletBalance",
                data.amount
            );

        }

        showWalletPopup(
            data.amount,
            data.currency
        );

    }
);
function showWalletPopup(
    amount,
    currency
) {

    const popup =
        document.createElement("div");

    popup.className =
        "wallet-popup";

    popup.innerHTML = `
        💰 Wallet Updated
        <br>
        New Balance:
        ${amount} ${currency}
    `;

    document.body.appendChild(
        popup
    );

    setTimeout(() => {

        popup.classList.add(
            "show"
        );

    }, 100);

    setTimeout(() => {

        popup.classList.remove(
            "show"
        );

        setTimeout(() => {

            popup.remove();

        }, 400);

    }, 4000);

}
// ======================
// REALTIME WALLET UPDATE
// ======================

document.addEventListener("DOMContentLoaded", () => {
    if (typeof io === "undefined") {
        console.log("Socket.IO not loaded");
        return;
    }

    const socket = io();

    const username = localStorage.getItem("username");

    if (username) {
        socket.emit("joinUserRoom", username);
    }

    socket.on("walletUpdated", (data) => {
        console.log("Wallet updated:", data);

        const balanceEl =
            document.getElementById("walletBalance") ||
            document.getElementById("balanceAmount");

        if (balanceEl) {
            balanceEl.innerText =
                `${Number(data.amount).toLocaleString()} ${data.currency}`;
        }

        showWalletPopup(data.amount, data.currency);
    });
});

function showWalletPopup(amount, currency) {
    const oldPopup = document.querySelector(".wallet-popup");
    if (oldPopup) oldPopup.remove();

    const popup = document.createElement("div");
    popup.className = "wallet-popup";

    popup.innerHTML = `
        💰 Wallet Updated<br>
        New Balance: ${Number(amount).toLocaleString()} ${currency}
    `;

    document.body.appendChild(popup);

    setTimeout(() => popup.classList.add("show"), 100);

    setTimeout(() => {
        popup.classList.remove("show");
        setTimeout(() => popup.remove(), 400);
    }, 4000);
}
// ======================
// WALLET LIVE UPDATE
// ======================

document.addEventListener("DOMContentLoaded", () => {
    if (typeof io === "undefined") {
        console.log("Socket.IO not loaded");
        return;
    }

    const username = localStorage.getItem("username");

    if (!username) return;

    const socket = io();

    socket.emit("joinUserRoom", username);
    socket.emit("joinUser", username);

    socket.on("walletUpdated", (data) => {
        console.log("💰 Wallet live update:", data);

        updateWalletBalanceUI(data.amount, data.currency);
        showWalletLivePopup(data.amount, data.currency);
    });
});

function updateWalletBalanceUI(amount, currency) {
    const balanceEls = [
        document.getElementById("walletBalance"),
        document.getElementById("balanceAmount"),
        document.getElementById("userWalletBalance")
    ];

    balanceEls.forEach(el => {
        if (el) {
            el.innerText =
                `${Number(amount || 0).toLocaleString()} ${currency || ""}`;
        }
    });
}

function showWalletLivePopup(amount, currency) {
    const old = document.getElementById("walletLivePopup");
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.id = "walletLivePopup";
    popup.innerHTML = `
        💰 Wallet Updated<br>
        <strong>${Number(amount || 0).toLocaleString()} ${currency || ""}</strong>
    `;

    document.body.appendChild(popup);

    setTimeout(() => popup.classList.add("show"), 100);

    setTimeout(() => {
        popup.classList.remove("show");
        setTimeout(() => popup.remove(), 400);
    }, 4000);
}