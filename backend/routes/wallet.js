// backend/routes/wallet.js
// AZIEL Wallet V2.5.1 - PromptPay Auto QR + Manual Slip Ready

const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Order = require("../models/Order");
const WalletTopup = require("../models/WalletTopup");
const upload = require("../middleware/imageMemoryUpload");
const adminMiddleware = require("../middleware/adminMiddleware");
const authMiddleware = require("../middleware/authMiddleware");
const Omise = require("../services/opnService");
const realtime = require("../services/realtime");
const notificationService = require("../services/notificationService");
const { ORDER_STATES, PAYMENT_STATES, transitionOrder } = require("../services/orderStateService");
const { CatalogError, resolveOrderCatalog } = require("../services/catalogService");
const {
    WalletError,
    adjustWallet,
    creditTopup,
    getWalletBalance,
    getWalletTimeline,
    payOrderWithWallet
} = require("../services/walletService");
const {
    StorageError,
    cleanupAfterFailedPersistence,
    logStorageError,
    uploadFile
} = require("../services/storageService");

// ======================
// HELPERS
// ======================

function getCurrencyKey(currency) {
    return String(currency || "MMK").toUpperCase() === "THB" ? "THB" : "MMK";
}

function normalizeMethod(method) {
    return String(method || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "")
        .replaceAll("-", "")
        .replaceAll("_", "");
}

function isPromptPay(method) {
    return normalizeMethod(method) === "promptpay";
}

function shouldUsePromptPayAuto(region, method) {
    return String(region || "").toUpperCase() === "TH" && isPromptPay(method);
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

function getQrByMethod(paymentMethod) {
    const method = normalizeMethod(paymentMethod);

    const qrMap = {
        promptpay: "/assets/payment/promptpay-qr.png"
    };

    return qrMap[method] || "";
}

function getAccountByMethod(paymentMethod) {
    const method = normalizeMethod(paymentMethod);

    const accounts = {
        scb: {
            accountName: process.env.SCB_ACCOUNT_NAME || "AZIEL",
            accountNumber: process.env.SCB_ACCOUNT_NUMBER || "-"
        },
        wavepay: {
            accountName: process.env.WAVEPAY_ACCOUNT_NAME || "AZIEL",
            accountNumber: process.env.WAVEPAY_ACCOUNT_NUMBER || "-"
        },
        kbzpay: {
            accountName: process.env.KBZPAY_ACCOUNT_NAME || "AZIEL",
            accountNumber: process.env.KBZPAY_ACCOUNT_NUMBER || "-"
        },
        ayapay: {
            accountName: process.env.AYAPAY_ACCOUNT_NAME || "AZIEL",
            accountNumber: process.env.AYAPAY_ACCOUNT_NUMBER || "-"
        },
        cbpay: {
            accountName: process.env.CBPAY_ACCOUNT_NAME || "AZIEL",
            accountNumber: process.env.CBPAY_ACCOUNT_NUMBER || "-"
        },
        uabpay: {
            accountName: process.env.UABPAY_ACCOUNT_NAME || "AZIEL",
            accountNumber: process.env.UABPAY_ACCOUNT_NUMBER || "-"
        }
    };

    return accounts[method] || {
        accountName: process.env.DEFAULT_PAYMENT_ACCOUNT_NAME || "AZIEL",
        accountNumber: process.env.DEFAULT_PAYMENT_ACCOUNT_NUMBER || "-"
    };
}

async function emitWalletUpdate(username, payload) {
    if (!username) return;

    await realtime.emitWalletUpdate(username, payload);
    realtime.emitAdminWalletUpdate({
        type: "wallet",
        username,
        ...payload
    });
}

function latestWalletTransactionPayload(result) {
    const tx = result?.transaction || {};

    return {
        type: tx.type || "",
        direction: tx.direction || "",
        amount: Number(tx.amount || 0),
        balanceAfter: Number(tx.balanceAfter ?? result?.balance ?? 0),
        referenceType: tx.referenceType || "",
        referenceId: tx.referenceId || tx.orderId || tx.topupId || "",
        createdAt: tx.createdAt || new Date()
    };
}

async function emitCommittedWalletUpdate(username, result, extra = {}) {
    await emitWalletUpdate(username, {
        amount: result.balance,
        balance: result.balance,
        currency: result.currency,
        latestTransaction: latestWalletTransactionPayload(result),
        ...extra
    });
}

function sendWalletError(res, error, fallback = "Wallet transaction failed") {
    if (error instanceof WalletError) {
        return res.status(error.statusCode).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    return res.status(500).json({
        success: false,
        code: "WALLET_TRANSACTION_FAILED",
        message: fallback
    });
}

async function createWalletNotification(req, topup, title, message, type = "wallet") {
    try {
        const result = await notificationService.createUserNotification({
            username: topup.username,
            title,
            message,
            type,
            category: "wallet",
            topupId: topup.topupId,
            metadata: {
                topupId: topup.topupId,
                amount: topup.amount,
                currency: topup.currency,
                paymentMethod: topup.paymentMethod
            },
            source: "wallet"
        });

        return result.notification;
    } catch (error) {
        console.log("Wallet notification error:", error.message);
        return null;
    }
}

// ======================
// CREATE WALLET TOPUP
// POST /api/wallet/create
// ======================

router.post("/wallet/create", authMiddleware, async (req, res) => {
    try {
        const {
            amount,
            currency,
            region,
            paymentMethod,
            provider
        } = req.body;
        const username = req.user.username;

        if (!amount || Number(amount) <= 0 || !paymentMethod) {
            return res.json({
                success: false,
                message: "Missing wallet topup data"
            });
        }

        const user = await User.findOne({ username });

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        const currencyKey = getCurrencyKey(currency);
        const paymentMethodKey = normalizeMethod(paymentMethod);
        const providerKey = normalizeMethod(provider);
        const method = isPromptPay(paymentMethodKey)
            ? paymentMethodKey
            : providerKey || paymentMethodKey;
        const topupId = "WALLET-" + Date.now();
        const topupRegion = region || (currencyKey === "THB" ? "TH" : "MM");

        const account = getAccountByMethod(method);
        const autoQr = shouldUsePromptPayAuto(topupRegion, method);
        const qrImage = isPromptPay(method) ? getQrByMethod(method) : "";

        const topup = await WalletTopup.create({
            topupId,
            username,
            amount: Number(amount),
            currency: currencyKey,
            region: topupRegion,
            paymentMethod: method,
            status: "pending",
            qrImage,
            paymentSlip: "",
            note: autoQr
                ? "Waiting for PromptPay wallet confirmation."
                : "Manual payment. Waiting for slip upload."
        });

        if (autoQr) {
            const result = await createPromptPayCharge(Number(amount), {
                type: "wallet_topup",
                topupId,
                username
            });

            const charge = result.charge;
            const source = result.source;
            const qrUrl = getQrUrl(source, charge);

            topup.transactionId = charge.id;
            topup.paymentProvider = "omise";
            topup.qrImage = qrUrl;
            topup.note = "Waiting for PromptPay wallet confirmation.";
            await topup.save();

            realtime.emitAdminWalletUpdate({
                type: "wallet_topup_created",
                topupId,
                username,
                amount: Number(amount),
                currency: currencyKey,
                paymentMethod: method,
                provider: "omise",
                status: topup.status
            });

            return res.json({
                success: true,
                message: "Wallet QR created",
                provider: "omise",
                paymentType: "auto",
                paymentName: "PromptPay",
                topupId,
                topup,
                qrImage: qrUrl,
                qrUrl,
                transactionId: charge.id,
                chargeId: charge.id,
                status: charge.status,
                accountName: account.accountName,
                accountNumber: account.accountNumber
            });
        }

        realtime.emitAdminWalletUpdate({
            type: "wallet_topup_created",
            topupId,
            username,
            amount: Number(amount),
            currency: currencyKey,
            paymentMethod: method,
            status: topup.status
        });

        return res.json({
            success: true,
            message: autoQr
                ? "Wallet QR created"
                : "Wallet manual payment created",
            topupId,
            topup,
            provider: "manual",
            paymentType: "manual",
            qrImage,
            qrUrl: qrImage,
            accountName: account.accountName,
            accountNumber: account.accountNumber,
            status: topup.status
        });

    } catch (error) {
        console.log("Wallet create error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ======================
// LOAD WALLET
// GET /api/wallet/:username
// ======================

router.get("/wallet/transactions", authMiddleware, async (req, res) => {
    try {
        const username = req.user.username;
        const currency = getCurrencyKey(req.query.currency || "MMK");
        const timeline = await getWalletTimeline(username, {
            currency,
            limit: req.query.limit,
            cursor: req.query.cursor
        });

        return res.json({
            success: true,
            balance: timeline.balance,
            currency,
            transactions: timeline.transactions,
            nextCursor: timeline.nextCursor
        });

    } catch (error) {
        console.log("Wallet timeline error:", error);
        return sendWalletError(res, error, "Load wallet timeline failed");
    }
});

router.get("/wallet/:username", authMiddleware, async (req, res) => {
    try {
        const username = req.user.username;
        const currency = getCurrencyKey(req.query.currency || "MMK");

        const user = await User.findOne({ username });

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        const topups = await WalletTopup.find({ username })
            .sort({ createdAt: -1 })
            .limit(30);

        const timeline = await getWalletTimeline(username, {
            currency,
            limit: 30
        });

        res.json({
            success: true,
            balance: timeline.balance,
            currency,
            topups,
            transactions: timeline.transactions,
            nextCursor: timeline.nextCursor
        });

    } catch (error) {
        console.log("Load wallet error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// ======================
// WALLET TOPUP STATUS
// GET /api/wallet/status/:topupId
// ======================

router.get("/wallet/status/:topupId", authMiddleware, async (req, res) => {
    try {
        const topup = await WalletTopup.findOne({
            topupId: req.params.topupId,
            username: req.user.username
        });

        if (!topup) {
            return res.status(404).json({
                success: false,
                message: "Topup not found"
            });
        }

        return res.json({
            success: true,
            topupId: topup.topupId,
            status: topup.status,
            amount: topup.amount,
            currency: topup.currency,
            paymentMethod: topup.paymentMethod
        });

    } catch (error) {
        console.log("Wallet status error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ======================
// UPLOAD WALLET SLIP
// POST /api/wallet/slip/:topupId
// ======================

async function uploadWalletSlip(req, res) {
    let evidence = null;
    let evidencePersisted = false;

    try {
        const topup = await WalletTopup.findOne({
            topupId: req.params.topupId,
            username: req.user.username
        });

        if (!topup) {
            return res.status(404).json({
                success: false,
                message: "Topup not found"
            });
        }

        if (!req.file) {
            return res.json({
                success: false,
                message: "Payment slip is required"
            });
        }

        evidence = await uploadFile({
            file: req.file,
            category: "walletSlip",
            ownerReference: topup.topupId
        });

        topup.paymentSlip = evidence.url;
        topup.paymentEvidence = evidence;
        topup.status = "pending";
        topup.note = "Payment slip uploaded. Waiting for admin verification.";
        await topup.save();
        evidencePersisted = true;

        await createWalletNotification(
            req,
            topup,
            "Wallet Slip Uploaded",
            `Your ${Number(topup.amount || 0).toLocaleString()} ${getCurrencyKey(topup.currency)} wallet top-up slip has been submitted.`
        );

        realtime.emitAdminWalletUpdate({
            type: "wallet_slip_uploaded",
            topupId: topup.topupId,
            username: topup.username,
            amount: topup.amount,
            currency: topup.currency,
            paymentMethod: topup.paymentMethod,
            paymentSlip: evidence.url
        });

        return res.json({
            success: true,
            message: "Payment slip submitted",
            topup
        });

    } catch (error) {
        console.log("Wallet slip upload error:", error);

        if (evidence && !evidencePersisted) {
            await cleanupAfterFailedPersistence(evidence);
        }

        if (error instanceof StorageError) {
            logStorageError(error.code, {
                provider: error.provider,
                category: "walletSlip",
                topupId: req.params.topupId
            });

            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
}

router.post("/wallet/slip/:topupId", authMiddleware, upload.single("slip"), uploadWalletSlip);

// alias routes for frontend fallback
router.post("/wallet/topup/:topupId/slip", authMiddleware, upload.single("slip"), uploadWalletSlip);

router.post("/wallet/upload-slip/:topupId", authMiddleware, upload.single("slip"), uploadWalletSlip);

// ======================
// ADMIN WALLET TOPUPS
// GET /api/admin/wallet/topups
// ======================

router.get("/admin/wallet/topups", adminMiddleware, async (req, res) => {
    try {
        const topups = await WalletTopup.find()
            .sort({ createdAt: -1 })
            .limit(200);

        res.json({
            success: true,
            topups
        });

    } catch (error) {
        console.log("Admin wallet topups error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.post("/admin/wallet/adjust", adminMiddleware, async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const currency = getCurrencyKey(req.body.currency || "MMK");
        const direction = String(req.body.direction || "").trim().toLowerCase();
        const amount = Number(req.body.amount || 0);
        const reason = String(req.body.reason || "").trim();
        const actor = req.admin?.username || req.user?.username || "admin";

        if (!username || !["credit", "debit"].includes(direction) || !amount || amount <= 0 || !reason || reason.length > 240) {
            return res.status(400).json({
                success: false,
                code: "INVALID_WALLET_ADJUSTMENT",
                message: "Username, currency, direction, positive amount, and reason are required."
            });
        }

        const user = await User.findOne({ username }).select("username wallet");

        if (!user) {
            return res.status(404).json({
                success: false,
                code: "WALLET_USER_NOT_FOUND",
                message: "User not found."
            });
        }

        const adjustmentRef = `WADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const result = await adjustWallet({
            username,
            currency,
            direction,
            amount,
            reason,
            adjustmentRef
        }, {
            performedBy: actor
        });

        await notificationService.createUserNotification({
            username,
            title: "Wallet Balance Adjusted",
            message: `Your wallet balance was adjusted by ${direction === "credit" ? "+" : "-"}${amount.toLocaleString()} ${currency}.`,
            type: "wallet",
            category: "wallet",
            metadata: {
                amount,
                currency,
                direction,
                adjustmentRef
            },
            source: "wallet_admin_adjustment"
        });

        await emitCommittedWalletUpdate(username, result, {
            status: "adjustment"
        });

        return res.json({
            success: true,
            message: "Wallet adjustment committed",
            adjustmentRef,
            balance: result.balance,
            transaction: result.transaction
        });

    } catch (error) {
        console.log("Admin wallet adjustment error:", error);
        return sendWalletError(res, error, "Wallet adjustment failed");
    }
});

// ======================
// ADMIN UPDATE TOPUP STATUS
// PUT /api/admin/wallet/topups/:id/status
// ======================

router.put("/admin/wallet/topups/:id/status", adminMiddleware, async (req, res) => {
    try {
        const { status } = req.body;

        const allowedStatus = [
            "pending",
            "approved",
            "rejected",
            "paid",
            "completed",
            "cancelled"
        ];

        if (!allowedStatus.includes(status)) {
            return res.json({
                success: false,
                message: "Invalid status"
            });
        }

        const topup = await WalletTopup.findById(req.params.id);

        if (!topup) {
            return res.json({
                success: false,
                message: "Topup not found"
            });
        }

        if (["approved", "paid", "completed"].includes(status)) {
            const result = await completeWalletTopup(req, topup);

            if (!result.success) return res.json(result);

            return res.json({
                success: true,
                message: "Wallet topup approved",
                topup: result.topup,
                balance: result.balance
            });
        }

        if (["rejected", "cancelled"].includes(status)) {
            topup.status = "rejected";
            topup.note = "Wallet topup rejected by admin";
            await topup.save();

            await createWalletNotification(
                req,
                topup,
                "Wallet Top-Up Rejected",
                `Your ${Number(topup.amount || 0).toLocaleString()} ${getCurrencyKey(topup.currency)} wallet top-up was rejected.`
            );

            realtime.emitAdminWalletUpdate({
                type: "wallet_topup_rejected",
                username: topup.username,
                amount: topup.amount,
                currency: topup.currency
            });

            return res.json({
                success: true,
                message: "Wallet topup rejected",
                topup
            });
        }

        topup.status = status;
        await topup.save();

        res.json({
            success: true,
            message: "Topup status updated",
            topup
        });

    } catch (error) {
        console.log("Admin wallet status update error:", error);

        return sendWalletError(res, error, "Wallet topup update failed");
    }
});

// ======================
// COMPLETE WALLET TOPUP
// ======================

async function completeWalletTopup(req, topup) {
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
        performedBy: req.admin?.username || req.user?.username || "admin"
    });

    topup.status = "approved";
    topup.note = "Wallet balance added by admin";
    topup.paidAt = topup.paidAt || new Date();
    await topup.save();

    if (!creditResult.duplicate) {
        await createWalletNotification(
            req,
            topup,
            "Wallet Top-Up Successful",
            `${Number(topup.amount || 0).toLocaleString()} ${currencyKey} has been added to your wallet.`,
            "system"
        );
    }

    await emitCommittedWalletUpdate(topup.username, creditResult, {
        currency: currencyKey,
        status: "approved",
        topupId: topup.topupId
    });

    await realtime.emitWalletTopupUpdate(topup.username, {
        topupId: topup.topupId,
        status: topup.status,
        amount: topup.amount,
        currency: currencyKey,
        paymentMethod: topup.paymentMethod
    });

    realtime.emitAdminWalletUpdate({
        type: "wallet_topup_approved",
        username: topup.username,
        amount: topup.amount,
        currency: currencyKey,
        duplicate: Boolean(creditResult.duplicate)
    });

    return {
        success: true,
        message: creditResult.duplicate ? "Wallet topup already credited" : "Wallet topup approved",
        topup,
        balance: creditResult.balance,
        transaction: creditResult.transaction,
        duplicate: Boolean(creditResult.duplicate)
    };
}

// ======================
// MARK WALLET TOPUP PAID
// Used by webhook later
// ======================

async function markWalletTopupPaid(req, topupId) {
    const topup = await WalletTopup.findOne({ topupId });

    if (!topup) {
        return {
            success: false,
            message: "Topup not found"
        };
    }

    return await completeWalletTopup(req, topup);
}

// ======================
// PAY WITH WALLET
// POST /api/wallet/pay
// ======================

router.post("/wallet/pay", authMiddleware, async (req, res) => {
    try {
        const {
            orderId,
            userId,
            zoneId,
            game,
            gameKey,
            productCode,
            packageName,
            packageCode,
            amount,
            currency,
            region
        } = req.body;
        const username = req.user.username;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "Missing wallet payment data"
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

        const currencyKey = catalogItem.currency;

        const requestedOrderId = orderId || "AZL-" + Date.now();
        const existingOrder = await Order.findOne({
            orderId: requestedOrderId,
            username
        });

        if (existingOrder) {
            if (existingOrder.status === ORDER_STATES.PAID || existingOrder.paymentStatus === PAYMENT_STATES.PAID) {
                const balance = await getWalletBalance(username, existingOrder.currency || currencyKey);

                return res.json({
                    success: true,
                    message: "Wallet payment already completed",
                    order: existingOrder,
                    balance
                });
            }

            return res.status(409).json({
                success: false,
                code: "DUPLICATE_ORDER_ID",
                message: "Order already exists and is not payable by wallet"
            });
        }

        const order = await Order.create({
            orderId: requestedOrderId,
            username,
            userId,
            zoneId: zoneId || "-",
            game: catalogItem.productName,
            productCode: catalogItem.productCode,
            productName: catalogItem.productName,
            packageName: catalogItem.packageName,
            packageCode: catalogItem.packageCode,
            selectedPackage: catalogItem.packageName,
            amount: catalogItem.amount,
            currency: currencyKey,
            region: catalogItem.region,
            paymentMethod: "wallet",
            status: ORDER_STATES.PENDING_PAYMENT,
            paymentStatus: PAYMENT_STATES.PENDING,
            paymentSlip: "",
            note: "Paid with wallet",
            timeline: [{
                status: ORDER_STATES.PENDING_PAYMENT,
                previousStatus: "",
                paymentStatus: PAYMENT_STATES.PENDING,
                source: "user",
                actorType: "user",
                actor: username,
                reason: "Wallet order created",
                idempotencyKey: `order:create:${requestedOrderId}`,
                at: new Date()
            }]
        });

        const walletResult = await payOrderWithWallet(order);

        const paidTransition = await transitionOrder(order, ORDER_STATES.PAID, {
            source: "wallet",
            actorType: "user",
            actor: username,
            reason: "Paid with AZIEL Wallet",
            paymentStatus: PAYMENT_STATES.PAID,
            idempotencyKey: `wallet:payment:${requestedOrderId}`
        });

        await emitCommittedWalletUpdate(username, walletResult, {
            currency: currencyKey,
            status: "payment"
        });

        realtime.emitAdminWalletUpdate({
            type: "wallet_payment",
            orderId: paidTransition.order.orderId,
            username,
            status: "paid",
            game: catalogItem.productName,
            packageName: catalogItem.packageName
        });

        res.json({
            success: true,
            message: "Paid with wallet",
            order: paidTransition.order,
            balance: walletResult.balance,
            transaction: walletResult.transaction,
            duplicate: Boolean(walletResult.duplicate)
        });

    } catch (error) {
        console.log("Wallet pay error:", error);

        if (error instanceof CatalogError) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        return sendWalletError(res, error, "Wallet payment failed");
    }
});

// ======================
// TEST
// GET /api/wallet/test
// ======================

router.get("/wallet/test", (req, res) => {
    res.send("Wallet route working");
});

module.exports = router;
