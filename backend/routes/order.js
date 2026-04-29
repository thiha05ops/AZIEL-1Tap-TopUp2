const express = require("express");
const router = express.Router(); // 🔥 THIS LINE MUST EXIST

const Order = require("../models/Order");

// example route
router.get("/order/track/:orderId", async (req, res) => {
    try {
        const order = await Order.findOne({ orderId: req.params.orderId });

        if (!order) {
            return res.json({ success: false, message: "Order not found" });
        }

        res.json({ success: true, order });

    } catch (error) {
        res.json({ success: false, message: "Server error" });
    }
});

module.exports = router;