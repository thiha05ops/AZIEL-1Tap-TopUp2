"use strict";

const { runtimeDebug } = require("../utils/runtimeDebug");

const crypto = require("crypto");

const {
    createManualPaymentApplicationService,
    ManualPaymentApplicationError
} = require("../services/commerce/manualPaymentApplicationService");

const {
    startCustomerManualPromptPayCheckout,
    reviewCustomerCheckout,
    CustomerManualPromptPayCheckoutError
} = require("../services/commerce/customerManualPromptPayCheckoutService");

const {
    createCommercePaymentRecoveryService,
    CommercePaymentRecoveryError
} = require("../services/commerce/commercePaymentRecoveryService");

const {
    StorageError,
    cleanupAfterFailedPersistence,
    logStorageError,
    uploadFile
} = require("../services/storageService");

function ownerFromRequest(req) {
    return {
        userId:
            req.user?.id ||
            req.user?._id ||
            req.user?.userId ||
            "",
        sessionId:
            req.sessionID ||
            req.headers["x-session-id"] ||
            ""
    };
}

function respondSuccess(res, payload, status = 200) {
    return res.status(status).json({
        success: true,
        ...payload
    });
}

function respondError(res, error) {
    if (error instanceof CustomerManualPromptPayCheckoutError) {
        return res.status(error.statusCode || 400).json({
            success: false,
            error: error.code,
            code: error.code,
            message: error.message
        });
    }

    if (error instanceof ManualPaymentApplicationError) {
        return res.status(error.httpStatus || 400).json({
            success: false,
            error: error.code,
            message: error.message,
            retryable: error.retryable === true
        });
    }

    if (error instanceof CommercePaymentRecoveryError) {
        return res.status(error.httpStatus || 400).json({
            success: false,
            error: error.code,
            code: error.code,
            message: error.message
        });
    }

    return res.status(500).json({
        success: false,
        error: "COMMERCE_MANUAL_PAYMENT_FAILED",
        message: "Manual payment operation failed."
    });
}

function receiptId() {
    return `RCP-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}

function createCommerceManualPaymentController(options = {}) {
    const service =
        options.service ||
        createManualPaymentApplicationService(
            options.serviceOptions || {}
        );

    function getRecoveryService() {
        if (
            options.recoveryService &&
            typeof options.recoveryService.listRecoverablePayments ===
            "function"
        ) {
            return options.recoveryService;
        }

        return createCommercePaymentRecoveryService(
            options.recoveryOptions || {}
        );
    }

    return Object.freeze({
        async reviewCheckout(req, res) {
            try {
                const result = await reviewCustomerCheckout(
                    req.body || {},
                    {
                        user: req.user,
                        sessionId:
                            req.sessionID ||
                            req.headers["x-session-id"] ||
                            ""
                    },
                    options.checkoutReviewOptions || {}
                );
                return respondSuccess(res, result);
            } catch (error) {
                return respondError(res, error);
            }
        },

        async listRecoverable(req, res) {
            try {
                runtimeDebug(
                    "[RECOVERY CONTROLLER] Creating recovery service"
                );

                const recoveryService = getRecoveryService();

                runtimeDebug("[RECOVERY CONTROLLER] Service resolved", {
                    serviceAvailable: Boolean(recoveryService),
                    methodAvailable:
                        typeof recoveryService?.listRecoverablePayments ===
                        "function"
                });

                if (
                    !recoveryService ||
                    typeof recoveryService.listRecoverablePayments !==
                    "function"
                ) {
                    throw new TypeError(
                        "Commerce payment recovery service factory did not return a valid service."
                    );
                }

                const recoverable =
                    await recoveryService.listRecoverablePayments({
                        user: req.user,
                        sessionId:
                            req.sessionID ||
                            req.headers["x-session-id"] ||
                            ""
                    });

                runtimeDebug(
                    "[RECOVERY CONTROLLER] Recovery completed",
                    {
                        count: Array.isArray(recoverable)
                            ? recoverable.length
                            : 0
                    }
                );

                return respondSuccess(res, {
                    recoverable
                });
            } catch (error) {
                console.error("[RECOVERY CONTROLLER] Recovery failed", {
                    name: error?.name || "",
                    code: error?.code || "",
                    message: error?.message || "",
                    details: error?.details || {},
                    stack: error?.stack || ""
                });

                return respondError(res, error);
            }
        },

        async customerPromptPayCheckout(req, res) {
            runtimeDebug("[CONTROLLER STEP 0] Request entered", {
                method: req.method,
                path: req.originalUrl,
                hasUser: Boolean(req.user),
                body: req.body || {}
            });

            try {
                runtimeDebug(
                    "[CONTROLLER STEP 1] Before checkout service"
                );

                const result =
                    await startCustomerManualPromptPayCheckout(
                        req.body || {},
                        {
                            user: req.user,
                            sessionId:
                                req.sessionID ||
                                req.headers["x-session-id"] ||
                                ""
                        },
                        options.checkoutOptions || {}
                    );

                runtimeDebug(
                    "[CONTROLLER STEP 2] Checkout service completed",
                    {
                        orderId:
                            result?.session?.commerceOrderId ||
                            result?.checkout?.orderId ||
                            "",
                        attemptId:
                            result?.session?.attemptId ||
                            result?.payment?.attemptId ||
                            "",
                        hasQr:
                            Boolean(result?.session?.qrImage) ||
                            Boolean(result?.payment?.qr?.image)
                    }
                );

                runtimeDebug(
                    "[CONTROLLER STEP 3] Sending success response"
                );

                return respondSuccess(res, result, 201);
            } catch (error) {
                console.error(
                    "[CONTROLLER ERROR] Checkout failed",
                    {
                        name: error?.name || "",
                        code: error?.code || "",
                        message: error?.message || "",
                        details: error?.details || {},
                        stage: error?.stage || "",
                        causeCode: error?.causeCode || "",
                        statusCode:
                            error?.statusCode ||
                            error?.httpStatus ||
                            0,
                        stack: error?.stack || ""
                    }
                );

                return respondError(res, error);
            }
        },

        async initiate(req, res) {
            try {
                const payment =
                    await service.initiateManualPayment({
                        orderId: req.params.orderId,
                        owner: ownerFromRequest(req),
                        idempotencyKey:
                            req.headers["idempotency-key"] ||
                            req.body?.idempotencyKey,
                        traceId:
                            req.headers["x-request-id"] ||
                            req.body?.traceId
                    });

                return respondSuccess(res, {
                    payment
                });
            } catch (error) {
                return respondError(res, error);
            }
        },

        async get(req, res) {
            try {
                const payment =
                    await service.getManualPayment({
                        orderId: req.params.orderId,
                        attemptId:
                            req.query.attemptId ||
                            req.params.attemptId,
                        owner: ownerFromRequest(req)
                    });

                return respondSuccess(res, {
                    payment
                });
            } catch (error) {
                return respondError(res, error);
            }
        },

        async attachReceipt(req, res) {
            let evidence = null;

            try {
                if (req.file) {
                    const uploaded = await uploadFile({
                        file: req.file,
                        category: "paymentSlip",
                        ownerReference: req.params.attemptId
                    });

                    const checksum = crypto
                        .createHash("sha256")
                        .update(req.file.buffer)
                        .digest("hex");

                    evidence = {
                        receiptId: receiptId(),
                        fileReference:
                            uploaded.url ||
                            uploaded.key,
                        storageProvider:
                            uploaded.provider,
                        storageKey:
                            uploaded.key,
                        mimeType:
                            uploaded.mimeType,
                        fileSize:
                            uploaded.size,
                        checksum,
                        uploadedAt:
                            new Date().toISOString()
                    };
                }

                const payment =
                    await service.attachReceiptEvidence({
                        orderId: req.params.orderId,
                        attemptId: req.params.attemptId,
                        owner: ownerFromRequest(req),
                        evidence:
                            evidence ||
                            req.body?.receiptEvidence ||
                            req.body?.evidence ||
                            req.body,
                        storageCommitted:
                            Boolean(evidence) ||
                            req.body?.storageCommitted === true
                    });

                return respondSuccess(res, {
                    payment
                });
            } catch (error) {
                if (evidence) {
                    await cleanupAfterFailedPersistence({
                        provider:
                            evidence.storageProvider ||
                            "",
                        key:
                            evidence.storageKey ||
                            evidence.fileReference ||
                            ""
                    });
                }

                if (error instanceof StorageError) {
                    logStorageError(error.code, {
                        provider: error.provider,
                        category: "paymentSlip",
                        orderId: req.params.orderId
                    });
                }

                return respondError(res, error);
            }
        },

        async approve(req, res) {
            try {
                const payment =
                    await service.approveManualPayment({
                        attemptId: req.params.attemptId,
                        admin: req.admin,
                        providerEventId:
                            req.body?.providerEventId,
                        note: req.body?.note
                    });

                return respondSuccess(res, {
                    payment
                });
            } catch (error) {
                return respondError(res, error);
            }
        },

        async reject(req, res) {
            try {
                const payment =
                    await service.rejectManualPayment({
                        attemptId: req.params.attemptId,
                        admin: req.admin,
                        providerEventId:
                            req.body?.providerEventId,
                        reason:
                            req.body?.reason ||
                            req.body?.note
                    });

                return respondSuccess(res, {
                    payment
                });
            } catch (error) {
                return respondError(res, error);
            }
        },

        async cancel(req, res) {
            try {
                const payment =
                    await service.cancelManualPayment({
                        attemptId: req.params.attemptId,
                        owner: ownerFromRequest(req)
                    });

                return respondSuccess(res, {
                    payment
                });
            } catch (error) {
                return respondError(res, error);
            }
        }
    });
}

module.exports = Object.freeze({
    createCommerceManualPaymentController,
    ownerFromRequest
});
