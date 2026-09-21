"use strict";

const crypto = require("crypto");
const express = require("express");
const passport = require("../config/passport");
const { issueUserSession } = require("../services/authSessionService");
const { setAuthCookie } = require("../services/authCookieService");
const { googleOAuthCallbackReplayService } = require("../services/googleOAuthCallbackReplayService");
const { classifyGoogleAuthenticationError, classifyGoogleOAuthError, classifyGooglePassportFailure, classifyRequestHost, fingerprint, isGoogleTokenExchangeError, logGoogleOAuthDiagnostic, safeRead } = require("../utils/googleOAuthDiagnostics");

function getFrontendUrl(env = process.env) {
    return (env.FRONTEND_URL || env.CLIENT_URL || "http://127.0.0.1:5500/frontend").replace(/\/$/, "");
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
        return { ...requestDiagnostic(req, env, randomBytes), ...sessionDiagnostic(req), codePresent: Boolean(code), statePresent: Boolean(safeRead(query, "state")), codeFingerprint: fingerprint(code) };
    } catch (_) { return requestDiagnostic(req, env, randomBytes); }
}

function sessionDiagnostic(req) {
    try {
        const cookieHeader = String(safeRead(safeRead(req, "headers"), "cookie") || "");
        const sessionId = safeRead(req, "sessionID");
        const sessionValue = safeRead(req, "session");
        const oauthStatePresentInSession = Object.values(sessionValue || {}).some(value =>
            value && typeof value === "object" && Boolean(safeRead(value, "state"))
        );
        return {
            oauthCookiePresent: cookieHeader.split(";").some(part => part.trim().startsWith("aziel.oauth=")),
            expressSessionIdPresent: Boolean(sessionId),
            expressSessionTag: fingerprint(sessionId),
            oauthStatePresentInSession
        };
    } catch (_) { return {}; }
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

function browserOwnedPassportRedirect(authenticate, req, res, next, options = {}) {
    const ownsSetHeader = Object.prototype.hasOwnProperty.call(res, "setHeader");
    const ownsEnd = Object.prototype.hasOwnProperty.call(res, "end");
    const originalSetHeader = res.setHeader;
    const originalEnd = res.end;
    const originalStatusCode = res.statusCode;
    let location = "";
    let restored = false;
    let completionClaimed = false;

    function restore() {
        if (restored) return;
        restored = true;
        if (ownsSetHeader) res.setHeader = originalSetHeader;
        else delete res.setHeader;
        if (ownsEnd) res.end = originalEnd;
        else delete res.end;
    }

    res.setHeader = function setPassportHeader(name, value) {
        const normalized = String(name || "").toLowerCase();
        if (normalized === "location") {
            location = String(value);
            return res;
        }
        if (normalized === "content-length" && location) return res;
        return originalSetHeader.call(res, name, value);
    };

    res.end = function finishPassportResponse(...args) {
        const status = res.statusCode;
        restore();
        if (completionClaimed) return res;
        if (location && status >= 300 && status < 400) {
            res.statusCode = originalStatusCode;
            completionClaimed = true;
            const startedAt = Date.now();
            options.onSessionSave?.("started", { ...sessionDiagnostic(req), sessionSaveStarted: true });
            if (!req.session || typeof req.session.save !== "function") {
                const error = new Error("GOOGLE_OAUTH_SESSION_SAVE_UNAVAILABLE");
                options.onSessionSave?.("failed", { ...sessionDiagnostic(req), sessionSaveStarted: true, sessionSaveFailed: true, sessionSaveElapsedMs: Date.now() - startedAt });
                return next(error);
            }
            let sessionSaveSettled = false;
            return req.session.save(error => {
                if (sessionSaveSettled) return undefined;
                sessionSaveSettled = true;
                if (error) {
                    options.onSessionSave?.("failed", { ...sessionDiagnostic(req), sessionSaveStarted: true, sessionSaveFailed: true, sessionSaveElapsedMs: Date.now() - startedAt });
                    return next(error);
                }
                options.onSessionSave?.("completed", { ...sessionDiagnostic(req), sessionSaveStarted: true, sessionSaveCompleted: true, sessionSaveElapsedMs: Date.now() - startedAt });
                return sendBrowserTransition(res, location);
            });
        }
        if (status >= 300 && status < 400 && !location) {
            completionClaimed = true;
            res.statusCode = originalStatusCode;
            return next(new Error("GOOGLE_OAUTH_REDIRECT_LOCATION_MISSING"));
        }
        return originalEnd.apply(res, args);
    };

    try {
        const result = authenticate(req, res, error => {
            restore();
            res.statusCode = originalStatusCode;
            if (completionClaimed) return undefined;
            const nextResult = next(error);
            completionClaimed = true;
            return nextResult;
        });
        if (result && typeof result.then === "function") {
            return result.catch(error => {
                restore();
                res.statusCode = originalStatusCode;
                if (completionClaimed) return undefined;
                completionClaimed = true;
                return next(error);
            });
        }
        return result;
    } catch (error) {
        restore();
        res.statusCode = originalStatusCode;
        if (completionClaimed) return undefined;
        completionClaimed = true;
        throw error;
    }
}

function createSocialAuthRouter(options = {}) {
    const router = express.Router();
    const auth = options.passport || passport;
    const logger = options.logger || console;
    const env = options.env || process.env;
    const callbackReplay = options.callbackReplay || googleOAuthCallbackReplayService;
    const requireGoogle = (req, res, next) => configured(req, res, next, env);

    router.get("/auth/google", requireGoogle, (req, res, next) => {
        const diagnostic = requestDiagnostic(req, env, options.randomBytes);
        logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_START", diagnostic);
        return browserOwnedPassportRedirect(
            auth.authenticate("google", { scope: ["profile", "email"], prompt: "consent select_account", session: false, state: true }),
            req,
            res,
            next,
            {
                onSessionSave(stage, fields) {
                    const event = stage === "started"
                        ? "GOOGLE_OAUTH_STATE_SAVE_STARTED"
                        : (stage === "completed" ? "GOOGLE_OAUTH_STATE_SAVE_COMPLETED" : "GOOGLE_OAUTH_STATE_SAVE_FAILED");
                    logGoogleOAuthDiagnostic(logger, event, { ...diagnostic, ...fields }, stage === "failed" ? "warn" : "info");
                }
            }
        );
    });

    router.get("/auth/google/callback", requireGoogle, async (req, res, next) => {
        const startedAt = Date.now();
        const diagnostic = callbackDiagnostic(req, env, options.randomBytes);
        try { req.googleOAuthDiagnostic = diagnostic; } catch (_) { /* Diagnostic attachment only. */ }
        logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_CALLBACK_RECEIVED", diagnostic);

        let callbackClaim;
        try {
            callbackClaim = await callbackReplay.claim({
                code: safeRead(safeRead(req, "query"), "code"),
                state: safeRead(safeRead(req, "query"), "state"),
                expressSessionId: safeRead(req, "sessionID")
            });
            if (!callbackClaim.owner) {
                const replayResult = await callbackReplay.waitForResult(callbackClaim);
                if (replayResult.status === "completed" && replayResult.sessionId) {
                    setAuthCookie(res, replayResult.sessionId, env);
                    logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_REDIRECT_ISSUED", { ...diagnostic, destinationOriginClass: "frontend", destinationPathClass: "home" });
                    return sendBrowserTransition(res, `${getFrontendUrl(env)}/`);
                }
                logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_REDIRECT_ISSUED", { ...diagnostic, destinationOriginClass: "frontend", destinationPathClass: "login" });
                return sendBrowserTransition(res, oauthFailureUrl(env));
            }
        } catch (error) {
            return next(error);
        }

        const finishFailure = async (error, user, info) => {
            await callbackReplay.fail(callbackClaim);
            const tokenFailure = Boolean(error) && isGoogleTokenExchangeError(error);
            const errorCategory = tokenFailure ? classifyGoogleOAuthError(error) : classifyGoogleAuthenticationError(error);
            const stateMatchResult = !error && !user ? classifyGooglePassportFailure(info) : undefined;
            const event = tokenFailure ? "GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED" : "GOOGLE_OAUTH_AUTHENTICATION_FAILED";
            logGoogleOAuthDiagnostic(logger, event, { ...diagnostic, errorCategory, stateMatchResult, providerHttpStatus: tokenFailure ? providerStatus(error) : undefined, elapsedMs: Date.now() - startedAt }, "warn");
            logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_REDIRECT_ISSUED", { ...diagnostic, destinationOriginClass: "frontend", destinationPathClass: "login" });
            return sendBrowserTransition(res, oauthFailureUrl(env));
        };

        const handleAuthenticated = async (error, user, info) => {
            if (error || !user) return finishFailure(error, user, info);

            req.user = user;
            const sessionOptions = { provider: "google", eventType: "google.login", eventTitle: "Google sign-in" };
            let issued;
            try {
                issued = options.issueUserSession
                    ? await options.issueUserSession(req.user, req, sessionOptions)
                    : await issueUserSession(req.user, req, sessionOptions);
                logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_SESSION_ESTABLISHED", { ...diagnostic, userTag: fingerprint(user._id), sessionTag: fingerprint(issued.session?.sessionId), elapsedMs: Date.now() - startedAt });
            } catch (_) {
                await callbackReplay.fail(callbackClaim);
                logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_SESSION_FAILED", { ...diagnostic, errorCategory: "GOOGLE_SESSION_ISSUANCE_ERROR", elapsedMs: Date.now() - startedAt }, "warn");
                logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_REDIRECT_ISSUED", { ...diagnostic, destinationOriginClass: "frontend", destinationPathClass: "login" });
                return sendBrowserTransition(res, oauthFailureUrl(env));
            }

            await callbackReplay.complete(callbackClaim, issued.session.sessionId);
            setAuthCookie(res, issued.session.sessionId, env);
            logGoogleOAuthDiagnostic(logger, "GOOGLE_OAUTH_REDIRECT_ISSUED", { ...diagnostic, destinationOriginClass: "frontend", destinationPathClass: "home" });
            return sendBrowserTransition(res, `${getFrontendUrl(env)}/`);
        };

        const propagateFailure = async error => {
            try { await callbackReplay.fail(callbackClaim); } catch (_) { /* A processing claim safely blocks another exchange. */ }
            return next(error);
        };

        try {
            return auth.authenticate("google", { session: false }, (error, user, info) =>
                handleAuthenticated(error, user, info).catch(propagateFailure)
            )(req, res, nextError => propagateFailure(nextError));
        } catch (error) {
            return propagateFailure(error);
        }
    });

    return router;
}

module.exports = createSocialAuthRouter();
module.exports.createSocialAuthRouter = createSocialAuthRouter;
module.exports.getFrontendUrl = getFrontendUrl;
module.exports.sendBrowserTransition = sendBrowserTransition;
