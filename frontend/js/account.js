// frontend/js/account.js - AZIEL V2.5 Clean Account Flow

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initButtons();
    initMobileMenu();
    initSlipPreview();
    initAccount();
});

let currentUser = null;

// ============================
// INIT
// ============================

async function initAccount() {
    const token = getToken();

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    await loadMyProfile();
    await loadAccountWalletBalance();
    await loadHistory();
    await loadBellOrders();

    setInterval(() => {
        loadAccountWalletBalance();
        loadHistory();
        loadBellOrders();
    }, 8000);
}

// ============================
// HELPERS
// ============================

function getToken() {
    return (
        localStorage.getItem("token") ||
        sessionStorage.getItem("token")
    );
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text ?? "";
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? "";
}

function getDisplayName(user) {
    return (
        user?.displayName ||
        user?.username ||
        "User"
    );
}

function getRegion(user) {
    return user?.region || "MM";
}

function getCurrency(region) {
    return region === "TH" ? "THB" : "MMK";
}

function getSymbol(currency) {
    return currency === "THB" ? "฿" : "Ks";
}

// ============================
// PROFILE
// ============================

async function loadMyProfile() {
    const token = getToken();

    try {
        const res = await fetch("/api/profile/me", {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const data = await res.json();

        if (!data.success || !data.user) {
            console.log("Profile load failed:", data.message);
            return;
        }

        currentUser = data.user;

        const name = getDisplayName(currentUser);
        const region = getRegion(currentUser);

        localStorage.setItem("username", currentUser.username || "");
        localStorage.setItem("displayName", name);
        localStorage.setItem("region", region);
        localStorage.setItem("selectedRegion", region);
        localStorage.setItem("currency", getCurrency(region));
        localStorage.setItem("selectedCurrency", getCurrency(region));

        renderProfile(currentUser);

    } catch (error) {
        console.log("Load profile error:", error);
    }
}

function renderProfile(user) {
    const name = getDisplayName(user);
    const region = getRegion(user);

    setText("profileName", name);
    setText("avatarText", name.charAt(0).toUpperCase());
    setText("profileRegion", "Region: " + region);

    setValue("displayName", name);
    setValue("profileEmail", user.email || "");
    setValue("accountRegion", region);

    setValue("telegram", user.telegram || "");
    setValue("phone", user.phone || "");
    setValue("mlbbUserId", user.mlbbUserId || "");
    setValue("mlbbServerId", user.mlbbServerId || "");
}

async function saveProfile() {
    const token = getToken();

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    const body = {
        displayName: document.getElementById("displayName")?.value.trim() || "",
        region: document.getElementById("accountRegion")?.value || "MM",
        telegram: document.getElementById("telegram")?.value.trim() || "",
        phone: document.getElementById("phone")?.value.trim() || "",
        mlbbUserId: document.getElementById("mlbbUserId")?.value.trim() || "",
        mlbbServerId: document.getElementById("mlbbServerId")?.value.trim() || ""
    };

    try {
        const res = await fetch("/api/profile/me", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.message || "Profile save failed");
            return;
        }

        currentUser = data.user;

        renderProfile(currentUser);
        await loadAccountWalletBalance();

        alert("Profile saved ✅");

    } catch (error) {
        console.log("Save profile error:", error);
        alert("Server error");
    }
}

// ============================
// WALLET
// ============================

async function loadAccountWalletBalance() {
    if (!currentUser) return;

    const username = currentUser.username;
    const region = getRegion(currentUser);
    const currency = getCurrency(region);
    const symbol = getSymbol(currency);

    try {
        const res = await fetch(
            `/api/wallet/${encodeURIComponent(username)}?currency=${currency}`
        );

        const data = await res.json();

        const balance = data.success
            ? Number(data.balance || 0)
            : 0;

        setText("overviewWalletBalance", `${balance.toLocaleString()} ${symbol}`);
        setText("walletBalanceBig", `${balance.toLocaleString()} ${symbol}`);

    } catch (error) {
        console.log("Account wallet error:", error);

        setText("overviewWalletBalance", `0 ${symbol}`);
        setText("walletBalanceBig", `0 ${symbol}`);
    }
}

// ============================
// HISTORY / ORDERS
// ============================

async function loadHistory() {
    if (!currentUser) return;

    const username = currentUser.username;

    try {
        const res = await fetch(`/api/history/${encodeURIComponent(username)}`);
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
    const completed = orders.filter(o => o.status === "completed");
    const active = orders.filter(o => o.status !== "completed");

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
             onclick="window.location.href='tracking.html?orderId=${order.orderId}'">
            <div>
                <strong>${order.game || "Game"}</strong>
                <small>${order.packageName || "Package"}</small>
            </div>

            <span class="${statusClass(order.status)}">
                ${order.status || "pending"}
            </span>
        </div>
    `).join("");
}

function orderCard(order) {
    const status = order.status || "pending";

    return `
        <div class="order-card">
            <div class="order-top">
                <h3>#${order.orderId}</h3>
                <span class="status ${status.toLowerCase()}">
                    ${status}
                </span>
            </div>

            <div class="order-game">
                ${order.game || "Game"}
            </div>

            <div class="order-package">
                ${order.packageName || "Package"}
            </div>

            <div class="order-bottom">
                <strong>
                    ${(order.amount || 0).toLocaleString?.() || order.amount || 0}
                    ${order.currency || "Ks"}
                </strong>

                <a href="tracking.html?orderId=${order.orderId}">
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
    if (!currentUser) return;

    const username = currentUser.username;
    const panel = document.getElementById("notiPanel");
    const count = document.getElementById("notiCount");

    if (!panel || !count) return;

    try {
        const res = await fetch(`/api/history/${encodeURIComponent(username)}`);
        const data = await res.json();

        if (!data.success || !Array.isArray(data.orders) || !data.orders.length) {
            count.innerText = "0";
            panel.innerHTML = `<div class="noti-item">No order notifications</div>`;
            return;
        }

        const activeOrders = data.orders.filter(o => o.status !== "completed");

        count.innerText = activeOrders.length;

        panel.innerHTML = data.orders.slice(0, 8).map(order => `
            <div class="noti-item"
                 onclick="window.location.href='tracking.html?orderId=${order.orderId}'">
                🔔 <b>${order.game || "Game"}</b><br>
                ${order.packageName || "Package"}<br>
                <small>${order.orderId}</small><br>
                <span class="${statusClass(order.status)}">
                    ${order.status || "pending"}
                </span>
            </div>
        `).join("");

    } catch (error) {
        console.log("Bell order error:", error);
        panel.innerHTML = `<div class="noti-item">Server error</div>`;
    }
}

function statusClass(status) {
    if (status === "paid") return "status-paid";
    if (status === "processing") return "status-processing";
    if (status === "completed") return "status-completed";
    if (status === "cancelled" || status === "failed") return "status-failed";
    return "status-pending";
}

// ============================
// UI EVENTS
// ============================

function initTabs() {
    document.querySelectorAll(".side-link").forEach(btn => {
        btn.addEventListener("click", () => {
            if (!btn.dataset.tab) return;

            document.querySelectorAll(".side-link").forEach(b =>
                b.classList.remove("active")
            );

            document.querySelectorAll(".tab-panel").forEach(p =>
                p.classList.remove("active")
            );

            btn.classList.add("active");
            document.getElementById(btn.dataset.tab)?.classList.add("active");

            if (btn.dataset.tab === "history") {
                loadHistory();
            }

            if (btn.dataset.tab === "overview") {
                loadHistory();
                loadAccountWalletBalance();
                loadMyProfile();
            }
        });
    });
}

function initButtons() {
    document.getElementById("goWalletTopupBtn")
        ?.addEventListener("click", () => {
            window.location.href = "wallet.html";
        });

    document.getElementById("goWalletHistoryBtn")
        ?.addEventListener("click", () => {
            window.location.href = "wallet.html#history";
        });

    document.getElementById("saveProfileBtn")
        ?.addEventListener("click", saveProfile);
}

function initMobileMenu() {
    const mobileMenuBtn = document.getElementById("mobileMenuBtn");
    const sidebar = document.querySelector(".account-sidebar");
    const sidebarOverlay = document.getElementById("sidebarOverlay");

    mobileMenuBtn?.addEventListener("click", () => {
        sidebar?.classList.toggle("show");
        sidebarOverlay?.classList.toggle("show");
    });

    sidebarOverlay?.addEventListener("click", () => {
        sidebar?.classList.remove("show");
        sidebarOverlay?.classList.remove("show");
    });
}

function initSlipPreview() {
    document.getElementById("topupSlip")
        ?.addEventListener("change", e => {
            const file = e.target.files[0];
            const nameBox = document.getElementById("slipFileName");

            if (nameBox) {
                nameBox.innerText = file ? file.name : "No file selected";
            }
        });
}