"use strict";

const crypto = require("crypto");
const { MMPaySDK } = require("mmpay-node-sdk");
const { isMyanMyanPayProviderOrderId } = require("./myanMyanPayProviderOrderId");

function text(value) { return String(value || "").trim(); }
function clientError(code, message, httpStatus = 502, metadata = {}) {
    const error = Object.assign(new Error(message), { code, httpStatus, metadata: Object.freeze({ ...metadata }) });
    if (metadata.providerCode !== null && metadata.providerCode !== undefined) error.providerCode = metadata.providerCode;
    return error;
}

const MAX_DIAGNOSTIC_KEYS = 24;
const MAX_DIAGNOSTIC_TEXT = 80;
const MAX_DIAGNOSTIC_PATH = 240;
const GET_PAYMENT_STATUSES = Object.freeze(new Set(["PENDING", "SUCCESS", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED"]));
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,219}$/;
const SAFE_CAUSE_CODES = Object.freeze(new Set([
    "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
    "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED",
    "ERR_TLS_INVALID_PROTOCOL_VERSION"
]));

function own(value, key) { return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key)); }
function plainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Error)); }

function boundedKeys(value) {
    if (!plainObject(value)) return [];
    return Object.keys(value).slice(0, MAX_DIAGNOSTIC_KEYS).map(key => String(key).slice(0, MAX_DIAGNOSTIC_TEXT));
}

function boundedSafeKeys(value) {
    if (!plainObject(value)) return [];
    return Object.keys(value).filter(key => /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(key)).slice(0, MAX_DIAGNOSTIC_KEYS);
}

function safePrimitive(value) {
    if (!["string", "number", "boolean"].includes(typeof value)) return null;
    if (typeof value !== "string") return value;
    const candidate = value.trim().slice(0, MAX_DIAGNOSTIC_TEXT);
    if (!candidate || /(?:https?:\/\/|bearer\s|eyJ[A-Za-z0-9_-]*\.|[0-9A-Za-z+/]{48,}={0,2}|(?:secret|token|signature|credential|qr)[_:=\-])/i.test(candidate)) return null;
    return candidate;
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

function safeCauseCode(value) {
    if (!(value instanceof Error)) return "";
    try {
        const code = typeof value.cause?.code === "string" ? value.cause.code.trim().toUpperCase() : "";
        return SAFE_CAUSE_CODES.has(code) ? code : "UNKNOWN";
    } catch (_) { return "UNKNOWN"; }
}

function safeCreatePhase(value) {
    if (!(value instanceof Error)) return "";
    try {
        const stack = typeof value.stack === "string" ? value.stack : "";
        if (/(?:dist[\\/]cjs[\\/]index\.js:160|src[\\/]index\.ts:173)(?::\d+)?/.test(stack)) return "CREATE_FETCH";
        if (/(?:dist[\\/]cjs[\\/]index\.js:171|src[\\/]index\.ts:184)(?::\d+)?/.test(stack)) return "CREATE_RESPONSE_BODY";
        return "UNKNOWN_CREATE_PHASE";
    } catch (_) { return "UNKNOWN_CREATE_PHASE"; }
}

function handshakeShapeDiagnostic(value, configuration = {}) {
    const sandbox = text(configuration.publishableKey).includes("_test_") || text(configuration.secretKey).includes("_test_");
    const objectValue = plainObject(value);
    const tokenPresent = Boolean(objectValue && typeof value.token === "string" && value.token.length > 0);
    let classification = "NON_OBJECT_RESPONSE";
    if (value instanceof Error) classification = "ERROR_INSTANCE";
    else if (tokenPresent) classification = "TOKEN_PRESENT";
    else if (errorShaped(value)) classification = "ERROR_SHAPED_OBJECT";
    else if (objectValue) classification = "TOKEN_MISSING";
    return Object.freeze({
        provider: "MYANMYANPAY",
        environment: sandbox ? "SANDBOX" : "PRODUCTION",
        classification,
        safeErrorName: safeErrorName(value),
        ...(value instanceof Error ? { safeCauseCode: safeCauseCode(value) } : {}),
        tokenPresent,
        sdkSandboxSelected: sandbox,
        endpointPath: sandbox ? "/payments/sandbox-handshake" : "/payments/handshake"
    });
}

function safeUrlShape(configuration = {}, operation = "GET") {
    const empty = { apiBaseUrlOrigin: "", apiBaseUrlPath: "", apiBaseUrlAlreadyContainsPaymentsPath: false, sdkSandboxSelected: false, endpointPath: "", handshakeEndpointPath: "" };
    const sandbox = text(configuration.publishableKey).includes("_test_") || text(configuration.secretKey).includes("_test_");
    try {
        const parsed = new URL(text(configuration.apiBaseUrl));
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return { ...empty, sdkSandboxSelected: sandbox };
        const basePath = parsed.pathname.replace(/\/+$/, "");
        const pathSafe = basePath.length <= MAX_DIAGNOSTIC_PATH && /^\/[A-Za-z0-9._~\/-]*$/.test(basePath || "/") && !/(?:^|\/)(?:token|secret|signature|credential|authorization|auth)(?:\/|$)/i.test(basePath);
        if (!pathSafe || basePath.split("/").some(segment => segment.length > MAX_DIAGNOSTIC_TEXT)) return { ...empty, apiBaseUrlOrigin: parsed.origin, sdkSandboxSelected: sandbox };
        const normalizedOperation = ["PAY", "GET", "CANCEL"].includes(text(operation).toUpperCase()) ? text(operation).toLowerCase() : "get";
        const suffix = sandbox ? `sandbox-${normalizedOperation === "pay" ? "create" : normalizedOperation}` : normalizedOperation === "pay" ? "create" : normalizedOperation;
        const prefix = basePath || "";
        return {
            apiBaseUrlOrigin: parsed.origin,
            apiBaseUrlPath: basePath || "/",
            apiBaseUrlAlreadyContainsPaymentsPath: /(?:^|\/)payments(?:\/|$)/i.test(basePath || "/"),
            sdkSandboxSelected: sandbox,
            endpointPath: `${prefix}/payments/${suffix}`.slice(0, MAX_DIAGNOSTIC_PATH),
            handshakeEndpointPath: `${prefix}/payments/${sandbox ? "sandbox-handshake" : "handshake"}`.slice(0, MAX_DIAGNOSTIC_PATH)
        };
    } catch (_) { return { ...empty, sdkSandboxSelected: sandbox }; }
}

function errorShaped(value) {
    if (!plainObject(value)) return false;
    return ["error", "errorCode", "code", "statusCode", "httpStatus", "message"].some(key => own(value, key));
}

function classifyResponseShape(response, operation = "PAY") {
    if (response instanceof Error) return "ERROR_INSTANCE";
    if (!plainObject(response)) return "NON_OBJECT_RESPONSE";
    if (errorShaped(response)) return "ERROR_SHAPED_OBJECT";
    const status = text(response.status).toUpperCase();
    if (operation === "GET" && GET_PAYMENT_STATUSES.has(status) && text(response.orderId) && own(response, "amount")) return "DOCUMENTED_PAYMENT_SHAPE";
    if (operation === "CANCEL" && status === "CANCELLED" && text(response.orderId) && own(response, "amount")) return "DOCUMENTED_CANCEL_SHAPE";
    if (operation === "PAY" && status === "PENDING" && text(response.orderId) && own(response, "amount") && text(response.currency) && text(response.qr)) return "DOCUMENTED_SUCCESS_SHAPE";
    return "SUCCESS_SHAPED_MISSING_FIELDS";
}

function responseShapeDiagnostic(response, configuration = {}, operation = "PAY", stage = "SDK_RETURN") {
    const objectResponse = plainObject(response);
    const safeStatus = safePrimitive(objectResponse ? response.status : undefined);
    const safeCode = safeCodePrimitive(objectResponse ? (response.code ?? response.errorCode) : undefined);
    const httpLikeStatus = safeHttpStatus(objectResponse ? (response.httpStatus ?? response.statusCode) : undefined);
    const configurationDiagnostic = configurationShape(configuration);
    return Object.freeze({
        provider: "MYANMYANPAY",
        operation,
        httpMethod: "POST",
        stage,
        classification: classifyResponseShape(response, operation),
        responseType: response === null ? "null" : typeof response,
        isNull: response === null,
        isArray: Array.isArray(response),
        isErrorInstance: response instanceof Error,
        safeErrorName: safeErrorName(response),
        ...(response instanceof Error ? { safeCauseCode: safeCauseCode(response), ...(operation === "PAY" ? { createPhase: safeCreatePhase(response) } : {}) } : {}),
        topLevelKeys: boundedSafeKeys(response),
        dataKeys: boundedSafeKeys(objectResponse ? response.data : null),
        resultKeys: boundedSafeKeys(objectResponse ? response.result : null),
        statusType: objectResponse ? typeof response.status : "undefined",
        ...(safeStatus !== null ? { safeStatus } : {}),
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
        ...safeUrlShape(configuration, operation),
        apiBaseUrlOrigin: configurationDiagnostic.apiBaseUrlOrigin,
        apiBaseUrlPath: configurationDiagnostic.apiBaseUrlPath,
        apiBaseUrlAlreadyContainsPaymentsPath: configurationDiagnostic.apiBaseUrlAlreadyContainsPaymentsPath,
        sdkSandboxKeyClassification: configurationDiagnostic.sdkSandboxKeyClassification
    });
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
        sdkSandboxKeyClassification: { publishableKeyLooksSandbox, secretKeyLooksSandbox, sdkWouldUseSandbox: publishableKeyLooksSandbox || secretKeyLooksSandbox }
    };
}

function getResponseShapeDiagnostic(response, configuration = {}) { return responseShapeDiagnostic(response, configuration, "GET"); }
function classifyGetResponseShape(response) { return classifyResponseShape(response, "GET"); }
function validReference(value) { return !value || SAFE_REFERENCE.test(text(value)); }
function validQr(value) { const qr = text(value); return qr.length >= 12 && qr.length <= 4096 && qr.startsWith("000201") && !/[\u0000-\u001f\u007f]/.test(qr); }

function createMyanMyanPayClient(configuration, options = {}) {
    const logger = options.logger || console;
    const sdk = options.sdk || MMPaySDK({ appId: configuration.appId, publishableKey: configuration.publishableKey, secretKey: configuration.secretKey, apiBaseUrl: configuration.apiBaseUrl });

    try {
        if (typeof sdk.handShake === "function") {
            const originalHandShake = sdk.handShake;
            sdk.handShake = async function instrumentedHandShake(...args) {
                try {
                    const result = await originalHandShake.apply(this, args);
                    try { logger.info?.("[MYANMYANPAY_HANDSHAKE_SHAPE]", handshakeShapeDiagnostic(result, configuration)); }
                    catch (_) { /* Diagnostics must never affect provider behavior. */ }
                    return result;
                } catch (error) {
                    try { logger.info?.("[MYANMYANPAY_HANDSHAKE_SHAPE]", handshakeShapeDiagnostic(error, configuration)); }
                    catch (_) { /* Diagnostics must never affect provider behavior. */ }
                    throw error;
                }
            };
        }
    } catch (_) { /* Inability to install diagnostics must never affect provider behavior. */ }

    function logShape(tag, value, operation, stage) {
        try { logger.info?.(tag, responseShapeDiagnostic(value, configuration, operation, stage)); }
        catch (_) { /* Diagnostics must never affect provider behavior. */ }
    }

    async function invoke(operation, input) {
        try {
            const response = await sdk[operation.toLowerCase()](input);
            logShape(operation === "GET" ? "[MYANMYANPAY_GET_RESPONSE_SHAPE]" : "[MYANMYANPAY_RESPONSE_SHAPE]", response, operation, "SDK_RETURN");
            if (response instanceof Error) throw clientError("MYANMYANPAY_SDK_RETURNED_ERROR", "MyanMyanPay SDK returned an error value.", 502, { classification: "ERROR_INSTANCE" });
            if (errorShaped(response)) throw clientError("MYANMYANPAY_PROVIDER_REJECTED", "MyanMyanPay rejected the request.", safeHttpStatus(response.httpStatus ?? response.statusCode) || 502, { classification: "ERROR_SHAPED_OBJECT", providerCode: safeCodePrimitive(response.code ?? response.errorCode) });
            if (!plainObject(response)) throw clientError("MYANMYANPAY_PROVIDER_RESPONSE_INVALID", "MyanMyanPay returned an invalid response.", 502, { classification: "NON_OBJECT_RESPONSE" });
            return response;
        } catch (error) {
            if (error?.code && text(error.code).startsWith("MYANMYANPAY_")) throw error;
            logShape(operation === "GET" ? "[MYANMYANPAY_GET_RESPONSE_SHAPE]" : "[MYANMYANPAY_RESPONSE_SHAPE]", error, operation, "SDK_THROW");
            throw clientError("MYANMYANPAY_SDK_OPERATION_FAILED", "MyanMyanPay SDK operation failed.", 502, { classification: "THROWN_EXCEPTION", safeErrorName: safeErrorName(error) });
        }
    }

    async function pay(payload = {}) {
        const orderId = text(payload.orderId);
        const amount = Number(payload.amount);
        if (!isMyanMyanPayProviderOrderId(orderId) || !Number.isSafeInteger(amount) || amount <= 0 || text(payload.currency).toUpperCase() !== "MMK" || text(payload.callbackUrl) !== text(configuration.callbackUrl)) throw clientError("MYANMYANPAY_PROVIDER_REQUEST_INVALID", "MyanMyanPay payment request is invalid.", 422);
        const sdkPayload = {
            orderId,
            amount,
            currency: "MMK",
            callbackUrl: configuration.callbackUrl,
            ...(text(payload.customMessage) ? { customMessage: text(payload.customMessage).slice(0, 150) } : {}),
            ...(Array.isArray(payload.items) && payload.items.length ? { items: payload.items } : {})
        };
        const response = await invoke("PAY", sdkPayload);
        if (classifyResponseShape(response, "PAY") !== "DOCUMENTED_SUCCESS_SHAPE" || text(response.currency).toUpperCase() !== "MMK" || !validQr(response.qr) || !validReference(response.vendorQrRefId) || !validReference(response.transactionRefId)) throw clientError("MYANMYANPAY_PROVIDER_RESPONSE_INVALID", "MyanMyanPay returned an invalid payment response.");
        if (text(response.orderId) !== orderId || Number(response.amount) !== amount) throw clientError("MYANMYANPAY_PROVIDER_BINDING_MISMATCH", "MyanMyanPay payment response binding is invalid.");
        return Object.freeze({ orderId, amount, currency: "MMK", status: "PENDING", qr: text(response.qr), vendorQrRefId: text(response.vendorQrRefId), transactionRefId: text(response.transactionRefId), url: text(response.url) });
    }

    async function get(input = {}) {
        const orderId = text(input.orderId);
        if (!isMyanMyanPayProviderOrderId(orderId)) throw clientError("MYANMYANPAY_PROVIDER_REQUEST_INVALID", "MyanMyanPay orderId is invalid.", 422);
        const response = await invoke("GET", { orderId });
        const status = text(response.status).toUpperCase();
        if (classifyResponseShape(response, "GET") !== "DOCUMENTED_PAYMENT_SHAPE" || !validReference(response.transactionRefId) || !validReference(response.vendorQrRefId) || (response.qr && !validQr(response.qr))) throw clientError("MYANMYANPAY_PROVIDER_RESPONSE_INVALID", "MyanMyanPay returned an invalid reconciliation response.");
        if (text(response.orderId) !== orderId || (own(input, "expectedAmount") && Number(response.amount) !== Number(input.expectedAmount)) || (response.currency && text(response.currency).toUpperCase() !== "MMK") || (input.expectedCurrency && text(input.expectedCurrency).toUpperCase() !== "MMK")) throw clientError("MYANMYANPAY_PROVIDER_BINDING_MISMATCH", "MyanMyanPay reconciliation response binding is invalid.");
        return Object.freeze({ orderId, amount: Number(response.amount), status, appId: text(response.appId), method: text(response.method).toUpperCase(), currency: response.currency ? text(response.currency).toUpperCase() : "", condition: text(response.condition).toUpperCase(), transactionRefId: text(response.transactionRefId), vendorQrRefId: text(response.vendorQrRefId), qr: text(response.qr) });
    }

    async function cancel(input = {}) {
        const orderId = text(input.orderId);
        if (!isMyanMyanPayProviderOrderId(orderId)) throw clientError("MYANMYANPAY_PROVIDER_REQUEST_INVALID", "MyanMyanPay orderId is invalid.", 422);
        const response = await invoke("CANCEL", { orderId });
        if (classifyResponseShape(response, "CANCEL") !== "DOCUMENTED_CANCEL_SHAPE" || !validReference(response.vendorQrRefId)) throw clientError("MYANMYANPAY_PROVIDER_RESPONSE_INVALID", "MyanMyanPay returned an invalid cancellation response.");
        if (text(response.orderId) !== orderId || (own(input, "expectedAmount") && Number(response.amount) !== Number(input.expectedAmount))) throw clientError("MYANMYANPAY_PROVIDER_BINDING_MISMATCH", "MyanMyanPay cancellation response binding is invalid.");
        return Object.freeze({ orderId, amount: Number(response.amount), status: "CANCELLED", vendorQrRefId: text(response.vendorQrRefId) });
    }

    async function verifyAndListen(payload, nonce, signature) {
        const expected = text(sdk._generateSignature(payload, nonce));
        const supplied = text(signature);
        const expectedBuffer = Buffer.from(expected, "utf8");
        const suppliedBuffer = Buffer.from(supplied, "utf8");
        if (!nonce || !supplied || expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) throw clientError("MYANMYANPAY_CALLBACK_SIGNATURE_INVALID", "MyanMyanPay callback authentication failed.", 401);
        let verified = false;
        const mark = () => { verified = true; };
        sdk.once("tx:create", mark).once("tx:success", mark).once("tx:failed", mark).once("tx:refunded", mark).once("tx:cancel", mark).once("tx:expire", mark).once("tx:heartbeat", mark).once("tx:unknown", mark);
        sdk.once("error", () => {});
        await sdk.listen(payload, nonce, supplied);
        if (!verified) throw clientError("MYANMYANPAY_CALLBACK_VERIFICATION_FAILED", "MyanMyanPay callback verification failed.", 401);
        return JSON.parse(payload);
    }

    return Object.freeze({ pay, get, cancel, verifyAndListen });
}

module.exports = Object.freeze({
    createMyanMyanPayClient,
    _test: Object.freeze({ boundedKeys, safePrimitive, boundedSafeKeys, safeCodePrimitive, safeHttpStatus, safeErrorName, safeCauseCode, safeCreatePhase, handshakeShapeDiagnostic, safeUrlShape, errorShaped, classifyResponseShape, classifyGetResponseShape, responseShapeDiagnostic, getResponseShapeDiagnostic, configurationShape, validReference, validQr })
});
