"use strict";

const crypto = require("crypto");
const express = require("express");
const passport = require("../config/passport");
const { issueUserSession } = require("../services/authSessionService");
const { classifyGoogleAuthenticationError, classifyGoogleOAuthError, classifyRequestHost, fingerprint, isGoogleTokenExchangeError, logGoogleOAuthDiagnostic, safeRead } = require("../utils/googleOAuthDiagnostics");

function getFrontendUrl(env = process.env) {
    return (env.FRONTEND_URL || env.CLIENT_URL || "http://127.0.0.1:5500/frontend").replace(/\/$/, "");
}

function configured(req, res, next, env = process.env) {
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return next();
    return res.redirect(`${getFrontendUrl(env)}/login.html`);
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
    return `${getFrontendUrl(env)}/login.html?oauth=google&error=token_exchange_failed`;
}

function createSocialAuthRouter(options = {}) {
    const router = express.Router();
    const auth = options.passport || passport;
    const logger = options.logger || console;
    const env = options.env || process.env;
    const requireGoogle = (req, res, next) => configured(req, res, next, env);

    router.get("/auth/google", requireGoogle, (req, res, next) => {
        const diagnostic = requestDiagnostic(req, env, options.randomBytes);
        logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_START", diagnostic);
        return auth.authenticate("google", { scope: ["profile", "email"], prompt: "consent select_account", session: false })(req, res, next);
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
                return res.redirect(oauthFailureUrl(env));
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
                return res.redirect(oauthFailureUrl(env));
            }

            try {
                const params = new URLSearchParams({ token: issued.token, username: user.username || "", displayName: user.displayName || user.username || "", email: user.email || "", region: user.region || "MM", role: user.role || "user" });
                logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_REDIRECT_ISSUED", { ...diagnostic, destinationOriginClass: "frontend", destinationPathClass: "google_success" });
                return res.redirect(`${getFrontendUrl(env)}/google-success.html?${params.toString()}`);
            } catch (_) {
                logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_HANDOFF_FAILED", { ...diagnostic, errorCategory: "GOOGLE_HANDOFF_CONSTRUCTION_ERROR", elapsedMs: Date.now() - startedAt }, "warn");
                logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_REDIRECT_ISSUED", { ...diagnostic, destinationOriginClass: "frontend", destinationPathClass: "login" });
                return res.redirect(oauthFailureUrl(env));
            }
        })(req, res, next);
    });

    return router;
}

module.exports = createSocialAuthRouter();
module.exports.createSocialAuthRouter = createSocialAuthRouter;
module.exports.getFrontendUrl = getFrontendUrl;
