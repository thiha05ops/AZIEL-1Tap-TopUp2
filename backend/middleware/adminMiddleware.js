// backend/middleware/adminMiddleware.js

const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET =
    process.env.JWT_SECRET || "aziel_jwt_secret";

async function adminMiddleware(req, res, next) {

    try {

        const authHeader = req.headers.authorization;

        if (
            !authHeader ||
            !authHeader.startsWith("Bearer ")
        ) {

            return res.status(401).json({
                success: false,
                message: "Admin session expired"
            });

        }

        const token =
            authHeader.split(" ")[1];

        const decoded =
            jwt.verify(token, JWT_SECRET);

        const user =
            await User.findById(decoded.id)
                .select("_id role currentSessionToken");

        if (!user) {

            return res.status(401).json({
                success: false,
                message: "Admin not found"
            });

        }

        if (
            user.role !== "admin"
        ) {

            return res.status(403).json({
                success: false,
                message: "Unauthorized admin request"
            });

        }

        if (
            decoded.sessionToken &&
            user.currentSessionToken &&
            decoded.sessionToken !== user.currentSessionToken
        ) {

            return res.status(401).json({
                success: false,
                message: "Admin logged in on another device"
            });

        }

        req.admin = {
            id: user._id,
            role: user.role
        };

        next();

    } catch (error) {

        console.log(
            "ADMIN TOKEN ERROR:",
            error.message
        );

        return res.status(401).json({
            success: false,
            message: "Admin session expired"
        });

    }

}

module.exports = adminMiddleware;