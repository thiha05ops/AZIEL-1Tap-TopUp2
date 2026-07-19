const express = require("express");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const { requireAdminPermission, PERMISSIONS, ROLE_PERMISSIONS } = require("../services/adminAuthorizationService");
const { listAdminAuditLogs, writeAdminAudit, ADMIN_AUDIT_ACTIONS } = require("../services/adminAuditService");
const { sendPaginationError } = require("../services/paginationService");
const {
    AdminAuthError,
    changeOwnPassword,
    createAdminAccount,
    disableAdmin2FA,
    listAdminAccounts,
    listSessionsForAdmin,
    loginAdmin,
    revokeOtherSessions,
    revokeSession,
    startAdmin2FASetup,
    updateAdminAccount,
    verifyAdmin2FASetup,
    verifyAdminLogin2FA
} = require("../services/adminAuthService");

const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_ADMIN_LOGIN || 30),
    standardHeaders: true,
    legacyHeaders: false
});

const adminSensitiveLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_ADMIN_SENSITIVE || 30),
    standardHeaders: true,
    legacyHeaders: false
});

function sendAdminAuthError(res, error, context = {}) {
    if (error instanceof AdminAuthError) {
        return res.status(error.statusCode || 400).json({
            success: false,
            error: error.code,
            message: error.message
        });
    }

    const safeError = {
        route: context.route || "",
        stage: context.stage || "",
        name: error?.name || "Error",
        message: error?.message || "",
        code: error?.code || "",
        cause: error?.cause?.message || error?.cause?.code || ""
    };

    if (process.env.NODE_ENV !== "production") {
        safeError.stack = error?.stack || "";
    }

    console.error("Admin auth route error", safeError);
    return res.status(500).json({
        success: false,
        error: "ADMIN_AUTH_SERVER_ERROR",
        message: "Admin request failed."
    });
}

router.post("/admin/login", adminLoginLimiter, async (req, res) => {
    try {
        const result = await loginAdmin({
            username: req.body?.username,
            password: req.body?.password,
            req
        });

        if (result.twoFactorRequired) {
            return res.json({
                success: true,
                twoFactorRequired: true,
                error: "ADMIN_2FA_REQUIRED",
                challengeId: result.challengeId,
                expiresAt: result.expiresAt
            });
        }

        return res.json({ success: true, ...result });
    } catch (error) {
        return sendAdminAuthError(res, error, {
            route: "POST /api/admin/login",
            stage: "loginAdmin"
        });
    }
});

router.post("/admin/login/2fa", adminLoginLimiter, async (req, res) => {
    try {
        const result = await verifyAdminLogin2FA({
            challengeId: req.body?.challengeId,
            code: req.body?.code,
            req
        });

        return res.json({ success: true, ...result });
    } catch (error) {
        return sendAdminAuthError(res, error, {
            route: "POST /api/admin/login/2fa",
            stage: "verifyAdminLogin2FA"
        });
    }
});

router.get("/admin/me", adminMiddleware, async (req, res) => {
    res.json({
        success: true,
        admin: req.admin,
        permissions: req.admin.permissions || [],
        permissionMatrix: ROLE_PERMISSIONS,
        currentSession: {
            id: req.admin.sessionId,
            createdAt: req.adminSession.createdAt,
            lastSeenAt: req.adminSession.lastSeenAt,
            expiresAt: req.adminSession.expiresAt,
            userAgentSummary: req.adminSession.userAgentSummary
        }
    });
});

router.post("/admin/logout", adminMiddleware, async (req, res) => {
    try {
        await revokeSession({
            sessionId: req.admin.sessionId,
            actor: req.admin,
            reason: "logout",
            req
        });
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.ADMIN_LOGOUT,
            resourceType: "AdminSession",
            resourceId: req.admin.sessionId
        });
        return res.json({ success: true });
    } catch (error) {
        return sendAdminAuthError(res, error);
    }
});

router.get("/admin/accounts", adminMiddleware, requireAdminPermission(PERMISSIONS.ADMIN_ACCOUNTS_READ), async (req, res) => {
    try {
        const accounts = await listAdminAccounts();
        return res.json({ success: true, accounts });
    } catch (error) {
        return sendAdminAuthError(res, error);
    }
});

router.post("/admin/accounts", adminMiddleware, requireAdminPermission(PERMISSIONS.ADMIN_ACCOUNTS_MANAGE), adminSensitiveLimiter, async (req, res) => {
    try {
        const account = await createAdminAccount(req.body || {}, req.admin, req);
        return res.status(201).json({ success: true, account });
    } catch (error) {
        return sendAdminAuthError(res, error);
    }
});

router.patch("/admin/accounts/:adminId", adminMiddleware, requireAdminPermission(PERMISSIONS.ADMIN_ACCOUNTS_MANAGE), adminSensitiveLimiter, async (req, res) => {
    try {
        const account = await updateAdminAccount(req.params.adminId, req.body || {}, req.admin, req);
        return res.json({ success: true, account });
    } catch (error) {
        return sendAdminAuthError(res, error);
    }
});

router.get("/admin/sessions", adminMiddleware, requireAdminPermission(PERMISSIONS.ADMIN_SESSIONS_READ), async (req, res) => {
    try {
        const adminId = req.query.adminId && req.admin.permissions?.includes(PERMISSIONS.ADMIN_SESSIONS_REVOKE)
            ? req.query.adminId
            : req.admin.id;
        const sessions = await listSessionsForAdmin(adminId, req.admin.sessionId);
        return res.json({ success: true, sessions });
    } catch (error) {
        return sendAdminAuthError(res, error);
    }
});

router.delete("/admin/sessions/:sessionId", adminMiddleware, requireAdminPermission(PERMISSIONS.ADMIN_SESSIONS_REVOKE), adminSensitiveLimiter, async (req, res) => {
    try {
        await revokeSession({
            sessionId: req.params.sessionId,
            actor: req.admin,
            reason: "admin_revoke",
            req
        });
        return res.json({ success: true });
    } catch (error) {
        return sendAdminAuthError(res, error);
    }
});

router.post("/admin/sessions/revoke-others", adminMiddleware, requireAdminPermission(PERMISSIONS.ADMIN_SESSIONS_REVOKE), adminSensitiveLimiter, async (req, res) => {
    try {
        const count = await revokeOtherSessions({
            adminId: req.admin.id,
            currentSessionId: req.admin.sessionId,
            actor: req.admin,
            req
        });
        return res.json({ success: true, count });
    } catch (error) {
        return sendAdminAuthError(res, error);
    }
});

router.get("/admin/audit-logs", adminMiddleware, requireAdminPermission(PERMISSIONS.AUDIT_LOG_READ), async (req, res) => {
    try {
        const result = await listAdminAuditLogs(req.query || {});
        return res.json({ success: true, ...result });
    } catch (error) {
        const paginationResponse = sendPaginationError(res, error);
        if (paginationResponse) return paginationResponse;

        return sendAdminAuthError(res, error);
    }
});

router.post("/admin/security/2fa/setup", adminMiddleware, adminSensitiveLimiter, async (req, res) => {
    try {
        const setup = await startAdmin2FASetup(req.admin);
        return res.json({ success: true, setup });
    } catch (error) {
        return sendAdminAuthError(res, error);
    }
});

router.post("/admin/security/2fa/verify-setup", adminMiddleware, adminSensitiveLimiter, async (req, res) => {
    try {
        const admin = await verifyAdmin2FASetup(req.admin, req.body?.code, req);
        return res.json({ success: true, admin });
    } catch (error) {
        return sendAdminAuthError(res, error);
    }
});

router.post("/admin/security/2fa/disable", adminMiddleware, adminSensitiveLimiter, async (req, res) => {
    try {
        const admin = await disableAdmin2FA(req.admin, req.body || {}, req);
        return res.json({ success: true, admin });
    } catch (error) {
        return sendAdminAuthError(res, error);
    }
});

router.post("/admin/security/change-password", adminMiddleware, adminSensitiveLimiter, async (req, res) => {
    try {
        await changeOwnPassword(req.admin, req.body || {}, req);
        return res.json({ success: true });
    } catch (error) {
        return sendAdminAuthError(res, error);
    }
});

module.exports = router;
