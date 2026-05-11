// backend/routes/wallet.js
const Order = require("../models/Order");
const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const User = require("../models/User");
const WalletTopup = require("../models/WalletTopup");
const WalletTransaction = require("../models/WalletTransaction");

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || "AZIEL2026";


// ======================
// UPLOAD
// ======================

const uploadDir =
    path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({

    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        cb(
            null,
            Date.now() + "-" + file.originalname
        );
    }

});

const upload = multer({ storage });


// ======================
// GET USER WALLET
// ======================

router.get("/wallet/:username", async (req, res) => {

    try {

        const user =
            await User.findOne({
                username: req.params.username
            });

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        const transactions =
            await WalletTransaction.find({
                username: req.params.username
            }).sort({ createdAt: -1 });

        const topups =
            await WalletTopup.find({
                username: req.params.username
            }).sort({ createdAt: -1 });

        const currency = req.query.currency || "MMK";

        const balance =
            user.wallet?.[currency] || 0;

        res.json({
            success: true,
            balance,
            currency,
            transactions,
            topups
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false,
            message: "Server error"
        });

    }

});


// ======================
// CREATE TOPUP
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

            if (
                !username ||
                !amount ||
                !paymentMethod
            ) {

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

            const topup =
                await WalletTopup.create({

                    topupId:
                        "WAL-" + Date.now(),

                    username,

                    amount: Number(amount),

                    currency:
                        currency || "MMK",

                    paymentMethod,

                    paymentSlip:
                        req.file.filename,

                    status: "pending"

                });

            res.json({
                success: true,
                message:
                    "Topup request submitted",
                topup
            });

        } catch (error) {

            console.log(error);

            res.json({
                success: false,
                message: "Server error"
            });

        }

    }
);


// ======================
// ADMIN GET TOPUPS
// ======================

router.get(
    "/admin/wallet/topups",

    async (req, res) => {

        try {

            const password =
                req.headers["x-admin-password"];

            if (
                password !== ADMIN_PASSWORD
            ) {

                return res.status(401).json({
                    success: false,
                    message: "Unauthorized"
                });

            }

            const topups =
                await WalletTopup.find()
                    .sort({ createdAt: -1 });

            res.json({
                success: true,
                topups
            });

        } catch (error) {

            console.log(error);

            res.json({
                success: false,
                message: "Server error"
            });

        }

    }
);


// ======================
// ADMIN APPROVE TOPUP
// ======================

router.put(
    "/admin/wallet/topups/:id/status",

    async (req, res) => {

        try {

            const password =
                req.headers["x-admin-password"];

            if (
                password !== ADMIN_PASSWORD
            ) {

                return res.status(401).json({
                    success: false,
                    message: "Unauthorized"
                });

            }

            const { status } = req.body;

            const topup =
                await WalletTopup.findById(
                    req.params.id
                );

            if (!topup) {

                return res.json({
                    success: false,
                    message: "Topup not found"
                });

            }

            if (
                topup.status !== "pending"
            ) {

                return res.json({
                    success: false,
                    message:
                        "Already processed"
                });

            }

            if (status === "approved") {
                const currencyKey =
                    topup.currency === "THB"
                        ? "THB"
                        : "MMK";

                await User.updateOne(
                    { username: topup.username },
                    {
                        $inc: {
                            [`wallet.${currencyKey}`]:
                                topup.amount
                        }
                    }
                );

                await WalletTransaction.create({

                    transactionId:
                        "TXN-" + Date.now(),

                    username:
                        topup.username,

                    type: "topup",

                    amount:
                        topup.amount,

                    currency:
                        topup.currency,

                    description:
                        "Wallet topup approved"

                });

                topup.status =
                    "approved";

                topup.note =
                    "Balance added";

            }
            else {

                topup.status =
                    "rejected";

                topup.note =
                    "Topup rejected";

            }

            await topup.save();

            res.json({
                success: true,
                topup
            });

        } catch (error) {

            console.log(error);

            res.json({
                success: false,
                message: "Server error"
            });

        }

    }
);
const io = req.app.get("io").to(topup.username).emit(
    "walletUpdated",
    {
        amount: user.wallet,
        currency: topup.currency
    }
);
router.get("/wallet/test", (req, res) => {
    res.send("Wallet route working");
});
// PAY WITH WALLET
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

        if ((user.walletBalance || 0) < Number(amount)) {
            return res.json({
                success: false,
                message: "Insufficient wallet balance"
            });
        }

        const currencyKey =
            currency === "THB"
                ? "THB"
                : "MMK";

        const currentBalance =
            user.wallet?.[currencyKey] || 0;

        if (currentBalance < Number(amount)) {

            return res.json({
                success: false,
                message: "Insufficient wallet balance"
            });

        }

        user.wallet[currencyKey] -= Number(amount);

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

        res.json({
            success: true,
            message: "Paid with wallet",
            order
        });

    } catch (error) {
        console.log("Wallet pay error:", error);
        res.json({
            success: false,
            message: "Server error"
        });
    }
});
// LOAD WALLET
router.get("/wallet/:username", async (req, res) => {

    try {

        const username =
            req.params.username;

        const user =
            await User.findOne({ username });

        if (!user) {

            return res.json({
                success: false,
                message: "User not found"
            });

        }

        const currency =
            req.query.currency || "MMK";

        const balance =
            user.wallet?.[currency] || 0;

        const transactions =
            await WalletTransaction.find({
                username
            }).sort({ createdAt: -1 });

        const topups =
            await WalletTopup.find({
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

        console.log(error);

        res.json({
            success: false,
            message: "Server error"
        });

    }

});


module.exports = router;