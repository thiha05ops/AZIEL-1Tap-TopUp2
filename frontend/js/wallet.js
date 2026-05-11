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

    const currency = region === "TH" ? "THB" : "MMK";
    const symbol = currency === "THB" ? "฿" : "Ks";

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
        const res = await fetch("/api/wallet/topup", {
            method: "POST",
            body: formData
        });

        const data = await res.json();

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
        alert("Server error");
        btn.disabled = false;
        btn.innerText = "Submit Top Up";
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