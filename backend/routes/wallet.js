// backend/routes/wallet.js
// AZIEL Wallet V2.5.1 - PromptPay Auto QR + Manual Slip Ready

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const User = require("../models/User");
const Order = require("../models/Order");
const WalletTopup = require("../models/WalletTopup");
const WalletTransaction = require("../models/WalletTransaction");
const Notification = require("../models/Notification");
const adminMiddleware = require("../middleware/adminMiddleware");

// ======================
// UPLOAD SETUP
// ======================

const uploadDir = path.join(__dirname, "../uploads/slips");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || ".jpg");
        cb(null, `wallet-${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            return cb(new Error("Only image files are allowed"));
        }

        cb(null, true);
    }
});

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

function emitWalletUpdate(req, username, payload) {
    const io = req.app.get("io");

    if (!io || !username) return;

    io.to(username).emit("walletUpdated", payload);
    io.to("admins").emit("adminNewUpdate", {
        type: "wallet",
        username,
        ...payload
    });
}

async function createWalletNotification(req, topup, title, message, type = "wallet") {
    try {
        const notification = await Notification.create({
            username: topup.username,
            title,
            message,
            type,
            category: "wallet",
            isRead: false
        });

        const io = req.app.get("io");

        if (io) {
            io.to(topup.username).emit("newNotification", notification);
        }

        return notification;
    } catch (error) {
        console.log("Wallet notification error:", error.message);
        return null;
    }
}

// ======================
// CREATE WALLET TOPUP
// POST /api/wallet/create
// ======================

router.post("/wallet/create", async (req, res) => {
    try {
        const {
            username,
            amount,
            currency,
            region,
            paymentMethod,
            provider
        } = req.body;

        if (!username || !amount || Number(amount) <= 0 || !paymentMethod) {
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
        const method = normalizeMethod(provider || paymentMethod);
        const topupId = "WALLET-" + Date.now();

        const account = getAccountByMethod(method);
        const autoQr = isPromptPay(method);
        const qrImage = autoQr ? getQrByMethod(method) : "";

        const topup = await WalletTopup.create({
            topupId,
            username,
            amount: Number(amount),
            currency: currencyKey,
            region: region || (currencyKey === "THB" ? "TH" : "MM"),
            paymentMethod: method,
            status: "pending",
            qrImage,
            paymentSlip: "",
            note: autoQr
                ? "PromptPay QR generated. Waiting for payment."
                : "Manual payment. Waiting for slip upload."
        });

        const io = req.app.get("io");

        if (io) {
            io.to("admins").emit("adminNewUpdate", {
                type: "wallet_topup_created",
                topupId,
                username,
                amount: Number(amount),
                currency: currencyKey,
                paymentMethod: method,
                status: topup.status
            });
        }

        return res.json({
            success: true,
            message: autoQr
                ? "Wallet QR created"
                : "Wallet manual payment created",
            topupId,
            topup,
            paymentType: autoQr ? "auto_qr" : "manual",
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

router.get("/wallet/:username", async (req, res) => {
    try {
        const username = req.params.username;
        const currency = getCurrencyKey(req.query.currency || "MMK");

        const user = await User.findOne({ username });

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        const balance = user.wallet?.[currency] || 0;

        const topups = await WalletTopup.find({ username })
            .sort({ createdAt: -1 })
            .limit(30);

        const transactions = await WalletTransaction.find({ username })
            .sort({ createdAt: -1 })
            .limit(30);

        res.json({
            success: true,
            balance,
            currency,
            topups,
            transactions
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

router.get("/wallet/status/:topupId", async (req, res) => {
    try {
        const topup = await WalletTopup.findOne({
            topupId: req.params.topupId
        });

        if (!topup) {
            return res.json({
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

router.post("/wallet/slip/:topupId", upload.single("slip"), async (req, res) => {
    try {
        const topup = await WalletTopup.findOne({
            topupId: req.params.topupId
        });

        if (!topup) {
            return res.json({
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

        const slipPath = `/uploads/slips/${req.file.filename}`;

        topup.paymentSlip = slipPath;
        topup.status = "pending";
        topup.note = "Payment slip uploaded. Waiting for admin verification.";
        await topup.save();

        await createWalletNotification(
            req,
            topup,
            "Wallet Slip Uploaded",
            `Your ${Number(topup.amount || 0).toLocaleString()} ${getCurrencyKey(topup.currency)} wallet top-up slip has been submitted.`
        );

        const io = req.app.get("io");

        if (io) {
            io.to("admins").emit("adminNewUpdate", {
                type: "wallet_slip_uploaded",
                topupId: topup.topupId,
                username: topup.username,
                amount: topup.amount,
                currency: topup.currency,
                paymentMethod: topup.paymentMethod,
                paymentSlip: slipPath
            });
        }

        return res.json({
            success: true,
            message: "Payment slip submitted",
            topup
        });

    } catch (error) {
        console.log("Wallet slip upload error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// alias routes for frontend fallback
router.post("/wallet/topup/:topupId/slip", upload.single("slip"), async (req, res) => {
    req.url = `/wallet/slip/${req.params.topupId}`;
    router.handle(req, res);
});

router.post("/wallet/upload-slip/:topupId", upload.single("slip"), async (req, res) => {
    req.url = `/wallet/slip/${req.params.topupId}`;
    router.handle(req, res);
});

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

            const io = req.app.get("io");

            if (io) {
                io.to("admins").emit("adminNewUpdate", {
                    type: "wallet_topup_rejected",
                    username: topup.username,
                    amount: topup.amount,
                    currency: topup.currency
                });
            }

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

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ======================
// COMPLETE WALLET TOPUP
// ======================

async function completeWalletTopup(req, topup) {
    if (["approved", "paid", "completed"].includes(topup.status)) {
        return {
            success: true,
            message: "Already completed",
            topup
        };
    }

    const currencyKey = getCurrencyKey(topup.currency);

    const updatedUser = await User.findOneAndUpdate(
        { username: topup.username },
        {
            $inc: {
                [`wallet.${currencyKey}`]: Number(topup.amount || 0)
            }
        },
        { new: true }
    );

    if (!updatedUser) {
        return {
            success: false,
            message: "User not found"
        };
    }

    topup.status = "approved";
    topup.note = "Wallet balance added by admin";
    await topup.save();

    await WalletTransaction.create({
        transactionId: "TXN-" + Date.now(),
        username: topup.username,
        type: "topup",
        amount: Number(topup.amount || 0),
        currency: currencyKey,
        status: "completed",
        description: `Wallet topup via ${topup.paymentMethod}`
    });

    await createWalletNotification(
        req,
        topup,
        "Wallet Top-Up Successful",
        `${Number(topup.amount || 0).toLocaleString()} ${currencyKey} has been added to your wallet.`,
        "system"
    );

    const io = req.app.get("io");

    if (io) {
        io.to(topup.username).emit("walletUpdated", {
            amount: updatedUser.wallet?.[currencyKey] || 0,
            currency: currencyKey,
            status: "approved"
        });

        io.to("admins").emit("adminNewUpdate", {
            type: "wallet_topup_approved",
            username: topup.username,
            amount: topup.amount,
            currency: currencyKey
        });
    }

    return {
        success: true,
        message: "Wallet topup approved",
        topup,
        balance: updatedUser.wallet?.[currencyKey] || 0
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

router.post("/wallet/pay", async (req, res) => {
    try {
        const {
            orderId,
            username,
            userId,
            zoneId,
            game,
            packageName,
            amount,
            currency,
            region
        } = req.body;

        if (!username || !amount || !game || !packageName) {
            return res.json({
                success: false,
                message: "Missing wallet payment data"
            });
        }

        const user = await User.findOne({ username });

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        const currencyKey = getCurrencyKey(currency || "MMK");
        const currentBalance = user.wallet?.[currencyKey] || 0;

        if (currentBalance < Number(amount)) {
            return res.json({
                success: false,
                message: "Insufficient wallet balance"
            });
        }

        user.wallet[currencyKey] = Number(currentBalance) - Number(amount);
        user.markModified("wallet");
        await user.save();

        await WalletTransaction.create({
            transactionId: "TXN-" + Date.now(),
            username,
            type: "payment",
            amount: Number(amount),
            currency: currencyKey,
            status: "completed",
            description: `Paid for ${game} - ${packageName}`
        });

        const order = await Order.create({
            orderId: orderId || "AZL-" + Date.now(),
            username,
            userId,
            zoneId: zoneId || "-",
            game,
            packageName,
            selectedPackage: packageName,
            amount: Number(amount),
            currency: currencyKey,
            region: region || "MM",
            paymentMethod: "wallet",
            status: "paid",
            paymentSlip: "",
            note: "Paid with wallet"
        });

        emitWalletUpdate(req, username, {
            amount: user.wallet[currencyKey],
            currency: currencyKey,
            status: "payment"
        });

        const io = req.app.get("io");

        if (io) {
            io.to("admins").emit("adminNewUpdate", {
                type: "wallet_payment",
                orderId: order.orderId,
                username,
                status: "paid",
                game,
                packageName
            });
        }

        res.json({
            success: true,
            message: "Paid with wallet",
            order,
            balance: user.wallet[currencyKey]
        });

    } catch (error) {
        console.log("Wallet pay error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
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