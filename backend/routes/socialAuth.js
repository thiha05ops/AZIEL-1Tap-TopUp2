"use strict";

const crypto = require("crypto");
const express = require("express");
const passport = require("../config/passport");
const { issueUserSession } = require("../services/authSessionService");
const { setAuthCookie } = require("../services/authCookieService");
const { classifyGoogleAuthenticationError, classifyGoogleOAuthError, classifyRequestHost, fingerprint, isGoogleTokenExchangeError, logGoogleOAuthDiagnostic, safeRead } = require("../utils/googleOAuthDiagnostics");

function getFrontendUrl(env = process.env) {
    return (env.FRONTEND_URL || env.CLIENT_URL || "http://127.0.0.1:5500/frontend").replace(/\/$/, "");
}

function getAuthOrigin(env = process.env) {
    return String(env.AUTH_ORIGIN || "").replace(/\/$/, "");
}

function configured(req, res, next, env = process.env) {
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return next();
    return sendBrowserTransition(res, `${getFrontendUrl(env)}/login`);
}

function urlClass(value, expectedPath) {
    try {
        const parsed = new URL(value);
        return { origin: parsed.hostname === "azielplay.com" ? "storefront" : (parsed.hostname.endsWith(".onrender.com") ? "render" : "other"), path: parsed.pathname === expectedPath ? "expected" : "other" };
    } catch (_) { return { origin: "relative_or_invalid", path: value === expectedPath ? "expected" : "other" }; }
}

function requestDiagnostic(req, env = process.env, randomBytes = crypto.randomBytes) {
    try {
        const callback = urlClass(env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback", "/api/auth/google/callback");
        const protocol = safeRead(req, "protocol");
        return { correlationId: randomBytes(8).toString("hex"), requestHostClass: classifyRequestHost(req), requestProtocol: protocol === "https" ? "https" : (protocol === "http" ? "http" : "other"), callbackOriginClass: callback.origin, callbackPathClass: callback.path };
    } catch (_) { return {}; }
}

function callbackDiagnostic(req, env, randomBytes) {
    try {
        const query = safeRead(req, "query");
        const code = safeRead(query, "code");
        return { ...requestDiagnostic(req, env, randomBytes), codePresent: Boolean(code), statePresent: Boolean(safeRead(query, "state")), codeFingerprint: fingerprint(code) };
    } catch (_) { return requestDiagnostic(req, env, randomBytes); }
}

function providerStatus(error) {
    try {
        const oauthError = safeRead(error, "oauthError");
        return safeRead(error, "status") || safeRead(error, "statusCode") || safeRead(oauthError, "statusCode");
    } catch (_) { return undefined; }
}

function oauthFailureUrl(env = process.env) {
    return `${getFrontendUrl(env)}/login?oauth=google&error=token_exchange_failed`;
}

function sendBrowserTransition(res, destination) {
    const safeDestination = JSON.stringify(String(destination)).replace(/</g, "\\u003c");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    return res.status(200).type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Continue</title></head><body><script>window.location.replace(${safeDestination});</script></body></html>`);
}

function browserOwnedPassportRedirect(authenticate, req, res, next) {
    const originalRedirect = res.redirect.bind(res);
    res.redirect = (statusOrUrl, maybeUrl) => {
        res.redirect = originalRedirect;
        return sendBrowserTransition(res, maybeUrl || statusOrUrl);
    };
    return authenticate(req, res, error => {
        res.redirect = originalRedirect;
        return next(error);
    });
}

function createSocialAuthRouter(options = {}) {
    const router = express.Router();
    const auth = options.passport || passport;
    const logger = options.logger || console;
    const env = options.env || process.env;
    const requireGoogle = (req, res, next) => configured(req, res, next, env);

    router.get("/auth/google", requireGoogle, (req, res, next) => {
        const authOrigin = getAuthOrigin(env);
        if (authOrigin) {
            try {
                if (new URL(authOrigin).host !== req.get("host")) {
                    return sendBrowserTransition(res, `${authOrigin}/api/auth/google`);
                }
            } catch (_) { /* Production validation rejects invalid configuration. */ }
        }
        const diagnostic = requestDiagnostic(req, env, options.randomBytes);
        logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_START", diagnostic);
        return browserOwnedPassportRedirect(
            auth.authenticate("google", { scope: ["profile", "email"], prompt: "consent select_account", session: false, state: true }),
            req,
            res,
            next
        );
    });

    router.get("/auth/google/callback", requireGoogle, (req, res, next) => {
        const startedAt = Date.now();
        const diagnostic = callbackDiagnostic(req, env, options.randomBytes);
        try { req.googleOAuthDiagnostic = diagnostic; } catch (_) { /* Diagnostic attachment only. */ }
        logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_CALLBACK_RECEIVED", diagnostic);

        return auth.authenticate("google", { session: false }, async (error, user) => {
            if (error || !user) {
                const tokenFailure = Boolean(error) && isGoogleTokenExchangeError(error);
                const errorCategory = tokenFailure ? classifyGoogleOAuthError(error) : classifyGoogleAuthenticationError(error);
                const event = tokenFailure ? "GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED" : "GOOGLE_OAUTH_AUTHENTICATION_FAILED";
                logGoogleOAuthDiagnostic(logger, event, { ...diagnostic, errorCategory, providerHttpStatus: tokenFailure ? providerStatus(error) : undefined, elapsedMs: Date.now() - startedAt }, "warn");
                logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_REDIRECT_ISSUED", { ...diagnostic, destinationOriginClass: "frontend", destinationPathClass: "login" });
                return sendBrowserTransition(res, oauthFailureUrl(env));
            }

            req.user = user;
            const sessionOptions = { provider: "google", eventType: "google.login", eventTitle: "Google sign-in" };
            let issued;
            try {
                issued = options.issueUserSession
                    ? await options.issueUserSession(req.user, req, sessionOptions)
                    : await issueUserSession(req.user, req, sessionOptions);
                logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_SESSION_ESTABLISHED", { ...diagnostic, userTag: fingerprint(user._id), sessionTag: fingerprint(issued.session?.sessionId), elapsedMs: Date.now() - startedAt });
            } catch (_) {
                logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_SESSION_FAILED", { ...diagnostic, errorCategory: "GOOGLE_SESSION_ISSUANCE_ERROR", elapsedMs: Date.now() - startedAt }, "warn");
                logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_REDIRECT_ISSUED", { ...diagnostic, destinationOriginClass: "frontend", destinationPathClass: "login" });
                return sendBrowserTransition(res, oauthFailureUrl(env));
            }

            setAuthCookie(res, issued.session.sessionId, env);
            logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_REDIRECT_ISSUED", { ...diagnostic, destinationOriginClass: "frontend", destinationPathClass: "home" });
            return sendBrowserTransition(res, `${getFrontendUrl(env)}/`);
        })(req, res, next);
    });

    return router;
}

module.exports = createSocialAuthRouter();
module.exports.createSocialAuthRouter = createSocialAuthRouter;
module.exports.getFrontendUrl = getFrontendUrl;
module.exports.getAuthOrigin = getAuthOrigin;
module.exports.sendBrowserTransition = sendBrowserTransition;
