const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Order = require("../models/Order");
const adminMiddleware = require("../middleware/adminMiddleware");

router.get("/admin/users", adminMiddleware, async (req, res) => {
    try {
        const users = await User.find().lean().sort({ createdAt: -1 });
        const orders = await Order.find().lean();

        const formattedUsers = users.map(user => {
            const username = String(user.username || "").trim().toLowerCase();

            const userOrders = orders.filter(order => {
                return String(order.username || "")
                    .trim()
                    .toLowerCase() === username;
            });

            const totalOrders = userOrders.length;

            const totalSpent = userOrders.reduce((sum, order) => {
                return sum + Number(order.amount || 0);
            }, 0);

            return {
                _id: user._id,
                username: user.username || user.email || "Unknown",
                email: user.email || "",
                displayName: user.displayName || user.username || "",
                region: user.region || "MM",
                wallet: user.wallet || { MMK: 0, THB: 0 },
                totalOrders: totalOrders,
                totalSpent: totalSpent,
                isBlocked: user.isBlocked || false,
                debugVersion: "ADMIN_USERS_V2",
                createdAt: user.createdAt
            };
        });

        return res.json({
            success: true,
            users: formattedUsers
        });

    } catch (error) {
        console.log("Admin users error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.put("/admin/users/:id/block", adminMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        user.isBlocked = !user.isBlocked;
        await user.save();

        res.json({
            success: true,
            message: user.isBlocked ? "User blocked" : "User unblocked",
            user
        });

    } catch (error) {
        res.json({
            success: false,
            message: "Server error"
        });
    }
});

router.delete("/admin/users/:id", adminMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        await user.deleteOne();

        res.json({
            success: true,
            message: "User deleted"
        });

    } catch (error) {
        res.json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;