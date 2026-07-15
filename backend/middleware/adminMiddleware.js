const { AdminAuthError, resolveAdminRequest } = require("../services/adminAuthService");

async function adminMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Admin token missing"
            });
        }

        const token = authHeader.slice("Bearer ".length).trim();

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Admin token missing"
            });
        }

        const resolved = await resolveAdminRequest(token);
        req.admin = resolved.admin;
        req.adminSession = resolved.session;

        next();

    } catch (error) {
        if (!(error instanceof AdminAuthError)) {
            console.log("ADMIN TOKEN ERROR:", error.message);
        }

        return res.status(401).json({
            success: false,
            error: "ADMIN_SESSION_INVALID",
            message: "Admin session expired"
        });
    }
}

module.exports = adminMiddleware;
