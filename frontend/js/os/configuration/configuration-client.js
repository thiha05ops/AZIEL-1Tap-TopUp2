(function () {
    function createConfigurationClient() {
        async function request(path, options = {}) {
            const response = await adminFetch(path, {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    ...(options.headers || {})
                }
            });
            if (!response?.success) {
                throw new Error(response?.message || "Configuration registry unavailable.");
            }
            return response;
        }

        return Object.freeze({
            list: () => request("/api/admin/configuration-registry"),
            get: id => request(`/api/admin/configuration-registry/${encodeURIComponent(id)}`),
            resolve: (id, context = {}) => request(`/api/admin/configuration-registry/${encodeURIComponent(id)}/resolve`, {
                method: "POST",
                body: JSON.stringify({ context })
            }),
            validate: (id, value = {}, context = {}) => request(`/api/admin/configuration-registry/${encodeURIComponent(id)}/validate`, {
                method: "POST",
                body: JSON.stringify({ value, context })
            }),
            sessions: () => request("/api/admin/configuration-sessions"),
            openSession: (id, context = {}) => request(`/api/admin/configuration-registry/${encodeURIComponent(id)}/sessions/open`, {
                method: "POST",
                body: JSON.stringify({ context })
            }),
            getSession: sessionId => request(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}`),
            resolveSession: sessionId => request(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/resolve`, {
                method: "POST",
                body: JSON.stringify({})
            }),
            validateSession: sessionId => request(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/validate`, {
                method: "POST",
                body: JSON.stringify({})
            }),
            closeSession: sessionId => request(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/close`, {
                method: "POST",
                body: JSON.stringify({})
            }),
            closeAll: () => request("/api/admin/configuration-sessions/close-all", {
                method: "POST",
                body: JSON.stringify({})
            }),
            createDraft: sessionId => request(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/draft`, {
                method: "POST",
                body: JSON.stringify({})
            }),
            updateDraft: (sessionId, patch = {}) => request(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/draft/update`, {
                method: "POST",
                body: JSON.stringify({ patch })
            }),
            validateDraft: sessionId => request(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/draft/validate`, {
                method: "POST",
                body: JSON.stringify({})
            }),
            previewDraft: sessionId => request(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/draft/preview`, {
                method: "POST",
                body: JSON.stringify({})
            }),
            discardDraft: sessionId => request(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/draft/discard`, {
                method: "POST",
                body: JSON.stringify({})
            })
        });
    }

    window.AZIEL_CONFIGURATION_CLIENT = Object.freeze({
        createConfigurationClient
    });
})();
