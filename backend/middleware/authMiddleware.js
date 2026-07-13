// backend/middleware/authMiddleware.js

const { verifyUserToken } = require("../services/authSessionService");

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

        const auth = await verifyUserToken(token, { allowLegacy: true });

        req.user = auth.context;
        req.authSession = auth.session;
        req.legacyAuth = auth.legacy;

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
