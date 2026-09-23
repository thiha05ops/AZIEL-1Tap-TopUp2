"use strict";

const assert = require("assert");
const { createProviderRegistry } = require("../services/commerce/providerRegistry");
const { createDingerAdapter, DINGER_METHOD_CONTRACTS } = require("../services/commerce/providers/dingerAdapter");
const { inspectDingerEnvironment } = require("../services/dinger/dingerConfiguration");
const { createDingerApiClient } = require("../services/dinger/dingerApiClient");

const methods = Object.keys(DINGER_METHOD_CONTRACTS);

(async () => {
    assert.strictEqual(inspectDingerEnvironment({}).enabled, false, "Dinger must be disabled by default");
    let httpCalls = 0;
    const unavailableClient = createDingerApiClient({
        configuration: { enabled: true, baseUrl: "https://example.test", tokenTimeoutMs: 1000 },
        fetchImpl: async () => { httpCalls += 1; throw new Error("simulated network failure"); }
    });
    await assert.rejects(() => unavailableClient.getToken(), error => error.code === "DINGER_NETWORK_ERROR");
    assert.strictEqual(httpCalls, 1, "confirmed token contract may perform one explicit token request");

    let captured = null;
    const adapter = createDingerAdapter({
        configuration: { enabled: true, environment: "STAGING" },
        apiClient: { async createPayment(payload) {
            captured = payload;
            return { code: "000", message: "success", time: "20260916 000000", response: { amount: 1000, merchOrderId: payload.orderId, formToken: "FORM-TOKEN", transactionNum: "TRX-1", sign: "not-persisted", signType: "SHA256" } };
        } }
    });
    assert.strictEqual(adapter.providerId, "DINGER");
    assert.deepStrictEqual(adapter.supportedCurrencies, ["MMK"]);
    assert.deepStrictEqual(adapter.supportedPaymentMethods, methods);
    ["CREATE_PAYMENT", "WEBHOOK", "QR_CODE", "REDIRECT"].forEach(capability => assert(adapter.supportsCapability(capability), capability));

    const registry = createProviderRegistry([adapter]);
    assert.strictEqual(registry.validateProvider({ providerId: "DINGER", currency: "MMK", paymentMethod: "dinger_ayapay_qr" }).providerId, "DINGER");
    assert.throws(() => registry.validateProvider({ providerId: "DINGER", currency: "THB", paymentMethod: "dinger_ayapay_qr" }), error => error.code === "PAYMENT_PROVIDER_CONFIGURATION_INVALID");
    methods.forEach(method => assert.strictEqual(registry.resolveProvider({ paymentMethod: method }).providerId, "DINGER"));

    assert.deepStrictEqual(DINGER_METHOD_CONTRACTS.dinger_ayapay_pin, { providerName: "AYA Pay", methodName: "PIN", presentation: "WALLET_NOTIFICATION", responseContract: "UNCONFIRMED" });
    assert.deepStrictEqual(DINGER_METHOD_CONTRACTS.dinger_kbzpay_pwa, { providerName: "KBZ Pay", methodName: "PWA", presentation: "APP_DIRECT", responseContract: "UNCONFIRMED" });
    assert.deepStrictEqual(DINGER_METHOD_CONTRACTS.dinger_wavepay_pin, { providerName: "Wave Pay", methodName: "PIN", presentation: "REDIRECT", responseContract: "WAVE_FORM_REDIRECT" });

    const result = await adapter.createPayment({
        intent: { amount: 1000, currency: "MMK", paymentMethodId: "dinger_wavepay_pin", customer: { phone: "0912345678", name: "Test Customer" }, items: [{ name: "Test Item", amount: 1000 }] },
        attempt: { attemptId: "ATT-DINGER-1" }
    });
    assert.deepStrictEqual(captured, { providerName: "Wave Pay", methodName: "PIN", totalAmount: 1000, orderId: "ATT-DINGER-1", customerPhone: "0912345678", customerName: "Test Customer", items: '[{"name":"Test Item","amount":1000}]', currency: "MMK" });
    const redirectUrl = new URL(result.redirect.url);
    assert.strictEqual(`${redirectUrl.origin}${redirectUrl.pathname}`, "https://staging.dinger.asia/gateway/formCheckout");
    assert.strictEqual(redirectUrl.searchParams.get("transactionNo"), "TRX-1");
    assert.strictEqual(redirectUrl.searchParams.get("formToken"), "FORM-TOKEN");
    assert.strictEqual(redirectUrl.searchParams.get("merchantOrderId"), "ATT-DINGER-1");
    const normalized = adapter.normalizeProviderResponse(result);
    const redacted = adapter.normalizeProviderResponse({
        ...result,
        safeMetadata: { fixture: true, apiKey: "must-be-redacted", accessToken: "must-be-redacted" }
    });
    assert.strictEqual(redacted.safeMetadata.apiKey, undefined);
    assert.strictEqual(redacted.safeMetadata.accessToken, undefined);
    assert.strictEqual(redacted.safeMetadata.fixture, true);

    const qrAdapter = createDingerAdapter({
        configuration: { enabled: true, environment: "STAGING" },
        apiClient: { async createPayment(payload) { return { code: "000", message: "Request Success", time: "20260916 120000", response: { amount: payload.totalAmount, merchOrderId: payload.orderId, formToken: "unused-for-qr", transactionNum: "QR-TRX-1", qrCode: "CONFIRMED-QR-PAYLOAD", sign: "unverified", signType: "SHA256" } }; } }
    });
    const qrResult = await qrAdapter.createPayment({ intent: { amount: 1000, currency: "MMK", paymentMethodId: "dinger_ayapay_qr", customer: { phone: "09", name: "Test" }, items: [] }, attempt: { attemptId: "ATT-QR-1" } });
    assert.strictEqual(qrResult.providerTransactionId, "QR-TRX-1");
    assert.deepStrictEqual(qrResult.qr, { type: "DINGER_QR", mode: "provider_generated", payload: "CONFIRMED-QR-PAYLOAD" });
    assert.strictEqual(qrResult.safeMetadata.payResponseSignatureVerified, undefined, "adapter output must not claim response signature verification");

    const unconfirmed = createDingerAdapter({ configuration: { enabled: true }, apiClient: { createPayment: async () => ({ undocumented: true }) } });
    await assert.rejects(() => unconfirmed.createPayment({ intent: { amount: 1000, currency: "MMK", paymentMethodId: "dinger_ayapay_qr", customer: { phone: "09", name: "Test" } }, attempt: { attemptId: "ATT-2" } }), error => error.code === "PAYMENT_PROVIDER_RESPONSE_INVALID" && error.stage === "contract");
    await assert.rejects(() => unconfirmed.createPayment({ intent: { amount: 1000, currency: "MMK", paymentMethodId: "dinger_kbzpay_qr", customer: { phone: "09", name: "Test" } }, attempt: { attemptId: "ATT-3" } }), error => error.code === "PAYMENT_PROVIDER_RESPONSE_INVALID" && error.stage === "contract");
    const invalidQr = response => createDingerAdapter({ configuration: { enabled: true, environment: "STAGING" }, apiClient: { createPayment: async () => response } });
    const qrContext = { intent: { amount: 1000, currency: "MMK", paymentMethodId: "dinger_kbzpay_qr", customer: { phone: "09", name: "Test" }, items: [] }, attempt: { attemptId: "ATT-QR-ERR" } };
    const baseQrResponse = { code: "000", message: "Request Success", time: "20260916 120000", response: { amount: 1000, merchOrderId: "ATT-QR-ERR", transactionNum: "TRX", qrCode: "QR", sign: "unverified", signType: "SHA256" } };
    await assert.rejects(() => invalidQr({ ...baseQrResponse, response: { ...baseQrResponse.response, amount: 1001 } }).createPayment(qrContext), error => error.code === "PAYMENT_PROVIDER_RESPONSE_INVALID");
    await assert.rejects(() => invalidQr({ ...baseQrResponse, response: { ...baseQrResponse.response, merchOrderId: "OTHER" } }).createPayment(qrContext), error => error.code === "PAYMENT_PROVIDER_RESPONSE_INVALID");
    await assert.rejects(() => invalidQr({ ...baseQrResponse, response: { ...baseQrResponse.response, transactionNum: "" } }).createPayment(qrContext), error => error.code === "PAYMENT_PROVIDER_RESPONSE_INVALID");
    await assert.rejects(() => invalidQr({ ...baseQrResponse, response: { ...baseQrResponse.response, qrCode: "" } }).createPayment(qrContext), error => error.code === "PAYMENT_PROVIDER_RESPONSE_INVALID");
    await assert.rejects(() => invalidQr({ ...baseQrResponse, code: "001" }).createPayment(qrContext), error => error.code === "PAYMENT_PROVIDER_RESPONSE_INVALID");
    await assert.rejects(() => adapter.createPayment({ intent: { amount: 499, currency: "MMK", paymentMethodId: "dinger_wavepay_pin" }, attempt: { attemptId: "ATT-4" } }), error => error.code === "PAYMENT_PROVIDER_CONFIGURATION_INVALID" && error.stage === "amount");
    await assert.rejects(() => adapter.createPayment({ intent: { amount: 500.5, currency: "MMK", paymentMethodId: "dinger_wavepay_pin" }, attempt: { attemptId: "ATT-5" } }), error => error.code === "PAYMENT_PROVIDER_CONFIGURATION_INVALID" && error.stage === "amount");

    console.log("Dinger provider adapter foundation verification passed.");
})().catch(error => { console.error(error); process.exit(1); });
