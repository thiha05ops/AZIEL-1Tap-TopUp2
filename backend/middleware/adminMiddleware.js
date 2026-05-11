const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || "AZIEL2026";

function adminMiddleware(req, res, next) {
    const password = req.headers["x-admin-password"];

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized admin request"
        });
    }

    next();
}

module.exports = adminMiddleware;