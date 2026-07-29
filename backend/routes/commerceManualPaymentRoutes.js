"use strict";

const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const upload = require("../middleware/orderUpload");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { createCommerceManualPaymentController } = require("../controllers/commerceManualPaymentController");

function createCommerceManualPaymentRoutes(options = {}) {
    const router = express.Router();
    const controller = options.controller || createCommerceManualPaymentController(options.controllerOptions || {});

    router.get(
        "/commerce/payments/recoverable",
        authMiddleware,
        controller.listRecoverable
    );

    router.post(
        "/commerce/checkout/manual-promptpay",
        authMiddleware,
        controller.customerPromptPayCheckout
    );

    router.post(
        "/commerce/orders/:orderId/payments/manual-promptpay/initiate",
        authMiddleware,
        controller.initiate
    );

    router.get(
        "/commerce/orders/:orderId/payments/manual-promptpay",
        authMiddleware,
        controller.get
    );

    router.post(
        "/commerce/orders/:orderId/payments/:attemptId/receipt",
        authMiddleware,
        upload.single("slip"),
        controller.attachReceipt
    );

    router.post(
        "/commerce/orders/:orderId/payments/:attemptId/cancel",
        authMiddleware,
        controller.cancel
    );

    router.post(
        "/admin/commerce/payments/:attemptId/approve",
        adminMiddleware,
        requireAdminPermission(PERMISSIONS.ORDERS_MANAGE),
        controller.approve
    );

    router.post(
        "/admin/commerce/payments/:attemptId/reject",
        adminMiddleware,
        requireAdminPermission(PERMISSIONS.ORDERS_MANAGE),
        controller.reject
    );

    return router;
}

module.exports = createCommerceManualPaymentRoutes;
module.exports.createCommerceManualPaymentRoutes = createCommerceManualPaymentRoutes;
