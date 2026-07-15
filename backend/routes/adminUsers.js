const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Order = require("../models/Order");
const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const {
    applyCursorFilter,
    escapeRegex,
    normalizeSearch,
    pageResult,
    parseLimit,
    sendPaginationError
} = require("../services/paginationService");

router.get("/admin/users", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_READ), async (req, res) => {
    try {
        const limit = parseLimit(req.query.limit, { defaultLimit: 50, maxLimit: 100 });
        const search = normalizeSearch(req.query.q || "", { maxLength: 80 });
        const query = {};

        if (search) {
            const escaped = escapeRegex(search);
            query.$or = [
                { username: { $regex: `^${escaped}`, $options: "i" } },
                { email: { $regex: `^${escaped}`, $options: "i" } }
            ];
        }

        const usersRaw = await User.find(applyCursorFilter(query, req.query.cursor))
            .select("_id username email displayName region wallet isBlocked createdAt")
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit + 1)
            .lean();
        const { page, pagination } = pageResult(usersRaw, limit);
        const usernames = page.map(user => user.username).filter(Boolean);
        const orderSummaries = usernames.length
            ? await Order.aggregate([
                { $match: { username: { $in: usernames } } },
                {
                    $group: {
                        _id: "$username",
                        totalOrders: { $sum: 1 },
                        totalSpent: { $sum: { $ifNull: ["$amount", 0] } }
                    }
                }
            ])
            : [];
        const summaryByUsername = new Map(orderSummaries.map(item => [String(item._id || ""), item]));

        const formattedUsers = page.map(user => {
            const summary = summaryByUsername.get(user.username) || {};

            return {
                _id: user._id,
                username: user.username || user.email || "Unknown",
                email: user.email || "",
                displayName: user.displayName || user.username || "",
                region: user.region || "MM",
                wallet: user.wallet || { MMK: 0, THB: 0 },
                totalOrders: Number(summary.totalOrders || 0),
                totalSpent: Number(summary.totalSpent || 0),
                isBlocked: user.isBlocked || false,
                debugVersion: "ADMIN_USERS_V2",
                createdAt: user.createdAt
            };
        });

        return res.json({
            success: true,
            items: formattedUsers,
            users: formattedUsers,
            pagination
        });

    } catch (error) {
        console.log("Admin users error:", error);
        const paginationResponse = sendPaginationError(res, error);
        if (paginationResponse) return paginationResponse;

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.put("/admin/users/:id/block", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
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

router.delete("/admin/users/:id", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
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
router.get("/admin/users-debug-version", adminMiddleware, requireAdminPermission(PERMISSIONS.USERS_READ), (req, res) => {
    res.json({
        success: true,
        version: "ADMIN_USERS_V2_TOTALS",
        time: new Date()
    });
});
module.exports = router;
