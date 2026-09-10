"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const { createTmwPaymentController } = require("../controllers/tmwPaymentController");
const { createTmwWebhookRoutes } = require("../routes/tmwPaymentRoutes");
const { TmwWebhookError, verifyTmwWebhookSignature } = require("../services/commerce/tmwPaymentWebhookService");

const apiKey = "ingress-test-key";
const exactData = '{ "id_pay": "1000000", "ref1": "test-id-14809", "amount_check": "1001", "amount": "10.00", "date_pay": "2026-09-10 21:10", "timestamp": 1789049407 }';
const signature = crypto.createHash("md5").update(`${exactData}:${apiKey}`).digest("hex");

function request(server, { body, contentType }) {
    const address = server.address();
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: "127.0.0.1", port: address.port, path: "/api/payment/tmw/webhook", method: "POST", headers: { "content-type": contentType, "content-length": Buffer.byteLength(body) } }, response => {
            let responseBody = "";
            response.setEncoding("utf8");
            response.on("data", chunk => { responseBody += chunk; });
            response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(responseBody) }));
        });
        req.on("error", reject);
        req.end(body);
    });
}

async function main() {
    const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    const webhookMount = 'app.use("/api", require("./routes/tmwPaymentRoutes").createTmwWebhookRoutes());';
    assert(serverSource.indexOf(webhookMount) > -1, "server must mount the route-owned TMW webhook ingress");
    assert(serverSource.indexOf(webhookMount) < serverSource.indexOf("app.use(express.json"), "TMW webhook ingress must run before content-type-selective global parsers");
    assert(serverSource.indexOf('app.use("/api", require("./routes/tmwPaymentRoutes")());') > serverSource.indexOf("app.use(createSessionMiddleware"), "authenticated TMW checkout routes must retain session middleware ordering");
    const received = [];
    const webhookService = {
        async processWebhook(input) {
            if (typeof input.data !== "string" || typeof input.signature !== "string") throw new TmwWebhookError("TMW_WEBHOOK_ENVELOPE_INVALID", "invalid", 400);
            received.push(input);
            assert.strictEqual(input.data, exactData, "ingress must preserve the exact signed data string");
            assert(verifyTmwWebhookSignature(input.data, input.signature, apiKey), "signature must verify against the untouched data string");
        }
    };
    const controller = createTmwPaymentController({ application: {}, webhookService });
    const app = express();
    app.use("/api", createTmwWebhookRoutes({ controller }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));

    try {
        const form = new URLSearchParams({ data: exactData, signature }).toString();
        assert.deepStrictEqual(await request(server, { body: form, contentType: "application/x-www-form-urlencoded" }), { status: 200, body: { status: 1 } });
        assert.deepStrictEqual(await request(server, { body: JSON.stringify({ data: exactData, signature }), contentType: "application/json" }), { status: 200, body: { status: 1 } });
        assert.deepStrictEqual(await request(server, { body: new URLSearchParams({ signature }).toString(), contentType: "application/x-www-form-urlencoded" }), { status: 400, body: { status: 0 } });
        assert.deepStrictEqual(await request(server, { body: new URLSearchParams({ data: exactData }).toString(), contentType: "application/x-www-form-urlencoded" }), { status: 400, body: { status: 0 } });
        assert.deepStrictEqual(await request(server, { body: `data=${encodeURIComponent(exactData)}&data=duplicate&signature=${signature}`, contentType: "application/x-www-form-urlencoded" }), { status: 400, body: { status: 0 } });
        assert.deepStrictEqual(await request(server, { body: form, contentType: "text/plain" }), { status: 200, body: { status: 1 } }, "provider form fields remain accepted when content type is nonstandard");
        const boundary = "aziel-tmw-ingress-boundary";
        const multipart = `--${boundary}\r\nContent-Disposition: form-data; name="data"\r\n\r\n${exactData}\r\n--${boundary}\r\nContent-Disposition: form-data; name="signature"\r\n\r\n${signature}\r\n--${boundary}--\r\n`;
        assert.deepStrictEqual(await request(server, { body: multipart, contentType: `multipart/form-data; boundary=${boundary}` }), { status: 200, body: { status: 1 } }, "field-only multipart provider posts are accepted without files");
        assert.strictEqual(received.length, 4);
        assert(received.every(input => input.data === exactData && input.signature === signature));
    } finally {
        await new Promise(resolve => server.close(resolve));
    }

    console.log("TMW webhook HTTP ingress verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
