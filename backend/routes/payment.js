// backend/routes/payment.js

const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const Omise = require("../services/opnService");
const upload = require("../middleware/orderUpload");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");

const Order = require("../models/Order");
const ManualPaymentAttempt = require("../models/ManualPaymentAttempt");
const PaymentMethod = require("../models/PaymentMethod");
const WalletTopup = require("../models/WalletTopup");

const wavepayService = require("../services/wavepayService");
const realtime = require("../services/realtime");
const notificationService = require("../services/notificationService");
const { ORDER_STATES, PAYMENT_STATES, transitionOrder } = require("../services/orderStateService");
const { applyPaymentToOrder, mapOmiseChargeStatus } = require("../services/paymentStateService");
const { CatalogError } = require("../services/catalogService");
const { creditTopup, getWalletBalance } = require("../services/walletService");
const { getActivePendingOrderPolicy } = require("../services/pendingOrderPolicy");
const {
    PromoError,
    consumePromoRedemption,
    releasePromoRedemption,
    reservePromoUse,
    resolvePurchasePricing
} = require("../services/promoCodeService");
const {
    createAttemptId,
    createManualReference,
    getManualAttemptLimit,
    getManualAttemptTtlMs,
    isTransactionUnsupported,
    normalizePaymentKey,
    projectPaymentInstructions
} = require("../services/manualPaymentAttemptService");
const {
    OmisePaymentError,
    assertChargeMatchesRecord,
    retrieveVerifiedCharge
} = require("../services/omisePaymentService");
const {
    StorageError,
    cleanupAfterFailedPersistence,
    logStorageError,
    uploadFile
} = require("../services/storageService");

const isProduction = process.env.NODE_ENV === "production";
const activeOrderCreateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_ORDER_CREATE || 12),
    standardHeaders: true,
    legacyHeaders: false
});

const manualAttemptLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MANUAL_ATTEMPT || 20),
    standardHeaders: true,
    legacyHeaders: false
});

function devLog(...args) {
    if (!isProduction) console.log(...args);
}

function getCurrencyKey(currency) {
    return currency === "THB" ? "THB" : "MMK";
}

function isManualPaymentType(value) {
    return ["manual", "deeplink"].includes(String(value || "").toLowerCase());
}

function manualAttemptOrderSnapshot(attempt) {
    return {
        orderId: attempt.reference,
        manualPaymentAttemptId: attempt.attemptId,
        game: attempt.productName,
        productCode: attempt.productCode,
        productName: attempt.productName,
        packageName: attempt.packageName,
        packageCode: attempt.packageCode,
        amount: attempt.finalAmount || attempt.canonicalAmount,
        originalAmount: attempt.originalAmount || attempt.canonicalAmount,
        discountAmount: attempt.discountAmount || 0,
        finalAmount: attempt.finalAmount || attempt.canonicalAmount,
        promoCode: attempt.promoCode || "",
        promoSnapshot: attempt.promoSnapshot || null,
        currency: attempt.canonicalCurrency,
        region: attempt.region,
        paymentMethod: attempt.paymentMethod,
        paymentType: attempt.paymentType,
        provider: attempt.provider,
        userId: attempt.gameUserData?.userId || "",
        zoneId: attempt.gameUserData?.zoneId || "-"
    };
}

function publicManualAttempt(attempt) {
    const instructions = {
        method: attempt.instructions?.method || "Payment",
        key: attempt.instructions?.key || attempt.paymentMethod,
        accountName: attempt.instructions?.accountName || "",
        accountNumber: attempt.instructions?.accountNumber || "",
        qrImage: attempt.instructions?.qrImage || "",
        reference: attempt.reference
    };

    return {
        attemptId: attempt.attemptId,
        reference: attempt.reference,
        expiresAt: attempt.expiresAt,
        paymentType: attempt.paymentType,
        provider: attempt.provider,
        paymentName: instructions.method,
        accountName: instructions.accountName,
        accountNumber: instructions.accountNumber,
        qrImage: instructions.qrImage,
        qrUrl: instructions.qrImage,
        amount: attempt.finalAmount || attempt.canonicalAmount,
        originalAmount: attempt.originalAmount || attempt.canonicalAmount,
        discountAmount: attempt.discountAmount || 0,
        finalAmount: attempt.finalAmount || attempt.canonicalAmount,
        promoCode: attempt.promoCode || "",
        promoSnapshot: attempt.promoSnapshot || null,
        currency: attempt.canonicalCurrency,
        productName: attempt.productName,
        packageName: attempt.packageName,
        paymentMethod: attempt.paymentMethod,
        instructions,
        order: manualAttemptOrderSnapshot(attempt)
    };
}

async function getEnabledManualPaymentMethod(paymentMethod, region) {
    const methodKey = normalizePaymentKey(paymentMethod);
    if (!methodKey) return null;

    const method = await PaymentMethod.findOne({
        key: methodKey,
        region,
        enabled: true
    });

    if (!method || !isManualPaymentType(method.paymentType)) return null;
    return method;
}

async function createManualAttemptRecord(payload) {
    let lastError = null;

    for (let i = 0; i < 3; i++) {
        try {
            return await ManualPaymentAttempt.create({
                ...payload,
                attemptId: i === 0 && payload.attemptId ? payload.attemptId : createAttemptId(),
                reference: i === 0 && payload.reference ? payload.reference : createManualReference()
            });
        } catch (error) {
            lastError = error;
            if (error?.code !== 11000) break;
        }
    }

    throw lastError;
}

function createPromptPayCharge(amount, metadata = {}) {
    return new Promise((resolve, reject) => {
        Omise.sources.create(
            {
                type: "promptpay",
                amount: Number(amount) * 100,
                currency: "THB"
            },
            (err, source) => {
                if (err) return reject(err);

                Omise.charges.create(
                    {
                        amount: Number(amount) * 100,
                        currency: "THB",
                        source: source.id,
                        metadata
                    },
                    (err, charge) => {
                        if (err) return reject(err);
                        resolve({ source, charge });
                    }
                );
            }
        );
    });
}

function getQrUrl(source, charge) {
    return (
        source?.scannable_code?.image?.download_uri ||
        source?.scannable_code?.image?.uri ||
        charge?.source?.scannable_code?.image?.download_uri ||
        charge?.source?.scannable_code?.image?.uri ||
        ""
    );
}

function safePaymentLog(code, details = {}) {
    console.warn("OMISE WEBHOOK:", {
        code,
        provider: "omise",
        chargeId: details.chargeId || "",
        orderId: details.orderId || "",
        topupId: details.topupId || "",
        at: new Date().toISOString()
    });
}

function extractWebhookChargeId(body = {}) {
    const eventKey = String(body.key || "").trim();

    if (eventKey !== "charge.complete") {
        return {
            supported: false,
            code: "OMISE_EVENT_UNSUPPORTED",
            eventKey
        };
    }

    const chargeId = String(body.data?.id || "").trim();

    if (!chargeId) {
        throw new OmisePaymentError(
            "OMISE_CHARGE_ID_MISSING",
            "Webhook is missing provider charge ID.",
            400
        );
    }

    return {
        supported: true,
        eventKey,
        chargeId
    };
}

function verifiedPaymentEventId(charge) {
    return [
        "omise",
        charge.chargeId,
        charge.status,
        charge.providerUpdatedAt || "verified"
    ].join(":");
}

async function markWalletTopupPaid(req, topupId, transactionId = "") {
    const topup = await WalletTopup.findOne({ topupId });

    if (!topup) {
        return { success: false, message: "Topup not found" };
    }

    const currencyKey = getCurrencyKey(topup.currency);

    if (["approved", "paid", "completed"].includes(topup.status)) {
        return {
            success: true,
            message: "Wallet topup already credited",
            topup,
            balance: await getWalletBalance(topup.username, currencyKey),
            duplicate: true
        };
    }

    const creditResult = await creditTopup(topup, {
        performedBy: "payment_provider"
    });

    topup.status = "paid";
    topup.transactionId = transactionId || topup.transactionId || "";
    topup.note = "Wallet balance added automatically by webhook";
    topup.paidAt = new Date();

    await topup.save();

    if (!creditResult.duplicate) {
        await notificationService.createUserNotification({
            username: topup.username,
            title: "Wallet Top-Up Successful",
            message: `${Number(topup.amount).toLocaleString()} ${currencyKey} has been added to your wallet.`,
            type: "system",
            category: "wallet",
            topupId: topup.topupId,
            metadata: {
                topupId: topup.topupId,
                amount: topup.amount,
                currency: currencyKey
            },
            source: "wallet_topup_paid"
        });
    }

    await realtime.emitWalletUpdate(topup.username, {
        amount: creditResult.balance,
        balance: creditResult.balance,
        currency: currencyKey,
        status: "paid",
        topupId: topup.topupId,
        latestTransaction: {
            type: creditResult.transaction?.type || "",
            direction: creditResult.transaction?.direction || "",
            amount: Number(creditResult.transaction?.amount || 0),
            balanceAfter: Number(creditResult.transaction?.balanceAfter ?? creditResult.balance),
            referenceType: creditResult.transaction?.referenceType || "",
            referenceId: creditResult.transaction?.referenceId || topup.topupId,
            createdAt: creditResult.transaction?.createdAt || new Date()
        }
    });

    await realtime.emitWalletTopupUpdate(topup.username, {
        topupId: topup.topupId,
        status: topup.status,
        amount: topup.amount,
        currency: currencyKey,
        paymentMethod: topup.paymentMethod
    });

    realtime.emitAdminWalletUpdate({
        type: "wallet_topup_paid",
        username: topup.username,
        amount: topup.amount,
        currency: currencyKey
    });

    return {
        success: true,
        message: "Wallet topup paid",
        topup,
        balance: creditResult.balance,
        transaction: creditResult.transaction,
        duplicate: Boolean(creditResult.duplicate)
    };
}

async function createOrderFromManualAttempt(attempt, evidence, username) {
    const existing = await Order.findOne({
        manualPaymentAttemptId: attempt.attemptId
    });

    if (existing) {
        return {
            order: existing,
            duplicate: true
        };
    }

    const now = new Date();
    const orderPayload = {
        orderId: attempt.reference,
        username,
        game: attempt.productName,
        productCode: attempt.productCode,
        productName: attempt.productName,
        userId: attempt.gameUserData.userId,
        zoneId: attempt.gameUserData.zoneId || "",
        packageName: attempt.packageName,
        packageCode: attempt.packageCode,
        amount: attempt.finalAmount || attempt.canonicalAmount,
        originalAmount: attempt.originalAmount || attempt.canonicalAmount,
        discountAmount: attempt.discountAmount || 0,
        finalAmount: attempt.finalAmount || attempt.canonicalAmount,
        promoCode: attempt.promoCode || "",
        promoSnapshot: attempt.promoSnapshot || null,
        currency: attempt.canonicalCurrency,
        region: attempt.region,
        paymentMethod: attempt.paymentMethod,
        status: ORDER_STATES.PENDING_PAYMENT,
        paymentStatus: PAYMENT_STATES.PENDING,
        paymentSlip: evidence.url,
        paymentEvidence: evidence,
        transactionId: "",
        paymentProvider: attempt.provider || "manual",
        manualPaymentAttemptId: attempt.attemptId,
        note: "Payment slip uploaded. Waiting for admin verification.",
        timeline: [{
            status: ORDER_STATES.PENDING_PAYMENT,
            previousStatus: "",
            paymentStatus: PAYMENT_STATES.PENDING,
            source: "user",
            actorType: "user",
            actor: username,
            reason: "Manual payment slip submitted",
            idempotencyKey: `manual:submit:${attempt.attemptId}`,
            at: now
        }]
    };

    const session = await mongoose.startSession();

    try {
        let createdOrder = null;
        let duplicateOrder = false;

        await session.withTransaction(async () => {
            const activeAttempt = await ManualPaymentAttempt.findOne({
                _id: attempt._id,
                username,
                status: "active",
                consumedAt: null,
                expiresAt: { $gt: new Date() }
            }).session(session);

            if (!activeAttempt) {
                const existingOrder = await Order.findOne({
                    manualPaymentAttemptId: attempt.attemptId
                }).session(session);

                if (existingOrder) {
                    createdOrder = existingOrder;
                    duplicateOrder = true;
                    return;
                }

                const consumed = await ManualPaymentAttempt.findById(attempt._id).session(session);
                const code = consumed?.status === "consumed"
                    ? "MANUAL_PAYMENT_ATTEMPT_CONSUMED"
                    : "MANUAL_PAYMENT_ATTEMPT_EXPIRED";
                throw Object.assign(new Error(code), {
                    code,
                    statusCode: code === "MANUAL_PAYMENT_ATTEMPT_EXPIRED" ? 410 : 409
                });
            }

            const [order] = await Order.create([orderPayload], { session });
            createdOrder = order;

            activeAttempt.status = "consumed";
            activeAttempt.consumedAt = now;
            activeAttempt.orderId = order.orderId;
            activeAttempt.evidence = evidence;
            await activeAttempt.save({ session });
        });

        await consumePromoRedemption(attempt.promoRedemptionId, createdOrder?.orderId);

        return {
            order: createdOrder,
            duplicate: duplicateOrder
        };
    } catch (error) {
        if (error?.code === 11000) {
            const duplicate = await Order.findOne({
                manualPaymentAttemptId: attempt.attemptId
            });

            if (duplicate) {
                return {
                    order: duplicate,
                    duplicate: true
                };
            }
        }

        if (isTransactionUnsupported(error)) {
            return createOrderFromManualAttemptWithoutTransaction(
                attempt,
                evidence,
                username,
                orderPayload
            );
        }

        throw error;
    } finally {
        await session.endSession();
    }
}

async function createOrderFromManualAttemptWithoutTransaction(attempt, evidence, username, orderPayload) {
    const existing = await Order.findOne({
        manualPaymentAttemptId: attempt.attemptId
    });

    if (existing) {
        return {
            order: existing,
            duplicate: true
        };
    }

    const activeAttempt = await ManualPaymentAttempt.findOne({
        _id: attempt._id,
        username,
        status: "active",
        consumedAt: null,
        expiresAt: { $gt: new Date() }
    });

    if (!activeAttempt) {
        throw Object.assign(new Error("MANUAL_PAYMENT_ATTEMPT_EXPIRED"), {
            code: "MANUAL_PAYMENT_ATTEMPT_EXPIRED",
            statusCode: 410
        });
    }

    let createdOrder = null;

    try {
        createdOrder = await Order.create(orderPayload);

        const update = await ManualPaymentAttempt.updateOne(
            {
                _id: attempt._id,
                username,
                status: "active",
                consumedAt: null,
                expiresAt: { $gt: new Date() }
            },
            {
                $set: {
                    status: "consumed",
                    consumedAt: new Date(),
                    orderId: createdOrder.orderId,
                    evidence
                }
            }
        );

        if (update.modifiedCount === 1) {
            await consumePromoRedemption(attempt.promoRedemptionId, createdOrder.orderId);
            return {
                order: createdOrder,
                duplicate: false
            };
        }

        await Order.deleteOne({ _id: createdOrder._id });

        const duplicate = await Order.findOne({
            manualPaymentAttemptId: attempt.attemptId
        });

        if (duplicate) {
            return {
                order: duplicate,
                duplicate: true
            };
        }

        throw Object.assign(new Error("MANUAL_PAYMENT_ATTEMPT_CONSUMED"), {
            code: "MANUAL_PAYMENT_ATTEMPT_CONSUMED",
            statusCode: 409
        });
    } catch (error) {
        if (error?.code === 11000) {
            const duplicate = await Order.findOne({
                manualPaymentAttemptId: attempt.attemptId
            });

            if (duplicate) {
                return {
                    order: duplicate,
                    duplicate: true
                };
            }
        }

        if (createdOrder?._id) {
            await Order.deleteOne({ _id: createdOrder._id });
        }

        throw error;
    }
}

async function emitManualOrderSubmitted(req, order, duplicate = false) {
    if (duplicate) return;

    await notificationService.createUserNotification({
        username: order.username,
        title: "Payment Slip Submitted",
        message: `${order.game} - ${order.packageName} payment slip has been submitted.`,
        type: "order",
        category: "orders",
        orderId: order.orderId,
        action: {
            type: "navigate",
            label: "View Order",
            url: `/tracking.html?orderId=${encodeURIComponent(order.orderId)}`
        },
        metadata: {
            orderId: order.orderId,
            game: order.game,
            amount: order.amount,
            currency: order.currency
        },
        source: "manual_payment_submit"
    });

    await realtime.emitOrderUpdate(order.username, order);

    realtime.emitAdminOrderUpdate({
        type: "payment_slip_uploaded",
        orderId: order.orderId,
        username: order.username,
        game: order.game,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        paymentStatus: order.paymentStatus
    });
}

// MANUAL / DEEPLINK PAYMENT ATTEMPT
// POST /api/payment/manual/attempt
router.post("/payment/manual/attempt", authMiddleware, manualAttemptLimiter, async (req, res) => {
    let reservedRedemption = null;
    try {
        const {
            game,
            gameKey,
            productCode,
            packageName,
            packageCode,
            region,
            paymentMethod,
            promoCode,
            userId,
            zoneId
        } = req.body;
        const username = req.user.username;

        if (!paymentMethod || !userId) {
            return res.status(400).json({
                success: false,
                code: "MANUAL_PAYMENT_ATTEMPT_INVALID",
                message: "Missing manual payment data"
            });
        }

        const pricing = await resolvePurchasePricing({
            payload: {
                productCode: productCode || gameKey,
                gameKey,
                game,
                packageCode,
                packageName,
                region,
                promoCode
            },
            user: req.user,
            verifyUserLimit: true
        });
        const catalogItem = pricing.catalogItem;

        const redemption = await reservePromoUse({
            pricing,
            user: req.user,
            manualPaymentAttemptId: "",
            expiresAt: new Date(Date.now() + getManualAttemptTtlMs())
        });
        reservedRedemption = redemption;

        const expiresAt = redemption?.expiresAt || new Date(Date.now() + getManualAttemptTtlMs());

        const method = await getEnabledManualPaymentMethod(paymentMethod, catalogItem.region);

        if (!method) {
            await releasePromoRedemption(redemption?._id);
            return res.status(400).json({
                success: false,
                code: "MANUAL_PAYMENT_METHOD_UNAVAILABLE",
                message: "This manual payment method is not available."
            });
        }

        const activeCount = await ManualPaymentAttempt.countDocuments({
            username,
            status: "active",
            expiresAt: { $gt: new Date() }
        });
        const attemptLimit = getManualAttemptLimit();

        if (activeCount >= attemptLimit) {
            await releasePromoRedemption(redemption?._id);
            return res.status(429).json({
                success: false,
                code: "MANUAL_PAYMENT_ATTEMPT_LIMIT",
                message: "You have several active payment attempts. Please complete one or wait for an older attempt to expire.",
                activeAttemptCount: activeCount,
                limit: attemptLimit
            });
        }

        const attemptId = createAttemptId();
        if (redemption) {
            redemption.manualPaymentAttemptId = attemptId;
            await redemption.save();
        }

        const attemptSeed = {
            attemptId,
            username,
            productCode: catalogItem.productCode,
            packageCode: catalogItem.packageCode,
            region: catalogItem.region,
            canonicalAmount: pricing.finalAmount,
            canonicalCurrency: pricing.currency,
            originalAmount: pricing.originalAmount,
            discountAmount: pricing.discountAmount,
            finalAmount: pricing.finalAmount,
            promoCode: pricing.promoCode,
            promoSnapshot: pricing.promoSnapshot,
            promoRedemptionId: redemption?._id || null,
            productName: catalogItem.productName,
            packageName: catalogItem.packageName,
            paymentMethod: method.key,
            paymentType: method.paymentType,
            provider: method.provider || "manual",
            gameUserData: {
                userId: String(userId || "").trim(),
                zoneId: String(zoneId || "").trim() || "-"
            },
            expiresAt
        };
        const reference = createManualReference();
        const instructions = projectPaymentInstructions(method.toObject(), reference);
        const attempt = await createManualAttemptRecord({
            ...attemptSeed,
            reference,
            instructions: {
                method: instructions.method,
                key: instructions.key,
                accountName: instructions.accountName,
                accountNumber: instructions.accountNumber,
                qrImage: instructions.qrImage
            }
        });
        reservedRedemption = null;

        return res.json({
            success: true,
            ...publicManualAttempt(attempt)
        });
    } catch (error) {
        console.log("Manual payment attempt error:", error);
        await releasePromoRedemption(reservedRedemption?._id);

        if (error instanceof CatalogError || error instanceof PromoError) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            code: "MANUAL_PAYMENT_ATTEMPT_FAILED",
            message: "Manual payment attempt failed"
        });
    }
});

// MANUAL / DEEPLINK PAYMENT SLIP SUBMIT
// POST /api/payment/manual/attempt/:attemptId/slip
router.post("/payment/manual/attempt/:attemptId/slip", authMiddleware, upload.single("slip"), async (req, res) => {
    let evidence = null;
    let orderCreated = false;

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                code: "MANUAL_PAYMENT_SLIP_REQUIRED",
                message: "Please upload payment slip"
            });
        }

        const attempt = await ManualPaymentAttempt.findOne({
            attemptId: req.params.attemptId,
            username: req.user.username
        });

        if (!attempt) {
            return res.status(404).json({
                success: false,
                code: "MANUAL_PAYMENT_ATTEMPT_NOT_FOUND",
                message: "Payment attempt not found"
            });
        }

        if (attempt.status === "consumed") {
            const existingOrder = await Order.findOne({
                manualPaymentAttemptId: attempt.attemptId,
                username: req.user.username
            });

            if (existingOrder) {
                return res.json({
                    success: true,
                    code: "MANUAL_PAYMENT_ORDER_ALREADY_CREATED",
                    duplicate: true,
                    message: "Payment slip already submitted",
                    order: existingOrder
                });
            }

            return res.status(409).json({
                success: false,
                code: "MANUAL_PAYMENT_ATTEMPT_CONSUMED",
                message: "Payment attempt has already been used"
            });
        }

        if (attempt.status !== "active" || attempt.expiresAt <= new Date()) {
            if (attempt.status === "active") {
                attempt.status = "expired";
                await attempt.save();
                await releasePromoRedemption(attempt.promoRedemptionId);
            }

            return res.status(410).json({
                success: false,
                code: "MANUAL_PAYMENT_ATTEMPT_EXPIRED",
                message: "Payment attempt expired. Please start again."
            });
        }

        evidence = await uploadFile({
            file: req.file,
            category: "paymentSlip",
            ownerReference: attempt.reference
        });

        const result = await createOrderFromManualAttempt(attempt, evidence, req.user.username);
        orderCreated = true;

        await emitManualOrderSubmitted(req, result.order, result.duplicate);

        return res.json({
            success: true,
            code: result.duplicate
                ? "MANUAL_PAYMENT_ORDER_ALREADY_CREATED"
                : "MANUAL_PAYMENT_SLIP_SUBMITTED",
            duplicate: Boolean(result.duplicate),
            message: "Payment slip submitted",
            order: result.order
        });
    } catch (error) {
        console.log("Manual payment slip error:", error?.code || error?.message || error);

        if (evidence && !orderCreated) {
            await cleanupAfterFailedPersistence(evidence);
        }

        if (error instanceof StorageError) {
            logStorageError(error.code, {
                provider: error.provider,
                category: "paymentSlip",
                attemptId: req.params.attemptId
            });

            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        return res.status(error.statusCode || 500).json({
            success: false,
            code: error.code || "MANUAL_PAYMENT_ORDER_CREATE_FAILED",
            message: error.code
                ? "Manual payment submission failed"
                : "Manual payment order creation failed"
        });
    }
});

// GAME PAYMENT CREATE
router.post("/payment/create", authMiddleware, activeOrderCreateLimiter, async (req, res) => {
    let reservedRedemption = null;
    try {
        devLog("PAYMENT CREATE BODY =", req.body);

        const {
            orderId,
            game,
            gameKey,
            productCode,
            packageName,
            packageCode,
            amount,
            currency,
            region,
            paymentMethod,
            promoCode,
            userId,
            zoneId
        } = req.body;
        const username = req.user.username;

        if (!orderId || !paymentMethod || !userId) {
            return res.status(400).json({
                success: false,
                message: "Missing order data"
            });
        }

        const pricing = await resolvePurchasePricing({
            payload: {
                productCode: productCode || gameKey,
                gameKey,
                game,
                packageCode,
                packageName,
                amount,
                currency,
                region,
                promoCode
            },
            user: req.user,
            verifyUserLimit: true
        });
        const catalogItem = pricing.catalogItem;

        const methodKey = normalizePaymentKey(paymentMethod);
        const configuredMethod = await PaymentMethod.findOne({
            key: methodKey,
            region: catalogItem.region,
            enabled: true
        });

        if (configuredMethod && isManualPaymentType(configuredMethod.paymentType)) {
            return res.status(409).json({
                success: false,
                code: "USE_MANUAL_PAYMENT_ATTEMPT",
                message: "Manual payment orders are created after payment slip submission."
            });
        }

        const pendingPolicy = await getActivePendingOrderPolicy(username);

        if (pendingPolicy.activePendingCount >= pendingPolicy.limit) {
            return res.status(429).json({
                success: false,
                code: "TOO_MANY_PENDING_ORDERS",
                title: "You have several unfinished orders.",
                message: "Complete or wait for an older order to expire before creating another.",
                activePendingCount: pendingPolicy.activePendingCount,
                limit: pendingPolicy.limit
            });
        }

        const existingOrder = await Order.findOne({ orderId });
        if (existingOrder) {
            return res.status(409).json({
                success: false,
                code: "DUPLICATE_ORDER_ID",
                message: "Order already exists"
            });
        }

        reservedRedemption = await reservePromoUse({
            pricing,
            user: req.user,
            orderId
        });

        const order = await Order.create({
            orderId,
            username: username || "guest",
            game: catalogItem.productName,
            productCode: catalogItem.productCode,
            productName: catalogItem.productName,
            userId,
            zoneId: zoneId || "",
            packageName: catalogItem.packageName,
            packageCode: catalogItem.packageCode,
            amount: pricing.finalAmount,
            originalAmount: pricing.originalAmount,
            discountAmount: pricing.discountAmount,
            finalAmount: pricing.finalAmount,
            promoCode: pricing.promoCode,
            promoSnapshot: pricing.promoSnapshot,
            promoRedemptionId: reservedRedemption?._id || null,
            currency: pricing.currency,
            region: catalogItem.region,
            paymentMethod,
            status: ORDER_STATES.PENDING_PAYMENT,
            paymentStatus: PAYMENT_STATES.PENDING,
            paymentSlip: "",
            transactionId: "",
            paymentProvider: "",
            timeline: [{
                status: ORDER_STATES.PENDING_PAYMENT,
                previousStatus: "",
                paymentStatus: PAYMENT_STATES.PENDING,
                source: "user",
                actorType: "user",
                actor: username || "guest",
                reason: "Order created",
                idempotencyKey: `order:create:${orderId}`,
                at: new Date()
            }]
        });

        if (catalogItem.region === "TH" && methodKey.includes("promptpay")) {
            const result = await createPromptPayCharge(pricing.finalAmount, {
                type: "game_order",
                orderId,
                username: username || "guest"
            });

            const charge = result.charge;
            const source = result.source;
            const qrUrl = getQrUrl(source, charge);

            order.transactionId = charge.id;
            order.paymentProvider = "omise";
            order.note = "Waiting for PromptPay payment confirmation.";
            await order.save();

            return res.json({
                success: true,
                provider: "omise",
                paymentType: "auto",
                paymentName: "PromptPay",
                qrUrl,
                qrImage: qrUrl,
                transactionId: charge.id,
                chargeId: charge.id,
                status: charge.status,
                order
            });
        }

        const paymentSession = await wavepayService.createPayment({
            ...req.body,
            game: catalogItem.productName,
            packageName: catalogItem.packageName,
            amount: pricing.finalAmount,
            currency: pricing.currency,
            region: catalogItem.region,
            productCode: catalogItem.productCode,
            packageCode: catalogItem.packageCode
        });

        await Order.updateOne(
            { orderId },
            { transactionId: paymentSession.transactionId }
        );

        return res.json({
            success: true,
            provider: "manual",
            paymentType: "manual",
            paymentUrl: paymentSession.paymentUrl,
            qrUrl: paymentSession.qrUrl,
            transactionId: paymentSession.transactionId,
            order
        });

    } catch (error) {
        console.log("Payment create error:", error);
        await releasePromoRedemption(reservedRedemption?._id);

        if (error instanceof CatalogError || error instanceof PromoError) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: error.message || "Payment server error"
        });
    }
});

// MANUAL / DEEPLINK PAYMENT SLIP SUBMIT
// POST /api/payment/submit
router.post("/payment/submit", authMiddleware, upload.single("slip"), async (req, res) => {
    let evidence = null;
    let evidencePersisted = false;

    try {
        const { orderId } = req.body;

        if (!orderId) {
            return res.json({
                success: false,
                message: "Missing order ID"
            });
        }

        if (!req.file) {
            return res.json({
                success: false,
                message: "Please upload payment slip"
            });
        }

        const order = await Order.findOne({
            orderId,
            username: req.user.username
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        evidence = await uploadFile({
            file: req.file,
            category: "paymentSlip",
            ownerReference: order.orderId
        });

        order.paymentSlip = evidence.url;
        order.paymentEvidence = evidence;
        order.paymentStatus = order.paymentStatus || PAYMENT_STATES.PENDING;
        order.note = "Payment slip uploaded. Waiting for admin verification.";

        await order.save();
        evidencePersisted = true;

        await notificationService.createUserNotification({
            username: order.username,
            title: "Payment Slip Submitted",
            message: `${order.game} - ${order.packageName} payment slip has been submitted.`,
            type: "order",
            category: "orders",
            orderId: order.orderId,
            action: {
                type: "navigate",
                label: "View Order",
                url: `/tracking.html?orderId=${encodeURIComponent(order.orderId)}`
            },
            metadata: {
                orderId: order.orderId,
                game: order.game,
                amount: order.amount,
                currency: order.currency
            },
            source: "payment_submit"
        });

        await realtime.emitOrderUpdate(order.username, order);

        realtime.emitAdminOrderUpdate({
            type: "payment_slip_uploaded",
            orderId: order.orderId,
            username: order.username,
            game: order.game,
            amount: order.amount,
            currency: order.currency,
            status: order.status,
            paymentStatus: order.paymentStatus
        });

        return res.json({
            success: true,
            message: "Payment slip submitted",
            order
        });

    } catch (error) {
        console.log("Payment submit error:", error);

        if (evidence && !evidencePersisted) {
            await cleanupAfterFailedPersistence(evidence);
        }

        if (error instanceof StorageError) {
            logStorageError(error.code, {
                provider: error.provider,
                category: "paymentSlip",
                orderId: req.body?.orderId
            });

            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: error.message || "Payment submit server error"
        });
    }
});
// GAME PAYMENT STATUS
router.get("/payment/status/:orderId", async (req, res) => {
    try {
        const order = await Order.findOne({
            orderId: req.params.orderId
        });

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        res.json({
            success: true,
            orderId: order.orderId,
            status: order.status,
            paymentStatus: order.paymentStatus || (order.status === "paid" ? "paid" : "pending"),
            updatedAt: order.updatedAt
        });

    } catch (error) {
        console.log("Payment status error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// WEBHOOK
router.post("/payment/webhook", async (req, res) => {
    try {
        const envelope = extractWebhookChargeId(req.body);

        if (!envelope.supported) {
            safePaymentLog(envelope.code, {});
            return res.status(200).json({
                success: true,
                code: envelope.code,
                message: "Webhook event ignored"
            });
        }

        const charge = await retrieveVerifiedCharge(envelope.chargeId);
        const [topup, order] = await Promise.all([
            WalletTopup.findOne({ transactionId: charge.chargeId }),
            Order.findOne({ transactionId: charge.chargeId })
        ]);

        if (topup && order) {
            throw new OmisePaymentError(
                "OMISE_REFERENCE_AMBIGUOUS",
                "Provider charge is linked to multiple payment records.",
                409
            );
        }

        if (topup) {
            assertChargeMatchesRecord(charge, topup, { referenceType: "wallet_topup" });

            const result = await markWalletTopupPaid(req, topup.topupId, charge.chargeId);

            return res.status(200).json({
                success: true,
                code: result.duplicate ? "OMISE_WALLET_TOPUP_ALREADY_PAID" : "OMISE_WALLET_TOPUP_PAID",
                duplicate: Boolean(result.duplicate)
            });
        }

        if (order) {
            assertChargeMatchesRecord(charge, order, { referenceType: "order" });

            const amount = Number(charge.amountMinor) / 100;
            const paymentStatus = mapOmiseChargeStatus("charge.complete", {
                status: charge.status
            });

            const transition = await applyPaymentToOrder(order, {
                status: paymentStatus,
                transactionId: charge.chargeId,
                eventId: verifiedPaymentEventId(charge),
                amount,
                currency: charge.currency,
                orderId: order.orderId
            }, {
                source: "payment_provider",
                actorType: "system",
                reason: "Omise PromptPay payment confirmed"
            });

            if (transition.changed) {
                await consumePromoRedemption(order.promoRedemptionId, order.orderId);
                devLog("GAME PAYMENT SUCCESS:", order.orderId);
            }

            return res.status(200).json({
                success: true,
                code: transition.idempotent ? "OMISE_ORDER_PAYMENT_DUPLICATE" : "OMISE_ORDER_PAYMENT_APPLIED",
                duplicate: Boolean(transition.idempotent)
            });
        }

        throw new OmisePaymentError(
            "OMISE_REFERENCE_NOT_FOUND",
            "No order or wallet top-up is linked to provider charge.",
            404
        );

    } catch (err) {
        const statusCode = err instanceof OmisePaymentError
            ? err.statusCode
            : 500;
        const code = err instanceof OmisePaymentError
            ? err.code
            : "OMISE_WEBHOOK_ERROR";

        safePaymentLog(code, {
            chargeId: req.body?.data?.id
        });

        return res.status(statusCode).json({
            success: false,
            code,
            message: err instanceof OmisePaymentError
                ? err.message
                : "Webhook verification failed"
        });
    }
});

// DEV ONLY ROUTES
if (!isProduction) {
    router.get("/payment/test-paid/:orderId", adminMiddleware, requireAdminPermission(PERMISSIONS.ORDERS_MANAGE), async (req, res) => {
        const order = await Order.findOne({
            orderId: req.params.orderId
        });

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        await transitionOrder(order, ORDER_STATES.PAID, {
            source: "admin",
            actorType: "admin",
            actor: req.admin?.username || req.user?.username || "admin",
            reason: "Developer test payment confirmation",
            paymentStatus: PAYMENT_STATES.PAID,
            idempotencyKey: `dev:test-paid:${order.orderId}`
        });

        res.json({
            success: true,
            orderId: order.orderId,
            status: order.status
        });
    });

    router.post("/wallet/test-paid/:topupId", adminMiddleware, requireAdminPermission(PERMISSIONS.WALLET_APPROVE), async (req, res) => {
        try {
            const result = await markWalletTopupPaid(
                req,
                req.params.topupId
            );

            res.json(result);

        } catch (error) {
            console.log("Wallet test paid error:", error);

            res.json({
                success: false,
                message: error.message || "Server error"
            });
        }
    });
}

module.exports = router;
