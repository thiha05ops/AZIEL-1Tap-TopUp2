const express = require("express");
const router = express.Router();
const Order = require("../models/Order");

// Create Order
router.post("/order", async (req, res) => {
    try {
        const { username, userId, serverId, selectedPackage } = req.body;

        await Order.create({
            username,
            userId,
            serverId,
            packageName: selectedPackage
        });

        res.json({
            success: true,
            message: "Order placed!"
        });

    } catch (error) {
        console.log(error);
        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// Get History
router.get("/history/:username", async (req, res) => {
    try {
        const username = req.params.username;

        const orders = await Order.find({ username }).sort({
            createdAt: -1
        });

        res.json({
            success: true,
            orders
        });

    } catch (error) {
        console.log(error);
        res.json({
            success: false
        });
    }
});

module.exports = router;