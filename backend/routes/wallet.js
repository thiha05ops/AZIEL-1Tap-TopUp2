// backend/routes/wallet.js
// AZIEL Wallet V2.5.1 - PromptPay Auto QR + Manual Slip Ready

const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const User = require("../models/User");
const Order = require("../models/Order");
const WalletTopup = require("../models/WalletTopup");
const WalletTopupIntent = require("../models/WalletTopupIntent");
const WalletTransaction = require("../models/WalletTransaction");
const PaymentMethod = require("../models/PaymentMethod");
const upload = require("../middleware/imageMemoryUpload");
const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const authMiddleware = require("../middleware/authMiddleware");
const Omise = require("../services/opnService");
const realtime = require("../services/realtime");
const notificationService = require("../services/notificationService");
const walletEmailService = require("../services/walletEmailService");
const { ORDER_STATES, PAYMENT_STATES, transitionOrder } = require("../services/orderStateService");
const { CatalogError } = require("../services/catalogService");
const {
    PromoError,
    consumePromoRedemption,
    releasePromoRedemption,
    reservePromoUse,
    resolvePurchasePricing
} = require("../services/promoCodeService");
const { buildOrderCustomerSnapshot } = require("../services/orderCustomerSnapshotService");
const {
    WalletError,
    adjustWallet,
    creditTopup,
    getWalletBalance,
    getWalletTimeline,
    payOrderWithWallet,
    projectLedger
} = require("../services/walletService");
const {
    StorageError,
    cleanupAfterFailedPersistence,
    logStorageError,
    uploadFile
} = require("../services/storageService");
const {
    applyCursorFilter,
    pageResult,
    parseLimit,
    sendPaginationError
} = require("../services/paginationService");

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

function normalizeWalletRegion(region, currency) {
    const explicit = String(region || "").trim().toUpperCase();
    if (["MM", "TH"].includes(explicit)) return explicit;
    return getCurrencyKey(currency) === "THB" ? "TH" : "MM";
}

function safePublicPaymentAssetUrl(value = "") {
    const url = String(value || "").trim();
    if (!url) return "";
    if (/^[a-zA-Z]:\\|^\/Users\/|^\/private\/|^file:/i.test(url)) return "";
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("/uploads/") || url.startsWith("/assets/")) return url;
    return "";
}

function getMethodQrImage(method = {}) {
    return safePublicPaymentAssetUrl(
        method.uploadedQrImage ||
        method.qrImageUrl ||
        method.qrImage ||
        ""
    );
}

function isMethodInMaintenance(method = {}) {
    return Boolean(String(method.maintenanceMessage || "").trim());
}

function isManualLikePaymentMethod(method = {}) {
    return ["manual", "deeplink"].includes(String(method.paymentType || "manual").toLowerCase());
}

function isAutoPromptPayMethod(method = {}) {
    return (
        String(method.paymentType || "").toLowerCase() === "auto" &&
        String(method.provider || "").toLowerCase() === "omise" &&
        normalizeMethod(method.key) === "promptpay"
    );
}

function projectWalletPaymentMethod(method = {}) {
    return {
        method: method.method || "Payment",
        key: method.key || "",
        region: method.region || "",
        paymentType: method.paymentType || "manual",
        provider: method.provider || "manual",
        accountName: method.accountName || "",
        accountNumber: method.accountNumber || "",
        qrImage: getMethodQrImage(method),
        maintenanceMessage: method.maintenanceMessage || "",
        slipRequired: isManualLikePaymentMethod(method),
        logoUrl: `/assets/payment/${method.key}.png`
    };
}

function createWalletReference(prefix = "WALLET") {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function manualIntentExpiresAt() {
    return new Date(Date.now() + 15 * 60 * 1000);
}

function isExpiredIntent(intent = {}) {
    return !intent.expiresAt || new Date(intent.expiresAt).getTime() <= Date.now();
}

function assertManualIntentUsable(intent) {
    if (!intent || intent.status !== "active" || intent.consumedAt || isExpiredIntent(intent)) {
        const error = new Error("This payment session has expired. Please start the top-up again.");
        error.statusCode = 410;
        throw error;
    }
}

function createPaymentSnapshot(methodPresentation = {}) {
    return {
        method: methodPresentation.method || "Payment",
        key: methodPresentation.key || "",
        region: methodPresentation.region || "",
        paymentType: methodPresentation.paymentType || "",
        provider: methodPresentation.provider || "",
        accountName: methodPresentation.accountName || "",
        accountNumber: methodPresentation.accountNumber || "",
        qrImage: methodPresentation.qrImage || ""
    };
}

async function resolveWalletPaymentMethod({ paymentMethod, region, currency }) {
    const key = normalizeMethod(paymentMethod);
    const topupRegion = normalizeWalletRegion(region, currency);

    if (!key || key === "wallet") {
        const error = new Error("Please select a valid wallet top-up payment method.");
        error.statusCode = 400;
        throw error;
    }

    const method = await PaymentMethod.findOne({
        key,
        region: topupRegion
    }).lean();

    if (!method) {
        const error = new Error("Selected payment method is not available for this region.");
        error.statusCode = 400;
        throw error;
    }

    if (method.enabled !== true) {
        const error = new Error("Selected payment method is currently unavailable.");
        error.statusCode = 400;
        throw error;
    }

    if (isMethodInMaintenance(method)) {
        const error = new Error(method.maintenanceMessage || "Selected payment method is under maintenance.");
        error.statusCode = 400;
        throw error;
    }

    if (String(method.paymentType || "").toLowerCase() === "wallet" || String(method.provider || "").toLowerCase() === "wallet") {
        const error = new Error("AZIEL Wallet cannot be used to top up AZIEL Wallet.");
        error.statusCode = 400;
        throw error;
    }

    return {
        method,
        region: topupRegion
    };
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

function hasTopupEvidence(topup = {}) {
    return Boolean(
        topup.paymentSlip ||
        topup.paymentEvidence?.url ||
        topup.paymentEvidence?.key ||
        topup.paymentEvidence?.storageKey
    );
}

function projectAdminWalletTopup(topup = {}) {
    const item = typeof topup.toObject === "function" ? topup.toObject() : topup;

    return {
        _id: item._id,
        topupId: item.topupId,
        username: item.username,
        amount: item.amount,
        currency: getCurrencyKey(item.currency),
        region: item.region || "",
        paymentMethod: item.paymentMethod || "",
        paymentProvider: item.paymentProvider || "",
        transactionId: item.transactionId || "",
        paymentSlip: item.paymentSlip || "",
        paymentEvidence: item.paymentEvidence || {},
        status: item.status || "pending",
        note: item.note || "",
        paidAt: item.paidAt || null,
        hasPaymentEvidence: hasTopupEvidence(item),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
    };
}

function projectWalletUser(user = {}) {
    return {
        username: user.username,
        region: user.region || "",
        wallet: {
            MMK: Number(user.wallet?.MMK || 0),
            THB: Number(user.wallet?.THB || 0)
        }
    };
}

function parsePagination(query = {}) {
    const page = Math.max(Number(query.page || 1), 1);
    const requestedLimit = Math.max(Number(query.limit || 50), 1);
    const limit = Math.min(requestedLimit, 100);
    const skip = (page - 1) * limit;

    return { page, limit, skip };
}

function transactionFilter(query = {}) {
    const filter = {};
    const type = String(query.type || "").trim();
    const direction = String(query.direction || "").trim();
    const currency = String(query.currency || "").trim();
    const search = String(query.q || "").trim();

    if (type && [
        "topup",
        "payment",
        "refund",
        "wallet.topup",
        "wallet.payment",
        "wallet.refund",
        "wallet.reversal",
        "wallet.adjustment",
        "wallet.migration"
    ].includes(type)) {
        filter.type = type;
    }

    if (["credit", "debit"].includes(direction)) {
        filter.direction = direction;
    }

    if (currency) {
        filter.currency = getCurrencyKey(currency);
    }

    if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.$or = [
            { username: { $regex: escaped, $options: "i" } },
            { transactionId: { $regex: escaped, $options: "i" } },
            { referenceId: { $regex: escaped, $options: "i" } },
            { orderId: { $regex: escaped, $options: "i" } },
            { topupId: { $regex: escaped, $options: "i" } }
        ];
    }

    return filter;
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
            paymentMethod
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
        const resolved = await resolveWalletPaymentMethod({
            paymentMethod,
            region,
            currency: currencyKey
        });
        const configuredMethod = resolved.method;
        const method = configuredMethod.key;
        const topupId = "WALLET-" + Date.now();
        const topupRegion = resolved.region;

        const methodPresentation = projectWalletPaymentMethod(configuredMethod);
        const autoQr = shouldUsePromptPayAuto(topupRegion, method) && isAutoPromptPayMethod(configuredMethod);
        const qrImage = autoQr ? "" : methodPresentation.qrImage;

        if (!autoQr) {
            return res.status(400).json({
                success: false,
                code: "MANUAL_TOPUP_REQUIRES_INTENT",
                message: "Manual wallet top-ups must be submitted with a payment receipt."
            });
        }

        const topup = await WalletTopup.create({
            topupId,
            username,
            ...buildOrderCustomerSnapshot(req.user),
            amount: Number(amount),
            currency: currencyKey,
            region: topupRegion,
            paymentMethod: method,
            paymentProvider: configuredMethod.provider || "",
            paymentSnapshot: createPaymentSnapshot({
                ...methodPresentation,
                provider: configuredMethod.provider || "omise",
                paymentType: "auto"
            }),
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
                username,
                paymentMethod: method
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
                paymentName: configuredMethod.method || "PromptPay",
                method: {
                    ...methodPresentation,
                    provider: "omise",
                    paymentType: "auto",
                    qrImage: qrUrl,
                    slipRequired: false
                },
                topupId,
                topup,
                qrImage: qrUrl,
                qrUrl,
                transactionId: charge.id,
                chargeId: charge.id,
                status: charge.status,
                accountName: methodPresentation.accountName,
                accountNumber: methodPresentation.accountNumber
            });
        }

    } catch (error) {
        console.log("Wallet create error:", error);

        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message || "Selected payment method is unavailable."
            });
        }

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ======================
// CREATE MANUAL WALLET TOPUP INTENT
// POST /api/wallet/manual-intent
// ======================

router.post("/wallet/manual-intent", authMiddleware, async (req, res) => {
    try {
        const { amount, currency, region, paymentMethod } = req.body;
        const username = req.user.username;

        if (!amount || Number(amount) <= 0 || !paymentMethod) {
            return res.status(400).json({
                success: false,
                message: "Amount and payment method are required."
            });
        }

        const user = await User.findOne({ username }).select("username");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const currencyKey = getCurrencyKey(currency);
        const resolved = await resolveWalletPaymentMethod({
            paymentMethod,
            region,
            currency: currencyKey
        });
        const configuredMethod = resolved.method;
        const method = configuredMethod.key;
        const topupRegion = resolved.region;

        if (!isManualLikePaymentMethod(configuredMethod)) {
            return res.status(400).json({
                success: false,
                message: "Selected payment method does not require manual receipt submission."
            });
        }

        const methodPresentation = projectWalletPaymentMethod(configuredMethod);
        const snapshot = createPaymentSnapshot(methodPresentation);
        const intent = await WalletTopupIntent.create({
            intentId: createWalletReference("WINT"),
            reference: createWalletReference("WALLET"),
            username,
            ...buildOrderCustomerSnapshot(req.user),
            amount: Number(amount),
            currency: currencyKey,
            region: topupRegion,
            paymentMethod: method,
            paymentProvider: configuredMethod.provider || "manual",
            paymentType: configuredMethod.paymentType || "manual",
            methodSnapshot: snapshot,
            expiresAt: manualIntentExpiresAt()
        });

        return res.json({
            success: true,
            message: "Wallet payment instructions ready",
            intentId: intent.intentId,
            reference: intent.reference,
            expiresAt: intent.expiresAt,
            amount: intent.amount,
            currency: intent.currency,
            region: intent.region,
            method: snapshot,
            provider: intent.paymentProvider,
            paymentType: intent.paymentType,
            paymentName: snapshot.method,
            qrImage: snapshot.qrImage,
            qrUrl: snapshot.qrImage,
            accountName: snapshot.accountName,
            accountNumber: snapshot.accountNumber,
            slipRequired: true
        });
    } catch (error) {
        console.log("Wallet manual intent error:", error);

        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message || "Selected payment method is unavailable."
            });
        }

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
            nextCursor: timeline.nextCursor,
            pagination: timeline.pagination
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
            nextCursor: timeline.nextCursor,
            pagination: timeline.pagination
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
// SUBMIT MANUAL WALLET TOPUP INTENT
// POST /api/wallet/manual-intent/:intentId/slip
// ======================

async function submitWalletIntentSlip(req, res) {
    let evidence = null;
    let evidencePersisted = false;

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Payment receipt is required."
            });
        }

        const intent = await WalletTopupIntent.findOne({
            intentId: req.params.intentId,
            username: req.user.username
        });

        assertManualIntentUsable(intent);

        const resolved = await resolveWalletPaymentMethod({
            paymentMethod: intent.paymentMethod,
            region: intent.region,
            currency: intent.currency
        });
        const configuredMethod = resolved.method;

        if (!isManualLikePaymentMethod(configuredMethod)) {
            return res.status(400).json({
                success: false,
                message: "Selected payment method no longer accepts manual receipts."
            });
        }

        if (resolved.region !== intent.region || configuredMethod.key !== intent.paymentMethod) {
            return res.status(400).json({
                success: false,
                message: "Payment method details changed. Please start the top-up again."
            });
        }

        const existing = await WalletTopup.findOne({ topupIntentId: intent.intentId });
        if (existing) {
            return res.status(409).json({
                success: false,
                message: "This payment receipt has already been submitted.",
                topupId: existing.topupId
            });
        }

        const methodPresentation = projectWalletPaymentMethod(configuredMethod);
        const snapshot = createPaymentSnapshot(methodPresentation);

        evidence = await uploadFile({
            file: req.file,
            category: "walletSlip",
            ownerReference: intent.reference
        });

        const topup = await WalletTopup.create({
            topupId: intent.reference,
            topupIntentId: intent.intentId,
            username: intent.username,
            customerEmail: intent.customerEmail || "",
            customerUserId: intent.customerUserId || null,
            amount: Number(intent.amount),
            currency: getCurrencyKey(intent.currency),
            region: intent.region,
            paymentMethod: configuredMethod.key,
            paymentProvider: configuredMethod.provider || "manual",
            paymentSnapshot: snapshot,
            qrImage: snapshot.qrImage,
            paymentSlip: evidence.url,
            paymentEvidence: evidence,
            status: "pending",
            note: "Payment slip uploaded. Waiting for admin verification."
        });
        evidencePersisted = true;

        await WalletTopupIntent.updateOne(
            {
                _id: intent._id,
                status: "active",
                consumedAt: null
            },
            {
                $set: {
                    status: "consumed",
                    consumedAt: new Date(),
                    topupId: topup.topupId
                }
            }
        );

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
            message: "Payment receipt submitted for verification.",
            topup
        });
    } catch (error) {
        console.log("Wallet intent slip upload error:", error);

        if (evidence && !evidencePersisted) {
            await cleanupAfterFailedPersistence(evidence);
        }

        if (error?.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "This payment receipt has already been submitted."
            });
        }

        if (error instanceof StorageError) {
            logStorageError(error.code, {
                provider: error.provider,
                category: "walletSlip",
                intentId: req.params.intentId
            });

            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message || "Payment session expired."
            });
        }

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
}

router.post("/wallet/manual-intent/:intentId/slip", authMiddleware, upload.single("slip"), submitWalletIntentSlip);

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

router.get("/admin/wallet/topups", adminMiddleware, requireAdminPermission(PERMISSIONS.WALLET_READ), async (req, res) => {
    try {
        const status = String(req.query.status || "").trim().toLowerCase();
        const limit = parseLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 });
        const query = {};

        if ([
            "pending",
            "paid",
            "completed",
            "approved",
            "rejected",
            "cancelled",
            "failed"
        ].includes(status)) {
            query.status = status;
        }

        const topupsRaw = await WalletTopup.find(applyCursorFilter(query, req.query.cursor))
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit + 1)
            .lean();
        const { page, pagination } = pageResult(topupsRaw, limit);
        const topups = page.map(projectAdminWalletTopup);

        res.json({
            success: true,
            items: topups,
            topups,
            pagination
        });

    } catch (error) {
        console.log("Admin wallet topups error:", error);
        const paginationResponse = sendPaginationError(res, error);
        if (paginationResponse) return paginationResponse;

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.get("/admin/wallet/topups/:id/context", adminMiddleware, requireAdminPermission(PERMISSIONS.WALLET_READ), async (req, res) => {
    try {
        const topup = await WalletTopup.findById(req.params.id);

        if (!topup) {
            return res.status(404).json({
                success: false,
                message: "Topup not found"
            });
        }

        const user = await User.findOne({ username: topup.username })
            .select("username region wallet")
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const timeline = await getWalletTimeline(topup.username, {
            currency: getCurrencyKey(topup.currency),
            limit: 10
        });

        return res.json({
            success: true,
            topup: projectAdminWalletTopup(topup),
            wallet: projectWalletUser(user),
            recentTransactions: timeline.transactions
        });
    } catch (error) {
        console.log("Admin wallet topup context error:", error);
        return sendWalletError(res, error, "Load wallet context failed");
    }
});

router.get("/admin/wallet/transactions", adminMiddleware, requireAdminPermission(PERMISSIONS.WALLET_READ), async (req, res) => {
    try {
        const limit = parseLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 });
        const filter = transactionFilter(req.query);

        const raw = await WalletTransaction.find(applyCursorFilter(filter, req.query.cursor))
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit + 1)
            .lean();
        const result = pageResult(raw, limit);
        const transactions = result.page.map(projectLedger);

        return res.json({
            success: true,
            items: transactions,
            transactions,
            pagination: result.pagination
        });
    } catch (error) {
        console.log("Admin wallet transactions error:", error);
        const paginationResponse = sendPaginationError(res, error);
        if (paginationResponse) return paginationResponse;
        return sendWalletError(res, error, "Load wallet transactions failed");
    }
});

router.post("/admin/wallet/adjust", adminMiddleware, requireAdminPermission(PERMISSIONS.WALLET_APPROVE), async (req, res) => {
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

router.put("/admin/wallet/topups/:id/status", adminMiddleware, async (req, res, next) => {
    const status = String(req.body?.status || "").toLowerCase();
    const permission = status === "approved" || status === "approve"
        ? PERMISSIONS.WALLET_APPROVE
        : status === "rejected" || status === "reject"
            ? PERMISSIONS.WALLET_REJECT
            : PERMISSIONS.WALLET_APPROVE;
    return requireAdminPermission(permission)(req, res, next);
}, async (req, res) => {
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

            await writeAdminAudit({
                actor: req.admin,
                req,
                action: ADMIN_AUDIT_ACTIONS.WALLET_TOPUP_APPROVED,
                resourceType: "WalletTopup",
                resourceId: String(result.topup?._id || topup._id),
                metadata: {
                    username: topup.username,
                    amount: Number(topup.amount || 0),
                    currency: getCurrencyKey(topup.currency)
                }
            }).catch(error => console.log("Admin audit failed:", error.message));

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

            walletEmailService.notifyWalletTopupRejected(topup).catch(error => {
                console.log("Wallet top-up email dispatch failed:", {
                    topupId: topup.topupId,
                    status: topup.status,
                    code: error?.code || "WALLET_TOPUP_EMAIL_DISPATCH_FAILED"
                });
            });

            await writeAdminAudit({
                actor: req.admin,
                req,
                action: ADMIN_AUDIT_ACTIONS.WALLET_TOPUP_REJECTED,
                resourceType: "WalletTopup",
                resourceId: String(topup._id),
                metadata: {
                    username: topup.username,
                    amount: Number(topup.amount || 0),
                    currency: getCurrencyKey(topup.currency)
                }
            }).catch(error => console.log("Admin audit failed:", error.message));

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

    walletEmailService.notifyWalletTopupApproved(topup).catch(error => {
        console.log("Wallet top-up email dispatch failed:", {
            topupId: topup.topupId,
            status: topup.status,
            code: error?.code || "WALLET_TOPUP_EMAIL_DISPATCH_FAILED"
        });
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
    let reservedRedemption = null;
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
            region,
            promoCode
        } = req.body;
        const username = req.user.username;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "Missing wallet payment data"
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

        const currencyKey = pricing.currency;

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

        reservedRedemption = await reservePromoUse({
            pricing,
            user: req.user,
            orderId: requestedOrderId
        });

        const order = await Order.create({
            orderId: requestedOrderId,
            username,
            ...buildOrderCustomerSnapshot(req.user),
            userId,
            zoneId: zoneId || "-",
            game: catalogItem.productName,
            productCode: catalogItem.productCode,
            productName: catalogItem.productName,
            packageName: catalogItem.packageName,
            packageCode: catalogItem.packageCode,
            selectedPackage: catalogItem.packageName,
            amount: pricing.finalAmount,
            originalAmount: pricing.originalAmount,
            discountAmount: pricing.discountAmount,
            finalAmount: pricing.finalAmount,
            promoCode: pricing.promoCode,
            promoSnapshot: pricing.promoSnapshot,
            promoRedemptionId: reservedRedemption?._id || null,
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
        await consumePromoRedemption(reservedRedemption?._id, order.orderId);
        reservedRedemption = null;

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

        await releasePromoRedemption(reservedRedemption?._id);

        if (error instanceof CatalogError || error instanceof PromoError) {
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
