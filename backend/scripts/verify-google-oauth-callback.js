"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createSocialAuthRouter } = require("../routes/socialAuth");

const ENV = { GOOGLE_CLIENT_ID: "configured", GOOGLE_CLIENT_SECRET: "configured", GOOGLE_CALLBACK_URL: "https://azielplay.com/api/auth/google/callback", FRONTEND_URL: "https://azielplay.com" };
const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth?client_id=configured&redirect_uri=https%3A%2F%2Fazielplay.com%2Fapi%2Fauth%2Fgoogle%2Fcallback&state=OPAQUE_STATE_VALUE&scope=profile%20email";

function captureLogger(throwing = false) {
    const records = [];
    const write = (...args) => { if (throwing) throw new Error("logger failed"); records.push(args); };
    return { records, logger: { info: write, warn: write, log: write } };
}

function response() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        committedStatuses: [],
        redirectUrl: "",
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        status(value) { this.statusCode = value; return this; },
        type(value) { this.contentType = value; this.setHeader("Content-Type", value); return this; },
        send(value) { this.body = value; this.end(); return value; },
        end() { this.committedStatuses.push(this.statusCode); return this; },
        json(value) { this.body = value; return value; },
        cookie(name, value, options) { this.cookieValue = { name, value, options }; return this; },
        redirect(url) { this.redirectUrl = url; return url; }
    };
}

function transitionDestination(res) {
    const match = String(res.body || "").match(/window\.location\.replace\(("(?:[^"\\]|\\.)*")\)/);
    return match ? JSON.parse(match[1]) : "";
}

function request(code = "AUTHORIZATION_CODE_SECRET") {
    return { query: { code, state: "STATE_SECRET" }, headers: { host: "azielplay.com" }, protocol: "https", connection: {}, socket: {} };
}

async function runRoute(router, routePath, req, res, onError) {
    const layer = router.stack.find(item => item.route?.path === routePath);
    assert(layer, `missing route ${routePath}`);
    const handlers = layer.route.stack.map(item => item.handle);
    async function dispatch(index) {
        if (index >= handlers.length) return;
        let advanced = false;
        await Promise.resolve(handlers[index](req, res, error => {
            if (error) {
                if (onError) return onError(error);
                throw error;
            }
            advanced = true;
        }));
        if (advanced) await dispatch(index + 1);
    }
    await dispatch(0);
}

function passportResult(error, user) {
    const calls = [];
    return {
        calls,
        passport: {
            authenticate(name, options, callback) {
                calls.push({ name, options, hasCallback: typeof callback === "function" });
                return async (req, res) => {
                    if (callback) return callback(error, user, {});
                    res.statusCode = 302;
                    res.setHeader("Location", GOOGLE_AUTHORIZATION_URL);
                    res.setHeader("Content-Length", "0");
                    return res.end();
                };
            }
        }
    };
}

function tokenError(code, extra = {}) {
    return Object.assign(new Error("raw provider description"), { name: "TokenError", code, status: 400 }, extra);
}

function internalTokenError(code) {
    return Object.assign(new Error("Failed to obtain access token"), { name: "InternalOAuthError", oauthError: { code } });
}

async function failureCase(error, expectedEvent, expectedCategory, loggerOverride, routerOptions = {}) {
    const observed = loggerOverride || captureLogger();
    const stub = passportResult(error, null);
    let sessionCalls = 0;
    const router = createSocialAuthRouter({ passport: stub.passport, issueUserSession: async () => { sessionCalls += 1; }, handoffService: { create: async () => "unused", consume: async () => null }, logger: observed.logger, env: ENV, ...routerOptions });
    const req = request(); const res = response();
    await runRoute(router, "/auth/google/callback", req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(transitionDestination(res), "https://azielplay.com/login?oauth=google&error=token_exchange_failed");
    assert.strictEqual(sessionCalls, 0, "OAuth failure must not create an AZIEL session/JWT");
    assert.strictEqual(stub.calls.length, 1, "callback must invoke Passport exactly once");
    if (!loggerOverride) {
        const serialized = JSON.stringify(observed.records);
        assert(serialized.includes(expectedEvent));
        assert(serialized.includes(expectedCategory));
        assert(!serialized.includes("AUTHORIZATION_CODE_SECRET"));
        assert(!serialized.includes("STATE_SECRET"));
        assert(!serialized.includes("raw provider description"));
    }
    return observed.records;
}

async function main() {
    const startStub = passportResult(null, null);
    const startEnv = { ...ENV, AUTH_ORIGIN: "https://auth.azielplay.com" };
    const startRouter = createSocialAuthRouter({ passport: startStub.passport, logger: captureLogger().logger, env: startEnv });
    const startRes = response();
    const originalStartSetHeader = startRes.setHeader;
    const originalStartEnd = startRes.end;
    await runRoute(startRouter, "/auth/google", request(), startRes);
    assert.strictEqual(startStub.calls.length, 1, "OAuth start must invoke local Passport even when obsolete AUTH_ORIGIN is present");
    assert.strictEqual(startStub.calls[0].name, "google");
    assert.strictEqual(startStub.calls[0].options.state, true, "OAuth start must retain Passport state validation");
    assert.strictEqual(startRes.statusCode, 200, "Passport's intermediate redirect must become a browser transition");
    assert.strictEqual(startRes.headers.location, undefined, "final OAuth start response must not expose a Location header");
    assert.strictEqual(startRes.headers["content-length"], undefined, "Passport's zero-length redirect body must not be committed");
    assert.strictEqual(startRes.headers["cache-control"], "no-store");
    assert.strictEqual(startRes.headers["referrer-policy"], "no-referrer");
    assert.strictEqual(startRes.headers["content-type"], "html");
    assert.strictEqual(transitionDestination(startRes), GOOGLE_AUTHORIZATION_URL, "Passport's authorization destination must remain exact and unmodified");
    assert(transitionDestination(startRes).includes("state=OPAQUE_STATE_VALUE"), "opaque Passport state must remain in the browser transition");
    assert.deepStrictEqual(startRes.committedStatuses, [200], "the intermediate 302 end must never be committed");
    assert.strictEqual(startRes.setHeader, originalStartSetHeader, "successful transition must restore setHeader");
    assert.strictEqual(startRes.end, originalStartEnd, "successful transition must restore end");

    for (const mode of ["next", "throw"]) {
        const failure = new Error(`start-${mode}`);
        const failurePassport = {
            authenticate() {
                if (mode === "next") return (req, res, next) => next(failure);
                if (mode === "throw") return () => { throw failure; };
                return async () => { throw failure; };
            }
        };
        const failureRouter = createSocialAuthRouter({ passport: failurePassport, logger: captureLogger().logger, env: ENV });
        const failureRes = response();
        const originalSetHeader = failureRes.setHeader;
        const originalEnd = failureRes.end;
        await assert.rejects(runRoute(failureRouter, "/auth/google", request(), failureRes), failure);
        assert.strictEqual(failureRes.setHeader, originalSetHeader, `${mode} path must restore setHeader`);
        assert.strictEqual(failureRes.end, originalEnd, `${mode} path must restore end`);
        assert.strictEqual(failureRes.statusCode, 200, `${mode} path must restore statusCode`);
    }

    const rejectedError = new Error("start-reject");
    const rejectedPassport = { authenticate() { return async () => { throw rejectedError; }; } };
    const rejectedRouter = createSocialAuthRouter({ passport: rejectedPassport, logger: captureLogger().logger, env: ENV });
    const rejectedRes = response();
    const originalRejectedSetHeader = rejectedRes.setHeader;
    const originalRejectedEnd = rejectedRes.end;
    const receivedErrors = [];
    await runRoute(rejectedRouter, "/auth/google", request(), rejectedRes, error => { receivedErrors.push(error); });
    assert.deepStrictEqual(receivedErrors, [rejectedError], "rejected middleware must call next with the original error exactly once");
    assert.strictEqual(rejectedRes.setHeader, originalRejectedSetHeader, "reject path must restore setHeader");
    assert.strictEqual(rejectedRes.end, originalRejectedEnd, "reject path must restore end");
    assert.strictEqual(rejectedRes.statusCode, 200, "reject path must restore statusCode");
    assert.deepStrictEqual(rejectedRes.committedStatuses, [], "reject path must not commit a response");
    assert.strictEqual(rejectedRes.body, null, "reject path must not send a response body");

    await failureCase(tokenError("invalid_grant"), "GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED", "GOOGLE_TOKEN_INVALID_GRANT");
    await failureCase(tokenError("invalid_client"), "GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED", "GOOGLE_TOKEN_INVALID_CLIENT");
    await failureCase(internalTokenError("ETIMEDOUT"), "GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED", "GOOGLE_TOKEN_NETWORK_ERROR");
    await failureCase(tokenError("provider_error"), "GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED", "GOOGLE_TOKEN_PROVIDER_ERROR");
    await failureCase(tokenError("invalid_grant"), "GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED", "GOOGLE_TOKEN_INVALID_GRANT", captureLogger(true));

    const profileError = Object.assign(new Error("raw profile detail"), { googleOAuthStage: "profile", status: 500 });
    const profileLogs = JSON.stringify(await failureCase(profileError, "GOOGLE_OAUTH_AUTHENTICATION_FAILED", "GOOGLE_PROFILE_ERROR"));
    assert(!profileLogs.includes("GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED"));
    const databaseError = Object.assign(new Error("raw database detail"), { googleOAuthStage: "user_resolution", code: "ETIMEDOUT" });
    const databaseLogs = JSON.stringify(await failureCase(databaseError, "GOOGLE_OAUTH_AUTHENTICATION_FAILED", "GOOGLE_USER_RESOLUTION_ERROR"));
    assert(!databaseLogs.includes("GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED"), "DB network errors must not be mistaken for token network errors");
    assert(!profileLogs.includes("raw profile detail"));
    assert(!databaseLogs.includes("raw database detail"));

    const hostileError = new Proxy({}, { get() { throw new Error("HOSTILE_ERROR_GETTER_SECRET"); } });
    const hostileLogs = JSON.stringify(await failureCase(hostileError, "GOOGLE_OAUTH_AUTHENTICATION_FAILED", "GOOGLE_AUTH_APPLICATION_ERROR"));
    assert(!hostileLogs.includes("HOSTILE_ERROR_GETTER_SECRET"));

    const noUserLogs = await failureCase(null, "GOOGLE_OAUTH_AUTHENTICATION_FAILED", "GOOGLE_AUTH_UNKNOWN_ERROR");
    assert(!JSON.stringify(noUserLogs).includes("GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED"));

    const first = await failureCase(tokenError("invalid_grant"), "GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED", "GOOGLE_TOKEN_INVALID_GRANT");
    const second = await failureCase(tokenError("invalid_grant"), "GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED", "GOOGLE_TOKEN_INVALID_GRANT");
    const fingerprintOf = records => records.find(([, item]) => item.event === "GOOGLE_OAUTH_CALLBACK_RECEIVED")[1].codeFingerprint;
    assert.strictEqual(fingerprintOf(first), fingerprintOf(second), "same authorization code must have the same safe replay fingerprint");
    assert.notStrictEqual(fingerprintOf(first), "AUTHORIZATION_CODE_SECRET");

    const observed = captureLogger();
    const user = { _id: "USER_SECRET_ID", username: "google-user", displayName: "Google User", email: "private@example.com", region: "TH", role: "user" };
    const stub = passportResult(null, user);
    let sessionCalls = 0;
    const router = createSocialAuthRouter({ passport: stub.passport, issueUserSession: async received => { sessionCalls += 1; assert.strictEqual(received, user); return { token: "JWT_SECRET_VALUE", session: { sessionId: "SESSION_SECRET_ID" }, user }; }, logger: observed.logger, env: ENV });
    const req = request("SUCCESS_CODE_SECRET"); const res = response();
    await runRoute(router, "/auth/google/callback", req, res);
    assert.strictEqual(sessionCalls, 1);
    assert.strictEqual(transitionDestination(res), "https://azielplay.com/");
    assert.strictEqual(res.cookieValue.name, "aziel_session");
    assert.strictEqual(res.cookieValue.options.httpOnly, true);
    assert.strictEqual(res.cookieValue.options.sameSite, "lax");
    assert.strictEqual(res.cookieValue.options.domain, undefined, "Google callback must issue a host-only customer cookie");
    assert(!String(res.body).includes("JWT_SECRET_VALUE"), "JWT must not appear in the callback response or URL");
    const successLogs = JSON.stringify(observed.records);
    for (const secret of ["SUCCESS_CODE_SECRET", "JWT_SECRET_VALUE", "SESSION_SECRET_ID", "USER_SECRET_ID", "private@example.com"]) assert(!successLogs.includes(secret), `diagnostics leaked ${secret}`);
    assert(successLogs.includes("GOOGLE_OAUTH_SESSION_ESTABLISHED"));
    assert(successLogs.includes("GOOGLE_OAUTH_REDIRECT_ISSUED"));

    const sessionObserved = captureLogger();
    const sessionStub = passportResult(null, user);
    const sessionRouter = createSocialAuthRouter({ passport: sessionStub.passport, issueUserSession: async () => { throw new Error("JWT_SECRET_FAILURE"); }, handoffService: { create: async () => "unused", consume: async () => null }, logger: sessionObserved.logger, env: ENV });
    const sessionRes = response();
    await runRoute(sessionRouter, "/auth/google/callback", request(), sessionRes);
    const sessionLogs = JSON.stringify(sessionObserved.records);
    assert(sessionLogs.includes("GOOGLE_OAUTH_SESSION_FAILED"));
    assert(!sessionLogs.includes("GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED"));
    assert(!sessionLogs.includes("JWT_SECRET_FAILURE"));
    assert.strictEqual(transitionDestination(sessionRes), "https://azielplay.com/login?oauth=google&error=token_exchange_failed");

    const diagnosticObserved = captureLogger();
    const diagnosticStub = passportResult(null, user);
    const diagnosticRouter = createSocialAuthRouter({ passport: diagnosticStub.passport, issueUserSession: async () => ({ token: "SAFE_JWT", session: { sessionId: "SAFE_SESSION" }, user }), handoffService: { create: async () => "SAFE_HANDOFF", consume: async () => null }, logger: diagnosticObserved.logger, env: ENV, randomBytes: () => { throw new Error("crypto unavailable"); } });
    const diagnosticRes = response();
    await runRoute(diagnosticRouter, "/auth/google/callback", request(), diagnosticRes);
    assert.strictEqual(transitionDestination(diagnosticRes), "https://azielplay.com/", "throwing diagnostic correlation construction must not affect OAuth success");

    const hostileRequest = request();
    Object.defineProperty(hostileRequest, "query", { get() { throw new Error("HOSTILE_REQUEST_GETTER_SECRET"); } });
    const hostileRequestRes = response();
    await runRoute(diagnosticRouter, "/auth/google/callback", hostileRequest, hostileRequestRes);
    assert.strictEqual(transitionDestination(hostileRequestRes), "https://azielplay.com/", "throwing request accessors used by diagnostics must not affect OAuth success");

    const root = path.resolve(__dirname, "../..");
    const social = fs.readFileSync(path.join(root, "backend/routes/socialAuth.js"), "utf8");
    const passport = fs.readFileSync(path.join(root, "backend/config/passport.js"), "utf8");
    const login = fs.readFileSync(path.join(root, "frontend/js/login.js"), "utf8");
    assert.strictEqual((social.match(/router\.get\("\/auth\/google\/callback"/g) || []).length, 1);
    assert(social.includes('auth.authenticate("google", { session: false }, async (error, user)'));
    assert(passport.includes("passReqToCallback: true"));
    assert(passport.includes("state: true"), "Google OAuth must retain server-side state validation");
    assert(passport.includes("issueUserSession") === false, "Passport strategy must not take over AZIEL session authority");
    assert(login.includes('["token_exchange_failed", "handoff_failed"].includes(oauthParams.get("error"))'));
    assert(login.includes("Google sign-in couldn't be completed. Please try again."));
    assert(!social.includes("handoff"), "Google OAuth must not contain a frontend token handoff");
    console.log("Google OAuth callback reliability verification passed (server-owned cookie session).");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
