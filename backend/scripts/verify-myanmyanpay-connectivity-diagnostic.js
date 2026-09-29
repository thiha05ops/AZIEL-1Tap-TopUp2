"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const { checkMyanMyanPaySandboxConnectivity, _test } = require("../services/myanmyanpay/myanMyanPayConnectivityService");
const { createMyanMyanPayConnectivityDiagnosticRouter } = require("../routes/myanMyanPayConnectivityDiagnostic");

function codedError(name, code, causeCode = "") {
    const error = new Error("sensitive message must-not-log");
    error.name = name;
    if (code) error.code = code;
    if (causeCode) error.cause = { code: causeCode, message: "nested sensitive message must-not-log" };
    return error;
}

function tlsStub(outcome = "success", code = "") {
    return () => {
        const socket = new EventEmitter();
        socket.authorized = outcome === "success";
        socket.getProtocol = () => "TLSv1.3";
        socket.destroy = () => {};
        socket.setTimeout = (ms, callback) => { if (outcome === "timeout") queueMicrotask(callback); };
        queueMicrotask(() => {
            if (outcome === "success") socket.emit("secureConnect");
            if (outcome === "error") socket.emit("error", codedError("Error", code));
        });
        return socket;
    };
}

function httpsStub(outcome = "success", code = "", status = 204) {
    return (url, options, callback) => {
        assert.strictEqual(url, "https://sandbox.myanmyanpay.com/");
        assert.deepStrictEqual({ method: options.method, servername: options.servername, rejectUnauthorized: options.rejectUnauthorized }, { method: "HEAD", servername: "sandbox.myanmyanpay.com", rejectUnauthorized: true });
        const request = new EventEmitter();
        request.destroy = () => {};
        request.setTimeout = (ms, handler) => { if (outcome === "timeout") queueMicrotask(handler); };
        request.end = () => queueMicrotask(() => {
            if (outcome === "success") callback({ statusCode: status, resume() {} });
            if (outcome === "error") request.emit("error", codedError("Error", code));
        });
        return request;
    };
}

function fetchStub(outcome = "success", code = "", status = 200) {
    return async (url, options) => {
        assert.strictEqual(url, "https://sandbox.myanmyanpay.com/");
        assert.strictEqual(options.method, "HEAD");
        assert.strictEqual(options.redirect, "manual");
        if (outcome === "success") return { status, body: "must-not-return", headers: { authorization: "must-not-return" } };
        if (outcome === "nested") throw codedError("TypeError", "", code);
        throw codedError(outcome === "abort" ? "AbortError" : "TypeError", code);
    };
}

function baseOptions(overrides = {}) {
    return {
        timeoutMs: 250,
        dnsLookup: async (host, options) => {
            assert.strictEqual(host, "sandbox.myanmyanpay.com");
            assert.deepStrictEqual(options, { all: true, verbatim: true });
            return [{ address: "203.0.113.10", family: 4 }, { address: "203.0.113.11", family: 4 }];
        },
        tlsConnect: tlsStub(),
        httpsRequest: httpsStub(),
        fetchImpl: fetchStub(),
        ...overrides
    };
}

function assertSafeShape(result) {
    assert.deepStrictEqual(Object.keys(result), ["success", "target", "dns", "tls", "https", "fetch"]);
    assert.deepStrictEqual(Object.keys(result.dns), ["ok", "family", "addressCount", "errorClass", "errorCode"]);
    assert.deepStrictEqual(Object.keys(result.tls), ["ok", "authorized", "protocol", "errorClass", "errorCode"]);
    assert.deepStrictEqual(Object.keys(result.https), ["ok", "httpStatus", "responseReceived", "errorClass", "errorCode"]);
    assert.deepStrictEqual(Object.keys(result.fetch), ["ok", "httpStatus", "responseReceived", "errorClass", "errorCode"]);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["203.0.113.10", "203.0.113.11", "must-not-log", "must-not-return", "authorization", "publishable", "secret", "btoken", "nonce", "signature"]) assert(!serialized.toLowerCase().includes(forbidden.toLowerCase()));
}

(async () => {
    const success = await checkMyanMyanPaySandboxConnectivity(baseOptions());
    assert.strictEqual(success.target, "MYANMYANPAY_SANDBOX");
    assert.deepStrictEqual(success.dns, { ok: true, family: 4, addressCount: 2, errorClass: "", errorCode: "" });
    assert.deepStrictEqual(success.tls, { ok: true, authorized: true, protocol: "TLSv1.3", errorClass: "", errorCode: "" });
    assert.deepStrictEqual(success.https, { ok: true, httpStatus: 204, responseReceived: true, errorClass: "", errorCode: "" });
    assert.deepStrictEqual(success.fetch, { ok: true, httpStatus: 200, responseReceived: true, errorClass: "", errorCode: "" });
    assertSafeShape(success);

    for (const code of ["ENOTFOUND", "EAI_AGAIN"]) {
        const result = await checkMyanMyanPaySandboxConnectivity(baseOptions({ dnsLookup: async () => { throw codedError("Error", code); } }));
        assert.strictEqual(result.dns.ok, false);
        assert.strictEqual(result.dns.errorCode, code);
    }
    for (const code of ["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "ERR_TLS_CERT_ALTNAME_INVALID", "ECONNREFUSED", "ECONNRESET"]) {
        const result = await checkMyanMyanPaySandboxConnectivity(baseOptions({ tlsConnect: tlsStub("error", code) }));
        assert.strictEqual(result.tls.ok, false);
        assert.strictEqual(result.tls.errorCode, code);
    }
    const tlsTimeout = await checkMyanMyanPaySandboxConnectivity(baseOptions({ tlsConnect: tlsStub("timeout") }));
    assert.strictEqual(tlsTimeout.tls.errorCode, "ETIMEDOUT");
    const httpsFailure = await checkMyanMyanPaySandboxConnectivity(baseOptions({ httpsRequest: httpsStub("error", "ECONNRESET") }));
    assert.deepStrictEqual(httpsFailure.https, { ok: false, httpStatus: 0, responseReceived: false, errorClass: "ERROR", errorCode: "ECONNRESET" });
    const httpsTimeout = await checkMyanMyanPaySandboxConnectivity(baseOptions({ httpsRequest: httpsStub("timeout") }));
    assert.strictEqual(httpsTimeout.https.errorCode, "ETIMEDOUT");
    const nestedFetch = await checkMyanMyanPaySandboxConnectivity(baseOptions({ fetchImpl: fetchStub("nested", "UND_ERR_CONNECT_TIMEOUT") }));
    assert.strictEqual(nestedFetch.fetch.errorClass, "TYPE_ERROR");
    assert.strictEqual(nestedFetch.fetch.errorCode, "UND_ERR_CONNECT_TIMEOUT");
    const fetchTimeout = await checkMyanMyanPaySandboxConnectivity(baseOptions({ fetchImpl: async (url, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(codedError("AbortError", "")), { once: true })) }));
    assert.strictEqual(fetchTimeout.fetch.errorClass, "ABORT_ERROR");
    assert.strictEqual(fetchTimeout.fetch.errorCode, "ETIMEDOUT");
    const arbitrary = await checkMyanMyanPaySandboxConnectivity(baseOptions({ fetchImpl: async () => { throw codedError("PrivateCustomError", "PRIVATE_SECRET_CODE"); } }));
    assert.strictEqual(arbitrary.fetch.errorClass, "UNKNOWN_ERROR");
    assert.strictEqual(arbitrary.fetch.errorCode, "");
    assertSafeShape(arbitrary);

    let connectivityCalls = 0;
    const audits = [];
    const router = createMyanMyanPayConnectivityDiagnosticRouter({ limiter: (req, res, next) => next(), connectivityCheck: async () => { connectivityCalls += 1; return success; }, auditWriter: async event => { audits.push(event); } });
    const routeLayer = router.stack.find(layer => layer.route?.path === "/admin/payment-providers/myanmyanpay/sandbox-connectivity-check");
    assert(routeLayer, "temporary Admin connectivity route must be registered");
    const handler = routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
    function responseCapture() { return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } }; }
    const rejectedResponse = responseCapture();
    await handler({ body: { confirmation: "CHECK_MYANMYANPAY_SANDBOX_CONNECTIVITY", url: "https://attacker.test" }, admin: { id: "admin-1" }, method: "POST", originalUrl: "/api/test", headers: {} }, rejectedResponse);
    assert.strictEqual(rejectedResponse.statusCode, 400);
    assert.strictEqual(connectivityCalls, 0, "extra fields/arbitrary URLs must be rejected before any connectivity check");
    const acceptedResponse = responseCapture();
    await handler({ body: { confirmation: "CHECK_MYANMYANPAY_SANDBOX_CONNECTIVITY" }, admin: { id: "admin-1" }, method: "POST", originalUrl: "/api/test", headers: {} }, acceptedResponse);
    assert.strictEqual(acceptedResponse.statusCode, 200);
    assert.strictEqual(connectivityCalls, 1);
    assert.deepStrictEqual(acceptedResponse.payload, success);
    assert.strictEqual(audits.length, 2);

    const root = path.resolve(__dirname, "../..");
    const routeSource = fs.readFileSync(path.join(root, "backend/routes/myanMyanPayConnectivityDiagnostic.js"), "utf8");
    assert(routeSource.includes("adminMiddleware"), "connectivity endpoint must require Admin authentication");
    assert(routeSource.includes("requireAdminPermission(PERMISSIONS.PAYMENT_METHODS_MANAGE)"), "connectivity endpoint must require payment-management permission");
    assert(routeSource.includes("rateLimit"), "connectivity endpoint must be rate limited");
    assert(!routeSource.includes("req.body.url") && !routeSource.includes("req.body.host"), "route must never accept a caller-supplied target");
    assert.strictEqual(_test.HOST, "sandbox.myanmyanpay.com");
    assert.strictEqual(_test.ORIGIN, "https://sandbox.myanmyanpay.com");
    console.log("MyanMyanPay Sandbox connectivity diagnostic verification passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
