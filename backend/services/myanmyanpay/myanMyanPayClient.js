"use strict";

const crypto = require("crypto");
const { MMPaySDK } = require("mmpay-node-sdk");

function text(value) { return String(value || "").trim(); }
function clientError(code, message, httpStatus = 502) { return Object.assign(new Error(message), { code, httpStatus }); }
const MAX_DIAGNOSTIC_KEYS = 24;
const MAX_DIAGNOSTIC_TEXT = 80;

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

    async function pay(payload) {
        const response = await sdk.pay(payload);
        try {
            logger.info?.("[MYANMYANPAY_RESPONSE_SHAPE]", responseShapeDiagnostic(response, configuration));
        } catch (_) { /* Temporary diagnostics must never affect payment behavior. */ }
        if (!response || typeof response !== "object" || response.status !== "PENDING" || !text(response.orderId) || !text(response.qr)) {
            throw clientError("MYANMYANPAY_CREATE_RESPONSE_INVALID", "MyanMyanPay returned an invalid payment response.");
        }
        return response;
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

    return Object.freeze({ pay, get: input => sdk.get(input), cancel: input => sdk.cancel(input), verifyAndListen });
}

module.exports = Object.freeze({
    createMyanMyanPayClient,
    _test: Object.freeze({ boundedKeys, safePrimitive, classifyResponseShape, configurationShape, responseShapeDiagnostic })
});
