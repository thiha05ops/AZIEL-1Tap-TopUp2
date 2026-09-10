"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const authMiddleware = require("../middleware/authMiddleware");
const { createTmwPaymentController } = require("../controllers/tmwPaymentController");

function createTmwPaymentRoutes(options = {}) {
    const router = express.Router();
    const controller = options.controller || createTmwPaymentController(options.controllerOptions || {});
    const webhookLimiter = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.RATE_LIMIT_TMW_WEBHOOK || 120), standardHeaders: true, legacyHeaders: false });
    router.post("/commerce/checkout/tmw-promptpay", authMiddleware, controller.checkout);
    router.get("/commerce/payments/tmw/:attemptId", authMiddleware, controller.status);
    router.post("/commerce/payments/tmw/:attemptId/refresh", authMiddleware, controller.refresh);
    router.post("/payment/tmw/webhook", webhookLimiter, controller.webhook);
    return router;
}

module.exports = createTmwPaymentRoutes;
