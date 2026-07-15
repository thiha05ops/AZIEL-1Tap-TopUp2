// frontend/js/admin-app.js
// AZIEL Admin V2.5 Main Controller

document.addEventListener("DOMContentLoaded", () => {
    initAdminLayoutController();
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
    fulfillment: {
        titleKey: "fulfillment",
        subKey: "fulfillment_sub"
    },
    catalog: {
        titleKey: "catalog",
        subKey: "catalog_sub"
    },
    promos: {
        titleKey: "promo_codes",
        subKey: "promo_codes_sub"
    },
    media: {
        titleKey: "media_library",
        subKey: "media_library_sub"
    },
    "site-content": {
        titleKey: "site_content",
        subKey: "site_content_sub"
    },
    campaigns: {
        titleKey: "campaigns",
        subKey: "campaigns_sub"
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
    "admin-security": {
        titleKey: "admin_team",
        subKey: "admin_team_sub"
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
                window.AZIEL_ADMIN_LAYOUT?.closeDrawer?.();
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

    document.body.dataset.adminSection = sectionName;
    document.body.classList.toggle("admin-orders-active", sectionName === "orders");

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

    window.AZIEL_ADMIN_LAYOUT?.showList?.("orders");
    window.AZIEL_ADMIN_LAYOUT?.showList?.("wallet");
    window.AZIEL_ADMIN_LAYOUT?.showList?.("catalog");
    window.AZIEL_ADMIN_LAYOUT?.showList?.("fulfillment");

    window.dispatchEvent(new CustomEvent("aziel:admin-section-opened", {
        detail: {
            section: sectionName,
            context
        }
    }));
}

function initAdminLayoutController() {
    const mediaQuery = window.matchMedia("(max-width: 768px)");

    function isMobile() {
        return mediaQuery.matches;
    }

    function setDetailMode(sectionName, mode) {
        const section = document.getElementById(`section-${sectionName}`);
        if (!section) return;
        section.classList.toggle("admin-mobile-detail-open", mode === "detail");
        section.classList.toggle("admin-mobile-list-open", mode !== "detail");
    }

    function showDetail(sectionName) {
        if (!isMobile()) return;
        setDetailMode(sectionName, "detail");
    }

    function showList(sectionName) {
        setDetailMode(sectionName, "list");
    }

    function closeDrawer() {
        document.body.classList.remove("admin-sidebar-open");
        document.body.classList.remove("admin-drawer-lock");
        document.getElementById("adminMenuToggle")?.setAttribute("aria-expanded", "false");
    }

    function openDrawer() {
        document.body.classList.add("admin-sidebar-open", "admin-drawer-lock");
        document.getElementById("adminMenuToggle")?.setAttribute("aria-expanded", "true");
    }

    mediaQuery.addEventListener?.("change", event => {
        document.body.classList.toggle("admin-is-mobile", event.matches);
        if (!event.matches) {
            closeDrawer();
            ["orders", "wallet", "catalog", "fulfillment"].forEach(showList);
        }
        window.dispatchEvent(new CustomEvent("aziel:admin-layout-change", {
            detail: { mobile: event.matches }
        }));
    });

    document.body.classList.toggle("admin-is-mobile", isMobile());

    window.AZIEL_ADMIN_LAYOUT = {
        isMobile,
        openDrawer,
        closeDrawer,
        showDetail,
        showList
    };
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
    document.getElementById("adminMobileLogoutBtn")?.addEventListener("click", () => {
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
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.addEventListener("click", () => {
            window.AZIEL_ADMIN_LAYOUT?.openDrawer?.();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            window.AZIEL_ADMIN_LAYOUT?.closeDrawer?.();
        });
    }

    if (overlay) {
        overlay.addEventListener("click", () => {
            window.AZIEL_ADMIN_LAYOUT?.closeDrawer?.();
        });
    }

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            window.AZIEL_ADMIN_LAYOUT?.closeDrawer?.();
        }
    });
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
            keyword.includes("banner") ||
            keyword.includes("home") ||
            keyword.includes("content") ||
            keyword.includes("campaign") ||
            keyword.includes("popup") ||
            keyword.includes("promotion") ||
            keyword.includes("package") ||
            keyword.includes("game")
        ) {
            if (keyword.includes("campaign") || keyword.includes("popup") || keyword.includes("promotion")) {
                openAdminSection("campaigns");
                return;
            }

            if (keyword.includes("home") || keyword.includes("content") || keyword.includes("banner")) {
                openAdminSection("site-content");
                return;
            }

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
