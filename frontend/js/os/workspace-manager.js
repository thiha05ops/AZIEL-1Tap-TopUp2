(function () {
    const { ERROR_CODES, KernelError } = window.AZIELOS_CONTRACTS;

    function createWorkspaceManager(apps, events, diagnostics) {
        const subscribers = new Set();
        let state = Object.freeze({
            activeAppId: "",
            previousAppId: "",
            activeGroup: "",
            currentRoute: "",
            currentRegion: "",
            sidebarCollapsed: false,
            mobileDrawerOpen: false,
            transitionState: "idle",
            updatedAt: ""
        });

        function snapshot() {
            return Object.freeze({ ...state });
        }

        function subscribe(handler) {
            if (typeof handler !== "function") {
                throw new KernelError("INVALID_WORKSPACE_SUBSCRIBER", "Workspace subscriber must be a function.");
            }
            subscribers.add(handler);
            return () => subscribers.delete(handler);
        }

        function setState(patch, metadata = {}) {
            const next = Object.freeze({
                ...state,
                ...patch,
                updatedAt: new Date().toISOString()
            });
            const previous = state;
            state = next;
            subscribers.forEach(handler => {
                try {
                    handler(snapshot(), previous);
                } catch (error) {
                    diagnostics?.recordListenerFailure?.("workspace.subscribe", error);
                }
            });
            events?.emit?.("workspace.changed", snapshot(), metadata);
            return snapshot();
        }

        function activate(appId, options = {}) {
            const app = apps.get(appId);
            if (!app) throw new KernelError(ERROR_CODES.APP_NOT_FOUND, "Workspace cannot activate an unknown app.", { appId });
            if (!app.enabled || !app.visible) {
                throw new KernelError(ERROR_CODES.APP_NOT_AVAILABLE, "Workspace app is unavailable.", { appId });
            }

            setState({ transitionState: "activating" }, { source: options.source || "workspace" });
            return setState({
                previousAppId: state.activeAppId || "",
                activeAppId: app.id,
                activeGroup: app.group,
                currentRoute: app.route || app.href || "",
                transitionState: "ready"
            }, { source: options.source || "workspace", appId: app.id });
        }

        function syncFromLegacy(legacyState = {}) {
            const appId = legacyState.appId || legacyState.section || "";
            const app = appId ? apps.get(appId) : null;
            return setState({
                activeAppId: app?.id || state.activeAppId,
                activeGroup: app?.group || state.activeGroup,
                currentRoute: legacyState.route || legacyState.hash || state.currentRoute,
                sidebarCollapsed: Boolean(legacyState.sidebarCollapsed),
                mobileDrawerOpen: Boolean(legacyState.mobileDrawerOpen),
                transitionState: legacyState.transitionState || state.transitionState || "ready"
            }, { source: "compatibility" });
        }

        return Object.freeze({
            snapshot,
            subscribe,
            activate,
            syncFromLegacy
        });
    }

    window.AZIELOS_CONTRACTS.createWorkspaceManager = createWorkspaceManager;
})();
