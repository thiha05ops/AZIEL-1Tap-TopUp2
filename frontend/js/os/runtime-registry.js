(function () {
    const { ERROR_CODES, KernelError } = window.AZIELOS_CONTRACTS;

    function createRuntimeRegistry(events) {
        const runtimes = new Map();

        function register(manifest) {
            const runtime = normalizeRuntime(manifest);
            if (runtimes.has(runtime.id)) {
                throw new KernelError("DUPLICATE_RUNTIME", "Runtime is already registered.", { runtimeId: runtime.id });
            }
            runtimes.set(runtime.id, Object.freeze(runtime));
            events?.emit?.("runtime.registered", { runtimeId: runtime.id, status: runtime.status }, { source: "runtime-registry" });
            return runtime;
        }

        function normalizeRuntime(manifest) {
            const id = String(manifest?.id || "").trim();
            if (!/^[a-z][a-z0-9-]*$/.test(id)) {
                throw new KernelError("INVALID_RUNTIME_MANIFEST", "Runtime manifest requires a stable id.", { runtimeId: id });
            }
            return {
                id,
                name: String(manifest.name || id),
                version: String(manifest.version || "0.0.0"),
                capabilities: Object.freeze([...(manifest.capabilities || [])]),
                status: String(manifest.status || "CREATED"),
                environment: String(manifest.environment || "browser"),
                lifecycleState: String(manifest.lifecycleState || "CREATED"),
                health: Object.freeze({ ...(manifest.health || {}) }),
                metadata: Object.freeze({ ...(manifest.metadata || {}) })
            };
        }

        function get(runtimeId) {
            const runtime = runtimes.get(runtimeId);
            if (!runtime) throw new KernelError(ERROR_CODES.RUNTIME_NOT_FOUND, "Runtime is not registered.", { runtimeId });
            return runtime;
        }

        return Object.freeze({
            register,
            get,
            has: runtimeId => runtimes.has(runtimeId),
            list: () => Object.freeze([...runtimes.values()].map(runtime => Object.freeze({ ...runtime }))),
            count: () => runtimes.size
        });
    }

    window.AZIELOS_CONTRACTS.createRuntimeRegistry = createRuntimeRegistry;
})();
