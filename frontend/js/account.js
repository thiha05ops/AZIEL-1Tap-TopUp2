// frontend/js/account.js

document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username") || "guest";

    const savedRegion =
        localStorage.getItem("region") ||
        localStorage.getItem("selectedRegion") ||
        "MM";

    const savedCurrency =
        savedRegion === "TH" ? "THB" : "MMK";

    const displayName =
        localStorage.getItem("displayName") || username;

    localStorage.setItem("region", savedRegion);
    localStorage.setItem("selectedRegion", savedRegion);
    localStorage.setItem("currency", savedCurrency);
    localStorage.setItem("selectedCurrency", savedCurrency);

    setText("profileName", displayName);
    setText("avatarText", displayName.charAt(0).toUpperCase());
    setText("profileRegion", "Region: " + savedRegion);

    const displayNameInput = document.getElementById("displayName");
    const accountRegion = document.getElementById("accountRegion");

    if (displayNameInput) displayNameInput.value = displayName;
    if (accountRegion) accountRegion.value = savedRegion;

    document.querySelectorAll(".side-link").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".side-link").forEach(b =>
                b.classList.remove("active")
            );

            document.querySelectorAll(".tab-panel").forEach(p =>
                p.classList.remove("active")
            );

            btn.classList.add("active");
            document.getElementById(btn.dataset.tab)?.classList.add("active");

            if (btn.dataset.tab === "history") loadHistory();
            if (btn.dataset.tab === "overview") {
                loadHistory();
                loadAccountWalletBalance();
            }

            if (btn.dataset.tab === "wallet" && window.loadWallet) {
                window.loadWallet();
            }
        });
    });

    document.getElementById("saveProfileBtn")?.addEventListener("click", () => {
        const newName =
            document.getElementById("displayName")?.value.trim() || username;

        const newRegion =
            document.getElementById("accountRegion")?.value || "MM";

        const newCurrency =
            newRegion === "TH" ? "THB" : "MMK";

        localStorage.setItem("displayName", newName);
        localStorage.setItem("region", newRegion);
        localStorage.setItem("selectedRegion", newRegion);
        localStorage.setItem("currency", newCurrency);
        localStorage.setItem("selectedCurrency", newCurrency);

        setText("profileName", newName);
        setText("avatarText", newName.charAt(0).toUpperCase());
        setText("profileRegion", "Region: " + newRegion);

        loadAccountWalletBalance();

        if (window.loadWallet) {
            window.loadWallet();
        }

        alert("Profile saved ✅");
    });

    document.getElementById("notiBtn")?.addEventListener("click", () => {
        const panel = document.getElementById("notiPanel");
        if (!panel) return;

        panel.style.display =
            panel.style.display === "block" ? "none" : "block";

        loadBellOrders();
    });

    initMobileMenu();

    loadHistory();
    loadBellOrders();
    loadAccountWalletBalance();

    setInterval(() => {
        loadHistory();
        loadBellOrders();
        loadAccountWalletBalance();
    }, 8000);
});

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

async function loadAccountWalletBalance() {
    const username = localStorage.getItem("username") || "guest";

    const region =
        localStorage.getItem("region") ||
        localStorage.getItem("selectedRegion") ||
        "MM";

    const currency = region === "TH" ? "THB" : "MMK";
    const symbol = currency === "THB" ? "฿" : "Ks";

    try {
        const res = await fetch(
            `/api/wallet/${username}?currency=${currency}`
        );

        const data = await res.json();

        const balance = data.success
            ? Number(data.balance || 0)
            : 0;

        setText(
            "overviewWalletBalance",
            `${balance.toLocaleString()} ${symbol}`
        );

    } catch (error) {
        console.log("Account wallet error:", error);

        const fallback = Number(
            localStorage.getItem(`walletBalance_${currency}`) || 0
        );

        setText(
            "overviewWalletBalance",
            `${fallback.toLocaleString()} ${symbol}`
        );
    }
}

async function loadHistory() {
    const username = localStorage.getItem("username") || "guest";

    try {
        const res = await fetch(`/api/history/${username}`);
        const data = await res.json();

        if (!data.success || !data.orders) {
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
    setText("totalOrders", orders.length);

    const active = orders.filter(o => o.status !== "completed");
    const completed = orders.filter(o => o.status === "completed");

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

    <p>
        Your recent top-up orders will appear here.
    </p>

    <a href="shop.html">
        Start Top Up
    </a>
</div>
`;
        return;
    }

    box.innerHTML = orders.map(order => orderCard(order)).join("");
}

function orderCard(order) {

    const statusClass =
        (order.status || "pending").toLowerCase();

    return `
    <div class="order-card">

        <div class="order-top">
            <h3>#${order.orderId}</h3>

            <span class="status ${statusClass}">
                ${order.status || "Pending"}
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
                ${order.amount || 0}
                ${order.currency || "Ks"}
            </strong>

            <a href="tracking.html?orderId=${order.orderId}">
                Track
            </a>
        </div>

    </div>
    `;
}


async function loadBellOrders() {
    const username = localStorage.getItem("username") || "guest";
    const panel = document.getElementById("notiPanel");
    const count = document.getElementById("notiCount");

    if (!panel || !count) return;

    try {
        const res = await fetch(`/api/history/${username}`);
        const data = await res.json();

        if (!data.success || !data.orders || !data.orders.length) {
            count.innerText = "0";
            panel.innerHTML = `<div class="noti-item">No order notifications</div>`;
            return;
        }

        const activeOrders = data.orders.filter(o => o.status !== "completed");
        count.innerText = activeOrders.length;

        panel.innerHTML = data.orders.slice(0, 8).map(order => `
            <div class="noti-item" onclick="window.location.href='tracking.html?orderId=${order.orderId}'">
                🔔 <b>${order.game}</b><br>
                ${order.packageName}<br>
                <small>${order.orderId}</small><br>
                <span class="${statusClass(order.status)}">${order.status}</span>
            </div>
        `).join("");

    } catch (error) {
        panel.innerHTML = `<div class="noti-item">Server error</div>`;
    }
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

function statusClass(status) {
    if (status === "paid") return "status-paid";
    if (status === "processing") return "status-processing";
    if (status === "completed") return "status-completed";
    if (status === "cancelled" || status === "failed") return "status-failed";
    return "status-pending";
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