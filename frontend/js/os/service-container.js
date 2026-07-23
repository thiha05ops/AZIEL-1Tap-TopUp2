(function () {
    const { ERROR_CODES, KernelError } = window.AZIELOS_CONTRACTS;

    function createServiceContainer() {
        const services = new Map();

        function register(name, service, options = {}) {
            const key = normalizeName(name);
            if (services.has(key) && !options.replace) {
                throw new KernelError(ERROR_CODES.DUPLICATE_SERVICE, "Service is already registered.", { service: key });
            }
            services.set(key, Object.freeze({
                name: key,
                service,
                registeredAt: new Date().toISOString(),
                metadata: Object.freeze({ ...(options.metadata || {}) })
            }));
            return resolve(key);
        }

        function normalizeName(name) {
            const key = String(name || "").trim();
            if (!/^[a-z][a-zA-Z0-9.-]*$/.test(key)) {
                throw new KernelError("INVALID_SERVICE_NAME", "Service name must be stable alphanumeric dot/dash/camelCase.", { service: key });
            }
            return key;
        }

        function resolve(name) {
            const key = normalizeName(name);
            const entry = services.get(key);
            if (!entry) throw new KernelError(ERROR_CODES.SERVICE_NOT_FOUND, "Service is not registered.", { service: key });
            return entry.service;
        }

        function unregister(name) {
            const key = normalizeName(name);
            const entry = services.get(key);
            if (entry?.service?.cleanup && typeof entry.service.cleanup === "function") {
                entry.service.cleanup();
            }
            return services.delete(key);
        }

        function list() {
            return Object.freeze([...services.values()].map(entry => Object.freeze({
                name: entry.name,
                registeredAt: entry.registeredAt,
                metadata: entry.metadata
            })));
        }

        return Object.freeze({
            register,
            has: name => services.has(normalizeName(name)),
            resolve,
            unregister,
            list,
            count: () => services.size
        });
    }

    window.AZIELOS_CONTRACTS.createServiceContainer = createServiceContainer;
})();
