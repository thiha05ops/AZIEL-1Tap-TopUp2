"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Readable } = require("stream");
const express = require("express");
const { decryptAesEcbPkcs7, verifyCallbackChecksum } = require("../services/dinger/dingerCryptoService");
const { TRANSACTION_STATUSES, parseDingerCallbackResult } = require("../services/dinger/dingerCallbackContract");
const { inspectDingerEnvironment } = require("../services/dinger/dingerConfiguration");
const { getProviderAdapter } = require("../services/paymentProviderAdapterRegistry");
const { createDingerDiagnosticCallbackRouter, CHECKSUM_INPUT, KEY_ENCODING, MODE } = require("../routes/dingerDiagnosticCallback");
const { PAGE_ROUTES } = require("../config/storefrontRouteContract");

function encrypt(plaintext, key) {
    const cipher = crypto.createCipheriv("aes-256-ecb", Buffer.from(key, "utf8"), null);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
}

async function withRouter(env, logger, callback) {
    const app = express();
    const router = createDingerDiagnosticCallbackRouter({ env, logger, limiter: (req, res, next) => next() });
    app.use("/api/webhooks/dinger", router);
    return callback(async ({ body = "", contentType = "application/json" } = {}) => {
        const req = Readable.from([Buffer.from(body, "utf8")]);
        Object.setPrototypeOf(req, express.request);
        req.method = "POST";
        req.url = "/api/webhooks/dinger/payment";
        req.originalUrl = req.url;
        req.headers = { "content-type": contentType, "content-length": String(Buffer.byteLength(body, "utf8")) };
        req.app = app;
        const res = new http.ServerResponse(req);
        Object.setPrototypeOf(res, express.response);
        res.req = req;
        res.app = app;
        req.res = res;
        return new Promise((resolve, reject) => {
            const chunks = [];
            res.write = chunk => { if (chunk) chunks.push(Buffer.from(chunk)); return true; };
            res.end = chunk => {
                if (chunk) chunks.push(Buffer.from(chunk));
                const text = Buffer.concat(chunks).toString("utf8");
                let parsed = null;
                try { parsed = text ? JSON.parse(text) : null; } catch {}
                resolve({ status: res.statusCode, json: async () => parsed });
                return res;
            };
            app.handle(req, res, reject);
        });
    });
}

(async () => {
    const callbackKey = "0123456789abcdef0123456789abcdef";
    const base = { totalAmount: 1000, createdAt: "20260916 120000", transactionStatus: "SUCCESS", methodName: "QR", merchantOrderId: "ORDER-1", transactionId: "TRX-1", customerName: "Test Customer", providerName: "KBZ Pay" };
    const plaintext = JSON.stringify(base);
    const ciphertext = encrypt(plaintext, callbackKey);
    const checksum = crypto.createHash("sha256").update(plaintext, "utf8").digest("hex");
    assert.strictEqual(decryptAesEcbPkcs7({ encryptedBase64: ciphertext, keyBytes: callbackKey }), plaintext);
    assert.throws(() => decryptAesEcbPkcs7({ encryptedBase64: "malformed", keyBytes: callbackKey }), error => error.code === "DINGER_CRYPTO_INVALID_BASE64");
    assert.throws(() => decryptAesEcbPkcs7({ encryptedBase64: ciphertext, keyBytes: "short" }), error => error.code === "DINGER_CRYPTO_INVALID_KEY");

    TRANSACTION_STATUSES.forEach(status => assert.strictEqual(parseDingerCallbackResult({ ...base, transactionStatus: status }).transactionStatus, status));
    assert.throws(() => parseDingerCallbackResult({ ...base, transactionStatus: "PENDING" }), error => error.code === "DINGER_CALLBACK_RESULT_INVALID");
    ["totalAmount", "createdAt", "merchantOrderId", "transactionId", "customerName", "providerName", "methodName"].forEach(field => {
        const fixture = { ...base };
        delete fixture[field];
        assert.throws(() => parseDingerCallbackResult(fixture), error => error.code === "DINGER_CALLBACK_RESULT_INVALID", field);
    });
    assert.throws(() => verifyCallbackChecksum({ exactJsonText: plaintext, checksum: "0".repeat(64) }), error => error.code === "DINGER_PROTOCOL_UNCONFIRMED");

    const silent = { info() {}, warn() {} };
    await withRouter({}, silent, async request => {
        const response = await request({ body: "{}" });
        assert.strictEqual(response.status, 503);
        assert.strictEqual((await response.json()).code, "DINGER_DIAGNOSTIC_CALLBACK_DISABLED");
    });
    await withRouter({ DINGER_PRODUCTION_TEST_CALLBACK_ENABLED: "true", DINGER_PRODUCTION_TEST_CALLBACK_MODE: MODE }, silent, async request => {
        const response = await request({ body: "{}" });
        assert.strictEqual(response.status, 503);
        assert.strictEqual((await response.json()).code, "DINGER_DIAGNOSTIC_CALLBACK_KEY_MISSING");
    });

    const enabledEnv = {
        DINGER_PRODUCTION_TEST_CALLBACK_ENABLED: "true",
        DINGER_PRODUCTION_TEST_CALLBACK_MODE: MODE,
        DINGER_PRODUCTION_TEST_CALLBACK_KEY: callbackKey,
        DINGER_PRODUCTION_TEST_CALLBACK_KEY_ENCODING: KEY_ENCODING,
        DINGER_PRODUCTION_TEST_CALLBACK_CHECKSUM_INPUT: CHECKSUM_INPUT
    };
    await withRouter(enabledEnv, silent, async request => {
        const unsupported = await request({ contentType: "text/plain", body: "ignored" });
        assert.strictEqual(unsupported.status, 415);
        const malformedJson = await request({ body: "{" });
        assert.strictEqual(malformedJson.status, 400);
        const tooLarge = await request({ body: JSON.stringify({ paymentResult: "A".repeat(17 * 1024), checksum: "0".repeat(64) }) });
        assert.strictEqual(tooLarge.status, 413);
        const malformedEnvelope = await request({ body: JSON.stringify({ paymentResult: "x", checksum: "0".repeat(64), unexpected: true }) });
        assert.strictEqual(malformedEnvelope.status, 400);
        const malformedCiphertext = await request({ body: JSON.stringify({ paymentResult: "not-base64", checksum: "0".repeat(64) }) });
        assert.strictEqual(malformedCiphertext.status, 400);
        const checksumMismatch = await request({ body: JSON.stringify({ paymentResult: ciphertext, checksum: "0".repeat(64) }) });
        assert.strictEqual(checksumMismatch.status, 400);
    });

    const logs = [];
    const logger = { info: (message, metadata) => logs.push({ message, metadata }), warn: (message, metadata) => logs.push({ message, metadata }) };
    await withRouter(enabledEnv, logger, async request => {
        const body = JSON.stringify({ paymentResult: ciphertext, checksum });
        const first = await request({ body });
        assert.strictEqual(first.status, 200);
        assert.deepStrictEqual(await first.json(), { received: true, verified: true, diagnosticOnly: true, duplicate: false, paymentStateChanged: false });
        const duplicate = await request({ body });
        assert.strictEqual(duplicate.status, 200);
        assert.strictEqual((await duplicate.json()).duplicate, true);
    });
    const logText = JSON.stringify(logs);
    [callbackKey, ciphertext, checksum, base.customerName, base.merchantOrderId, base.transactionId].forEach(secret => assert.strictEqual(logText.includes(secret), false, "diagnostic logs must not contain sensitive callback values"));

    const root = path.resolve(__dirname, "../..");
    const serverSource = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
    const routeSource = fs.readFileSync(path.join(root, "backend/routes/dingerDiagnosticCallback.js"), "utf8");
    assert(serverSource.includes('app.use("/api/webhooks/dinger", dingerCallbackRouter)'), "selected Dinger callback route must be mounted at the approved path");
    assert(serverSource.includes("createDingerDiagnosticCallbackRouter") && serverSource.includes("createDingerSettlementCallbackRouter"), "diagnostic must remain the default while settlement is explicit opt-in");
    assert(!/CommerceOrder|PaymentAttempt|paymentOrchestrator|wallet|fulfillment|supplier/i.test(routeSource), "diagnostic callback must remain isolated from financial and fulfillment services");
    const successPage = fs.readFileSync(path.join(root, "frontend/payments/dinger-success.html"), "utf8");
    const failPage = fs.readFileSync(path.join(root, "frontend/payments/dinger-fail.html"), "utf8");
    assert(PAGE_ROUTES.some(entry => entry.route === "/payments/dinger/success" && entry.file === "payments/dinger-success.html"));
    assert(PAGE_ROUTES.some(entry => entry.route === "/payments/dinger/fail" && entry.file === "payments/dinger-fail.html"));
    assert(successPage.includes("does not confirm that payment succeeded") && !/<script/i.test(successPage));
    assert(failPage.includes("does not change your payment or order status") && !/<script/i.test(failPage));
    assert.strictEqual(inspectDingerEnvironment({}).enabled, false, "Dinger must remain disabled by default");
    const descriptor = getProviderAdapter("dinger");
    assert.strictEqual(descriptor.customerAvailable, false);
    assert.strictEqual(descriptor.contractReadiness.callbackChecksumAuthentication, "CONFIRMED");
    assert.strictEqual(descriptor.contractReadiness.callbackRoute, "SETTLEMENT_EXPLICIT_OPT_IN_DIAGNOSTIC_DEFAULT");
    assert.strictEqual(descriptor.contractReadiness.customerExposure, "DISABLED");

    console.log("Dinger callback crypto, result contract, and disabled-exposure verification passed.");
})().catch(error => { console.error(error); process.exit(1); });
