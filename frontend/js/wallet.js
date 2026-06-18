// frontend/js/wallet.js
// AZIEL Wallet V2.5 - Auto QR TopUp without Continue button

document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username");

    if (!username) {
        window.location.href = "login.html";
        return;
    }

    loadWallet();
    initQuickAmounts();
    initAutoQrTopup();
    initWalletSocket();
});

let autoQrTimer = null;
let currentTopupId = null;
let currentCreateKey = "";

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
    return currency === "THB" ? "฿" : "Ks";
}

async function loadWallet() {
    const username = localStorage.getItem("username");
    const currency = getWalletCurrency();
    const symbol = getWalletSymbol(currency);

    try {
        const res = await fetch(`/api/wallet/${username}?currency=${currency}`);
        const data = await res.json();

        if (!data.success) return;

        const balance = Number(data.balance || 0);

        updateWalletBalanceUI(balance, symbol);
        localStorage.setItem(`walletBalance_${currency}`, String(balance));

        renderWalletHistory(data.topups || []);

    } catch (error) {
        console.log("Wallet load error:", error);
    }
}

function updateWalletBalanceUI(amount, symbol) {
    const text = `${Number(amount || 0).toLocaleString()} ${symbol || ""}`;

    ["walletBalance", "balanceAmount", "userWalletBalance"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    });
}

function renderWalletHistory(topups) {
    const box = document.getElementById("walletHistory");
    if (!box) return;

    if (!topups.length) {
        box.innerHTML = `
            <div class="wallet-empty">
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

function initQuickAmounts() {
    const input = document.getElementById("topupAmount");
    const buttons = document.querySelectorAll(".quick-amounts button");

    if (!input || !buttons.length) return;

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            buttons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            input.value = btn.dataset.amount || "";

            scheduleAutoQrCreate();
        });
    });

    input.addEventListener("input", () => {
        buttons.forEach(b => b.classList.remove("active"));
        scheduleAutoQrCreate();
    });
}

function initAutoQrTopup() {
    const amountInput = document.getElementById("topupAmount");

    amountInput?.addEventListener("input", scheduleAutoQrCreate);

    document.addEventListener("paymentChanged", scheduleAutoQrCreate);

    document.addEventListener("click", e => {
        if (
            e.target.closest(
                ".pay-card, .payment-option, .payment-card, .payment-method, .payment-item"
            )
        ) {
            setTimeout(scheduleAutoQrCreate, 150);
        }
    });

    const btn = document.getElementById("submitTopupBtn");
    if (btn) {
        btn.style.display = "none";
    }
}

function scheduleAutoQrCreate() {
    clearTimeout(autoQrTimer);

    autoQrTimer = setTimeout(() => {
        createWalletQrAuto();
    }, 700);
}

async function createWalletQrAuto() {
    const username = localStorage.getItem("username");
    const amount = Number(document.getElementById("topupAmount")?.value);
    const paymentMethod = document.getElementById("paymentMethod")?.value;

    const currency = getWalletCurrency();
    const region = getWalletRegion();

    if (!amount || amount <= 0 || !paymentMethod) {
        hideWalletQr();
        return;
    }

    const createKey = `${amount}-${currency}-${region}-${paymentMethod}`;

    if (createKey === currentCreateKey && currentTopupId) {
        return;
    }

    currentCreateKey = createKey;

    try {
        showLoading(true);

        const res = await fetch("/api/wallet/create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username,
                amount,
                currency,
                region,
                paymentMethod
            })
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.message || "Create wallet payment failed.");
            currentCreateKey = "";
            return;
        }

        currentTopupId = data.topupId;

        showWalletQr(data);
        startPaymentStatusPolling(data.topupId);
        await loadWallet();

    } catch (error) {
        console.log("Wallet create error:", error);
        currentCreateKey = "";
        alert("Server error");

    } finally {
        showLoading(false);
    }
}

function showWalletQr(data) {
    const qrBox = document.getElementById("walletQrBox");
    const qrImg = document.getElementById("walletQrImage");
    const qrTitle = document.getElementById("walletQrTitle");

    if (!qrBox || !qrImg || !qrTitle) return;

    qrTitle.innerText = "Scan QR to Pay";

    qrImg.src =
        data.qrImage ||
        data.qrUrl ||
        data.paymentUrl ||
        "";

    qrBox.style.display = "flex";
}

function hideWalletQr() {
    const qrBox = document.getElementById("walletQrBox");
    const qrImg = document.getElementById("walletQrImage");

    if (qrBox) qrBox.style.display = "none";
    if (qrImg) qrImg.src = "";

    currentTopupId = null;
    currentCreateKey = "";
}

function startPaymentStatusPolling(topupId) {
    if (!topupId) return;

    let count = 0;
    const maxCount = 60;

    const timer = setInterval(async () => {
        count++;

        try {
            const res = await fetch(`/api/wallet/status/${topupId}`);
            const data = await res.json();

            if (data.success && data.status === "paid") {
                clearInterval(timer);

                await loadWallet();
                showSubmitSuccessModal();
                resetTopupForm();
            }

            if (count >= maxCount) {
                clearInterval(timer);
            }

        } catch (error) {
            console.log("Wallet status polling error:", error);

            if (count >= maxCount) {
                clearInterval(timer);
            }
        }
    }, 3000);
}

function initWalletSocket() {
    if (typeof io === "undefined") return;

    const username = localStorage.getItem("username");
    if (!username) return;

    const socket = io();

    socket.emit("joinUser", username);
    socket.emit("joinUserRoom", username);

    socket.on("walletUpdated", async data => {
        const currency = data.currency || getWalletCurrency();
        const symbol = getWalletSymbol(currency);
        const amount = Number(data.amount || 0);

        updateWalletBalanceUI(amount, symbol);
        localStorage.setItem(`walletBalance_${currency}`, String(amount));

        showWalletPopup(amount, symbol);
        showSubmitSuccessModal();
        resetTopupForm();

        await loadWallet();
    });
}

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

function showLoading(show) {
    const overlay = document.getElementById("orderLoadingOverlay");
    if (!overlay) return;

    if (show) {
        overlay.classList.add("show");
    } else {
        overlay.classList.remove("show");
    }
}

function showSubmitSuccessModal() {
    const modal = document.getElementById("successModal");
    if (!modal) return;

    modal.classList.add("show");

    const viewBtn = document.getElementById("viewHistoryBtn");
    const homeBtn = document.getElementById("backHomeBtn");

    if (viewBtn) {
        viewBtn.onclick = () => {
            modal.classList.remove("show");
            document.getElementById("walletHistory")?.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        };
    }

    if (homeBtn) {
        homeBtn.onclick = () => {
            window.location.href = "home.html";
        };
    }
}

function resetTopupForm() {
    const amount = document.getElementById("topupAmount");
    const method = document.getElementById("paymentMethod");
    const quickBtns = document.querySelectorAll(".quick-amounts button");
    const payCards = document.querySelectorAll(
        ".pay-card, .payment-option, .payment-card, .payment-method, .payment-item"
    );

    if (amount) amount.value = "";
    if (method) method.value = "";

    quickBtns.forEach(btn => btn.classList.remove("active"));
    payCards.forEach(card => card.classList.remove("active"));

    hideWalletQr();
}