// backend/routes/wallet.js
// AZIEL Wallet V2.5 - Auto QR / Webhook Ready

const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Order = require("../models/Order");
const WalletTopup = require("../models/WalletTopup");
const WalletTransaction = require("../models/WalletTransaction");
const Notification = require("../models/Notification");

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

    if (topup.status === "paid" || topup.status === "completed") {
        return {
            success: true,
            message: "Already paid",
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

    topup.status = "paid";
    topup.note = "Wallet balance added automatically";
    await topup.save();

    await WalletTransaction.create({
        transactionId: "TXN-" + Date.now(),
        username: topup.username,
        type: "topup",
        amount: Number(topup.amount),
        currency: currencyKey,
        status: "completed",
        description: `Wallet topup via ${topup.paymentMethod}`
    });

    const notification = await Notification.create({
        username: topup.username,
        title: "Wallet Top-Up Successful",
        message: `${Number(topup.amount).toLocaleString()} ${currencyKey} has been added to your wallet.`,
        type: "system",
        category: "wallet"
    });

    const io = req.app.get("io");

    if (io) {
        io.to(topup.username).emit("walletUpdated", {
            amount: updatedUser.wallet?.[currencyKey] || 0,
            currency: currencyKey,
            status: "paid"
        });

        io.to(topup.username).emit("newNotification", notification);

        io.to("admins").emit("adminNewUpdate", {
            type: "wallet_topup_paid",
            username: topup.username,
            amount: topup.amount,
            currency: currencyKey
        });
    }

    return {
        success: true,
        message: "Wallet topup paid",
        topup,
        balance: updatedUser.wallet?.[currencyKey] || 0
    };
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

        const io = req.app.get("io");

        if (io) {
            io.to(username).emit("walletUpdated", {
                amount: user.wallet[currencyKey],
                currency: currencyKey,
                status: "payment"
            });

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