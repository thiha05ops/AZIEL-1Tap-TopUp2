const express = require("express");
const router = express.Router();

const Order = require("../models/Order");
const User = require("../models/User");

router.get("/admin/stats", async (req, res) => {
    try {

        const totalOrders = await Order.countDocuments();

        const pendingOrders =
            await Order.countDocuments({
                status: "pending"
            });

        const processingOrders =
            await Order.countDocuments({
                status: "processing"
            });

        const completedOrders =
            await Order.countDocuments({
                status: "completed"
            });

        const totalUsers =
            await User.countDocuments();

        const completed =
            await Order.find({
                status: "completed"
            });

        let revenue = 0;

        completed.forEach(order => {
            revenue += Number(order.amount || 0);
        });

        res.json({
            success: true,

            stats: {
                totalOrders,
                pendingOrders,
                processingOrders,
                completedOrders,
                totalUsers,
                revenue
            }
        });

    } catch (error) {

        console.log("Admin stats error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;