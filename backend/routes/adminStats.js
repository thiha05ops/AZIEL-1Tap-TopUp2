// backend/routes/adminStats.js

const express = require("express");
const router = express.Router();

const Order = require("../models/Order");
const User = require("../models/User");

const adminMiddleware = require("../middleware/adminMiddleware");

// ============================
// ADMIN DASHBOARD STATS
// GET /api/admin/stats
// ============================

router.get("/admin/stats", adminMiddleware, async (req, res) => {
    try {
        const totalOrders = await Order.countDocuments();

        const pendingOrders = await Order.countDocuments({
            status: { $in: ["pending", "pending_payment"] }
        });

        const processingOrders = await Order.countDocuments({
            status: "processing"
        });

        const completedOrders = await Order.countDocuments({
            status: "completed"
        });

        const cancelledOrders = await Order.countDocuments({
            status: { $in: ["cancelled", "failed"] }
        });

        const paidOrders = await Order.countDocuments({
            status: "paid"
        });

        const totalUsers = await User.countDocuments();

        const revenueOrders = await Order.find({
            status: { $in: ["paid", "processing", "completed"] }
        });

        let revenue = 0;

        revenueOrders.forEach(order => {
            revenue += Number(order.amount || 0);
        });

        res.json({
            success: true,
            totalOrders,
            pendingOrders,
            processingOrders,
            completedOrders,
            cancelledOrders,
            paidOrders,
            totalUsers,
            revenue
        });

    } catch (error) {
        console.log("Admin stats error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;