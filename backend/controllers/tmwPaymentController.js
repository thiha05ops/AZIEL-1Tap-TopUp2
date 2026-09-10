"use strict";

const { createTmwPaymentApplicationService, TmwPaymentApplicationError } = require("../services/commerce/tmwPaymentApplicationService");
const { createTmwPaymentWebhookService, TmwWebhookError } = require("../services/commerce/tmwPaymentWebhookService");

function contextFromRequest(req) {
    return { user: req.user, sessionId: req.sessionID || req.headers["x-session-id"] || "", clientIp: req.ip || req.socket?.remoteAddress || "" };
}
function safeError(res, error, webhook = false) {
    const known = error instanceof TmwPaymentApplicationError || error instanceof TmwWebhookError;
    return res.status(known ? error.statusCode : 500).json(webhook
        ? { status: 0 }
        : { success: false, code: known ? error.code : "TMW_PAYMENT_FAILED", message: known ? error.message : "TMW payment operation failed." });
}

function createTmwPaymentController(options = {}) {
    const application = options.application || createTmwPaymentApplicationService(options.applicationOptions || {});
    const webhookService = options.webhookService || createTmwPaymentWebhookService({ ...(options.webhookOptions || {}), application });
    return Object.freeze({
        async checkout(req, res) {
            try { return res.status(201).json({ success: true, ...(await application.startCheckout(req.body || {}, contextFromRequest(req))) }); }
            catch (error) { return safeError(res, error); }
        },
        async refresh(req, res) {
            try { return res.json({ success: true, payment: await application.refresh({ attemptId: req.params.attemptId }, contextFromRequest(req)) }); }
            catch (error) { return safeError(res, error); }
        },
        async status(req, res) {
            try { return res.json({ success: true, payment: await application.getStatus({ attemptId: req.params.attemptId }, contextFromRequest(req)) }); }
            catch (error) { return safeError(res, error); }
        },
        async webhook(req, res) {
            try { await webhookService.processWebhook({ data: req.body?.data, signature: req.body?.signature }); return res.status(200).json({ status: 1 }); }
            catch (error) { return safeError(res, error, true); }
        }
    });
}

module.exports = Object.freeze({ createTmwPaymentController, contextFromRequest });
