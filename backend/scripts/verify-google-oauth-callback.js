"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createSocialAuthRouter: createRouter } = require("../routes/socialAuth");
const { readSessionId } = require("../services/authCookieService");
const { createGoogleOAuthCallbackReplayService } = require("../services/googleOAuthCallbackReplayService");

const ENV = { NODE_ENV: "production", AUTH_COOKIE_SECRET: "test-secret-with-enough-entropy", GOOGLE_CLIENT_ID: "configured", GOOGLE_CLIENT_SECRET: "configured", GOOGLE_CALLBACK_URL: "https://azielplay.com/api/auth/google/callback", FRONTEND_URL: "https://azielplay.com" };
const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth?client_id=configured&redirect_uri=https%3A%2F%2Fazielplay.com%2Fapi%2Fauth%2Fgoogle%2Fcallback&state=OPAQUE_STATE_VALUE&scope=profile%20email";
const unmanagedCallbackReplay = {
    claim: async () => ({ owner: true, unmanaged: true }),
    complete: async (claim, sessionId) => ({ status: "completed", sessionId }),
    fail: async () => undefined,
    waitForResult: async () => ({ status: "failed" })
};

function createSocialAuthRouter(options = {}) {
    return createRouter({ callbackReplay: unmanagedCallbackReplay, ...options });
}

function memoryReplayService() {
    const records = new Map();
    const repository = {
        async create(document) {
            if (records.has(document.callbackKey)) throw Object.assign(new Error("duplicate"), { code: 11000 });
            records.set(document.callbackKey, { ...document });
            return records.get(document.callbackKey);
        },
        async find(callbackKey) {
            const record = records.get(callbackKey);
            return record && { ...record };
        },
        async complete(callbackKey, bindingKey, sessionId) {
            const record = records.get(callbackKey);
            if (!record || record.bindingKey !== bindingKey || record.status !== "processing") return null;
            Object.assign(record, { status: "completed", sessionId });
            return { ...record };
        },
        async fail(callbackKey, bindingKey) {
            const record = records.get(callbackKey);
            if (!record || record.bindingKey !== bindingKey || record.status !== "processing") return null;
            record.status = "failed";
            return { ...record };
        }
    };
    return createGoogleOAuthCallbackReplayService({ repository, env: ENV, waitIntervalMs: 1, waitTimeoutMs: 1000 });
}

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
        cookieOperations: [],
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        status(value) { this.statusCode = value; return this; },
        type(value) { this.contentType = value; this.setHeader("Content-Type", value); return this; },
        send(value) { this.body = value; this.end(); return value; },
        end() { this.committedStatuses.push(this.statusCode); return this; },
        json(value) { this.body = value; return value; },
        appendCookieHeader(value) {
            const current = this.headers["set-cookie"];
            this.headers["set-cookie"] = current === undefined ? [value] : (Array.isArray(current) ? [...current, value] : [current, value]);
        },
        cookie(name, value, options) {
            this.cookieValue = { name, value, options };
            this.cookieOperations.push({ action: "set", name, value, options });
            this.appendCookieHeader(`${name}=${value}; Path=${options.path || "/"}${options.domain ? `; Domain=${options.domain}` : ""}`);
            return this;
        },
        clearCookie(name, options) {
            this.cookieOperations.push({ action: "clear", name, value: "", options });
            this.appendCookieHeader(`${name}=; Path=${options.path || "/"}${options.domain ? `; Domain=${options.domain}` : ""}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
            return this;
        },
        redirect(url) { this.redirectUrl = url; return url; }
    };
}

function applyCustomerCookieOperations(jar, operations, responseHost = "azielplay.com") {
    for (const operation of operations.filter(item => item.name === "aziel_session")) {
        const domain = operation.options.domain || responseHost;
        const hostOnly = !operation.options.domain;
        const index = jar.findIndex(item => item.name === operation.name && item.domain === domain && item.hostOnly === hostOnly && item.path === (operation.options.path || "/"));
        if (operation.action === "clear") {
            if (index >= 0) jar.splice(index, 1);
            continue;
        }
        const cookie = { name: operation.name, value: operation.value, domain, hostOnly, path: operation.options.path || "/" };
        if (index >= 0) jar[index] = cookie;
        else jar.push(cookie);
    }
}

function cookieHeaderFor(jar, host, requestPath) {
    return jar
        .filter(cookie => (cookie.hostOnly ? cookie.domain === host : host === cookie.domain.replace(/^\./, "") || host.endsWith(cookie.domain)) && requestPath.startsWith(cookie.path))
        .map(cookie => `${cookie.name}=${cookie.value}`)
        .join("; ");
}

function transitionDestination(res) {
    const match = String(res.body || "").match(/window\.location\.replace\(("(?:[^"\\]|\\.)*")\)/);
    return match ? JSON.parse(match[1]) : "";
}

function request(code = "AUTHORIZATION_CODE_SECRET", session = { save(callback) { callback(); } }) {
    return {
        query: { code, state: "STATE_SECRET" },
        headers: { host: "azielplay.com", cookie: "aziel.oauth=SIGNED_COOKIE_SECRET" },
        protocol: "https",
        connection: {},
        socket: {},
        sessionID: "EXPRESS_SESSION_SECRET_ID",
        session
    };
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

function passportResult(error, user, info = {}) {
    const calls = [];
    return {
        calls,
        passport: {
            authenticate(name, options, callback) {
                calls.push({ name, options, hasCallback: typeof callback === "function" });
                return async (req, res) => {
                    if (callback) return callback(error, user, info);
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

async function failureCase(error, expectedEvent, expectedCategory, loggerOverride, routerOptions = {}, info = {}) {
    const observed = loggerOverride || captureLogger();
    const stub = passportResult(error, null, info);
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

    let releaseDelayedSave;
    let delayedSaveCalls = 0;
    const delayedSession = {
        oauth2: { state: "RAW_OAUTH_STATE_MUST_NOT_LOG" },
        save(callback) {
            delayedSaveCalls += 1;
            releaseDelayedSave = callback;
        }
    };
    const delayedObserved = captureLogger();
    const delayedRouter = createSocialAuthRouter({ passport: passportResult(null, null).passport, logger: delayedObserved.logger, env: ENV });
    const delayedRes = response();
    const delayedErrors = [];
    const delayedRun = runRoute(delayedRouter, "/auth/google", request("AUTHORIZATION_CODE_SECRET", delayedSession), delayedRes, error => delayedErrors.push(error));
    await Promise.resolve();
    assert.strictEqual(delayedSaveCalls, 1, "OAuth start must explicitly save the state session exactly once");
    assert.strictEqual(delayedRes.body, null, "transition HTML must not exist while session persistence is pending");
    assert.deepStrictEqual(delayedRes.committedStatuses, [], "no response may be committed before session persistence");
    releaseDelayedSave();
    await delayedRun;
    assert.strictEqual(transitionDestination(delayedRes), GOOGLE_AUTHORIZATION_URL, "exact Passport destination must be emitted after persistence");
    assert.deepStrictEqual(delayedRes.committedStatuses, [200], "transition must be emitted exactly once after persistence");
    assert.deepStrictEqual(delayedErrors, []);
    const delayedLogs = JSON.stringify(delayedObserved.records);
    assert(delayedLogs.includes("GOOGLE_OAUTH_STATE_SAVE_STARTED"));
    assert(delayedLogs.includes("GOOGLE_OAUTH_STATE_SAVE_COMPLETED"));
    for (const secret of ["RAW_OAUTH_STATE_MUST_NOT_LOG", "SIGNED_COOKIE_SECRET", "EXPRESS_SESSION_SECRET_ID"]) {
        assert(!delayedLogs.includes(secret), `state-save diagnostics leaked ${secret}`);
    }

    const saveFailure = new Error("MONGO_SAVE_SECRET_FAILURE");
    const failedSaveObserved = captureLogger();
    const failedSaveRouter = createSocialAuthRouter({ passport: passportResult(null, null).passport, logger: failedSaveObserved.logger, env: ENV });
    const failedSaveRes = response();
    const failedSaveErrors = [];
    await runRoute(failedSaveRouter, "/auth/google", request("AUTHORIZATION_CODE_SECRET", {
        oauth2: { state: "RAW_FAILED_STATE" },
        save(callback) { callback(saveFailure); }
    }), failedSaveRes, error => failedSaveErrors.push(error));
    assert.deepStrictEqual(failedSaveErrors, [saveFailure], "session save failure must propagate exactly once");
    assert.strictEqual(failedSaveRes.body, null, "session save failure must not expose Google transition HTML");
    assert.deepStrictEqual(failedSaveRes.committedStatuses, []);
    const failedSaveLogs = JSON.stringify(failedSaveObserved.records);
    assert(failedSaveLogs.includes("GOOGLE_OAUTH_STATE_SAVE_FAILED"));
    assert(!failedSaveLogs.includes("MONGO_SAVE_SECRET_FAILURE"));
    assert(!failedSaveLogs.includes("RAW_FAILED_STATE"));

    let duplicateSaveCallback;
    const duplicatePassport = {
        authenticate() {
            return (req, res) => {
                res.statusCode = 302;
                res.setHeader("Location", GOOGLE_AUTHORIZATION_URL);
                const finish = res.end;
                finish();
                finish();
                return Promise.reject(new Error("LATE_PASSPORT_REJECTION"));
            };
        }
    };
    const duplicateRouter = createSocialAuthRouter({ passport: duplicatePassport, logger: captureLogger().logger, env: ENV });
    const duplicateRes = response();
    const duplicateErrors = [];
    const duplicateRun = runRoute(duplicateRouter, "/auth/google", request("AUTHORIZATION_CODE_SECRET", {
        save(callback) { duplicateSaveCallback = callback; }
    }), duplicateRes, error => duplicateErrors.push(error));
    await Promise.resolve();
    duplicateSaveCallback();
    duplicateSaveCallback(new Error("LATE_SAVE_FAILURE"));
    await duplicateRun;
    assert.deepStrictEqual(duplicateRes.committedStatuses, [200], "duplicate completions must emit one transition only");
    assert.deepStrictEqual(duplicateErrors, [], "late errors must not run next after a successful transition");

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
        let failureSaveCalls = 0;
        await assert.rejects(runRoute(failureRouter, "/auth/google", request("AUTHORIZATION_CODE_SECRET", {
            save(callback) { failureSaveCalls += 1; callback(); }
        }), failureRes), failure);
        assert.strictEqual(failureRes.setHeader, originalSetHeader, `${mode} path must restore setHeader`);
        assert.strictEqual(failureRes.end, originalEnd, `${mode} path must restore end`);
        assert.strictEqual(failureRes.statusCode, 200, `${mode} path must restore statusCode`);
        assert.strictEqual(failureSaveCalls, 0, `${mode} Passport failure must not save or transition`);
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

    const missingStateInfo = { message: "Unable to verify authorization request state.", rawState: "RAW_MISSING_STATE_SECRET" };
    const missingStateLogs = JSON.stringify(await failureCase(null, "GOOGLE_OAUTH_AUTHENTICATION_FAILED", "GOOGLE_AUTH_UNKNOWN_ERROR", undefined, {}, missingStateInfo));
    assert(missingStateLogs.includes('"stateMatchResult":"missing_session_state"'));
    for (const secret of ["RAW_MISSING_STATE_SECRET", "AUTHORIZATION_CODE_SECRET", "SIGNED_COOKIE_SECRET", "EXPRESS_SESSION_SECRET_ID"]) {
        assert(!missingStateLogs.includes(secret), `missing-state diagnostics leaked ${secret}`);
    }

    const mismatchedStateInfo = { message: "Invalid authorization request state.", rawState: "RAW_MISMATCHED_STATE_SECRET" };
    const mismatchedStateLogs = JSON.stringify(await failureCase(null, "GOOGLE_OAUTH_AUTHENTICATION_FAILED", "GOOGLE_AUTH_UNKNOWN_ERROR", undefined, {}, mismatchedStateInfo));
    assert(mismatchedStateLogs.includes('"stateMatchResult":"state_mismatch"'));
    for (const secret of ["RAW_MISMATCHED_STATE_SECRET", "AUTHORIZATION_CODE_SECRET", "SIGNED_COOKIE_SECRET", "EXPRESS_SESSION_SECRET_ID"]) {
        assert(!mismatchedStateLogs.includes(secret), `mismatched-state diagnostics leaked ${secret}`);
    }

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
    res.setHeader("Set-Cookie", ["aziel.oauth=OAUTH_COOKIE; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax"]);
    await runRoute(router, "/auth/google/callback", req, res);
    assert.strictEqual(sessionCalls, 1);
    assert.strictEqual(transitionDestination(res), "https://azielplay.com/");
    assert.strictEqual(res.cookieValue.name, "aziel_session");
    assert.strictEqual(res.cookieValue.options.httpOnly, true);
    assert.strictEqual(res.cookieValue.options.sameSite, "lax");
    assert.strictEqual(res.cookieValue.options.secure, true);
    assert.strictEqual(res.cookieValue.options.path, "/");
    assert.strictEqual(res.cookieValue.options.domain, undefined, "Google callback must issue a host-only customer cookie");
    assert.deepStrictEqual(res.cookieOperations.map(item => [item.action, item.options.domain]), [["clear", ".azielplay.com"], ["set", undefined]], "callback must expire the legacy domain cookie before issuing the canonical host-only cookie");
    assert.strictEqual(res.headers["set-cookie"].length, 3, "OAuth and both customer-cookie headers must be preserved");
    assert(res.headers["set-cookie"][0].startsWith("aziel.oauth="), "existing OAuth Set-Cookie must not be overwritten");

    const cookieJar = [{ name: "aziel_session", value: "OLD", domain: ".azielplay.com", hostOnly: false, path: "/" }];
    applyCustomerCookieOperations(cookieJar, res.cookieOperations);
    assert(!cookieJar.some(cookie => cookie.name === "aziel_session" && cookie.domain === ".azielplay.com"), "legacy domain cookie must be removed from the browser jar");
    const canonicalCookie = cookieJar.find(cookie => cookie.name === "aziel_session");
    assert(canonicalCookie?.hostOnly, "the replacement customer cookie must be host-only");
    const homeCookieHeader = cookieHeaderFor(cookieJar, "azielplay.com", "/");
    assert.strictEqual(homeCookieHeader, `aziel_session=${canonicalCookie.value}`, "the next home request must send only the canonical cookie");
    const meCookieHeader = cookieHeaderFor(cookieJar, "azielplay.com", "/api/auth/me");
    assert.strictEqual(meCookieHeader, homeCookieHeader, "/api/auth/me must receive the canonical cookie");
    const selectedSessionId = readSessionId({ headers: { cookie: meCookieHeader } }, ENV);
    assert.strictEqual(selectedSessionId, "SESSION_SECRET_ID", "canonical cookie signature must verify and select the newly created session");
    const now = Date.now();
    const sessions = new Map([["SESSION_SECRET_ID", { sessionId: "SESSION_SECRET_ID", userId: user._id, revokedAt: null, expiresAt: new Date(now + 60_000) }]]);
    const users = new Map([[user._id, user]]);
    const selectedSession = sessions.get(selectedSessionId);
    assert(selectedSession && !selectedSession.revokedAt && selectedSession.expiresAt.getTime() > now, "selected session must be live, unrevoked, and unexpired");
    const selectedUser = users.get(selectedSession.userId);
    assert.strictEqual(selectedUser, user, "selected session must resolve its user");
    const authMeStatus = selectedUser ? 200 : 401;
    assert.strictEqual(authMeStatus, 200, "/api/auth/me must authenticate on the first request after callback");
    assert(!String(res.body).includes("JWT_SECRET_VALUE"), "JWT must not appear in the callback response or URL");
    const successLogs = JSON.stringify(observed.records);
    for (const secret of ["SUCCESS_CODE_SECRET", "JWT_SECRET_VALUE", "SESSION_SECRET_ID", "USER_SECRET_ID", "private@example.com"]) assert(!successLogs.includes(secret), `diagnostics leaked ${secret}`);
    assert(successLogs.includes("GOOGLE_OAUTH_SESSION_ESTABLISHED"));
    assert(successLogs.includes("GOOGLE_OAUTH_REDIRECT_ISSUED"));

    const replayService = memoryReplayService();
    let releaseProvider;
    let markProviderStarted;
    const providerGate = new Promise(resolve => { releaseProvider = resolve; });
    const providerStarted = new Promise(resolve => { markProviderStarted = resolve; });
    let providerExchanges = 0;
    let replaySessionCalls = 0;
    const replayPassport = {
        authenticate(name, options, callback) {
            return async () => {
                providerExchanges += 1;
                markProviderStarted();
                await providerGate;
                return callback(null, user, {});
            };
        }
    };
    const replayRouter = createSocialAuthRouter({
        passport: replayPassport,
        callbackReplay: replayService,
        issueUserSession: async () => {
            replaySessionCalls += 1;
            return { session: { sessionId: "REPLAY_SAFE_SESSION" }, user };
        },
        logger: captureLogger().logger,
        env: ENV
    });
    const concurrentFirst = response();
    const concurrentSecond = response();
    const firstRun = runRoute(replayRouter, "/auth/google/callback", request("SAME_AUTHORIZATION_CODE"), concurrentFirst);
    const secondRun = runRoute(replayRouter, "/auth/google/callback", request("SAME_AUTHORIZATION_CODE"), concurrentSecond);
    await providerStarted;
    assert.strictEqual(providerExchanges, 1, "concurrent identical callbacks must exchange the provider code at most once");
    releaseProvider();
    await Promise.all([firstRun, secondRun]);
    assert.strictEqual(providerExchanges, 1);
    assert.strictEqual(replaySessionCalls, 1, "concurrent identical callbacks must create exactly one AZIEL session");
    assert.strictEqual(transitionDestination(concurrentFirst), "https://azielplay.com/");
    assert.strictEqual(transitionDestination(concurrentSecond), "https://azielplay.com/");
    assert.strictEqual(readSessionId({ headers: { cookie: `aziel_session=${concurrentFirst.cookieValue.value}` } }, ENV), "REPLAY_SAFE_SESSION");
    assert.strictEqual(readSessionId({ headers: { cookie: `aziel_session=${concurrentSecond.cookieValue.value}` } }, ENV), "REPLAY_SAFE_SESSION", "duplicate response must reuse the successful authoritative session");

    const sequentialReplay = response();
    await runRoute(replayRouter, "/auth/google/callback", request("SAME_AUTHORIZATION_CODE"), sequentialReplay);
    assert.strictEqual(providerExchanges, 1, "sequential replay must not exchange an already-processed authorization code");
    assert.strictEqual(replaySessionCalls, 1, "sequential replay must not create another customer session");
    assert.strictEqual(transitionDestination(sequentialReplay), "https://azielplay.com/");
    assert.strictEqual(readSessionId({ headers: { cookie: `aziel_session=${sequentialReplay.cookieValue.value}` } }, ENV), "REPLAY_SAFE_SESSION", "sequential replay must preserve the successful session");

    const mismatchedReplayRequest = request("SAME_AUTHORIZATION_CODE");
    mismatchedReplayRequest.query.state = "DIFFERENT_STATE";
    const mismatchedReplayErrors = [];
    const mismatchedReplayResponse = response();
    await runRoute(replayRouter, "/auth/google/callback", mismatchedReplayRequest, mismatchedReplayResponse, error => mismatchedReplayErrors.push(error));
    assert.strictEqual(mismatchedReplayErrors[0]?.code, "GOOGLE_OAUTH_CALLBACK_REPLAY_BINDING_MISMATCH", "a replay must remain bound to the original OAuth state and express session");
    assert.strictEqual(providerExchanges, 1, "binding mismatch must never reach the provider exchange");
    assert.deepStrictEqual(mismatchedReplayResponse.committedStatuses, []);

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
    const server = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
    const passport = fs.readFileSync(path.join(root, "backend/config/passport.js"), "utf8");
    const login = fs.readFileSync(path.join(root, "frontend/js/login.js"), "utf8");
    const loginHtml = fs.readFileSync(path.join(root, "frontend/login.html"), "utf8");
    assert.strictEqual((social.match(/router\.get\("\/auth\/google\/callback"/g) || []).length, 1);
    assert.strictEqual((server.match(/require\("\.\/routes\/socialAuth"\)/g) || []).length, 1, "the Google callback router must have one application mount");
    assert(social.includes('auth.authenticate("google", { session: false }, (error, user, info)'));
    assert(social.includes("handleAuthenticated(error, user, info).catch(propagateFailure)"), "async callback finalization errors must propagate through Express");
    assert(passport.includes("passReqToCallback: true"));
    assert(passport.includes("state: true"), "Google OAuth must retain server-side state validation");
    assert(passport.includes("issueUserSession") === false, "Passport strategy must not take over AZIEL session authority");
    assert(login.includes('["token_exchange_failed", "handoff_failed"].includes(oauthParams.get("error"))'));
    assert(login.includes("Google sign-in couldn't be completed. Please try again."));
    assert(loginHtml.includes('<button type="button" data-google-oauth-url="/api/auth/google" id="googleLoginBtn"'), "Google OAuth control must not have native anchor or submit navigation");
    assert(!loginHtml.includes('<a href="/api/auth/google"'), "Google OAuth must have only one frontend navigation owner");

    const launcherListeners = new Map();
    const launcherControl = {
        dataset: { googleOauthUrl: "/api/auth/google" },
        disabled: false,
        attributes: new Map(),
        addEventListener(type, listener) {
            const listeners = launcherListeners.get(type) || [];
            listeners.push(listener);
            launcherListeners.set(type, listeners);
        },
        setAttribute(name, value) { this.attributes.set(name, value); },
        removeAttribute(name) { this.attributes.delete(name); }
    };
    const launcherDocument = {
        addEventListener() {},
        getElementById(id) { return id === "googleLoginBtn" ? launcherControl : null; }
    };
    const launchedUrls = [];
    const launcherContext = vm.createContext({
        console,
        URL,
        URLSearchParams,
        document: launcherDocument,
        window: {
            AZIEL_LOCALE: null,
            location: { origin: "https://azielplay.com", assign(url) { launchedUrls.push(url); } }
        }
    });
    vm.runInContext(login, launcherContext, { filename: "frontend/js/login.js" });
    launcherContext.initGoogleOAuthLauncher(launcherDocument, launcherContext.window.location);
    launcherContext.initGoogleOAuthLauncher(launcherDocument, launcherContext.window.location);
    assert.strictEqual(launcherListeners.get("click").length, 1, "reinitialization must not bind the OAuth launcher twice");

    const event = () => ({ prevented: 0, stopped: 0, preventDefault() { this.prevented += 1; }, stopImmediatePropagation() { this.stopped += 1; } });
    const click = launcherListeners.get("click")[0];
    click(event());
    assert.deepStrictEqual(launchedUrls, ["/api/auth/google"], "one Google action must create exactly one navigation");
    click(event());
    click(event());
    assert.deepStrictEqual(launchedUrls, ["/api/auth/google"], "rapid repeated clicks must remain single-flight");
    assert.strictEqual(launcherListeners.has("submit"), false, "OAuth control must not bind a competing submit launch");
    for (const submit of launcherListeners.get("submit") || []) submit(event());
    assert.deepStrictEqual(launchedUrls, ["/api/auth/google"], "click plus submit must not create a second OAuth start");
    assert.strictEqual(launcherListeners.has("touchend"), false, "OAuth control must not bind a competing touch launch");
    assert.strictEqual(launcherListeners.has("pointerup"), false, "OAuth control must not bind a competing pointer launch");
    assert.strictEqual(launcherControl.disabled, true, "OAuth control must disable immediately after launch");

    const failedLauncherListeners = new Map();
    const failedLauncherControl = {
        dataset: { googleOauthUrl: "/api/auth/google" },
        disabled: false,
        attributes: new Map(),
        addEventListener(type, listener) { failedLauncherListeners.set(type, [listener]); },
        setAttribute(name, value) { this.attributes.set(name, value); },
        removeAttribute(name) { this.attributes.delete(name); }
    };
    launcherContext.initGoogleOAuthLauncher(
        { getElementById() { return failedLauncherControl; } },
        { assign() { throw new Error("navigation unavailable"); } }
    );
    failedLauncherListeners.get("click")[0](event());
    assert.strictEqual(failedLauncherControl.disabled, false, "synchronous navigation failure must unlock the OAuth control");
    assert.strictEqual(failedLauncherControl.attributes.has("aria-disabled"), false);
    assert.strictEqual(failedLauncherControl.attributes.has("aria-busy"), false);
    assert(!social.includes("handoff"), "Google OAuth must not contain a frontend token handoff");
    console.log("Google OAuth callback reliability verification passed (server-owned cookie session).");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
