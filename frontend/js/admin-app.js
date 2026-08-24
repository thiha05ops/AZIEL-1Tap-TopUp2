// frontend/js/admin-app.js
// AZIEL OS V2.5 Main Controller

document.addEventListener("DOMContentLoaded", () => {
    initAdminLayoutController();
    initAdminSidebarState();
    initAdminNavigation();
    initAdminMobileShell();
    initAdminMobileSidebar();
    initAdminNavSearch();
    initAdminSearch();
    initAdminTopbarActions();
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
    website: {
        titleKey: "website",
        subKey: "website_sub"
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
    "pricing-engine": {
        titleKey: "pricing",
        subKey: "pricing_engine_sub"
    },
    "pricing-settings": {
        title: "Pricing Settings",
        subtitle: "Owner-controlled pricing policy and operating thresholds."
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

const ADMIN_SIDEBAR_COLLAPSED_KEY = "aziel_admin_sidebar_collapsed";

function initAdminNavigation() {
    const navButtons = document.querySelectorAll(".admin-nav");

    hydrateAdminNavMetadata();

    navButtons.forEach(btn => {
        if (!btn.dataset.section) return;

        btn.addEventListener("click", () => {
            const target = btn.dataset.section;
            openAdminSection(target);

            if (window.innerWidth < 1024) {
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

function initAdminTopbarActions() {
    document.getElementById("adminNotificationsBtn")?.addEventListener("click", () => {
        window.open("/notifications.html", "_blank", "noopener,noreferrer");
    });
    document.getElementById("adminProfileBtn")?.addEventListener("click", () => {
        openAdminSection("admin-security");
    });
}

function hydrateAdminNavMetadata() {
    document.querySelectorAll(".admin-nav").forEach(item => {
        const label = item.querySelector("span")?.textContent?.trim() || item.textContent?.trim() || "";
        if (label) {
            item.dataset.navLabel = label;
            if (!item.getAttribute("aria-label")) item.setAttribute("aria-label", label);
            if (!item.getAttribute("title")) item.setAttribute("title", label);
        }
    });
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
        const isActive = item.dataset.section === sectionName;
        item.classList.toggle("active", isActive);
        if (isActive) {
            item.setAttribute("aria-current", "page");
        } else {
            item.removeAttribute("aria-current");
        }
    });
    syncAdminMobileNavigation(sectionName);

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
            if (pageInfo.titleKey) title.dataset.adminI18n = pageInfo.titleKey;
            else title.removeAttribute("data-admin-i18n");
            title.innerText = pageInfo.title || (pageInfo.titleKey === "pricing"
                ? adminT(pageInfo.titleKey, "Pricing")
                : adminT(pageInfo.titleKey));
        }
        if (sub) {
            if (pageInfo.subKey) sub.dataset.adminI18n = pageInfo.subKey;
            else sub.removeAttribute("data-admin-i18n");
            sub.innerText = pageInfo.subtitle || adminT(pageInfo.subKey);
        }
        updateAdminSectionPill(sectionName);
        const titleText = title?.innerText?.trim() || "Dashboard";
        document.title = `${titleText} · AZIEL OS`;
    }

    if (updateHash) {
        history.replaceState(null, "", buildAdminHash(sectionName, context));
    }

    window.AZIEL_ADMIN_LAYOUT?.showList?.("orders");
    window.AZIEL_ADMIN_LAYOUT?.showList?.("wallet");
    window.AZIEL_ADMIN_LAYOUT?.showList?.("catalog");
    window.AZIEL_ADMIN_LAYOUT?.showList?.("fulfillment");
    window.AZIEL_ADMIN_LAYOUT?.showList?.("users");

    window.dispatchEvent(new CustomEvent("aziel:admin-section-opened", {
        detail: {
            section: sectionName,
            context
        }
    }));
}

function updateAdminSectionPill(sectionName) {
    const pill = document.getElementById("adminSectionPill");
    const activeNav = Array.from(document.querySelectorAll(".admin-nav"))
        .find(item => item.dataset.section === sectionName);
    const group = activeNav?.closest(".admin-nav-group");
    const label = group?.querySelector(".admin-nav-label");
    if (!pill || !label) return;

    const key = label.dataset.adminI18n;
    if (key) {
        pill.dataset.adminI18n = key;
        pill.textContent = adminT(key, label.textContent || "");
    } else {
        pill.removeAttribute("data-admin-i18n");
        pill.textContent = label.textContent || "";
    }
}

function initAdminLayoutController() {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const compactQuery = window.matchMedia("(max-width: 1023px)");
    let drawerReturnFocus = null;

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
        document.getElementById("adminSidebar")?.setAttribute("aria-hidden", compactQuery.matches ? "true" : "false");
        if (drawerReturnFocus && typeof drawerReturnFocus.focus === "function") {
            drawerReturnFocus.focus({ preventScroll: true });
        }
        drawerReturnFocus = null;
    }

    function openDrawer(opener = document.activeElement) {
        drawerReturnFocus = opener;
        document.body.classList.add("admin-sidebar-open", "admin-drawer-lock");
        document.getElementById("adminMenuToggle")?.setAttribute("aria-expanded", "true");
        const sidebar = document.getElementById("adminSidebar");
        sidebar?.setAttribute("aria-hidden", "false");
        const first = getAdminDrawerFocusable()[0];
        setTimeout(() => first?.focus?.({ preventScroll: true }), 0);
    }

    function trapDrawerFocus(event) {
        if (!document.body.classList.contains("admin-sidebar-open") || event.key !== "Tab") return;
        const focusable = getAdminDrawerFocusable();
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function syncArchitecture() {
        const phone = mediaQuery.matches;
        const compact = compactQuery.matches;
        document.body.classList.toggle("admin-is-mobile", phone);
        document.body.classList.toggle("admin-is-tablet", compact && !phone);
        closeAdminMobileSurface();
        closeDrawer();
        ["orders", "wallet", "catalog", "fulfillment"].forEach(showList);
        document.getElementById("adminSidebar")?.setAttribute("aria-hidden", compact ? "true" : "false");
        window.dispatchEvent(new CustomEvent("aziel:admin-layout-change", {
            detail: { mobile: phone, tablet: compact && !phone }
        }));
    }

    mediaQuery.addEventListener?.("change", syncArchitecture);
    compactQuery.addEventListener?.("change", syncArchitecture);

    document.body.classList.toggle("admin-is-mobile", isMobile());
    document.body.classList.toggle("admin-is-tablet", compactQuery.matches && !isMobile());
    document.getElementById("adminSidebar")?.setAttribute("aria-hidden", compactQuery.matches ? "true" : "false");
    document.addEventListener("keydown", trapDrawerFocus);

    window.AZIEL_ADMIN_LAYOUT = {
        isMobile,
        isTablet: () => compactQuery.matches && !mediaQuery.matches,
        openDrawer,
        closeDrawer,
        showDetail,
        showList
    };
}

let adminMobileSurfaceState = null;
let adminMobileSurfaceReturnFocus = null;

function initAdminMobileShell() {
    document.querySelectorAll("[data-mobile-section]").forEach(item => {
        item.addEventListener("click", () => {
            openAdminSection(item.dataset.mobileSection);
            closeAdminMobileSurface();
        });
    });

    const openMoreButtons = [
        document.getElementById("adminMobileMoreBtn"),
        document.getElementById("adminMobileHeaderMoreBtn")
    ].filter(Boolean);
    openMoreButtons.forEach(button => button.addEventListener("click", () => openAdminMobileSurface("more", button)));

    document.getElementById("adminMobileContextBtn")?.addEventListener("click", handleAdminMobileContextAction);
    document.getElementById("adminMobileNotificationsBtn")?.addEventListener("click", () => {
        window.open("/notifications.html", "_blank", "noopener,noreferrer");
    });

    document.querySelectorAll("[data-admin-mobile-close]").forEach(button => {
        button.addEventListener("click", closeAdminMobileSurface);
    });

    const mobileSearch = document.getElementById("adminMobileGlobalSearch");
    mobileSearch?.addEventListener("input", () => {
        const canonicalSearch = document.getElementById("adminGlobalSearch");
        if (!canonicalSearch) return;
        canonicalSearch.value = mobileSearch.value;
        canonicalSearch.dispatchEvent(new Event("input", { bubbles: true }));
        syncAdminMobileNavigation(document.body.dataset.adminSection || "dashboard");
    });
    mobileSearch?.addEventListener("keydown", event => {
        if (event.key === "Enter") closeAdminMobileSurface();
    });

    document.getElementById("adminMobileMoreSearch")?.addEventListener("input", filterAdminMobileMore);
    document.getElementById("adminMoreLogoutBtn")?.addEventListener("click", () => {
        if (typeof adminLogout === "function") adminLogout();
    });

    document.addEventListener("keydown", event => {
        if (!adminMobileSurfaceState) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeAdminMobileSurface();
        } else if (event.key === "Tab") {
            trapAdminMobileSurfaceFocus(event);
        }
    });

    window.addEventListener("aziel:admin-auth-ready", () => {
        window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.(document.getElementById("adminMobileBottomNav"));
        window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.(document.getElementById("adminMobileMore"));
        filterAdminMobileMore();
    });
    window.addEventListener("aziel:admin-layout-change", event => {
        document.querySelectorAll(".admin-mobile-action-overflow").forEach(disclosure => {
            disclosure.open = !event.detail?.mobile;
        });
    });
}

function handleAdminMobileContextAction(event) {
    const section = document.body.dataset.adminSection || "dashboard";
    if (section === "dashboard") {
        const filters = document.getElementById("dashboardMobileFilters");
        if (filters) {
            filters.setAttribute("open", "");
            setTimeout(() => document.getElementById("dashboardPresetSelect")?.focus({ preventScroll: true }), 0);
            return;
        }
    }
    const targets = {
        orders: "orderSearchInput",
        wallet: "walletQueueSearch",
        catalog: "adminCatalogSearch",
        "pricing-engine": "pricingPackageSearch",
        media: "mediaSearchInput",
        users: "customerSearchInput"
    };
    const target = document.getElementById(targets[section]);
    if (target && !target.hidden) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => target.focus({ preventScroll: true }), 250);
        return;
    }
    openAdminMobileSurface("search", event.currentTarget);
}

function openAdminMobileSurface(name, opener = document.activeElement) {
    if (!window.AZIEL_ADMIN_LAYOUT?.isMobile?.()) return;
    closeAdminMobileSurface(false);
    const surface = document.getElementById(name === "more" ? "adminMobileMore" : "adminMobileSearch");
    if (!surface) return;
    adminMobileSurfaceState = name;
    adminMobileSurfaceReturnFocus = opener;
    surface.hidden = false;
    document.body.classList.add("admin-mobile-surface-open");
    document.querySelectorAll("#adminMobileMoreBtn, #adminMobileHeaderMoreBtn").forEach(button => {
        button.setAttribute("aria-expanded", name === "more" ? "true" : "false");
    });
    const firstFocus = surface.querySelector("input, button:not([hidden]), a[href]");
    setTimeout(() => firstFocus?.focus?.({ preventScroll: true }), 0);
}

function closeAdminMobileSurface(restoreFocus = true) {
    document.querySelectorAll(".admin-mobile-surface").forEach(surface => { surface.hidden = true; });
    document.body?.classList.remove("admin-mobile-surface-open");
    document.querySelectorAll("#adminMobileMoreBtn, #adminMobileHeaderMoreBtn").forEach(button => button.setAttribute("aria-expanded", "false"));
    if (restoreFocus && adminMobileSurfaceReturnFocus?.focus) {
        adminMobileSurfaceReturnFocus.focus({ preventScroll: true });
    }
    adminMobileSurfaceState = null;
    adminMobileSurfaceReturnFocus = null;
}

function trapAdminMobileSurfaceFocus(event) {
    const surface = document.getElementById(adminMobileSurfaceState === "more" ? "adminMobileMore" : "adminMobileSearch");
    const focusable = Array.from(surface?.querySelectorAll("button:not([disabled]):not([hidden]), a[href]:not([hidden]), input:not([disabled]), select:not([disabled])") || [])
        .filter(element => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function filterAdminMobileMore() {
    const input = document.getElementById("adminMobileMoreSearch");
    const term = input?.value.trim().toLowerCase() || "";
    document.querySelectorAll("[data-mobile-more-group]").forEach(group => {
        let visible = 0;
        group.querySelectorAll("[data-mobile-section], a[href]").forEach(item => {
            const allowed = !item.classList.contains("admin-permission-hidden");
            const matches = !term || item.textContent.toLowerCase().includes(term);
            item.hidden = !allowed || !matches;
            if (allowed && matches) visible += 1;
        });
        group.hidden = visible === 0;
    });
}

function syncAdminMobileNavigation(sectionName) {
    const primarySections = new Set(["dashboard", "orders", "wallet", "catalog"]);
    document.querySelectorAll("#adminMobileBottomNav [data-mobile-section]").forEach(item => {
        const active = item.dataset.mobileSection === sectionName;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
    });
    const more = document.getElementById("adminMobileMoreBtn");
    if (more) {
        const active = !primarySections.has(sectionName);
        more.classList.toggle("active", active);
        if (active) more.setAttribute("aria-current", "page");
        else more.removeAttribute("aria-current");
    }
}

function getAdminDrawerFocusable() {
    const sidebar = document.getElementById("adminSidebar");
    if (!sidebar) return [];
    return Array.from(sidebar.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"))
        .filter(element => !element.hidden && element.offsetParent !== null);
}

function initAdminSidebarState() {
    const collapseBtn = document.getElementById("adminSidebarCollapse");
    const saved = localStorage.getItem(ADMIN_SIDEBAR_COLLAPSED_KEY) === "true";
    setAdminSidebarCollapsed(saved);

    collapseBtn?.addEventListener("click", () => {
        setAdminSidebarCollapsed(!document.body.classList.contains("admin-sidebar-collapsed"), true);
    });
}

function setAdminSidebarCollapsed(collapsed, persist = false) {
    document.body.classList.toggle("admin-sidebar-collapsed", Boolean(collapsed));
    const collapseBtn = document.getElementById("adminSidebarCollapse");
    if (collapseBtn) {
        collapseBtn.setAttribute("aria-pressed", collapsed ? "true" : "false");
        collapseBtn.setAttribute("aria-label", collapsed ? adminT("expand_navigation", "Expand admin navigation") : adminT("collapse_navigation", "Collapse admin navigation"));
        collapseBtn.querySelector("i")?.classList.toggle("fa-angles-right", Boolean(collapsed));
        collapseBtn.querySelector("i")?.classList.toggle("fa-angles-left", !collapsed);
    }
    if (persist) localStorage.setItem(ADMIN_SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
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
        hydrateAdminNavMetadata();
        const activeSection = document.querySelector(".admin-section.active");
        const sectionName = activeSection?.id?.replace("section-", "") || "dashboard";
        const pageInfo = adminSectionTitles[sectionName] || adminSectionTitles.dashboard;
        const title = document.getElementById("adminPageTitle");
        const sub = document.getElementById("adminPageSub");

        if (title) title.innerText = adminT(pageInfo.titleKey);
        if (sub) sub.innerText = adminT(pageInfo.subKey);
        setAdminSidebarCollapsed(document.body.classList.contains("admin-sidebar-collapsed"));
        updateAdminSectionPill(sectionName);
    });
}

function initAdminMobileSidebar() {
    const toggleBtn = document.getElementById("adminMenuToggle");
    const closeBtn = document.getElementById("adminSidebarClose");
    const overlay = document.getElementById("adminSidebarOverlay");

    if (toggleBtn) {
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.addEventListener("click", () => {
            window.AZIEL_ADMIN_LAYOUT?.openDrawer?.(toggleBtn);
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

function initAdminNavSearch() {
    const input = document.getElementById("adminNavSearch");
    const menu = document.querySelector(".admin-menu");
    if (!input || !menu) return;

    function applyFilter() {
        const value = input.value.trim().toLowerCase();
        const groups = Array.from(menu.querySelectorAll(".admin-nav-group"));

        groups.forEach(group => {
            const items = Array.from(group.querySelectorAll(".admin-nav"));
            let visibleCount = 0;

            items.forEach(item => {
                const text = [
                    item.dataset.navLabel,
                    item.textContent,
                    item.dataset.section
                ].join(" ").toLowerCase();
                const isMatch = !value || text.includes(value);
                item.hidden = !isMatch;
                if (isMatch) visibleCount += 1;
            });

            group.hidden = visibleCount === 0;
        });
    }

    input.addEventListener("input", applyFilter);
    input.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            input.value = "";
            applyFilter();
            input.blur();
            return;
        }

        if (event.key === "Enter") {
            const firstVisible = Array.from(menu.querySelectorAll(".admin-nav:not([hidden])"))
                .find(item => item.dataset.section);
            if (firstVisible) {
                event.preventDefault();
                firstVisible.click();
            }
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
            keyword.includes("pricing") ||
            keyword.includes("price") ||
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
            if (keyword.includes("pricing") || keyword.includes("price")) {
                openAdminSection("pricing-engine");
                return;
            }

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

    initPromotionNotificationAdmin();

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
                    audience: "ALL_ACTIVE_CUSTOMERS",
                    title,
                    message,
                    type,
                    category
                })
            });

            if (!data?.success) {
                throw new Error(data?.message || "Broadcast failed");
            }

            showAdminToast(`Broadcast sent to ${data.count || 0} users · ${data.email?.delivered || 0} emails`, data.email?.failed ? "warning" : "success");

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

function initPromotionNotificationAdmin() {
    const saveBtn = document.getElementById("savePromotionDraftBtn");
    const publishBtn = document.getElementById("publishPromotionBtn");
    const clearBtn = document.getElementById("clearPromotionFormBtn");

    if (!saveBtn || saveBtn.dataset.ready === "true") return;
    saveBtn.dataset.ready = "true";

    [
        "promotionTitle",
        "promotionSummary",
        "promotionBody",
        "promotionCtaLabel",
        "promotionCtaUrl",
        "promotionPromoCode",
        "promotionCampaignCode",
        "promotionImageUrl"
    ].forEach(id => {
        document.getElementById(id)?.addEventListener("input", renderPromotionPreview);
    });

    saveBtn.addEventListener("click", async () => {
        await savePromotionNotification(false, saveBtn);
    });

    publishBtn?.addEventListener("click", async () => {
        await savePromotionNotification(true, publishBtn);
    });

    clearBtn?.addEventListener("click", () => {
        clearPromotionNotificationForm();
        renderPromotionPreview();
    });

    loadPromotionNotifications();
    renderPromotionPreview();
}

function promotionFormPayload(enabled = false) {
    const regions = [];
    if (document.getElementById("promotionRegionMM")?.checked) regions.push("MM");
    if (document.getElementById("promotionRegionTH")?.checked) regions.push("TH");

    return {
        title: document.getElementById("promotionTitle")?.value.trim() || "",
        summary: document.getElementById("promotionSummary")?.value.trim() || "",
        body: document.getElementById("promotionBody")?.value.trim() || "",
        ctaLabel: document.getElementById("promotionCtaLabel")?.value.trim() || "",
        ctaUrl: document.getElementById("promotionCtaUrl")?.value.trim() || "",
        promoCode: document.getElementById("promotionPromoCode")?.value.trim() || "",
        campaignCode: document.getElementById("promotionCampaignCode")?.value.trim() || "",
        imageUrl: document.getElementById("promotionImageUrl")?.value.trim() || "",
        audience: document.getElementById("promotionAudience")?.value || "ALL_VISITORS",
        priority: Number(document.getElementById("promotionPriority")?.value || 0),
        startsAt: document.getElementById("promotionStartsAt")?.value || "",
        endsAt: document.getElementById("promotionEndsAt")?.value || "",
        regions,
        enabled
    };
}

async function savePromotionNotification(publish = false, btn = null) {
    const id = document.getElementById("promotionNotificationId")?.value || "";
    const payload = promotionFormPayload(publish);

    if (!payload.title || !payload.summary) {
        showAdminToast("Promotion title and summary are required.", "error");
        return;
    }

    if (window.AZIEL_UI?.button) {
        window.AZIEL_UI.button.setLoading(btn, { text: publish ? "Publishing..." : "Saving..." });
    } else if (btn) {
        btn.disabled = true;
    }

    try {
        const data = await adminFetch(id
            ? `/api/admin/promotion-notifications/${encodeURIComponent(id)}`
            : "/api/admin/promotion-notifications", {
            method: id ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!data?.success) throw new Error(data?.message || "Promotion save failed");

        let promotion = data.promotion;
        let delivered = null;

        if (publish && promotion?.id) {
            const published = await adminFetch(`/api/admin/promotion-notifications/${encodeURIComponent(promotion.id)}/publish`, {
                method: "POST"
            });

            if (!published?.success) throw new Error(published?.message || "Promotion publish failed");
            promotion = published.promotion;
            delivered = published.delivered;
        }

        document.getElementById("promotionNotificationId").value = promotion?.id || "";
        showAdminToast(publish
            ? `Promotion published${delivered ? ` to ${delivered.count || 0} users` : ""}.`
            : "Promotion draft saved.",
            "success");
        await loadPromotionNotifications();
    } catch (error) {
        console.log("Promotion notification save error:", error);
        showAdminToast(error.message || "Promotion notification failed", "error");
    } finally {
        if (window.AZIEL_UI?.button) {
            window.AZIEL_UI.button.reset(btn);
        } else if (btn) {
            btn.disabled = false;
        }
    }
}

async function loadPromotionNotifications() {
    const list = document.getElementById("adminPromotionNotificationList");
    if (!list) return;

    try {
        const data = await adminFetch("/api/admin/promotion-notifications");
        if (!data?.success) throw new Error(data?.message || "Could not load promotions");

        const promotions = data.promotions || [];
        if (!promotions.length) {
            list.className = "admin-list-empty";
            list.textContent = "Promotion announcements will appear here.";
            return;
        }

        list.className = "promotion-notification-list";
        list.innerHTML = promotions.map(renderAdminPromotionNotification).join("");
        bindPromotionNotificationList(promotions);
    } catch (error) {
        list.className = "admin-list-empty";
        list.textContent = "Could not load promotion announcements.";
    }
}

function renderAdminPromotionNotification(item = {}) {
    return `
        <article class="promotion-notification-card" data-id="${escapeAdminHtml(item.id)}">
            <strong>${escapeAdminHtml(item.title)}</strong>
            <span>${escapeAdminHtml(item.summary)}</span>
            <small>${escapeAdminHtml(item.state || "DRAFT")} · ${escapeAdminHtml((item.regions || []).join(", "))} · ${escapeAdminHtml(item.audience || "ALL_VISITORS")}</small>
            ${item.promoCode ? `<small>Promo code: ${escapeAdminHtml(item.promoCode)}</small>` : ""}
            <div class="admin-inline-actions">
                <button class="admin-secondary-btn" type="button" data-promotion-edit="${escapeAdminHtml(item.id)}">Edit</button>
                <button class="admin-secondary-btn" type="button" data-promotion-publish="${escapeAdminHtml(item.id)}">Publish</button>
                <button class="admin-secondary-btn danger" type="button" data-promotion-disable="${escapeAdminHtml(item.id)}">Disable</button>
            </div>
        </article>
    `;
}

function bindPromotionNotificationList(promotions = []) {
    const byId = new Map(promotions.map(item => [String(item.id), item]));

    document.querySelectorAll("[data-promotion-edit]").forEach(btn => {
        btn.addEventListener("click", () => {
            fillPromotionNotificationForm(byId.get(btn.dataset.promotionEdit));
        });
    });

    document.querySelectorAll("[data-promotion-publish]").forEach(btn => {
        btn.addEventListener("click", async () => {
            await publishExistingPromotionNotification(btn.dataset.promotionPublish, btn);
        });
    });

    document.querySelectorAll("[data-promotion-disable]").forEach(btn => {
        btn.addEventListener("click", async () => {
            await disablePromotionNotification(btn.dataset.promotionDisable, btn);
        });
    });
}

async function publishExistingPromotionNotification(id, btn = null) {
    if (!id) return;
    try {
        window.AZIEL_UI?.button?.setLoading(btn, { text: "Publishing..." });
        const data = await adminFetch(`/api/admin/promotion-notifications/${encodeURIComponent(id)}/publish`, {
            method: "POST"
        });
        if (!data?.success) throw new Error(data?.message || "Publish failed");
        showAdminToast(`Promotion published to ${data.delivered?.count || 0} users.`, "success");
        await loadPromotionNotifications();
    } catch (error) {
        showAdminToast(error.message || "Publish failed", "error");
    } finally {
        window.AZIEL_UI?.button?.reset(btn);
    }
}

async function disablePromotionNotification(id, btn = null) {
    if (!id) return;
    try {
        window.AZIEL_UI?.button?.setLoading(btn, { text: "Disabling..." });
        const data = await adminFetch(`/api/admin/promotion-notifications/${encodeURIComponent(id)}/disable`, {
            method: "POST"
        });
        if (!data?.success) throw new Error(data?.message || "Disable failed");
        showAdminToast("Promotion disabled.", "success");
        await loadPromotionNotifications();
    } catch (error) {
        showAdminToast(error.message || "Disable failed", "error");
    } finally {
        window.AZIEL_UI?.button?.reset(btn);
    }
}

function fillPromotionNotificationForm(item = {}) {
    if (!item?.id) return;

    document.getElementById("promotionNotificationId").value = item.id || "";
    document.getElementById("promotionTitle").value = item.title || "";
    document.getElementById("promotionSummary").value = item.summary || "";
    document.getElementById("promotionBody").value = item.body || "";
    document.getElementById("promotionCtaLabel").value = item.ctaLabel || "";
    document.getElementById("promotionCtaUrl").value = item.ctaUrl || "";
    document.getElementById("promotionPromoCode").value = item.promoCode || "";
    document.getElementById("promotionCampaignCode").value = item.campaignCode || "";
    document.getElementById("promotionImageUrl").value = item.imageUrl || "";
    document.getElementById("promotionAudience").value = item.audience || "ALL_VISITORS";
    document.getElementById("promotionPriority").value = item.priority || 0;
    document.getElementById("promotionStartsAt").value = toDatetimeLocal(item.startsAt);
    document.getElementById("promotionEndsAt").value = toDatetimeLocal(item.endsAt);
    document.getElementById("promotionRegionMM").checked = (item.regions || []).includes("MM");
    document.getElementById("promotionRegionTH").checked = (item.regions || []).includes("TH");
    renderPromotionPreview();
}

function clearPromotionNotificationForm() {
    [
        "promotionNotificationId",
        "promotionTitle",
        "promotionSummary",
        "promotionBody",
        "promotionCtaLabel",
        "promotionCtaUrl",
        "promotionPromoCode",
        "promotionCampaignCode",
        "promotionImageUrl",
        "promotionStartsAt",
        "promotionEndsAt"
    ].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = "";
    });
    document.getElementById("promotionAudience").value = "ALL_VISITORS";
    document.getElementById("promotionPriority").value = "0";
    document.getElementById("promotionRegionMM").checked = true;
    document.getElementById("promotionRegionTH").checked = true;
}

function renderPromotionPreview() {
    const preview = document.getElementById("promotionPreviewCard");
    if (!preview) return;

    const payload = promotionFormPayload(false);
    preview.innerHTML = `
        <strong>${escapeAdminHtml(payload.title || "Promotion preview")}</strong>
        <span>${escapeAdminHtml(payload.summary || "Fill title and summary to preview the Home row.")}</span>
        ${payload.promoCode ? `<small>Promo code: ${escapeAdminHtml(payload.promoCode.toUpperCase())}</small>` : ""}
    `;
}

function toDatetimeLocal(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 16);
}

function escapeAdminHtml(value = "") {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
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
