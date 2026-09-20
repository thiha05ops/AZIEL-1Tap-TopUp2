"use strict";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedOrigins(env = process.env) {
    return new Set([
        env.FRONTEND_URL,
        env.CLIENT_URL,
        env.AUTH_ORIGIN,
        "https://azielplay.com",
        "https://www.azielplay.com"
    ].filter(Boolean).map(value => {
        try { return new URL(value).origin; } catch (_) { return ""; }
    }).filter(Boolean));
}

function customerCsrfMiddleware(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (String(req.headers.authorization || "").startsWith("Bearer ")) return next();
    if (!req.headers.cookie) return next();

    const source = req.headers.origin || req.headers.referer || "";
    let origin = "";
    try { origin = new URL(source).origin; } catch (_) { /* Invalid or absent source. */ }
    const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const requestOrigin = `${forwardedProtocol || req.protocol || "http"}://${req.get("host")}`;
    if (origin && (origin === requestOrigin || allowedOrigins().has(origin))) return next();

    return res.status(403).json({ success: false, code: "CSRF_ORIGIN_REJECTED", message: "Request origin is not allowed" });
}

module.exports = customerCsrfMiddleware;
module.exports.allowedOrigins = allowedOrigins;
