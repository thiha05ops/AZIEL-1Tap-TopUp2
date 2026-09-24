"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
    dingerAccessDecision,
    dingerTechnicalReadiness
} = require("../services/dinger/dingerPaymentPolicy");
const { inspectDingerEnvironment } = require("../services/dinger/dingerConfiguration");
const { normalizeDingerPayResponse, DINGER_METHOD_CONTRACTS } = require("../services/commerce/providers/dingerAdapter");
const { registerDingerPaymentMethods } = require("./register-dinger-payment-methods");

function envFor(publicKey, overrides = {}) {
    return {
        DINGER_ENVIRONMENT: "LIVE", DINGER_ENABLED: "true",
        DINGER_LIVE_BASE_URL: "https://api.dinger.asia",
        DINGER_LIVE_TOKEN_URL: "https://api.dinger.asia/api/token",
        DINGER_LIVE_PAY_URL: "https://api.dinger.asia/api/pay",
        DINGER_LIVE_PROJECT_NAME: "configured", DINGER_LIVE_API_KEY: "configured", DINGER_LIVE_MERCHANT_NAME: "configured",
        DINGER_LIVE_PUBLIC_KEY: publicKey, DINGER_LIVE_CALLBACK_KEY: "configured-callback-key",
        DINGER_LIVE_CALLBACK_URL: "https://azielplay.com/api/webhooks/dinger/payment",
        DINGER_LIVE_WAVE_FORM_URL: "https://portal.dinger.asia/gateway/redirect",
        DINGER_LIVE_PAY_REQUEST_CONTRACT_CONFIRMED: "true",
        DINGER_LIVE_PUBLIC_KEY_IDENTITY_CONFIRMED: "true",
        DINGER_LIVE_AYA_QR_RESPONSE_CONTRACT_CONFIRMED: "true",
        DINGER_LIVE_WAVE_REDIRECT_CONTRACT_CONFIRMED: "true",
        ...overrides
    };
}

(async () => {
    const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 1024, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const der = crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" }).toString("base64");
    const env = envFor(der);
    assert.strictEqual(inspectDingerEnvironment(env).configured, true, "Base64 DER/SPKI must be accepted without exposing it");

    const method = { key: "dinger_wavepay_pin", enabled: true, dingerActivationState: "TEST_ONLY", dingerProductionTestApproved: true, dingerGoLiveApproved: false, dingerAuthorizedTestUserIds: ["user-1"] };
    assert.strictEqual(dingerAccessDecision(method, { id: "user-1" }, env).allowed, true);
    assert.strictEqual(dingerAccessDecision(method, { id: "user-2", email: "user-1" }, env).allowed, false, "email/request identity must not authorize TEST_ONLY");
    assert.strictEqual(dingerAccessDecision({ ...method, dingerActivationState: "DISABLED" }, { id: "user-1" }, env).allowed, false);
    assert.strictEqual(dingerAccessDecision({ ...method, dingerActivationState: "PUBLIC", dingerGoLiveApproved: true }, { id: "user-2" }, env).allowed, false, "PUBLIC must remain blocked without callback contract confirmation");
    const publicEnv = { ...env, DINGER_LIVE_CALLBACK_VERIFICATION_CONTRACT_CONFIRMED: "true", DINGER_LIVE_PAY_RESPONSE_SIGNATURE_CONTRACT_CONFIRMED: "true" };
    assert.strictEqual(dingerAccessDecision({ ...method, dingerActivationState: "PUBLIC", dingerGoLiveApproved: true }, { id: "user-2" }, publicEnv).allowed, false, "PUBLIC remains fail-closed until verifier and persistent settlement code exist");
    assert.strictEqual(dingerTechnicalReadiness(method, env).settlementReady, false);

    const response = { code: "000", message: "redacted", time: "20260923 140635", response: { formToken: "sensitive-form-token", transactionNum: "transaction-1", merchOrderId: "attempt-1" } };
    const normalized = normalizeDingerPayResponse(response, { method: DINGER_METHOD_CONTRACTS.dinger_wavepay_pin, merchantOrderId: "attempt-1", intent: { amount: 500 }, configuration: { environment: "LIVE", waveRedirectContractConfirmed: true, waveFormUrl: "https://portal.dinger.asia/gateway/redirect" } });
    assert.strictEqual(normalized.status, "PENDING");
    assert.strictEqual(normalized.providerTransactionId, "transaction-1");
    assert(!JSON.stringify(normalized.safeMetadata).includes("sensitive-form-token"));
    assert.throws(() => normalizeDingerPayResponse(response, { method: DINGER_METHOD_CONTRACTS.dinger_wavepay_pin, merchantOrderId: "attempt-1", intent: { amount: 500 }, configuration: { environment: "LIVE", waveRedirectContractConfirmed: false } }), error => error.stage === "contract");
    const qr = normalizeDingerPayResponse({ code: "000", message: "redacted", time: "20260923 140635", response: { amount: 500, merchOrderId: "attempt-qr", transactionNum: "qr-transaction", qrCode: "mock-qr-payload", sign: "mock-signature", signType: "RSA" } }, { method: DINGER_METHOD_CONTRACTS.dinger_ayapay_qr, merchantOrderId: "attempt-qr", intent: { amount: 500 }, configuration: { environment: "LIVE", ayaQrResponseContractConfirmed: true } });
    assert.strictEqual(qr.status, "PENDING");
    assert.strictEqual(qr.qr.payload, "mock-qr-payload");
    assert.strictEqual(qr.safeMetadata.payResponseSignatureVerified, false);

    const writes = [];
    const registered = new Map();
    await registerDingerPaymentMethods({ model: {
        findOne: ({ key }) => ({ lean: async () => registered.get(key) || null }),
        updateOne: async (...args) => {
            writes.push(args);
            const [filter, update] = args;
            if (!registered.has(filter.key)) registered.set(filter.key, { ...update.$setOnInsert });
            return { upsertedCount: 1 };
        }
    } });
    assert.strictEqual(writes.length, 2);
    writes.forEach(([, update, options]) => {
        assert.strictEqual(update.$setOnInsert.enabled, false);
        assert.strictEqual(update.$setOnInsert.dingerActivationState, "DISABLED");
        assert.strictEqual(options.upsert, true);
    });

    const callbackSource = fs.readFileSync(path.join(__dirname, "../routes/dingerDiagnosticCallback.js"), "utf8");
    assert(!/CommerceOrder|PaymentAttempt|walletTopup|paidFulfillment|paymentOrchestrator/.test(callbackSource), "diagnostic callback must remain mutation-isolated");
    const paymentRouteSource = fs.readFileSync(path.join(__dirname, "../routes/paymentMethods.js"), "utf8");
    assert(paymentRouteSource.includes("optionalAuthMiddleware") && paymentRouteSource.includes("private, no-store"));

    console.log("Dinger activation, test-account isolation, production response and registration verification passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
