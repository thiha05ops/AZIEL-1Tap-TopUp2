"use strict";

const defaultFetch = require("node-fetch");

const DEFAULT_BASE_URL = "http://www.tmweasyapi.com/api_pph.php";
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

class TmwEasyApiError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "TmwEasyApiError";
        this.code = code;
        this.statusCode = options.statusCode || 502;
        this.retryable = options.retryable === true;
        this.submissionUncertain = options.submissionUncertain === true;
    }
}

function text(value) {
    return String(value == null ? "" : value).trim();
}

function isProduction(env = {}) {
    return text(env.NODE_ENV).toLowerCase() === "production";
}

function configurationFromEnvironment(env = process.env) {
    const baseUrl = text(env.TMW_API_BASE_URL) || DEFAULT_BASE_URL;
    let parsedUrl = null;
    try { parsedUrl = new URL(baseUrl); } catch { parsedUrl = null; }
    const promptPayType = text(env.TMW_PROMPTPAY_TYPE);
    const timeout = Number(env.TMW_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    const allowInsecure = text(env.TMW_ALLOW_INSECURE_HTTP).toLowerCase() === "true";
    const enabled = text(env.TMW_PROVIDER_ENABLED).toLowerCase() === "true";
    const webhookUrl = text(env.TMW_WEBHOOK_URL);
    let parsedWebhookUrl = null;
    try { parsedWebhookUrl = webhookUrl ? new URL(webhookUrl) : null; } catch { parsedWebhookUrl = null; }
    const missing = [];
    if (!text(env.TMW_USERNAME)) missing.push("username");
    if (!text(env.TMW_PASSWORD)) missing.push("password");
    if (!text(env.TMW_CON_ID)) missing.push("con_id");
    if (!text(env.TMW_API_KEY)) missing.push("api_key");
    if (!text(env.TMW_PROMPTPAY_ID)) missing.push("promptpay_id");
    if (!["01", "02"].includes(promptPayType)) missing.push("promptpay_type");
    if (!enabled) missing.push("provider_enabled");
    if (!parsedWebhookUrl || !["http:", "https:"].includes(parsedWebhookUrl.protocol)) missing.push("webhook_url");
    if (isProduction(env) && parsedWebhookUrl?.protocol !== "https:") missing.push("production_webhook_https");
    if (!parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol)) missing.push("api_base_url");
    const insecureTransport = parsedUrl?.protocol === "http:";
    if (insecureTransport && isProduction(env) && !allowInsecure) missing.push("production_transport_approval");
    return Object.freeze({
        username: text(env.TMW_USERNAME),
        password: text(env.TMW_PASSWORD),
        conId: text(env.TMW_CON_ID),
        apiKey: text(env.TMW_API_KEY),
        promptPayId: text(env.TMW_PROMPTPAY_ID),
        promptPayType,
        baseUrl,
        timeoutMs: Number.isInteger(timeout) && timeout >= 1000 && timeout <= 30000 ? timeout : DEFAULT_TIMEOUT_MS,
        insecureTransport,
        explicitlyApprovedInsecureTransport: allowInsecure,
        enabled,
        webhookUrl,
        ready: missing.length === 0,
        missing
    });
}

function createTmwEasyApiClient(options = {}) {
    const env = options.env || process.env;
    const config = options.configuration || configurationFromEnvironment(env);
    const fetchImpl = options.fetchImpl || defaultFetch;

    function assertReady() {
        if (!config.ready) {
            throw new TmwEasyApiError("TMW_NOT_CONFIGURED", "TMW payment provider is not ready.", { statusCode: 503 });
        }
    }

    async function request(parameters, requestOptions = {}) {
        assertReady();
        const url = new URL(config.baseUrl);
        Object.entries({
            username: config.username,
            password: config.password,
            con_id: config.conId,
            ...parameters
        }).forEach(([key, value]) => url.searchParams.set(key, text(value)));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);
        let response;
        try {
            response = await fetchImpl(url.toString(), {
                method: "GET",
                headers: { Accept: "application/json" },
                signal: controller.signal,
                redirect: "manual"
            });
        } catch (error) {
            throw new TmwEasyApiError("TMW_TRANSPORT_ERROR", "TMW request outcome could not be confirmed.", {
                retryable: requestOptions.submission !== true,
                submissionUncertain: requestOptions.submission === true
            });
        } finally {
            clearTimeout(timer);
        }
        let body;
        try {
            const declaredLength = Number(response.headers?.get?.("content-length") || 0);
            if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error("response too large");
            body = await response.text();
            if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("response too large");
        } catch {
            throw new TmwEasyApiError("TMW_INVALID_RESPONSE", "TMW returned an invalid response.");
        }
        if (!response.ok) {
            throw new TmwEasyApiError(`TMW_HTTP_${response.status}`, "TMW returned an HTTP error.", {
                statusCode: response.status,
                retryable: response.status >= 500,
                submissionUncertain: requestOptions.submission === true && response.status >= 500
            });
        }
        let payload;
        try { payload = JSON.parse(body); }
        catch { throw new TmwEasyApiError("TMW_INVALID_RESPONSE", "TMW returned an invalid response."); }
        return payload;
    }

    const createPay = ({ amount, ref1, ip }) => request({ amount, ref1, ip, method: "create_pay" }, { submission: true });
    const detailPay = ({ idPay }) => request({ id_pay: idPay, promptpay_id: config.promptPayId, type: config.promptPayType, method: "detail_pay" });
    const cancelPay = ({ idPay }) => request({ id_pay: idPay, method: "cancel" }, { submission: true });

    return Object.freeze({ createPay, detailPay, cancelPay, configuration: config });
}

module.exports = Object.freeze({
    createTmwEasyApiClient,
    configurationFromEnvironment,
    TmwEasyApiError,
    DEFAULT_BASE_URL
});
