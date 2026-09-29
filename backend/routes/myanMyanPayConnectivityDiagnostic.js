"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const { checkMyanMyanPaySandboxConnectivity } = require("../services/myanmyanpay/myanMyanPayConnectivityService");

const CONFIRMATION = "CHECK_MYANMYANPAY_SANDBOX_CONNECTIVITY";

function createMyanMyanPayConnectivityDiagnosticRouter(options = {}) {
    const router = express.Router();
    const limiter = options.limiter || rateLimit({ windowMs: 15 * 60 * 1000, limit: 3, standardHeaders: true, legacyHeaders: false });
    const connectivityCheck = options.connectivityCheck || checkMyanMyanPaySandboxConnectivity;
    const auditWriter = options.auditWriter || writeAdminAudit;
    router.post(
        "/admin/payment-providers/myanmyanpay/sandbox-connectivity-check",
        limiter,
        adminMiddleware,
        requireAdminPermission(PERMISSIONS.PAYMENT_METHODS_MANAGE),
        async (req, res) => {
            const body = req.body || {};
            const validConfirmation = body.confirmation === CONFIRMATION && Object.keys(body).length === 1;
            if (!validConfirmation) {
                await auditWriter({ actor: req.admin, req, action: ADMIN_AUDIT_ACTIONS.MYANMYANPAY_SANDBOX_CONNECTIVITY_CHECK, resourceType: "PaymentProvider", resourceId: "MYANMYANPAY_SANDBOX", metadata: { success: false, outcome: "CONFIRMATION_REJECTED" } }).catch(() => null);
                return res.status(400).json({ success: false, code: "MYANMYANPAY_CONNECTIVITY_CONFIRMATION_REQUIRED", message: "Explicit MyanMyanPay Sandbox connectivity confirmation is required." });
            }
            try {
                const result = await connectivityCheck();
                await auditWriter({ actor: req.admin, req, action: ADMIN_AUDIT_ACTIONS.MYANMYANPAY_SANDBOX_CONNECTIVITY_CHECK, resourceType: "PaymentProvider", resourceId: "MYANMYANPAY_SANDBOX", metadata: result });
                return res.json(result);
            } catch (_) {
                const result = { success: false, target: "MYANMYANPAY_SANDBOX", code: "MYANMYANPAY_CONNECTIVITY_CHECK_FAILED" };
                await auditWriter({ actor: req.admin, req, action: ADMIN_AUDIT_ACTIONS.MYANMYANPAY_SANDBOX_CONNECTIVITY_CHECK, resourceType: "PaymentProvider", resourceId: "MYANMYANPAY_SANDBOX", metadata: result }).catch(() => null);
                return res.status(503).json(result);
            }
        }
    );
    return router;
}

const router = createMyanMyanPayConnectivityDiagnosticRouter();
module.exports = router;
module.exports.createMyanMyanPayConnectivityDiagnosticRouter = createMyanMyanPayConnectivityDiagnosticRouter;
module.exports._test = Object.freeze({ CONFIRMATION });
