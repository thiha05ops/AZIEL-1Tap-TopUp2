const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "aziel_jwt_secret";

function adminMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Admin token missing"
            });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        if (decoded.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Unauthorized admin request"
            });
        }

        req.admin = {
            role: "admin"
        };

        next();

    } catch (error) {
        console.log("ADMIN TOKEN ERROR:", error.message);

        return res.status(401).json({
            success: false,
            message: "Admin session expired"
        });
    }
}

module.exports = adminMiddleware;