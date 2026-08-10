"use strict";

const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const upload = require("../middleware/orderUpload");
const {
    PERMISSIONS,
    requireAdminPermission
} = require("../services/adminAuthorizationService");
const {
    createCommerceManualPaymentController
} = require("../controllers/commerceManualPaymentController");
const { runtimeDebug } = require("../utils/runtimeDebug");

function requestProbe(req, res, next) {
    const startedAt = Date.now();

    runtimeDebug("[COMMERCE ROUTE PROBE] Request entered", {
        method: req.method,
        originalUrl: req.originalUrl,
        path: req.path,
        hasAuthorization: Boolean(req.headers.authorization),
        hasSessionId: Boolean(
            req.sessionID ||
            req.headers["x-session-id"]
        )
    });

    res.once("finish", () => {
        runtimeDebug("[COMMERCE ROUTE PROBE] Response finished", {
            method: req.method,
            originalUrl: req.originalUrl,
            statusCode: res.statusCode,
            elapsedMs: Date.now() - startedAt
        });
    });

    res.once("close", () => {
        if (!res.writableEnded) {
            console.warn("[COMMERCE ROUTE PROBE] Connection closed before response", {
                method: req.method,
                originalUrl: req.originalUrl,
                elapsedMs: Date.now() - startedAt
            });
        }
    });

    next();
}

function createCommerceManualPaymentRoutes(options = {}) {
    const router = express.Router();

    const controller =
        options.controller ||
        createCommerceManualPaymentController(
            options.controllerOptions || {}
        );

    router.get(
        "/commerce/payments/recoverable",
        requestProbe,
        authMiddleware,
        controller.listRecoverable
    );

    router.post(
        "/commerce/checkout/review",
        requestProbe,
        authMiddleware,
        controller.reviewCheckout
    );

    router.post(
        "/commerce/checkout/manual-promptpay",
        requestProbe,
        authMiddleware,
        controller.customerPromptPayCheckout
    );

    router.post(
        "/commerce/orders/:orderId/payments/manual-promptpay/initiate",
        requestProbe,
        authMiddleware,
        controller.initiate
    );

    router.get(
        "/commerce/orders/:orderId/payments/manual-promptpay",
        requestProbe,
        authMiddleware,
        controller.get
    );

    router.post(
        "/commerce/orders/:orderId/payments/:attemptId/receipt",
        requestProbe,
        authMiddleware,
        upload.single("slip"),
        controller.attachReceipt
    );

    router.post(
        "/commerce/orders/:orderId/payments/:attemptId/cancel",
        requestProbe,
        authMiddleware,
        controller.cancel
    );

    router.post(
        "/admin/commerce/payments/:attemptId/approve",
        requestProbe,
        adminMiddleware,
        requireAdminPermission(PERMISSIONS.ORDERS_MANAGE),
        controller.approve
    );

    router.post(
        "/admin/commerce/payments/:attemptId/reject",
        requestProbe,
        adminMiddleware,
        requireAdminPermission(PERMISSIONS.ORDERS_MANAGE),
        controller.reject
    );

    return router;
}

module.exports = createCommerceManualPaymentRoutes;
module.exports.createCommerceManualPaymentRoutes =
    createCommerceManualPaymentRoutes;
