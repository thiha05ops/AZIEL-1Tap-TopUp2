// backend/routes/payment.js

const express = require("express");
const router = express.Router();
const Omise = require("../services/opnService");
const Order = require("../models/Order");
const wavepayService = require("../services/wavepayService");

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { sendTelegramPhoto } = require("../services/telegram");

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

// POST /api/payment/create
router.post("/payment/create", async (req, res) => {
    try {
        console.log("PAYMENT CREATE BODY =", req.body);

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
            amount,
            currency,
            region,
            paymentMethod,
            status: "pending_payment",
            paymentSlip: "",
            transactionId: ""
        });

        const methodKey = String(paymentMethod || "")
            .toLowerCase()
            .replace(/\s+/g, "");

        console.log("REGION =", region);
        console.log("METHOD =", paymentMethod);
        console.log("METHOD KEY =", methodKey);

        // ============================
        // TH PROMPTPAY AUTO PAYMENT
        // ============================
        if (
            String(region).toUpperCase() === "TH" &&
            methodKey.includes("promptpay")
        ) {
            const result = await createPromptPayCharge(Number(amount));

            const charge = result.charge;
            const source = result.source;

            const qrUrl =
                source?.scannable_code?.image?.download_uri ||
                source?.scannable_code?.image?.uri ||
                charge?.source?.scannable_code?.image?.download_uri ||
                charge?.source?.scannable_code?.image?.uri ||
                "";

            console.log("OMISE SOURCE =", source);
            console.log("OMISE CHARGE =", charge);
            console.log("OMISE QR URL =", qrUrl);

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

        // ============================
        // MANUAL PAYMENT FALLBACK
        // ============================
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
const PaymentMethod = require("../models/PaymentMethod");

// GET /api/payment-methods
router.get("/payment-methods", async (req, res) => {
    try {
        const { region } = req.query;

        const filter = {};

        if (region) {
            filter.region = region;
        }

        const methods = await PaymentMethod.find(filter).sort({ createdAt: 1 });

        res.json({
            success: true,
            methods
        });

    } catch (error) {
        console.log("Payment methods load error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to load payment methods",
            methods: []
        });
    }
});
router.get("/payment/test-paid/:orderId", async (req, res) => {
    const order = await Order.findOne({ orderId: req.params.orderId });

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
// GET /api/payment/status/:orderId
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
async function createPromptPayCharge(amount) {

    return new Promise((resolve, reject) => {

        Omise.sources.create({
            type: "promptpay",
            amount: amount * 100,
            currency: "THB"

        }, (err, source) => {

            if (err) return reject(err);

            Omise.charges.create({
                amount: amount * 100,
                currency: "THB",
                source: source.id

            }, (err, charge) => {

                if (err) return reject(err);

                resolve({
                    source,
                    charge
                });

            });

        });

    });

}
// POST /api/payment/webhook
router.post("/payment/webhook", async (req, res) => {
    console.log("WEBHOOK =", req.body);

    try {

        const data = req.body.data;

        if (
            req.body.key === "charge.complete" &&
            data.status === "successful"
        ) {

            const order = await Order.findOne({
                transactionId: data.id
            });

            if (order) {

                order.status = "paid";
                order.paidAt = new Date();

                await order.save();

                console.log(
                    "PAYMENT SUCCESS:",
                    order.orderId
                );

            }

        }

        res.sendStatus(200);

    } catch (err) {

        console.log("Webhook error:", err);

        res.sendStatus(500);

    }

});
// DEV ONLY: simulate Omise paid
router.get("/payment/test-omise-paid/:orderId", async (req, res) => {
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

        order.status = "paid";
        order.paidAt = new Date();
        order.note = "Omise test payment completed.";
        await order.save();

        res.json({
            success: true,
            orderId: order.orderId,
            status: order.status
        });

    } catch (error) {
        res.json({
            success: false,
            message: error.message
        });
    }
});
module.exports = router;