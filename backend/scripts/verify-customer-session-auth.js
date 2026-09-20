"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    AUTH_COOKIE_NAME,
    clearAuthCookie,
    cookieOptions,
    decodeSessionCookie,
    encodeSessionCookie,
    setAuthCookie
} = require("../services/authCookieService");
const csrf = require("../middleware/customerCsrfMiddleware");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function csrfResult(headers, method = "POST") {
    let status = 200; let body = null; let next = false;
    const req = { method, protocol: "https", headers, get: name => name === "host" ? "azielplay.com" : "" };
    const res = { status(value) { status = value; return this; }, json(value) { body = value; return value; } };
    csrf(req, res, () => { next = true; });
    return { status, body, next };
}

function main() {
    const production = { NODE_ENV: "production", AUTH_COOKIE_SECRET: "test-secret-with-enough-entropy" };
    const encoded = encodeSessionCookie("session-id", production);
    assert.strictEqual(decodeSessionCookie(encoded, production), "session-id");
    assert.strictEqual(decodeSessionCookie(`${encoded}x`, production), "");
    assert.strictEqual(AUTH_COOKIE_NAME, "aziel_session");
    assert.deepStrictEqual(cookieOptions(production), {
        httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 15 * 24 * 60 * 60 * 1000
    });
    assert.strictEqual(cookieOptions({ ...production, AUTH_COOKIE_DOMAIN: ".azielplay.com" }).domain, undefined, "canonical auth cookie must remain host-only");

    const cookieCalls = [];
    const cookieResponse = {
        clearCookie(name, options) { cookieCalls.push({ action: "clear", name, options }); },
        cookie(name, value, options) { cookieCalls.push({ action: "set", name, value, options }); }
    };
    const legacyProduction = { ...production, AUTH_COOKIE_DOMAIN: ".azielplay.com" };
    setAuthCookie(cookieResponse, "session-id", legacyProduction);
    assert.strictEqual(cookieCalls[0].action, "clear");
    assert.strictEqual(cookieCalls[0].options.domain, ".azielplay.com");
    assert.strictEqual(cookieCalls[1].action, "set");
    assert.strictEqual(cookieCalls[1].options.domain, undefined);
    cookieCalls.length = 0;
    clearAuthCookie(cookieResponse, legacyProduction);
    assert.deepStrictEqual(cookieCalls.map(call => [call.action, call.options.domain]), [["clear", undefined], ["clear", ".azielplay.com"]]);

    assert.strictEqual(csrfResult({ cookie: "aziel_session=x", origin: "https://azielplay.com" }).next, true);
    assert.strictEqual(csrfResult({ cookie: "aziel_session=x", origin: "https://evil.example" }).status, 403);
    assert.strictEqual(csrfResult({ cookie: "aziel_session=x", origin: "https://auth.azielplay.com" }).status, 403);
    assert.strictEqual(csrfResult({ authorization: "Bearer compatibility", cookie: "aziel_session=x" }).next, true);
    assert.strictEqual(csrfResult({ cookie: "aziel_session=x" }, "GET").next, true);

    const auth = read("backend/routes/auth.js");
    const middleware = read("backend/middleware/authMiddleware.js");
    const sessionService = read("backend/services/authSessionService.js");
    const social = read("backend/routes/socialAuth.js");
    const passport = read("backend/config/passport.js");
    const login = read("frontend/js/login.js");
    const userState = read("frontend/js/user-state.js");
    const worker = read("frontend/sw.js");
    const realtime = read("backend/services/realtime.js");
    const socketClient = read("frontend/js/socket-client.js");

    assert(auth.includes('router.get("/auth/me", authMiddleware'));
    assert(auth.includes('router.post("/auth/logout", async'));
    assert(auth.includes('revokeSession(auth.session.sessionId, auth.user, "logout")'), "logout must revoke the authoritative server session");
    assert(auth.includes("clearAuthCookie(res)"), "logout must clear canonical and legacy cookie variants through the cookie service");
    assert.strictEqual((auth.match(/setAuthCookie\(res, issued\.session\.sessionId\)/g) || []).length, 2, "password and 2FA login must set the cookie");
    assert(!/token:\s*issued\.token/.test(auth), "login responses must not expose reusable JWTs");
    assert(middleware.includes("readSessionId(req)"));
    assert(middleware.includes("verifyUserToken(token"), "Bearer compatibility must remain at the API boundary");
    assert(middleware.includes("setAuthCookie(res, auth.session.sessionId)"), "valid Bearer sessions must upgrade to cookies");
    assert(middleware.includes("legacy_jwt_upgrade"), "legacy JWTs must receive a bounded one-time session upgrade");
    assert(sessionService.includes("LEGACY_JWT_UPGRADE_UNTIL"), "legacy JWT acceptance must have a fixed cutoff");
    assert(passport.includes("state: true"), "Google state validation must remain enabled");
    assert(social.includes("setAuthCookie(res, issued.session.sessionId"));
    assert(!social.includes("googleAuthHandoff") && !social.includes("?handoff="));
    assert(!fs.existsSync(path.join(root, "backend/models/AuthHandoff.js")));
    assert(!fs.existsSync(path.join(root, "frontend/js/google-auth-success.js")));
    assert(login.includes('credentials: "include"'));
    assert(!login.includes("data.token"));
    assert(userState.includes('AZIEL.apiUrl("/api/auth/me")'));
    assert(userState.includes('credentials: "include"'));
    assert(worker.includes('"/api/"'));
    assert(worker.includes("OAUTH_NAVIGATION_PATHS"), "the worker must explicitly leave OAuth navigations browser-owned");
    assert(!worker.includes('"/auth/google/success"'), "obsolete Google success transport must not return");
    assert(!social.includes("res.redirect("), "OAuth routes must not emit HTTP redirects through a service worker");
    assert(!social.includes("AUTH_ORIGIN"), "obsolete auth origin must not reroute OAuth");
    const oauthSession = read("backend/config/session.js");
    assert(oauthSession.includes('name: "aziel.oauth"'));
    assert(oauthSession.includes('path: "/api/auth/google"'));
    assert(oauthSession.includes('sameSite: "lax"') && oauthSession.includes("httpOnly: true"));
    assert(oauthSession.includes("10 * 60 * 1000"), "OAuth state cookie must remain no longer than ten minutes");
    assert(!oauthSession.includes("domain:"), "OAuth state cookie must remain host-only");
    assert(realtime.includes("verifyUserSessionId(sessionId)"));
    assert(socketClient.includes("withCredentials: true"));

    console.log("Customer session authentication verification passed.");
}

main();
