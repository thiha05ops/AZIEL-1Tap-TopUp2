// frontend/js/wallet.js
// AZIEL Wallet V3.1 - PromptPay QR + Manual App/Slip Flow

let walletPollingTimer = null;
let walletCountdownTimer = null;
let walletSocketReady = false;
let walletHistoryItems = [];
let walletHistoryPagination = {
    nextCursor: "",
    hasMore: false,
    loadingMore: false
};
let walletPaymentMethods = [];
let activeWalletManualIntent = null;

const AUTO_QR_METHODS = ["promptpay"];

function wt(key, fallback = "") {
    if (window.AZIEL_I18N?.t) return window.AZIEL_I18N.t(key, fallback);
    return fallback || key;
}

function walletApiUrl(path) {
    if (window.AZIEL?.apiUrl) return window.AZIEL.apiUrl(path);

    const base = location.port === "5500"
        ? `${location.protocol}//${location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:3000`
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
    await loadWalletPaymentMethods();
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
        await loadWalletPaymentMethods();
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
    const key = String(value || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "")
        .replaceAll("-", "")
        .replaceAll("_", "");
    const aliases = {
        azielwallet: "wallet",
        manualbanktransfer: "manualbank"
    };
    return aliases[key] || key;
}

function getSelectedPaymentMethod() {
    const activeCard = document.querySelector(".pay-card.active");

    const key = activeCard?.dataset.method || "";

    return {
        raw: key,
        key: normalizePaymentKey(key),
        provider: normalizePaymentKey(activeCard?.dataset.provider || ""),
        method: window.AZIEL_PAYMENT_DISPLAY?.from?.(activeCard?.dataset.name || key, activeCard?.dataset.name || key) ||
            activeCard?.dataset.name ||
            key,
        paymentType: activeCard?.dataset.paymentType || "manual",
        region: activeCard?.dataset.region || "",
        qrImage: activeCard?.dataset.qr || "",
        accountName: activeCard?.dataset.accountName || "",
        accountNumber: activeCard?.dataset.accountNumber || "",
        maintenanceMessage: activeCard?.dataset.maintenanceMessage || "",
        slipRequired: activeCard?.dataset.slipRequired === "true",
        deepLink: activeCard?.dataset.deepLink || "",
        deepLinkUrl: activeCard?.dataset.deepLink || "",
        logo: activeCard?.dataset.logo || "",
        appDisplayName: activeCard?.dataset.appDisplayName || "",
        appStoreUrl: activeCard?.dataset.appStoreUrl || "",
        playStoreUrl: activeCard?.dataset.playStoreUrl || "",
        enableSaveQr: activeCard?.dataset.enableSaveQr === "true",
        enableOpenApp: activeCard?.dataset.enableOpenApp === "true",
        enableChecklist: activeCard?.dataset.enableChecklist === "true",
        dynamicQrSupported: activeCard?.dataset.dynamicQrSupported === "true",
        amountPrefillSupported: activeCard?.dataset.amountPrefillSupported === "true",
        referenceSupported: activeCard?.dataset.referenceSupported === "true",
        galleryScanSupported: activeCard?.dataset.galleryScanSupported === "true",
        autoVerificationSupported: activeCard?.dataset.autoVerificationSupported === "true",
        webhookSupported: activeCard?.dataset.webhookSupported === "true",
        checklistSteps: parseWalletChecklistSteps(activeCard?.dataset.checklistSteps)
    };
}

function parseWalletChecklistSteps(value) {
    try {
        const steps = JSON.parse(value || "[]");
        return Array.isArray(steps) ? steps : [];
    } catch (error) {
        return [];
    }
}

function isPromptPayPayment(payment) {
    const provider = normalizePaymentKey(payment?.provider || "");
    const raw = normalizePaymentKey(payment?.raw || "");
    const method = normalizePaymentKey(payment?.method || "");

    return (
        payment?.paymentType === "auto" ||
        provider === "omise" ||
        provider === "promptpay" ||
        raw === "promptpay" ||
        method.includes("promptpay")
    );
}

async function loadWalletPaymentMethods() {
    const paymentGrid = document.getElementById("paymentGrid");
    const paymentInput = document.getElementById("paymentMethod");
    if (!paymentGrid || !paymentInput) return;

    const region = getWalletRegion();
    paymentGrid.innerHTML = `<p class="pay-loading">Loading payment methods...</p>`;
    paymentInput.value = "";
    walletPaymentMethods = [];

    try {
        const res = await fetch(walletApiUrl(`/api/payment-methods?region=${encodeURIComponent(region)}`), {
            headers: AZIEL.authHeaders?.() || {}
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.message || "Failed to load payment methods");
        }

    walletPaymentMethods = (Array.isArray(data.methods) ? data.methods : [])
            .filter(isWalletFundingMethodAvailable)
            .sort(sortWalletPaymentMethods);

        renderWalletPaymentMethods(walletPaymentMethods);
    } catch (error) {
        console.log("Wallet payment methods error:", error);
        paymentGrid.innerHTML = `<p class="pay-error">Payment methods failed to load.</p>`;
        updateTopupButtonByMethod();
    }
}

function sortWalletPaymentMethods(a = {}, b = {}) {
    const orderA = Number(a.sortOrder || 0);
    const orderB = Number(b.sortOrder || 0);
    if (orderA !== orderB) return orderA - orderB;
    return String(a.method || a.key || "").localeCompare(String(b.method || b.key || ""));
}

function isWalletFundingMethodAvailable(method = {}) {
    const region = String(method.region || "").toUpperCase();
    const type = normalizePaymentKey(method.paymentType || "");
    const provider = normalizePaymentKey(method.provider || "");
    if (method.enabled !== true) return false;
    if (region !== getWalletRegion()) return false;
    if (method.publicReady === false) return false;
    if (type === "wallet" || provider === "wallet" || normalizePaymentKey(method.key) === "wallet") return false;
    if (String(method.maintenanceMessage || "").trim()) return false;
    if (type !== "auto" && provider !== "omise") {
        const hasQr = Boolean(method.qrImage || method.qrImageUrl || method.uploadedQrImage || method.finalQrImage);
        const hasAccount = Boolean(method.accountName && method.accountNumber);
        if (!hasQr || !hasAccount) return false;
    }
    return true;
}

function renderWalletPaymentMethods(methods = []) {
    const paymentGrid = document.getElementById("paymentGrid");
    if (!paymentGrid) return;

    if (!methods.length) {
        paymentGrid.innerHTML = `<p class="pay-empty">No wallet top-up payment methods available.</p>`;
        updateTopupButtonByMethod();
        return;
    }

    paymentGrid.innerHTML = "";
    methods.forEach((method, index) => {
        paymentGrid.appendChild(buildWalletPaymentCard(method, index));
    });

    const firstCard = paymentGrid.querySelector(".pay-card");
    if (firstCard) selectWalletPaymentCard(firstCard);
}

function buildWalletPaymentCard(method, index) {
    const key = method.key || normalizePaymentKey(method.method);
    const displayName = window.AZIEL_PAYMENT_DISPLAY?.method?.({ ...method, key }, method.method || key || "Payment") ||
        method.method ||
        key ||
        "Payment";
    const logo = method.logoUrl || getWalletPaymentLogo(key);
    const qrImage = method.qrImage || method.uploadedQrImage || method.qrImageUrl || "";
    const paymentType = method.paymentType || "manual";
    const provider = method.provider || "manual";

    const card = document.createElement("button");
    card.type = "button";
    card.className = `pay-card ${index === 0 ? "active" : ""}`;
    card.dataset.method = key;
    card.dataset.name = displayName;
    card.dataset.logo = logo;
    card.dataset.qr = qrImage;
    card.dataset.accountName = method.accountName || "";
    card.dataset.accountNumber = method.accountNumber || "";
    card.dataset.paymentType = paymentType;
    card.dataset.provider = provider;
    card.dataset.region = method.region || "";
    card.dataset.maintenanceMessage = method.maintenanceMessage || "";
    card.dataset.slipRequired = String(["manual", "deeplink"].includes(paymentType));
    card.dataset.deepLink = method.deepLink || method.deepLinkUrl || "";
    card.dataset.appDisplayName = method.appDisplayName || displayName;
    card.dataset.appStoreUrl = method.appStoreUrl || "";
    card.dataset.playStoreUrl = method.playStoreUrl || "";
    card.dataset.enableSaveQr = String(method.enableSaveQr === true);
    card.dataset.enableOpenApp = String(method.enableOpenApp === true);
    card.dataset.enableChecklist = String(method.enableChecklist === true);
    card.dataset.dynamicQrSupported = String(method.dynamicQrSupported === true);
    card.dataset.amountPrefillSupported = String(method.amountPrefillSupported === true);
    card.dataset.referenceSupported = String(method.referenceSupported === true);
    card.dataset.galleryScanSupported = String(method.galleryScanSupported === true);
    card.dataset.autoVerificationSupported = String(method.autoVerificationSupported === true);
    card.dataset.webhookSupported = String(method.webhookSupported === true);
    card.dataset.checklistSteps = JSON.stringify(Array.isArray(method.checklistSteps) ? method.checklistSteps : []);

    card.innerHTML = `
        <img src="${escapeWalletHTML(logo)}" class="pay-logo" alt="${escapeWalletHTML(displayName)}" onerror="this.src='/assets/payment/payment-neutral.svg'">
        <div class="pay-info">
            <span>${escapeWalletHTML(displayName)}</span>
            ${getWalletPaymentBadge(paymentType, provider)}
        </div>
    `;

    card.addEventListener("click", () => selectWalletPaymentCard(card));
    return card;
}

function getWalletPaymentBadge(paymentType, provider) {
    if (paymentType === "auto" || provider === "omise") return `<small class="auto-pay-badge">Auto</small>`;
    if (paymentType === "deeplink") return `<small class="manual-pay-badge">Bank App</small>`;
    return `<small class="manual-pay-badge">Receipt</small>`;
}

function getWalletPaymentLogo(key) {
    const logos = {
        kbzpay: "/assets/payment/kbzpay.png",
        wavepay: "/assets/payment/wavepay.png",
        ayapay: "/assets/payment/ayapay.png",
        promptpay: "/assets/payment/promptpay.png",
        scb: "/assets/payment/scb.png",
        bangkokbank: "/assets/payment/bank-neutral.svg",
        kplus: "/assets/payment/bank-neutral.svg",
        krungsri: "/assets/payment/bank-neutral.svg",
        mmqr: "/assets/payment/payment-neutral.svg",
        manualbank: "/assets/payment/bank-neutral.svg"
    };

    return logos[normalizePaymentKey(key)] || "/assets/payment/payment-neutral.svg";
}

function selectWalletPaymentCard(card) {
    const paymentInput = document.getElementById("paymentMethod");
    document.querySelectorAll(".pay-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    if (paymentInput) paymentInput.value = card.dataset.method || "";
    window.AZIEL_MOTION?.emphasize(card, "selected");
    updateTopupButtonByMethod();
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
            walletApiUrl(`/api/wallet/${encodeURIComponent(user.username)}?currency=${currency}&limit=30`),
            {
                headers: AZIEL.authHeaders?.() || {}
            }
        );

        const data = await res.json();

        if (!data.success) {
            renderWalletFromState();
            return;
        }

        if (AZIEL.applyWalletUpdate) {
            AZIEL.applyWalletUpdate({
                balance: Number(data.balance || 0),
                currency,
                updatedAt: new Date()
            });
        } else {
            AZIEL.wallet = {
                balance: Number(data.balance || 0),
                currency,
                symbol: getWalletSymbol()
            };

            window.dispatchEvent(new Event("aziel:walletChanged"));
        }

        walletHistoryItems = [
            ...(data.transactions || []),
            ...(data.topups || [])
        ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        walletHistoryPagination = {
            nextCursor: data.pagination?.nextCursor || data.nextCursor || "",
            hasMore: Boolean(data.pagination?.hasMore || data.nextCursor),
            loadingMore: false
        };

        renderWalletHistory(walletHistoryItems);

    } catch (error) {
        console.log("Wallet load error:", error);
        renderWalletFromState();
    }
}

async function loadMoreWalletHistory() {
    const user = getWalletUser();
    const currency = getWalletCurrency();
    if (!user?.username || walletHistoryPagination.loadingMore || !walletHistoryPagination.hasMore) return;

    walletHistoryPagination.loadingMore = true;
    renderWalletHistory(walletHistoryItems);

    try {
        const params = new URLSearchParams({
            currency,
            limit: "30",
            cursor: walletHistoryPagination.nextCursor
        });
        const res = await fetch(walletApiUrl(`/api/wallet/${encodeURIComponent(user.username)}?${params.toString()}`), {
            headers: AZIEL.authHeaders?.() || {}
        });
        const data = await res.json();
        if (!data?.success) return;

        const incoming = [
            ...(data.transactions || []),
            ...(data.topups || [])
        ];
        walletHistoryItems = mergeWalletHistory(walletHistoryItems, incoming)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        walletHistoryPagination.nextCursor = data.pagination?.nextCursor || data.nextCursor || "";
        walletHistoryPagination.hasMore = Boolean(data.pagination?.hasMore || data.nextCursor);
    } finally {
        walletHistoryPagination.loadingMore = false;
        renderWalletHistory(walletHistoryItems);
    }
}

function mergeWalletHistory(current = [], incoming = []) {
    const keyFor = item => String(item.transactionId || item.topupId || item._id || item.id || `${item.type}:${item.createdAt}:${item.amount}`);
    const seen = new Set(current.map(keyFor));
    const merged = current.slice();
    incoming.forEach(item => {
        const key = keyFor(item);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(item);
    });
    return merged;
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
        if (el) {
            const changed = el.innerText !== text;
            el.innerText = text;
            if (changed) window.AZIEL_MOTION?.emphasize(el, "value");
        }
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

    const rows = history.map(item => {
        const direction = getWalletDirection(item);
        const isPayment = direction === "debit";

        const sign = direction === "debit" ? "-" : direction === "credit" ? "+" : "";
        const color = isPayment ? "#ff6868" : "#32d583";

        const statusRaw = normalizeWalletStatus(item.status);
        const prettyStatus = formatWalletStatus(statusRaw);
        const amount = Number(item.amount || 0).toLocaleString();
        const currency = item.currency || getWalletCurrency();

        const balanceAfter = item.balanceAfter != null
            ? `<small>${wt("walletBalanceAfter", "Balance")}: ${Number(item.balanceAfter || 0).toLocaleString()} ${currency}</small>`
            : "";

        const title =
            item.description ||
            item.paymentMethod ||
            formatWalletType(item.type) ||
            wt("walletTransaction", "Wallet transaction");

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

                    ${balanceAfter}
                </div>

                <span class="wallet-status status-${statusRaw}">
                    ${prettyStatus}
                </span>
            </div>
        `;
    }).join("");

    const loadMore = walletHistoryPagination.hasMore ? `
        <button class="wallet-load-more" id="walletHistoryLoadMoreBtn" type="button" ${walletHistoryPagination.loadingMore ? "disabled" : ""}>
            ${escapeWalletHTML(walletHistoryPagination.loadingMore ? wt("loading", "Loading") : wt("loadMore", "Load More"))}
        </button>
    ` : "";

    box.innerHTML = rows + loadMore;
    document.getElementById("walletHistoryLoadMoreBtn")?.addEventListener("click", loadMoreWalletHistory);

    window.AZIEL_MOTION?.enter(box, "fast");

    window.AZIEL_I18N?.translatePage?.(document);
}

function getWalletDirection(item) {
    const direction = String(item.direction || "").toLowerCase();
    if (direction === "credit" || direction === "debit") return direction;

    const type = String(item.type || "").toLowerCase();
    if (type.includes("payment")) return "debit";
    if (type.includes("topup") || type.includes("refund")) return "credit";
    if (item.paymentMethod) return "credit";

    return "";
}

function normalizeWalletStatus(status) {
    const value = String(status || "pending").toLowerCase();

    if (value === "paid") return "paid";
    if (value === "completed") return "completed";
    if (value === "approved") return "approved";
    if (value === "committed") return "completed";
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
        refund: wt("walletRefund", "Wallet Refund"),
        "wallet.topup": wt("walletTopup", "Wallet Topup"),
        "wallet.payment": wt("walletPayment", "Wallet Payment"),
        "wallet.refund": wt("walletRefund", "Wallet Refund"),
        "wallet.reversal": wt("walletReversal", "Wallet Reversal"),
        "wallet.adjustment": wt("walletAdjustment", "Wallet Adjustment")
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
    const desc = document.getElementById("walletTopupDesc");
    if (!btn) return;

    btn.removeAttribute("data-i18n");
    note?.removeAttribute("data-i18n");
    desc?.removeAttribute("data-i18n");

    const payment = getSelectedPaymentMethod();
    const provider = payment.provider;

    if (!provider && !payment.method) {
        btn.innerText = "Select Payment Method";
        if (note) note.innerText = "Please select a payment method.";
        if (desc) desc.innerText = "Select an amount and payment method to continue.";
        return;
    }

    if (isPromptPayPayment(payment)) {
        btn.innerText = "Generate QR";
        if (note) {
            note.innerText = "Your wallet updates after payment is confirmed.";
        }
        if (desc) desc.innerText = "Automatic payment confirmation is available for this method.";
        return;
    }

    btn.innerText = "Continue";
    if (note) {
        note.innerText = "Transfer the amount and submit your payment receipt for verification.";
    }
    if (desc) desc.innerText = "Manual top-ups are submitted only after you upload a payment receipt.";
}

async function submitTopup() {
    const user = getWalletUser();

    if (!user?.username) {
        window.location.href = "login.html";
        return;
    }

    const amount = Number(document.getElementById("topupAmount")?.value);
    const payment = getSelectedPaymentMethod();
    const paymentMethod = payment.key;
    const provider = payment.provider;
    const currency = getWalletCurrency();
    const region = getWalletRegion();

    console.log("Wallet selected payment:", payment);
    console.log("Wallet provider:", provider);

    if (!amount || amount <= 0) {
        showWalletToast(wt("enterAmountAlert", "Please enter amount."), "error");
        return;
    }

    if (!paymentMethod) {
        showWalletToast(wt("selectPaymentAlert", "Please select payment method."), "error");
        return;
    }

    const btn = document.getElementById("submitTopupBtn");

    try {
        if (btn) {
            const loadingText = isPromptPayPayment(payment)
                ? wt("generatingQr", "Generating QR...")
                : "Preparing instructions...";

            if (window.AZIEL_UI?.button) {
                window.AZIEL_UI.button.setLoading(btn, { text: loadingText });
            } else {
                btn.disabled = true;
                btn.innerText = loadingText;
            }
        }

        showLoading(true);
        const isPromptPay = isPromptPayPayment(payment);

        const endpoint = isPromptPay
            ? "/api/wallet/create"
            : "/api/wallet/manual-intent";
        const res = await fetch(walletApiUrl(endpoint), {
            method: "POST",
            headers: AZIEL.authHeaders?.({ "Content-Type": "application/json" }) || {
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
            showWalletToast(data.message || wt("walletCreateFailed", "Create wallet payment failed."), "error");
            return;
        }

        if (isPromptPay) {
            openWalletQrModal(data, {
                amount,
                currency,
                paymentMethod: "promptpay"
            });

            startPaymentStatusPolling(data.topupId);
            await loadWallet();
        } else {
            openWalletManualModal(data, {
                amount,
                currency,
                paymentMethod: data.paymentName || payment.method,
                provider: data.provider || provider,
                accountName: data.accountName || payment.accountName,
                accountNumber: data.accountNumber || payment.accountNumber,
                qrImage: data.qrImage || data.qrUrl || payment.qrImage,
                slipRequired: data.slipRequired !== false,
                deepLink: data.deepLinkUrl || data.deepLink || data.method?.deepLink || data.method?.deepLinkUrl || payment.deepLink,
                appDisplayName: data.appDisplayName || data.method?.appDisplayName || payment.appDisplayName,
                appStoreUrl: data.appStoreUrl || data.method?.appStoreUrl || payment.appStoreUrl,
                playStoreUrl: data.playStoreUrl || data.method?.playStoreUrl || payment.playStoreUrl,
                enableSaveQr: data.enableSaveQr === true || data.method?.enableSaveQr === true || payment.enableSaveQr === true,
                enableOpenApp: data.enableOpenApp === true || data.method?.enableOpenApp === true || payment.enableOpenApp === true,
                enableChecklist: data.enableChecklist === true || data.method?.enableChecklist === true || payment.enableChecklist === true,
                checklistSteps: data.checklistSteps || data.method?.checklistSteps || payment.checklistSteps || [],
                method: data.method || payment
            });
        }

    } catch (error) {
        console.log("Wallet create error:", error);
        showWalletToast(wt("serverError", "Server error"), "error");
    } finally {
        showLoading(false);

        if (btn) {
            if (window.AZIEL_UI?.button) {
                window.AZIEL_UI.button.reset(btn);
            } else {
                btn.disabled = false;
            }
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
    if (methodEl) methodEl.innerText = window.AZIEL_PAYMENT_DISPLAY?.from?.(info.paymentMethod, info.paymentMethod || "-") || info.paymentMethod || "-";
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
    const intentId = data.intentId || data.id || "";
    const reference = data.reference || data.topupId || "-";
    const appName = window.AZIEL_PAYMENT_DISPLAY?.from?.(info.paymentMethod || info.provider, info.paymentMethod || info.provider || "Payment") ||
        info.paymentMethod ||
        info.provider ||
        "Payment";
    const accountName = info.accountName || data.accountName || "-";
    const accountNumber = info.accountNumber || data.accountNumber || "-";
    const qrImage = info.qrImage || data.qrImage || data.qrUrl || "";
    const slipRequired = info.slipRequired !== false;
    const deepLink = info.deepLink || "";

    activeWalletManualIntent = {
        intentId,
        reference,
        expiresAt: data.expiresAt || "",
        amount: info.amount,
        currency: info.currency,
        method: appName
    };

    window.PaymentCheckoutSheet.show({
        methodCode: data.method?.key || info.method?.key || data.paymentMethod || "",
        methodName: appName,
        amount: info.amount,
        currency: info.currency,
        accountName,
        accountNumber,
        reference,
        qrImageUrl: qrImage,
        instructions: "Transfer the exact amount, then upload the payment receipt.",
        requiresSlip: slipRequired,
        deepLink,
        enableSaveQr: info.enableSaveQr === true,
        enableOpenApp: info.enableOpenApp === true,
        enableChecklist: info.enableChecklist === true,
        appDisplayName: info.appDisplayName || appName,
        appStoreUrl: info.appStoreUrl || "",
        playStoreUrl: info.playStoreUrl || "",
        checklistSteps: info.checklistSteps || [],
        submitLabel: "Submit for Verification",
        loadingText: "Submitting receipt...",
        onSubmit: async ({ file, setMessage, close }) => {
            const formData = new FormData();
            formData.append("slip", file);
            formData.append("intentId", intentId);

            const res = await fetch(walletApiUrl(`/api/wallet/manual-intent/${encodeURIComponent(intentId)}/slip`), {
                method: "POST",
                headers: AZIEL.authHeaders?.() || {},
                body: formData
            });
            const result = await res.json().catch(() => ({}));

            if (!res.ok || result.success === false) {
                setMessage("error", result?.message || "Receipt submission failed. Please try again.");
                return false;
            }

            showWalletToast("Payment receipt submitted for verification.", "success");
            await loadWallet();
            close("submitted");
            resetTopupForm();
            return true;
        },
        onClose: () => {
            activeWalletManualIntent = null;
        }
    });
}

function closeWalletManualModal() {
    window.PaymentCheckoutSheet?.close?.("programmatic");
    activeWalletManualIntent = null;
}

function openWalletPaymentApp(deepLink) {
    const msgBox = document.getElementById("walletManualMsg");
    const link = String(deepLink || "").trim();

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
            showWalletToast("Copied.", "success");
        })
        .catch(() => {
            showWalletToast("Copy failed. Please copy manually.", "error");
            console.log("Copy text:", text);
        });
}

async function submitWalletSlip(intentId, file, btn, msgBox) {
    if (!intentId) {
        setWalletMsg(msgBox, "This payment session has expired. Please start the top-up again.", "error");
        return;
    }

    if (!file) {
        setWalletMsg(msgBox, "Please choose your payment receipt first.", "error");
        return;
    }

    const formData = new FormData();
    formData.append("slip", file);
    formData.append("intentId", intentId);

    try {
        if (window.AZIEL_UI?.button) {
            window.AZIEL_UI.button.setLoading(btn, { text: "Submitting..." });
        } else {
            btn.disabled = true;
            btn.innerText = "Submitting...";
        }

        const res = await fetch(walletApiUrl(`/api/wallet/manual-intent/${encodeURIComponent(intentId)}/slip`), {
            method: "POST",
            headers: AZIEL.authHeaders?.() || {},
            body: formData
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || data.success === false) {
            setWalletMsg(
                msgBox,
                data?.message || "Receipt submission failed. Please try again.",
                "error"
            );
            return;
        }

        setWalletMsg(
            msgBox,
            "Payment receipt submitted. Please wait for admin verification.",
            "success"
        );
        showWalletToast("Payment receipt submitted for verification.", "success");

        await loadWallet();

        setTimeout(() => {
            closeWalletManualModal();
            resetTopupForm();
        }, 1200);

    } catch (error) {
        console.log("Wallet slip upload error:", error);
        setWalletMsg(msgBox, "Server error", "error");
        showWalletToast("Server error", "error");
    } finally {
        if (window.AZIEL_UI?.button) {
            window.AZIEL_UI.button.reset(btn);
        } else {
            btn.disabled = false;
            btn.innerText = "Submit for Verification";
        }
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

            showWalletToast(
                wt(
                    "paymentSessionExpired",
                    "Payment session expired. Please generate a new QR."
                ),
                "warning"
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
                walletApiUrl(`/api/wallet/status/${topupId}`),
                {
                    headers: AZIEL.authHeaders?.() || {}
                }
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

    const user = getWalletUser();
    if (!user?.username) return;

    if (!window.AZIEL?.realtime) return;

    window.AZIEL.realtime.on("walletUpdated", async data => {
        const currency = data.currency || getWalletCurrency();
        const symbol = currency === "THB" ? "฿" : "Ks";
        const amount = Number(data.amount || data.balance || 0);

        if (AZIEL.applyWalletUpdate) {
            AZIEL.applyWalletUpdate(data);
        } else {
            AZIEL.wallet = {
                balance: amount,
                currency,
                symbol
            };

            window.dispatchEvent(new Event("aziel:walletChanged"));
        }

        showWalletPopup(amount, symbol);
        showSubmitSuccessModal();
        resetTopupForm();

        await loadWallet();
    });

    window.AZIEL.realtime.on("wallet:topup-updated", async () => {
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
    if (window.AZIEL_UI?.loading) {
        if (show) {
            window.AZIEL_UI.loading.show({ text: wt("creatingPayment", "Creating Payment...") });
        } else {
            window.AZIEL_UI.loading.hide();
        }
    }

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

function showWalletToast(message, type = "info") {
    const method = type === "success"
        ? "success"
        : type === "error"
            ? "error"
            : type === "warning"
                ? "warning"
                : "info";

    window.AZIEL_UI?.toast?.[method]?.(message);
}
