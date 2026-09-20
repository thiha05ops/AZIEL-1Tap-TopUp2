// backend/middleware/authMiddleware.js

const { issueUserSession, verifyUserSessionId, verifyUserToken } = require("../services/authSessionService");
const { readSessionId, setAuthCookie } = require("../services/authCookieService");

async function authenticateRequest(req, res) {
    const cookieSessionId = readSessionId(req);
    if (cookieSessionId) return verifyUserSessionId(cookieSessionId);
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) throw new Error("Authentication required");
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) throw new Error("Authentication required");
    const auth = await verifyUserToken(token, { allowLegacy: true });
    if (auth.session?.sessionId) {
        setAuthCookie(res, auth.session.sessionId);
    } else if (auth.legacy && auth.user) {
        const upgraded = await issueUserSession(auth.user, req, {
            provider: "legacy_jwt_upgrade",
            eventType: "session.migrated",
            eventTitle: "Session security upgraded"
        });
        setAuthCookie(res, upgraded.session.sessionId);
        auth.session = upgraded.session;
        auth.legacy = false;
        auth.context = {
            ...auth.context,
            sessionId: upgraded.session.sessionId,
            legacyAuth: false
        };
    }
    return auth;
}

const authMiddleware = async (req, res, next) => {
    try {
        const auth = await authenticateRequest(req, res);

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
module.exports.authenticateRequest = authenticateRequest;
