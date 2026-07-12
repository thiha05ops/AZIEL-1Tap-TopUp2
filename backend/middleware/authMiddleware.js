// backend/middleware/authMiddleware.js

const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "aziel_jwt_secret";

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                forceLogout: true,
                message: "Authentication required"
            });
        }

        const token = authHeader.slice("Bearer ".length).trim();

        if (!token) {
            return res.status(401).json({
                success: false,
                forceLogout: true,
                message: "Authentication required"
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        if (!decoded.id || decoded.role === "admin") {
            return res.status(401).json({
                success: false,
                forceLogout: true,
                message: "Invalid authentication token"
            });
        }

        const user = await User.findById(decoded.id).select("-password");

        if (!user) {
            return res.status(401).json({
                success: false,
                forceLogout: true,
                message: "User not found"
            });
        }

        // One-device login check
        if (
            !decoded.sessionToken ||
            !user.currentSessionToken ||
            decoded.sessionToken !== user.currentSessionToken
        ) {
            return res.status(401).json({
                success: false,
                forceLogout: true,
                reason: "another_device",
                message: "Your account was logged in on another device."
            });
        }

        // 15 days inactive check
        const now = new Date();
        const lastActive = user.lastActiveAt || user.updatedAt || user.createdAt;

        const inactiveDays =
            (now.getTime() - new Date(lastActive).getTime()) /
            (1000 * 60 * 60 * 24);

        if (inactiveDays >= 15) {
            user.currentSessionToken = "";
            user.sessionUpdatedAt = now;
            await user.save();

            return res.status(401).json({
                success: false,
                forceLogout: true,
                reason: "inactive",
                message: "Your session expired because this account was inactive for 15 days."
            });
        }

        // Update active time on protected API use
        const oneHour = 60 * 60 * 1000;

        if (!user.lastActiveAt || now - new Date(user.lastActiveAt) > oneHour) {
            user.lastActiveAt = now;
            await user.save();
        }

        req.user = {
            id: String(user._id),
            _id: user._id,
            username: user.username,
            email: user.email,
            role: user.role || "user",
            region: user.region || "MM"
        };

        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            forceLogout: true,
            message: "Invalid or expired token"
        });
    }
};

module.exports = authMiddleware;
