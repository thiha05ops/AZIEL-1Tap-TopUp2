// frontend/js/admin-app.js
// AZIEL Admin V2.5 Main Controller

document.addEventListener("DOMContentLoaded", () => {
    initAdminNavigation();
    initAdminMobileSidebar();
    initAdminSearch();
    initAdminBroadcast();
    initQuickBroadcastButtons();
});

const adminSectionTitles = {
    dashboard: {
        title: "Dashboard",
        sub: "Live control center for AZIEL 1Tap Shop."
    },
    orders: {
        title: "Orders",
        sub: "Manage user orders without leaving the admin app."
    },
    payments: {
        title: "Payments",
        sub: "Control PromptPay, SCB, KBZPay, WavePay, AYA Pay and Wallet payments."
    },
    wallet: {
        title: "Wallet Topups",
        sub: "Review and approve wallet balance requests."
    },
    users: {
        title: "Users",
        sub: "Customer accounts and activity overview."
    },
    games: {
        title: "Products",
        sub: "Manage game packages, regional prices and visibility."
    },
    suppliers: {
        title: "Suppliers",
        sub: "Manual supplier workflow, API status and supplier balance."
    },
    coupons: {
        title: "Coupons",
        sub: "Create promotions, giveaways and discount codes."
    },
    support: {
        title: "Support Tickets",
        sub: "Handle user problems, screenshots and requests."
    },
    chat: {
        title: "Live Chat",
        sub: "Realtime customer messages."
    },
    notifications: {
        title: "Notifications",
        sub: "Order, wallet, system and promotion notifications."
    },
    broadcast: {
        title: "Broadcast",
        sub: "Send announcements, promos and system messages."
    },
    analytics: {
        title: "Analytics",
        sub: "Revenue, users, games and regional performance."
    },
    settings: {
        title: "Settings",
        sub: "Admin controls and system preferences."
    },
    admins: {
        title: "Admin Accounts",
        sub: "Manage operator, support and super admin roles."
    },
    logs: {
        title: "Logs",
        sub: "Admin logs, payment logs, login logs and system events."
    }
};

function initAdminNavigation() {
    const navButtons = document.querySelectorAll(".admin-nav");
    const sections = document.querySelectorAll(".admin-section");
    const title = document.getElementById("adminPageTitle");
    const sub = document.getElementById("adminPageSub");

    navButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.section;
            openAdminSection(target);

            if (window.innerWidth <= 900) {
                document.body.classList.remove("admin-sidebar-open");
            }
        });
    });

    function setDefaultSection() {
        const firstActive = document.querySelector(".admin-nav.active");
        const section = firstActive?.dataset.section || "dashboard";
        openAdminSection(section, false);
    }

    setDefaultSection();
}

function openAdminSection(sectionName, updateHash = true) {
    if (!sectionName) return;

    const navButtons = document.querySelectorAll(".admin-nav");
    const sections = document.querySelectorAll(".admin-section");
    const title = document.getElementById("adminPageTitle");
    const sub = document.getElementById("adminPageSub");

    navButtons.forEach(item => {
        item.classList.toggle("active", item.dataset.section === sectionName);
    });

    sections.forEach(section => {
        section.classList.remove("active");
    });

    const activeSection = document.getElementById(`section-${sectionName}`);

    if (activeSection) {
        activeSection.classList.add("active");
    } else {
        showAdminToast(`Section "${sectionName}" is not ready yet.`, "error");
        return;
    }

    const pageInfo = adminSectionTitles[sectionName];

    if (pageInfo) {
        if (title) title.innerText = pageInfo.title;
        if (sub) sub.innerText = pageInfo.sub;
    }

    if (updateHash) {
        history.replaceState(null, "", `#${sectionName}`);
    }
}

function initAdminMobileSidebar() {
    const toggleBtn = document.getElementById("adminMenuToggle");
    const closeBtn = document.getElementById("adminSidebarClose");
    const overlay = document.getElementById("adminSidebarOverlay");

    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            document.body.classList.add("admin-sidebar-open");
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            document.body.classList.remove("admin-sidebar-open");
        });
    }

    if (overlay) {
        overlay.addEventListener("click", () => {
            document.body.classList.remove("admin-sidebar-open");
        });
    }
}

function initAdminSearch() {
    const searchInput = document.getElementById("adminGlobalSearch");

    if (!searchInput) return;

    searchInput.addEventListener("input", () => {
        const keyword = searchInput.value.trim().toLowerCase();

        if (!keyword) return;

        if (
            keyword.includes("order") ||
            keyword.startsWith("azl")
        ) {
            openAdminSection("orders");
            const orderInput = document.getElementById("orderSearchInput");
            if (orderInput) orderInput.value = searchInput.value;
            return;
        }

        if (
            keyword.includes("user") ||
            keyword.includes("customer")
        ) {
            openAdminSection("users");
            return;
        }

        if (
            keyword.includes("wallet") ||
            keyword.includes("topup")
        ) {
            openAdminSection("wallet");
            return;
        }

        if (
            keyword.includes("payment") ||
            keyword.includes("promptpay") ||
            keyword.includes("scb") ||
            keyword.includes("kbz") ||
            keyword.includes("wave")
        ) {
            openAdminSection("payments");
            return;
        }

        if (
            keyword.includes("support") ||
            keyword.includes("ticket")
        ) {
            openAdminSection("support");
            return;
        }

        if (
            keyword.includes("chat")
        ) {
            openAdminSection("chat");
            return;
        }
    });
}

function initAdminBroadcast() {
    const btn = document.getElementById("sendBroadcastBtn");

    if (!btn) return;

    btn.addEventListener("click", async () => {
        const type = document.getElementById("broadcastType")?.value;
        const title = document.getElementById("broadcastTitle")?.value.trim();
        const message = document.getElementById("broadcastMessage")?.value.trim();

        if (!title || !message) {
            showAdminToast("Please fill title and message.", "error");
            return;
        }

        btn.disabled = true;
        btn.innerText = "Sending...";

        try {
            const usersData = await adminFetch("/api/admin/users");

            if (!usersData?.success || !Array.isArray(usersData.users)) {
                throw new Error("Failed to load users");
            }

            const usernames = usersData.users
                .map(user => user.username)
                .filter(Boolean);

            let category = "announcements";

            if (type === "promo") category = "promotions";
            if (type === "topup_delayed") category = "orders";
            if (type === "order_completed") category = "orders";
            if (type === "system") category = "system";

            const data = await adminFetch("/api/notifications/broadcast", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    usernames,
                    title,
                    message,
                    type,
                    category
                })
            });

            if (!data?.success) {
                throw new Error(data?.message || "Broadcast failed");
            }

            showAdminToast(`Broadcast sent to ${data.count || usernames.length} users`, "success");

            document.getElementById("broadcastTitle").value = "";
            document.getElementById("broadcastMessage").value = "";

        } catch (error) {
            console.log(error);
            showAdminToast("Broadcast failed", "error");
        }

        btn.disabled = false;
        btn.innerText = "Send Broadcast";
    });
}

function initQuickBroadcastButtons() {
    const buttons = document.querySelectorAll(".quick-action");

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const text = btn.innerText.toLowerCase();

            let type = "announcement";
            let title = "Admin Announcement";

            if (text.includes("promotion")) {
                type = "promo";
                title = "Special Promotion";
            }

            if (text.includes("delay")) {
                type = "topup_delayed";
                title = "Top-up Delay Notice";
            }

            if (text.includes("completed")) {
                type = "order_completed";
                title = "Order Completed";
            }

            openAdminSection("broadcast");

            setTimeout(() => {
                const typeInput = document.getElementById("broadcastType");
                const titleInput = document.getElementById("broadcastTitle");
                const messageInput = document.getElementById("broadcastMessage");

                if (typeInput) typeInput.value = type;
                if (titleInput) titleInput.value = title;
                if (messageInput) messageInput.focus();
            }, 120);
        });
    });
}

function showAdminToast(message, type = "success") {
    const old = document.getElementById("adminToast");
    if (old) old.remove();

    const toast = document.createElement("div");
    toast.id = "adminToast";
    toast.className = `admin-toast ${type}`;
    toast.innerText = message;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("show");
    }, 80);

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 2800);
}
