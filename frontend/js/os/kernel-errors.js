(function () {
    const ERROR_CODES = Object.freeze({
        KERNEL_BOOT_ERROR: "KERNEL_BOOT_ERROR",
        INVALID_APP_MANIFEST: "INVALID_APP_MANIFEST",
        DUPLICATE_APP: "DUPLICATE_APP",
        APP_NOT_FOUND: "APP_NOT_FOUND",
        APP_NOT_AVAILABLE: "APP_NOT_AVAILABLE",
        SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND",
        DUPLICATE_SERVICE: "DUPLICATE_SERVICE",
        RUNTIME_NOT_FOUND: "RUNTIME_NOT_FOUND",
        EVENT_RECURSION_LIMIT: "EVENT_RECURSION_LIMIT",
        COMPATIBILITY_MISMATCH: "COMPATIBILITY_MISMATCH"
    });

    class KernelError extends Error {
        constructor(code, message, context = {}, cause = null) {
            super(message);
            this.name = "KernelError";
            this.code = code;
            this.context = sanitizeContext(context);
            if (cause && typeof cause === "object") {
                this.cause = {
                    name: cause.name,
                    message: cause.message
                };
            }
        }
    }

    function sanitizeContext(context) {
        const blocked = /token|secret|password|cookie|authorization|api[_-]?key|jwt|customer|payment|email/i;
        const safe = {};
        Object.entries(context || {}).forEach(([key, value]) => {
            if (blocked.test(key)) return;
            if (value === undefined || typeof value === "function") return;
            if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
                safe[key] = value;
                return;
            }
            if (Array.isArray(value)) {
                safe[key] = value.slice(0, 10).map(item => String(item));
                return;
            }
            safe[key] = "[object]";
        });
        return safe;
    }

    window.AZIELOS_CONTRACTS = window.AZIELOS_CONTRACTS || {};
    window.AZIELOS_CONTRACTS.ERROR_CODES = ERROR_CODES;
    window.AZIELOS_CONTRACTS.KernelError = KernelError;
    window.AZIELOS_CONTRACTS.sanitizeContext = sanitizeContext;
})();
