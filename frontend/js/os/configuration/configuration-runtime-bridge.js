(function () {
    const SERVICE_NAME = "configuration";
    const SESSION_SERVICE_NAME = "configurationSession";
    let registered = false;

    function registerConfigurationBridge() {
        const kernel = window.AZIELOS;
        const factory = window.AZIEL_CONFIGURATION_CLIENT?.createConfigurationClient;
        if (!kernel?.services || !factory || registered) return;
        if (kernel.services.has(SERVICE_NAME)) {
            registered = true;
            return;
        }

        const client = factory();
        const service = Object.freeze({
            list: client.list,
            get: client.get,
            resolve: async (id, context = {}) => {
                const result = await client.resolve(id, context);
                kernel.events?.emit?.("configuration.resolved", {
                    configurationId: id,
                    readiness: result.resolution?.readiness?.state || "UNKNOWN"
                }, { source: "configuration-runtime-bridge" });
                return result;
            },
            validate: async (id, value = {}, context = {}) => {
                const result = await client.validate(id, value, context);
                kernel.events?.emit?.("configuration.validation.completed", {
                    configurationId: id,
                    valid: Boolean(result.validation?.valid)
                }, { source: "configuration-runtime-bridge" });
                return result;
            }
        });

        kernel.services.register(SERVICE_NAME, service, {
            metadata: {
                source: "configuration-runtime-bridge",
                safe: true,
                readOnly: true
            }
        });
        if (!kernel.services.has(SESSION_SERVICE_NAME)) {
            kernel.services.register(SESSION_SERVICE_NAME, Object.freeze({
                list: client.sessions,
                openSession: async (id, context = {}) => {
                    const result = await client.openSession(id, context);
                    kernel.events?.emit?.(
                        result.session?.reuseState === "REUSED" ? "configuration.session.reused" : "configuration.session.opened",
                        safeSessionEvent(result.session),
                        { source: "configuration-runtime-bridge" }
                    );
                    return result;
                },
                getSession: client.getSession,
                resolveSession: async sessionId => {
                    const result = await client.resolveSession(sessionId);
                    kernel.events?.emit?.("configuration.session.resolved", safeSessionEvent(result.session), { source: "configuration-runtime-bridge" });
                    return result;
                },
                validateSession: async sessionId => {
                    const result = await client.validateSession(sessionId);
                    kernel.events?.emit?.("configuration.session.validated", safeSessionEvent(result.session), { source: "configuration-runtime-bridge" });
                    return result;
                },
                closeSession: async sessionId => {
                    const result = await client.closeSession(sessionId);
                    kernel.events?.emit?.("configuration.session.closed", safeSessionEvent(result.session), { source: "configuration-runtime-bridge" });
                    return result;
                },
                closeAll: client.closeAll,
                createDraft: async sessionId => {
                    const result = await client.createDraft(sessionId);
                    kernel.events?.emit?.("configuration.draft.created", safeDraftEvent(result.draft), { source: "configuration-runtime-bridge" });
                    return result;
                },
                updateDraft: async (sessionId, patch = {}) => {
                    const result = await client.updateDraft(sessionId, patch);
                    kernel.events?.emit?.("configuration.draft.changed", safeDraftEvent(result.draft), { source: "configuration-runtime-bridge" });
                    return result;
                },
                validateDraft: async sessionId => {
                    const result = await client.validateDraft(sessionId);
                    kernel.events?.emit?.("configuration.draft.validated", safeDraftEvent(result.draft), { source: "configuration-runtime-bridge" });
                    return result;
                },
                previewDraft: async sessionId => {
                    const result = await client.previewDraft(sessionId);
                    kernel.events?.emit?.("configuration.preview.generated", safeDraftEvent(result.draft), { source: "configuration-runtime-bridge" });
                    return result;
                },
                discardDraft: async sessionId => {
                    const result = await client.discardDraft(sessionId);
                    kernel.events?.emit?.("configuration.draft.discarded", safeDraftEvent(result.draft), { source: "configuration-runtime-bridge" });
                    return result;
                }
            }), {
                metadata: {
                    source: "configuration-runtime-bridge",
                    safe: true,
                    transient: true,
                    readOnly: true
                }
            });
        }
        registered = true;
        kernel.events?.emit?.("configuration.registry.ready", {
            service: SERVICE_NAME
        }, { source: "configuration-runtime-bridge" });
    }

    function safeSessionEvent(session = {}) {
        return {
            sessionId: session.sessionId || "",
            configurationId: session.configurationId || "",
            status: session.status || "UNKNOWN",
            readiness: session.readiness?.state || "UNKNOWN"
        };
    }

    function safeDraftEvent(draft = {}) {
        return {
            draftId: draft?.draftId || "",
            sessionId: draft?.sessionId || "",
            configurationId: draft?.configurationId || "",
            status: draft?.status || "UNKNOWN",
            isDirty: Boolean(draft?.dirtyState?.isDirty),
            changeCount: draft?.dirtyState?.changeCount || 0
        };
    }

    window.addEventListener("aziel:kernel-ready", registerConfigurationBridge);
    registerConfigurationBridge();
})();
