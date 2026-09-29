"use strict";

const crypto = require("crypto");
const { MMPaySDK } = require("mmpay-node-sdk");
const { createMyanMyanPayTransport } = require("./myanMyanPayTransport");

function text(value) { return String(value || "").trim(); }
function clientError(code, message, httpStatus = 502) { return Object.assign(new Error(message), { code, httpStatus }); }
const MAX_DIAGNOSTIC_KEYS = 24;
const MAX_DIAGNOSTIC_TEXT = 80;
const MAX_DIAGNOSTIC_PATH = 240;
const GET_PAYMENT_STATUSES = Object.freeze(new Set(["PENDING", "SUCCESS", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED"]));

function boundedKeys(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.keys(value).slice(0, MAX_DIAGNOSTIC_KEYS).map(key => String(key).slice(0, MAX_DIAGNOSTIC_TEXT));
}

function safePrimitive(value) {
    if (!["string", "number", "boolean"].includes(typeof value)) return null;
    if (typeof value !== "string") return value;
    const candidate = value.trim().slice(0, MAX_DIAGNOSTIC_TEXT);
    if (!candidate || /(?:https?:\/\/|bearer\s|eyJ[A-Za-z0-9_-]*\.|[0-9A-Za-z+/]{48,}={0,2}|(?:secret|token|signature|credential|qr)[_:=\-])/i.test(candidate)) return null;
    return candidate;
}

function own(value, key) { return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key)); }

function boundedSafeKeys(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.keys(value)
        .filter(key => /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(key))
        .slice(0, MAX_DIAGNOSTIC_KEYS);
}

function safeCodePrimitive(value) {
    if (typeof value === "number") return Number.isSafeInteger(value) && String(Math.abs(value)).length <= 12 ? value : null;
    if (typeof value !== "string") return null;
    const candidate = value.trim();
    return candidate.length <= MAX_DIAGNOSTIC_TEXT && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(candidate) ? candidate : null;
}

function safeHttpStatus(value) {
    const candidate = typeof value === "number" ? value : typeof value === "string" && /^\d{3}$/.test(value.trim()) ? Number(value.trim()) : NaN;
    return Number.isInteger(candidate) && candidate >= 100 && candidate <= 599 ? candidate : null;
}

function safeErrorName(value) {
    if (!(value instanceof Error)) return "";
    if (value.name === "TypeError") return "TYPE_ERROR";
    if (value.name === "AbortError") return "ABORT_ERROR";
    if (value.name === "Error") return "ERROR";
    return "UNKNOWN_ERROR";
}

function safeUrlShape(configuration = {}) {
    const empty = { apiBaseUrlOrigin: "", apiBaseUrlPath: "", apiBaseUrlAlreadyContainsPaymentsPath: false, sdkSandboxSelected: false, endpointPath: "", handshakeEndpointPath: "" };
    const sandbox = text(configuration.publishableKey).includes("_test_") || text(configuration.secretKey).includes("_test_");
    try {
        const parsed = new URL(text(configuration.apiBaseUrl));
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return { ...empty, sdkSandboxSelected: sandbox };
        const basePath = parsed.pathname.replace(/\/+$/, "");
        const pathSafe = basePath.length <= MAX_DIAGNOSTIC_PATH && /^\/[A-Za-z0-9._~\/-]*$/.test(basePath || "/") && !/(?:^|\/)(?:token|secret|signature|credential|authorization|auth)(?:\/|$)/i.test(basePath);
        if (!pathSafe || basePath.split("/").some(segment => segment.length > MAX_DIAGNOSTIC_TEXT)) return { ...empty, apiBaseUrlOrigin: parsed.origin, sdkSandboxSelected: sandbox };
        const apiBaseUrlPath = basePath || "/";
        const suffix = sandbox ? "sandbox-get" : "get";
        const handshakeSuffix = sandbox ? "sandbox-handshake" : "handshake";
        const prefix = basePath || "";
        const endpointPath = `${prefix}/payments/${suffix}`;
        const handshakeEndpointPath = `${prefix}/payments/${handshakeSuffix}`;
        return {
            apiBaseUrlOrigin: parsed.origin,
            apiBaseUrlPath,
            apiBaseUrlAlreadyContainsPaymentsPath: /(?:^|\/)payments(?:\/|$)/i.test(apiBaseUrlPath),
            sdkSandboxSelected: sandbox,
            endpointPath: endpointPath.length <= MAX_DIAGNOSTIC_PATH ? endpointPath : "",
            handshakeEndpointPath: handshakeEndpointPath.length <= MAX_DIAGNOSTIC_PATH ? handshakeEndpointPath : ""
        };
    } catch (_) {
        return { ...empty, sdkSandboxSelected: sandbox };
    }
}

function classifyGetResponseShape(response) {
    if (response instanceof Error) return "ERROR_INSTANCE";
    if (!response || typeof response !== "object" || Array.isArray(response)) return "NON_OBJECT_RESPONSE";
    if (["error", "errorCode", "code", "statusCode", "httpStatus", "message"].some(key => own(response, key))) return "ERROR_SHAPED_OBJECT";
    const status = text(response.status).toUpperCase();
    if (GET_PAYMENT_STATUSES.has(status) && own(response, "orderId") && Boolean(text(response.orderId)) && own(response, "amount")) return "DOCUMENTED_PAYMENT_SHAPE";
    return "SUCCESS_SHAPED_MISSING_FIELDS";
}

function getResponseShapeDiagnostic(response, configuration = {}) {
    const objectResponse = Boolean(response && typeof response === "object" && !Array.isArray(response));
    const safeCode = safeCodePrimitive(objectResponse ? (response.code ?? response.errorCode) : undefined);
    const httpLikeStatus = safeHttpStatus(objectResponse ? (response.httpStatus ?? response.statusCode ?? response.status) : undefined);
    return Object.freeze({
        provider: "MYANMYANPAY",
        operation: "GET",
        httpMethod: "POST",
        classification: classifyGetResponseShape(response),
        responseType: typeof response,
        safeErrorName: safeErrorName(response),
        topLevelKeys: boundedSafeKeys(response),
        ...(safeCode !== null ? { safeCode } : {}),
        ...(httpLikeStatus !== null ? { httpLikeStatus } : {}),
        hasOrderId: own(response, "orderId"),
        hasStatus: own(response, "status"),
        hasQr: own(response, "qr"),
        hasAmount: own(response, "amount"),
        hasCurrency: own(response, "currency"),
        hasCode: own(response, "code") || own(response, "errorCode"),
        hasError: own(response, "error"),
        hasMessage: own(response, "message"),
        ...safeUrlShape(configuration)
    });
}

function transportErrorDiagnostic(error, operation, configuration = {}) {
    const shape = safeUrlShape(configuration);
    const classification = safeCodePrimitive(error?.code) || "UNKNOWN_ERROR";
    const safeCode = safeCodePrimitive(error?.providerCode);
    const httpLikeStatus = safeHttpStatus(error?.httpStatus);
    const stage = ["INPUT", "HANDSHAKE", "PROVIDER", "CONFIGURATION"].includes(text(error?.stage).toUpperCase()) ? text(error.stage).toUpperCase() : "UNKNOWN";
    const errorEndpointPath = text(error?.endpointPath);
    const safeEndpointPath = errorEndpointPath.length <= MAX_DIAGNOSTIC_PATH && /^\/[A-Za-z0-9._~\/-]*$/.test(errorEndpointPath) ? errorEndpointPath : "";
    return Object.freeze({
        provider: "MYANMYANPAY",
        operation,
        stage,
        classification,
        ...(safeCode !== null ? { safeCode } : {}),
        ...(httpLikeStatus !== null ? { httpLikeStatus } : {}),
        endpointPath: stage === "HANDSHAKE" ? shape.handshakeEndpointPath : safeEndpointPath,
        sdkSandboxSelected: shape.sdkSandboxSelected
    });
}

function classifyResponseShape(response) {
    if (response instanceof Error) return "ERROR_INSTANCE";
    if (!response || typeof response !== "object" || Array.isArray(response)) return "NON_OBJECT_RESPONSE";
    const hasOrderId = own(response, "orderId") && Boolean(text(response.orderId));
    const hasQr = own(response, "qr") && Boolean(text(response.qr));
    const hasAmount = own(response, "amount");
    const hasCurrency = own(response, "currency") && Boolean(text(response.currency));
    const documentedSuccess = response.status === "PENDING" && hasOrderId && hasQr && hasAmount && hasCurrency;
    if (documentedSuccess) return "DOCUMENTED_SUCCESS_SHAPE";
    if (own(response, "error") || own(response, "errorCode") || own(response, "code") || (own(response, "message") && !hasOrderId && !hasQr)) return "ERROR_SHAPED_OBJECT";
    return "SUCCESS_SHAPED_MISSING_FIELDS";
}

function configurationShape(configuration = {}) {
    let apiBaseUrlOrigin = "";
    let apiBaseUrlPath = "";
    try {
        const parsed = new URL(text(configuration.apiBaseUrl));
        apiBaseUrlOrigin = parsed.origin;
        apiBaseUrlPath = parsed.pathname.replace(/\/+$/, "") || "/";
    } catch (_) { /* Configuration loading remains authoritative. */ }
    const publishableKeyLooksSandbox = text(configuration.publishableKey).includes("_test_");
    const secretKeyLooksSandbox = text(configuration.secretKey).includes("_test_");
    return {
        apiBaseUrlOrigin,
        apiBaseUrlPath,
        apiBaseUrlAlreadyContainsPaymentsPath: /(?:^|\/)payments(?:\/|$)/i.test(apiBaseUrlPath),
        sdkSandboxKeyClassification: {
            publishableKeyLooksSandbox,
            secretKeyLooksSandbox,
            sdkWouldUseSandbox: publishableKeyLooksSandbox || secretKeyLooksSandbox
        }
    };
}

function responseShapeDiagnostic(response, configuration = {}) {
    const objectResponse = Boolean(response && typeof response === "object" && !Array.isArray(response));
    const safeStatus = safePrimitive(objectResponse ? response.status : undefined);
    const safeCode = safePrimitive(objectResponse ? (response.code ?? response.errorCode) : undefined);
    const httpLikeStatus = safePrimitive(objectResponse ? (response.httpStatus ?? response.statusCode) : undefined);
    return Object.freeze({
        provider: "MYANMYANPAY",
        operation: "sandbox_pay_response_shape",
        classification: classifyResponseShape(response),
        responseType: typeof response,
        isNull: response === null,
        isArray: Array.isArray(response),
        isErrorInstance: response instanceof Error,
        topLevelKeys: boundedKeys(response),
        dataKeys: boundedKeys(objectResponse ? response.data : null),
        resultKeys: boundedKeys(objectResponse ? response.result : null),
        statusType: objectResponse ? typeof response.status : "undefined",
        ...(safeStatus !== null ? { safeStatus } : {}),
        ...(safeCode !== null ? { safeCode } : {}),
        ...(httpLikeStatus !== null ? { httpLikeStatus } : {}),
        hasOrderId: own(response, "orderId"),
        hasQr: own(response, "qr"),
        hasAmount: own(response, "amount"),
        hasCurrency: own(response, "currency"),
        hasError: own(response, "error"),
        hasMessage: own(response, "message"),
        ...configurationShape(configuration)
    });
}

function createMyanMyanPayClient(configuration, options = {}) {
    const logger = options.logger || console;
    const sdk = options.sdk || MMPaySDK({
        appId: configuration.appId,
        publishableKey: configuration.publishableKey,
        secretKey: configuration.secretKey,
        apiBaseUrl: configuration.apiBaseUrl
    });
    const transport = options.transport || createMyanMyanPayTransport(configuration, { fetchImpl: options.fetchImpl, nonceFactory: options.nonceFactory });

    function logTransportError(error, operation) {
        try { logger.info?.("[MYANMYANPAY_TRANSPORT]", transportErrorDiagnostic(error, operation, configuration)); }
        catch (_) { /* Diagnostics must never affect provider behavior. */ }
    }

    async function pay(payload) {
        let response;
        try { response = await transport.pay(payload); }
        catch (error) { logTransportError(error, "PAY"); throw error; }
        try {
            logger.info?.("[MYANMYANPAY_RESPONSE_SHAPE]", responseShapeDiagnostic(response, configuration));
        } catch (_) { /* Temporary diagnostics must never affect payment behavior. */ }
        if (!response || typeof response !== "object" || Array.isArray(response) || response.status !== "PENDING" || !text(response.orderId) || !text(response.qr) || !Number.isSafeInteger(Number(response.amount)) || text(response.currency).toUpperCase() !== "MMK") {
            throw clientError("MYANMYANPAY_PROVIDER_RESPONSE_INVALID", "MyanMyanPay returned an invalid payment response.");
        }
        if (text(response.orderId) !== text(payload.orderId) || Number(response.amount) !== Number(payload.amount) || text(response.currency).toUpperCase() !== text(payload.currency).toUpperCase()) {
            throw clientError("MYANMYANPAY_PROVIDER_BINDING_MISMATCH", "MyanMyanPay payment response binding is invalid.");
        }
        return response;
    }

    async function get(input) {
        let response;
        try {
            response = await transport.get(input);
        } catch (error) {
            logTransportError(error, "GET");
            try {
                logger.info?.("[MYANMYANPAY_GET_RESPONSE_SHAPE]", getResponseShapeDiagnostic(error, configuration));
            } catch (_) { /* Temporary diagnostics must never affect provider behavior. */ }
            throw error;
        }
        try {
            logger.info?.("[MYANMYANPAY_GET_RESPONSE_SHAPE]", getResponseShapeDiagnostic(response, configuration));
        } catch (_) { /* Temporary diagnostics must never affect provider behavior. */ }
        return response;
    }

    async function cancel(input) {
        try { return await transport.cancel(input); }
        catch (error) { logTransportError(error, "CANCEL"); throw error; }
    }

    async function verifyAndListen(payload, nonce, signature) {
        const expected = text(sdk._generateSignature(payload, nonce));
        const supplied = text(signature);
        const expectedBuffer = Buffer.from(expected, "utf8");
        const suppliedBuffer = Buffer.from(supplied, "utf8");
        if (!nonce || !supplied || expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
            throw clientError("MYANMYANPAY_CALLBACK_SIGNATURE_INVALID", "MyanMyanPay callback authentication failed.", 401);
        }
        let verified = false;
        const mark = () => { verified = true; };
        sdk.once("tx:create", mark).once("tx:success", mark).once("tx:failed", mark).once("tx:refunded", mark)
            .once("tx:cancel", mark).once("tx:expire", mark).once("tx:heartbeat", mark).once("tx:unknown", mark);
        sdk.once("error", () => {});
        await sdk.listen(payload, nonce, supplied);
        if (!verified) throw clientError("MYANMYANPAY_CALLBACK_VERIFICATION_FAILED", "MyanMyanPay callback verification failed.", 401);
        return JSON.parse(payload);
    }

    return Object.freeze({ pay, get, cancel, verifyAndListen });
}

module.exports = Object.freeze({
    createMyanMyanPayClient,
    _test: Object.freeze({ boundedKeys, safePrimitive, classifyResponseShape, configurationShape, responseShapeDiagnostic, boundedSafeKeys, safeCodePrimitive, safeHttpStatus, safeErrorName, safeUrlShape, classifyGetResponseShape, getResponseShapeDiagnostic, transportErrorDiagnostic })
});
