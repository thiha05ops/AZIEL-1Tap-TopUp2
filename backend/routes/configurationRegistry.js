const express = require("express");
const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ConfigurationError, toSafeError } = require("../configuration/configurationErrors");
const { getConfigurationRegistry } = require("../configuration/configurationRegistry");
const { getConfigurationSessionManager } = require("../configuration/configurationSessionManager");
const { getHomePlacementDraftManager } = require("../configuration/homePlacementDraftManager");
const { normalizeConfigurationId, normalizeContext } = require("../configuration/configurationDefinition");

function sendConfigurationError(res, error) {
    const safe = toSafeError(error);
    const status = error instanceof ConfigurationError ? error.statusCode || 400 : 500;
    return res.status(status).json({
        success: false,
        code: safe.code,
        message: safe.message,
        context: safe.context || undefined
    });
}

function configurationActor(req, openedFrom = "admin-website") {
    return {
        actorId: String(req.admin?._id || req.admin?.id || req.admin?.username || req.user?._id || req.user?.username || "").trim(),
        ownerRole: req.admin?.role || req.user?.role || "ADMIN",
        openedFrom
    };
}

router.get("/admin/configuration-registry", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (_req, res) => {
    try {
        const registry = await getConfigurationRegistry();
        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            registry: {
                ...registry.snapshot(),
                draftDiagnostics: getHomePlacementDraftManager().diagnostics()
            }
        });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.get("/admin/configuration-registry/:id", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const id = normalizeConfigurationId(req.params.id);
        const registry = await getConfigurationRegistry();
        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            definition: registry.getDefinition(id),
            owner: registry.getOwner(id),
            readiness: registry.getReadiness(id),
            capabilities: registry.getCapabilities(id)
        });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-registry/:id/resolve", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const id = normalizeConfigurationId(req.params.id);
        const context = normalizeContext(req.body?.context || {});
        const registry = await getConfigurationRegistry();
        const resolution = await registry.resolve(id, {
            ...context,
            actor: {
                role: req.admin?.role || "",
                username: req.admin?.username || ""
            }
        });
        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            resolution
        });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-registry/:id/validate", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const id = normalizeConfigurationId(req.params.id);
        const context = normalizeContext(req.body?.context || {});
        const registry = await getConfigurationRegistry();
        const validation = registry.validate(id, req.body?.value || {}, context);
        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            validation
        });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.get("/admin/configuration-sessions", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (_req, res) => {
    try {
        const manager = getConfigurationSessionManager();
        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            sessions: manager.listSessions(configurationActor(_req)),
            diagnostics: manager.diagnostics()
        });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.get("/admin/configuration-sessions/:sessionId", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const manager = getConfigurationSessionManager();
        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            session: manager.getSession(req.params.sessionId, configurationActor(req))
        });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-registry/:id/sessions/open", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const id = normalizeConfigurationId(req.params.id);
        const context = normalizeContext(req.body?.context || {});
        const manager = getConfigurationSessionManager();
        const session = await manager.openSession(id, {
            ...context,
            actor: undefined
        }, configurationActor(req));
        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            session
        });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-sessions/:sessionId/resolve", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const manager = getConfigurationSessionManager();
        const session = await manager.resolveSession(req.params.sessionId, configurationActor(req));
        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            session
        });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-sessions/:sessionId/validate", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const manager = getConfigurationSessionManager();
        const session = await manager.validateSession(req.params.sessionId, configurationActor(req));
        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            session
        });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-sessions/:sessionId/close", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const manager = getConfigurationSessionManager();
        const actor = configurationActor(req);
        const session = manager.closeSession(req.params.sessionId, actor);
        getHomePlacementDraftManager().discardDraft(req.params.sessionId, actor);
        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            session
        });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-sessions/close-all", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (_req, res) => {
    try {
        const manager = getConfigurationSessionManager();
        const actor = configurationActor(_req);
        const sessions = manager.closeAll(actor);
        sessions.forEach(session => getHomePlacementDraftManager().discardDraft(session.sessionId, actor));
        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            sessions
        });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-sessions/:sessionId/draft", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const draft = getHomePlacementDraftManager().createDraft(req.params.sessionId, configurationActor(req));
        res.set("Cache-Control", "no-store");
        return res.json({ success: true, draft });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-sessions/:sessionId/draft/update", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const draft = getHomePlacementDraftManager().updateDraft(req.params.sessionId, req.body?.patch || {}, configurationActor(req));
        res.set("Cache-Control", "no-store");
        return res.json({ success: true, draft });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-sessions/:sessionId/draft/validate", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const draft = await getHomePlacementDraftManager().validateDraft(req.params.sessionId, configurationActor(req));
        res.set("Cache-Control", "no-store");
        return res.json({ success: true, draft });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-sessions/:sessionId/draft/preview", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const draft = getHomePlacementDraftManager().previewDraft(req.params.sessionId, configurationActor(req));
        res.set("Cache-Control", "no-store");
        return res.json({ success: true, draft });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

router.post("/admin/configuration-sessions/:sessionId/draft/discard", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const draft = getHomePlacementDraftManager().discardDraft(req.params.sessionId, configurationActor(req));
        res.set("Cache-Control", "no-store");
        return res.json({ success: true, draft });
    } catch (error) {
        return sendConfigurationError(res, error);
    }
});

module.exports = router;
