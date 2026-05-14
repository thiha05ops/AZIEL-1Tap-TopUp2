// backend/routes/wallet.js

const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Order = require("../models/Order");
const User = require("../models/User");
const WalletTopup = require("../models/WalletTopup");
const WalletTransaction = require("../models/WalletTransaction");

const adminMiddleware = require("../middleware/adminMiddleware");

// ======================
// UPLOAD
// ======================

const uploadDir = path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });

// ======================
// LOAD WALLET
// GET /api/wallet/:username
// ======================

router.get("/wallet/:username", async (req, res) => {
    try {
        const username = req.params.username;
        const currency = req.query.currency || "MMK";

        const user = await User.findOne({ username });

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        const balance = user.wallet?.[currency] || 0;

        const transactions = await WalletTransaction.find({
            username
        }).sort({ createdAt: -1 });

        const topups = await WalletTopup.find({
            username
        }).sort({ createdAt: -1 });

        res.json({
            success: true,
            balance,
            currency,
            transactions,
            topups
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
// CREATE TOPUP
// POST /api/wallet/topup
// ======================

router.post(
    "/wallet/topup",
    upload.single("slip"),
    async (req, res) => {
        try {
            const {
                username,
                amount,
                currency,
                paymentMethod
            } = req.body;

            if (!username || !amount || !paymentMethod) {
                return res.json({
                    success: false,
                    message: "Missing data"
                });
            }

            if (!req.file) {
                return res.json({
                    success: false,
                    message: "Slip required"
                });
            }

            const topup = await WalletTopup.create({
                topupId: "WAL-" + Date.now(),
                username,
                amount: Number(amount),
                currency: currency || "MMK",
                paymentMethod,
                paymentSlip: req.file.filename,
                status: "pending"
            });

            res.json({
                success: true,
                message: "Topup request submitted",
                topup
            });

        } catch (error) {
            console.log("Create topup error:", error);

            res.json({
                success: false,
                message: "Server error"
            });
        }
    }
);

// ======================
// ADMIN GET TOPUPS
// GET /api/admin/wallet/topups
// ======================

router.get(
    "/admin/wallet/topups",
    adminMiddleware,
    async (req, res) => {
        try {
            const topups = await WalletTopup.find()
                .sort({ createdAt: -1 });

            res.json({
                success: true,
                topups
            });

        } catch (error) {
            console.log("Admin wallet topups error:", error);

            res.json({
                success: false,
                message: "Server error"
            });
        }
    }
);

// ======================
// ADMIN APPROVE / REJECT TOPUP
// PUT /api/admin/wallet/topups/:id/status
// ======================

router.put(
    "/admin/wallet/topups/:id/status",
    adminMiddleware,
    async (req, res) => {
        try {
            const { status } = req.body;

            if (!["approved", "rejected"].includes(status)) {
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

            if (topup.status !== "pending") {
                return res.json({
                    success: false,
                    message: "Already processed"
                });
            }

            let newBalance = 0;

            if (status === "approved") {
                const currencyKey =
                    topup.currency === "THB" ? "THB" : "MMK";

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
                    return res.json({
                        success: false,
                        message: `User not found: ${topup.username}`
                    });
                }

                newBalance = updatedUser.wallet?.[currencyKey] || 0;

                await WalletTransaction.create({
                    transactionId: "TXN-" + Date.now(),
                    username: topup.username,
                    type: "topup",
                    amount: Number(topup.amount),
                    currency: topup.currency,
                    description: "Wallet topup approved"
                });

                topup.status = "approved";
                topup.note = "Balance added";
            } else {
                topup.status = "rejected";
                topup.note = "Topup rejected";
            }

            await topup.save();

            const io = req.app.get("io");

            if (io && status === "approved") {
                io.to(topup.username).emit("newNotification", {
                    title: "Wallet Approved",
                    message: `${topup.amount} ${topup.currency} added to wallet`,
                    _id: topup._id,
                    isRead: false
                });

                io.to("admins").emit("adminNewUpdate", {
                    type: "wallet_topup",
                    username: topup.username,
                    status: topup.status,
                    amount: topup.amount,
                    currency: topup.currency
                });
            }

            res.json({
                success: true,
                message: `Topup ${status}`,
                topup,
                balance: newBalance
            });

        } catch (error) {
            console.log("Wallet status error:", error);

            res.json({
                success: false,
                message: error.message || "Server error"
            });
        }
    }
);

// ======================
// WALLET TEST
// GET /api/wallet/test
// ======================

router.get("/wallet/test", (req, res) => {
    res.send("Wallet route working");
});

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

        const currencyKey =
            currency === "THB" ? "THB" : "MMK";

        const currentBalance =
            user.wallet?.[currencyKey] || 0;

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
            currency: currency || "MMK",
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
            currency: currency || "MMK",
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

            io.emit("adminNewUpdate", {
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

module.exports = router;