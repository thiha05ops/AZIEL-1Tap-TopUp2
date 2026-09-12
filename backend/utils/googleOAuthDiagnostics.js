"use strict";

const crypto = require("crypto");

const SAFE_FIELDS = new Set([
    "correlationId", "requestHostClass", "requestProtocol", "callbackOriginClass",
    "callbackPathClass", "codePresent", "statePresent", "codeFingerprint",
    "errorCategory", "providerHttpStatus", "elapsedMs", "profileTag", "userTag",
    "sessionTag", "created", "linked", "destinationOriginClass", "destinationPathClass"
]);

function fingerprint(value) {
    try {
        const input = String(value == null ? "" : value);
        return input ? crypto.createHash("sha256").update(input).digest("hex").slice(0, 16) : "";
    } catch (_) { return ""; }
}

function safeToken(value, max = 80) {
    try {
        return String(value == null ? "" : value).replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, max);
    } catch (_) { return ""; }
}

function safeRead(target, key) {
    try { return target?.[key]; } catch (_) { return undefined; }
}

function safeFields(fields = {}) {
    try {
        const output = {};
        for (const [key, value] of Object.entries(fields || {})) {
            if (!SAFE_FIELDS.has(key) || value === undefined || value === null || value === "") continue;
            if (["codePresent", "statePresent", "created", "linked"].includes(key)) output[key] = value === true;
            else if (["providerHttpStatus", "elapsedMs"].includes(key)) {
                const number = Number(value);
                if (Number.isFinite(number)) output[key] = number;
            } else output[key] = safeToken(value);
        }
        return output;
    } catch (_) { return {}; }
}

function logGoogleOAuthDiagnostic(logger, event, fields = {}, level = "info") {
    try {
        const target = logger || console;
        const writer = typeof target?.[level] === "function" ? target[level].bind(target) : target?.log?.bind(target);
        if (!writer) return;
        writer("[GOOGLE_OAUTH_DIAGNOSTIC]", { event: safeToken(event, 100), ...safeFields(fields), at: new Date().toISOString() });
    } catch (_) { /* Diagnostics must never affect authentication. */ }
}

function classifyRequestHost(req) {
    try {
        const headers = safeRead(req, "headers");
        const host = String(safeRead(headers, "host") || "").split(":")[0].toLowerCase();
        if (host === "azielplay.com") return "storefront";
        if (host === "www.azielplay.com") return "storefront_www";
        if (host.endsWith(".onrender.com")) return "render";
        if (["localhost", "127.0.0.1", "::1"].includes(host)) return "local";
        return "other";
    } catch (_) { return "other"; }
}

function classifyGoogleOAuthError(error = {}) {
    try {
        const oauthError = safeRead(error, "oauthError");
        const code = safeToken(safeRead(error, "code") || safeRead(oauthError, "code") || "").toLowerCase();
        if (code === "invalid_grant") return "GOOGLE_TOKEN_INVALID_GRANT";
        if (code === "invalid_client") return "GOOGLE_TOKEN_INVALID_CLIENT";
        if (["econnreset", "econnrefused", "enotfound", "etimedout", "eai_again"].includes(code)) return "GOOGLE_TOKEN_NETWORK_ERROR";
        if (safeRead(error, "status") || safeRead(error, "statusCode") || safeRead(oauthError, "statusCode")) return "GOOGLE_TOKEN_PROVIDER_ERROR";
        return "GOOGLE_TOKEN_UNKNOWN_ERROR";
    } catch (_) { return "GOOGLE_TOKEN_UNKNOWN_ERROR"; }
}

function isGoogleTokenExchangeError(error) {
    try {
        const name = safeToken(safeRead(error, "name"));
        const message = safeToken(safeRead(error, "message"), 120).toLowerCase();
        return name === "TokenError" || (name === "InternalOAuthError" && message.includes("failed_to_obtain_access_token"));
    } catch (_) { return false; }
}

function classifyGoogleAuthenticationError(error) {
    try {
        const stage = safeToken(safeRead(error, "googleOAuthStage")).toLowerCase();
        if (stage === "profile") return "GOOGLE_PROFILE_ERROR";
        if (stage === "user_resolution") return "GOOGLE_USER_RESOLUTION_ERROR";
        return error ? "GOOGLE_AUTH_APPLICATION_ERROR" : "GOOGLE_AUTH_UNKNOWN_ERROR";
    } catch (_) { return "GOOGLE_AUTH_UNKNOWN_ERROR"; }
}

module.exports = Object.freeze({ classifyGoogleAuthenticationError, classifyGoogleOAuthError, classifyRequestHost, fingerprint, isGoogleTokenExchangeError, logGoogleOAuthDiagnostic, safeFields, safeRead });
