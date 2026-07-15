const { verifyUserToken } = require("../services/authSessionService");

const optionalAuthMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization || "";

    if (!authHeader) return next();

    if (!authHeader.startsWith("Bearer ")) {
        return next();
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return next();

    try {
        const auth = await verifyUserToken(token, { allowLegacy: true });
        req.user = auth.context;
        req.authSession = auth.session;
        req.legacyAuth = auth.legacy;
    } catch (error) {
        req.optionalAuthInvalid = true;
    }

    return next();
};

module.exports = optionalAuthMiddleware;
