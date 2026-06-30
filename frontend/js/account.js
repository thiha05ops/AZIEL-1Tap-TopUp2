// frontend/js/account.js - AZIEL V2.5 Production Account Flow

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initButtons();
    initMobileMenu();
    initAccount();
});

let currentUser = null;
let accountRefreshTimer = null;

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

// ============================
// INIT
// ============================

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

// ============================
// GLOBAL STATE
// ============================

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

// ============================
// HELPERS
// ============================

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
        "User"
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

    return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function isVerified(user = currentUser) {
    return Boolean(user?.emailVerified || user?.isEmailVerified || user?.verified);
}

function isGoogleLinked(user = currentUser) {
    return Boolean(user?.googleId || user?.googleLinked || user?.provider === "google");
}

// ============================
// RENDER
// ============================

function renderAccount() {
    currentUser = window.AZIEL?.user || currentUser;

    if (!currentUser) return;

    renderProfile();
    renderSecurity();
    renderWallet();
}

function renderProfile() {
    const user = currentUser;
    const name = getDisplayName(user);
    const region = getRegion();
    const verified = isVerified(user);

    setText("profileName", name);
    setText("avatarText", name.charAt(0).toUpperCase());
    setText("profileRegion", `Region: ${region}`);

    setValue("displayName", name);
    setValue("profileUsername", user.username || "");
    setValue("profileEmail", user.email || "");
    setValue(
        "profileRegionReadOnly",
        region === "TH" ? "Thailand - THB" : "Myanmar - MMK"
    );
    setValue("profileCreatedAt", formatDate(user.createdAt));

    const verifiedBadge = document.querySelector(".verified-badge");

    if (verifiedBadge) {
        verifiedBadge.innerHTML = verified
            ? `<i class="fa-solid fa-circle-check"></i> Verified`
            : `<i class="fa-solid fa-circle-exclamation"></i> Not Verified`;
    }
}

function renderSecurity() {
    const user = currentUser;
    const verified = isVerified(user);
    const googleLinked = isGoogleLinked(user);

    setText("securityEmailText", user?.email || "-");
    setText("emailVerifiedStatus", verified ? "Verified" : "Not Verified");

    setText(
        "googleLinkedText",
        googleLinked
            ? "Your Google account is linked to AZIEL."
            : "Google account is not linked yet."
    );

    setText("googleLinkedStatus", googleLinked ? "Linked" : "Not Linked");
}

function renderWallet() {
    const wallet = window.AZIEL?.wallet || {};
    const symbol = wallet.symbol || getSymbol();
    const balance = Number(wallet.balance || 0);

    setText("overviewWalletBalance", `${balance.toLocaleString()} ${symbol}`);
    setText("walletBalanceBig", `${balance.toLocaleString()} ${symbol}`);
}

// ============================
// SAVE PROFILE
// ============================

async function saveProfile() {
    const token = window.AZIEL?.getToken?.();

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    const displayName =
        document.getElementById("displayName")?.value.trim() || "";

    if (!displayName) {
        alert("Display name is required");
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
            alert(data.message || "Profile save failed");
            return;
        }

        window.AZIEL.user = data.user;
        currentUser = data.user;

        localStorage.setItem("username", data.user.username || "");
        localStorage.setItem("displayName", getDisplayName(data.user));

        window.dispatchEvent(new Event("aziel:userChanged"));

        renderAccount();

        alert("Profile saved ✅");
    } catch (error) {
        console.log("Save profile error:", error);
        alert("Server error");
    }
}

// ============================
// HISTORY / ORDERS
// ============================

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
                <h3>No Orders Yet</h3>
                <p>Your recent top-up orders will appear here.</p>
                <a href="home.html">Start Top Up</a>
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
        box.innerHTML = `<p>No recent orders.</p>`;
        return;
    }

    box.innerHTML = orders.slice(0, 3).map(order => `
        <div class="recent-order-item"
             onclick="window.location.href='tracking.html?orderId=${escapeHTML(order.orderId)}'">
            <div>
                <strong>${escapeHTML(order.game || "Game")}</strong>
                <small>${escapeHTML(order.packageName || "Package")}</small>
            </div>

            <span class="${statusClass(order.status)}">
                ${escapeHTML(order.status || "pending")}
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
                    ${escapeHTML(status)}
                </span>
            </div>

            <div class="order-game">
                ${escapeHTML(order.game || "Game")}
            </div>

            <div class="order-package">
                ${escapeHTML(order.packageName || "Package")}
            </div>

            <div class="order-bottom">
                <strong>
                    ${Number(order.amount || 0).toLocaleString()}
                    ${escapeHTML(order.currency || getCurrency())}
                </strong>

                <a href="tracking.html?orderId=${encodeURIComponent(orderId)}">
                    Track
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

    if (history) history.innerHTML = `<p>No orders yet.</p>`;
    if (recent) recent.innerHTML = `<p>No recent orders.</p>`;
}

// ============================
// NOTIFICATIONS
// ============================

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
            panel.innerHTML = `<div class="noti-item">No order notifications</div>`;
            return;
        }

        const activeOrders = data.orders.filter(order => order.status !== "completed");

        count.innerText = activeOrders.length;

        panel.innerHTML = data.orders.slice(0, 8).map(order => `
            <div class="noti-item"
                 onclick="window.location.href='tracking.html?orderId=${escapeHTML(order.orderId)}'">
                🔔 <b>${escapeHTML(order.game || "Game")}</b><br>
                ${escapeHTML(order.packageName || "Package")}<br>
                <small>${escapeHTML(order.orderId || "")}</small><br>
                <span class="${statusClass(order.status)}">
                    ${escapeHTML(order.status || "pending")}
                </span>
            </div>
        `).join("");
    } catch (error) {
        console.log("Bell order error:", error);
        panel.innerHTML = `<div class="noti-item">Server error</div>`;
    }
}

function statusClass(status) {
    const normalized = String(status || "").toLowerCase();

    if (normalized === "paid") return "status-paid";
    if (normalized === "processing") return "status-processing";
    if (normalized === "completed") return "status-completed";
    if (normalized === "cancelled" || normalized === "failed") return "status-failed";

    return "status-pending";
}

// ============================
// UI EVENTS
// ============================

function initTabs() {
    document.querySelectorAll(".side-link").forEach(btn => {
        btn.addEventListener("click", () => {
            if (!btn.dataset.tab) return;

            document.querySelectorAll(".side-link").forEach(button =>
                button.classList.remove("active")
            );

            document.querySelectorAll(".tab-panel").forEach(panel =>
                panel.classList.remove("active")
            );

            btn.classList.add("active");
            document.getElementById(btn.dataset.tab)?.classList.add("active");

            if (btn.dataset.tab === "history") {
                loadHistory();
            }

            if (btn.dataset.tab === "overview") {
                renderAccount();
                loadHistory();
            }
        });
    });
}

function initButtons() {
    document.getElementById("saveProfileBtn")
        ?.addEventListener("click", saveProfile);

    document.getElementById("goWalletTopupBtn")
        ?.addEventListener("click", () => {
            window.location.href = "wallet.html";
        });

    document.getElementById("goWalletHistoryBtn")
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