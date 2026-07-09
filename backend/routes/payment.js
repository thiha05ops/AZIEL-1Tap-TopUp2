// backend/routes/payment.js

const express = require("express");
const router = express.Router();

const Omise = require("../services/opnService");
const upload = require("../middleware/orderUpload");

const Order = require("../models/Order");
const User = require("../models/User");
const WalletTopup = require("../models/WalletTopup");
const WalletTransaction = require("../models/WalletTransaction");
const Notification = require("../models/Notification");

const wavepayService = require("../services/wavepayService");

const isProduction = process.env.NODE_ENV === "production";

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

async function markWalletTopupPaid(req, topupId, transactionId = "") {
    const topup = await WalletTopup.findOne({ topupId });

    if (!topup) {
        return { success: false, message: "Topup not found" };
    }

    if (topup.status === "paid" || topup.status === "completed") {
        return { success: true, message: "Already paid", topup };
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
        return { success: false, message: "User not found" };
    }

    topup.status = "paid";
    topup.transactionId = transactionId || topup.transactionId || "";
    topup.note = "Wallet balance added automatically by webhook";
    topup.paidAt = new Date();

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

// GAME PAYMENT CREATE
router.post("/payment/create", async (req, res) => {
    try {
        devLog("PAYMENT CREATE BODY =", req.body);

        const {
            orderId,
            game,
            packageName,
            amount,
            currency,
            region,
            paymentMethod,
            username,
            userId,
            zoneId
        } = req.body;

        if (!orderId || !game || !packageName || !amount || !paymentMethod || !userId) {
            return res.json({
                success: false,
                message: "Missing order data"
            });
        }

        const order = await Order.create({
            orderId,
            username: username || "guest",
            game,
            userId,
            zoneId: zoneId || "",
            packageName,
            amount: Number(amount),
            currency,
            region,
            paymentMethod,
            status: "pending_payment",
            paymentSlip: "",
            transactionId: "",
            paymentProvider: ""
        });

        const methodKey = String(paymentMethod || "")
            .toLowerCase()
            .replace(/\s+/g, "");

        if (String(region).toUpperCase() === "TH" && methodKey.includes("promptpay")) {
            const result = await createPromptPayCharge(Number(amount), {
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
                status: charge.status
            });
        }

        const paymentSession = await wavepayService.createPayment(req.body);

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
            transactionId: paymentSession.transactionId
        });

    } catch (error) {
        console.log("Payment create error:", error);

        return res.json({
            success: false,
            message: error.message || "Payment server error"
        });
    }
});

// MANUAL / DEEPLINK PAYMENT SLIP SUBMIT
// POST /api/payment/submit
router.post("/payment/submit", upload.single("slip"), async (req, res) => {
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

        const order = await Order.findOne({ orderId });

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        order.paymentSlip = `/uploads/orders/${req.file.filename}`;
        order.status = "paid";
        order.note = "Payment slip uploaded. Waiting for admin verification.";
        order.paidAt = new Date();

        await order.save();

        const notification = await Notification.create({
            username: order.username,
            title: "Payment Slip Submitted",
            message: `${order.game} - ${order.packageName} payment slip has been submitted.`,
            type: "order",
            category: "orders",
            orderId: order.orderId
        });

        const io = req.app.get("io");

        if (io) {
            io.to(order.username).emit("newNotification", notification);

            io.to("admins").emit("adminNewUpdate", {
                type: "payment_slip_uploaded",
                orderId: order.orderId,
                username: order.username,
                game: order.game,
                amount: order.amount,
                currency: order.currency,
                status: order.status
            });
        }

        return res.json({
            success: true,
            message: "Payment slip submitted",
            order
        });

    } catch (error) {
        console.log("Payment submit error:", error);

        return res.json({
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
            status: order.status
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
    devLog("WEBHOOK =", req.body);

    try {
        const data = req.body.data;

        if (req.body.key === "charge.complete" && data.status === "successful") {
            const metadata = data.metadata || {};

            if (metadata.type === "wallet_topup") {
                await markWalletTopupPaid(req, metadata.topupId, data.id);
                return res.sendStatus(200);
            }

            const order = await Order.findOne({
                transactionId: data.id
            });

            if (order) {
                order.status = "paid";
                order.paidAt = new Date();
                order.note = "Payment received. Waiting for admin processing.";
                await order.save();

                devLog("GAME PAYMENT SUCCESS:", order.orderId);
            }
        }

        res.sendStatus(200);

    } catch (err) {
        console.log("Webhook error:", err);
        res.sendStatus(500);
    }
});

// DEV ONLY ROUTES
if (!isProduction) {
    router.get("/payment/test-paid/:orderId", async (req, res) => {
        const order = await Order.findOne({
            orderId: req.params.orderId
        });

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        order.status = "paid";
        order.paidAt = new Date();
        order.note = "Payment received. Waiting for admin processing.";
        await order.save();

        res.json({
            success: true,
            orderId: order.orderId,
            status: order.status
        });
    });

    router.post("/wallet/test-paid/:topupId", async (req, res) => {
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
