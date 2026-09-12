"use strict";

const BASE_URL = "https://api.thunder.in.th/v2";
const { logThunderDiagnostic } = require("../utils/thunderDiagnostics");

const PROVIDER_ERROR_CLASSIFICATIONS = Object.freeze({
    MISSING_API_KEY: "THUNDER_AUTHENTICATION_FAILED",
    INVALID_API_KEY: "THUNDER_AUTHENTICATION_FAILED",
    API_KEY_INVALID: "THUNDER_AUTHENTICATION_FAILED",
    EXPIRED_API_KEY: "THUNDER_AUTHENTICATION_FAILED",
    UNAUTHORIZED: "THUNDER_AUTHENTICATION_FAILED",
    AUTHENTICATION_FAILED: "THUNDER_AUTHENTICATION_FAILED",
    IP_NOT_ALLOWED: "THUNDER_IP_RESTRICTED",
    IP_RESTRICTED: "THUNDER_IP_RESTRICTED",
    IP_WHITELIST: "THUNDER_IP_RESTRICTED",
    QUOTA_EXCEEDED: "THUNDER_QUOTA_EXCEEDED",
    RATE_LIMITED: "THUNDER_QUOTA_EXCEEDED",
    TOO_MANY_REQUESTS: "THUNDER_QUOTA_EXCEEDED",
    BRANCH_INACTIVE: "THUNDER_PROVIDER_RESTRICTED",
    SERVICE_BANNED: "THUNDER_PROVIDER_RESTRICTED",
    SERVICE_DELETED: "THUNDER_PROVIDER_RESTRICTED",
    USER_BANNED: "THUNDER_PROVIDER_RESTRICTED",
    VALIDATION_ERROR: "THUNDER_SLIP_REJECTED",
    INVALID_PAYLOAD: "THUNDER_SLIP_REJECTED",
    SLIP_NOT_FOUND: "THUNDER_SLIP_REJECTED",
    INVALID_IMAGE_TYPE: "THUNDER_SLIP_REJECTED",
    INVALID_IMAGE_FORMAT: "THUNDER_SLIP_REJECTED",
    INVALID_SLIP: "THUNDER_SLIP_REJECTED",
    DUPLICATE_SLIP: "THUNDER_DUPLICATE",
    SLIP_DUPLICATE: "THUNDER_DUPLICATE",
    ALREADY_VERIFIED: "THUNDER_DUPLICATE",
    API_SERVER_ERROR: "THUNDER_PROVIDER_UNAVAILABLE",
    INTERNAL_SERVER_ERROR: "THUNDER_PROVIDER_UNAVAILABLE"
});
const KNOWN_PROVIDER_CODES = Object.freeze(new Set(["SLIP_PENDING", ...Object.keys(PROVIDER_ERROR_CLASSIFICATIONS)]));

function normalizeProviderErrorCode(body = {}) {
    const raw = body?.error?.code || body?.code || body?.status || "";
    let normalized = "";
    try { normalized = String(raw).trim().replace(/[^A-Za-z0-9_-]/g, "_").replace(/-/g, "_").toUpperCase().slice(0, 120); } catch (_) { return "UNKNOWN_PROVIDER_CODE"; }
    if (!normalized) return "";
    return KNOWN_PROVIDER_CODES.has(normalized) ? normalized : "UNKNOWN_PROVIDER_CODE";
}

function classifyProviderError(providerCode, statusCode) {
    if (providerCode === "SLIP_PENDING") return "SLIP_PENDING";
    if (PROVIDER_ERROR_CLASSIFICATIONS[providerCode]) return PROVIDER_ERROR_CLASSIFICATIONS[providerCode];
    if (statusCode === 401) return "THUNDER_AUTHENTICATION_FAILED";
    if (statusCode === 403) return "THUNDER_ACCESS_RESTRICTED";
    if (statusCode === 429) return "THUNDER_QUOTA_EXCEEDED";
    return statusCode >= 500 ? "THUNDER_PROVIDER_UNAVAILABLE" : "THUNDER_REJECTED";
}

function hasProviderOutcome(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
    return [body.success, body.verified, body.isSuccess, body.status, body.code, data.success, data.verified, data.isSuccess, data.status, data.code]
        .some(value => value !== undefined && value !== null && value !== "");
}

class ThunderApiError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "ThunderApiError";
        this.code = code;
        this.retryable = options.retryable === true;
        this.statusCode = options.statusCode || 0;
        this.providerCode = String(options.providerCode || "");
    }
}

function createThunderApiClient(options = {}) {
    const apiKey = String(options.apiKey || process.env.THUNDER_API_KEY || "").trim();
    const fetchImpl = options.fetch || globalThis.fetch;
    const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || 10000, 30000));
    const logger = options.logger || console;

    async function verifyBank(input = {}) {
        const startedAt = Date.now();
        const diagnostic = { correlationId: input.correlationId || "", orderTag: input.orderTag || "", attemptTag: input.attemptTag || "" };
        logThunderDiagnostic(logger, "THUNDER_REQUEST_STARTED", diagnostic);
        if (!apiKey) throw new ThunderApiError("THUNDER_NOT_CONFIGURED", "Payment verification is unavailable.");
        if (typeof fetchImpl !== "function") throw new ThunderApiError("THUNDER_UNAVAILABLE", "Payment verification is unavailable.");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(`${BASE_URL}/verify/bank`, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                    payload: String(input.payload || ""),
                    remark: String(input.remark || "").slice(0, 100),
                    matchAccount: true,
                    matchAmount: Number(input.matchAmount),
                    checkDuplicate: true
                }),
                signal: controller.signal
            });
            let body;
            try { body = await response.json(); } catch (_) {
                logThunderDiagnostic(logger, "THUNDER_RESPONSE_MALFORMED", { ...diagnostic, providerHttpStatus: response.status, elapsedMs: Date.now() - startedAt, azielErrorCode: "THUNDER_INVALID_RESPONSE" }, "warn");
                throw new ThunderApiError("THUNDER_INVALID_RESPONSE", "The slip verifier returned an invalid response.", { statusCode: response.status, retryable: true });
            }
            if (response.ok && !hasProviderOutcome(body)) {
                logThunderDiagnostic(logger, "THUNDER_RESPONSE_MALFORMED", { ...diagnostic, providerHttpStatus: response.status, elapsedMs: Date.now() - startedAt, azielErrorCode: "THUNDER_INVALID_RESPONSE" }, "warn");
                throw new ThunderApiError("THUNDER_INVALID_RESPONSE", "The slip verifier returned an invalid response.", { statusCode: response.status, retryable: true });
            }
            const providerCode = normalizeProviderErrorCode(body);
            const classification = response.ok ? "THUNDER_RESPONSE_OK" : classifyProviderError(providerCode, response.status);
            const retryable = classification === "SLIP_PENDING" || classification === "THUNDER_PROVIDER_UNAVAILABLE" || classification === "THUNDER_QUOTA_EXCEEDED" || response.status >= 500;
            logThunderDiagnostic(logger, "THUNDER_RESPONSE_RECEIVED", { ...diagnostic, providerHttpStatus: response.status, elapsedMs: Date.now() - startedAt, providerErrorCode: providerCode, azielErrorCode: classification, retryable });
            if (!response.ok) {
                if (classification === "SLIP_PENDING") return { status: "SLIP_PENDING", providerCode };
                throw new ThunderApiError(classification, "The slip could not be verified.", { statusCode: response.status, retryable, providerCode });
            }
            return body;
        } catch (error) {
            if (error instanceof ThunderApiError) throw error;
            if (error?.name === "AbortError") {
                logThunderDiagnostic(logger, "THUNDER_REQUEST_FAILED", { ...diagnostic, elapsedMs: Date.now() - startedAt, azielErrorCode: "THUNDER_TIMEOUT", retryable: true }, "warn");
                throw new ThunderApiError("THUNDER_TIMEOUT", "Payment verification timed out. Please retry.", { retryable: true });
            }
            logThunderDiagnostic(logger, "THUNDER_REQUEST_FAILED", { ...diagnostic, elapsedMs: Date.now() - startedAt, azielErrorCode: "THUNDER_UNAVAILABLE", retryable: true }, "warn");
            throw new ThunderApiError("THUNDER_UNAVAILABLE", "Payment verification is temporarily unavailable.", { retryable: true });
        } finally {
            clearTimeout(timer);
        }
    }

    return Object.freeze({ verifyBank });
}

module.exports = Object.freeze({ BASE_URL, KNOWN_PROVIDER_CODES, PROVIDER_ERROR_CLASSIFICATIONS, ThunderApiError, classifyProviderError, createThunderApiClient, hasProviderOutcome, normalizeProviderErrorCode });
