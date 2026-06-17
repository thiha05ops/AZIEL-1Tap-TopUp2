// frontend/js/wallet.js

document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username");

    if (!username) {
        window.location.href = "login.html";
        return;
    }

    loadWallet();
    initWalletQrPreview();
    initWalletTopup();
    initWalletSocket();
    initSlipPreview();
});

// ======================
// REGION / CURRENCY
// ======================

function getWalletRegion() {
    return (
        localStorage.getItem("selectedRegion") ||
        localStorage.getItem("region") ||
        "MM"
    );
}

function getWalletCurrency() {
    return getWalletRegion() === "TH" ? "THB" : "MMK";
}

function getWalletSymbol(currency) {
    return currency === "THB"
        ? "฿"
        : "Ks";
}

// ======================
// LOAD WALLET
// ======================

async function loadWallet() {
    const username = localStorage.getItem("username");
    const currency = getWalletCurrency();
    const symbol = getWalletSymbol(currency);

    try {
        const res = await fetch(
            `/api/wallet/${username}?currency=${currency}`
        );

        const data = await res.json();

        if (!data.success) return;

        const balance = Number(data.balance || 0);

        updateWalletBalanceUI(balance, symbol);

        localStorage.setItem(
            `walletBalance_${currency}`,
            String(balance)
        );

        renderWalletHistory(data.topups || []);

    } catch (error) {
        console.log("Wallet load error:", error);
    }
}

// ======================
// UPDATE UI
// ======================

function updateWalletBalanceUI(amount, symbol) {
    const text =
        `${Number(amount || 0).toLocaleString()} ${symbol || ""}`;

    [
        "walletBalance",
        "balanceAmount",
        "userWalletBalance"
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    });
}

// ======================
// HISTORY
// ======================

function renderWalletHistory(topups) {
    const box = document.getElementById("walletHistory");
    if (!box) return;

    if (!topups.length) {
        box.innerHTML = `
            <div class="wallet-empty">
                <i class="fa-regular fa-folder-open"></i>
                <h3>No Wallet History</h3>
                <p>Your wallet transactions will appear here.</p>
            </div>
        `;
        return;
    }

    box.innerHTML = topups.map(item => `
        <div class="wallet-history-item">
            <div>
                <strong>
                    ${Number(item.amount || 0).toLocaleString()}
                    ${item.currency || ""}
                </strong>
                <p>${item.paymentMethod || "Payment"}</p>
            </div>

            <span class="wallet-status status-${item.status || "pending"}">
                ${item.status || "pending"}
            </span>
        </div>
    `).join("");
}

// ======================
// TOPUP
// ======================

function initWalletTopup() {
    const btn = document.getElementById("submitTopupBtn");
    if (!btn) return;

    btn.addEventListener("click", submitTopup);
}

async function submitTopup() {
    const username = localStorage.getItem("username");
    const amount = document.getElementById("topupAmount")?.value;
    const paymentMethod = document.getElementById("paymentMethod")?.value;
    const slip = document.getElementById("topupSlip")?.files[0];

    const currency = getWalletCurrency();

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

    try {
        btn.disabled = true;
        btn.innerText = "Submitting...";

        const res = await fetch("/api/wallet/topup", {
            method: "POST",
            body: formData
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.message || "Topup failed");
            return;
        }

        showSubmitSuccessModal();
        await loadWallet();
        resetTopupForm();

    } catch (error) {
        console.log("Topup error:", error);
        alert("Server error");

    } finally {
        btn.disabled = false;
        btn.innerText = "Submit Top Up";
    }
}

// ======================
// QR PREVIEW
// ======================

function initWalletQrPreview() {
    const qrBox = document.getElementById("walletQrBox");
    const qrImg = document.getElementById("walletQrImage");
    const qrTitle = document.getElementById("walletQrTitle");
    const paymentInput = document.getElementById("paymentMethod");

    if (!qrBox || !qrImg || !qrTitle || !paymentInput) return;

    const qrData = {
        kbzpay: {
            name: "KBZPay",
            qr: "assets/payment/kbzpay-qr.png"
        },
        wavepay: {
            name: "WavePay",
            qr: "assets/payment/wavepay-qr.png"
        },
        ayapay: {
            name: "AYA Pay",
            qr: "assets/payment/ayapay-qr.png"
        },
        promptpay: {
            name: "PromptPay",
            qr: "assets/payment/promptpay-qr.png"
        },
        scb: {
            name: "SCB",
            qr: "assets/payment/scb-qr.png"
        }
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

    document.addEventListener("click", e => {
        if (e.target.closest(".pay-card, .payment-option, .payment-card, .payment-method, .payment-item")) {
            setTimeout(showQr, 100);
        }
    });

    showQr();
}

// ======================
// SOCKET LIVE UPDATE
// ======================

function initWalletSocket() {
    if (typeof io === "undefined") return;

    const username = localStorage.getItem("username");
    if (!username) return;

    const socket = io();

    socket.emit("joinUser", username);
    socket.emit("joinUserRoom", username);

    socket.on("walletUpdated", data => {
        const currency = data.currency || getWalletCurrency();
        const symbol = getWalletSymbol(currency);
        const amount = Number(data.amount || 0);

        updateWalletBalanceUI(amount, symbol);

        localStorage.setItem(
            `walletBalance_${currency}`,
            String(amount)
        );

        showWalletPopup(amount, symbol);
    });
}

// ======================
// POPUP
// ======================

function showWalletPopup(amount, symbol) {
    const old = document.getElementById("walletLivePopup");
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.id = "walletLivePopup";

    popup.innerHTML = `
        💰 Wallet Updated<br>
        <strong>${Number(amount || 0).toLocaleString()} ${symbol}</strong>
    `;

    document.body.appendChild(popup);

    setTimeout(() => popup.classList.add("show"), 100);

    setTimeout(() => {
        popup.classList.remove("show");
        setTimeout(() => popup.remove(), 400);
    }, 4000);
}
function initSlipPreview() {
    const input = document.getElementById("topupSlip");
    const fileName = document.getElementById("slipFileName");
    const box = document.querySelector(".upload-slip-box");

    if (!input || !fileName || !box) return;

    input.addEventListener("change", () => {
        const file = input.files[0];
        if (!file) return;

        const shortName =
            file.name.length > 24
                ? file.name.substring(0, 24) + "..."
                : file.name;

        fileName.innerText = "✓ " + shortName;
        box.classList.add("has-file");
    });
}
function showSubmitSuccessModal() {
    const modal = document.getElementById("successModal");
    if (!modal) return;

    modal.classList.add("show");

    document.getElementById("viewHistoryBtn")?.addEventListener("click", () => {
        modal.classList.remove("show");
        document.getElementById("walletHistory")?.scrollIntoView({
            behavior: "smooth"
        });
    });

    document.getElementById("backHomeBtn")?.addEventListener("click", () => {
        window.location.href = "home.html";
    });
}

function resetTopupForm() {
    const amount = document.getElementById("topupAmount");
    const method = document.getElementById("paymentMethod");
    const slip = document.getElementById("topupSlip");
    const fileName = document.getElementById("slipFileName");
    const qrBox = document.getElementById("walletQrBox");

    if (amount) amount.value = "";
    if (method) method.value = "";
    if (slip) slip.value = "";
    if (fileName) fileName.innerText = "JPG, PNG, WEBP accepted";
    if (qrBox) qrBox.style.display = "none";
}
function showSubmitSuccessModal() {
    const modal = document.getElementById("successModal");
    if (!modal) return;

    modal.classList.add("show");

    document.getElementById("viewHistoryBtn").onclick = () => {
        modal.classList.remove("show");
        document.getElementById("walletHistory")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    };

    document.getElementById("backHomeBtn").onclick = () => {
        window.location.href = "home.html";
    };
}

function resetTopupForm() {
    const amount = document.getElementById("topupAmount");
    const slip = document.getElementById("topupSlip");
    const fileName = document.getElementById("slipFileName");
    const box = document.querySelector(".upload-slip-box");

    if (amount) amount.value = "";
    if (slip) slip.value = "";
    if (fileName) fileName.innerText = "JPG, PNG, WEBP accepted";
    if (box) box.classList.remove("has-file");
}