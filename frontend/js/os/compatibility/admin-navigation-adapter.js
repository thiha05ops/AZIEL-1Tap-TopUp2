(function () {
    function createAdminNavigationAdapter(kernel) {
        const diagnostics = kernel.diagnostics;
        let attached = false;
        let unsubs = [];

        function attach() {
            if (attached) return api;
            attached = true;
            registerStaticAdminApps();
            validateMappings();
            syncFromDom();

            const sectionUnsub = kernel.events.on("workspace.changed", () => {}, { scopeId: "admin-navigation-adapter" });
            unsubs.push(sectionUnsub);

            window.addEventListener("hashchange", syncFromHash, { passive: true });
            window.addEventListener("aziel:admin-section-opened", handleLegacySectionOpened);
            unsubs.push(() => window.removeEventListener("hashchange", syncFromHash));
            unsubs.push(() => window.removeEventListener("aziel:admin-section-opened", handleLegacySectionOpened));
            return api;
        }

        function registerStaticAdminApps() {
            const navItems = getNavItems();
            navItems.forEach((item, index) => {
                const manifest = manifestFromNavItem(item, index);
                if (!manifest) return;
                try {
                    if (!kernel.apps.has(manifest.id)) kernel.apps.register(manifest);
                } catch (error) {
                    diagnostics.recordError(error);
                    diagnostics.recordDegraded("app-registration-failed", { appId: manifest.id });
                }
            });
        }

        function getNavItems() {
            return Array.from(document.querySelectorAll(".admin-menu .admin-nav"));
        }

        function manifestFromNavItem(item, index) {
            const section = item.dataset.section || "";
            const href = item.getAttribute("href") || "";
            const id = section || externalIdFromHref(href);
            if (!id) {
                diagnostics.recordMismatch("nav-item-missing-section", { index });
                return null;
            }
            const groupLabel = item.closest(".admin-nav-group")?.querySelector(".admin-nav-label");
            const groupKey = groupLabel?.dataset.adminI18n || "platform";
            const label = item.querySelector("span")?.textContent?.trim() || item.textContent?.trim() || id;
            return {
                id,
                displayName: label,
                group: window.AZIELOS_ADMIN_GROUPS?.[groupKey] || groupKey.toUpperCase(),
                route: section || href,
                section,
                href,
                icon: item.querySelector("i")?.className || "",
                permissions: parsePermissions(item.dataset.adminPermission || item.closest("[data-admin-permission]")?.dataset.adminPermission || ""),
                order: window.AZIELOS_ADMIN_APP_ORDER?.[id] || index + 500,
                enabled: !item.disabled,
                visible: !item.hidden,
                type: href && !section ? "EXTERNAL" : "WORKSPACE",
                metadata: {
                    source: "static-admin-nav",
                    tagName: item.tagName.toLowerCase()
                }
            };
        }

        function externalIdFromHref(href) {
            if (!href) return "";
            if (href.includes("admin-design-studio")) return "design-studio";
            return href.replace(/^\//, "").replace(/\.html.*$/, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
        }

        function parsePermissions(value) {
            return String(value || "").split(",").map(item => item.trim()).filter(Boolean);
        }

        function validateMappings() {
            const seen = new Set();
            getNavItems().forEach(item => {
                const section = item.dataset.section;
                if (section) {
                    if (seen.has(section)) diagnostics.recordMismatch("duplicate-data-section", { section });
                    seen.add(section);
                    if (!document.getElementById(`section-${section}`)) {
                        diagnostics.recordMismatch("nav-section-missing-panel", { section });
                    }
                }
            });

            kernel.apps.list().forEach(app => {
                if (app.type !== "EXTERNAL" && app.section && !document.querySelector(`.admin-nav[data-section="${app.section}"]`)) {
                    diagnostics.recordMismatch("registered-app-missing-nav", { appId: app.id, section: app.section });
                }
            });
        }

        function activateApp(app) {
            if (!app) return false;
            if (app.type === "EXTERNAL") {
                openRoute(app.href || app.route);
                return true;
            }
            const button = document.querySelector(`.admin-nav[data-section="${app.section || app.route}"]`);
            if (!button) {
                diagnostics.recordMismatch("activation-target-missing", { appId: app.id, section: app.section });
                return false;
            }
            button.click();
            return true;
        }

        function openRoute(route) {
            if (!route) return false;
            window.location.href = route;
            return true;
        }

        function syncFromHash() {
            const section = (window.location.hash || "#dashboard").slice(1).split("?")[0] || "dashboard";
            const app = kernel.apps.get(section) || kernel.apps.get("dashboard");
            if (!app) return null;
            const active = document.querySelector(".admin-nav.active[data-section]");
            const button = document.querySelector(`.admin-nav[data-section="${app.section || app.route}"]`);
            if (button && active?.dataset.section !== (app.section || app.route)) {
                button.click();
            }
            return kernel.workspace.syncFromLegacy({
                appId: app.id,
                section: app.section,
                route: app.route,
                hash: window.location.hash || `#${app.route}`,
                sidebarCollapsed: document.body.classList.contains("admin-sidebar-collapsed"),
                mobileDrawerOpen: document.body.classList.contains("admin-sidebar-open"),
                transitionState: "ready"
            });
        }

        function syncFromDom() {
            const active = document.querySelector(".admin-nav.active[data-section]");
            const section = active?.dataset.section || (window.location.hash || "#dashboard").slice(1).split("?")[0] || "dashboard";
            return handleLegacySectionOpened({ detail: { section } });
        }

        function handleLegacySectionOpened(event) {
            const section = event?.detail?.section || "dashboard";
            const app = kernel.apps.get(section) || kernel.apps.get("dashboard");
            if (!app) {
                diagnostics.recordMismatch("active-section-unregistered", { section });
                return null;
            }
            return kernel.workspace.syncFromLegacy({
                appId: app.id,
                section: app.section,
                route: app.route,
                hash: window.location.hash || `#${app.route}`,
                sidebarCollapsed: document.body.classList.contains("admin-sidebar-collapsed"),
                mobileDrawerOpen: document.body.classList.contains("admin-sidebar-open"),
                transitionState: "ready"
            });
        }

        function permissionBridge() {
            return Object.freeze({
                canViewApp(appId) {
                    const app = kernel.apps.get(appId);
                    if (!app) return false;
                    const nav = app.section ? document.querySelector(`.admin-nav[data-section="${app.section}"]`) : document.querySelector(`.admin-nav[href="${app.href}"]`);
                    return app.visible !== false && nav?.hidden !== true && nav?.closest("[hidden]") === null;
                },
                getVisibleApps() {
                    return kernel.apps.list().filter(app => this.canViewApp(app.id));
                }
            });
        }

        function destroy() {
            unsubs.forEach(unsub => {
                try {
                    unsub();
                } catch (_error) {
                    // best-effort cleanup only
                }
            });
            unsubs = [];
            attached = false;
        }

        const api = Object.freeze({
            attach,
            activateApp,
            openRoute,
            syncFromHash,
            syncFromDom,
            permissionBridge,
            destroy
        });
        return api;
    }

    window.AZIELOS_CONTRACTS.createAdminNavigationAdapter = createAdminNavigationAdapter;
})();
