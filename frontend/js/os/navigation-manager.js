(function () {
    const { ERROR_CODES, KernelError } = window.AZIELOS_CONTRACTS;

    function createNavigationManager(apps, workspace, events) {
        let adapter = null;

        function attachAdapter(nextAdapter) {
            adapter = nextAdapter;
            return adapter;
        }

        function openApp(appId, options = {}) {
            const app = apps.get(appId);
            if (!app) throw new KernelError(ERROR_CODES.APP_NOT_FOUND, "Navigation target is not registered.", { appId });
            events?.emit?.("navigation.requested", { appId, route: app.route || app.href }, { source: options.source || "navigation" });

            if (app.type === "EXTERNAL") {
                openRoute(app.href || app.route, options);
                return workspace.activate(app.id, { source: "navigation.external" });
            }

            const activated = adapter?.activateApp ? adapter.activateApp(app, options) : false;
            if (!activated) {
                throw new KernelError(ERROR_CODES.APP_NOT_AVAILABLE, "Navigation adapter could not activate app.", { appId });
            }
            const nextState = workspace.activate(app.id, { source: "navigation" });
            events?.emit?.("navigation.completed", { appId, route: app.route }, { source: "navigation" });
            return nextState;
        }

        function openRoute(route, options = {}) {
            const target = String(route || "").trim();
            if (!target) return false;
            if (adapter?.openRoute) return adapter.openRoute(target, options);
            window.location.href = target;
            return true;
        }

        function getCurrentApp() {
            const current = workspace.snapshot().activeAppId;
            return current ? apps.get(current) : null;
        }

        function syncFromHash() {
            if (adapter?.syncFromHash) return adapter.syncFromHash();
            const section = (window.location.hash || "#dashboard").slice(1).split("?")[0] || "dashboard";
            const app = apps.get(section) || apps.get("dashboard");
            if (!app) return null;
            return workspace.syncFromLegacy({
                appId: app.id,
                route: app.route,
                hash: window.location.hash || `#${app.route}`
            });
        }

        return Object.freeze({
            attachAdapter,
            openApp,
            openRoute,
            getCurrentApp,
            syncFromHash
        });
    }

    window.AZIELOS_CONTRACTS.createNavigationManager = createNavigationManager;
})();
