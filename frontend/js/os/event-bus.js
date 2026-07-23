(function () {
    const { ERROR_CODES, KernelError, sanitizeContext } = window.AZIELOS_CONTRACTS;

    function createEventBus(diagnostics) {
        const listeners = new Map();
        const emitting = new Map();
        const history = [];
        const HISTORY_LIMIT = 60;
        const RECURSION_LIMIT = 8;
        let sequence = 0;

        function assertEventName(eventName) {
            if (!/^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/.test(String(eventName || ""))) {
                throw new KernelError("INVALID_EVENT_NAME", "Event names must be lowercase dot-separated strings.", { eventName });
            }
        }

        function on(eventName, handler, options = {}) {
            assertEventName(eventName);
            if (typeof handler !== "function") {
                throw new KernelError("INVALID_EVENT_HANDLER", "Event handler must be a function.", { eventName });
            }

            const scoped = listeners.get(eventName) || [];
            if (scoped.some(entry => entry.handler === handler && entry.scopeId === options.scopeId)) {
                return () => off(eventName, handler, options.scopeId);
            }

            scoped.push({
                handler,
                scopeId: options.scopeId || "global",
                once: Boolean(options.once)
            });
            listeners.set(eventName, scoped);
            return () => off(eventName, handler, options.scopeId);
        }

        function once(eventName, handler, options = {}) {
            return on(eventName, handler, { ...options, once: true });
        }

        function off(eventName, handler, scopeId) {
            const scoped = listeners.get(eventName);
            if (!scoped) return false;
            const next = scoped.filter(entry => entry.handler !== handler || (scopeId && entry.scopeId !== scopeId));
            if (next.length) listeners.set(eventName, next);
            else listeners.delete(eventName);
            return next.length !== scoped.length;
        }

        function clearScope(scopeId) {
            if (!scopeId) return;
            listeners.forEach((scoped, eventName) => {
                const next = scoped.filter(entry => entry.scopeId !== scopeId);
                if (next.length) listeners.set(eventName, next);
                else listeners.delete(eventName);
            });
        }

        function emit(eventName, payload = {}, metadata = {}) {
            assertEventName(eventName);
            const depth = emitting.get(eventName) || 0;
            if (depth >= RECURSION_LIMIT) {
                const error = new KernelError(ERROR_CODES.EVENT_RECURSION_LIMIT, "Event recursion limit reached.", { eventName });
                diagnostics?.recordError?.(error);
                return { delivered: 0, failed: 0, error };
            }

            const event = Object.freeze({
                id: `evt_${Date.now()}_${++sequence}`,
                name: eventName,
                timestamp: new Date().toISOString(),
                payload: cloneSafe(payload),
                metadata: sanitizeContext(metadata)
            });
            recordHistory(event);

            const scoped = [...(listeners.get(eventName) || [])];
            let delivered = 0;
            let failed = 0;
            emitting.set(eventName, depth + 1);

            scoped.forEach(entry => {
                try {
                    entry.handler(event);
                    delivered += 1;
                } catch (error) {
                    failed += 1;
                    diagnostics?.recordListenerFailure?.(eventName, error);
                } finally {
                    if (entry.once) off(eventName, entry.handler, entry.scopeId);
                }
            });

            if (depth === 0) emitting.delete(eventName);
            else emitting.set(eventName, depth);
            return { delivered, failed };
        }

        function cloneSafe(value) {
            if (value === null || value === undefined) return value;
            try {
                return JSON.parse(JSON.stringify(value));
            } catch (_error) {
                return sanitizeContext(value);
            }
        }

        function recordHistory(event) {
            history.push({
                id: event.id,
                name: event.name,
                timestamp: event.timestamp,
                metadata: event.metadata
            });
            if (history.length > HISTORY_LIMIT) history.shift();
        }

        function listenerCount() {
            const counts = {};
            listeners.forEach((scoped, eventName) => {
                counts[eventName] = scoped.length;
            });
            return Object.freeze({ ...counts });
        }

        return Object.freeze({
            on,
            once,
            off,
            emit,
            clearScope,
            listenerCount,
            history: () => Object.freeze(history.map(item => Object.freeze({ ...item })))
        });
    }

    window.AZIELOS_CONTRACTS.createEventBus = createEventBus;
})();
