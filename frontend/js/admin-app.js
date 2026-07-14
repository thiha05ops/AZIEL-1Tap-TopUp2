// frontend/js/admin-app.js
// AZIEL Admin V2.5 Main Controller

document.addEventListener("DOMContentLoaded", () => {
    initAdminNavigation();
    initAdminMobileSidebar();
    initAdminSearch();
    initAdminBroadcast();
    initQuickBroadcastButtons();
    initAdminLogout();
    initAdminLocaleRefresh();
});

const adminSectionTitles = {
    dashboard: {
        titleKey: "dashboard",
        subKey: "dashboard_sub"
    },
    orders: {
        titleKey: "orders",
        subKey: "orders_sub"
    },
    payments: {
        titleKey: "payment_methods",
        subKey: "payment_methods_sub"
    },
    wallet: {
        titleKey: "wallet",
        subKey: "wallet_sub"
    },
    catalog: {
        titleKey: "catalog",
        subKey: "catalog_sub"
    },
    media: {
        titleKey: "media_library",
        subKey: "media_library_sub"
    },
    users: {
        titleKey: "users",
        subKey: "users_sub"
    },
    support: {
        titleKey: "support",
        subKey: "support_sub"
    },
    chat: {
        titleKey: "live_chat",
        subKey: "live_chat_sub"
    },
    broadcast: {
        titleKey: "broadcast",
        subKey: "broadcast_sub"
    },
    settings: {
        titleKey: "site_settings",
        subKey: "settings_sub"
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
        const hashTarget = parseAdminHash();

        const firstActive = document.querySelector(".admin-nav.active");
        const section = document.getElementById(`section-${hashTarget.section}`)
            ? hashTarget.section
            : firstActive?.dataset.section || "dashboard";
        openAdminSection(section, false, hashTarget.params);
    }

    setDefaultSection();
}

function parseAdminHash() {
    const raw = window.location.hash ? window.location.hash.slice(1) : "";
    const [section = "", query = ""] = raw.split("?");
    const params = Object.fromEntries(new URLSearchParams(query));

    return {
        section,
        params
    };
}

function buildAdminHash(sectionName, params = {}) {
    const query = new URLSearchParams();

    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            query.set(key, value);
        }
    });

    const suffix = query.toString();
    return suffix ? `#${sectionName}?${suffix}` : `#${sectionName}`;
}

function openAdminSection(sectionName, updateHash = true, context = {}) {
    if (!sectionName) return;
    if (!adminSectionTitles[sectionName]) {
        sectionName = "dashboard";
        updateHash = false;
        context = {};
    }

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
        window.AZIEL_MOTION?.enter(activeSection, "fast");
    } else {
        showAdminToast(`Section "${sectionName}" is not ready yet.`, "error");
        return;
    }

    const pageInfo = adminSectionTitles[sectionName];

    if (pageInfo) {
        if (title) {
            title.dataset.adminI18n = pageInfo.titleKey;
            title.innerText = adminT(pageInfo.titleKey);
        }
        if (sub) {
            sub.dataset.adminI18n = pageInfo.subKey;
            sub.innerText = adminT(pageInfo.subKey);
        }
    }

    if (updateHash) {
        history.replaceState(null, "", buildAdminHash(sectionName, context));
    }

    window.dispatchEvent(new CustomEvent("aziel:admin-section-opened", {
        detail: {
            section: sectionName,
            context
        }
    }));
}

function adminT(key, fallback = "") {
    return window.AZIEL_ADMIN_I18N?.t?.(key, fallback) || fallback || key;
}

function initAdminLogout() {
    document.getElementById("adminLogoutBtn")?.addEventListener("click", () => {
        if (typeof adminLogout === "function") {
            adminLogout();
        }
    });
}

function initAdminLocaleRefresh() {
    window.addEventListener("aziel:admin-locale-changed", () => {
        const activeSection = document.querySelector(".admin-section.active");
        const sectionName = activeSection?.id?.replace("section-", "") || "dashboard";
        const pageInfo = adminSectionTitles[sectionName] || adminSectionTitles.dashboard;
        const title = document.getElementById("adminPageTitle");
        const sub = document.getElementById("adminPageSub");

        if (title) title.innerText = adminT(pageInfo.titleKey);
        if (sub) sub.innerText = adminT(pageInfo.subKey);
    });
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
            keyword.includes("catalog") ||
            keyword.includes("media") ||
            keyword.includes("asset") ||
            keyword.includes("image") ||
            keyword.includes("package") ||
            keyword.includes("game")
        ) {
            openAdminSection(keyword.includes("media") || keyword.includes("asset") || keyword.includes("image") ? "media" : "catalog");
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

        if (window.AZIEL_UI?.button) {
            window.AZIEL_UI.button.setLoading(btn, { text: "Sending..." });
        } else {
            btn.disabled = true;
            btn.innerText = "Sending...";
        }

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

        if (window.AZIEL_UI?.button) {
            window.AZIEL_UI.button.reset(btn);
        } else {
            btn.disabled = false;
            btn.innerText = "Send Broadcast";
        }
    });
}

function initQuickBroadcastButtons() {
    const buttons = document.querySelectorAll(".quick-action");

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const type = btn.dataset.broadcastType || "announcement";
            const title = btn.dataset.broadcastTitle || "Admin Announcement";

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
    if (window.AZIEL_UI?.toast) {
        const method = type === "error"
            ? "error"
            : type === "warning"
                ? "warning"
                : type === "info"
                    ? "info"
                    : "success";

        window.AZIEL_UI.toast[method](message);
        return;
    }

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

window.openAdminSection = openAdminSection;
