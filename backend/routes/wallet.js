// backend/routes/wallet.js
// AZIEL Wallet V2.5 - Auto QR / Webhook / Admin Ready

const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Order = require("../models/Order");
const WalletTopup = require("../models/WalletTopup");
const WalletTransaction = require("../models/WalletTransaction");
const Notification = require("../models/Notification");
const adminMiddleware = require("../middleware/adminMiddleware");

// ======================
// HELPERS
// ======================

function getCurrencyKey(currency) {
    return currency === "THB" ? "THB" : "MMK";
}

function getQrByMethod(paymentMethod) {
    const qrMap = {
        kbzpay: "/assets/payment/kbzpay-qr.png",
        wavepay: "/assets/payment/wavepay-qr.png",
        ayapay: "/assets/payment/ayapay-qr.png",
        promptpay: "/assets/payment/promptpay-qr.png",
        scb: "/assets/payment/scb-qr.png"
    };

    return qrMap[paymentMethod] || "";
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

            if (!result.success) {
                return res.json(result);
            }

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

            try {
                const notification = await Notification.create({
                    username: topup.username,
                    title: "Wallet Top-Up Rejected",
                    message: `Your ${Number(topup.amount || 0).toLocaleString()} ${getCurrencyKey(topup.currency)} wallet top-up was rejected.`,
                    type: "wallet",
                    category: "wallet",
                    isRead: false
                });

                const io = req.app.get("io");

                if (io) {
                    io.to(topup.username).emit("newNotification", notification);
                    io.to("admins").emit("adminNewUpdate", {
                        type: "wallet_topup_rejected",
                        username: topup.username,
                        amount: topup.amount,
                        currency: topup.currency
                    });
                }
            } catch (notiError) {
                console.log("Reject notification error:", notiError.message);
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

    const notification = await Notification.create({
        username: topup.username,
        title: "Wallet Top-Up Successful",
        message: `${Number(topup.amount || 0).toLocaleString()} ${currencyKey} has been added to your wallet.`,
        type: "system",
        category: "wallet"
    });

    const io = req.app.get("io");

    if (io) {
        io.to(topup.username).emit("walletUpdated", {
            amount: updatedUser.wallet?.[currencyKey] || 0,
            currency: currencyKey,
            status: "approved"
        });

        io.to(topup.username).emit("newNotification", notification);

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

        user.wallet[currencyKey] =
            Number(currentBalance) - Number(amount);

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