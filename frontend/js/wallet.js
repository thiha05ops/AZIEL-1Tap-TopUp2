// frontend/js/wallet.js
// AZIEL Wallet V3.1 - PromptPay QR + Manual App/Slip Flow

let walletPollingTimer = null;
let walletCountdownTimer = null;
let walletSocketReady = false;

const AUTO_QR_METHODS = ["promptpay"];
const APP_OPEN_METHODS = [
    "scb", "scbeasy",
    "kplus", "kasikorn",
    "bbl", "bangkok",
    "ktb", "krungthai",
    "krungsri", "kma",
    "ttb",
    "wavepay", "wave",
    "kbzpay", "kbz",
    "ayapay", "aya",
    "cbpay", "cb",
    "uabpay", "uab"
];

function wt(key, fallback = "") {
    if (window.AZIEL_I18N?.t) return window.AZIEL_I18N.t(key, fallback);
    return fallback || key;
}

function walletApiUrl(path) {
    if (window.AZIEL?.apiUrl) return window.AZIEL.apiUrl(path);

    const base = location.port === "5500"
        ? "http://localhost:3000"
        : "";

    return `${base}${path}`;
}

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
    bindPaymentMethodUI();

    renderWalletFromState();
    await loadWallet();

    document
        .getElementById("closeWalletQrModal")
        ?.addEventListener("click", closeWalletQrModal);

    window.AZIEL_I18N?.translatePage?.(document);
});

async function ensureWalletState() {
    if (!AZIEL.user) await AZIEL.loadUser?.();

    if (!AZIEL.user) {
        window.location.href = "login.html";
        return;
    }

    if (!AZIEL.wallet) await AZIEL.loadWallet?.();
}

function bindWalletEvents() {
    window.addEventListener("aziel:walletChanged", renderWalletFromState);

    window.addEventListener("aziel:shopRegionChanged", async () => {
        await loadWallet();
        updateTopupButtonByMethod();
    });

    window.addEventListener("aziel:userChanged", async () => {
        await loadWallet();
    });

    window.addEventListener("aziel:languageChanged", () => {
        window.AZIEL_I18N?.translatePage?.(document);
        loadWallet();
        updateTopupButtonByMethod();
    });
}

function getWalletUser() {
    return AZIEL.user || null;
}

function getWalletRegion() {
    return AZIEL.getShopRegion?.() ||
        AZIEL.getRegion?.() ||
        "MM";
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

function normalizePaymentKey(value) {
    return String(value || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "")
        .replaceAll("-", "")
        .replaceAll("_", "");
}

function getSelectedPaymentMethod() {
    const activeCard = document.querySelector(".pay-card.active");
    const select = document.getElementById("paymentMethod");

    const provider =
        activeCard?.dataset.provider ||
        activeCard?.dataset.key ||
        activeCard?.dataset.value ||
        select?.value ||
        "";

    const method =
        activeCard?.dataset.name ||
        activeCard?.querySelector("strong")?.innerText ||
        activeCard?.innerText?.trim() ||
        select?.selectedOptions?.[0]?.textContent ||
        provider;

    return {
        raw: provider,
        key: normalizePaymentKey(provider),
        provider: normalizePaymentKey(provider),
        method,
        accountName: activeCard?.dataset.accountName || "",
        accountNumber: activeCard?.dataset.accountNumber || ""
    };
}

function isPromptPayPayment(payment) {
    const provider = normalizePaymentKey(payment?.provider || "");
    const raw = normalizePaymentKey(payment?.raw || "");
    const method = normalizePaymentKey(payment?.method || "");

    return (
        provider === "promptpay" ||
        raw === "promptpay" ||
        method.includes("promptpay")
    );
}

function isAppOpenMethod(method) {
    return APP_OPEN_METHODS.includes(normalizePaymentKey(method));
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
            walletApiUrl(`/api/wallet/${encodeURIComponent(user.username)}?currency=${currency}`)
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

        const history = [
            ...(data.transactions || []),
            ...(data.topups || [])
        ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        renderWalletHistory(history);

    } catch (error) {
        console.log("Wallet load error:", error);
        renderWalletFromState();
    }
}

function renderWalletFromState() {
    const wallet = AZIEL.wallet || {};

    updateWalletBalanceUI(
        Number(wallet.balance || 0),
        wallet.symbol || getWalletSymbol()
    );
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

function renderWalletHistory(history) {
    const box = document.getElementById("walletHistory");
    if (!box) return;

    if (!history.length) {
        box.innerHTML = `
            <div class="wallet-empty">
                <h3>${wt("noWalletHistory", "No Wallet History")}</h3>
                <p>${wt("walletHistoryEmptyText", "Your wallet transactions will appear here.")}</p>
            </div>
        `;
        return;
    }

    box.innerHTML = history.map(item => {
        const isPayment = item.type === "payment";
        const isTopup = item.type === "topup" || Boolean(item.paymentMethod);
        const isRefund = item.type === "refund";

        const sign = isPayment ? "-" : isTopup || isRefund ? "+" : "";
        const color = isPayment ? "#ff6868" : "#32d583";

        const statusRaw = normalizeWalletStatus(item.status);
        const prettyStatus = formatWalletStatus(statusRaw);

        const title =
            item.description ||
            item.paymentMethod ||
            formatWalletType(item.type) ||
            wt("walletTransaction", "Wallet transaction");

        const amount = Number(item.amount || 0).toLocaleString();
        const currency = item.currency || getWalletCurrency();

        return `
            <div class="wallet-history-item">
                <div>
                    <strong style="color:${color}">
                        ${sign}${amount} ${currency}
                    </strong>

                    <p>${escapeWalletHTML(title)}</p>

                    <small>
                        ${formatWalletDate(item.createdAt)}
                    </small>
                </div>

                <span class="wallet-status status-${statusRaw}">
                    ${prettyStatus}
                </span>
            </div>
        `;
    }).join("");

    window.AZIEL_I18N?.translatePage?.(document);
}

function normalizeWalletStatus(status) {
    const value = String(status || "pending").toLowerCase();

    if (value === "paid") return "paid";
    if (value === "completed") return "completed";
    if (value === "approved") return "approved";
    if (value === "rejected") return "rejected";
    if (value === "expired") return "expired";
    if (value === "failed") return "failed";

    return "pending";
}

function formatWalletStatus(status) {
    const map = {
        pending: wt("statusPending", "Pending"),
        paid: wt("statusPaid", "Paid"),
        completed: wt("statusCompleted", "Completed"),
        approved: wt("statusApproved", "Approved"),
        rejected: wt("statusRejected", "Rejected"),
        expired: wt("statusExpired", "Expired"),
        failed: wt("statusFailed", "Failed")
    };

    return map[status] || wt("statusPending", "Pending");
}

function formatWalletType(type) {
    const map = {
        topup: wt("walletTopup", "Wallet Topup"),
        payment: wt("walletPayment", "Wallet Payment"),
        refund: wt("walletRefund", "Wallet Refund")
    };

    return map[type] || "";
}

function formatWalletDate(date) {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime())
        ? "-"
        : parsed.toLocaleString();
}

function escapeWalletHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
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

function bindPaymentMethodUI() {
    const select = document.getElementById("paymentMethod");

    select?.addEventListener("change", updateTopupButtonByMethod);

    document.querySelectorAll(".pay-card").forEach(card => {
        card.addEventListener("click", () => {
            document.querySelectorAll(".pay-card")
                .forEach(c => c.classList.remove("active"));

            card.classList.add("active");

            const value =
                card.dataset.value ||
                card.dataset.provider ||
                card.dataset.key ||
                card.dataset.method ||
                "";

            if (select && value) select.value = value;

            updateTopupButtonByMethod();
        });
    });

    updateTopupButtonByMethod();
}

function initWalletTopup() {
    const btn = document.getElementById("submitTopupBtn");
    if (!btn) return;

    updateTopupButtonByMethod();
    btn.addEventListener("click", submitTopup);
}

function updateTopupButtonByMethod() {
    const btn = document.getElementById("submitTopupBtn");
    const note = document.getElementById("walletPaymentNote");
    if (!btn) return;

    btn.removeAttribute("data-i18n");

    const payment = getSelectedPaymentMethod();
    const provider = payment.provider;

    if (!provider && !payment.method) {
        btn.innerText = "Select Payment Method";
        if (note) note.innerText = "Please select a payment method.";
        return;
    }

    if (isPromptPayPayment(payment)) {
        btn.innerText = "Generate QR";
        if (note) {
            note.innerText = "Auto payment enabled. Scan the PromptPay QR and your wallet will update after payment is confirmed.";
        }
        return;
    }

    btn.innerText = `Open ${payment.method} App`;
    if (note) {
        note.innerText = "Manual verification required. Open the app, transfer, then upload your payment slip.";
    }
}

async function submitTopup() {
    const user = getWalletUser();

    if (!user?.username) {
        window.location.href = "login.html";
        return;
    }

    const amount = Number(document.getElementById("topupAmount")?.value);
    const payment = getSelectedPaymentMethod();
    const paymentMethod = payment.raw || payment.provider;
    const provider = payment.provider;
    const currency = getWalletCurrency();
    const region = getWalletRegion();

    console.log("Wallet selected payment:", payment);
    console.log("Wallet provider:", provider);

    if (!amount || amount <= 0) {
        alert(wt("enterAmountAlert", "Please enter amount."));
        return;
    }

    if (!paymentMethod) {
        alert(wt("selectPaymentAlert", "Please select payment method."));
        return;
    }

    const btn = document.getElementById("submitTopupBtn");

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerText = provider === "promptpay"
                ? wt("generatingQr", "Generating QR...")
                : wt("creatingPayment", "Creating Payment...");
        }

        showLoading(true);
        const isPromptPay = isPromptPayPayment(payment);

        const backendPaymentMethod = isPromptPay
            ? "promptpay"
            : provider;

        const backendProvider = isPromptPay
            ? "promptpay"
            : provider;

        const res = await fetch(walletApiUrl("/api/wallet/create"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: user.username,
                amount,
                currency,
                region,
                paymentMethod: backendPaymentMethod,
                provider: backendProvider
            })
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.message || wt("walletCreateFailed", "Create wallet payment failed."));
            return;
        }

        if (isPromptPay) {
            openWalletQrModal(data, {
                amount,
                currency,
                paymentMethod: "promptpay"
            });

            startPaymentStatusPolling(data.topupId);
        } else {
            openWalletManualModal(data, {
                amount,
                currency,
                paymentMethod,
                provider,
                accountName: payment.accountName || data.accountName,
                accountNumber: payment.accountNumber || data.accountNumber
            });
        }
        await loadWallet();

    } catch (error) {
        console.log("Wallet create error:", error);
        alert(wt("serverError", "Server error"));
    } finally {
        showLoading(false);

        if (btn) {
            btn.disabled = false;
            updateTopupButtonByMethod();
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
    if (amountEl) amountEl.innerText = `${Number(info.amount).toLocaleString()} ${info.currency}`;
    if (methodEl) methodEl.innerText = info.paymentMethod || "-";
    if (amountText) amountText.innerText = `${Number(info.amount).toLocaleString()} ${info.currency}`;

    qrImg.src = data.qrImage || data.qrUrl || data.paymentUrl || "";
    modal.classList.add("show");

    window.AZIEL_I18N?.translatePage?.(document);

    startWalletCountdown(10 * 60);
}

function closeWalletQrModal() {
    document.getElementById("walletQrModal")?.classList.remove("show");
    stopWalletPolling();
    stopWalletCountdown();
}

function openWalletManualModal(data, info) {
    const modal = ensureWalletManualModal();

    const topupId = data.topupId || data.id || "-";
    const appName = info.paymentMethod || info.provider || "Payment";
    const accountName = info.accountName || data.accountName || "-";
    const accountNumber = info.accountNumber || data.accountNumber || "-";

    modal.querySelector("#walletManualTitle").innerText = `${appName} Transfer`;
    modal.querySelector("#walletManualTopupId").innerText = topupId;
    modal.querySelector("#walletManualAmount").innerText =
        `${Number(info.amount || 0).toLocaleString()} ${info.currency || ""}`;
    modal.querySelector("#walletManualMethod").innerText = appName;
    modal.querySelector("#walletManualAccountName").innerText = accountName;
    modal.querySelector("#walletManualAccountNumber").innerText = accountNumber;

    const openBtn = modal.querySelector("#walletOpenPaymentAppBtn");
    openBtn.innerText = `Open ${appName} App`;
    openBtn.onclick = () => {
        openWalletPaymentApp(info.provider || info.paymentMethod);
    };

    modal.querySelector("#copyWalletAmountBtn").onclick = () => {
        copyWalletText(String(info.amount || ""));
    };

    modal.querySelector("#copyWalletAccountBtn").onclick = () => {
        copyWalletText(accountNumber);
    };

    modal.querySelector("#copyWalletRefBtn").onclick = () => {
        copyWalletText(topupId);
    };

    const fileInput = modal.querySelector("#walletManualSlip");
    const previewBox = modal.querySelector("#walletManualSlipPreviewBox");
    const previewImg = modal.querySelector("#walletManualSlipPreviewImage");
    const msgBox = modal.querySelector("#walletManualMsg");
    const submitBtn = modal.querySelector("#walletSubmitSlipBtn");

    fileInput.value = "";
    previewBox.style.display = "none";
    previewImg.src = "";
    msgBox.innerText = "";
    msgBox.className = "";

    fileInput.onchange = () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        previewImg.src = URL.createObjectURL(file);
        previewBox.style.display = "block";
    };

    modal.querySelector("#walletRemoveSlipBtn").onclick = () => {
        fileInput.value = "";
        previewImg.src = "";
        previewBox.style.display = "none";
    };

    submitBtn.onclick = () => {
        const file = fileInput.files?.[0];
        submitWalletSlip(topupId, file, submitBtn, msgBox);
    };

    modal.querySelector("#closeWalletManualModal").onclick = closeWalletManualModal;

    modal.classList.add("show");
    window.AZIEL_I18N?.translatePage?.(document);
}

function ensureWalletManualModal() {
    let modal = document.getElementById("walletManualModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "walletManualModal";
    modal.className = "wallet-qr-modal";

    modal.innerHTML = `
        <div class="wallet-qr-box wallet-manual-box">
            <button type="button" id="closeWalletManualModal" class="wallet-modal-close">×</button>

            <h3 id="walletManualTitle">Manual Payment</h3>

            <div class="wallet-manual-info">
                <div class="transfer-card">
                    <h4>Amount</h4>
                    <div class="transfer-row">
                        <strong id="walletManualAmount">-</strong>
                        <button type="button" id="copyWalletAmountBtn">Copy</button>
                    </div>
                </div>

                <div class="transfer-card">
                    <h4>Account Name</h4>
                    <div class="transfer-row">
                        <strong id="walletManualAccountName">-</strong>
                    </div>
                </div>

                <div class="transfer-card">
                    <h4>Account Number</h4>
                    <div class="transfer-row">
                        <strong id="walletManualAccountNumber">-</strong>
                        <button type="button" id="copyWalletAccountBtn">Copy</button>
                    </div>
                </div>

                <div class="transfer-card">
                    <h4>Reference</h4>
                    <div class="transfer-row">
                        <strong id="walletManualTopupId">-</strong>
                        <button type="button" id="copyWalletRefBtn">Copy</button>
                    </div>
                </div>

                <div class="transfer-card">
                    <h4>Payment Method</h4>
                    <div class="transfer-row">
                        <strong id="walletManualMethod">-</strong>
                    </div>
                </div>
            </div>

            <button type="button" id="walletOpenPaymentAppBtn" class="payment-open-bank">
                Open Payment App
            </button>

            <div class="manual-payment-note">
                <strong>Already transferred?</strong>
                <span>Upload your payment slip and wait for admin verification.</span>
            </div>

            <label class="manual-slip-upload">
                <span>Upload Payment Slip</span>
                <input type="file" id="walletManualSlip" accept="image/*">
            </label>

            <div id="walletManualSlipPreviewBox" class="manual-slip-preview" style="display:none;">
                <img id="walletManualSlipPreviewImage" src="" alt="Payment Slip">
                <button type="button" id="walletRemoveSlipBtn">Remove</button>
            </div>

            <div id="walletManualMsg"></div>

            <button type="button" id="walletSubmitSlipBtn" class="wallet-submit-slip-btn">
                Submit Payment Slip
            </button>
        </div>
    `;

    document.body.appendChild(modal);
    return modal;
}

function closeWalletManualModal() {
    document.getElementById("walletManualModal")?.classList.remove("show");
}

function getWalletDeepLink(provider) {
    const p = normalizePaymentKey(provider);

    const links = {
        scb: "scbeasy://",
        scbeasy: "scbeasy://",
        kplus: "kplus://",
        kasikorn: "kplus://",
        bbl: "bualuangmbanking://",
        bangkok: "bualuangmbanking://",
        ktb: "krungthainext://",
        krungthai: "krungthainext://",
        krungsri: "kma://",
        kma: "kma://",
        ttb: "ttbtouch://",

        wavepay: "wavepay://",
        wave: "wavepay://",
        kbzpay: "kbzpay://",
        kbz: "kbzpay://",
        ayapay: "ayapay://",
        aya: "ayapay://",
        cbpay: "cbpay://",
        cb: "cbpay://",
        uabpay: "uabpay://",
        uab: "uabpay://"
    };

    return links[p] || "";
}

function openWalletPaymentApp(provider) {
    const msgBox = document.getElementById("walletManualMsg");
    const link = getWalletDeepLink(provider);

    if (!link) {
        setWalletMsg(
            msgBox,
            "This payment app cannot be opened automatically. Please open it manually.",
            "error"
        );
        return;
    }

    setWalletMsg(
        msgBox,
        "Opening payment app... After transfer, return here and upload your payment slip.",
        "success"
    );

    setTimeout(() => {
        window.location.href = link;
    }, 300);
}

function copyWalletText(text) {
    if (!text) return;

    navigator.clipboard?.writeText(text)
        .then(() => {
            const msg = document.getElementById("walletManualMsg");
            setWalletMsg(msg, "Copied.", "success");
        })
        .catch(() => {
            alert(text);
        });
}

async function submitWalletSlip(topupId, file, btn, msgBox) {
    if (!file) {
        setWalletMsg(msgBox, "Please upload your payment slip first.", "error");
        return;
    }

    const formData = new FormData();
    formData.append("slip", file);
    formData.append("topupId", topupId);

    try {
        btn.disabled = true;
        btn.innerText = "Submitting...";

        const endpoints = [
            `/api/wallet/slip/${encodeURIComponent(topupId)}`,
            `/api/wallet/topup/${encodeURIComponent(topupId)}/slip`,
            `/api/wallet/upload-slip/${encodeURIComponent(topupId)}`
        ];

        let data = null;
        let success = false;

        for (const endpoint of endpoints) {
            try {
                const res = await fetch(walletApiUrl(endpoint), {
                    method: "POST",
                    body: formData
                });

                data = await res.json().catch(() => ({}));

                if (res.ok && data.success !== false) {
                    success = true;
                    break;
                }
            } catch (_) {
                // try next endpoint
            }
        }

        if (!success) {
            setWalletMsg(
                msgBox,
                data?.message || "Slip upload failed. Please check backend wallet slip route.",
                "error"
            );
            return;
        }

        setWalletMsg(
            msgBox,
            "Payment slip submitted. Please wait for admin verification.",
            "success"
        );

        await loadWallet();

        setTimeout(() => {
            closeWalletManualModal();
            resetTopupForm();
        }, 1200);

    } catch (error) {
        console.log("Wallet slip upload error:", error);
        setWalletMsg(msgBox, "Server error", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = "Submit Payment Slip";
    }
}

function setWalletMsg(el, text, type) {
    if (!el) return;
    el.innerText = text;
    el.className = type ? `wallet-msg ${type}` : "";
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

            alert(
                wt(
                    "paymentSessionExpired",
                    "Payment session expired. Please generate a new QR."
                )
            );
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
            const res = await fetch(
                walletApiUrl(`/api/wallet/status/${topupId}`)
            );

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

    const socket =
        location.port === "5500"
            ? io("http://localhost:3000")
            : io();

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
    document.getElementById("walletLivePopup")?.remove();

    const popup = document.createElement("div");
    popup.id = "walletLivePopup";

    popup.innerHTML = `
        💰 ${wt("walletUpdated", "Wallet Updated")}<br>
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

    window.AZIEL_I18N?.translatePage?.(document);

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
    const payCards = document.querySelectorAll(".pay-card");

    if (amount) amount.value = "";
    if (method) method.value = "";

    quickBtns.forEach(btn => btn.classList.remove("active"));
    payCards.forEach(card => card.classList.remove("active"));

    updateTopupButtonByMethod();
}