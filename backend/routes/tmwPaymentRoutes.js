"use strict";

const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const authMiddleware = require("../middleware/authMiddleware");
const { createTmwPaymentController } = require("../controllers/tmwPaymentController");

const WEBHOOK_BODY_LIMIT = "16kb";
const webhookJsonParser = express.json({ limit: WEBHOOK_BODY_LIMIT });
const webhookFormParser = express.urlencoded({ extended: false, limit: WEBHOOK_BODY_LIMIT, type: () => true });
const webhookMultipartParser = multer({ storage: multer.memoryStorage(), limits: { fields: 4, fieldSize: 16 * 1024, files: 0 } }).none();

function parseTmwWebhookBody(req, res, next) {
    const parser = req.is("application/json")
        ? webhookJsonParser
        : req.is("multipart/form-data")
            ? webhookMultipartParser
            : webhookFormParser;
    return parser(req, res, error => error ? res.status(400).json({ status: 0 }) : next());
}

function createTmwWebhookRoutes(options = {}) {
    const router = express.Router();
    const controller = options.controller || createTmwPaymentController(options.controllerOptions || {});
    const webhookLimiter = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.RATE_LIMIT_TMW_WEBHOOK || 120), standardHeaders: true, legacyHeaders: false });
    router.post("/payment/tmw/webhook", webhookLimiter, parseTmwWebhookBody, controller.webhook);
    return router;
}

function createTmwPaymentRoutes(options = {}) {
    const router = express.Router();
    const controller = options.controller || createTmwPaymentController(options.controllerOptions || {});
    router.post("/commerce/checkout/tmw-promptpay", authMiddleware, controller.checkout);
    router.get("/commerce/payments/tmw/:attemptId", authMiddleware, controller.status);
    router.post("/commerce/payments/tmw/:attemptId/refresh", authMiddleware, controller.refresh);
    return router;
}

module.exports = createTmwPaymentRoutes;
module.exports.createTmwWebhookRoutes = createTmwWebhookRoutes;
module.exports.parseTmwWebhookBody = parseTmwWebhookBody;
