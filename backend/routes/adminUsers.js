const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Order = require("../models/Order");
const adminMiddleware = require("../middleware/adminMiddleware");

router.get("/admin/users", adminMiddleware, async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 });
        const orders = await Order.find();

        const formattedUsers = users.map(user => {
            const names = [
                user.username,
                user.displayName,
                user.name
            ]
                .filter(Boolean)
                .map(v => String(v).trim().toLowerCase());

            const userOrders = orders.filter(order => {
                const orderNames = [
                    order.username,
                    order.displayName,
                    order.customerName,
                    order.name
                ]
                    .filter(Boolean)
                    .map(v => String(v).trim().toLowerCase());

                return orderNames.some(name => names.includes(name));
            });

            const totalOrders = userOrders.length;

            const totalSpent = userOrders.reduce((sum, order) => {
                return sum + Number(order.amount || 0);
            }, 0);

            return {
                _id: user._id,
                username: user.username || user.displayName || "Unknown",
                displayName: user.displayName || "",
                region: user.region || "MM",
                wallet: user.wallet || { MMK: 0, THB: 0 },
                totalOrders,
                totalSpent,
                isBlocked: user.isBlocked || false,
                createdAt: user.createdAt
            };
        });

        res.json({
            success: true,
            users: formattedUsers
        });

    } catch (error) {
        console.log("Admin users error:", error);

        res.json({
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