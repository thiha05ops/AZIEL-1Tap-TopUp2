const { authenticateRequest } = require("./authMiddleware");

const optionalAuthMiddleware = async (req, res, next) => {
    try {
        const auth = await authenticateRequest(req, res);
        req.user = auth.context;
        req.authSession = auth.session;
        req.legacyAuth = auth.legacy;
    } catch (error) {
        if (req.headers.authorization || req.headers.cookie) req.optionalAuthInvalid = true;
    }

    return next();
};

module.exports = optionalAuthMiddleware;
