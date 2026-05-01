const express = require("express");
const router = express.Router();
const Order = require("../models/Order");

// POST /api/supplier/mock-topup/:id
router.post("/supplier/mock-topup/:id", async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.json({ success: false, message: "Order not found" });
        }

        // Step 1: processing
        order.status = "processing";
        await order.save();

        // Step 2: simulate delay
        setTimeout(async () => {
            order.status = "completed";
            await order.save();
            console.log("Auto topup completed:", order.orderId);
        }, 3000);

        res.json({ success: true, message: "TopUp started" });

    } catch (err) {
        res.json({ success: false, message: "Server error" });
    }
});

module.exports = router;