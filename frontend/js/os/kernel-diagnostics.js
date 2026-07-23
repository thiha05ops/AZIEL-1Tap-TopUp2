(function () {
    const { sanitizeContext } = window.AZIELOS_CONTRACTS;

    function createDiagnostics() {
        const bootStartedAt = Date.now();
        const errors = [];
        const listenerFailures = [];
        const mismatches = [];
        const degradedReasons = [];

        function pushBounded(target, value, limit = 40) {
            target.push(value);
            if (target.length > limit) target.shift();
        }

        function recordError(error) {
            pushBounded(errors, {
                code: error?.code || "UNKNOWN_ERROR",
                message: error?.message || "Unknown error",
                context: sanitizeContext(error?.context || {}),
                timestamp: new Date().toISOString()
            });
        }

        function recordListenerFailure(eventName, error) {
            pushBounded(listenerFailures, {
                eventName,
                message: error?.message || "Listener failed",
                timestamp: new Date().toISOString()
            });
        }

        function recordMismatch(code, context = {}) {
            pushBounded(mismatches, {
                code,
                context: sanitizeContext(context),
                timestamp: new Date().toISOString()
            });
        }

        function recordDegraded(reason, context = {}) {
            pushBounded(degradedReasons, {
                reason,
                context: sanitizeContext(context),
                timestamp: new Date().toISOString()
            });
        }

        function snapshot(kernel) {
            const state = kernel?.state?.();
            return Object.freeze({
                version: kernel?.version || "",
                lifecycle: state?.lifecycle || "UNKNOWN",
                bootTimestamp: state?.bootTimestamp || "",
                bootDurationMs: state?.bootDurationMs || Math.max(0, Date.now() - bootStartedAt),
                appCount: kernel?.apps?.count?.() || 0,
                serviceCount: kernel?.services?.count?.() || 0,
                runtimeCount: kernel?.runtimes?.count?.() || 0,
                activeWorkspace: kernel?.workspace?.snapshot?.() || {},
                duplicateRegistrationFailures: errors.filter(error => /DUPLICATE/.test(error.code)).length,
                compatibilityMismatches: mismatches.map(item => ({ ...item })),
                recentEvents: kernel?.events?.history?.() || [],
                listenerFailures: listenerFailures.map(item => ({ ...item })),
                degradedReasons: degradedReasons.map(item => ({ ...item })),
                errors: errors.map(item => ({ ...item }))
            });
        }

        return Object.freeze({
            recordError,
            recordListenerFailure,
            recordMismatch,
            recordDegraded,
            snapshot
        });
    }

    window.AZIELOS_CONTRACTS.createDiagnostics = createDiagnostics;
})();
