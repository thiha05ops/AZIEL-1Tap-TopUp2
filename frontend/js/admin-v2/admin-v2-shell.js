// AZIEL OS V2.1 production presentation adapter.
// Existing controllers, permissions, endpoints, and section DOM remain authoritative.
(function () {
    "use strict";

    const IA = [
        ["Home", [["dashboard", "Overview", "fa-house"]]],
        ["Commerce", [["products", "Products", "fa-layer-group"], ["orders", "Orders", "fa-box"], ["pricing-engine", "Pricing", "fa-scale-balanced"], ["campaigns", "Promotions", "fa-bullseye"]]],
        ["Operations", [["fulfillment", "Fulfillment", "fa-truck-ramp-box"], ["payments", "Payments", "fa-credit-card"], ["wallet", "Wallet", "fa-wallet"]]],
        ["Store", [["catalog", "Storefront", "fa-store"], ["media", "Media", "fa-photo-film"]]],
        ["Customers", [["users", "Customers", "fa-users"], ["support", "Support", "fa-headset"]]],
        ["System", [["supplier-catalog", "Suppliers", "fa-building"], ["admin-security", "Team & Security", "fa-user-shield"], ["settings", "Settings", "fa-gear"], ["audit", "Audit", "fa-clock-rotate-left"]]]
    ];
    const LEGACY_SECTIONS = ["website", "pricing-settings", "promos", "site-content", "chat", "broadcast", "advanced-settings"];
    let profileReturnFocus = null;

    function make(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text) element.textContent = text;
        return element;
    }

    function existingNav(section) {
        return document.querySelector(`.admin-menu .admin-nav[data-section="${section}"]`);
    }

    function prepareNavButton(button, section, label, icon) {
        if (!button) return null;
        const labelNode = button.querySelector("span") || make("span");
        labelNode.textContent = label;
        labelNode.removeAttribute("data-admin-i18n");
        if (!labelNode.parentNode) button.appendChild(labelNode);
        const iconNode = button.querySelector("i") || make("i");
        iconNode.className = `fa-solid ${icon}`;
        if (!iconNode.parentNode) button.prepend(iconNode);
        button.dataset.navLabel = label;
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        if (section === "audit") {
            button.removeAttribute("data-section");
            button.dataset.adminV2Alias = "audit";
            button.removeAttribute("data-admin-i18n");
        }
        return button;
    }

    function buildDesktopNavigation() {
        const menu = document.querySelector(".admin-menu");
        if (!menu) return;
        const pool = new Map(Array.from(menu.querySelectorAll(".admin-nav[data-section]")).map(button => [button.dataset.section, button]));
        const legacyHost = make("div", "admin-v2-legacy-navigation");
        legacyHost.hidden = true;
        LEGACY_SECTIONS.forEach(section => { const node = pool.get(section); if (node) legacyHost.appendChild(node); });
        menu.replaceChildren();
        IA.forEach(([groupName, items]) => {
            const group = make("div", "admin-nav-group");
            group.appendChild(make("span", "admin-nav-label", groupName));
            items.forEach(([section, label, icon]) => {
                let button;
                if (section === "audit") {
                    button = make("button", "admin-nav");
                    button.type = "button";
                    button.dataset.adminPermission = "AUDIT_LOG_READ";
                } else {
                    button = pool.get(section);
                }
                button = prepareNavButton(button, section, label, icon);
                if (button) group.appendChild(button);
            });
            menu.appendChild(group);
        });
        menu.appendChild(legacyHost);
        document.querySelector(".admin-nav[data-section=dashboard]")?.classList.toggle("active", !document.querySelector(".admin-nav.active"));
        document.querySelector(".admin-nav[data-admin-v2-alias=audit]")?.addEventListener("click", openAudit);
        window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.(menu);
    }

    function buildMobileNavigation() {
        const bottom = document.getElementById("adminMobileBottomNav");
        if (!bottom) return;
        const primary = [["dashboard", "Overview", "fa-house"], ["orders", "Orders", "fa-box"], ["fulfillment", "Fulfillment", "fa-truck-ramp-box"], ["pricing-engine", "Pricing", "fa-scale-balanced"]];
        bottom.replaceChildren();
        primary.forEach(([section, label, icon]) => {
            const button = make("button");
            button.type = "button";
            button.dataset.mobileSection = section;
            const source = existingNav(section);
            if (source?.dataset.adminPermission) button.dataset.adminPermission = source.dataset.adminPermission;
            const i = make("i", `fa-solid ${icon}`); i.setAttribute("aria-hidden", "true");
            button.append(i, make("span", "", label));
            button.addEventListener("click", () => window.openAdminSection?.(section));
            bottom.appendChild(button);
        });
        const more = make("button");
        more.id = "adminMobileMoreBtn"; more.type = "button"; more.setAttribute("aria-label", "Open More menu"); more.setAttribute("aria-controls", "adminMobileMore"); more.setAttribute("aria-expanded", "false");
        const moreIcon = make("i", "fa-solid fa-ellipsis"); moreIcon.setAttribute("aria-hidden", "true"); more.append(moreIcon, make("span", "", "More")); bottom.appendChild(more);
        more.addEventListener("click", () => window.openAdminMobileSurface?.("more", more));
        window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.(bottom);
    }

    function rebuildMoreNavigation() {
        const container = document.querySelector("#adminMobileMore .admin-mobile-more-nav");
        if (!container) return;
        container.replaceChildren();
        IA.slice(1).forEach(([groupName, items]) => {
            const section = make("section", "admin-mobile-more-group"); section.dataset.mobileMoreGroup = "";
            section.appendChild(make("h3", "", groupName)); const grid = make("div", "admin-mobile-more-grid");
            items.forEach(([target, label, icon]) => {
                if (["orders", "fulfillment", "pricing-engine"].includes(target)) return;
                const button = make("button"); button.type = "button";
                const source = target === "audit" ? null : existingNav(target);
                if (source?.dataset.adminPermission) button.dataset.adminPermission = source.dataset.adminPermission;
                if (target === "audit") button.dataset.adminPermission = "AUDIT_LOG_READ";
                const i = make("i", `fa-solid ${icon}`); i.setAttribute("aria-hidden", "true"); button.append(i, make("span", "", label));
                button.addEventListener("click", () => { target === "audit" ? openAudit() : window.openAdminSection?.(target); window.closeAdminMobileSurface?.(); });
                grid.appendChild(button);
            });
            section.appendChild(grid); container.appendChild(section);
        });
        window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.(container);
    }

    function openAudit() {
        window.openAdminSection?.("admin-security", true, { view: "audit" });
        document.querySelector('[data-admin-security-view="audit"]')?.click();
        document.querySelector('.admin-nav[data-section="admin-security"]')?.classList.remove("active");
        document.querySelector('.admin-nav[data-admin-v2-alias="audit"]')?.classList.add("active");
    }

    function installProfileMenu() {
        const original = document.getElementById("adminProfileBtn");
        if (!original) return;
        const profile = original.cloneNode(true);
        original.replaceWith(profile);
        const popover = make("div", "admin-v2-popover"); popover.id = "adminV2ProfileMenu"; popover.hidden = true;
        const profileLink = make("button", "", "Profile & security"); profileLink.type = "button"; profileLink.addEventListener("click", () => { closePopovers(); window.openAdminSection?.("admin-security"); });
        popover.appendChild(profileLink);
        const locale = document.getElementById("adminLocaleSelect"); if (locale) popover.appendChild(locale);
        const back = document.querySelector(".admin-topbar-controls > a"); if (back) popover.appendChild(back);
        popover.appendChild(make("hr"));
        const logout = document.getElementById("adminLogoutBtn"); if (logout) popover.appendChild(logout);
        document.body.appendChild(popover);
        profile.setAttribute("aria-haspopup", "menu"); profile.setAttribute("aria-controls", popover.id);
        profile.addEventListener("click", event => { event.stopPropagation(); const opening = popover.hidden; closePopovers(); popover.hidden = !opening; profile.setAttribute("aria-expanded", String(opening)); if (opening) profileReturnFocus = profile; });
    }

    function adminNotificationSection(action = {}) {
        const section = String(action.section || "").trim();

        if (section === "orders") return "orders";
        if (section === "wallet") return "wallet";
        if (section === "support") return "support";
        if (section === "live-chat") return "live-chat";

        return "dashboard";
    }

    function adminNotificationTime(value) {
        const date = value ? new Date(value) : null;
        if (!date || Number.isNaN(date.getTime())) return "";

        const diff = Date.now() - date.getTime();
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;

        if (diff < minute) return "Just now";
        if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
        if (diff < day) return `${Math.floor(diff / hour)}h ago`;

        return date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric"
        });
    }

    function installNotificationMenu() {
        const original = document.getElementById("adminNotificationsBtn");
        if (!original) return;

        const button = original.cloneNode(true);
        original.replaceWith(button);

        const badge = button.querySelector(".admin-topbar-badge");

        const popover = make("div", "admin-v2-popover admin-v2-notification-popover");
        popover.id = "adminV2Notifications";
        popover.hidden = true;

        const header = make("div", "admin-v2-notification-header");
        const headerCopy = make("div", "admin-v2-notification-header-copy");
        headerCopy.append(
            make("strong", "", "Operational notifications"),
            make("span", "", "Orders, payments, fulfillment and customer operations")
        );

        const markAllButton = make("button", "admin-v2-notification-mark-all", "Mark all read");
        markAllButton.type = "button";

        header.append(headerCopy, markAllButton);

        const list = make("div", "admin-v2-notification-list");
        list.setAttribute("role", "list");

        const state = {
            items: [],
            unreadCount: 0,
            loading: false
        };

        function updateBadge() {
            const count = Math.max(0, Number(state.unreadCount || 0));

            if (badge) {
                badge.textContent = count > 99 ? "99+" : String(count);
                badge.hidden = count === 0;
                badge.setAttribute(
                    "aria-label",
                    `${count} unread operational notification${count === 1 ? "" : "s"}`
                );
            }

            let mobileBadge = document.getElementById("adminMobileNotificationsBadge");
            const mobileButton = document.getElementById("adminMobileNotificationsBtn");

            if (mobileButton && !mobileBadge) {
                mobileBadge = make("span", "admin-mobile-notification-badge");
                mobileBadge.id = "adminMobileNotificationsBadge";
                mobileButton.appendChild(mobileBadge);
            }

            if (mobileBadge) {
                mobileBadge.textContent = count > 99 ? "99+" : String(count);
                mobileBadge.hidden = count === 0;
            }
        }

        async function markRead(item) {
            if (!item?.id || item.isRead) return item;

            const data = await adminFetch(
                `/api/admin/operational-notifications/${encodeURIComponent(item.id)}/read`,
                {
                    method: "PATCH",
                    skipPermissionToast: true
                }
            );

            if (!data?.success) return item;

            state.unreadCount = Number(data.unreadCount || 0);

            const index = state.items.findIndex(entry => entry.id === item.id);
            if (index >= 0) {
                state.items[index] = data.notification || {
                    ...state.items[index],
                    isRead: true
                };
            }

            updateBadge();

            return data.notification || item;
        }

        function render() {
            list.replaceChildren();

            if (state.loading) {
                const loading = make("div", "admin-v2-notification-empty", "Loading notifications…");
                list.appendChild(loading);
                return;
            }

            if (!state.items.length) {
                const empty = make(
                    "div",
                    "admin-v2-notification-empty",
                    "No operational notifications yet."
                );
                list.appendChild(empty);
                return;
            }

            state.items.forEach(item => {
                const row = make(
                    "button",
                    `admin-v2-notification-item${item.isRead ? "" : " is-unread"}`
                );
                row.type = "button";
                row.setAttribute("role", "listitem");

                const content = make("span", "admin-v2-notification-copy");
                const top = make("span", "admin-v2-notification-item-top");

                const title = make(
                    "strong",
                    "admin-v2-notification-title",
                    item.title || "Operational update"
                );

                const time = make(
                    "span",
                    "admin-v2-notification-time",
                    adminNotificationTime(item.createdAt)
                );

                top.append(title, time);

                const message = make(
                    "span",
                    "admin-v2-notification-message",
                    item.message || ""
                );

                const meta = make("span", "admin-v2-notification-meta");
                meta.textContent = [
                    item.category || "system",
                    item.severity || "info"
                ].filter(Boolean).join(" · ");

                content.append(top);

                if (item.message) content.append(message);
                content.append(meta);

                if (!item.isRead) {
                    row.appendChild(make("span", "admin-v2-notification-unread-dot"));
                }

                row.appendChild(content);

                row.addEventListener("click", async event => {
                    event.stopPropagation();

                    await markRead(item);

                    const section = adminNotificationSection(item.action || {});
                    closePopovers();

                    if (typeof window.openAdminSection === "function") {
                        window.openAdminSection(section, true, {
                            notificationId: item.id || "",
                            resourceId: item.resourceId || "",
                            resourceType: item.resourceType || ""
                        });
                    }
                });

                list.appendChild(row);
            });
        }

        async function loadNotifications() {
            if (state.loading) return;

            state.loading = true;
            render();

            try {
                const data = await adminFetch(
                    "/api/admin/operational-notifications?limit=30",
                    { skipPermissionToast: true }
                );

                if (!data?.success) {
                    state.items = [];
                    state.unreadCount = 0;
                    return;
                }

                state.items = Array.isArray(data.notifications)
                    ? data.notifications
                    : [];

                state.unreadCount = Number(data.unreadCount || 0);
            } catch (error) {
                console.error(
                    "Unable to load admin operational notifications:",
                    error
                );
            } finally {
                state.loading = false;
                updateBadge();
                render();
            }
        }

        async function loadUnreadCount() {
            try {
                const data = await adminFetch(
                    "/api/admin/operational-notifications/unread-count",
                    { skipPermissionToast: true }
                );

                if (!data?.success) return;

                state.unreadCount = Number(data.unreadCount || 0);
                updateBadge();
            } catch (error) {
                console.error(
                    "Unable to load admin operational unread count:",
                    error
                );
            }
        }

        async function markAllRead() {
            if (!state.unreadCount) return;

            const data = await adminFetch(
                "/api/admin/operational-notifications/read-all",
                {
                    method: "POST",
                    skipPermissionToast: true
                }
            );

            if (!data?.success) return;

            state.unreadCount = 0;
            state.items = state.items.map(item => ({
                ...item,
                isRead: true,
                readAt: item.readAt || new Date().toISOString()
            }));

            updateBadge();
            render();
        }

        markAllButton.addEventListener("click", async event => {
            event.stopPropagation();
            await markAllRead();
        });

        popover.append(header, list);
        document.body.appendChild(popover);

        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-controls", popover.id);
        button.setAttribute("aria-expanded", "false");

        function openNotifications(event) {
            event?.stopPropagation?.();

            const opening = popover.hidden;

            closePopovers();
            popover.hidden = !opening;
            button.setAttribute("aria-expanded", String(opening));

            if (opening) loadNotifications();
        }

        button.addEventListener("click", openNotifications);

        window.openAdminOperationalNotifications = openNotifications;
        window.refreshAdminOperationalNotifications = loadNotifications;

        document
            .getElementById("adminMobileNotificationsBtn")
            ?.addEventListener("click", openNotifications);

        if (window.AZIEL?.realtime?.on) {
            window.AZIEL.realtime.on(
                "admin:notification",
                () => {
                    loadUnreadCount();

                    if (!popover.hidden) {
                        loadNotifications();
                    }
                },
                { role: "admin" }
            );
        }

        loadUnreadCount();
    }

    function closePopovers() {
        document.querySelectorAll(".admin-v2-popover").forEach(node => { node.hidden = true; });
        document.getElementById("adminProfileBtn")?.setAttribute("aria-expanded", "false");
        document.getElementById("adminNotificationsBtn")?.setAttribute("aria-expanded", "false");
    }

    function installKeyboardBehavior() {
        document.addEventListener("keydown", event => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); document.getElementById("adminGlobalSearch")?.focus(); }
            if (event.key === "Escape") { const hadOpen = Array.from(document.querySelectorAll(".admin-v2-popover")).some(node => !node.hidden); closePopovers(); if (hadOpen) profileReturnFocus?.focus?.(); }
        });
        document.addEventListener("click", event => { if (!event.target.closest(".admin-v2-popover, #adminProfileBtn, #adminNotificationsBtn")) closePopovers(); });
    }

    function applyContextRoutes() {
        window.addEventListener("aziel:admin-section-opened", event => {
            if (event.detail?.section === "admin-security" && event.detail?.context?.view === "audit") document.querySelector('[data-admin-security-view="audit"]')?.click();
        });
    }

    function makeOverviewSection(title, className) {
        const section = make("section", `admin-v2-overview-section ${className}`);
        section.appendChild(make("h2", "admin-v2-section-title", title));
        return section;
    }

    function installOverviewComposition() {
        const dashboard = document.querySelector("#section-dashboard .dashboard-command-center");
        const header = dashboard?.querySelector(".dashboard-command-header");
        const kpis = document.getElementById("dashboardKpis");
        const attention = document.getElementById("dashboardAttentionQueue");
        const activity = document.getElementById("dashboardRecentActivity");
        if (!dashboard || !header || !kpis || !attention || !activity) return;

        const title = header.querySelector(".dashboard-command-title h3");
        if (title) title.textContent = "Overview";
        header.querySelector(".admin-eyebrow")?.remove();
        const description = header.querySelector(".dashboard-command-title p");
        if (description) description.textContent = "Live commerce operations and exceptions.";

        const overview = make("div", "admin-v2-overview");
        const attentionSection = makeOverviewSection("Needs attention", "admin-v2-attention");
        const todaySection = makeOverviewSection("Today", "admin-v2-today");
        const activitySection = makeOverviewSection("Recent activity", "admin-v2-activity");

        attentionSection.appendChild(attention);
        todaySection.appendChild(kpis);

        const activityPanel = activity.closest("article");
        const activityTabs = activityPanel?.querySelector(".dashboard-segmented");
        if (activityTabs) activitySection.appendChild(activityTabs);
        activitySection.appendChild(activity);

        const health = make("div", "admin-v2-system-health");
        health.setAttribute("role", "status");
        health.append(make("span", "admin-v2-health-dot"), make("strong", "", "System status"), make("span", "", "Operational signals shown from live dashboard data"));

        overview.append(attentionSection, todaySection, activitySection, health);
        const errorRegion = document.getElementById("dashboardErrorRegion");
        (errorRegion || header).insertAdjacentElement("afterend", overview);
        activityPanel?.remove();
    }

    function installWorkspaceTabs(sectionId, label, tabs) {
        const section = document.getElementById(`section-${sectionId}`);
        if (!section || section.querySelector(".admin-v2-workspace-tabs")) return;
        const nav = make("nav", "admin-tabs admin-v2-workspace-tabs");
        nav.setAttribute("aria-label", label);
        tabs.forEach(({ title, target, afterOpen }) => {
            const button = make("button", target === sectionId && !afterOpen ? "active" : "", title);
            button.type = "button";
            button.addEventListener("click", () => {
                window.openAdminSection?.(target);
                window.requestAnimationFrame(() => afterOpen?.());
            });
            nav.appendChild(button);
        });
        section.prepend(nav);
    }

    function installConsolidatedWorkspaces() {
        installWorkspaceTabs("campaigns", "Promotions workspace", [
            { title: "Campaigns", target: "campaigns" },
            { title: "Coupons", target: "promos" }
        ]);
        installWorkspaceTabs("promos", "Promotions workspace", [
            { title: "Campaigns", target: "campaigns" },
            { title: "Coupons", target: "promos" }
        ]);
        installWorkspaceTabs("pricing-engine", "Pricing workspace", [
            { title: "Products", target: "pricing-engine" },
            { title: "Rules & FX", target: "pricing-settings" }
        ]);
        installWorkspaceTabs("pricing-settings", "Pricing workspace", [
            { title: "Products", target: "pricing-engine" },
            { title: "Rules & FX", target: "pricing-settings" }
        ]);
        const websiteTab = tab => () => document.querySelector(`[data-website-runtime-tab="${tab}"]`)?.click();
        installWorkspaceTabs("catalog", "Storefront workspace", [
            { title: "Home", target: "website", afterOpen: websiteTab("home") },
            { title: "Navigation", target: "website", afterOpen: websiteTab("navigation") },
            { title: "Banners", target: "website", afterOpen: websiteTab("home") },
            { title: "Placements", target: "site-content" },
            { title: "Visibility", target: "catalog" }
        ]);
    }

    document.addEventListener("DOMContentLoaded", () => {
        buildDesktopNavigation();
        buildMobileNavigation();
        rebuildMoreNavigation();
        installProfileMenu();
        installNotificationMenu();
        installKeyboardBehavior();
        applyContextRoutes();
        installOverviewComposition();
        installConsolidatedWorkspaces();
    });
})();


/* AZIEL OS V2 — system appearance authority */
(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function applySystemAdminTheme() {
        const dark = media.matches;
        const light = !dark;

        document.documentElement.classList.toggle("theme-dark", dark);
        document.documentElement.classList.toggle("theme-light", light);

        document.body.classList.toggle("theme-dark", dark);
        document.body.classList.toggle("theme-light", light);
    }

    applySystemAdminTheme();

    if (typeof media.addEventListener === "function") {
        media.addEventListener("change", applySystemAdminTheme);
    } else if (typeof media.addListener === "function") {
        media.addListener(applySystemAdminTheme);
    }
})();
