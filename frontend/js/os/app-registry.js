(function () {
    const { ERROR_CODES, KernelError } = window.AZIELOS_CONTRACTS;
    const APP_TYPES = Object.freeze(["WORKSPACE", "SETTINGS", "EXTERNAL", "SYSTEM"]);

    function createAppRegistry(events, diagnostics) {
        const apps = new Map();

        function register(manifest) {
            const app = normalizeManifest(manifest);
            if (apps.has(app.id)) {
                throw new KernelError(ERROR_CODES.DUPLICATE_APP, "App ID is already registered.", { appId: app.id });
            }
            apps.set(app.id, Object.freeze(app));
            events?.emit?.("app.registered", { appId: app.id, group: app.group, type: app.type }, { source: "app-registry" });
            return app;
        }

        function normalizeManifest(manifest) {
            if (!manifest || typeof manifest !== "object") {
                throw new KernelError(ERROR_CODES.INVALID_APP_MANIFEST, "App manifest is required.");
            }
            const id = String(manifest.id || "").trim();
            const route = String(manifest.route || manifest.section || "").trim();
            const type = String(manifest.type || "WORKSPACE").trim().toUpperCase();
            if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
                throw new KernelError(ERROR_CODES.INVALID_APP_MANIFEST, "App manifest requires a stable id.", { id });
            }
            if (!APP_TYPES.includes(type)) {
                throw new KernelError(ERROR_CODES.INVALID_APP_MANIFEST, "Unknown app type.", { appId: id, type });
            }
            if (type !== "EXTERNAL" && !route) {
                throw new KernelError(ERROR_CODES.INVALID_APP_MANIFEST, "Workspace app requires a section route.", { appId: id });
            }
            if (type === "EXTERNAL" && !manifest.href && !route) {
                throw new KernelError(ERROR_CODES.INVALID_APP_MANIFEST, "External app requires href or route.", { appId: id });
            }

            return {
                id,
                displayName: String(manifest.displayName || id),
                group: String(manifest.group || "platform"),
                route,
                section: String(manifest.section || route || ""),
                href: manifest.href || "",
                icon: String(manifest.icon || ""),
                permissions: Array.isArray(manifest.permissions) ? [...manifest.permissions] : parsePermissions(manifest.permissions),
                order: Number.isFinite(Number(manifest.order)) ? Number(manifest.order) : 999,
                enabled: manifest.enabled !== false,
                visible: manifest.visible !== false,
                type,
                badgeSource: manifest.badgeSource || "",
                metadata: Object.freeze({ ...(manifest.metadata || {}) })
            };
        }

        function parsePermissions(value) {
            if (!value) return [];
            if (Array.isArray(value)) return [...value];
            return String(value).split(",").map(item => item.trim()).filter(Boolean);
        }

        function get(appId) {
            return apps.get(appId) || null;
        }

        function requireApp(appId) {
            const app = get(appId);
            if (!app) throw new KernelError(ERROR_CODES.APP_NOT_FOUND, "App is not registered.", { appId });
            return app;
        }

        function list(filter = {}) {
            return Object.freeze([...apps.values()]
                .filter(app => filter.visible === undefined || app.visible === filter.visible)
                .sort((a, b) => a.order - b.order || a.displayName.localeCompare(b.displayName))
                .map(app => Object.freeze({ ...app, permissions: Object.freeze([...app.permissions]) })));
        }

        function has(appId) {
            return apps.has(appId);
        }

        return Object.freeze({
            register,
            get,
            require: requireApp,
            has,
            list,
            count: () => apps.size,
            types: () => Object.freeze([...APP_TYPES])
        });
    }

    window.AZIELOS_CONTRACTS.createAppRegistry = createAppRegistry;
})();
