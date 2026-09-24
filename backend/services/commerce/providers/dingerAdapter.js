"use strict";

const QRCode = require("qrcode");

const {
    createProviderAdapter,
    ProviderAdapterError,
    ERROR_CODES,
    CAPABILITIES
} = require("../providerAdapter");
const { isSuccessCode, parseDingerTimestamp } = require("../../dinger/dingerApiClient");
const { paymentStatusForDingerTransaction } = require("../../dinger/dingerCallbackContract");

const PROVIDER_ID = "DINGER";
const METHOD_CONTRACTS = Object.freeze({
    dinger_ayapay_qr: Object.freeze({ providerName: "AYA Pay", methodName: "QR", presentation: "QR", responseContract: "QR_PAY_RESPONSE" }),
    dinger_wavepay_pin: Object.freeze({ providerName: "Wave Pay", methodName: "PIN", presentation: "REDIRECT", responseContract: "WAVE_FORM_REDIRECT" })
});

const STAGING_FORM_CHECKOUT_URL = "https://staging.dinger.asia/gateway/formCheckout";
const PRODUCTION_WAVE_REDIRECT_URL = "https://portal.dinger.asia/gateway/redirect";

function text(value) { return String(value || "").trim(); }
function adapterError(code, message, stage) {
    return new ProviderAdapterError(code, message, { stage });
}

function normalizeDingerPayResponse(response, context = {}) {
    const method = context.method || {};
    if (!["QR_PAY_RESPONSE", "WAVE_FORM_REDIRECT"].includes(method.responseContract)) {
        throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, `Dinger ${method.providerName || "payment"} ${method.methodName || "response"} response contract is not confirmed.`, "contract");
    }
    if (!response || typeof response !== "object" || Array.isArray(response) || !response.response || typeof response.response !== "object") {
        throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger redirect response is invalid.", "contract");
    }
    const environment = text(context.configuration?.environment || "STAGING").toUpperCase();
    const live = environment === "LIVE";
    if (live && method.responseContract === "QR_PAY_RESPONSE" && context.configuration?.ayaQrResponseContractConfirmed !== true) {
        throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger live AYA QR response contract is not confirmed.", "contract");
    }
    if (live && method.responseContract === "WAVE_FORM_REDIRECT" && context.configuration?.waveRedirectContractConfirmed !== true) {
        throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger live Wave redirect contract is not confirmed.", "contract");
    }
    const payload = response.response;
    if (!isSuccessCode(response.code)) {
        throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger Pay API response was not successful.", "contract");
    }
    let responseTime;
    try { responseTime = parseDingerTimestamp(response.time, "pay.time").raw; }
    catch (_) { throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger Pay API response time is invalid.", "contract"); }
    const amountPresent = payload.amount !== undefined && payload.amount !== null && text(payload.amount) !== "";
    const amount = amountPresent ? Number(payload.amount) : null;
    const merchantOrderId = text(payload.merchOrderId);
    const formToken = text(payload.formToken);
    const transactionNo = text(payload.transactionNum);
    if ((method.responseContract === "QR_PAY_RESPONSE" || amountPresent) && (!Number.isSafeInteger(amount) || amount !== Number(context.intent?.amount))) {
        throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger redirect response amount does not match the payment intent.", "contract");
    }
    const hasEnvelope = Object.prototype.hasOwnProperty.call(response, "code") && Object.prototype.hasOwnProperty.call(response, "message") && Object.prototype.hasOwnProperty.call(response, "time");
    const hasSignatureFields = Boolean(text(payload.sign)) && Boolean(text(payload.signType));
    if (!hasEnvelope || (method.responseContract === "QR_PAY_RESPONSE" && !hasSignatureFields) || !merchantOrderId || merchantOrderId !== text(context.merchantOrderId) || !transactionNo) {
        throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger redirect response binding is invalid.", "contract");
    }
    if (method.responseContract === "QR_PAY_RESPONSE") {
        const qrCode = text(payload.qrCode);
        if (!qrCode) throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger QR response is missing qrCode.", "contract");
        return {
            providerReference: merchantOrderId,
            providerTransactionId: transactionNo,
            status: "PENDING",
            rawProviderStatus: text(response.code),
            qr: { type: "DINGER_QR", mode: "provider_generated", payload: qrCode },
            safeMetadata: { responseTime, signType: text(payload.signType), payResponseSignatureVerified: false }
        };
    }
    if (!formToken) throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger redirect response is missing formToken.", "contract");
    const configuredFormUrl = live ? text(context.configuration?.waveFormUrl) : STAGING_FORM_CHECKOUT_URL;
    let url;
    try { url = new URL(configuredFormUrl); } catch (_) {
        throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger hosted-form URL is not configured from a confirmed contract.", "contract");
    }
    if (url.protocol !== "https:" || url.search || (live && url.toString() !== PRODUCTION_WAVE_REDIRECT_URL)) {
        throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger hosted-form URL configuration is invalid.", "contract");
    }
    url.searchParams.set("transactionNo", transactionNo);
    url.searchParams.set("formToken", formToken);
    url.searchParams.set("merchantOrderId", merchantOrderId);
    return {
        providerReference: merchantOrderId,
        providerTransactionId: transactionNo,
        status: "PENDING",
        rawProviderStatus: text(response.code),
        redirect: { type: "DINGER_FORM_CHECKOUT", method: "GET", url: url.toString() },
        safeMetadata: { responseTime, signType: text(payload.signType) }
    };
}

function createDingerAdapter(options = {}) {
    const configuration = options.configuration || {};
    const apiClient = options.apiClient || {};
    const normalizePayResponse = options.normalizePayResponse || normalizeDingerPayResponse;

    async function createPayment({ intent = {}, attempt = {} } = {}) {
        if (configuration.enabled !== true) {
            throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "Dinger is disabled.", "configuration");
        }
        const currency = text(intent.currency).toUpperCase();
        const methodId = text(intent.paymentMethodId || intent.paymentMethod);
        const method = METHOD_CONTRACTS[methodId];
        const amount = Number(intent.amount);
        if (currency !== "MMK" || !Number.isSafeInteger(amount) || amount < 500 || amount > 999999999) {
            throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "Dinger requires an integer MMK amount from 500 to 999999999.", "amount");
        }
        if (!method) {
            throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "Dinger payment method is unsupported.", "method");
        }
        if (typeof apiClient.createPayment !== "function") {
            throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "Dinger API client is unavailable.", "configuration");
        }
        const merchantOrderId = text(attempt.attemptId);
        if (!merchantOrderId || merchantOrderId.length > 50) {
            throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "Dinger merchant order identifier must not exceed 50 characters.", "order_binding");
        }
        const items = Array.isArray(intent.items) ? intent.items : [];
        const response = await apiClient.createPayment({
            providerName: method.providerName,
            methodName: method.methodName,
            totalAmount: amount,
            orderId: merchantOrderId,
            customerPhone: text(intent.customer?.phone),
            customerName: text(intent.customer?.name),
            items: JSON.stringify(items),
            currency: "MMK"
        });
        const normalized = normalizePayResponse(response, { intent, attempt, method, merchantOrderId, configuration });
        if (!normalized || typeof normalized !== "object") {
            throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "Dinger Pay API response is unsupported.", "contract");
        }
        const qr = normalized.qr?.payload
            ? { ...normalized.qr, image: await QRCode.toDataURL(normalized.qr.payload, { errorCorrectionLevel: "M", margin: 2, width: 360 }) }
            : normalized.qr;
        return {
            ...normalized,
            qr,
            provider: PROVIDER_ID,
            providerReference: text(normalized.providerReference || merchantOrderId),
            providerTransactionId: text(normalized.providerTransactionId || normalized.providerReference || merchantOrderId),
            amount,
            currency: "MMK",
            safeMetadata: {
                paymentMethodId: methodId,
                providerName: method.providerName,
                methodName: method.methodName,
                presentation: method.presentation,
                responseContract: method.responseContract,
                responseTime: text(normalized.safeMetadata?.responseTime),
                signType: text(normalized.safeMetadata?.signType),
                payResponseSignatureVerified: normalized.safeMetadata?.payResponseSignatureVerified === true
            }
        };
    }

    async function handleProviderEvent({ providerEvent = {}, attempt = {}, intent = {}, trustedOperational } = {}) {
        const methodId = text(attempt.paymentMethodId || attempt.paymentMethod || intent.paymentMethodId).toLowerCase();
        const method = METHOD_CONTRACTS[methodId];
        const providerMatches = text(providerEvent.provider).toUpperCase() === PROVIDER_ID;
        const referenceMatches = text(providerEvent.providerReference) === text(attempt.providerReference);
        const amountMatches = Number(providerEvent.amount) === Number(attempt.amount ?? intent.amount);
        const currencyMatches = text(providerEvent.currency).toUpperCase() === "MMK" && text(attempt.currency || intent.currency).toUpperCase() === "MMK";
        const methodMatches = method && text(providerEvent.providerName).toLowerCase() === text(method.providerName).toLowerCase() && text(providerEvent.methodName).toUpperCase() === text(method.methodName).toUpperCase();
        const transactionId = text(providerEvent.providerTransactionId);
        const transactionMatches = !text(attempt.providerTransactionId) || transactionId === text(attempt.providerTransactionId);
        if (trustedOperational !== true || !providerMatches || !referenceMatches || !amountMatches || !currencyMatches || !methodMatches || !transactionId || !transactionMatches) {
            throw adapterError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "Dinger callback does not match the payment attempt.", "callback");
        }
        const rawStatus = text(providerEvent.rawProviderStatus || providerEvent.transactionStatus).toUpperCase();
        return {
            provider: PROVIDER_ID,
            providerReference: text(attempt.providerReference),
            providerTransactionId: transactionId,
            providerEventId: text(providerEvent.providerEventId),
            eventType: `DINGER_${rawStatus}`,
            status: paymentStatusForDingerTransaction(rawStatus),
            rawProviderStatus: rawStatus,
            amount: Number(providerEvent.amount),
            currency: "MMK",
            occurredAt: providerEvent.occurredAt,
            safeMetadata: { verificationMethod: "DINGER_AES256_SHA256_CALLBACK", transactionStatus: rawStatus }
        };
    }

    return createProviderAdapter({
        providerId: PROVIDER_ID,
        displayName: "Dinger Myanmar Payments",
        version: "1",
        supportedCurrencies: ["MMK"],
        supportedPaymentMethods: Object.keys(METHOD_CONTRACTS),
        supportedCapabilities: [CAPABILITIES.CREATE_PAYMENT, CAPABILITIES.WEBHOOK, CAPABILITIES.QR_CODE, CAPABILITIES.REDIRECT],
        environment: text(configuration.environment || "STAGING").toLowerCase(),
        handlers: { createPayment, handleProviderEvent }
    });
}

module.exports = Object.freeze({
    createDingerAdapter,
    DINGER_PROVIDER_ID: PROVIDER_ID,
    DINGER_METHOD_CONTRACTS: METHOD_CONTRACTS,
    DINGER_STAGING_FORM_CHECKOUT_URL: STAGING_FORM_CHECKOUT_URL,
    DINGER_PRODUCTION_WAVE_REDIRECT_URL: PRODUCTION_WAVE_REDIRECT_URL,
    normalizeDingerPayResponse
});
