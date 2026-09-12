"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createSocialAuthRouter } = require("../routes/socialAuth");

const ENV = { GOOGLE_CLIENT_ID: "configured", GOOGLE_CLIENT_SECRET: "configured", GOOGLE_CALLBACK_URL: "https://azielplay.com/api/auth/google/callback", FRONTEND_URL: "https://azielplay.com" };

function captureLogger(throwing = false) {
    const records = [];
    const write = (...args) => { if (throwing) throw new Error("logger failed"); records.push(args); };
    return { records, logger: { info: write, warn: write, log: write } };
}

function response() {
    return { redirectUrl: "", redirect(url) { this.redirectUrl = url; return url; } };
}

function request(code = "AUTHORIZATION_CODE_SECRET") {
    return { query: { code, state: "STATE_SECRET" }, headers: { host: "azielplay.com" }, protocol: "https", connection: {}, socket: {} };
}

async function runRoute(router, routePath, req, res) {
    const layer = router.stack.find(item => item.route?.path === routePath);
    assert(layer, `missing route ${routePath}`);
    const handlers = layer.route.stack.map(item => item.handle);
    async function dispatch(index) {
        if (index >= handlers.length) return;
        let advanced = false;
        await Promise.resolve(handlers[index](req, res, error => {
            if (error) throw error;
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
                return async (req, res, next) => callback ? callback(error, user, {}) : next();
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
    const router = createSocialAuthRouter({ passport: stub.passport, issueUserSession: async () => { sessionCalls += 1; }, logger: observed.logger, env: ENV, ...routerOptions });
    const req = request(); const res = response();
    await runRoute(router, "/auth/google/callback", req, res);
    assert.strictEqual(res.redirectUrl, "https://azielplay.com/login.html?oauth=google&error=token_exchange_failed");
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
    const router = createSocialAuthRouter({ passport: stub.passport, issueUserSession: async received => { sessionCalls += 1; assert.strictEqual(received, user); return { token: "JWT_SECRET_VALUE", session: { sessionId: "SESSION_SECRET_ID" } }; }, logger: observed.logger, env: ENV });
    const req = request("SUCCESS_CODE_SECRET"); const res = response();
    await runRoute(router, "/auth/google/callback", req, res);
    assert.strictEqual(sessionCalls, 1);
    assert(res.redirectUrl.startsWith("https://azielplay.com/google-success.html?"));
    assert(res.redirectUrl.includes("token=JWT_SECRET_VALUE"), "existing JWT handoff must remain unchanged");
    const successLogs = JSON.stringify(observed.records);
    for (const secret of ["SUCCESS_CODE_SECRET", "JWT_SECRET_VALUE", "SESSION_SECRET_ID", "USER_SECRET_ID", "private@example.com"]) assert(!successLogs.includes(secret), `diagnostics leaked ${secret}`);
    assert(successLogs.includes("GOOGLE_OAUTH_SESSION_ESTABLISHED"));
    assert(successLogs.includes("GOOGLE_OAUTH_REDIRECT_ISSUED"));

    const sessionObserved = captureLogger();
    const sessionStub = passportResult(null, user);
    const sessionRouter = createSocialAuthRouter({ passport: sessionStub.passport, issueUserSession: async () => { throw new Error("JWT_SECRET_FAILURE"); }, logger: sessionObserved.logger, env: ENV });
    const sessionRes = response();
    await runRoute(sessionRouter, "/auth/google/callback", request(), sessionRes);
    const sessionLogs = JSON.stringify(sessionObserved.records);
    assert(sessionLogs.includes("GOOGLE_OAUTH_SESSION_FAILED"));
    assert(!sessionLogs.includes("GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED"));
    assert(!sessionLogs.includes("JWT_SECRET_FAILURE"));
    assert.strictEqual(sessionRes.redirectUrl, "https://azielplay.com/login.html?oauth=google&error=token_exchange_failed");

    const handoffObserved = captureLogger();
    const handoffUser = { _id: "HANDOFF_USER_SECRET", get username() { throw new Error("HANDOFF_PROFILE_SECRET"); } };
    const handoffStub = passportResult(null, handoffUser);
    const handoffRouter = createSocialAuthRouter({ passport: handoffStub.passport, issueUserSession: async () => ({ token: "HANDOFF_JWT_SECRET", session: { sessionId: "HANDOFF_SESSION_SECRET" } }), logger: handoffObserved.logger, env: ENV });
    const handoffRes = response();
    await runRoute(handoffRouter, "/auth/google/callback", request(), handoffRes);
    const handoffLogs = JSON.stringify(handoffObserved.records);
    assert(handoffLogs.includes("GOOGLE_OAUTH_HANDOFF_FAILED"));
    assert(!handoffLogs.includes("GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED"));
    for (const secret of ["HANDOFF_USER_SECRET", "HANDOFF_PROFILE_SECRET", "HANDOFF_JWT_SECRET", "HANDOFF_SESSION_SECRET"]) assert(!handoffLogs.includes(secret));
    assert.strictEqual(handoffRes.redirectUrl, "https://azielplay.com/login.html?oauth=google&error=token_exchange_failed");

    const diagnosticObserved = captureLogger();
    const diagnosticStub = passportResult(null, user);
    const diagnosticRouter = createSocialAuthRouter({ passport: diagnosticStub.passport, issueUserSession: async () => ({ token: "SAFE_JWT", session: { sessionId: "SAFE_SESSION" } }), logger: diagnosticObserved.logger, env: ENV, randomBytes: () => { throw new Error("crypto unavailable"); } });
    const diagnosticRes = response();
    await runRoute(diagnosticRouter, "/auth/google/callback", request(), diagnosticRes);
    assert(diagnosticRes.redirectUrl.startsWith("https://azielplay.com/google-success.html?"), "throwing diagnostic correlation construction must not affect OAuth success");

    const hostileRequest = request();
    Object.defineProperty(hostileRequest, "query", { get() { throw new Error("HOSTILE_REQUEST_GETTER_SECRET"); } });
    const hostileRequestRes = response();
    await runRoute(diagnosticRouter, "/auth/google/callback", hostileRequest, hostileRequestRes);
    assert(hostileRequestRes.redirectUrl.startsWith("https://azielplay.com/google-success.html?"), "throwing request accessors used by diagnostics must not affect OAuth success");

    const root = path.resolve(__dirname, "../..");
    const social = fs.readFileSync(path.join(root, "backend/routes/socialAuth.js"), "utf8");
    const passport = fs.readFileSync(path.join(root, "backend/config/passport.js"), "utf8");
    const login = fs.readFileSync(path.join(root, "frontend/js/login.js"), "utf8");
    assert.strictEqual((social.match(/router\.get\("\/auth\/google\/callback"/g) || []).length, 1);
    assert(social.includes('auth.authenticate("google", { session: false }, async (error, user)'));
    assert(passport.includes("passReqToCallback: true"));
    assert(passport.includes("issueUserSession") === false, "Passport strategy must not take over AZIEL session authority");
    assert(login.includes('oauthParams.get("error") === "token_exchange_failed"'));
    assert(login.includes("Google sign-in couldn't be completed. Please try again."));
    console.log("Google OAuth callback reliability verification passed (19 focused cases).");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
