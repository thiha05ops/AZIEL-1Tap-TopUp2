"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { productionProbeConfiguration, classifyPayResponse, failureClassification, reportError, runProductionProbe, PAY_CONFIRMATION } = require("./probe-dinger-production");
const { inspectDingerEnvironment, loadDingerConfiguration } = require("../services/dinger/dingerConfiguration");

const baseEnv = Object.freeze({
    DINGER_PRODUCTION_TEST_TOKEN_URL: "https://confirmed.example.test/exact/token",
    DINGER_PRODUCTION_TEST_PROJECT_NAME: "test-project",
    DINGER_PRODUCTION_TEST_API_KEY: "test-api-key",
    DINGER_PRODUCTION_TEST_MERCHANT_NAME: "test-merchant"
});

(async () => {
    const tokenOnly = productionProbeConfiguration(baseEnv);
    assert.strictEqual(tokenOnly.mode, "TOKEN_ONLY");
    assert.strictEqual(tokenOnly.configuration.tokenUrl, "https://confirmed.example.test/exact/token");
    assert.strictEqual(tokenOnly.configuration.payUrl, undefined);
    assert.throws(() => productionProbeConfiguration({ ...baseEnv, DINGER_PRODUCTION_TEST_TOKEN_URL: "http://unsafe.test/token" }), error => error.code === "DINGER_PRODUCTION_ENDPOINT_UNCONFIRMED");
    assert.throws(() => productionProbeConfiguration({ ...baseEnv, DINGER_PRODUCTION_TEST_ALLOW_PAY: "true" }), error => error.code === "DINGER_PRODUCTION_REAL_MONEY_CONFIRMATION_REQUIRED");

    const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 1024, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const payEnv = {
        ...baseEnv,
        DINGER_PRODUCTION_TEST_ALLOW_PAY: "true",
        DINGER_PRODUCTION_TEST_REAL_MONEY_CONFIRMATION: PAY_CONFIRMATION,
        DINGER_PRODUCTION_TEST_PAY_URL: "https://confirmed.example.test/exact/pay",
        DINGER_PRODUCTION_TEST_PUBLIC_KEY: publicKey,
        DINGER_PRODUCTION_TEST_AMOUNT: "500",
        DINGER_PRODUCTION_TEST_ORDER_ID: "DINGERTEST-PHASE1",
        DINGER_PRODUCTION_TEST_CUSTOMER_PHONE: "0912345678",
        DINGER_PRODUCTION_TEST_CUSTOMER_NAME: "Controlled Test"
    };
    assert.strictEqual(productionProbeConfiguration(payEnv).mode, "PAY");
    for (const amount of [499, 10001, 500.5]) {
        assert.throws(() => productionProbeConfiguration({ ...payEnv, DINGER_PRODUCTION_TEST_AMOUNT: String(amount) }), error => error.code === "DINGER_PRODUCTION_AMOUNT_INVALID");
    }
    assert.throws(() => productionProbeConfiguration({ ...payEnv, DINGER_PRODUCTION_TEST_ORDER_ID: "PUBLIC-ORDER" }), error => error.code === "DINGER_PRODUCTION_ORDER_ID_INVALID");

    const documented = classifyPayResponse({ totalAmount: 500, createdAt: "20260923 140635", transactionStatus: "SUCCESS", methodName: "QR", merchantOrderId: "DINGERTEST-PHASE1", transactionId: "REDACTED", customerName: "Controlled Test", providerName: "AYA Pay" }, { httpStatus: 200, bodyNonempty: true, jsonParsed: true });
    assert.strictEqual(documented.classification, "DOCUMENTED_PAY_RESPONSE");
    assert.strictEqual(documented.paymentStatus, "UNCONFIRMED", "documented Pay response must not mark payment successful");
    assert.strictEqual(documented.qrCreationStatus, "UNCONFIRMED", "generic documented response does not prove QR creation");

    const unknown = classifyPayResponse({ code: "000", message: "PRIVATE MESSAGE", response: { transactionNum: "PRIVATE-TRANSACTION", qrCode: "PRIVATE-QR", sign: "PRIVATE-SIGNATURE", paymentToken: "PRIVATE-TOKEN", customerName: "PRIVATE-NAME", amount: 500 } }, { httpStatus: 200, bodyNonempty: true, jsonParsed: true });
    assert.strictEqual(unknown.classification, "UNKNOWN_HTTP_SUCCESS");
    assert.deepStrictEqual(unknown.topLevel.fields.map(field => field.name), ["code", "response"]);
    assert.deepStrictEqual(unknown.nested[0].fields.map(field => field.name), ["amount", "transactionNum"]);
    const unknownOutput = JSON.stringify(unknown);
    ["PRIVATE MESSAGE", "PRIVATE-TRANSACTION", "PRIVATE-QR", "PRIVATE-SIGNATURE", "PRIVATE-TOKEN", "PRIVATE-NAME", "qrCode", "sign", "paymentToken", "customerName", "message"].forEach(secret => assert.strictEqual(unknownOutput.includes(secret), false));

    const calls = [];
    const logs = [];
    await runProductionProbe({
        env: baseEnv,
        logger: { log: value => logs.push(value), error: value => logs.push(value) },
        fetchImpl: async (url, init) => {
            calls.push({ url: String(url), init });
            return { ok: true, status: 200, text: async () => '{"code":"000","message":"Authentication Success","time":"20991231 230000","response":{"paymentToken":"TOP-SECRET-TOKEN","expireIn":"20991231 235959"}}' };
        }
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url.startsWith("https://confirmed.example.test/exact/token?"), true);
    assert.strictEqual(logs.join("\n").includes("TOP-SECRET-TOKEN"), false);
    assert.strictEqual(logs.join("\n").includes("test-api-key"), false);

    async function diagnoseTokenBody(body) {
        let failure;
        try {
            await runProductionProbe({
                env: baseEnv,
                logger: { log() {}, error() {} },
                fetchImpl: async () => ({ ok: true, status: 200, text: async () => body })
            });
        } catch (error) { failure = error; }
        assert(failure, "fixture must fail token validation");
        const diagnosticOutput = [];
        reportError(failure, { error: value => diagnosticOutput.push(String(value)) });
        return { failure, output: diagnosticOutput.join("\n") };
    }

    const missingToken = await diagnoseTokenBody('{"code":"000","message":"SECRET diagnostic detail","response":{"expireIn":"20991231 235959"}}');
    assert.strictEqual(missingToken.failure.code, "DINGER_TOKEN_RESPONSE_INVALID");
    assert.strictEqual(missingToken.failure.failureCategory, "TOKEN_FIELD_MISSING");
    assert.deepStrictEqual(missingToken.failure.safeDiagnostics, { httpStatus: 200, bodyNonempty: true, jsonParsed: true, providerCode: "000", codePresent: true, messagePresent: true, responsePresent: true, paymentTokenPresent: false, expireInPresent: true });

    const alternateNesting = await diagnoseTokenBody('{"code":"000","data":{"paymentToken":"SECRET-ALTERNATE-TOKEN","expireIn":"20991231 235959"}}');
    assert.strictEqual(alternateNesting.failure.failureCategory, "TOKEN_FIELD_MISSING");
    assert.strictEqual(alternateNesting.failure.safeDiagnostics.responsePresent, false);

    const empty = await diagnoseTokenBody("");
    assert.strictEqual(empty.failure.failureCategory, "EMPTY_RESPONSE");
    assert.strictEqual(empty.failure.safeDiagnostics.bodyNonempty, false);
    assert.strictEqual(empty.failure.safeDiagnostics.jsonParsed, false);

    const invalidJson = await diagnoseTokenBody("SECRET invalid non-JSON body");
    assert.strictEqual(invalidJson.failure.failureCategory, "NON_JSON_RESPONSE");
    assert.strictEqual(invalidJson.failure.safeDiagnostics.bodyNonempty, true);
    assert.strictEqual(invalidJson.failure.safeDiagnostics.jsonParsed, false);

    const rejected = await diagnoseTokenBody('{"code":"AUTH-001","message":"SECRET authentication explanation"}');
    assert.strictEqual(rejected.failure.code, "DINGER_TOKEN_REJECTED");
    assert.strictEqual(rejected.failure.failureCategory, "PROVIDER_REJECTED");
    assert.strictEqual(rejected.failure.safeDiagnostics.providerCode, "AUTH-001");

    const diagnosticOutput = [missingToken.output, alternateNesting.output, empty.output, invalidJson.output, rejected.output].join("\n");
    ["SECRET diagnostic detail", "SECRET-ALTERNATE-TOKEN", "SECRET invalid non-JSON body", "SECRET authentication explanation", "test-api-key", "exact/token"].forEach(secret => {
        assert.strictEqual(diagnosticOutput.includes(secret), false, `diagnostics must redact ${secret}`);
    });
    assert(diagnosticOutput.includes("httpStatus: 200"));
    assert(diagnosticOutput.includes("paymentTokenPresent: false"));

    const invalidExpiry = await diagnoseTokenBody('{"code":"000","response":{"paymentToken":"SECRET-TOKEN","expireIn":"not-a-date"}}');
    assert.strictEqual(invalidExpiry.failure.code, "DINGER_RESPONSE_INVALID");
    assert.strictEqual(invalidExpiry.failure.failureCategory, "EXPIRY_INVALID");
    assert.strictEqual(invalidExpiry.output.includes("SECRET-TOKEN"), false);

    let uncertainCalls = 0;
    await assert.rejects(() => runProductionProbe({
        env: payEnv,
        logger: { log() {}, error() {} },
        fetchImpl: async () => {
            uncertainCalls += 1;
            if (uncertainCalls === 1) return { ok: true, status: 200, text: async () => '{"code":"000","response":{"paymentToken":"REDACT-ME","expireIn":"20991231 235959"}}' };
            throw new Error("simulated uncertain Pay submission");
        }
    }), error => error.code === "DINGER_NETWORK_ERROR" && error.submissionUncertain === true);
    assert.strictEqual(uncertainCalls, 2, "one token call and one Pay call are allowed; uncertain Pay submissions must not be retried");

    let rejectedCalls = 0;
    let rejectedError;
    try {
        await runProductionProbe({
            env: payEnv,
            logger: { log() {}, error() {} },
            fetchImpl: async () => {
                rejectedCalls += 1;
                if (rejectedCalls === 1) return { ok: true, status: 200, text: async () => '{"code":"000","response":{"paymentToken":"REDACTED","expireIn":"20991231 235959"}}' };
                return { ok: false, status: 422, text: async () => '{"code":"REJECTED","message":"PRIVATE REJECTION"}' };
            }
        });
    } catch (error) { rejectedError = error; }
    assert(rejectedError);
    assert.strictEqual(failureClassification(rejectedError), "HTTP_REJECTION");
    assert.strictEqual(rejectedCalls, 2, "HTTP rejection must not be retried");
    const rejectedOutput = [];
    reportError(rejectedError, { error: value => rejectedOutput.push(String(value)) });
    assert(rejectedOutput.join("\n").includes("responseClassification: HTTP_REJECTION"));
    assert.strictEqual(rejectedOutput.join("\n").includes("PRIVATE REJECTION"), false);

    let timeoutCalls = 0;
    let timeoutError;
    try {
        await runProductionProbe({
            env: payEnv,
            logger: { log() {}, error() {} },
            fetchImpl: async (_url, init) => {
                timeoutCalls += 1;
                if (timeoutCalls === 1) return { ok: true, status: 200, text: async () => '{"code":"000","response":{"paymentToken":"REDACTED","expireIn":"20991231 235959"}}' };
                return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" }))));
            }
        });
    } catch (error) { timeoutError = error; }
    assert(timeoutError);
    assert.strictEqual(failureClassification(timeoutError), "SUBMISSION_UNCERTAIN");
    assert.strictEqual(timeoutCalls, 2, "timed-out Pay submission must not be retried");

    const legacyOnly = { DINGER_ENABLED: "true", DINGER_PROJECT_NAME: "legacy", DINGER_API_KEY: "legacy", DINGER_MERCHANT_NAME: "legacy" };
    assert.strictEqual(inspectDingerEnvironment(legacyOnly).configured, false, "unscoped legacy credentials must not cross environment boundaries");
    const separated = {
        DINGER_ENVIRONMENT: "LIVE", DINGER_ENABLED: "false", DINGER_LIVE_BASE_URL: "https://live.example.test",
        DINGER_LIVE_PROJECT_NAME: "live-project", DINGER_LIVE_API_KEY: "live-key", DINGER_LIVE_MERCHANT_NAME: "live-merchant",
        DINGER_LIVE_PUBLIC_KEY: publicKey, DINGER_LIVE_CALLBACK_KEY: "0123456789abcdef", DINGER_LIVE_CALLBACK_URL: "https://merchant.example.test/callback"
    };
    assert.strictEqual(inspectDingerEnvironment(separated).configured, true);
    assert.strictEqual(loadDingerConfiguration(separated).projectName, "live-project");

    const source = fs.readFileSync(path.join(__dirname, "probe-dinger-production.js"), "utf8");
    assert(!/CommerceOrder|PaymentAttempt|paidFulfillmentRoutingService|fulfillmentService/.test(source), "production probe must remain detached from AZIEL orders and fulfillment");
    assert(!/createDingerAdapter|paymentOrchestrator|providerRegistry/.test(source), "production probe must not enter public payment orchestration");
    assert(source.includes('providerName: "AYA Pay"') && source.includes('methodName: "QR"'), "Phase 1 Pay allowlist must remain AYA Pay QR only");

    console.log("Dinger controlled production probe safety verification passed.");
})().catch(error => { console.error(error); process.exit(1); });
