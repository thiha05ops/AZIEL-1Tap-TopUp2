const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

// POST /api/payment/submit
router.post("/payment/submit", upload.single("slip"), async (req, res) => {
    try {
        const { orderId } = req.body;

        if (!orderId || !req.file) {
            return res.json({
                success: false,
                message: "Missing data"
            });
        }

        const order = await Order.findOne({ orderId });

        if (!order) {
            return res.json({
                success: false,
                message: "Order not found"
            });
        }

        order.paymentSlip = req.file.filename;
        order.status = "paid";

        await order.save();

        // optional telegram
        try {
            const { sendTelegramPhoto } = require("../services/telegram");

            await sendTelegramPhoto(
                req.file.path,
                `💸 Payment Received
Order: ${order.orderId}
Game: ${order.game}
Amount: ${order.amount} ${order.currency}`
            );
        } catch (e) {
            console.log("Telegram error:", e);
        }

        res.json({
            success: true,
            message: "Payment submitted"
        });

    } catch (error) {
        console.log("Payment submit error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});