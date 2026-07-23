(function () {
    const LIFECYCLE = Object.freeze({
        CREATED: "CREATED",
        BOOTING: "BOOTING",
        READY: "READY",
        DEGRADED: "DEGRADED",
        FAILED: "FAILED",
        DESTROYED: "DESTROYED"
    });
    const VERSION = "1.0.0-phase1";

    function createKernel() {
        if (window.AZIELOS && window.AZIELOS.__kernel === true) return window.AZIELOS;

        const diagnostics = window.AZIELOS_CONTRACTS.createDiagnostics();
        const events = window.AZIELOS_CONTRACTS.createEventBus(diagnostics);
        const apps = window.AZIELOS_CONTRACTS.createAppRegistry(events, diagnostics);
        const services = window.AZIELOS_CONTRACTS.createServiceContainer();
        const runtimes = window.AZIELOS_CONTRACTS.createRuntimeRegistry(events);
        const workspace = window.AZIELOS_CONTRACTS.createWorkspaceManager(apps, events, diagnostics);
        const navigation = window.AZIELOS_CONTRACTS.createNavigationManager(apps, workspace, events);
        let lifecycle = LIFECYCLE.CREATED;
        let bootPromise = null;
        let bootTimestamp = "";
        let bootDurationMs = 0;

        function state() {
            return Object.freeze({
                lifecycle,
                bootTimestamp,
                bootDurationMs
            });
        }

        async function boot(options = {}) {
            if (bootPromise) return bootPromise;
            if (lifecycle === LIFECYCLE.READY || lifecycle === LIFECYCLE.DEGRADED) return state();

            bootPromise = Promise.resolve().then(() => {
                const started = performance.now();
                lifecycle = LIFECYCLE.BOOTING;
                bootTimestamp = new Date().toISOString();
                events.emit("kernel.booting", { version: VERSION }, { source: "kernel" });

                try {
                    registerCoreServices();
                    const adapter = window.AZIELOS_CONTRACTS.createAdminNavigationAdapter?.(kernel);
                    if (adapter) {
                        navigation.attachAdapter(adapter.attach());
                        services.register("permission", adapter.permissionBridge(), { metadata: { source: "admin-navigation-adapter" } });
                    }
                    navigation.syncFromHash();
                    lifecycle = diagnostics.snapshot(kernel).degradedReasons.length ? LIFECYCLE.DEGRADED : LIFECYCLE.READY;
                    bootDurationMs = Math.round(performance.now() - started);
                    events.emit("kernel.ready", { lifecycle, bootDurationMs }, { source: "kernel" });
                    window.dispatchEvent(new CustomEvent("aziel:kernel-ready", {
                        detail: { lifecycle, bootDurationMs }
                    }));
                    return state();
                } catch (error) {
                    diagnostics.recordError(error);
                    lifecycle = options.allowDegraded !== false ? LIFECYCLE.DEGRADED : LIFECYCLE.FAILED;
                    bootDurationMs = Math.round(performance.now() - started);
                    events.emit("kernel.failed", { lifecycle, code: error?.code || "KERNEL_BOOT_ERROR" }, { source: "kernel" });
                    if (lifecycle === LIFECYCLE.FAILED) throw error;
                    return state();
                }
            });

            return bootPromise;
        }

        function registerCoreServices() {
            if (!services.has("events")) services.register("events", events);
            if (!services.has("apps")) services.register("apps", apps);
            if (!services.has("workspace")) services.register("workspace", workspace);
            if (!services.has("navigation")) services.register("navigation", navigation);
            if (!services.has("storage")) {
                services.register("storage", Object.freeze({
                    get: key => localStorage.getItem(key),
                    set: (key, value) => localStorage.setItem(key, value),
                    remove: key => localStorage.removeItem(key)
                }));
            }
            if (!services.has("toast")) {
                services.register("toast", Object.freeze({
                    show: (...args) => window.showAdminToast?.(...args)
                }));
            }
            if (!services.has("localization")) {
                services.register("localization", Object.freeze({
                    t: (...args) => window.AZIEL_ADMIN_I18N?.t?.(...args),
                    getLocale: () => window.AZIEL_ADMIN_I18N?.getLocale?.() || document.documentElement.lang || "en"
                }));
            }
        }

        function destroy() {
            events.clearScope("admin-navigation-adapter");
            lifecycle = LIFECYCLE.DESTROYED;
            events.emit("kernel.destroyed", {}, { source: "kernel" });
        }

        const kernel = Object.freeze({
            __kernel: true,
            version: VERSION,
            boot,
            destroy,
            state,
            apps,
            workspace,
            navigation,
            events,
            services,
            runtimes,
            diagnostics: Object.freeze({
                snapshot: () => diagnostics.snapshot(kernel),
                recordError: diagnostics.recordError,
                recordMismatch: diagnostics.recordMismatch,
                recordDegraded: diagnostics.recordDegraded,
                recordListenerFailure: diagnostics.recordListenerFailure
            })
        });

        window.AZIELOS = kernel;
        return kernel;
    }

    window.AZIELOS_CONTRACTS.createKernel = createKernel;
    createKernel();
})();
