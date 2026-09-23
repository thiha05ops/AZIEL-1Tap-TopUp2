"use strict";

const { encryptDingerPayPayloadBase64 } = require("./dingerCryptoService");

const MIN_AMOUNT_MMK = 500;
const MAX_AMOUNT_MMK = 999999999;

class DingerApiError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "DingerApiError";
        this.code = code;
        this.stage = options.stage || "api";
        this.httpStatus = Number(options.httpStatus || 0);
        this.retryable = options.retryable === true;
        this.submissionUncertain = options.submissionUncertain === true;
        this.providerCode = String(options.providerCode || "").slice(0, 40);
        this.providerMessage = String(options.providerMessage || "").slice(0, 200);
        this.failureCategory = String(options.failureCategory || "").slice(0, 40);
        this.safeDiagnostics = Object.freeze({ ...(options.safeDiagnostics || {}) });
    }
}

function text(value) { return String(value || "").trim(); }
function sanitizedProviderCode(value) {
    return text(value).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
}
function isSuccessCode(value) {
    return value === 0 || /^(?:0|00|000)$/.test(String(value || "").trim());
}
function parseDingerTimestamp(value, field = "timestamp") {
    const raw = text(value);
    const match = /^(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2})$/.exec(raw);
    if (!match) throw new DingerApiError("DINGER_RESPONSE_INVALID", `Dinger ${field} must use yyyyMMdd HHmmss.`, { stage: "response" });
    const parts = match.slice(1).map(Number);
    const [year, month, day, hour, minute, second] = parts;
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
        throw new DingerApiError("DINGER_RESPONSE_INVALID", `Dinger ${field} is not a valid calendar timestamp.`, { stage: "response" });
    }
    return Object.freeze({ raw, year, month, day, hour, minute, second });
}
function tokenDiagnostics(input, responseContext = {}) {
    const object = input && typeof input === "object" && !Array.isArray(input) ? input : null;
    const response = object?.response && typeof object.response === "object" && !Array.isArray(object.response) ? object.response : null;
    return Object.freeze({
        httpStatus: Number(responseContext.httpStatus || 0),
        bodyNonempty: responseContext.bodyNonempty === true,
        jsonParsed: responseContext.jsonParsed === true,
        providerCode: sanitizedProviderCode(object?.code),
        codePresent: Boolean(object && Object.prototype.hasOwnProperty.call(object, "code")),
        messagePresent: Boolean(object && Object.prototype.hasOwnProperty.call(object, "message")),
        responsePresent: Boolean(response),
        paymentTokenPresent: Boolean(text(response?.paymentToken)),
        expireInPresent: Boolean(text(response?.expireIn))
    });
}
function tokenError(code, message, category, input, responseContext = {}, options = {}) {
    const diagnostics = tokenDiagnostics(input, responseContext);
    return new DingerApiError(code, message, {
        stage: options.stage || "token",
        httpStatus: diagnostics.httpStatus,
        providerCode: diagnostics.providerCode,
        providerMessage: input && typeof input === "object" ? input.message : "",
        failureCategory: category,
        safeDiagnostics: diagnostics
    });
}
function tokenExpiryEpochMs(parts, utcOffsetMinutes) {
    if (!Number.isSafeInteger(utcOffsetMinutes) || utcOffsetMinutes < -840 || utcOffsetMinutes > 840) {
        throw new DingerApiError("DINGER_TOKEN_TIMEZONE_UNCONFIRMED", "Dinger token timestamp UTC offset must be configured explicitly.", { stage: "configuration" });
    }
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - (utcOffsetMinutes * 60 * 1000);
}
function parseDingerTokenResponse(input = {}, responseContext = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        const category = responseContext.bodyNonempty === false ? "EMPTY_RESPONSE" : responseContext.jsonParsed === false ? "NON_JSON_RESPONSE" : "TOKEN_FIELD_MISSING";
        throw tokenError("DINGER_TOKEN_RESPONSE_INVALID", "Dinger token response is invalid.", category, input, responseContext);
    }
    if (!isSuccessCode(input.code)) throw tokenError("DINGER_TOKEN_REJECTED", "Dinger token request was not successful.", "PROVIDER_REJECTED", input, responseContext);
    const paymentToken = text(input.response?.paymentToken);
    if (!paymentToken) throw tokenError("DINGER_TOKEN_RESPONSE_INVALID", "Dinger token response is missing paymentToken.", "TOKEN_FIELD_MISSING", input, responseContext);
    let expireIn;
    try { expireIn = parseDingerTimestamp(input.response?.expireIn, "response.expireIn"); }
    catch (error) {
        throw tokenError(error.code || "DINGER_RESPONSE_INVALID", error.message, "EXPIRY_INVALID", input, responseContext, { stage: error.stage || "response" });
    }
    let expiresAtEpochMs;
    try { expiresAtEpochMs = tokenExpiryEpochMs(expireIn, responseContext.tokenTimestampUtcOffsetMinutes); }
    catch (error) {
        throw tokenError(error.code, error.message, "EXPIRY_INVALID", input, responseContext, { stage: error.stage });
    }
    const nowMs = Number(responseContext.nowMs);
    if (!Number.isFinite(nowMs) || expiresAtEpochMs <= nowMs) {
        throw tokenError("DINGER_RESPONSE_INVALID", "Dinger response.expireIn must be a future timestamp.", "EXPIRY_INVALID", input, responseContext, { stage: "response" });
    }
    return Object.freeze({ code: "000", message: text(input.message).slice(0, 200), paymentToken, expiredAt: expireIn.raw, expireIn: expireIn.raw, expiresAtEpochMs, expirationParts: expireIn });
}
function validationError(field, message) {
    return new DingerApiError("DINGER_PAYLOAD_INVALID", message, { stage: "pay_validation", field });
}
function normalizePayPayload(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw validationError("payload", "Dinger payment payload must be an object.");
    const providerName = text(input.providerName);
    const methodName = text(input.methodName);
    const orderId = text(input.orderId);
    const customerPhone = text(input.customerPhone);
    const customerName = text(input.customerName);
    const totalAmount = Number(input.totalAmount);
    if (!providerName) throw validationError("providerName", "Dinger providerName is required.");
    if (!methodName) throw validationError("methodName", "Dinger methodName is required.");
    if (!Number.isSafeInteger(totalAmount) || totalAmount < MIN_AMOUNT_MMK || totalAmount > MAX_AMOUNT_MMK) {
        throw validationError("totalAmount", `Dinger totalAmount must be an integer from ${MIN_AMOUNT_MMK} to ${MAX_AMOUNT_MMK} MMK.`);
    }
    if (!orderId || orderId.length > 50) throw validationError("orderId", "Dinger orderId is required and must not exceed 50 characters.");
    if (!customerPhone) throw validationError("customerPhone", "Dinger customerPhone is required.");
    if (!customerName) throw validationError("customerName", "Dinger customerName is required.");
    let items;
    if (Array.isArray(input.items)) items = input.items;
    else if (typeof input.items === "string") {
        try { items = JSON.parse(input.items); } catch (_) { throw validationError("items", "Dinger items must be a JSON-array string."); }
    }
    if (!Array.isArray(items)) throw validationError("items", "Dinger items must be a JSON-array string.");
    const currency = text(input.currency).toUpperCase();
    if (currency && currency !== "MMK") throw validationError("currency", "Dinger Phase 1 supports MMK only.");
    return Object.freeze({ providerName, methodName, totalAmount, orderId, customerPhone, customerName, items: JSON.stringify(items), ...(currency ? { currency } : {}) });
}
function contractError(stage) {
    return new DingerApiError("DINGER_RESPONSE_CONTRACT_UNCONFIRMED", `Dinger ${stage} response contract is not confirmed.`, { stage });
}
async function readResponse(response) {
    const body = await response.text();
    let parsed = null;
    let jsonParsed = false;
    try {
        if (body) {
            parsed = JSON.parse(body);
            jsonParsed = true;
        }
    } catch (_) { /* normalized below without retaining raw body in diagnostics */ }
    return { body, parsed, httpStatus: Number(response.status || 0), bodyNonempty: Boolean(body), jsonParsed };
}

function createDingerApiClient(options = {}) {
    const configuration = options.configuration || {};
    const fetchImpl = options.fetchImpl || global.fetch;
    const encryptRequest = options.encryptRequest || (plaintext => encryptDingerPayPayloadBase64({ plaintext, publicKey: configuration.publicKey }));
    const parseTokenResponse = options.parseTokenResponse || parseDingerTokenResponse;
    const parsePayResponse = options.parsePayResponse;
    const clock = typeof options.clock === "function" ? options.clock : () => new Date();
    if (typeof fetchImpl !== "function") throw new DingerApiError("DINGER_HTTP_UNAVAILABLE", "Server HTTP client is unavailable.", { stage: "configuration" });

    async function request(url, init, timeoutMs, stage, submissionUncertain = false) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(url, { ...init, signal: controller.signal });
            const result = await readResponse(response);
            if (!response.ok) {
                throw new DingerApiError("DINGER_HTTP_ERROR", `Dinger ${stage} request was rejected.`, {
                    stage,
                    httpStatus: response.status,
                    retryable: response.status >= 500,
                    submissionUncertain,
                    providerCode: result.parsed?.code,
                    providerMessage: result.parsed?.message
                });
            }
            return result;
        } catch (error) {
            if (error instanceof DingerApiError) throw error;
            const timedOut = error?.name === "AbortError";
            throw new DingerApiError(timedOut ? "DINGER_TIMEOUT" : "DINGER_NETWORK_ERROR", `Dinger ${stage} request failed.`, {
                stage, retryable: !submissionUncertain, submissionUncertain
            });
        } finally {
            clearTimeout(timer);
        }
    }

    async function getToken() {
        if (configuration.enabled !== true) throw new DingerApiError("DINGER_DISABLED", "Dinger is disabled.", { stage: "configuration" });
        if (typeof parseTokenResponse !== "function") throw contractError("token");
        const tokenUrl = text(configuration.tokenUrl) || `${text(configuration.baseUrl).replace(/\/+$/, "")}/api/token`;
        const url = new URL(tokenUrl);
        url.searchParams.set("projectName", text(configuration.projectName));
        url.searchParams.set("apiKey", text(configuration.apiKey));
        url.searchParams.set("merchantName", text(configuration.merchantName));
        const response = await request(url, { method: "GET", headers: { Accept: "application/json" } }, configuration.tokenTimeoutMs, "token");
        const token = parseTokenResponse(response.parsed, {
            httpStatus: response.httpStatus,
            bodyNonempty: response.bodyNonempty,
            jsonParsed: response.jsonParsed,
            tokenTimestampUtcOffsetMinutes: configuration.tokenTimestampUtcOffsetMinutes,
            nowMs: clock().getTime()
        });
        if (!token || typeof token !== "object" || !text(token.paymentToken) || !text(token.expiredAt)) throw contractError("token");
        return Object.freeze({ code: text(token.code || "000"), message: text(token.message).slice(0, 200), paymentToken: text(token.paymentToken), expiredAt: text(token.expiredAt), expirationParts: token.expirationParts || parseDingerTimestamp(token.expiredAt, "token.expiredAt") });
    }

    async function createPayment(payload) {
        const normalizedPayload = normalizePayPayload(payload);
        if (typeof parsePayResponse !== "function") throw contractError("pay");
        const token = await getToken();
        const encryptedPayload = await encryptRequest(JSON.stringify(normalizedPayload));
        if (!text(encryptedPayload)) throw new DingerApiError("DINGER_ENCRYPTION_FAILED", "Dinger encrypted payload is unavailable.", { stage: "pay" });
        const form = new FormData();
        form.append("payload", text(encryptedPayload));
        const payUrl = text(configuration.payUrl) || `${text(configuration.baseUrl).replace(/\/+$/, "")}/api/pay`;
        const response = await request(payUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${token.paymentToken}`, Accept: "application/json" },
            body: form
        }, configuration.payTimeoutMs, "pay", true);
        return parsePayResponse(response.parsed, Object.freeze({
            httpStatus: response.httpStatus,
            bodyNonempty: response.bodyNonempty,
            jsonParsed: response.jsonParsed
        }));
    }

    return Object.freeze({ getToken, createPayment });
}

module.exports = Object.freeze({
    createDingerApiClient,
    normalizePayPayload,
    parseDingerTokenResponse,
    parseDingerTimestamp,
    isSuccessCode,
    DingerApiError,
    DINGER_MIN_AMOUNT_MMK: MIN_AMOUNT_MMK,
    DINGER_MAX_AMOUNT_MMK: MAX_AMOUNT_MMK
});
