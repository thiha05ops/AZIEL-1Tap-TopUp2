// frontend/js/wallet.js
// AZIEL Wallet V2.5 - Cleaned Stable Version

let walletPollingTimer = null;
let walletCountdownTimer = null;
let walletSocketReady = false;

document.addEventListener("DOMContentLoaded", async () => {
    if (!window.AZIEL) {
        console.error("AZIEL user-state.js not loaded");
        window.location.href = "login.html";
        return;
    }

    if (!AZIEL.getToken?.()) {
        window.location.href = "login.html";
        return;
    }

    await ensureWalletState();

    initQuickAmounts();
    initWalletTopup();
    initWalletSocket();
    bindWalletEvents();

    renderWalletFromState();
    await loadWallet();

    document
        .getElementById("closeWalletQrModal")
        ?.addEventListener("click", closeWalletQrModal);
});

async function ensureWalletState() {
    if (!AZIEL.user) {
        await AZIEL.loadUser?.();
    }

    if (!AZIEL.user) {
        window.location.href = "login.html";
        return;
    }

    if (!AZIEL.wallet) {
        await AZIEL.loadWallet?.();
    }
}

function bindWalletEvents() {
    window.addEventListener("aziel:walletChanged", renderWalletFromState);

    window.addEventListener("aziel:shopRegionChanged", async () => {
        await loadWallet();
    });

    window.addEventListener("aziel:userChanged", async () => {
        await loadWallet();
    });
}

function getWalletUser() {
    return AZIEL.user || null;
}

function getWalletRegion() {
    return AZIEL.getShopRegion?.() || AZIEL.getRegion?.() || "MM";
}

function getWalletCurrency() {
    return AZIEL.getShopCurrency?.() ||
        AZIEL.getCurrency?.() ||
        (getWalletRegion() === "TH" ? "THB" : "MMK");
}

function getWalletSymbol() {
    return AZIEL.getShopSymbol?.() ||
        AZIEL.getSymbol?.() ||
        (getWalletCurrency() === "THB" ? "฿" : "Ks");
}

async function loadWallet() {
    const user = getWalletUser();

    if (!user?.username) {
        renderWalletFromState();
        return;
    }

    const currency = getWalletCurrency();

    try {
        const res = await fetch(
            `/api/wallet/${encodeURIComponent(user.username)}?currency=${currency}`
        );

        const data = await res.json();

        if (!data.success) {
            renderWalletFromState();
            return;
        }

        AZIEL.wallet = {
            balance: Number(data.balance || 0),
            currency,
            symbol: getWalletSymbol()
        };

        window.dispatchEvent(new Event("aziel:walletChanged"));

        renderWalletHistory(data.topups || []);
    } catch (error) {
        console.log("Wallet load error:", error);
        renderWalletFromState();
    }
}

function renderWalletFromState() {
    const wallet = AZIEL.wallet || {};
    const symbol = wallet.symbol || getWalletSymbol();
    const balance = Number(wallet.balance || 0);

    updateWalletBalanceUI(balance, symbol);
}

function updateWalletBalanceUI(amount, symbol) {
    const text = `${Number(amount || 0).toLocaleString()} ${symbol || ""}`;

    [
        "walletBalance",
        "balanceAmount",
        "userWalletBalance",
        "headerWalletText"
    ].forEach(id => {
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
                    ${item.currency || getWalletCurrency()}
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
        });
    });

    input.addEventListener("input", () => {
        buttons.forEach(b => b.classList.remove("active"));
    });
}

function initWalletTopup() {
    const btn = document.getElementById("submitTopupBtn");
    if (!btn) return;

    btn.innerText = "Generate QR";
    btn.addEventListener("click", submitTopup);
}

async function submitTopup() {
    const user = getWalletUser();

    if (!user?.username) {
        window.location.href = "login.html";
        return;
    }

    const amount = Number(document.getElementById("topupAmount")?.value);
    const paymentMethod = document.getElementById("paymentMethod")?.value;
    const currency = getWalletCurrency();
    const region = getWalletRegion();

    if (!amount || amount <= 0) {
        alert("Please enter amount.");
        return;
    }

    if (!paymentMethod) {
        alert("Please select payment method.");
        return;
    }

    const btn = document.getElementById("submitTopupBtn");

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerText = "Generating QR...";
        }

        showLoading(true);

        const res = await fetch("/api/wallet/create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: user.username,
                amount,
                currency,
                region,
                paymentMethod
            })
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.message || "Create wallet payment failed.");
            return;
        }

        openWalletQrModal(data, {
            amount,
            currency,
            paymentMethod
        });

        startPaymentStatusPolling(data.topupId);
        await loadWallet();
    } catch (error) {
        console.log("Wallet create error:", error);
        alert("Server error");
    } finally {
        showLoading(false);

        if (btn) {
            btn.disabled = false;
            btn.innerText = "Generate QR";
        }
    }
}

function openWalletQrModal(data, info) {
    const modal = document.getElementById("walletQrModal");
    const topupIdEl = document.getElementById("modalTopupId");
    const amountEl = document.getElementById("modalTopupAmount");
    const methodEl = document.getElementById("modalPaymentMethod");
    const qrImg = document.getElementById("modalWalletQrImage");
    const amountText = document.getElementById("modalAmountText");

    if (!modal || !qrImg) return;

    if (topupIdEl) topupIdEl.innerText = data.topupId || "-";
    if (amountEl) {
        amountEl.innerText =
            `${Number(info.amount).toLocaleString()} ${info.currency}`;
    }
    if (methodEl) methodEl.innerText = info.paymentMethod || "-";
    if (amountText) {
        amountText.innerText =
            `${Number(info.amount).toLocaleString()} ${info.currency}`;
    }

    qrImg.src = data.qrImage || data.qrUrl || data.paymentUrl || "";

    modal.classList.add("show");

    startWalletCountdown(10 * 60);
}

function closeWalletQrModal() {
    const modal = document.getElementById("walletQrModal");
    if (modal) modal.classList.remove("show");

    stopWalletPolling();
    stopWalletCountdown();
}

function startWalletCountdown(seconds) {
    const el = document.getElementById("walletCountdown");
    if (!el) return;

    stopWalletCountdown();

    let remaining = seconds;

    function render() {
        const min = String(Math.floor(remaining / 60)).padStart(2, "0");
        const sec = String(remaining % 60).padStart(2, "0");
        el.innerText = `${min}:${sec}`;
    }

    render();

    walletCountdownTimer = setInterval(() => {
        remaining--;
        render();

        if (remaining <= 0) {
            stopWalletCountdown();
            stopWalletPolling();
            closeWalletQrModal();
            alert("Payment session expired. Please generate a new QR.");
        }
    }, 1000);
}

function stopWalletCountdown() {
    if (walletCountdownTimer) {
        clearInterval(walletCountdownTimer);
        walletCountdownTimer = null;
    }
}

function startPaymentStatusPolling(topupId) {
    if (!topupId) return;

    stopWalletPolling();

    let count = 0;
    const maxCount = 200;

    walletPollingTimer = setInterval(async () => {
        count++;

        try {
            const res = await fetch(`/api/wallet/status/${topupId}`);
            const data = await res.json();

            if (data.success && data.status === "paid") {
                stopWalletPolling();
                closeWalletQrModal();

                await loadWallet();

                showSubmitSuccessModal();
                resetTopupForm();
            }

            if (count >= maxCount) {
                stopWalletPolling();
            }
        } catch (error) {
            console.log("Wallet status polling error:", error);
        }
    }, 3000);
}

function stopWalletPolling() {
    if (walletPollingTimer) {
        clearInterval(walletPollingTimer);
        walletPollingTimer = null;
    }
}

function initWalletSocket() {
    if (walletSocketReady) return;
    if (typeof io === "undefined") return;

    const user = getWalletUser();
    if (!user?.username) return;

    const socket = io();

    socket.emit("joinUser", user.username);

    socket.on("walletUpdated", async data => {
        const currency = data.currency || getWalletCurrency();
        const symbol = currency === "THB" ? "฿" : "Ks";
        const amount = Number(data.amount || data.balance || 0);

        AZIEL.wallet = {
            balance: amount,
            currency,
            symbol
        };

        window.dispatchEvent(new Event("aziel:walletChanged"));

        showWalletPopup(amount, symbol);
        showSubmitSuccessModal();
        resetTopupForm();

        await loadWallet();
    });

    walletSocketReady = true;
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

    overlay.classList.toggle("show", Boolean(show));
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
}