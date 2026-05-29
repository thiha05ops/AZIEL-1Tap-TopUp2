const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Order = require("../models/Order");

const adminMiddleware = require("../middleware/adminMiddleware");

// ==========================
// GET ALL USERS
// ==========================

router.get(
    "/admin/users",
    adminMiddleware,
    async (req, res) => {

        try {

            const users = await User.find()
                .sort({ createdAt: -1 });

            const formattedUsers = await Promise.all(

                users.map(async user => {

                    const totalOrders =
                        await Order.countDocuments({
                            username: user.username
                        });

                    return {

                        _id: user._id,

                        username:
                            user.username || "Unknown",

                        region:
                            user.region || "MM",

                        wallet:
                            user.wallet || {
                                MMK: 0,
                                THB: 0
                            },

                        totalOrders,

                        isBlocked:
                            user.isBlocked || false,

                        createdAt:
                            user.createdAt

                    };

                })

            );

            res.json({
                success: true,
                users: formattedUsers
            });

        } catch (error) {

            console.log(
                "Admin users error:",
                error
            );

            res.json({
                success: false,
                message: "Server error"
            });

        }

    }
);

// ==========================
// BLOCK USER
// ==========================

router.put(
    "/admin/users/:id/block",
    adminMiddleware,
    async (req, res) => {

        try {

            const user =
                await User.findById(req.params.id);

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
                message:
                    user.isBlocked
                        ? "User blocked"
                        : "User unblocked",
                user
            });

        } catch (error) {

            console.log(
                "Block user error:",
                error
            );

            res.json({
                success: false,
                message: "Server error"
            });

        }

    }
);

// ==========================
// DELETE USER
// ==========================

router.delete(
    "/admin/users/:id",
    adminMiddleware,
    async (req, res) => {

        try {

            const user =
                await User.findById(req.params.id);

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

            console.log(
                "Delete user error:",
                error
            );

            res.json({
                success: false,
                message: "Server error"
            });

        }

    }
);

module.exports = router;