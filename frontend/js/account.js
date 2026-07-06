// frontend/js/account.js - AZIEL V3 i18n Account Flow

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initButtons();
    initMobileMenu();
    initAccount();
});

let currentUser = null;
let accountRefreshTimer = null;

function t(key, fallback = "") {
    if (window.AZIEL_I18N?.t) {
        return window.AZIEL_I18N.t(key, fallback);
    }

    return fallback || key;
}

function accountApiUrl(path) {
    if (window.AZIEL?.apiUrl) {
        return window.AZIEL.apiUrl(path);
    }

    const base =
        location.port === "5500"
            ? "http://localhost:3000"
            : "";

    return `${base}${path}`;
}

async function initAccount() {
    const token = window.AZIEL?.getToken?.();

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    await ensureAZIELState();

    currentUser = window.AZIEL?.user || null;

    if (!currentUser) {
        window.location.href = "login.html";
        return;
    }

    renderAccount();
    await refreshAccountData();

    window.addEventListener("aziel:ready", async () => {
        currentUser = window.AZIEL?.user || currentUser;
        renderAccount();
        await refreshAccountData();
    });

    window.addEventListener("aziel:userChanged", async () => {
        currentUser = window.AZIEL?.user || currentUser;
        renderAccount();
        await refreshAccountData();
    });

    window.addEventListener("aziel:walletChanged", () => {
        renderWallet();
    });

    window.addEventListener("aziel:shopRegionChanged", async () => {
        await window.AZIEL?.loadWallet?.();
        renderAccount();
    });

    window.addEventListener("aziel:languageChanged", () => {
        renderAccount();
        refreshAccountData();
        window.AZIEL_I18N?.translatePage?.(document);
    });

    accountRefreshTimer = setInterval(async () => {
        await window.AZIEL?.loadWallet?.();
        await refreshAccountData();
        renderAccount();
    }, 10000);
}

window.addEventListener("beforeunload", () => {
    if (accountRefreshTimer) {
        clearInterval(accountRefreshTimer);
        accountRefreshTimer = null;
    }
});

async function refreshAccountData() {
    await loadHistory();
    await loadBellOrders();
}

async function ensureAZIELState() {
    if (!window.AZIEL) {
        console.error("AZIEL user-state.js not loaded");
        return;
    }

    if (!window.AZIEL.user) {
        await window.AZIEL.loadUser?.();
    }

    if (!window.AZIEL.wallet) {
        await window.AZIEL.loadWallet?.();
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text ?? "";
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? "";
}

function getDisplayName(user = currentUser) {
    return (
        window.AZIEL?.getDisplayName?.(user) ||
        user?.displayName ||
        user?.username ||
        t("user", "User")
    );
}

function getRegion() {
    return window.AZIEL?.getShopRegion?.() || window.AZIEL?.getRegion?.() || "MM";
}

function getCurrency() {
    return (
        window.AZIEL?.getShopCurrency?.() ||
        window.AZIEL?.getCurrency?.() ||
        (getRegion() === "TH" ? "THB" : "MMK")
    );
}

function getSymbol() {
    return (
        window.AZIEL?.getShopSymbol?.() ||
        window.AZIEL?.getSymbol?.() ||
        (getCurrency() === "THB" ? "฿" : "Ks")
    );
}

function formatDate(dateValue) {
    if (!dateValue) return "-";

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleDateString();
}

function isVerified(user = currentUser) {
    return Boolean(user?.emailVerified || user?.isEmailVerified || user?.verified);
}

function isGoogleLinked(user = currentUser) {
    return Boolean(user?.googleId || user?.googleLinked || user?.provider === "google");
}

function renderAccount() {
    currentUser = window.AZIEL?.user || currentUser;

    if (!currentUser) return;

    renderProfile();
    renderSecurity();
    renderWallet();

    window.AZIEL_I18N?.translatePage?.(document);
}

function renderProfile() {
    const user = currentUser;
    const name = getDisplayName(user);
    const region = getRegion();
    const verified = isVerified(user);

    setText("profileName", name);
    setText("avatarText", name.charAt(0).toUpperCase());
    setText("profileRegion", `${t("region", "Region")}: ${region}`);

    setValue("displayName", name);
    setValue("profileUsername", user.username || "");
    setValue("profileEmail", user.email || "");

    setValue(
        "profileRegionReadOnly",
        region === "TH"
            ? t("regionThailand", "Thailand - THB")
            : t("regionMyanmar", "Myanmar - MMK")
    );

    setValue("profileCreatedAt", formatDate(user.createdAt));

    const verifiedBadge = document.querySelector(".verified-badge");

    if (verifiedBadge) {
        verifiedBadge.innerHTML = verified
            ? `<i class="fa-solid fa-circle-check"></i> ${t("verified", "Verified")}`
            : `<i class="fa-solid fa-circle-exclamation"></i> ${t("notVerified", "Not Verified")}`;
    }
}

function renderSecurity() {
    const user = currentUser;
    const verified = isVerified(user);
    const googleLinked = isGoogleLinked(user);

    setText("securityEmailText", user?.email || "-");
    setText(
        "emailVerifiedStatus",
        verified ? t("verified", "Verified") : t("notVerified", "Not Verified")
    );

    setText(
        "googleLinkedText",
        googleLinked
            ? t("googleLinkedDesc", "Your Google account is linked to AZIEL.")
            : t("googleNotLinkedDesc", "Google account is not linked yet.")
    );

    setText(
        "googleLinkedStatus",
        googleLinked ? t("linked", "Linked") : t("notLinked", "Not Linked")
    );
}

function renderWallet() {
    const wallet = window.AZIEL?.wallet || {};
    const symbol = wallet.symbol || getSymbol();
    const balance = Number(wallet.balance || 0);

    setText("overviewWalletBalance", `${balance.toLocaleString()} ${symbol}`);
    setText("walletBalanceBig", `${balance.toLocaleString()} ${symbol}`);
}
async function saveProfile() {
    const token = window.AZIEL?.getToken?.();

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    const displayName =
        document.getElementById("displayName")?.value.trim() || "";

    if (!displayName) {
        alert(t("displayNameRequired", "Display name is required"));
        return;
    }

    try {
        const res = await fetch(accountApiUrl("/api/profile/me"), {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ displayName })
        });

        const data = await res.json();

        if (!data.success || !data.user) {
            alert(data.message || t("profileSaveFailed", "Profile save failed"));
            return;
        }

        window.AZIEL.user = data.user;
        currentUser = data.user;

        localStorage.setItem("username", data.user.username || "");
        localStorage.setItem("displayName", getDisplayName(data.user));

        window.dispatchEvent(new Event("aziel:userChanged"));

        renderAccount();

        alert(t("profileSaved", "Profile saved ✅"));
    } catch (error) {
        console.log("Save profile error:", error);
        alert(t("serverError", "Server error"));
    }
}

async function loadHistory() {
    if (!currentUser?.username) return;

    try {
        const res = await fetch(
            accountApiUrl(`/api/history/${encodeURIComponent(currentUser.username)}`)
        );

        const data = await res.json();

        if (!data.success || !Array.isArray(data.orders)) {
            renderEmpty();
            return;
        }

        renderStats(data.orders);
        renderHistory(data.orders);
        renderRecent(data.orders);
    } catch (error) {
        console.log("History error:", error);
        renderEmpty();
    }
}

function renderStats(orders) {
    const completed = orders.filter(order => order.status === "completed");
    const active = orders.filter(order => order.status !== "completed");

    setText("totalOrders", orders.length);
    setText("pendingOrders", active.length);
    setText("completedOrders", completed.length);
}

function renderHistory(orders) {
    const box = document.getElementById("historyList");
    if (!box) return;

    if (!orders.length) {
        box.innerHTML = `
            <div class="empty-orders">
                <i class="fa-regular fa-folder-open"></i>

                <h3>${t("noOrdersYet", "No Orders Yet")}</h3>

                <p>${t("ordersAppearHere", "Your recent top-up orders will appear here.")}</p>

                <a href="home.html">
                    ${t("startTopUp", "Start Top Up")}
                </a>
            </div>
        `;
        return;
    }

    box.innerHTML = orders.map(orderCard).join("");
}

function renderRecent(orders) {
    const box = document.getElementById("recentOrders");
    if (!box) return;

    if (!orders.length) {
        box.innerHTML = `<p>${t("noRecentOrders", "No recent orders.")}</p>`;
        return;
    }

    box.innerHTML = orders.slice(0, 3).map(order => `
        <div class="recent-order-item"
             onclick="window.location.href='tracking.html?orderId=${escapeHTML(order.orderId)}'">

            <div>
                <strong>${escapeHTML(order.game || t("game", "Game"))}</strong>
                <small>${escapeHTML(order.packageName || t("package", "Package"))}</small>
            </div>

            <span class="${statusClass(order.status)}">
                ${escapeHTML(formatAccountStatus(order.status))}
            </span>
        </div>
    `).join("");
}

function orderCard(order) {
    const status = order.status || "pending";
    const orderId = order.orderId || "";

    return `
        <div class="order-card">
            <div class="order-top">
                <h3>#${escapeHTML(orderId)}</h3>

                <span class="status ${statusClass(status)}">
                    ${escapeHTML(formatAccountStatus(status))}
                </span>
            </div>

            <div class="order-game">
                ${escapeHTML(order.game || t("game", "Game"))}
            </div>

            <div class="order-package">
                ${escapeHTML(order.packageName || t("package", "Package"))}
            </div>

            <div class="order-bottom">
                <strong>
                    ${Number(order.amount || 0).toLocaleString()}
                    ${escapeHTML(order.currency || getCurrency())}
                </strong>

                <a href="tracking.html?orderId=${encodeURIComponent(orderId)}">
                    ${t("trackOrder", "Track Order")}
                </a>
            </div>
        </div>
    `;
}

function renderEmpty() {
    setText("totalOrders", "0");
    setText("pendingOrders", "0");
    setText("completedOrders", "0");

    const history = document.getElementById("historyList");
    const recent = document.getElementById("recentOrders");

    if (history) {
        history.innerHTML = `<p>${t("noOrdersYet", "No orders yet.")}</p>`;
    }

    if (recent) {
        recent.innerHTML = `<p>${t("noRecentOrders", "No recent orders.")}</p>`;
    }
}

async function loadBellOrders() {
    if (!currentUser?.username) return;

    const panel = document.getElementById("notiPanel");
    const count = document.getElementById("notiCount");

    if (!panel || !count) return;

    try {
        const res = await fetch(
            accountApiUrl(`/api/history/${encodeURIComponent(currentUser.username)}`)
        );

        const data = await res.json();

        if (!data.success || !Array.isArray(data.orders) || !data.orders.length) {
            count.innerText = "0";
            panel.innerHTML = `
                <div class="noti-item">
                    ${t("noOrderNotifications", "No order notifications")}
                </div>
            `;
            return;
        }

        const activeOrders = data.orders.filter(order => order.status !== "completed");

        count.innerText = activeOrders.length;

        panel.innerHTML = data.orders.slice(0, 8).map(order => `
            <div class="noti-item"
                 onclick="window.location.href='tracking.html?orderId=${escapeHTML(order.orderId)}'">

                🔔 <b>${escapeHTML(order.game || t("game", "Game"))}</b><br>

                ${escapeHTML(order.packageName || t("package", "Package"))}<br>

                <small>${escapeHTML(order.orderId || "")}</small><br>

                <span class="${statusClass(order.status)}">
                    ${escapeHTML(formatAccountStatus(order.status))}
                </span>
            </div>
        `).join("");
    } catch (error) {
        console.log("Bell order error:", error);
        panel.innerHTML = `
            <div class="noti-item">
                ${t("serverError", "Server error")}
            </div>
        `;
    }
}

function formatAccountStatus(status) {
    const value = String(status || "pending").toLowerCase();

    const map = {
        pending: t("statusPending", "Pending"),
        pending_payment: t("statusPending", "Pending"),
        paid: t("statusPaid", "Paid"),
        processing: t("statusProcessing", "Processing"),
        completed: t("statusCompleted", "Completed"),
        cancelled: t("statusCancelled", "Cancelled"),
        canceled: t("statusCancelled", "Cancelled"),
        failed: t("statusFailed", "Failed"),
        refund_requested: t("statusRefundRequested", "Refund Requested"),
        refund_pending: t("statusRefundRequested", "Refund Requested"),
        refund_rejected: t("statusRefundRejected", "Refund Rejected"),
        refunded: t("statusRefunded", "Refunded")
    };

    return map[value] || value;
}

function statusClass(status) {
    const normalized = String(status || "").toLowerCase();

    if (normalized === "paid") return "status-paid";
    if (normalized === "processing") return "status-processing";
    if (normalized === "completed") return "status-completed";
    if (
        normalized === "cancelled" ||
        normalized === "canceled" ||
        normalized === "failed"
    ) {
        return "status-failed";
    }

    if (
        normalized === "refund_requested" ||
        normalized === "refund_pending"
    ) {
        return "status-processing";
    }

    if (normalized === "refunded") return "status-completed";
    if (normalized === "refund_rejected") return "status-failed";

    return "status-pending";
}

function showAccountTab(tabName) {
    if (!tabName) return;

    const panel = document.getElementById(tabName);
    if (!panel) return;

    document.querySelectorAll(".side-link[data-tab]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tabName);
    });

    document.querySelectorAll(".tab-panel").forEach(item => {
        item.classList.toggle("active", item.id === tabName);
    });

    document.querySelector(".az-profile-dropdown")?.classList.remove("show");

    if (tabName === "history") {
        loadHistory();
    }

    if (tabName === "overview") {
        renderAccount();
        loadHistory();
    }

    window.AZIEL_I18N?.translatePage?.(document);
}

function initTabs() {
    document.querySelectorAll(".side-link[data-tab]").forEach(btn => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset.tab;
            showAccountTab(tab);
            history.replaceState(null, "", `#${tab}`);
        });
    });

    function openHashTab() {
        const tab = location.hash.replace("#", "") || "overview";
        showAccountTab(tab);
    }

    openHashTab();

    window.addEventListener("hashchange", openHashTab);
}

function initButtons() {
    document
        .getElementById("saveProfileBtn")
        ?.addEventListener("click", saveProfile);

    document
        .getElementById("goWalletTopupBtn")
        ?.addEventListener("click", () => {
            window.location.href = "wallet.html";
        });

    document
        .getElementById("goWalletHistoryBtn")
        ?.addEventListener("click", () => {
            window.location.href = "wallet.html#history";
        });
}

function initMobileMenu() {
    const btn = document.getElementById("accountMenuBtn");
    const sidebar = document.querySelector(".account-sidebar");
    const overlay = document.getElementById("accountDrawerOverlay");

    btn?.addEventListener("click", () => {
        sidebar?.classList.add("show");
        overlay?.classList.add("show");
    });

    overlay?.addEventListener("click", () => {
        sidebar?.classList.remove("show");
        overlay?.classList.remove("show");
    });
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}