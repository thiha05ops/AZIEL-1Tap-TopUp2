"use strict";

const crypto = require("crypto");

const CALLBACK_URL = "https://azielplay.com/api/webhooks/myanmyanpay/payment";
const STATUSES = Object.freeze(new Set(["PENDING", "SUCCESS", "FAILED", "REFUNDED", "CANCELLED", "EXPIRED"]));
const OPERATION_SEGMENTS = Object.freeze({ PAY: "sandbox-create", GET: "sandbox-get", CANCEL: "sandbox-cancel" });

const text = value => String(value || "").trim();
const own = (value, key) => Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));

class MyanMyanPayTransportError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "MyanMyanPayTransportError";
        this.code = code;
        this.httpStatus = Number(options.httpStatus || 502);
        this.stage = text(options.stage);
        this.operation = text(options.operation);
        this.providerCode = safeCode(options.providerCode);
        this.endpointPath = text(options.endpointPath);
        this.retryable = options.retryable === true;
    }
}

function safeCode(value) {
    if (typeof value === "number") return Number.isSafeInteger(value) && String(Math.abs(value)).length <= 12 ? value : "";
    if (typeof value !== "string") return "";
    const candidate = value.trim();
    return candidate.length <= 80 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(candidate) ? candidate : "";
}

function errorShaped(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
        ["error", "errorCode", "code", "statusCode", "httpStatus", "message"].some(key => own(value, key)));
}

function endpoint(baseUrl, segment) {
    return `${baseUrl}/payments/${segment}`;
}

function endpointPath(url) {
    try { return new URL(url).pathname; } catch (_) { return ""; }
}

function signature(secretKey, bodyString, nonce) {
    return crypto.createHmac("sha256", secretKey).update(`${nonce}.${bodyString}`).digest("hex");
}

function validToken(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);
}

function createMyanMyanPayTransport(configuration = {}, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const nonceFactory = options.nonceFactory || (() => Date.now().toString());
    if (typeof fetchImpl !== "function") throw new MyanMyanPayTransportError("MYANMYANPAY_TRANSPORT_UNAVAILABLE", "MyanMyanPay transport is unavailable.", { stage: "configuration" });
    if (configuration.environment !== "SANDBOX" || configuration.apiBaseUrl !== "https://sandbox.myanmyanpay.com" || !text(configuration.appId) || !text(configuration.publishableKey).includes("_test_") || !text(configuration.secretKey).includes("_test_") || configuration.callbackUrl !== CALLBACK_URL) {
        throw new MyanMyanPayTransportError("MYANMYANPAY_TRANSPORT_CONFIGURATION_INVALID", "MyanMyanPay Sandbox transport configuration is invalid.", { stage: "configuration" });
    }

    async function requestJson({ operation, stage, url, body, btoken = "" }) {
        const nonce = text(body.nonce);
        const bodyString = JSON.stringify(body);
        const headers = {
            Authorization: `Bearer ${configuration.publishableKey}`,
            "X-Mmpay-Nonce": nonce,
            "X-Mmpay-Signature": signature(configuration.secretKey, bodyString, nonce),
            "Content-Type": "application/json"
        };
        if (stage !== "HANDSHAKE") {
            if (!validToken(btoken)) throw new MyanMyanPayTransportError("MYANMYANPAY_HANDSHAKE_RESPONSE_INVALID", "MyanMyanPay handshake token is invalid.", { stage: "HANDSHAKE", operation, endpointPath: endpointPath(url) });
            headers["X-Mmpay-Btoken"] = btoken;
        }
        let response;
        try {
            response = await fetchImpl(url, { method: "POST", body: bodyString, headers });
        } catch (error) {
            throw new MyanMyanPayTransportError(stage === "HANDSHAKE" ? "MYANMYANPAY_HANDSHAKE_TRANSPORT_ERROR" : "MYANMYANPAY_PROVIDER_TRANSPORT_ERROR", "MyanMyanPay transport request failed.", { stage, operation, endpointPath: endpointPath(url), retryable: true });
        }
        let data;
        try {
            data = await response.json();
        } catch (_) {
            throw new MyanMyanPayTransportError(stage === "HANDSHAKE" ? "MYANMYANPAY_HANDSHAKE_RESPONSE_INVALID" : "MYANMYANPAY_PROVIDER_RESPONSE_INVALID", "MyanMyanPay returned an invalid JSON response.", { stage, operation, httpStatus: response.status, endpointPath: endpointPath(url) });
        }
        const providerCode = safeCode(data?.code ?? data?.errorCode);
        if (!response.ok || errorShaped(data)) {
            throw new MyanMyanPayTransportError(stage === "HANDSHAKE" ? "MYANMYANPAY_HANDSHAKE_REJECTED" : "MYANMYANPAY_PROVIDER_REJECTED", "MyanMyanPay rejected the request.", { stage, operation, httpStatus: response.status, providerCode, endpointPath: endpointPath(url) });
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new MyanMyanPayTransportError(stage === "HANDSHAKE" ? "MYANMYANPAY_HANDSHAKE_RESPONSE_INVALID" : "MYANMYANPAY_PROVIDER_RESPONSE_INVALID", "MyanMyanPay returned an invalid response.", { stage, operation, httpStatus: response.status, endpointPath: endpointPath(url) });
        }
        return data;
    }

    async function handShake(orderId, operation) {
        const nonce = text(nonceFactory());
        const url = endpoint(configuration.apiBaseUrl, "sandbox-handshake");
        const response = await requestJson({ operation, stage: "HANDSHAKE", url, body: { orderId, nonce } });
        if (!validToken(response.token)) throw new MyanMyanPayTransportError("MYANMYANPAY_HANDSHAKE_RESPONSE_INVALID", "MyanMyanPay handshake token is missing or invalid.", { stage: "HANDSHAKE", operation, httpStatus: 200, endpointPath: endpointPath(url) });
        return response.token;
    }

    async function execute(operation, payload = {}) {
        const orderId = text(payload.orderId);
        if (!orderId) throw new MyanMyanPayTransportError("MYANMYANPAY_PROVIDER_REQUEST_INVALID", "MyanMyanPay orderId is required.", { stage: "INPUT", operation });
        if (operation === "PAY") {
            if (!Number.isSafeInteger(Number(payload.amount)) || Number(payload.amount) <= 0 || text(payload.currency).toUpperCase() !== "MMK" || payload.callbackUrl !== CALLBACK_URL) {
                throw new MyanMyanPayTransportError("MYANMYANPAY_PROVIDER_REQUEST_INVALID", "MyanMyanPay payment request is invalid.", { stage: "INPUT", operation });
            }
        }
        const btoken = await handShake(orderId, operation);
        const nonce = text(nonceFactory());
        const segment = OPERATION_SEGMENTS[operation];
        const url = endpoint(configuration.apiBaseUrl, segment);
        const body = operation === "PAY" ? {
            appId: configuration.appId,
            nonce,
            amount: Number(payload.amount),
            orderId,
            callbackUrl: payload.callbackUrl,
            currency: "MMK",
            customMessage: payload.customMessage,
            items: Array.isArray(payload.items) ? payload.items : []
        } : { orderId, nonce };
        const result = await requestJson({ operation, stage: "PROVIDER", url, body, btoken });
        if (operation === "GET" && (!text(result.orderId) || !own(result, "amount") || !text(result.status))) {
            throw new MyanMyanPayTransportError("MYANMYANPAY_PROVIDER_RESPONSE_INVALID", "MyanMyanPay returned an incomplete payment response.", { stage: "PROVIDER", operation, httpStatus: 200, endpointPath: endpointPath(url) });
        }
        if (operation === "CANCEL" && (!text(result.orderId) || !own(result, "amount") || !text(result.status))) {
            throw new MyanMyanPayTransportError("MYANMYANPAY_PROVIDER_RESPONSE_INVALID", "MyanMyanPay returned an incomplete cancellation response.", { stage: "PROVIDER", operation, httpStatus: 200, endpointPath: endpointPath(url) });
        }
        return result;
    }

    return Object.freeze({
        pay: payload => execute("PAY", payload),
        get: payload => execute("GET", payload),
        cancel: payload => execute("CANCEL", payload)
    });
}

module.exports = Object.freeze({ createMyanMyanPayTransport, MyanMyanPayTransportError, _test: Object.freeze({ safeCode, errorShaped, endpoint, endpointPath, signature, validToken, STATUSES }) });
