// backend/routes/payment.js

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const Omise = require("../services/opnService");
const upload = require("../middleware/orderUpload");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

const Order = require("../models/Order");
const WalletTopup = require("../models/WalletTopup");

const wavepayService = require("../services/wavepayService");
const realtime = require("../services/realtime");
const notificationService = require("../services/notificationService");
const { ORDER_STATES, PAYMENT_STATES, transitionOrder } = require("../services/orderStateService");
const { applyPaymentToOrder, mapOmiseChargeStatus } = require("../services/paymentStateService");
const { CatalogError, resolveOrderCatalog } = require("../services/catalogService");
const { creditTopup, getWalletBalance } = require("../services/walletService");
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

function devLog(...args) {
    if (!isProduction) console.log(...args);
}

function getCurrencyKey(currency) {
    return currency === "THB" ? "THB" : "MMK";
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

// GAME PAYMENT CREATE
router.post("/payment/create", authMiddleware, activeOrderCreateLimiter, async (req, res) => {
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

        const catalogItem = resolveOrderCatalog({
            productCode: productCode || gameKey,
            gameKey,
            game,
            packageCode,
            packageName,
            amount,
            currency,
            region
        });

        const pendingCount = await Order.countDocuments({
            username,
            status: "pending_payment",
            createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) }
        });

        if (pendingCount >= Number(process.env.MAX_PENDING_ORDERS_PER_USER || 5)) {
            return res.status(429).json({
                success: false,
                code: "TOO_MANY_PENDING_ORDERS",
                message: "You have too many pending orders. Please complete or wait before creating another."
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
            amount: catalogItem.amount,
            currency: catalogItem.currency,
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

        const methodKey = String(paymentMethod || "")
            .toLowerCase()
            .replace(/\s+/g, "");

        if (catalogItem.region === "TH" && methodKey.includes("promptpay")) {
            const result = await createPromptPayCharge(catalogItem.amount, {
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
            amount: catalogItem.amount,
            currency: catalogItem.currency,
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

        if (error instanceof CatalogError) {
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
    router.get("/payment/test-paid/:orderId", adminMiddleware, async (req, res) => {
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

    router.post("/wallet/test-paid/:topupId", adminMiddleware, async (req, res) => {
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
