"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createGoogleAuthHandoffService, hashCode } = require("../services/googleAuthHandoffService");
const { createSocialAuthRouter } = require("../routes/socialAuth");

const root = path.resolve(__dirname, "../..");
const ENV = { GOOGLE_CLIENT_ID: "configured", GOOGLE_CLIENT_SECRET: "configured", FRONTEND_URL: "https://azielplay.com" };

function response() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        status(value) { this.statusCode = value; return this; },
        type(value) { this.contentType = value; return this; },
        send(value) { this.body = value; return value; },
        json(value) { this.body = value; return value; },
        redirect(statusOrUrl, maybeUrl) { this.redirectUrl = maybeUrl || statusOrUrl; return this.redirectUrl; }
    };
}

async function runRoute(router, method, routePath, req, res) {
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods[method]);
    assert(layer, `missing ${method.toUpperCase()} ${routePath}`);
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

function transitionDestination(res) {
    const match = String(res.body || "").match(/window\.location\.replace\(("(?:[^"\\]|\\.)*")\)/);
    return match ? JSON.parse(match[1]) : "";
}

function inMemoryHandoffModel() {
    const rows = [];
    return {
        rows,
        async create(value) { rows.push({ ...value, consumedAt: null }); return value; },
        findOneAndUpdate(filter, update) {
            const row = rows.find(item =>
                item.codeHash === filter.codeHash &&
                item.consumedAt === null &&
                item.expiresAt > filter.expiresAt.$gt
            );
            if (row) Object.assign(row, update.$set);
            return { lean: async () => row ? { ...row } : null };
        }
    };
}

async function verifySuccessRuntime(handoffResponse) {
    const source = fs.readFileSync(path.join(root, "frontend/js/google-auth-success.js"), "utf8");
    const storage = new Map([["redirectAfterLogin", "https://azielplay.com/account"]]);
    const navigations = [];
    const history = [];
    let fetchCalls = 0;
    const context = {
        URLSearchParams,
        URL,
        JSON,
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key)
        },
        fetch: async (url, options) => {
            fetchCalls += 1;
            assert.strictEqual(url, "/api/auth/google/handoff");
            assert.strictEqual(options.method, "POST");
            assert.deepStrictEqual(JSON.parse(options.body), { handoff: "ONE_TIME_CODE" });
            return { ok: handoffResponse.success, json: async () => handoffResponse };
        },
        window: {
            location: {
                search: "?handoff=ONE_TIME_CODE",
                origin: "https://azielplay.com",
                replace: url => navigations.push(url)
            },
            history: { replaceState: (_state, _title, url) => history.push(url) }
        }
    };
    vm.runInNewContext(source, context, { filename: "google-auth-success.js" });
    await new Promise(resolve => setImmediate(resolve));
    return { storage, navigations, history, fetchCalls };
}

(async () => {
    const Handoff = inMemoryHandoffModel();
    const now = new Date("2026-09-21T00:00:00.000Z");
    const handoffs = createGoogleAuthHandoffService({
        Handoff,
        clock: () => new Date(now),
        randomBytes: () => Buffer.alloc(32, 7)
    });
    const issued = { token: "JWT_SECRET", user: { username: "google-user", role: "user" } };
    const code = await handoffs.create(issued);
    assert.notStrictEqual(code, issued.token);
    assert.strictEqual(Handoff.rows[0].codeHash, hashCode(code));
    assert(!JSON.stringify(Handoff.rows[0]).includes(code), "raw handoff code must not be persisted");
    assert.deepStrictEqual(await handoffs.consume(code), issued);
    assert.strictEqual(await handoffs.consume(code), null, "handoff code must be single-use");
    assert.strictEqual(await handoffs.consume("wrong"), null, "unknown code must not authenticate");

    let starts = 0;
    const startPassport = {
        authenticate(_name, options) {
            assert.strictEqual(options.state, true);
            return (_req, res) => { starts += 1; return res.redirect(302, "https://accounts.google.com/o/oauth2/v2/auth?state=SERVER_STATE"); };
        }
    };
    const startRouter = createSocialAuthRouter({ passport: startPassport, env: ENV, logger: { info() {}, warn() {}, log() {} }, handoffService: handoffs });
    const startRes = response();
    await runRoute(startRouter, "get", "/auth/google", { headers: { host: "azielplay.com" }, protocol: "https", socket: {} }, startRes);
    assert.strictEqual(starts, 1, "one click must initiate Google OAuth exactly once");
    assert.strictEqual(startRes.statusCode, 200, "OAuth start must be a non-redirect response safe through old workers");
    assert(transitionDestination(startRes).startsWith("https://accounts.google.com/"));
    assert.strictEqual(startRes.headers["cache-control"], "no-store");

    let exchangeCount = 0;
    const exchangeRouter = createSocialAuthRouter({
        passport: startPassport,
        env: ENV,
        logger: { info() {}, warn() {}, log() {} },
        handoffService: {
            create: async () => "unused",
            consume: async value => {
                exchangeCount += 1;
                return value === "ONE_TIME_CODE" && exchangeCount === 1 ? issued : null;
            }
        }
    });
    const exchangeRes = response();
    await runRoute(exchangeRouter, "post", "/auth/google/handoff", { body: { handoff: "ONE_TIME_CODE" } }, exchangeRes);
    assert.deepStrictEqual(exchangeRes.body, { success: true, token: issued.token, user: issued.user });
    assert.strictEqual(exchangeRes.headers["cache-control"], "no-store");
    const replayRes = response();
    await runRoute(exchangeRouter, "post", "/auth/google/handoff", { body: { handoff: "ONE_TIME_CODE" } }, replayRes);
    assert.strictEqual(replayRes.statusCode, 410);
    assert.strictEqual(replayRes.body.code, "GOOGLE_HANDOFF_INVALID");

    const runtime = await verifySuccessRuntime({ success: true, token: "JWT_FROM_HANDOFF", user: issued.user });
    assert.strictEqual(runtime.fetchCalls, 1, "success page must exchange the handoff once");
    assert.deepStrictEqual(runtime.history, ["/auth/google/success"], "handoff must be removed from history before exchange");
    assert.strictEqual(runtime.storage.get("token"), "JWT_FROM_HANDOFF");
    assert.deepStrictEqual(runtime.navigations, ["/account"], "first attempt must finish at the authenticated destination");

    const replay = await verifySuccessRuntime({ success: false, code: "GOOGLE_HANDOFF_INVALID" });
    assert.strictEqual(replay.storage.get("token"), undefined);
    assert.deepStrictEqual(replay.navigations, ["/login?oauth=google&error=handoff_failed"]);

    const sw = fs.readFileSync(path.join(root, "frontend/sw.js"), "utf8");
    const localAuth = fs.readFileSync(path.join(root, "backend/routes/auth.js"), "utf8");
    const logout = fs.readFileSync(path.join(root, "frontend/js/logout.js"), "utf8");
    const loginHtml = fs.readFileSync(path.join(root, "frontend/login.html"), "utf8");
    const registerHtml = fs.readFileSync(path.join(root, "frontend/register.html"), "utf8");
    const loginJs = fs.readFileSync(path.join(root, "frontend/js/login.js"), "utf8");
    const pwaFix = fs.readFileSync(path.join(root, "frontend/js/pwa-fix.js"), "utf8");
    assert.strictEqual((loginHtml.match(/href="\/api\/auth\/google"/g) || []).length, 1, "login must expose one native Google OAuth start");
    assert.strictEqual((registerHtml.match(/href="\/api\/auth\/google"/g) || []).length, 1, "register must expose one native Google OAuth start");
    assert(!loginJs.includes("googleLoginBtn") && !loginJs.includes('apiUrl("/api/auth/google")'), "login.js must not intercept native Google OAuth navigation");
    assert(!loginHtml.includes("data-aziel-google-oauth") && !registerHtml.includes("data-aziel-google-oauth") && !pwaFix.includes("data-aziel-google-oauth"), "obsolete OAuth convergence gate must remain absent");
    assert.strictEqual(starts, 1, "one native anchor navigation must map to one OAuth start request");
    assert(sw.includes('if (request.mode === "navigate" && isOAuthNavigationPath(url.pathname)) return;'));
    assert(!pwaFix.includes("CHECK_WORKER_CAPABILITY"));
    assert(!fs.readFileSync(path.join(root, "frontend/google-success.html"), "utf8").includes("token"));
    assert(localAuth.includes('router.post("/login"') && localAuth.includes("issueUserSession(user, req"), "password login session issuance must remain intact");
    assert(logout.includes('localStorage.removeItem("token")') && logout.includes('sessionStorage.removeItem("token")'), "customer logout must still clear both token stores");

    console.log("Google authentication end-to-end verification passed.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
